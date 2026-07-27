/**
 * カードデザインを「背景透過PNG」で書き出す。
 *
 * 画面に見えているカードをそのまま撮ると小さくて粗いので、
 * 書き出し専用に大きいサイズ（`EXPORT_WIDTH`）でもう一枚描いてから撮る。
 * 角の外側は透過。カードの影（`box-shadow`）は書き出しでは邪魔なので消す。
 */
import { createRoot } from 'react-dom/client';
import { toSvg } from 'html-to-image';
import { CardFrame } from '../../web/src/CardFrame';
import type { MasterCard } from './api';
import { toRenderCard } from './cardView';
import { flattenBackgrounds } from './flattenBackgrounds';
import { logLine } from './log';

/** 書き出す横幅（px）。カードの基準は340pxなので約3倍の解像度になる */
const EXPORT_WIDTH = 1000;

// ---- 書体の埋め込み --------------------------------------------------------
//
// PNG にする時、カードは「独立した絵」として描き直されるので、画面で読み込み済みの
// 書体は使えない。書体のデータそのものを埋め込む必要がある。
// ただし Google Fonts の日本語は数百個に分割されていて、全部取りに行くと固まる。
// そこで **そのカードで実際に使っている文字を含む分割だけ**を選んで埋め込む。

/** 文字コードが unicode-range に含まれるか */
function rangeCovers(range: string, codes: Set<number>): boolean {
  for (const part of range.split(',')) {
    const t = part.trim().replace(/^U\+/i, '');
    const [fromRaw, toRaw] = t.split('-');
    // `4E00-9FFF` のほか `30??` のようなワイルドカード表記もある
    const from = parseInt(fromRaw.replace(/\?/g, '0'), 16);
    const to = parseInt((toRaw ?? fromRaw).replace(/\?/g, 'F'), 16);
    if (Number.isNaN(from)) continue;
    for (const c of codes) if (c >= from && c <= to) return true;
  }
  return false;
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('読み出し失敗'));
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 一度作ったら使い回す（毎回作ると重い） */
const fontCssCache = new Map<string, string>();

async function buildFontEmbedCss(node: HTMLElement): Promise<string> {
  const codes = new Set<number>();
  for (const ch of node.textContent ?? '') codes.add(ch.codePointAt(0) ?? 0);
  // 数字・英字は必ず要る（コスト・HP・カード番号）
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -.') codes.add(ch.codePointAt(0)!);

  const key = [...codes].sort((a, b) => a - b).join(',');
  const cached = fontCssCache.get(key);
  if (cached !== undefined) return cached;

  const hrefs = [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')]
    .map((l) => l.href)
    .filter((h) => h.includes('fonts.googleapis.com'));

  let out = '';
  let used = 0;
  let skipped = 0;
  for (const href of hrefs) {
    let css: string;
    try {
      css = await (await fetch(href)).text();
    } catch {
      logLine('Google Fonts の定義を取得できませんでした');
      continue;
    }
    for (const chunk of css.split('@font-face').slice(1)) {
      const end = chunk.indexOf('}');
      if (end < 0) continue;
      const rule = `@font-face${chunk.slice(0, end + 1)}`;
      const range = /unicode-range:\s*([^;]+);/.exec(rule)?.[1];
      if (range && !rangeCovers(range, codes)) { skipped++; continue; }
      const url = /url\((https:\/\/[^)]+)\)/.exec(rule)?.[1];
      if (!url) continue;
      const dataUri = await fetchAsDataUri(url);
      if (!dataUri) continue;
      out += `${rule.replace(url, dataUri)}\n`;
      used++;
    }
  }
  logLine(`書体の埋め込み: ${used}個（対象外 ${skipped}個）`);

  fontCssCache.set(key, out);
  return out;
}

/** 指定ミリ秒で必ず終わる待ち。1つでも終わらないものがあると書き出し全体が固まるため */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer = 0;
  const timeout = new Promise<null>((r) => {
    timer = window.setTimeout(() => { logLine(`（${label} は ${ms}ms で打ち切り）`); r(null); }, ms);
  });
  // 先に終わったら時計を止める（止めないと後から「打ち切り」がログに出て紛らわしい）
  return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/** フォントと画像の読み込みが終わるまで待つ（待たずに撮ると書体や絵が抜ける） */
async function waitForAssets(node: HTMLElement): Promise<void> {
  await withTimeout(document.fonts.ready, 4000, 'フォント待ち');
  logLine('フォント準備OK');

  const images = [...node.querySelectorAll('img')];
  const pending = images.filter((img) => !img.complete);
  logLine(`画像 ${images.length}枚（未完了 ${pending.length}枚）を待つ`);
  await withTimeout(
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ),
    8000,
    '画像待ち',
  );
  logLine('画像準備OK');

  // 背景画像（枠・キラ）の反映待ち。
  // requestAnimationFrame は使わない: 画面を見ていない時（スマホでアプリを切り替えた等）は
  // 発火せず、そこで永久に止まる。実際にこれで書き出しが固まった。
  await new Promise((r) => setTimeout(r, 80));
}

/** SVG のデータURLを、指定サイズの透過PNG（Blob）にする */
async function svgToPngBlob(svgDataUrl: string, width: number, height: number): Promise<Blob> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('書き出した絵を読み込めませんでした'));
    img.src = svgDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d が使えません');
  // 背景は塗らない＝角の外は透明のまま
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG に変換できませんでした');
  return blob;
}

/**
 * カード1枚を透過PNGのファイルにする（保存はしない）。
 * 画面には出さない場所に描いてから撮り、終わったら必ず片付ける。
 */
export async function buildCardPngFile(card: MasterCard): Promise<File> {
  logLine(`── PNG書き出し開始: ${card.id} ${card.name}`);
  const holder = document.createElement('div');
  // 画面外に置く。display:none だと大きさが出ず撮れないので、見えない位置に置く
  holder.style.cssText = 'position:fixed; left:-99999px; top:0; z-index:-1; background:transparent;';
  document.body.appendChild(holder);
  const root = createRoot(holder);

  try {
    root.render(<CardFrame card={toRenderCard(card)} width={EXPORT_WIDTH} />);
    // React が実際にDOMを作るのを待つ
    await new Promise((r) => setTimeout(r, 120));
    const node = holder.querySelector<HTMLElement>('.card-frame');
    if (!node) throw new Error('カードを描けませんでした');
    logLine('下描き完了');
    node.style.boxShadow = 'none'; // 透過PNGに影は入れない
    await waitForAssets(node);

    // iPhone は CSS の背景を画像化してくれないので、先に本物の <img> に置き換える
    await flattenBackgrounds(node);
    await waitForAssets(node); // 差し込んだ <img> の読み込みを待つ

    const rect = node.getBoundingClientRect();
    logLine(`書き出しサイズ: ${Math.round(rect.width)}x${Math.round(rect.height)}`);

    const fontStarted = Date.now();
    const fontCss = (await withTimeout(buildFontEmbedCss(node), 20000, '書体の準備')) ?? '';
    logLine(`書体の準備 ${Date.now() - fontStarted}ms（${Math.round(fontCss.length / 1024)}KB）`);
    const started = Date.now();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    // toPng ではなく toSvg を使う。toPng は内部で requestAnimationFrame を待つので
    // 画面を見ていない時に永久に止まる（実測で確認）。PNG化は自前でやる。
    const svgDataUrl = await toSvg(node, {
      backgroundColor: undefined,
      cacheBust: false,
      width,
      height,
      // 書体は必要な分だけ埋める（自動収集は Google Fonts の数百個の分割定義まで
      // 取りに行って重いので使わない）
      fontEmbedCSS: fontCss,
    });
    logLine(`下絵の作成 ${Date.now() - started}ms（${Math.round(svgDataUrl.length / 1024)}KB）`);

    const blob = await svgToPngBlob(svgDataUrl, width, height);
    const name = `${card.id}_${(card.name || 'card').replace(/[\\/:*?"<>|\s]/g, '')}.png`;
    logLine(`PNG書き出し成功（${width}x${height} / ${Math.round(blob.size / 1024)}KB）`);
    return new File([blob], name, { type: 'image/png' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logLine(`【失敗】PNG書き出し: ${message}`);
    throw new Error(message);
  } finally {
    root.unmount();
    holder.remove();
  }
}

// ---- 保存のしかた ----------------------------------------------------------
//
// ブラウザから「写真」アプリへ直接書き込むことはできない。
// スマホでは **共有シートに渡す**のが唯一の道で、そこで「画像を保存」を選ぶと写真に入る。
// PC には共有シートが無いので、その場合は普通のダウンロードにする。

/** この端末で共有シートにファイルを渡せるか */
export function canShareImage(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/**
 * 共有シートを開く。写真に保存するにはここから「画像を保存」を選んでもらう。
 * 戻り値: 共有シートを開けたか（利用者が取り消した場合も true）
 *
 * 注意: iPhone は「ボタンを押した直後」でないと共有シートを開けない。
 * 画像を作るのに数秒かかるので、**作り終えてから改めて押してもらう**作りにしている。
 */
export async function shareImageFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: file.name });
    logLine('共有シートを開いた');
    return true;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      logLine('共有は取り消された');
      return true; // 利用者が閉じただけ。失敗ではない
    }
    logLine(`共有シートを開けなかった: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`);
    return false;
  }
}

/** 普通のダウンロード（PC向け。スマホでは「ファイル」アプリに入る） */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // すぐ消すと保存が始まらない端末があるので少し置いてから解放する
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  logLine(`ファイルとして保存: ${file.name}`);
}

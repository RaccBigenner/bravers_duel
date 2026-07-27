/**
 * カードデザインを「背景透過PNG」で書き出す。
 *
 * 画面に見えているカードをそのまま撮ると小さくて粗いので、
 * 書き出し専用に大きいサイズ（`EXPORT_WIDTH`）でもう一枚描いてから撮る。
 * 角の外側は透過。カードの影（`box-shadow`）は書き出しでは邪魔なので消す。
 */
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { CardFrame } from '../../web/src/CardFrame';
import type { MasterCard } from './api';
import { toRenderCard } from './cardView';
import { flattenBackgrounds, inlineImages } from './flattenBackgrounds';
import { logLine } from './log';

/** 書き出す横幅（px）。カードの基準は340pxなので約3倍の解像度になる */
const EXPORT_WIDTH = 1000;

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

/**
 * キラの層は html2canvas が「重ね方（mix-blend-mode）」を再現できないので、
 * いったん外しておき、あとで自分で合成する。
 */
interface KiraPatch {
  src: string;
  /** カード左上を原点にした位置と大きさ */
  x: number;
  y: number;
  w: number;
  h: number;
  radius: string;
  opacity: number;
}

function detachKira(root: HTMLElement): { patches: KiraPatch[]; restore: () => void } {
  const rootRect = root.getBoundingClientRect();
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-kira]')];
  const patches: KiraPatch[] = [];
  const hidden: HTMLElement[] = [];

  for (const el of nodes) {
    const img = el.querySelector('img'); // 背景を <img> に変換済み
    const rect = el.getBoundingClientRect();
    if (img?.src) {
      patches.push({
        src: img.src,
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        w: rect.width,
        h: rect.height,
        radius: getComputedStyle(el).borderRadius,
        opacity: Number(getComputedStyle(el).opacity) || 1,
      });
    }
    el.style.display = 'none';
    hidden.push(el);
  }
  logLine(`キラの層: ${patches.length}件を別合成にする`);
  return { patches, restore: () => hidden.forEach((el) => (el.style.display = '')) };
}

/** キラを「ハードライト」で重ねる。canvas はこの合成方法に対応している */
async function compositeKira(canvas: HTMLCanvasElement, patches: KiraPatch[], scale: number): Promise<void> {
  if (!patches.length) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  for (const p of patches) {
    const img = new Image();
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = p.src;
    });
    if (!img.naturalWidth) continue;
    ctx.save();
    ctx.globalCompositeOperation = 'hard-light';
    ctx.globalAlpha = p.opacity;
    const x = p.x * scale;
    const y = p.y * scale;
    const w = p.w * scale;
    const h = p.h * scale;
    if (p.radius && p.radius !== '0px') {
      ctx.beginPath();
      const r = p.radius.includes('%') ? Math.min(w, h) / 2 : Math.min(parseFloat(p.radius) * scale, Math.min(w, h) / 2);
      ctx.roundRect(x, y, w, h, r);
      ctx.clip();
    }
    // 背景の cover と同じ入れ方にする
    const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * ratio;
    const dh = img.naturalHeight * ratio;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  logLine('キラを合成した');
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
    // 絵の中身も自前で埋め込む（ライブラリ任せだと失敗が黙殺され、書き出しで欠ける）
    await inlineImages(node);
    await waitForAssets(node); // 差し込んだ <img> の読み込みを待つ

    // 埋め込み漏れが無いか最後に確かめる。残っていたら書き出した絵で必ず欠ける
    const leftover = [...node.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:'));
    const leftoverBg = [node, ...node.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      return bg && bg !== 'none';
    });
    logLine(`埋め込み漏れ: 絵${leftover.length}件 / 背景${leftoverBg.length}件`);

    const rect = node.getBoundingClientRect();
    logLine(`書き出しサイズ: ${Math.round(rect.width)}x${Math.round(rect.height)}`);

    const started = Date.now();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    // **SVG経由（html-to-image）は iPhone で使えない。**
    // 実機のログで、素材の埋め込みが全部成功していても出来上がりが
    // 125KB（PCでは2700KB）＝ほぼ空っぽになることを確認した。
    // iOS Safari が foreignObject を絵に変換できないため。
    // canvas に直接描く html2canvas なら、その工程を通らないので端末を選ばない。
    const kira = detachKira(node);
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(node, {
        backgroundColor: null, // 角の外は透明のまま
        scale: 1, // すでに大きく描いてあるので拡大しない
        width,
        height,
        logging: false,
        useCORS: true,
        // すべてデータ化済みなので、読み込み待ちで固まらない
        imageTimeout: 15000,
      });
    } finally {
      kira.restore();
    }
    await compositeKira(canvas, kira.patches, 1);
    logLine(`絵の作成 ${Date.now() - started}ms（${canvas.width}x${canvas.height}）`);

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')).then((b) => {
      if (!b) throw new Error('PNG に変換できませんでした');
      return b;
    });
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

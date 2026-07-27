/**
 * カードを画像化する前に、**CSSの背景を本物の `<img>` に置き換える**。
 *
 * 理由: iPhone の Safari は、DOM を SVG に包んで画像化する時に
 * **CSS の背景（画像もグラデーションも）を一切描かない**。実機で書き出すと
 * 枠・カード絵・キラ・属性の丸が全部消え、`<img>` と文字だけが残った。
 * そこで書き出し用の複製に対して、背景を先に `<img>` へ変換しておく。
 *
 * ここで触るのは「書き出し用に画面外へ描いた複製」だけで、画面表示には影響しない。
 */
import { logLine } from './log';

/** 括弧の中のカンマは区切りとみなさずに分割する（rgb(1, 2, 3) を壊さないため） */
function splitTopLevel(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

interface Stop {
  color: string;
  /** 0〜1。省略時は等間隔に割り振る */
  at?: number;
}

function parseStops(items: string[]): Stop[] {
  const stops: Stop[] = items.map((item) => {
    const m = /^(.*?)\s+([\d.]+)%$/.exec(item);
    return m ? { color: m[1].trim(), at: parseFloat(m[2]) / 100 } : { color: item.trim() };
  });
  // 位置の無いものを等間隔にする
  const last = stops.length - 1;
  stops.forEach((s, i) => {
    if (s.at === undefined) s.at = last === 0 ? 0 : i / last;
  });
  return stops;
}

/** CSS のグラデーションを canvas に描いて data URL にする */
function gradientToDataUrl(css: string, width: number, height: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const linear = /^linear-gradient\((.*)\)$/s.exec(css);
  const radial = /^radial-gradient\((.*)\)$/s.exec(css);

  if (linear) {
    const args = splitTopLevel(linear[1]);
    let angle = 180; // 既定は上から下
    if (/^[-\d.]+deg$/.test(args[0])) angle = parseFloat(args.shift()!);
    const stops = parseStops(args);
    // CSSの角度は「上向きが0度・時計回り」。canvas の座標に直す
    const rad = ((angle - 90) * Math.PI) / 180;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const len = Math.abs(canvas.width * Math.cos(rad)) + Math.abs(canvas.height * Math.sin(rad));
    const g = ctx.createLinearGradient(
      cx - (Math.cos(rad) * len) / 2,
      cy - (Math.sin(rad) * len) / 2,
      cx + (Math.cos(rad) * len) / 2,
      cy + (Math.sin(rad) * len) / 2,
    );
    for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.at ?? 0)), s.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  if (radial) {
    const args = splitTopLevel(radial[1]);
    let cx = canvas.width / 2;
    let cy = canvas.height / 2;
    if (/circle|ellipse|at /.test(args[0])) {
      const at = /at\s+([\d.]+)%\s+([\d.]+)%/.exec(args.shift()!);
      if (at) {
        cx = (parseFloat(at[1]) / 100) * canvas.width;
        cy = (parseFloat(at[2]) / 100) * canvas.height;
      }
    }
    const stops = parseStops(args);
    // 既定は farthest-corner（一番遠い角まで）
    const radius = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(canvas.width - cx, cy),
      Math.hypot(cx, canvas.height - cy),
      Math.hypot(canvas.width - cx, canvas.height - cy),
    );
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.at ?? 0)), s.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  return null;
}

async function urlToDataUrl(url: string): Promise<string | null> {
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

/** background-size から object-fit を決める */
function objectFitFor(backgroundSize: string): string {
  if (backgroundSize.includes('cover')) return 'cover';
  if (backgroundSize.includes('contain')) return 'contain';
  if (/^\s*100%\s+100%\s*$/.test(backgroundSize)) return 'fill';
  return 'cover';
}

/**
 * 複製したカードの中の背景を、すべて `<img>` に置き換える。
 * 置き換えた `<img>` は一番後ろに入れるので、重なり順は変わらない。
 */
export async function flattenBackgrounds(root: HTMLElement): Promise<void> {
  const targets = [root, ...root.querySelectorAll<HTMLElement>('*')];
  let images = 0;
  let gradients = 0;
  let failed = 0;

  for (const el of targets) {
    const style = getComputedStyle(el);
    const bg = style.backgroundImage;
    if (!bg || bg === 'none') continue;

    // 1要素に複数の背景が重なっている場合もあるので全部たどる
    const layers = splitTopLevel(bg).reverse(); // CSSは先頭が手前。後ろから入れる
    for (const layer of layers) {
      let dataUrl: string | null = null;
      const urlMatch = /^url\(["']?(.+?)["']?\)$/s.exec(layer);
      if (urlMatch) {
        dataUrl = urlMatch[1].startsWith('data:') ? urlMatch[1] : await urlToDataUrl(urlMatch[1]);
        if (dataUrl) images++;
      } else if (layer.includes('gradient(')) {
        // 拡大表示ぶん粗くならないよう、実寸の3倍で焼く
        dataUrl = gradientToDataUrl(layer, (el.offsetWidth || 8) * 3, (el.offsetHeight || 8) * 3);
        if (dataUrl) gradients++;
      }
      if (!dataUrl) {
        failed++;
        continue;
      }

      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '';
      img.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        'width:100%',
        'height:100%',
        `object-fit:${objectFitFor(style.backgroundSize)}`,
        'object-position:center',
        `border-radius:${style.borderRadius}`,
        'pointer-events:none',
        // 背景なので中身より後ろに置く。
        // これが無いと「絶対配置は通常の要素より手前」の規則で、
        // 属性アイコンの絵が円の背景に隠れる（実際に起きた）。
        'z-index:-1',
      ].join(';');

      // 絶対配置の基準にするため、位置指定が無い要素だけ relative にする（見た目は変わらない）
      if (style.position === 'static') el.style.position = 'relative';
      // 後ろに置いた背景がこの要素の外まで抜けないよう、重なりをこの要素で閉じる
      el.style.isolation = 'isolate';
      el.insertBefore(img, el.firstChild);
    }

    el.style.backgroundImage = 'none';
  }

  logLine(`背景を画像に変換: 画像${images}件 / グラデーション${gradients}件${failed ? ` / 失敗${failed}件` : ''}`);
}

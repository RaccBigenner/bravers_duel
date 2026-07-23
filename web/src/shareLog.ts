/**
 * バトルログのシェア用エンコード。
 *
 * サーバーを持たないので、ログの要約をURLのハッシュ（#log=…）に埋め込む。
 * 圧縮は CompressionStream（deflate-raw）→ base64url。
 * 非対応ブラウザ用に無圧縮フォーマット（プレフィックス "0."）も読める。
 */

/** シェアされるバトルログの中身（キーはURL短縮のため1〜2文字） */
export interface SharedLog {
  v: 1;
  /** 自分/敵のデッキ名 */
  pd: string;
  ed: string;
  /** 勝者: p=プレイヤー e=敵 d=引き分け */
  w: 'p' | 'e' | 'd';
  /** 決着理由: wipeout | deckout | turnLimit */
  r: string;
  /** ターン数 */
  t: number;
  /** 両者のキャラクターのカードID */
  pc: string[];
  ec: string[];
  /** 両者の使用カード [カードID, 回数] */
  pu: [string, number][];
  eu: [string, number][];
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipeThrough(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  const out = blob.stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** ログ → "#log=" に入れるトークン */
export async function encodeSharedLog(log: SharedLog): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(log));
  try {
    const packed = await pipeThrough(raw, new CompressionStream('deflate-raw'));
    return `1.${toBase64Url(packed)}`;
  } catch {
    return `0.${toBase64Url(raw)}`;
  }
}

/** "#log=" のトークン → ログ（壊れていたら null） */
export async function decodeSharedLog(token: string): Promise<SharedLog | null> {
  try {
    const dot = token.indexOf('.');
    const kind = token.slice(0, dot);
    const bytes = fromBase64Url(token.slice(dot + 1));
    const raw = kind === '1' ? await pipeThrough(bytes, new DecompressionStream('deflate-raw')) : bytes;
    const log = JSON.parse(new TextDecoder().decode(raw)) as SharedLog;
    if (log.v !== 1 || typeof log.pd !== 'string' || typeof log.ed !== 'string') return null;
    return log;
  } catch {
    return null;
  }
}

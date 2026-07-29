/**
 * 管理画面 ↔ サーバーの通信。
 *
 * サーバーは2種類あるが、URL と返す形は同じにしてある:
 * - クラウド（本番）… Cloudflare Pages Functions（admin/functions/）。GitHub の2リポに読み書きする
 * - ローカル（開発）… vite.config.ts の masterApi プラグイン。data/ のファイルを直接読み書きする
 */
import type { CardStatus, PackType } from '@bravers/engine';
import { normalizeCardIdentity } from '../shared/cardIdentity';
import { logLine } from './log';

/** 保存形式のカード（type ごとにフィールドが違うので緩めに持つ） */
export interface MasterCard {
  /** ゲーム上「同じカード」を表す不変ID。再録では共有する */
  oracleId: string;
  /** 旧idからの仮補完。Oracleを明示決定するまで公開不可 */
  oracleIdProvisional?: true;
  /** 収録・レアリティ・絵柄の単位。画像や管理画面の主キーに使う */
  printingId: string;
  vol: number;
  code: string;
  rarity: string;
  name: string;
  type: 'character' | 'skill' | 'equipment' | 'field';
  effectText: string;
  flavorText: string;
  status?: CardStatus;
  // character
  size?: string;
  hp?: number;
  attribute?: string[];
  // skill
  costAp?: number;
  conditionAttribute?: string[];
  baseValue?: number;
  valueType?: string;
  // equipment
  addAttribute?: string[];
  /**
   * 弾の中での並び順（0 始まり）。制作中の弾を手で並べ替えるために持つ。
   * 無いカードは code 順として扱うので、古いデータもそのまま動く。
   */
  order?: number;
  [k: string]: unknown;
}

export interface MasterSet {
  vol: number;
  themeNo: number;
  themeName: string;
  themeSubtitle: string;
  packType: PackType;
  /** publishingは公開2リポジトリをまたぐ間だけ使う管理画面内部のロック状態 */
  status: CardStatus | 'publishing';
  /** 非公開Actionsの冪等公開キー。publishing中だけ存在し、公開側には出さない */
  publishOperationId?: string;
  releasedAt: string;
  codename?: string;
}

export interface Master {
  sets: MasterSet[];
  cards: MasterCard[];
  /** `{ printingId（拡張子なし）: 版番号 }`。画像の有無の判定と、URLの ?v= に使う */
  images: Record<string, string>;
  /** `{ vol文字列: private効果moduleのblob sha }`。最終実装検査はActionsで行う。 */
  effectModules: Record<string, string>;
  /** `{ vol文字列: private効果回帰testのblob sha }`。moduleと同じsnapshotで公開する。 */
  effectTests: Record<string, string>;
  /**
   * 公開・WIPを束ねる前のデータにあったprintingId重複。
   * cards自体は画面を壊さないよう重複排除されるため、公開前チェック用に別途返す。
   */
  duplicatePrintingIds?: string[];
  /** カードだけあって弾の情報が無い vol（＝迷子）。画面で警告を出す */
  orphanVols?: number[];
}

export async function fetchMaster(): Promise<Master> {
  const res = await fetch('/api/master');
  if (!res.ok) throw new Error(`master 取得失敗: ${res.status}`);
  const data = (await res.json()) as Master;
  // 古いFunctions/ローカルAPIへ接続しても旧idを画面内部へ持ち込まない。
  const cards = (data.cards ?? []).map((card) =>
    normalizeCardIdentity(card as unknown as Record<string, unknown>) as unknown as MasterCard
  );
  return {
    ...data,
    cards,
    images: data.images ?? {},
    effectModules: data.effectModules ?? {},
    effectTests: data.effectTests ?? {},
    duplicatePrintingIds: data.duplicatePrintingIds ?? [],
    orphanVols: data.orphanVols ?? [],
  };
}

/**
 * カード画像のURL。版番号を付けると中身が変わった時だけ取り直される
 * （付けないと一覧を開くたびに全枚数を取り直すことになり、スマホで重い）。
 */
export function imageUrl(printingId: string, rev?: string): string {
  return rev
    ? `/card_images/${encodeURIComponent(printingId)}.webp?v=${rev}`
    : `/card_images/${encodeURIComponent(printingId)}.webp`;
}

/** 種類ごとにしか使わない項目。ここに無い項目（両ID・名前・効果文など）は共通で常に残す */
const TYPE_ONLY_FIELDS: Record<MasterCard['type'], string[]> = {
  character: ['hp', 'size', 'attribute'],
  skill: ['costAp', 'conditionAttribute', 'baseValue', 'valueType'],
  equipment: ['addAttribute'],
  field: [],
};

/**
 * 別の種類でしか使わない項目を落とす。
 * 新規カードは「スキル・条件属性=斬」で始まるので、種類をキャラに変えても
 * `conditionAttribute: ['斬']` が残り続け、一覧に余計な斬が出ていた。
 * 保存の時点で必ず掃除する（知らない項目は消さないので、将来の項目追加も壊さない）。
 */
export function stripForType(card: MasterCard): MasterCard {
  const mine = new Set(TYPE_ONLY_FIELDS[card.type] ?? []);
  const out: MasterCard = { ...card };
  for (const [type, fields] of Object.entries(TYPE_ONLY_FIELDS)) {
    if (type === card.type) continue;
    for (const f of fields) if (!mine.has(f)) delete out[f];
  }
  return out;
}

export async function saveCard(
  card: MasterCard,
  original?: { printingId: string; vol: number },
): Promise<{ savedTo: string; movedImage: boolean; cleanupPending: boolean }> {
  const res = await fetch('/api/save-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card: stripForType(card),
      originalPrintingId: original?.printingId,
      originalVol: original?.vol,
    }),
  });
  if (!res.ok) throw new Error(`保存失敗: ${(await res.json()).error ?? res.status}`);
  return res.json();
}

/**
 * その弾のカードをまとめて保存する（並び替え・採番用）。
 * renames を渡すと画像も一緒に引っ越す。printingId が画像のファイル名なので、
 * 採番し直したのに画像を動かさないと絵が全部消える。
 */
export async function saveCards(
  vol: number,
  cards: MasterCard[],
  renames?: { from: string; to: string }[],
): Promise<{
  savedTo: string;
  saved: number;
  movedImages: number;
  cleanupPending: string[];
}> {
  const res = await fetch('/api/save-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vol, cards: cards.map(stripForType), renames }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`一括保存失敗: ${(body as { error?: string }).error ?? res.status}`);
  }
  return res.json();
}

export async function deleteCard(
  printingId: string,
  vol: number,
): Promise<{ cleanupPending: boolean }> {
  const res = await fetch('/api/delete-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printingId, vol }),
  });
  if (!res.ok) throw new Error(`削除失敗: ${res.status}`);
  return res.json();
}

export async function saveSet(set: MasterSet): Promise<void> {
  const res = await fetch('/api/save-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set }),
  });
  if (!res.ok) throw new Error(`弾の保存失敗: ${res.status}`);
}

export interface PublishResult {
  status: 'complete' | 'queued';
  cardCount: number;
  runUrl?: string;
}

interface PublishStatusResponse {
  status:
    | 'queued'
    | 'running'
    | 'cleanup_pending'
    | 'complete'
    | 'failed_unlocked'
    | 'failed_validation'
    | 'failed_retryable';
  retryable: boolean;
  runUrl?: string;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** 弾公開を非公開GitHub Actionsへ依頼し、ブラウザ側から完了まで追跡する。 */
export async function publishSet(vol: number): Promise<PublishResult> {
  const res = await fetch('/api/publish-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vol }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`公開失敗: ${(body as { error?: string }).error ?? res.status}`);
  }
  const started = (await res.json()) as {
    status: 'complete' | 'queued';
    requestId?: string;
    runId?: number;
    runUrl?: string;
    cardCount?: number;
  };
  if (started.status === 'complete') {
    return { status: 'complete', cardCount: started.cardCount ?? 0 };
  }
  if (!started.requestId || !started.runId) {
    throw new Error('公開処理の追跡IDを取得できませんでした');
  }

  logLine(`公開処理を開始: vol${vol} / Actions run ${started.runId}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(attempt < 4 ? 3_000 : 5_000);
    const query = new URLSearchParams({
      vol: String(vol),
      runId: String(started.runId),
      requestId: started.requestId,
    });
    const statusRes = await fetch(`/api/publish-status?${query}`);
    if (!statusRes.ok) {
      if (statusRes.status === 409) {
        throw new Error(
          '別の公開処理へ状態が進みました。管理画面を再読み込みして確認してください',
        );
      }
      logLine(`公開状態の確認を再試行: HTTP ${statusRes.status}`);
      continue;
    }
    const current = (await statusRes.json()) as PublishStatusResponse;
    if (current.status === 'complete') {
      return {
        status: 'complete',
        cardCount: started.cardCount ?? 0,
        runUrl: current.runUrl,
      };
    }
    if (
      current.status === 'cleanup_pending' ||
      current.status === 'failed_unlocked' ||
      current.status === 'failed_validation' ||
      current.status === 'failed_retryable'
    ) {
      const details = current.runUrl ? `\nActions: ${current.runUrl}` : '';
      throw new Error(
        current.status === 'failed_unlocked' ||
        current.status === 'failed_validation'
          ? `公開前処理が中断し、編集ロックを解除しました。内容とActions結果を確認して再実行してください${details}`
          : `公開処理の続きが必要です。同じボタンから安全に再実行できます${details}`,
      );
    }
  }
  return {
    status: 'queued',
    cardCount: started.cardCount ?? 0,
    runUrl: started.runUrl,
  };
}

// ---- 画像の変換（iPhone 対応） ------------------------------------------------

/**
 * 選んだ画像を「長辺 maxSide の webp」に変換して data URL で返す。
 *
 * iPhone で失敗していた原因への対策が2つ入っている:
 * 1. **読み込み**: HEIC など createImageBitmap が扱えない形式は `<img>` 経由で読み直す。
 * 2. **書き出し**: Safari は canvas から webp を書き出せない場合があり、黙って png を返す。
 *    そのまま送るとサーバーに「webp ではない」と弾かれるので、
 *    webp で出せたかを必ず確かめ、駄目なら webp エンコーダ（wasm）で変換する。
 *    エンコーダはこの分岐に入った時だけ読み込むので、普段の速度は変わらない。
 */
export async function fileToWebp(file: File, maxSide = 800): Promise<string> {
  let stage = '画像の読み込み';
  logLine(`── 画像アップロード開始: ${file.name || '名前なし'} / ${file.type || '種類不明'} / ${(file.size / 1024 / 1024).toFixed(2)}MB`);
  const { source, width, height, release } = await decodeImage(file).catch((e: unknown) => {
    throw new Error(`[${stage}] ${e instanceof Error ? e.message : String(e)}`);
  });
  try {
    stage = '縮小';
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d が使えません');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    logLine(`縮小: ${width}x${height} → ${canvas.width}x${canvas.height}`);

    // まずブラウザ標準の書き出しを試す（速い）。
    // iPhone の Safari は webp を頼まれると
    //   ・黙って png を返す
    //   ・そもそも例外を投げる（"The string did not match the expected pattern."）
    // のどちらかになる。**どちらの場合も下の保険へ回す**（例外を握りつぶすのが要点）。
    stage = 'webp への変換';
    let native: Blob | null = null;
    try {
      native = await canvasToBlob(canvas, 'image/webp', 0.9);
      logLine(`標準の webp 変換: ${native ? `${native.type} ${Math.round(native.size / 1024)}KB` : '結果なし'}`);
    } catch (e) {
      native = null;
      logLine(`標準の webp 変換は例外: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (native && native.type === 'image/webp') {
      stage = 'データの取り出し';
      const url = await blobToDataUrl(native);
      logLine(`標準の変換で成功（${Math.round(url.length / 1024)}KB の送信データ）`);
      return url;
    }

    // 標準で webp にできないブラウザ（iPhone）向けの保険。ここで初めて wasm を読み込む
    stage = 'webp への変換（保険）';
    logLine('保険の webp エンコーダ（wasm）を読み込む');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { default: encode } = await import('@jsquash/webp/encode');
    logLine('エンコーダ読み込み完了。変換開始');
    const buffer = await encode(imageData, { quality: 85 });
    logLine(`保険の変換で成功（${Math.round(buffer.byteLength / 1024)}KB）`);
    stage = 'データの取り出し';
    return await blobToDataUrl(new Blob([buffer], { type: 'image/webp' }));
  } catch (e) {
    // どの段階で転んだかを必ず残す（PCでは再現しない不具合を追えるように）
    const message = `[${stage}] ${e instanceof Error ? e.message : String(e)}`;
    logLine(`【失敗】${message}`);
    throw new Error(message);
  } finally {
    release();
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file);
    logLine(`読み込み成功（createImageBitmap）: ${bitmap.width}x${bitmap.height}`);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch (first) {
    logLine(`createImageBitmap は失敗: ${first instanceof Error ? first.message : String(first)} → <img> で読み直す`);
    // createImageBitmap が対応していない形式でも、<img> なら読めることがある（Safari の HEIC 等）
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise<void>((ok, ng) => {
        img.onload = () => ok();
        img.onerror = () => ng(new Error('この形式の画像は読み込めませんでした。写真アプリで「編集→完了」してから選ぶか、JPEGで保存して試してください'));
        img.src = url;
      });
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    logLine(`読み込み成功（<img>）: ${img.naturalWidth}x${img.naturalHeight}`);
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Blob → data URL。
 * 自前で base64 を組む（`String.fromCharCode(...bytes)` 方式）と、iPhone では
 * 引数の数がスタック上限を超えて必ず失敗する。FileReader なら中身の大きさに関係なく安全。
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('画像データの読み出しに失敗しました'));
    reader.readAsDataURL(blob);
  });
}

/** サーバー側の一時的な失敗（502等）は自動でやり直す回数 */
const SAVE_IMAGE_RETRIES = 2;

export async function saveImage(
  card: Pick<MasterCard, 'printingId' | 'vol' | 'status'>,
  dataUrl: string,
): Promise<{ savedTo: string }> {
  const body = JSON.stringify({
    printingId: card.printingId,
    vol: card.vol,
    status: card.status,
    dataUrl,
  });
  logLine(
    `サーバーへ送信: printingId=${card.printingId} vol=${card.vol} ` +
      `status=${card.status ?? '（弾に従う）'} ${Math.round(dataUrl.length / 1024)}KB`,
  );

  let lastMessage = '';
  for (let attempt = 0; attempt <= SAVE_IMAGE_RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = attempt * 1500;
      logLine(`${wait / 1000}秒待ってやり直します（${attempt}/${SAVE_IMAGE_RETRIES}回目）`);
      await new Promise((r) => setTimeout(r, wait));
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      lastMessage = `通信できませんでした: ${e instanceof Error ? e.message : String(e)}`;
      logLine(`通信エラー: ${lastMessage}`);
      continue; // 電波が切れた等。やり直す価値がある
    }

    const text = await res.text();
    logLine(`サーバー応答: ${res.status}（${Date.now() - started}ms） ${text.slice(0, 200)}`);

    if (res.ok) {
      logLine('画像の保存に成功');
      return JSON.parse(text) as { savedTo: string };
    }

    // JSON で返ってきていれば、その中の説明をそのまま使う
    let detail = '';
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? '';
    } catch {
      detail = '';
    }
    if (!detail) {
      // Cloudflare のエラーページ等。ステータスから状況を説明する
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        detail = `${res.status} サーバーが一時的に応答できませんでした`;
      } else if (res.status === 302 || res.status === 401 || res.status === 403) {
        detail = `${res.status} ログインし直しが必要です`;
      } else {
        detail = String(res.status);
      }
    }
    lastMessage = `画像保存失敗: ${detail}`;

    // 5xx だけやり直す（400番台は何度やっても同じ）
    if (res.status < 500) break;
  }

  logLine(`【失敗】${lastMessage}`);
  throw new Error(lastMessage);
}

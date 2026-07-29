/**
 * engine version と content manifest（カード・弾データの版）。
 *
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 10.5「コンテンツ公開」/ 11.4「決定論とリプレイ」
 *
 * 試合ごとに `engineVersion` / `contentVersion` / `formatVersionId` の3つを固定して記録し、
 * 進行中の試合とリプレイは開始時の版を参照し続ける（設計 10.5）。
 * 参照中の旧版はデプロイから削除しない。→ 保持方針は replay.ts の `REPLAY_RETENTION_POLICY`。
 *
 * ここでの hash は「版が同じか」を判定するための指紋であり、改ざん検知用ではない。
 * 公開物の完全性は、OLG-003 の公開パイプラインが Git blob SHA で担保している。
 * ブラウザとサーバーの両方で同じ値になる必要があるため、node:crypto は使わない。
 */
import { ALL_CARDS } from './cards';
import { RELEASED_SETS } from './sets';

/**
 * ルール実装の版。バトルの進行結果が変わる修正を入れたら必ず上げる。
 * 上げ忘れは golden replay テスト（test/replay.test.ts）が落として気づける。
 */
export const ENGINE_VERSION = '0.1.0';

/**
 * キーを並べ替えてJSONにする（同じ中身なら必ず同じ文字列になるように）。
 * `undefined` を持つキーは JSON.stringify と同じく落とす。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * FNV-1a 64bit を16桁の16進で返す。
 * 暗号学的強度は要らない（同一性の指紋なので）が、環境によらず同じ値になることは要る。
 */
export function fingerprint(text: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  // 文字ではなくUTF-8バイト列で回す（環境による文字コードの差を避ける）
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 中身から指紋を作る（キー順に依存しない） */
export function fingerprintOf(value: unknown): string {
  return fingerprint(stableStringify(value));
}

/**
 * 公開コンテンツの版。公開済みカードと公開済み弾が1文字でも変われば変わる。
 * 試合開始時にこの値を記録し、進行中はデータが差し替わっても参照し続ける。
 *
 * 制作中（draft・未公開弾）のカードは対象にしない。理由は2つある。
 * - 未公開データの指紋や枚数を公開ビルドへ載せないため（設計 10.5 の公開ゲートと同じ考え方）
 * - 制作中のカードを直しただけで、公開中の試合の版が変わってしまうのを防ぐため
 */
export interface ContentManifest {
  /** `c1-<指紋>` の形。`c1` は manifest の形式版 */
  contentVersion: string;
  /** 公開カード枚数（printing 単位） */
  cardCount: number;
  /** 公開カード種類数（oracle 単位） */
  oracleCount: number;
  /** 公開済みの弾の数 */
  setCount: number;
  cardsHash: string;
  setsHash: string;
}

/**
 * 不変の content manifest。
 * `Object.freeze` で凍らせているのは、試合が参照している版を後から書き換えられないようにするため。
 */
export const CONTENT_MANIFEST: Readonly<ContentManifest> = Object.freeze(
  (() => {
    // printing ID順に固定してから指紋を取る（データの並び順が変わっても版は変えない）
    const cards = [...ALL_CARDS].sort((a, b) => (a.printingId < b.printingId ? -1 : 1));
    const sets = [...RELEASED_SETS].sort((a, b) => a.vol - b.vol);
    const cardsHash = fingerprintOf(cards);
    const setsHash = fingerprintOf(sets);
    return {
      contentVersion: `c1-${fingerprint(`${cardsHash}:${setsHash}`)}`,
      cardCount: cards.length,
      oracleCount: new Set(cards.map((c) => c.oracleId)).size,
      setCount: sets.length,
      cardsHash,
      setsHash,
    };
  })(),
);

export const CONTENT_VERSION = CONTENT_MANIFEST.contentVersion;

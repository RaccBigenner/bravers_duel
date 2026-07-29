/**
 * 初回スターターの候補と、その中身の組み立て。
 * データ本体は data/starters.json。
 *
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 6.3「スターター」
 * - 中身を購入前にすべて表示する → `starterContents`
 * - 1個で合法デッキを作れる個体数を含める → `checkStarter`
 * - 初期は4種類程度、1アカウント最初の1個は無償
 *
 * 中身はスタンダードデッキ8種（sampleDecks.ts）から引く。カードの一覧を二重に持つと
 * 必ず片方が古くなるため、ここでは「どのプリセットを候補にするか」だけを持つ。
 *
 * 販売価格、`onboarding_bound`、所持個体の発行はサーバー側（P2 / OLG-202）の仕事で、
 * ここには持ち込まない。
 */
import rawStarters from '../../data/starters.json';
import { checkDeckLegality, type DeckLegality } from './deckLegality';
import { DEFAULT_FORMAT, type FormatDefinition } from './formats';
import { sampleArchetypeDecks } from './sampleDecks';
import type { DeckList } from './decks';

/** candidate = 社長の採決前。released = 実際に配れる */
export const STARTER_STATUSES = ['candidate', 'released'] as const;
export type StarterStatus = (typeof STARTER_STATUSES)[number];

export interface StarterDefinition {
  /** 例: `STARTER_SLASH` */
  starterId: string;
  /** 同じ starterId の中での版番号。1から増える */
  version: number;
  status: StarterStatus;
  /** 表示名の翻訳キー（設計 14.2） */
  nameKey: string;
  name: string;
  /** 攻め / 守り / 妨害 / 手数 など、選ぶときの手がかり */
  playstyle: string;
  /** 中学生でも分かる一言説明 */
  summary: string;
  /** 中身の元になるスタンダードデッキ名（sampleDecks.ts） */
  deckName: string;
}

/** スターター1個に入っているカード（printing ID と個体数） */
export interface StarterContentEntry {
  printingId: string;
  /** 何個体入っているか */
  count: number;
}

function failStarter(id: string, message: string): never {
  throw new Error(`スターターデータが不正です [${id}]: ${message}`);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** 1件のスターター定義を検証して読み込む */
export function validateStarter(raw: Record<string, unknown>): StarterDefinition {
  const id = `${String(raw.starterId ?? '(starterIdなし)')}@${String(raw.version ?? '?')}`;

  const starterId = raw.starterId;
  if (typeof starterId !== 'string' || !/^[A-Z0-9_]+$/.test(starterId)) {
    failStarter(id, 'starterId は大文字英数字とアンダースコアだけ');
  }
  if (!isPositiveInt(raw.version)) failStarter(id, 'version が正の整数ではない');
  if (!STARTER_STATUSES.includes(raw.status as never)) {
    failStarter(id, `未知の status: ${String(raw.status)}`);
  }
  for (const field of ['nameKey', 'name', 'playstyle', 'summary', 'deckName'] as const) {
    const value = raw[field];
    if (typeof value !== 'string' || value.trim() === '') failStarter(id, `${field} が空`);
  }

  return {
    starterId,
    version: raw.version as number,
    status: raw.status as StarterStatus,
    nameKey: raw.nameKey as string,
    name: raw.name as string,
    playstyle: raw.playstyle as string,
    summary: raw.summary as string,
    deckName: raw.deckName as string,
  };
}

export const ALL_STARTERS: StarterDefinition[] = (
  ((rawStarters as { starters?: unknown }).starters as Record<string, unknown>[]) ?? []
).map(validateStarter);

(() => {
  const seen = new Set<string>();
  for (const starter of ALL_STARTERS) {
    const key = `${starter.starterId}@${starter.version}`;
    if (seen.has(key)) throw new Error(`スターターの版が重複しています: ${key}`);
    seen.add(key);
  }
})();

/** そのスターターが配るデッキ（＝中身をそのまま組んだ形） */
export function starterDeck(starter: StarterDefinition): DeckList {
  const named = sampleArchetypeDecks().find((d) => d.name === starter.deckName);
  if (!named) {
    throw new Error(
      `スターター「${starter.name}」の元デッキが見つかりません: ${starter.deckName}`,
    );
  }
  return named.deck;
}

/**
 * 中身の一覧（購入前の全表示用）。printing ID の昇順。
 * キャラクター枠と40枚側の両方を合算した「個体数」で数える。
 * 同じカードを場と40枚側の両方で使うデッキは、その合計個体数が要る（設計 5.2 / OLG-001）。
 */
export function starterContents(starter: StarterDefinition): StarterContentEntry[] {
  const deck = starterDeck(starter);
  const counts = new Map<string, number>();
  for (const printingId of [...deck.characterIds, ...deck.cardIds]) {
    counts.set(printingId, (counts.get(printingId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([printingId, count]) => ({ printingId, count }))
    .sort((a, b) => (a.printingId < b.printingId ? -1 : 1));
}

/** スターター1個に入っている個体の総数 */
export function starterInstanceCount(starter: StarterDefinition): number {
  return starterContents(starter).reduce((sum, entry) => sum + entry.count, 0);
}

export interface StarterCheck {
  starterId: string;
  /** 中身だけで合法デッキを1つ作れるか */
  ok: boolean;
  legality: DeckLegality;
  /** 足りない個体（あれば） */
  missing: StarterContentEntry[];
}

/**
 * 「1個で合法デッキを作れる個体数を含める」（設計 6.3）を検査する。
 * 中身から組んだデッキがフォーマットで合法か、かつ必要な個体が全部そろっているかを見る。
 */
export function checkStarter(
  starter: StarterDefinition,
  format: FormatDefinition = DEFAULT_FORMAT,
): StarterCheck {
  const deck = starterDeck(starter);
  const legality = checkDeckLegality(deck, format);

  // 中身は同じデッキから作っているので、必要数を下回ることはない。
  // 将来スターターの中身を手書きへ変えたときに、ここが最初に落ちるようにしておく。
  const have = new Map(starterContents(starter).map((e) => [e.printingId, e.count]));
  const need = new Map<string, number>();
  for (const printingId of [...deck.characterIds, ...deck.cardIds]) {
    need.set(printingId, (need.get(printingId) ?? 0) + 1);
  }
  const missing: StarterContentEntry[] = [];
  for (const [printingId, count] of need) {
    const shortfall = count - (have.get(printingId) ?? 0);
    if (shortfall > 0) missing.push({ printingId, count: shortfall });
  }

  return { starterId: starter.starterId, ok: legality.legal && missing.length === 0, legality, missing };
}

/** 実際に配れるスターター（採決済み） */
export function releasedStarters(): StarterDefinition[] {
  return ALL_STARTERS.filter((s) => s.status === 'released');
}

/** 採決待ちの候補 */
export function candidateStarters(): StarterDefinition[] {
  return ALL_STARTERS.filter((s) => s.status === 'candidate');
}

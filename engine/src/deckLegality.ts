/**
 * 「このデッキは、このフォーマット版で合法か」を判定する純粋関数。
 *
 * ルールの正本は docs/GAME_RULES.md 4章、フォーマットの仕組みは
 * docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 4.5。
 *
 * 設計 4.5 は「デッキ保存時・キュー参加時・試合開始直前の3回検証する」と決めている。
 * 3か所で判定がずれると「保存できたのに試合が始まらない」が起きるので、
 * 入口を3つ用意したうえで中身は同じ `checkDeckLegality` へ必ず委譲する。
 * サーバー側でも管理画面でも同じ関数を呼べるよう、ここには I/O も現在時刻も持ち込まない。
 *
 * 同名判定とコピー上限は oracleId 基準（OLG-003の決定）。デッキが持つIDは printingId のまま。
 */
import { PUBLIC_CARD_CATALOG, type CardCatalog } from './cards';
import { DEFAULT_FORMAT, formatVersionId, type FormatDefinition } from './formats';
import { MAX_CHARACTERS } from './types';
import type { DeckList } from './decks';

export const DECK_VIOLATION_CODES = [
  /** カタログにない printingId */
  'CARD_NOT_FOUND',
  /** キャラクター枠の枚数が範囲外 */
  'CHARACTER_COUNT',
  /** キャラクター枠の合計が3枠ちょうどでない（大型は2枠） */
  'CHARACTER_SLOTS',
  /** キャラクター枠にキャラクター以外が入っている */
  'CHARACTER_CARD_TYPE',
  /** キャラクター枠に同名（同oracle）が2枚以上 */
  'CHARACTER_DUPLICATE',
  /** 40枚側の枚数違い */
  'DECK_SIZE',
  /** 40枚側の同名（同oracle）が上限超え */
  'MAX_COPIES',
  /** このフォーマットで使えない弾のカード */
  'SET_NOT_ALLOWED',
  /** このフォーマットの禁止カード */
  'BANNED_CARD',
] as const;
export type DeckViolationCode = (typeof DECK_VIOLATION_CODES)[number];

export interface DeckViolation {
  code: DeckViolationCode;
  /** プレイヤーへそのまま出せる日本語の理由 */
  message: string;
  /** 関係する printingId（あれば） */
  printingIds?: string[];
  /** 関係する oracleId（あれば） */
  oracleId?: string;
}

export interface DeckLegality {
  legal: boolean;
  formatId: string;
  formatVersion: number;
  /** `FREE_V1@1` の形。試合・リプレイへ記録する版の参照子 */
  formatVersionId: string;
  /** 空なら合法 */
  violations: DeckViolation[];
}

/** 検証を行う場面（設計 4.5）。判定内容は場面で変えない。記録・ログ用の区別 */
export const DECK_CHECK_PHASES = ['save', 'join', 'matchStart'] as const;
export type DeckCheckPhase = (typeof DECK_CHECK_PHASES)[number];

/** デッキがこのフォーマット版で合法かを判定する（唯一の判定本体） */
export function checkDeckLegality(
  deck: DeckList,
  format: FormatDefinition = DEFAULT_FORMAT,
  catalog: CardCatalog = PUBLIC_CARD_CATALOG,
): DeckLegality {
  const violations: DeckViolation[] = [];
  const add = (
    code: DeckViolationCode,
    message: string,
    extra: Omit<DeckViolation, 'code' | 'message'> = {},
  ) => {
    violations.push({ code, message, ...extra });
  };

  const cardOf = (printingId: string) => {
    try {
      return catalog.cardByPrintingId(printingId);
    } catch {
      return undefined;
    }
  };

  // --- キャラクター枠（EXACT_CAPACITY_3: 3枠ちょうど・大型は2枠・同名1枚まで）
  if (format.characterSlotPolicy === 'EXACT_CAPACITY_3') {
    if (deck.characterIds.length < 2 || deck.characterIds.length > MAX_CHARACTERS) {
      add(
        'CHARACTER_COUNT',
        `キャラクターは2〜${MAX_CHARACTERS}枚（今: ${deck.characterIds.length}枚）`,
      );
    }

    let slots = 0;
    for (const printingId of deck.characterIds) {
      const card = cardOf(printingId);
      if (card?.type === 'character') slots += card.size === 'legendaryLarge' ? 2 : 1;
    }
    if (slots !== MAX_CHARACTERS) {
      add(
        'CHARACTER_SLOTS',
        `キャラクター枠は${MAX_CHARACTERS}枠ちょうど（大型は2枠）。今: ${slots}枠`,
      );
    }
  }

  // --- 40枚側の枚数
  if (deck.cardIds.length !== format.deckSize) {
    add('DECK_SIZE', `デッキは${format.deckSize}枚（今: ${deck.cardIds.length}枚）`);
  }

  // --- カードが実在するか
  const allPrintingIds = [...deck.characterIds, ...deck.cardIds];
  for (const printingId of allPrintingIds) {
    if (!cardOf(printingId)) {
      add('CARD_NOT_FOUND', `存在しないカード: ${printingId}`, { printingIds: [printingId] });
    }
  }

  // --- キャラクター枠にキャラクター以外を入れていないか
  for (const printingId of deck.characterIds) {
    const card = cardOf(printingId);
    if (card && card.type !== 'character') {
      add('CHARACTER_CARD_TYPE', `キャラクター枠にキャラクター以外のカード: ${printingId}`, {
        printingIds: [printingId],
        oracleId: card.oracleId,
      });
    }
  }

  // --- キャラクター枠の同名（oracle基準。再録・別レアリティも同じカードとして数える）
  if (format.characterSlotPolicy === 'EXACT_CAPACITY_3') {
    for (const [oracleId, entry] of countByOracle(deck.characterIds, cardOf)) {
      if (entry.count > 1) {
        add(
          'CHARACTER_DUPLICATE',
          `キャラクター枠の同名カードは1枚まで: ${oracleId}（${entry.printingIds.join(', ')}）が${entry.count}枚`,
          { oracleId, printingIds: entry.printingIds },
        );
      }
    }
  }

  // --- 40枚側の同名上限。
  // MAIN_DECK_LIMIT_ONLY はキャラクター枠の1枚を合算しない（GAME_RULES 4章、2026-07-29 社長決定）。
  if (format.zoneCopyPolicy === 'MAIN_DECK_LIMIT_ONLY') {
    for (const [oracleId, entry] of countByOracle(deck.cardIds, cardOf)) {
      if (entry.count > format.maxCopies) {
        add(
          'MAX_COPIES',
          `40枚側の同名カードは${format.maxCopies}枚まで: ${oracleId}（${[...new Set(entry.printingIds)].join(', ')}）が${entry.count}枚`,
          { oracleId, printingIds: [...new Set(entry.printingIds)] },
        );
      }
    }
  }

  // --- 使える弾（EXPLICIT のときだけ。ALL は公開済みの全弾＝カタログ全部）
  if (format.setPolicy === 'EXPLICIT') {
    const allowed = new Set(format.allowedSetIds);
    const reported = new Set<string>();
    for (const printingId of allPrintingIds) {
      const card = cardOf(printingId);
      if (!card || allowed.has(card.vol) || reported.has(printingId)) continue;
      reported.add(printingId);
      add(
        'SET_NOT_ALLOWED',
        `${format.name}で使えない弾のカード: ${printingId}（第${card.vol}弾）`,
        { printingIds: [printingId], oracleId: card.oracleId },
      );
    }
  }

  // --- 禁止カード（oracle基準）
  if (format.bannedOracleIds.length > 0) {
    const banned = new Set(format.bannedOracleIds);
    const reported = new Set<string>();
    for (const printingId of allPrintingIds) {
      const card = cardOf(printingId);
      if (!card || !banned.has(card.oracleId) || reported.has(card.oracleId)) continue;
      reported.add(card.oracleId);
      add('BANNED_CARD', `${format.name}の禁止カード: ${card.name}（${card.oracleId}）`, {
        oracleId: card.oracleId,
        printingIds: [printingId],
      });
    }
  }

  return {
    legal: violations.length === 0,
    formatId: format.formatId,
    formatVersion: format.version,
    formatVersionId: formatVersionId(format),
    violations,
  };
}

function countByOracle(
  printingIds: readonly string[],
  cardOf: (printingId: string) => { oracleId: string } | undefined,
): Map<string, { count: number; printingIds: string[] }> {
  const counts = new Map<string, { count: number; printingIds: string[] }>();
  for (const printingId of printingIds) {
    const card = cardOf(printingId);
    if (!card) continue; // 存在しないカードは別の違反として報告済み
    const entry = counts.get(card.oracleId) ?? { count: 0, printingIds: [] };
    entry.count++;
    entry.printingIds.push(printingId);
    counts.set(card.oracleId, entry);
  }
  return counts;
}

/** 場面つきの検証入口。どの場面でも判定結果は完全に同じ */
export function checkDeckForPhase(
  _phase: DeckCheckPhase,
  deck: DeckList,
  format: FormatDefinition = DEFAULT_FORMAT,
  catalog: CardCatalog = PUBLIC_CARD_CATALOG,
): DeckLegality {
  return checkDeckLegality(deck, format, catalog);
}

/** デッキ保存時の検証 */
export function checkDeckForSave(
  deck: DeckList,
  format: FormatDefinition = DEFAULT_FORMAT,
  catalog: CardCatalog = PUBLIC_CARD_CATALOG,
): DeckLegality {
  return checkDeckForPhase('save', deck, format, catalog);
}

/** キュー・ルームへの参加時の検証 */
export function checkDeckForJoin(
  deck: DeckList,
  format: FormatDefinition = DEFAULT_FORMAT,
  catalog: CardCatalog = PUBLIC_CARD_CATALOG,
): DeckLegality {
  return checkDeckForPhase('join', deck, format, catalog);
}

/** 試合開始直前の検証 */
export function checkDeckForMatchStart(
  deck: DeckList,
  format: FormatDefinition = DEFAULT_FORMAT,
  catalog: CardCatalog = PUBLIC_CARD_CATALOG,
): DeckLegality {
  return checkDeckForPhase('matchStart', deck, format, catalog);
}

/** 違反理由をそのまま並べた一文にする（UI・例外メッセージ用） */
export function describeDeckViolations(legality: DeckLegality): string {
  return legality.violations.map((v) => v.message).join(' / ');
}

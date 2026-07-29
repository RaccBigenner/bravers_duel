/**
 * デッキ合法性判定のテスト。
 * ルールの正本: docs/GAME_RULES.md 4章
 * フォーマットの仕組み: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 4.5
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from '../src/battle';
import { ALL_CARDS, cardByPrintingId, createCardCatalog } from '../src/cards';
import {
  checkDeckForJoin,
  checkDeckForMatchStart,
  checkDeckForPhase,
  checkDeckForSave,
  checkDeckLegality,
  describeDeckViolations,
  DECK_CHECK_PHASES,
  type DeckViolationCode,
} from '../src/deckLegality';
import { deckProblems, formatForDeckRules, sampleDeck, type DeckList } from '../src/decks';
import { sampleArchetypeDecks } from '../src/sampleDecks';
import { DEFAULT_FORMAT, validateFormat, type FormatDefinition } from '../src/formats';
import type { Card, CharacterCard } from '../src/types';

const CHAR_LARGE = '1-A001-LSR'; // [集合知]アイ: legendaryLarge（2枠）
const CHAR_LARGE_2 = '1-A002-LSR'; // [邪竜王]ジエンド: legendaryLarge（2枠）
const CHAR_A = '1-A005-USR'; // オルス（普通・1枠）
const CHAR_B = '1-A011-SR'; // ストミー（普通・1枠）
const CHAR_C = '1-A019-R'; // ハスミール（普通・1枠）
const THREE_NORMAL = [CHAR_A, CHAR_B, CHAR_C];

/** 同名にならないスキルのprinting IDを並べたもの（40枚側の材料） */
const SKILL_IDS: string[] = (() => {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const card of ALL_CARDS) {
    if (card.type !== 'skill' || seen.has(card.oracleId)) continue;
    seen.add(card.oracleId);
    ids.push(card.printingId);
  }
  return ids;
})();

/** 同名が maxPerCard 枚を超えないように、size 枚の40枚側を作る */
function mainDeck(size: number, maxPerCard = 4): string[] {
  const ids: string[] = [];
  for (const id of SKILL_IDS) {
    for (let i = 0; i < maxPerCard && ids.length < size; i++) ids.push(id);
    if (ids.length >= size) break;
  }
  if (ids.length < size) throw new Error('テスト用のスキルカードが足りません');
  return ids;
}

function deck(characterIds: string[], cardIds: string[] = mainDeck(40)): DeckList {
  return { characterIds, cardIds };
}

function codes(deckList: DeckList, format?: FormatDefinition): DeckViolationCode[] {
  return checkDeckLegality(deckList, format).violations.map((v) => v.code);
}

function fakeReprint<T extends Card>(card: T, printingId: string): T {
  const match = printingId.match(/^(\d+)-([A-Z]\d+)-([A-Z]+)$/);
  if (!match) throw new Error(`テスト用printingIdが不正です: ${printingId}`);
  return {
    ...card,
    printingId,
    id: printingId,
    vol: Number(match[1]),
    code: match[2],
    rarity: match[3] as T['rarity'],
  };
}

describe('合法なデッキ', () => {
  it('普通キャラ3体＋40枚は合格', () => {
    const legality = checkDeckLegality(deck(THREE_NORMAL));
    expect(legality.violations).toEqual([]);
    expect(legality.legal).toBe(true);
  });

  it('合格時はどのフォーマット版で判定したかを返す', () => {
    const legality = checkDeckLegality(deck(THREE_NORMAL));
    expect(legality.formatId).toBe('FREE_V1');
    expect(legality.formatVersion).toBe(1);
    expect(legality.formatVersionId).toBe('FREE_V1@1');
  });

  it('大型1体＋普通1体（2+1=3枠）は合格', () => {
    expect(checkDeckLegality(deck([CHAR_LARGE, CHAR_A])).legal).toBe(true);
  });

  it('サンプルデッキとプリセット8種はすべて合格', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(checkDeckLegality(sampleDeck(seed)).legal, `seed=${seed}`).toBe(true);
    }
    for (const named of sampleArchetypeDecks()) {
      expect(checkDeckLegality(named.deck).legal, named.name).toBe(true);
    }
  });
});

describe('キャラクター枠（EXACT_CAPACITY_3）', () => {
  it('普通2体（2枠）は枠不足で不合格', () => {
    expect(codes(deck([CHAR_A, CHAR_B]))).toEqual(['CHARACTER_SLOTS']);
  });

  it('大型2体（4枠）は枠超過で不合格', () => {
    expect(codes(deck([CHAR_LARGE, CHAR_LARGE_2]))).toEqual(['CHARACTER_SLOTS']);
  });

  it('大型1体だけ（2枠）は枚数と枠の両方で不合格', () => {
    expect(codes(deck([CHAR_LARGE]))).toEqual(['CHARACTER_COUNT', 'CHARACTER_SLOTS']);
  });

  it('4体は枚数と枠の両方で不合格', () => {
    expect(codes(deck([CHAR_A, CHAR_B, CHAR_C, '1-A021-R']))).toEqual([
      'CHARACTER_COUNT',
      'CHARACTER_SLOTS',
    ]);
  });

  it('0体は枚数と枠の両方で不合格', () => {
    expect(codes(deck([]))).toEqual(['CHARACTER_COUNT', 'CHARACTER_SLOTS']);
  });

  it('境界値: 2体でも大型を含めば3枠ちょうどで合格、普通2体は不合格', () => {
    expect(checkDeckLegality(deck([CHAR_LARGE, CHAR_A])).legal).toBe(true);
    expect(checkDeckLegality(deck([CHAR_A, CHAR_B])).legal).toBe(false);
  });

  it('同名キャラクターは1枚まで（別printingでも同oracleなら不合格）', () => {
    const original = cardByPrintingId(CHAR_A) as CharacterCard;
    const reprint = fakeReprint(original, '99-Z998-C');
    const catalog = createCardCatalog([...ALL_CARDS, reprint]);
    const legality = checkDeckLegality(
      deck([CHAR_A, reprint.printingId, CHAR_B]),
      DEFAULT_FORMAT,
      catalog,
    );
    expect(legality.violations.map((v) => v.code)).toEqual(['CHARACTER_DUPLICATE']);
    expect(legality.violations[0].oracleId).toBe(original.oracleId);
    expect(legality.violations[0].printingIds).toEqual([CHAR_A, reprint.printingId]);
  });

  it('キャラクター枠にキャラクター以外を入れると不合格', () => {
    const skill = SKILL_IDS[0];
    const found = codes(deck([CHAR_A, CHAR_B, skill]));
    expect(found).toContain('CHARACTER_CARD_TYPE');
    // スキルは枠を埋めないので、枠不足も同時に出る
    expect(found).toContain('CHARACTER_SLOTS');
  });
});

describe('40枚側の枚数と同名上限', () => {
  it('境界値: 39枚と41枚は不合格、40枚ちょうどは合格', () => {
    expect(codes(deck(THREE_NORMAL, mainDeck(39)))).toEqual(['DECK_SIZE']);
    expect(codes(deck(THREE_NORMAL, mainDeck(41)))).toEqual(['DECK_SIZE']);
    expect(codes(deck(THREE_NORMAL, mainDeck(40)))).toEqual([]);
  });

  it('0枚は不合格', () => {
    expect(codes(deck(THREE_NORMAL, []))).toEqual(['DECK_SIZE']);
  });

  it('境界値: 同名4枚は合格、5枚は不合格', () => {
    const four = mainDeck(40); // 10種を4枚ずつ
    expect(four.filter((id) => id === SKILL_IDS[0])).toHaveLength(4);
    expect(codes(deck(THREE_NORMAL, four))).toEqual([]);

    const five = [...Array(5).fill(SKILL_IDS[0]), ...mainDeck(40).slice(5)];
    expect(five).toHaveLength(40);
    expect(five.filter((id) => id === SKILL_IDS[0])).toHaveLength(5);
    const legality = checkDeckLegality(deck(THREE_NORMAL, five));
    expect(legality.violations.map((v) => v.code)).toEqual(['MAX_COPIES']);
    expect(legality.violations[0].message).toContain('4枚まで');
  });

  it('再録を混ぜてもoracle合計で数える', () => {
    const original = cardByPrintingId(SKILL_IDS[0]);
    const reprint = fakeReprint(original, '99-Z999-C');
    const catalog = createCardCatalog([...ALL_CARDS, reprint]);
    const rest = mainDeck(40).filter(
      (printingId) => cardByPrintingId(printingId).oracleId !== original.oracleId,
    );
    const mixed = deck(THREE_NORMAL, [
      ...rest.slice(0, 35),
      ...Array(3).fill(SKILL_IDS[0]),
      ...Array(2).fill(reprint.printingId),
    ]);
    const legality = checkDeckLegality(mixed, DEFAULT_FORMAT, catalog);
    expect(legality.violations.map((v) => v.code)).toEqual(['MAX_COPIES']);
    // 報告するprinting IDは重複を畳む
    expect(legality.violations[0].printingIds).toEqual([SKILL_IDS[0], reprint.printingId]);
  });

  it('MAIN_DECK_LIMIT_ONLY: 場の1枚は40枚側の上限へ合算しない', () => {
    const character = cardByPrintingId(CHAR_A);
    const withFourInMain = [
      ...Array(4).fill(CHAR_A),
      ...mainDeck(40).filter((id) => cardByPrintingId(id).oracleId !== character.oracleId).slice(0, 36),
    ];
    expect(withFourInMain).toHaveLength(40);
    expect(codes(deck(THREE_NORMAL, withFourInMain))).toEqual([]);
  });
});

describe('存在しないカード', () => {
  it('40枚側とキャラクター枠の両方で報告する', () => {
    const legality = checkDeckLegality(
      deck([CHAR_A, CHAR_B, 'NOPE-CHAR'], [...mainDeck(39), 'NOPE-CARD']),
    );
    const notFound = legality.violations.filter((v) => v.code === 'CARD_NOT_FOUND');
    expect(notFound.map((v) => v.printingIds?.[0])).toEqual(['NOPE-CHAR', 'NOPE-CARD']);
  });

  it('同じ不正IDが複数枚あればその数だけ報告する', () => {
    const legality = checkDeckLegality(deck(THREE_NORMAL, [...mainDeck(38), 'NOPE', 'NOPE']));
    expect(legality.violations.filter((v) => v.code === 'CARD_NOT_FOUND')).toHaveLength(2);
  });
});

describe('フォーマット版の違いで判定が変わる', () => {
  const base = {
    formatId: 'TEST_F',
    nameKey: 'format.test.name',
    name: 'テスト',
    activeFrom: '2026-07-29',
    activeTo: null,
    setPolicy: 'ALL',
    latestN: null,
    allowedSetIds: [],
    bannedOracleIds: [],
    restrictedOracleIds: [],
    deckSize: 40,
    maxCopies: 4,
    characterSlotPolicy: 'EXACT_CAPACITY_3',
    zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
  };
  const v1 = validateFormat({ ...base, version: 1 });
  const v2 = validateFormat({ ...base, version: 2, deckSize: 30 });
  const v3 = validateFormat({ ...base, version: 3, maxCopies: 3 });

  it('同じデッキがv1では合格、deckSizeを変えたv2では不合格', () => {
    const forty = deck(THREE_NORMAL, mainDeck(40));
    expect(checkDeckLegality(forty, v1).legal).toBe(true);
    expect(codes(forty, v2)).toEqual(['DECK_SIZE']);
    expect(checkDeckLegality(forty, v2).violations[0].message).toContain('デッキは30枚');
  });

  /** 1種類だけ4枚、残りは3枚以下の40枚（v1では合格、v3では1件だけ違反） */
  const oneCardAtFour = deck(THREE_NORMAL, [
    ...Array(4).fill(SKILL_IDS[0]),
    ...mainDeck(40, 3)
      .filter((id) => id !== SKILL_IDS[0])
      .slice(0, 36),
  ]);

  it('同じデッキがv1では合格、maxCopiesを下げたv3では不合格', () => {
    expect(oneCardAtFour.cardIds).toHaveLength(40);
    expect(checkDeckLegality(oneCardAtFour, v1).legal).toBe(true);
    expect(codes(oneCardAtFour, v3)).toEqual(['MAX_COPIES']);
    expect(checkDeckLegality(oneCardAtFour, v3).violations[0].message).toContain('3枚まで');
  });

  it('判定結果には使った版が入る', () => {
    expect(checkDeckLegality(deck(THREE_NORMAL), v2).formatVersionId).toBe('TEST_F@2');
    expect(checkDeckLegality(deck(THREE_NORMAL), v3).formatVersion).toBe(3);
  });

  it('境界値: v3（同名3枚まで）は3枚合格・4枚不合格', () => { // stale-ok: 公式ルールではなく架空フォーマットv3の上限
    const three = deck(THREE_NORMAL, mainDeck(40, 3));
    expect(checkDeckLegality(three, v3).legal).toBe(true);
    expect(codes(oneCardAtFour, v3)).toEqual(['MAX_COPIES']);
  });
});

describe('使える弾（setPolicy）', () => {
  const explicit = (allowedSetIds: number[]) =>
    validateFormat({
      formatId: 'CUP_2026',
      version: 1,
      nameKey: 'format.cup.name',
      name: '大会2026',
      activeFrom: '2026-07-29',
      activeTo: null,
      setPolicy: 'EXPLICIT',
      latestN: null,
      allowedSetIds,
      bannedOracleIds: [],
      restrictedOracleIds: [],
      deckSize: 40,
      maxCopies: 4,
      characterSlotPolicy: 'EXACT_CAPACITY_3',
      zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
    });

  it('ALL は弾を絞らない', () => {
    expect(checkDeckLegality(deck(THREE_NORMAL), DEFAULT_FORMAT).legal).toBe(true);
  });

  it('EXPLICITで第1弾を許可すれば合格', () => {
    expect(checkDeckLegality(deck(THREE_NORMAL), explicit([1])).legal).toBe(true);
  });

  it('EXPLICITで第1弾を外すと使えない弾として不合格', () => {
    const legality = checkDeckLegality(deck(THREE_NORMAL), explicit([2]));
    const notAllowed = legality.violations.filter((v) => v.code === 'SET_NOT_ALLOWED');
    expect(notAllowed.length).toBeGreaterThan(0);
    expect(notAllowed[0].message).toContain('第1弾');
    // 同じprinting IDは何枚入っていても1回だけ報告する
    const reported = notAllowed.map((v) => v.printingIds?.[0]);
    expect(new Set(reported).size).toBe(reported.length);
  });
});

describe('禁止カード', () => {
  const banned = (bannedOracleIds: string[]) =>
    validateFormat({
      formatId: 'CUP_2026',
      version: 2,
      nameKey: 'format.cup.name',
      name: '大会2026',
      activeFrom: '2026-07-29',
      activeTo: null,
      setPolicy: 'ALL',
      latestN: null,
      allowedSetIds: [],
      bannedOracleIds,
      restrictedOracleIds: [],
      deckSize: 40,
      maxCopies: 4,
      characterSlotPolicy: 'EXACT_CAPACITY_3',
      zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
    });

  it('禁止oracleを含むと不合格', () => {
    const oracleId = cardByPrintingId(SKILL_IDS[0]).oracleId;
    const legality = checkDeckLegality(deck(THREE_NORMAL), banned([oracleId]));
    const hits = legality.violations.filter((v) => v.code === 'BANNED_CARD');
    expect(hits).toHaveLength(1); // 4枚入っていても1件
    expect(hits[0].oracleId).toBe(oracleId);
  });

  it('キャラクター枠の禁止カードも見る', () => {
    const oracleId = cardByPrintingId(CHAR_A).oracleId;
    const legality = checkDeckLegality(deck(THREE_NORMAL), banned([oracleId]));
    expect(legality.violations.map((v) => v.code)).toEqual(['BANNED_CARD']);
  });

  it('禁止カードを含まなければ合格', () => {
    expect(checkDeckLegality(deck(THREE_NORMAL), banned(['9-Z999'])).legal).toBe(true);
  });
});

describe('検証する場面（保存時・参加時・試合開始前）', () => {
  const legal = deck(THREE_NORMAL);
  const illegal = deck([CHAR_A, CHAR_B]);

  it('3つの入口はどれも同じ判定を返す', () => {
    expect(checkDeckForSave(legal)).toEqual(checkDeckLegality(legal));
    expect(checkDeckForJoin(legal)).toEqual(checkDeckLegality(legal));
    expect(checkDeckForMatchStart(legal)).toEqual(checkDeckLegality(legal));
    expect(checkDeckForSave(illegal)).toEqual(checkDeckForMatchStart(illegal));
    expect(checkDeckForJoin(illegal)).toEqual(checkDeckForMatchStart(illegal));
  });

  it('場面を指定しても判定は変わらない', () => {
    for (const phase of DECK_CHECK_PHASES) {
      expect(checkDeckForPhase(phase, illegal)).toEqual(checkDeckLegality(illegal));
    }
  });

  it('3つの入口ともフォーマット版を受け取れる', () => {
    const v2 = validateFormat({
      formatId: 'TEST_F',
      version: 2,
      nameKey: 'format.test.name',
      name: 'テスト',
      activeFrom: '2026-07-29',
      activeTo: null,
      setPolicy: 'ALL',
      latestN: null,
      allowedSetIds: [],
      bannedOracleIds: [],
      restrictedOracleIds: [],
      deckSize: 30,
      maxCopies: 4,
      characterSlotPolicy: 'EXACT_CAPACITY_3',
      zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
    });
    expect(checkDeckForSave(legal, v2).legal).toBe(false);
    expect(checkDeckForJoin(legal, v2).formatVersionId).toBe('TEST_F@2');
    expect(checkDeckForMatchStart(legal, v2).formatVersionId).toBe('TEST_F@2');
  });

  it('違反理由を1行にまとめられる', () => {
    expect(describeDeckViolations(checkDeckLegality(legal))).toBe('');
    expect(describeDeckViolations(checkDeckLegality(illegal))).toContain('3枠ちょうど');
    const two = checkDeckLegality(deck([CHAR_LARGE]));
    expect(describeDeckViolations(two).split(' / ')).toHaveLength(2);
  });
});

describe('既存の入口との互換', () => {
  it('deckProblemsは合法性判定の日本語メッセージをそのまま返す', () => {
    for (const deckList of [deck(THREE_NORMAL), deck([CHAR_A, CHAR_B]), sampleDeck(3)]) {
      expect(deckProblems(deckList)).toEqual(
        checkDeckLegality(deckList).violations.map((v) => v.message),
      );
    }
  });

  it('formatForDeckRulesは既定ルールならFREE_V1をそのまま使う', () => {
    expect(formatForDeckRules()).toBe(DEFAULT_FORMAT);
    expect(formatForDeckRules({ deckSize: 40, maxCopies: 4 })).toBe(DEFAULT_FORMAT);
  });

  it('formatForDeckRulesは実験用ルールだけを上書きし、版は変えない', () => {
    const format = formatForDeckRules({ deckSize: 30, maxCopies: 2 });
    expect(format.deckSize).toBe(30);
    expect(format.maxCopies).toBe(2);
    expect(format.formatId).toBe(DEFAULT_FORMAT.formatId);
    expect(format.version).toBe(DEFAULT_FORMAT.version);
    expect(format.characterSlotPolicy).toBe('EXACT_CAPACITY_3');
    expect(DEFAULT_FORMAT.deckSize).toBe(40); // 既定フォーマットを壊さない
  });

  it('実験用ルールでの判定はdeckProblemsと一致する', () => {
    const rules = { deckSize: 30, maxCopies: 2 };
    const small = deck(THREE_NORMAL, mainDeck(30, 2));
    expect(deckProblems(small, rules)).toEqual([]);
    expect(deckProblems(small)).not.toEqual([]);
  });
});

describe('試合開始直前の検証', () => {
  const legalDecks: [DeckList, DeckList] = [sampleDeck(1), sampleDeck(2)];

  it('合法なデッキなら試合を作れる', () => {
    expect(() => createBattle(legalDecks, 42)).not.toThrow();
  });

  it('非合法なデッキは試合開始時にはじく', () => {
    const broken: [DeckList, DeckList] = [
      { ...legalDecks[0], cardIds: legalDecks[0].cardIds.slice(1) },
      legalDecks[1],
    ];
    expect(() => createBattle(broken, 42)).toThrow(/プレイヤー1のデッキが不正です/);
  });

  it('フォーマット版を渡すとその版で検証する', () => {
    const thirty = validateFormat({
      formatId: 'TEST_F',
      version: 5,
      nameKey: 'format.test.name',
      name: 'テスト',
      activeFrom: '2026-07-29',
      activeTo: null,
      setPolicy: 'ALL',
      latestN: null,
      allowedSetIds: [],
      bannedOracleIds: [],
      restrictedOracleIds: [],
      deckSize: 30,
      maxCopies: 4,
      characterSlotPolicy: 'EXACT_CAPACITY_3',
      zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
    });
    expect(() => createBattle(legalDecks, 42, { format: thirty })).toThrow(/デッキは30枚/);
    const thirtyCardDecks: [DeckList, DeckList] = [
      deck(THREE_NORMAL, mainDeck(30)),
      deck(THREE_NORMAL, mainDeck(30)),
    ];
    expect(() => createBattle(thirtyCardDecks, 42, { format: thirty })).not.toThrow();
  });

  it('validate:false なら検証しない（既存の挙動）', () => {
    const broken: [DeckList, DeckList] = [deck([CHAR_A], mainDeck(20)), deck([CHAR_B], mainDeck(20))];
    expect(() => createBattle(broken, 42, { validate: false })).not.toThrow();
  });
});

/**
 * golden deck（スタンダードデッキ8種）とスターター候補のテスト。
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 6.3、docs/GAME_RULES.md 4章
 */
import { describe, expect, it } from 'vitest';
import { cardByPrintingId } from '../src/cards';
import { checkDeckLegality } from '../src/deckLegality';
import { DEFAULT_FORMAT, formatVersionId } from '../src/formats';
import { sampleArchetypeDecks } from '../src/sampleDecks';
import {
  ALL_STARTERS,
  candidateStarters,
  checkStarter,
  releasedStarters,
  starterContents,
  starterDeck,
  starterInstanceCount,
  validateStarter,
} from '../src/starters';
import { CONTENT_MANIFEST } from '../src/versions';
import goldenDecksJson from './golden/decks.json';

const golden = goldenDecksJson as {
  contentVersion: string;
  formatVersionId: string;
  decks: { name: string; concept: string; characterIds: string[]; cardIds: string[] }[];
};

describe('golden deck（スタンダードデッキ8種）', () => {
  const presets = sampleArchetypeDecks();

  it('8種そろっている', () => {
    expect(golden.decks).toHaveLength(8);
    expect(presets).toHaveLength(8);
  });

  it('今のプリセットと中身が1枚も違わない（崩れたら golden:decks で作り直す）', () => {
    // ここが落ちたらプリセットを変えたということ。
    // 変更が意図したものか確かめ、`npm --workspace engine run golden:decks` で作り直す。
    const current = presets.map((d) => ({
      name: d.name,
      concept: d.concept,
      characterIds: d.deck.characterIds,
      cardIds: d.deck.cardIds,
    }));
    expect(current).toEqual(golden.decks);
  });

  it('固定した版と今の版が一致する', () => {
    expect(golden.formatVersionId).toBe(formatVersionId(DEFAULT_FORMAT));
    expect(golden.contentVersion).toBe(CONTENT_MANIFEST.contentVersion);
  });

  it('8種すべてが FREE_V1@1 で合法', () => {
    for (const named of presets) {
      const legality = checkDeckLegality(named.deck, DEFAULT_FORMAT);
      expect(legality.violations, named.name).toEqual([]);
    }
  });

  it('名前とコンセプトが重複しない', () => {
    expect(new Set(presets.map((d) => d.name)).size).toBe(presets.length);
    expect(new Set(presets.map((d) => d.concept)).size).toBe(presets.length);
  });

  it('全カードが公開カタログに存在する', () => {
    for (const deck of golden.decks) {
      for (const printingId of [...deck.characterIds, ...deck.cardIds]) {
        expect(() => cardByPrintingId(printingId), `${deck.name} / ${printingId}`).not.toThrow();
      }
    }
  });

  it('キャラクター枠は3枠ちょうど（大型は2枠）', () => {
    for (const deck of golden.decks) {
      const slots = deck.characterIds.reduce((sum, id) => {
        const card = cardByPrintingId(id);
        return sum + (card.type === 'character' && card.size === 'legendaryLarge' ? 2 : 1);
      }, 0);
      expect(slots, deck.name).toBe(3);
    }
  });
});

describe('スターター候補', () => {
  it('設計6.3どおり4種類ある', () => {
    expect(ALL_STARTERS).toHaveLength(4);
  });

  it('採決前なので全部 candidate（released はまだ無い）', () => {
    expect(candidateStarters()).toHaveLength(4);
    expect(releasedStarters()).toEqual([]);
  });

  it('starterIdと表示項目がそろっている', () => {
    for (const starter of ALL_STARTERS) {
      expect(starter.starterId).toMatch(/^[A-Z0-9_]+$/);
      expect(starter.version).toBeGreaterThan(0);
      expect(starter.nameKey).toMatch(/^starter\./);
      expect(starter.name.length).toBeGreaterThan(0);
      expect(starter.playstyle.length).toBeGreaterThan(0);
      expect(starter.summary.length).toBeGreaterThan(0);
    }
  });

  it('starterIdが重複しない', () => {
    expect(new Set(ALL_STARTERS.map((s) => s.starterId)).size).toBe(ALL_STARTERS.length);
  });

  it('遊び方が4種類とも違う（選ぶ理由が分かる）', () => {
    expect(new Set(ALL_STARTERS.map((s) => s.playstyle)).size).toBe(ALL_STARTERS.length);
  });

  it('元にするプリセットが実在し、重複しない', () => {
    const names = sampleArchetypeDecks().map((d) => d.name);
    for (const starter of ALL_STARTERS) {
      expect(names, starter.starterId).toContain(starter.deckName);
    }
    expect(new Set(ALL_STARTERS.map((s) => s.deckName)).size).toBe(ALL_STARTERS.length);
  });

  it('1個で合法デッキを作れる個体数を含む（設計6.3）', () => {
    // check.missing は中身をstarterDeck自身から組んでいるので構造的に必ず[]になる
    // （手書きの中身に変えたときに壊れる担保はvalidateStarter/starterContents側の仕事）。
    // ここで実際に効いているのは legality（フォーマット合法性）だけ。
    for (const starter of ALL_STARTERS) {
      const check = checkStarter(starter);
      expect(check.legality.violations, starter.name).toEqual([]);
      expect(check.ok, starter.name).toBe(true);
    }
  });

  it('中身は43個体（キャラ枠3＋40枚側40）で、購入前に全部出せる', () => {
    for (const starter of ALL_STARTERS) {
      const deck = starterDeck(starter);
      expect(deck.characterIds.length, starter.name).toBe(3);
      expect(deck.cardIds.length, starter.name).toBe(40);
      expect(starterInstanceCount(starter), starter.name).toBe(43);

      const contents = starterContents(starter);
      expect(contents.length).toBeGreaterThan(0);
      // printing ID順に並んでいる（表示順を毎回同じにするため）
      const ids = contents.map((c) => c.printingId);
      expect([...ids].sort()).toEqual(ids);
      for (const entry of contents) {
        expect(entry.count).toBeGreaterThan(0);
        expect(() => cardByPrintingId(entry.printingId)).not.toThrow();
      }
    }
  });

  it('同じカードを場と40枚側で使う分も個体数に含める', () => {
    for (const starter of ALL_STARTERS) {
      const deck = starterDeck(starter);
      const contents = new Map(starterContents(starter).map((c) => [c.printingId, c.count]));
      for (const printingId of deck.characterIds) {
        const inMain = deck.cardIds.filter((id) => id === printingId).length;
        expect(contents.get(printingId), `${starter.name} / ${printingId}`).toBe(1 + inMain);
      }
    }
  });

  it('初心者向けに大型キャラクター（2枠）を使わない', () => {
    for (const starter of ALL_STARTERS) {
      for (const id of starterDeck(starter).characterIds) {
        const card = cardByPrintingId(id);
        expect(card.type === 'character' && card.size === 'legendaryLarge', starter.name).toBe(
          false,
        );
      }
    }
  });
});

describe('validateStarter', () => {
  const base = {
    starterId: 'STARTER_TEST',
    version: 1,
    status: 'candidate',
    nameKey: 'starter.test.name',
    name: 'テスト',
    playstyle: '攻め',
    summary: '説明',
    deckName: '剣聖の一閃',
  };

  it('正しい定義は読める', () => {
    expect(validateStarter({ ...base }).starterId).toBe('STARTER_TEST');
  });

  it('壊れた項目は読み込み時に落ちる', () => {
    expect(() => validateStarter({ ...base, starterId: 'starter_test' })).toThrow(/starterId/);
    expect(() => validateStarter({ ...base, version: 0 })).toThrow(/version/);
    expect(() => validateStarter({ ...base, status: 'sold' })).toThrow(/未知の status/);
    expect(() => validateStarter({ ...base, name: ' ' })).toThrow(/name が空/);
    expect(() => validateStarter({ ...base, deckName: '' })).toThrow(/deckName が空/);
  });

  it('存在しないプリセットを指すと、中身を出すときに落ちる', () => {
    const broken = validateStarter({ ...base, deckName: '無いデッキ' });
    expect(() => starterDeck(broken)).toThrow(/元デッキが見つかりません/);
  });
});

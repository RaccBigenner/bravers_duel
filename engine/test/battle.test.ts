import { describe, expect, it } from 'vitest';
import { randomAi, simpleAi } from '../src/ai';
import {
  actingPlayer,
  applyAction,
  canPlaySkill,
  createBattle,
  legalActions,
  type BattleState,
  type PlayerIndex,
} from '../src/battle';
import { cardById } from '../src/cards';
import { containsAll, deckProblems, sampleDeck, type DeckList } from '../src/decks';
import { runBattle } from '../src/runner';
import type { SkillCard } from '../src/types';

// 基本ルールの検証には「効果を持たないバニラカード」を固定で使う（結果が読めるように）
const ATK = '1-A129-C'; // ファストスタブ: attack cost1 base4 条件[突]
const GUARD = '1-A124-C'; // サークルパリィ: guard cost1 base4 条件[突]
const HEAL = '1-A130-C'; // グレイス: heal cost1 base4 条件[聖]
const CHAR_A = '1-A005-USR'; // オルス: 斬突打 HP13（効果なし）
const CHAR_B = '1-A011-SR'; // ストミー: 突突飛 HP11（効果なし）
const CHAR_C = '1-A019-R'; // ハスミール: 聖聖聖 HP6（効果なし）
const CHAR_D = '1-A021-R'; // ダダ･ダ･ダ: 雷氷土 HP11（効果なし）
const CHAR_E = '1-A022-R'; // オウー: 飛風獣 HP10（効果なし）

interface Side {
  chars: string[];
  deckCard: string;
}

function makeBattle(p0: Side, p1: Side): BattleState {
  const decks: [DeckList, DeckList] = [
    { characterIds: p0.chars, cardIds: Array(20).fill(p0.deckCard) },
    { characterIds: p1.chars, cardIds: Array(20).fill(p1.deckCard) },
  ];
  return createBattle(decks, 42, { firstPlayer: 0, validate: false });
}

function giveAp(state: BattleState, player: PlayerIndex, count: number, cardId: string) {
  state.players[player].ap.push(...Array(count).fill(cardId));
}

const atkCard = cardById(ATK) as SkillCard;
const guardCard = cardById(GUARD) as SkillCard;

describe('デッキのルール', () => {
  it('サンプルデッキはルールに合格する', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(deckProblems(sampleDeck(seed))).toEqual([]);
    }
  });

  it('枚数違い・同名4枚は不合格', () => {
    const deck = sampleDeck(1);
    expect(deckProblems({ ...deck, cardIds: deck.cardIds.slice(1) })).not.toEqual([]);
    const fourCopies = [...deck.cardIds.slice(4), deck.cardIds[0], deck.cardIds[0], deck.cardIds[0], deck.cardIds[0]];
    expect(deckProblems({ ...deck, cardIds: fourCopies }).join('')).toContain('3枚まで');
  });

  it('属性の多重集合チェック', () => {
    expect(containsAll(['闇', '闇'], ['闇', '闇'])).toBe(true);
    expect(containsAll(['闇'], ['闇', '闇'])).toBe(false);
    expect(containsAll(['斬', '聖', '雷'], ['聖'])).toBe(true);
    expect(containsAll(['斬'], [])).toBe(true);
  });
});

describe('バトルの準備', () => {
  it('手札5枚・後攻はAP2枚チャージ済みで始まる', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    expect(state.players[0].hand).toHaveLength(5);
    expect(state.players[1].hand).toHaveLength(5);
    expect(state.players[0].ap).toHaveLength(0);
    expect(state.players[1].ap).toHaveLength(2); // 後攻の補償
    expect(state.players[0].deck).toHaveLength(15);
    expect(state.players[1].deck).toHaveLength(13);
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('play');
    expect(state.players[0].actorIndex).toBe(0);
  });
});

describe('スキルのプレイ', () => {
  it('APが足りないと使えない', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    expect(canPlaySkill(state, 0, atkCard)).toBe(false);
    giveAp(state, 0, atkCard.costAp, ATK);
    expect(canPlaySkill(state, 0, atkCard)).toBe(true);
  });

  it('属性条件が合わないと使えない', () => {
    // ハスミール（聖聖聖）は突スキルを使えない
    const state = makeBattle({ chars: [CHAR_C], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    giveAp(state, 0, 5, ATK);
    expect(canPlaySkill(state, 0, atkCard)).toBe(false);
  });

  it('攻撃: 敵アクターにダメージ、コストとカードはトラッシュへ、アクター交代', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    giveAp(state, 0, atkCard.costAp, ATK);

    applyAction(state, { type: 'playSkill', handIndex: 0 });

    const enemy = state.players[1];
    expect(enemy.characters[0].damage).toBe(atkCard.baseValue);
    const me = state.players[0];
    expect(me.ap).toHaveLength(0);
    expect(me.trash).toHaveLength(atkCard.costAp + 1);
    expect(me.hand).toHaveLength(4);
    expect(me.actorIndex).toBe(1); // スキルを使うと次のキャラに交代
  });

  it('全滅させると勝ち・途中でアクター強制交代', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    const enemy = state.players[1];
    enemy.characters.forEach((c) => (c.damage = c.maxHp - 1));

    giveAp(state, 0, atkCard.costAp, ATK);
    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(enemy.characters[0].damage).toBe(enemy.characters[0].maxHp);
    expect(enemy.actorIndex).toBe(1); // 強制交代
    expect(state.phase).toBe('play');

    giveAp(state, 0, atkCard.costAp, ATK);
    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe('wipeout');
  });

  it('guard: 攻撃に割り込んで、その攻撃1回だけ軽減できる', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_B, CHAR_A], deckCard: GUARD });
    giveAp(state, 0, atkCard.costAp, ATK);
    giveAp(state, 1, guardCard.costAp, GUARD);

    applyAction(state, { type: 'playSkill', handIndex: 0 });

    expect(state.phase).toBe('guard');
    expect(actingPlayer(state)).toBe(1);
    const guards = legalActions(state).filter((a) => a.type === 'playGuard');
    expect(guards.length).toBeGreaterThan(0);

    applyAction(state, guards[0]);
    if (state.phase === 'guard') applyAction(state, { type: 'pass' });

    const target = state.players[1].characters[0];
    expect(target.damage).toBe(Math.max(0, atkCard.baseValue - guardCard.baseValue));
    expect(state.players[0].actorIndex).toBe(1); // 攻撃側は交代
    expect(state.players[1].actorIndex).toBe(0); // 割り込み側は交代しない
  });

  it('guardは自分のターンには使えない', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: GUARD }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    giveAp(state, 0, 5, GUARD);
    expect(legalActions(state).some((a) => a.type === 'playSkill')).toBe(false);
    expect(() => applyAction(state, { type: 'playSkill', handIndex: 0 })).toThrow();
  });

  it('passすると軽減なしで攻撃を受ける', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_B, CHAR_A], deckCard: GUARD });
    giveAp(state, 0, atkCard.costAp, ATK);
    giveAp(state, 1, guardCard.costAp, GUARD);

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.phase).toBe('guard');
    applyAction(state, { type: 'pass' });

    expect(state.players[1].characters[0].damage).toBe(atkCard.baseValue);
  });

  it('heal: 選んだ味方のダメージが回復する', () => {
    const healCard = cardById(HEAL) as SkillCard;
    const state = makeBattle({ chars: [CHAR_C], deckCard: HEAL }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    const target = state.players[0].characters[0];
    target.damage = 3;

    giveAp(state, 0, healCard.costAp, HEAL);
    applyAction(state, { type: 'playSkill', handIndex: 0, healTargetIndex: 0 });
    expect(target.damage).toBe(Math.max(0, 3 - healCard.baseValue));
  });
});

describe('キャラクターカードのプレイ', () => {
  it('同名の味方を2回復する', () => {
    const state = makeBattle({ chars: [CHAR_A], deckCard: CHAR_A }, { chars: [CHAR_D], deckCard: CHAR_D });
    const target = state.players[0].characters[0];
    target.damage = 3;

    applyAction(state, { type: 'playCharacter', handIndex: 0 });
    expect(target.damage).toBe(1);
    expect(state.players[0].trash).toContain(CHAR_A);
  });

  it('同名の味方がいないと使えない', () => {
    const state = makeBattle({ chars: [CHAR_A], deckCard: CHAR_D }, { chars: [CHAR_D], deckCard: CHAR_A });
    expect(legalActions(state).some((a) => a.type === 'playCharacter')).toBe(false);
    expect(() => applyAction(state, { type: 'playCharacter', handIndex: 0 })).toThrow();
  });
});

describe('ターン進行', () => {
  it('チャージでカードがAPエリアに移る', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'charge', handIndex: 0 });
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.players[0].ap).toHaveLength(1);
  });

  it('ターンが渡ると手札が5枚まで補充される', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'charge', handIndex: 0 });
    applyAction(state, { type: 'charge', handIndex: 0 });
    applyAction(state, { type: 'endTurn' });
    expect(state.active).toBe(1);
    expect(state.players[1].hand).toHaveLength(5);
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    expect(state.players[0].hand).toHaveLength(5);
  });

  it('山札切れで手札を5枚にできないと負け', () => {
    const state = makeBattle({ chars: [CHAR_A, CHAR_B], deckCard: ATK }, { chars: [CHAR_D, CHAR_E], deckCard: ATK });
    state.players[1].deck = [];
    state.players[1].hand = state.players[1].hand.slice(0, 2);
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe('deckout');
  });
});

describe('AI同士の自動対戦', () => {
  it('ランダムAI同士でも必ず決着する', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const result = runBattle(
        [sampleDeck(seed * 2 + 1), sampleDeck(seed * 2 + 2)],
        [randomAi(seed), randomAi(seed + 100)],
        seed,
      );
      expect(['wipeout', 'deckout', 'turnLimit']).toContain(result.reason);
      expect(result.turns).toBeGreaterThanOrEqual(1);
    }
  });

  it('simpleAI同士でも必ず決着する', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const result = runBattle(
        [sampleDeck(seed * 3 + 1), sampleDeck(seed * 3 + 2)],
        [simpleAi({ keepHand: 0 }), simpleAi({ keepHand: 2 })],
        seed,
      );
      expect(['wipeout', 'deckout', 'turnLimit']).toContain(result.reason);
    }
  });
});

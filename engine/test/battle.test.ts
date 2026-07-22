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
import { ALL_CARDS } from '../src/cards';
import { containsAll, deckProblems, sampleDeck, type DeckList } from '../src/decks';
import { runBattle } from '../src/runner';
import type { CharacterCard, SkillCard } from '../src/types';

const skills = ALL_CARDS.filter((c): c is SkillCard => c.type === 'skill');
const characters = ALL_CARDS.filter((c): c is CharacterCard => c.type === 'character');

/** 条件に合うスキルと、それを使えるキャラを探す（テスト素材の動的選択） */
function findSetup(valueType: SkillCard['valueType'], minChars: number) {
  for (const s of [...skills].sort((a, b) => a.costAp - b.costAp)) {
    if (s.valueType !== valueType || s.baseValue <= 0) continue;
    const matching = characters.filter((ch) => containsAll(ch.attribute, s.conditionAttribute));
    if (matching.length >= minChars) return { skill: s, chars: matching };
  }
  throw new Error(`テストに使える${valueType}スキルが見つかりません`);
}

interface Side {
  chars: CharacterCard[];
  deckCard: string;
}

/** テスト用の小さなバトルを作る（デッキ検証なし・先攻はプレイヤー1固定） */
function makeBattle(p0: Side, p1: Side): BattleState {
  const decks: [DeckList, DeckList] = [
    { characterIds: p0.chars.map((c) => c.id), cardIds: Array(20).fill(p0.deckCard) },
    { characterIds: p1.chars.map((c) => c.id), cardIds: Array(20).fill(p1.deckCard) },
  ];
  return createBattle(decks, 42, { firstPlayer: 0, validate: false });
}

function giveAp(state: BattleState, player: PlayerIndex, count: number, cardId: string) {
  state.players[player].ap.push(...Array(count).fill(cardId));
}

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
    const state = createBattle([sampleDeck(1), sampleDeck(2)], 7, { firstPlayer: 0 });
    expect(state.players[0].hand).toHaveLength(5);
    expect(state.players[1].hand).toHaveLength(5);
    expect(state.players[0].ap).toHaveLength(0);
    expect(state.players[1].ap).toHaveLength(2); // 後攻の補償
    expect(state.players[0].deck).toHaveLength(35);
    expect(state.players[1].deck).toHaveLength(33);
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('play');
    expect(state.players[0].actorIndex).toBe(0);
  });
});

describe('スキルのプレイ', () => {
  const { skill, chars } = findSetup('attack', 2);
  const enemyChars = characters.slice(0, 2);

  it('APが足りないと使えない', () => {
    const state = makeBattle({ chars: chars.slice(0, 2), deckCard: skill.id }, { chars: enemyChars, deckCard: skill.id });
    if (skill.costAp > 0) {
      expect(canPlaySkill(state, 0, skill)).toBe(false);
    }
    giveAp(state, 0, skill.costAp, skill.id);
    expect(canPlaySkill(state, 0, skill)).toBe(true);
  });

  it('属性条件が合わないと使えない', () => {
    // このスキルの条件を満たせないキャラを探す
    const mismatch = characters.find((ch) => !containsAll(ch.attribute, skill.conditionAttribute));
    if (!mismatch) return; // 全キャラが条件を満たす場合はスキップ
    const state = makeBattle({ chars: [mismatch], deckCard: skill.id }, { chars: enemyChars, deckCard: skill.id });
    giveAp(state, 0, skill.costAp, skill.id);
    expect(canPlaySkill(state, 0, skill)).toBe(false);
  });

  it('攻撃: 敵アクターにダメージ、コストとカードはトラッシュへ、アクター交代', () => {
    const state = makeBattle({ chars: chars.slice(0, 2), deckCard: skill.id }, { chars: enemyChars, deckCard: skill.id });
    giveAp(state, 0, skill.costAp, skill.id);

    applyAction(state, { type: 'playSkill', handIndex: 0 });

    const enemy = state.players[1];
    expect(enemy.characters[0].damage).toBe(Math.min(skill.baseValue, enemy.characters[0].maxHp));
    const me = state.players[0];
    expect(me.ap).toHaveLength(0);
    expect(me.trash).toHaveLength(skill.costAp + 1); // コスト分＋スキルカード
    expect(me.hand).toHaveLength(4);
    expect(me.actorIndex).toBe(1); // スキルを使うと次のキャラに交代
  });

  it('全滅させると勝ち・途中でアクター強制交代', () => {
    const state = makeBattle({ chars: chars.slice(0, 2), deckCard: skill.id }, { chars: enemyChars, deckCard: skill.id });
    const enemy = state.players[1];
    enemy.characters.forEach((c) => (c.damage = c.maxHp - 1)); // 全員あと1で戦闘不能

    giveAp(state, 0, skill.costAp, skill.id);
    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(enemy.characters[0].damage).toBe(enemy.characters[0].maxHp); // 戦闘不能
    expect(enemy.actorIndex).toBe(1); // 強制交代
    expect(state.phase).toBe('play'); // まだ続く

    giveAp(state, 0, skill.costAp, skill.id);
    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe('wipeout');
  });

  it('guard: 攻撃に割り込んで、その攻撃1回だけ軽減できる', () => {
    const g = findSetup('guard', 1);
    // P1が攻撃する側、P2がguardを持っている側
    const state = makeBattle(
      { chars: chars.slice(0, 2), deckCard: skill.id },
      { chars: g.chars.slice(0, 1), deckCard: g.skill.id },
    );
    giveAp(state, 0, skill.costAp, skill.id);
    giveAp(state, 1, g.skill.costAp, g.skill.id);

    applyAction(state, { type: 'playSkill', handIndex: 0 });

    // 攻撃されている側（P2）の割り込み待ちになる
    expect(state.phase).toBe('guard');
    expect(actingPlayer(state)).toBe(1);
    const guards = legalActions(state).filter((a) => a.type === 'playGuard');
    expect(guards.length).toBeGreaterThan(0);

    applyAction(state, guards[0]);
    if (state.phase === 'guard') applyAction(state, { type: 'pass' }); // まだ割り込める時は受ける

    const target = state.players[1].characters[0];
    const expected = Math.max(0, skill.baseValue - g.skill.baseValue);
    expect(target.damage).toBe(Math.min(expected, target.maxHp));
    expect(state.players[0].actorIndex).toBe(1); // 攻撃側はアクター交代する
    expect(state.players[1].actorIndex).toBe(0); // 割り込み側は交代しない
  });

  it('guardは自分のターンには使えない', () => {
    const g = findSetup('guard', 1);
    const state = makeBattle(
      { chars: g.chars.slice(0, 1), deckCard: g.skill.id },
      { chars: chars.slice(0, 2), deckCard: skill.id },
    );
    giveAp(state, 0, g.skill.costAp, g.skill.id);
    expect(legalActions(state).some((a) => a.type === 'playSkill')).toBe(false);
    expect(() => applyAction(state, { type: 'playSkill', handIndex: 0 })).toThrow();
  });

  it('passすると軽減なしで攻撃を受ける', () => {
    const g = findSetup('guard', 1);
    const state = makeBattle(
      { chars: chars.slice(0, 2), deckCard: skill.id },
      { chars: g.chars.slice(0, 1), deckCard: g.skill.id },
    );
    giveAp(state, 0, skill.costAp, skill.id);
    giveAp(state, 1, g.skill.costAp, g.skill.id);

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.phase).toBe('guard');
    applyAction(state, { type: 'pass' });

    const target = state.players[1].characters[0];
    expect(target.damage).toBe(Math.min(skill.baseValue, target.maxHp));
  });

  it('heal: 選んだ味方のダメージが回復する', () => {
    const h = findSetup('heal', 1);
    const state = makeBattle(
      { chars: h.chars.slice(0, 1), deckCard: h.skill.id },
      { chars: enemyChars, deckCard: skill.id },
    );
    const target = state.players[0].characters[0];
    target.damage = Math.min(3, target.maxHp - 1);
    const before = target.damage;

    giveAp(state, 0, h.skill.costAp, h.skill.id);
    applyAction(state, { type: 'playSkill', handIndex: 0, healTargetIndex: 0 });
    expect(target.damage).toBe(Math.max(0, before - h.skill.baseValue));
  });
});

describe('キャラクターカードのプレイ', () => {
  const someChar = characters[0];
  const otherChar = characters.find((c) => c.name !== someChar.name)!;

  it('同名の味方を2回復する', () => {
    const state = makeBattle({ chars: [someChar], deckCard: someChar.id }, { chars: [otherChar], deckCard: otherChar.id });
    const target = state.players[0].characters[0];
    target.damage = 3;

    applyAction(state, { type: 'playCharacter', handIndex: 0 });
    expect(target.damage).toBe(1);
    expect(state.players[0].trash).toContain(someChar.id);
  });

  it('同名の味方がいないと使えない', () => {
    // 手札は otherChar のカードだが、場にいるのは someChar
    const state = makeBattle({ chars: [someChar], deckCard: otherChar.id }, { chars: [otherChar], deckCard: someChar.id });
    expect(legalActions(state).some((a) => a.type === 'playCharacter')).toBe(false);
    expect(() => applyAction(state, { type: 'playCharacter', handIndex: 0 })).toThrow();
  });
});

describe('ターン進行', () => {
  it('チャージでカードがAPエリアに移る', () => {
    const state = createBattle([sampleDeck(1), sampleDeck(2)], 7, { firstPlayer: 0 });
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'charge', handIndex: 0 });
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.players[0].ap).toHaveLength(1);
  });

  it('ターンが渡ると手札が5枚まで補充される', () => {
    const state = createBattle([sampleDeck(1), sampleDeck(2)], 7, { firstPlayer: 0 });
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'charge', handIndex: 0 });
    applyAction(state, { type: 'charge', handIndex: 0 });
    applyAction(state, { type: 'endTurn' });
    // P2のターン。手札はもともと5枚なので補充なし
    expect(state.active).toBe(1);
    expect(state.players[1].hand).toHaveLength(5);
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    // P1に戻る。チャージで2枚減らした手札が5枚に戻る
    expect(state.players[0].hand).toHaveLength(5);
  });

  it('山札切れで手札を5枚にできないと負け', () => {
    const state = createBattle([sampleDeck(1), sampleDeck(2)], 7, { firstPlayer: 0 });
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

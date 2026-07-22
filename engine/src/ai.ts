/**
 * バトルのプレイヤーAI。
 * - randomAi: できる行動からランダムに選ぶ（エンジンの耐久テスト用）
 * - simpleAi: 一番強い攻撃を優先する素直なAI（バランス測定の基準用）
 */
import { legalActions, type BattleAction, type BattleState, type PlayerIndex } from './battle';
import { cardById } from './cards';
import { containsAll } from './decks';
import { mulberry32, pickOne, type Rng } from './rng';

export interface BattleAi {
  name: string;
  choose(state: BattleState, me: PlayerIndex): BattleAction;
}

/** できる行動からランダムに選ぶAI */
export function randomAi(seed: number): BattleAi {
  const rng: Rng = mulberry32(seed);
  return {
    name: 'random',
    choose(state) {
      const actions = legalActions(state);
      // ターンが無限に続かないよう、終了行動を少しだけ選ばれやすくする
      return pickOne(actions, rng);
    },
  };
}

export interface SimpleAiOptions {
  /** チャージフェーズで手札を何枚残すか（0 = 全部チャージ） */
  keepHand?: number;
}

/** 一番ダメージの大きい攻撃を優先する素直なAI */
export function simpleAi(options: SimpleAiOptions = {}): BattleAi {
  const keepHand = options.keepHand ?? 0;

  return {
    name: `simple(keep${keepHand})`,
    choose(state, me) {
      const actions = legalActions(state);
      const p = state.players[me];

      // 割り込み: 2以上のダメージが来るなら一番強いguardで軽減する
      if (state.phase === 'guard') {
        const pending = state.pendingAttack;
        if (pending && pending.value >= 2) {
          let best: { action: BattleAction; value: number } | null = null;
          for (const action of actions) {
            if (action.type !== 'playGuard') continue;
            const card = cardById(p.hand[action.handIndex]);
            if (card.type !== 'skill') continue;
            if (!best || card.baseValue > best.value) best = { action, value: card.baseValue };
          }
          if (best) return best.action;
        }
        return { type: 'pass' };
      }

      if (state.phase === 'play') {
        // 1. 使える攻撃スキルのうち、ダメージが一番大きいもの
        let best: { action: BattleAction; value: number } | null = null;
        for (const action of actions) {
          if (action.type !== 'playSkill') continue;
          const card = cardById(p.hand[action.handIndex]);
          if (card.type !== 'skill' || card.valueType !== 'attack') continue;
          if (card.baseValue <= 0) continue;
          if (!best || card.baseValue > best.value) {
            best = { action, value: card.baseValue };
          }
        }
        if (best) return best.action;

        // 2. ダメージを受けた味方がいればキャラクターカードで回復
        const characterPlay = actions.find((a) => {
          if (a.type !== 'playCharacter') return false;
          const card = cardById(p.hand[a.handIndex]);
          return p.characters.some((c) => c.name === card.name && c.damage > 0);
        });
        if (characterPlay) return characterPlay;

        return { type: 'endPlay' };
      }

      // チャージフェーズ: keepHand 枚残して、それ以外をチャージする
      if (p.hand.length > keepHand) {
        // 自分のキャラでは条件を満たせないスキルなど、使い道の薄いカードから
        const chargeIndex = chooseChargeIndex(p.hand, p.characters.map((c) => [...c.attributes, ...c.addedAttributes]));
        return { type: 'charge', handIndex: chargeIndex };
      }
      return { type: 'endTurn' };
    },
  };
}

/** チャージに回すカードを選ぶ: 使えないカード → それ以外、の順 */
function chooseChargeIndex(hand: string[], characterAttributes: string[][]): number {
  for (let i = 0; i < hand.length; i++) {
    const card = cardById(hand[i]);
    if (card.type === 'equipment' || card.type === 'field') return i; // 今はプレイ不可
    if (card.type === 'skill') {
      const usable = characterAttributes.some((attrs) => containsAll(attrs, card.conditionAttribute));
      if (!usable) return i;
    }
  }
  return hand.length - 1;
}

/**
 * バトルのプレイヤーAI。
 * - randomAi: できる行動からランダムに選ぶ（エンジンの耐久テスト用）
 * - simpleAi: 行動を採点して選ぶヒューリスティックAI（対人のCPU・バランス測定の基準）
 *
 * simpleAi の考え方:
 * - 攻撃は predictSkill（修正込みの予想ダメージ）で評価し、リーサルを最優先
 * - 回復・復活は「実際に回復できる量」で評価
 * - ガードは「アクターが落ちるのを防げるか」「軽減量が割に合うか」で判断
 * - チャージは使えないカードから回す
 */
import {
  effectiveAttributes,
  isCharAlive,
  legalActions,
  maxHpOf,
  predictSkill,
  type BattleAction,
  type BattleState,
  type PlayerIndex,
} from './battle';
import { cardById } from './cards';
import { containsAll } from './decks';
import { skillEffectOf } from './effects';
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
      return pickOne(actions, rng);
    },
  };
}

export interface SimpleAiOptions {
  /** チャージフェーズで手札を何枚残すか（0 = 全部チャージ） */
  keepHand?: number;
}

/** 行動を採点して選ぶヒューリスティックAI */
export function simpleAi(options: SimpleAiOptions = {}): BattleAi {
  const keepHand = options.keepHand ?? 0;

  return {
    name: `simple(keep${keepHand})`,
    choose(state, me) {
      const actions = legalActions(state);
      const p = state.players[me];
      const enemyIdx = (1 - me) as PlayerIndex;
      const enemy = state.players[enemyIdx];

      const hpLeft = (side: PlayerIndex, ci: number) =>
        Math.max(0, maxHpOf(state, side, ci) - state.players[side].characters[ci].damage);

      // ---------- 割り込み（ガード） ----------
      if (state.phase === 'guard') {
        const pending = state.pendingAttack;
        if (!pending) return { type: 'pass' };
        const actorHp = hpLeft(me, p.actorIndex);
        const wouldDie = pending.value >= actorHp;

        let best: { action: BattleAction; value: number; cost: number } | null = null;
        for (const action of actions) {
          if (action.type !== 'playGuard') continue;
          const card = cardById(p.hand[action.handIndex]);
          if (card.type !== 'skill') continue;
          const cut = Math.min(card.baseValue, pending.value);
          if (!best || cut > best.value) best = { action, value: cut, cost: card.costAp };
        }
        if (!best) return { type: 'pass' };

        // アクターが落ちるなら、生き残れる場合に必ずガード
        if (wouldDie && pending.value - best.value < actorHp) return best.action;
        // 落ちないなら、4以上のダメージをコスト効率よく削れる時だけガード
        // （軽いダメージまでガードすると膠着して山札切れに向かうため）
        if (!wouldDie && pending.value >= 4 && best.value >= best.cost * 2) return best.action;
        return { type: 'pass' };
      }

      // ---------- 選択フェーズ（アニマ等。AIはエンジンの自動判断があるので使わない） ----------
      if (state.phase === 'choice') {
        return { type: 'skipTurnStart' };
      }

      // ---------- プレイフェーズ: 行動を採点して一番良いものを選ぶ ----------
      if (state.phase === 'play') {
        // 装備は無料なので先に付ける（未装備のキャラにだけ）
        const equipAction = actions.find(
          (a) => a.type === 'playEquipment' && p.characters[a.targetIndex].equipmentCardId === null,
        );
        if (equipAction) return equipAction;

        // フィールドが無ければ出す
        const fieldAction = actions.find((a) => a.type === 'playField');
        if (fieldAction && (state.field === null || state.field.owner !== me)) return fieldAction;

        let best: { action: BattleAction; score: number } | null = null;
        for (const action of actions) {
          if (action.type !== 'playSkill') continue;
          const card = cardById(p.hand[action.handIndex]);
          if (card.type !== 'skill') continue;
          const pred = predictSkill(state, me, card, action.usingIndex);
          if (!pred) continue;
          let score = -Infinity;

          if (pred.kind === 'attack') {
            if (pred.value > 0) {
              // 修正込みダメージ × 対象数。リーサルを強く優先
              score = pred.value * Math.max(1, pred.targets) * 10 - pred.cost * 2;
              const targetIdx =
                action.targetIndex ??
                (isCharAlive(state, enemyIdx, enemy.actorIndex) ? enemy.actorIndex : -1);
              if (targetIdx >= 0 && pred.targets <= 1 && pred.value >= hpLeft(enemyIdx, targetIdx)) {
                score += 60; // 単体リーサル
              }
              if (pred.targets > 1) {
                const kills = enemy.characters.filter(
                  (_, i) => isCharAlive(state, enemyIdx, i) && pred.value >= hpLeft(enemyIdx, i),
                ).length;
                score += kills * 50; // 全体でまとめて倒す
              }
            }
          } else if (pred.kind === 'heal') {
            const eff = skillEffectOf(card.id);
            if (eff?.healTargeting === 'ko') {
              score = 55 - pred.cost * 3; // 復活はほぼ常に強い
            } else {
              const target = action.healTargetIndex ?? p.actorIndex;
              const healable = Math.min(pred.value, p.characters[target]?.damage ?? 0);
              if (healable >= 2) score = healable * 9 - pred.cost * 4;
            }
          } else if (pred.kind === 'support') {
            // 軽い補助（ドロー・チャージ等）はテンポを崩さない範囲で使う
            if (card.effectText !== '') score = 8 - pred.cost * 4;
          }

          if (score > (best?.score ?? 0)) best = { action, score };
        }
        if (best) return best.action;

        // ダメージを受けた味方がいればキャラクターカードで回復
        const characterPlay = actions.find((a) => {
          if (a.type !== 'playCharacter') return false;
          const card = cardById(p.hand[a.handIndex]);
          return p.characters.some((c) => c.name === card.name && c.damage > 0);
        });
        if (characterPlay) return characterPlay;

        return { type: 'endPlay' };
      }

      // ---------- チャージフェーズ ----------
      // 手札は1枚残しまで使ってよい（人間も普通そうする）。
      // 大事なのは「使った分を決着（KO）に変換する」こと:
      // - 死に札から先にAPへ
      // - 目標APは「アクターで撃てる攻撃の高い方から2発ぶん」= 毎ターン撃ち切る
      const attrsByChar = p.characters.map((_, i) => effectiveAttributes(state, me, i));
      const isUsable = (id: string): boolean => {
        const card = cardById(id);
        if (card.type === 'equipment' || card.type === 'field') return false; // 2枚目以降は死に札扱い
        if (card.type === 'skill') {
          return attrsByChar.some((attrs) => containsAll(attrs, card.conditionAttribute));
        }
        // キャラカード: 同名キャラが場にいれば回復札として温存
        return p.characters.some((c) => c.name === card.name);
      };
      // 「今のアクターで実際に撃てる」攻撃だけを基準にする
      // （アクターが使えない札のためにAPを貯めても手詰まりのままなので）
      const actorAttrs = attrsByChar[p.actorIndex] ?? [];
      const actorAttackCosts = p.hand
        .map((id) => cardById(id))
        .filter(
          (c): c is Extract<typeof c, { type: 'skill' }> =>
            c.type === 'skill' && c.valueType !== 'guard' && c.valueType !== 'heal' &&
            containsAll(actorAttrs, c.conditionAttribute),
        )
        .map((c) => c.costAp);
      const cheapest = actorAttackCosts.length > 0 ? Math.min(...actorAttackCosts) : Infinity;
      const sortedCosts = [...actorAttackCosts].sort((a, b) => b - a);
      // 目標AP = 高い方から2発ぶん（1発しか無ければ1発+2で次に備える）
      const targetAp =
        sortedCosts.length >= 2
          ? Math.min(9, sortedCosts[0] + sortedCosts[1])
          : sortedCosts.length === 1
            ? Math.min(9, sortedCosts[0] + 2)
            : 3;

      if (p.hand.length > 1 && p.ap.length < targetAp) {
        // 死に札（チームの誰も使えない）から先にAPへ
        const deadIndex = p.hand.findIndex((id) => !isUsable(id));
        if (deadIndex >= 0) return { type: 'charge', handIndex: deadIndex };
        const chargeIndex = chooseChargeIndex(p.hand, attrsByChar);
        return { type: 'charge', handIndex: chargeIndex };
      }
      // アクターで撃てる攻撃が手札に無い（手札が腐っている）なら、
      // 1枚チャージして山札を回し、手札を入れ替える（膠着防止）
      if (cheapest === Infinity && p.hand.length > 1) {
        const chargeIndex = chooseChargeIndex(p.hand, attrsByChar);
        return { type: 'charge', handIndex: chargeIndex };
      }
      // ルール: 手札5枚以上のままターンは終えられない（1枚以上チャージ必須）
      if (p.hand.length >= 5 && p.chargedThisTurn === 0) {
        const chargeIndex = chooseChargeIndex(p.hand, attrsByChar);
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

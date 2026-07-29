/**
 * バトルのプレイヤーAI。
 * - randomAi: できる行動からランダムに選ぶ（エンジンの耐久テスト用）
 * - simpleAi: 行動を採点して選ぶヒューリスティックAI（旧CPU。今は強さの比較基準）
 * - **searchAi: 1手先読みAI。今のCPU・シミュレーターはこれを使う**
 *
 * 強さの比較は `npm run sim -- --mode ai` で測れる（searchAi vs simpleAi の勝率）。
 * 2026-07-25 時点で searchAi の勝率は 62%。
 *
 * simpleAi の考え方:
 * - 攻撃は predictSkill（修正込みの予想ダメージ）で評価し、リーサルを最優先
 * - 回復・復活は「実際に回復できる量」で評価
 * - ガードは「アクターが落ちるのを防げるか」「軽減量が割に合うか」で判断
 * - チャージは使えないカードから回す
 */
import {
  applyAction,
  effectiveAttributes,
  isCharAlive,
  legalActions,
  maxHpOf,
  predictSkill,
  type BattleAction,
  type BattleState,
  type PlayerIndex,
} from './battle';
import { cardByPrintingId } from './cards';
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
          const card = cardByPrintingId(p.hand[action.handIndex]);
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
          const card = cardByPrintingId(p.hand[action.handIndex]);
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
            const eff = skillEffectOf(card.oracleId);
            if (eff?.healTargeting === 'ko') {
              score = 55 - pred.cost * 3; // 復活はほぼ常に強い
            } else {
              const target = action.healTargetIndex ?? p.actorIndex;
              const healable = Math.min(pred.value, p.characters[target]?.damage ?? 0);
              if (healable >= 2) score = healable * 9 - pred.cost * 4;
            }
          } else if (pred.kind === 'support') {
            // 軽い補助（ドロー・チャージ等）はテンポを崩さない範囲で使う
            // 表示文は言語・再録で変わり得るため、挙動の有無は Oracle の効果定義で判定する
            if (skillEffectOf(card.oracleId)) score = 8 - pred.cost * 4;
          }

          if (score > (best?.score ?? 0)) best = { action, score };
        }
        if (best) return best.action;

        // ダメージを受けた味方がいればキャラクターカードで回復
        const characterPlay = actions.find((a) => {
          if (a.type !== 'playCharacter') return false;
          const card = cardByPrintingId(p.hand[a.handIndex]);
          return p.characters.some((c) => c.oracleId === card.oracleId && c.damage > 0);
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
        const card = cardByPrintingId(id);
        if (card.type === 'equipment' || card.type === 'field') return false; // 2枚目以降は死に札扱い
        if (card.type === 'skill') {
          return attrsByChar.some((attrs) => containsAll(attrs, card.conditionAttribute));
        }
        // キャラカード: 同名キャラが場にいれば回復札として温存
        return p.characters.some((c) => c.oracleId === card.oracleId);
      };
      // 「今のアクターで実際に撃てる」攻撃だけを基準にする
      // （アクターが使えない札のためにAPを貯めても手詰まりのままなので）
      const actorAttrs = attrsByChar[p.actorIndex] ?? [];
      const actorAttackCosts = p.hand
        .map((id) => cardByPrintingId(id))
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

// ==================================================================== 先読みAI
//
// simpleAi は「カードの種類ごとに点数を手書きする」方式だった。これだと効果文が
// 増えるたびに採点表を書き足す必要があり、実際にドロー・サーチ・AP妨害といった
// 効果はどれも「支援」ひとくくりで、ほぼ使われないまま放置されていた
// （公開βのレビュー「敵があんまり攻撃してこない」の主因）。
//
// searchAi は代わりに「その行動を実際にやってみて、盤面が良くなったか」を見る。
// カードの効果はエンジンが解決してくれるので、AI側に採点表がいらない。
// 新しいカードを足しても、AIは自動的にその価値を理解する。

/** 盤面の良さ（me から見た点数）。大きいほど自分が有利 */
function evaluate(state: BattleState, me: PlayerIndex): number {
  const you = (1 - me) as PlayerIndex;
  if (state.phase === 'finished') {
    if (state.winner === me) return 1_000_000;
    if (state.winner === you) return -1_000_000;
    return 0;
  }
  const W = WEIGHTS;
  let score = 0;
  for (const side of [me, you] as PlayerIndex[]) {
    const sign = side === me ? 1 : -1;
    const p = state.players[side];
    for (let i = 0; i < p.characters.length; i++) {
      if (!isCharAlive(state, side, i)) {
        score -= sign * W.ko; // 1体落ちるのは重い（3体落ちたら負け）
        continue;
      }
      score += sign * Math.max(0, maxHpOf(state, side, i) - p.characters[i].damage) * (side === me ? W.hp : W.hpFoe);
    }
    score += sign * p.hand.length * W.hand; // 手札は選択肢
    score += sign * p.ap.length * W.ap; // APは撃てる回数
    // 山札は「切れたら負け」なので、少ない時ほど1枚が重い（多い時は頭打ち）
    score += sign * Math.min(p.deck.length, W.deckCap) * W.deck;
  }
  return score;
}

/**
 * 評価の重み。`npm run sim -- --mode ai`（旧simpleAiとの直接対決）で1つずつ振って決めた値。
 *
 * - いちばん効いたのは **ap**。1.5 → 4 で勝率 60% → 67%（seed 1/500/9999 で再現）。
 *   APを重く見る＝「効果の薄いスキルにAPを吐かない」なので、大技を撃ち切れるようになる。
 * - **hp は 3 が最適**（2でも4でも勝率が落ちる）。ko と deck は勝率にほぼ効かなかったので、
 *   意味づけが分かりやすい値のままにしてある。
 * - **hpFoe（相手のHPの重さ）を自分より高くしてあるのは意図的**。
 *   最強設定は hpFoe=3 の 67% だが、それだとAI同士の平均が31.3ターンまで伸びた。
 *   hpFoe=4.5 にすると「守るより殴る」を選ぶようになり、62%・28.5ターンに収まる。
 *   βレビューの「敵があんまり攻撃してこない」を踏まえて、勝率4ポイントぶんを
 *   攻撃的さと試合の短さに使っている。純粋に最強にしたいなら hpFoe を 3 に戻す。
 */
const WEIGHTS = {
  /** 自分のHP1点の重さ */
  hp: 3,
  /** 相手のHP1点の重さ。自分より高くしてあるのは「守りより攻めを選ぶ」ため */
  hpFoe: 4.5,
  /** 1体戦闘不能の重さ */
  ko: 45,
  /** 手札1枚の重さ（選択肢の多さ） */
  hand: 2.5,
  /** AP1つの重さ。効きが一番大きいツマミ */
  ap: 4,
  /** 山札1枚の重さ（切れたら負けなので価値がある） */
  deck: 0.8,
  /** 山札はこの枚数以上あっても価値は増えない */
  deckCap: 14,
};

/**
 * ログとイベントを外してから複製する。
 * 素直に structuredClone すると300件のログ配列まで毎回コピーしてしまい、
 * 1手ごとに何十回も複製する先読みでは無視できない重さになる。
 */
function cloneForSearch(state: BattleState): BattleState {
  const log = state.log;
  const events = state.events;
  state.log = [];
  state.events = [];
  const copy = structuredClone(state);
  state.log = log;
  state.events = events;
  return copy;
}

/** 行動を1つ試して、その結果の盤面を採点する。壊れる行動は選択肢から外す */
function scoreAction(state: BattleState, me: PlayerIndex, action: BattleAction): number | null {
  let clone: BattleState;
  try {
    clone = cloneForSearch(state);
    applyAction(clone, action);
  } catch {
    return null; // 合法手のはずが失敗するなら選ばない
  }
  return evaluate(clone, me);
}

/**
 * 候補の中から、やってみて一番良くなる行動を選ぶ。
 * fallback（何もしない手）と同点なら fallback を選ぶ＝無駄打ちしない。
 *
 * 自分の連続行動を2手・3手先まで読む版も作って測ったが、勝率は逆に下がった
 * （1手 61.3% → 2手 59.2% / 3手ぶん 58.3%、いずれも simpleAi 相手・336戦）。
 * 相手の返しを読んでいないので、深く読むほど「手札とAPを使い切る線」を
 * 過大評価してしまうため。深くするなら先に相手の応手を入れる必要がある。
 */
function chooseBySearch(
  state: BattleState,
  me: PlayerIndex,
  actions: BattleAction[],
  fallback: BattleAction,
): BattleAction {
  const base = scoreAction(state, me, fallback) ?? evaluate(state, me);
  let best: { action: BattleAction; score: number } | null = null;
  for (const action of actions) {
    if (sameAction(action, fallback)) continue;
    if (isPointless(state, me, action)) continue;
    const score = scoreAction(state, me, action);
    if (score === null) continue;
    // 僅差の行動でカードを使い減らさないよう、上回った時だけ採用する
    if (score > base + 0.01 && score > (best?.score ?? -Infinity)) best = { action, score };
  }
  return best?.action ?? fallback;
}

function sameAction(a: BattleAction, b: BattleAction): boolean {
  return a.type === b.type && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 「やっても意味がない」と分かりきっている手を候補から外す。
 *
 * 先読みは盤面の点数だけを見るので、点差が僅かでもプラスなら打ってしまう。
 * 実際に起きた例: 同名キャラカードの回復を **HPが満タンのキャラ** に使う。
 * 回復量は0なのに、カードがトラッシュへ行くことで「トラッシュの枚数だけHPが増える」
 * キャラ（ドッソ）の最大HPが+1され、-73.0 → -72.5 とわずかにプラスになっていた。
 * 手札1枚を捨てて最大HP+1は明らかに損で、人が見ても不自然なので、
 * 回復量0のキャラカードは最初から選ばせない。
 */
function isPointless(state: BattleState, me: PlayerIndex, action: BattleAction): boolean {
  if (action.type !== 'playCharacter') return false;
  const p = state.players[me];
  const id = p.hand[action.handIndex];
  if (!id) return false;
  const card = cardByPrintingId(id);
  // エンジンと同じ「一番傷ついた同名キャラ」が回復先になる
  let best = -1;
  p.characters.forEach((c, i) => {
    if (c.oracleId === card.oracleId && isCharAlive(state, me, i)) {
      if (best === -1 || c.damage > p.characters[best].damage) best = i;
    }
  });
  return best >= 0 && p.characters[best].damage === 0;
}

/**
 * 1手先読みAI。プレイ・ガードの判断を「実際に試して盤面を採点」で行う。
 * チャージフェーズだけは simpleAi の作戦（撃ち切れるAPを貯める）をそのまま使う。
 * 先読みでチャージを評価すると「手札を減らすと点が下がる」ので何も貯めなくなるため。
 */
export function searchAi(options: SimpleAiOptions = {}): BattleAi {
  const fallbackAi = simpleAi(options);
  return {
    name: `search(keep${options.keepHand ?? 0})`,
    choose(state, me) {
      const actions = legalActions(state);
      if (actions.length <= 1) return actions[0] ?? { type: 'pass' };

      if (state.phase === 'guard') {
        return chooseBySearch(state, me, actions, { type: 'pass' });
      }
      if (state.phase === 'play') {
        // 装備・フィールドはAPを使わないので、置いて良くなるなら置く（先読みが判断）
        return chooseBySearch(state, me, actions, { type: 'endPlay' });
      }
      // choice（ターン開始の任意能力）とチャージは従来の判断に任せる
      return fallbackAi.choose(state, me);
    },
  };
}

/** チャージに回すカードを選ぶ: 使えないカード → それ以外、の順 */
function chooseChargeIndex(hand: string[], characterAttributes: string[][]): number {
  for (let i = 0; i < hand.length; i++) {
    const card = cardByPrintingId(hand[i]);
    if (card.type === 'equipment' || card.type === 'field') return i; // 今はプレイ不可
    if (card.type === 'skill') {
      const usable = characterAttributes.some((attrs) => containsAll(attrs, card.conditionAttribute));
      if (!usable) return i;
    }
  }
  return hand.length - 1;
}

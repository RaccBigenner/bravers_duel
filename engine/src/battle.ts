/**
 * バトルエンジン本体。
 * ルールの正しい情報源は docs/GAME_RULES.md（v0.4）。
 *
 * カード効果は effects/ の静的レジストリから引く。
 * - 効果はバトル状態に保持しない（カードが増えてもバトルのメモリは増えない）
 * - 効果の実行はスナップショット保護付き（エラー時は巻き戻してスキップ）
 * - ログは上限つき（長期戦でもメモリが伸び続けない）
 *
 * 未実装: 装備・フィールドカードのプレイ（ルール未決定）、選択が必要な一部の効果
 */
import { cardById } from './cards';
import { containsAll, deckProblems, DEFAULT_DECK_RULES, type DeckList, type DeckRules } from './decks';
import {
  characterEffectOf,
  equipmentEffectOf,
  fieldEffectOf,
  hasEffectImplementation,
  skillEffectOf,
  type EffectApi,
} from './effects';
import type { BattleEvent } from './events';
import { mulberry32, shuffled } from './rng';
import {
  CHARACTER_CARD_HEAL,
  HAND_REFILL_TO,
  SECOND_PLAYER_STARTING_AP,
  type Attribute,
  type CharacterCard,
  type EquipmentCard,
  type SkillCard,
} from './types';

export type PlayerIndex = 0 | 1;

const MAX_LOG_ENTRIES = 300;
const MAX_EFFECT_DEPTH = 8;
const MAX_ADDED_ATTRIBUTES = 20;

export interface CharacterInstance {
  cardId: string;
  name: string;
  maxHp: number; // カード本来のHP（効果による増減は maxHpOf で計算）
  attributes: Attribute[];
  addedAttributes: Attribute[];
  damage: number;
  equipmentCardId: string | null; // 装備カード（1キャラ1個）
}

export interface PlayerBattle {
  deck: string[]; // 先頭が山札の一番上
  hand: string[];
  trash: string[]; // 末尾が一番上（「下から」= 先頭から）
  ap: string[];
  characters: CharacterInstance[];
  actorIndex: number;
  skillsUsedThisTurn: number;
  nextSkillCostDelta: number; // スイッチ等（マイナス値）。次のスキル使用で消費
  nextDrawDelta: number; // スノウドロップ等（マイナス値）。次のドローで消費
  actorLockUntilTurn: number; // state.turn がこの値以下の間、アクター変更不可
  incomingDamageReduction: { value: number; untilTurn: number } | null;
}

export type Phase = 'choice' | 'play' | 'guard' | 'charge' | 'finished';
export type EndReason = 'wipeout' | 'deckout' | 'turnLimit';

export interface PendingAttack {
  skillId: string;
  skillName: string;
  value: number;
  /** 対象の決め方。実際の対象は「解決時」に決まる（飛翔などでアクターが変わったら攻撃先も変わる） */
  targeting: 'actor' | 'all' | 'standby' | 'choose';
  chosenIndex?: number; // choose の時だけ
  noGuard: boolean;
  attackerChar: number; // 使用キャラの番号
  /** 使用キャラが宣言時点でアクターだったか（アクター以外の使用ではローテーションしない） */
  attackerWasActor: boolean;
  /** ガード割り込み。軽減が適用されるのはガード使用者（防御側アクター）への被弾のみ */
  guard: { charIndex: number; value: number } | null;
}

export interface BattleState {
  turn: number;
  active: PlayerIndex;
  phase: Phase;
  players: [PlayerBattle, PlayerBattle];
  firstPlayer: PlayerIndex;
  pendingAttack: PendingAttack | null;
  /** 効果が明示的にアクターを動かしたプレイヤー（そのプレイヤーの直後の自動交代をスキップ） */
  skipRotationFor: PlayerIndex | null;
  /** 任意能力を手動発動にするプレイヤー（人間側） */
  manualFor: PlayerIndex | null;
  /** 場のフィールドカード（両者共有・1枚だけ） */
  field: { cardId: string; owner: PlayerIndex } | null;
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  rngState: number;
  effectDepth: number;
  log: string[];
  /** ログの通し番号（上限で古いログが消えても、UI側が差分を取れるように） */
  logSeq: number;
  /** 型付きイベントストリーム（UIの演出はこれだけを読む。→ events.ts） */
  events: BattleEvent[];
  /** イベントの通し番号（上限で古いものが消えても差分を取れるように） */
  eventSeq: number;
}

export type BattleAction =
  | { type: 'playSkill'; handIndex: number; healTargetIndex?: number; targetIndex?: number; usingIndex?: number }
  | { type: 'playCharacter'; handIndex: number }
  | { type: 'playEquipment'; handIndex: number; targetIndex: number }
  | { type: 'playField'; handIndex: number }
  | { type: 'turnStartAbility'; charIndex: number } // アニマ等の任意能力（ドロー前の選択）
  | { type: 'skipTurnStart' } // 任意能力を使わない
  | { type: 'endPlay' }
  | { type: 'playGuard'; handIndex: number }
  | { type: 'pass' }
  | { type: 'charge'; handIndex: number }
  | { type: 'endTurn' };

// ---------------------------------------------------------------- 基本ヘルパー

function pushLog(state: BattleState, message: string): void {
  state.log.push(message);
  state.logSeq++;
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
  }
}

/** UI用の型付きイベントを発行する（ログとは独立。演出はこちらだけを読む） */
function emit(state: BattleState, ev: BattleEvent): void {
  state.events.push(ev);
  state.eventSeq++;
  if (state.events.length > MAX_LOG_ENTRIES) {
    state.events.splice(0, state.events.length - MAX_LOG_ENTRIES);
  }
}

/** 状態内の乱数を1歩進める（再現可能・直列化可能） */
function stepRng(state: BattleState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 効果込みの最大HP */
export function maxHpOf(state: BattleState, player: PlayerIndex, charIndex: number): number {
  const c = state.players[player].characters[charIndex];
  const eff = characterEffectOf(c.cardId);
  let hp = c.maxHp;
  if (c.equipmentCardId) {
    hp += equipmentEffectOf(c.equipmentCardId)?.maxHpDelta ?? 0;
  }
  if (eff?.maxHpBonus) {
    try {
      hp += eff.maxHpBonus(makeApi(state, player, charIndex));
    } catch {
      /* 効果エラーは無視 */
    }
  }
  return hp;
}

export function isCharAlive(state: BattleState, player: PlayerIndex, charIndex: number): boolean {
  const c = state.players[player].characters[charIndex];
  return c.damage < maxHpOf(state, player, charIndex);
}

export function aliveCount(state: BattleState, player: PlayerIndex): number {
  return state.players[player].characters.filter((_, i) => isCharAlive(state, player, i)).length;
}

/** 効果込みの属性一覧（追加属性＋セレーナ等の味方付与） */
export function effectiveAttributes(
  state: BattleState,
  player: PlayerIndex,
  charIndex: number,
): Attribute[] {
  const p = state.players[player];
  const c = p.characters[charIndex];
  const attrs = [...c.attributes, ...c.addedAttributes];
  if (c.equipmentCardId) {
    const card = cardById(c.equipmentCardId);
    if (card.type === 'equipment') attrs.push(...card.addAttribute);
  }
  if (state.field) {
    const grant = fieldEffectOf(state.field.cardId)?.grantAttrAll;
    if (grant) attrs.push(grant);
  }
  p.characters.forEach((ally, i) => {
    if (!isCharAlive(state, player, i)) return;
    const grant = characterEffectOf(ally.cardId)?.grantAllyAttribute;
    if (grant) attrs.push(grant);
  });
  return attrs;
}

function nextAliveIndex(state: BattleState, player: PlayerIndex, from: number, skip = 0): number {
  const p = state.players[player];
  let found = 0;
  for (let step = 1; step <= p.characters.length * 2; step++) {
    const i = (from + step) % p.characters.length;
    if (isCharAlive(state, player, i)) {
      if (found >= skip) return i;
      found++;
    }
  }
  return from;
}

export function actingPlayer(state: BattleState): PlayerIndex {
  return state.phase === 'guard' ? ((1 - state.active) as PlayerIndex) : state.active;
}

/** 大乱戦: 3枚生存中のプレイヤーはアクター変更時に1枚飛ばす */
function rotationSkip(state: BattleState, player: PlayerIndex): number {
  if (!state.field) return 0;
  const eff = fieldEffectOf(state.field.cardId);
  return eff?.rotationSkipWhenFullAlive && aliveCount(state, player) === 3 ? 1 : 0;
}

function actorLocked(state: BattleState, player: PlayerIndex): boolean {
  return state.turn <= state.players[player].actorLockUntilTurn;
}

/** アクターがロック中か（UI表示用に公開） */
export function isActorLocked(state: BattleState, player: PlayerIndex): boolean {
  return actorLocked(state, player);
}

/** バトルが終了したか（効果処理の途中で決着した場合の検出用。TSの型絞り込みを避けるため関数にしている） */
function battleOver(state: BattleState): boolean {
  return state.phase === 'finished';
}

function finish(state: BattleState, winner: PlayerIndex | null, reason: EndReason): void {
  state.phase = 'finished';
  state.winner = winner;
  state.endReason = reason;
  state.pendingAttack = null;
  pushLog(state, winner === null ? `決着つかず（${reason}）` : `プレイヤー${winner + 1}の勝ち（${reason}）`);
  emit(state, { t: 'battleEnd', winner, reason });
}

// ---------------------------------------------------------------- 効果の安全実行

/**
 * 効果をスナップショット保護つきで実行する。
 * 効果が例外を投げたら、状態を実行前に巻き戻してログを残し、バトルを続行する。
 */
function runEffectSafely(
  state: BattleState,
  label: string,
  fn: () => void,
  /** 発動したキャラの位置（演出の表示先。必ず渡すこと: 名前検索での取り違いを防ぐ） */
  anchor?: { player: PlayerIndex; charIndex: number },
): void {
  if (state.phase === 'finished') return;
  if (state.effectDepth >= MAX_EFFECT_DEPTH) {
    pushLog(state, `効果の連鎖が深すぎるためスキップ: ${label}`);
    return;
  }
  const backup = structuredClone({
    turn: state.turn,
    active: state.active,
    phase: state.phase,
    players: state.players,
    pendingAttack: state.pendingAttack,
    winner: state.winner,
    endReason: state.endReason,
    rngState: state.rngState,
    events: state.events,
    eventSeq: state.eventSeq,
  });
  state.effectDepth++;
  // ＠P◯の◯番手 は演出がキャラ位置を正確に特定するための機械可読な印
  pushLog(state, anchor ? `発動:${label}＠P${anchor.player + 1}の${anchor.charIndex + 1}番手` : `発動:${label}`);
  const activationIndex = state.events.length;
  emit(state, { t: 'abilityTriggered', label, player: anchor?.player, charIndex: anchor?.charIndex });
  try {
    fn();
  } catch (e) {
    Object.assign(state, backup);
    pushLog(state, `効果でエラーが起きたためスキップ: ${label}（${e instanceof Error ? e.message : e}）`);
  } finally {
    state.effectDepth--;
    // 効果が目に見える変化（後続イベント）を何も起こさなかった場合、
    // 「発動」の演出も取り消す（条件不成立のパッシブが毎回光るのを防ぐ）
    if (
      state.events.length === activationIndex + 1 &&
      state.events[activationIndex]?.t === 'abilityTriggered'
    ) {
      state.events.splice(activationIndex, 1);
      state.eventSeq--;
    }
  }
}

// ---------------------------------------------------------------- EffectApi 実装

function makeApi(state: BattleState, owner: PlayerIndex, ownerChar: number): EffectApi {
  const me = () => state.players[owner];
  const enemyIdx = (1 - owner) as PlayerIndex;
  const enemy = () => state.players[enemyIdx];
  const clampN = (n: number) => Math.max(0, Math.floor(n));
  const firstTarget = () => {
    if (!state.pendingAttack) return null;
    const targets = resolveAttackTargets(state, state.pendingAttack);
    return targets.length > 0 ? targets[0] : null;
  };
  // 攻撃効果の「対象」は防御側（= pendingAttack がある時の active の相手）
  const defenderIdx = () => (1 - state.active) as PlayerIndex;

  const api: EffectApi = {
    turn: () => state.turn,
    myApCount: () => me().ap.length,
    myTrashCount: () => me().trash.length,
    myAttrCount: (attr) =>
      effectiveAttributes(state, owner, ownerChar).filter((a) => a === attr).length,
    targetAttrCount: (attr) => {
      const t = firstTarget();
      if (t === null) return 0;
      return effectiveAttributes(state, defenderIdx(), t).filter((a) => a === attr).length;
    },
    targetHp: () => {
      const t = firstTarget();
      if (t === null) return 0;
      const c = state.players[defenderIdx()].characters[t];
      return Math.max(0, maxHpOf(state, defenderIdx(), t) - c.damage);
    },
    targetMaxHp: () => {
      const t = firstTarget();
      return t === null ? 0 : maxHpOf(state, defenderIdx(), t);
    },
    myDamage: () => me().characters[ownerChar].damage,
    myKoCount: () => me().characters.filter((_, i) => !isCharAlive(state, owner, i)).length,
    myAliveCount: () => me().characters.filter((_, i) => isCharAlive(state, owner, i)).length,
    skillsUsedThisTurn: () => me().skillsUsedThisTurn,

    addDamage: (n) => {
      if (state.pendingAttack && clampN(n) > 0) {
        state.pendingAttack.value += clampN(n);
        pushLog(
          state,
          `P${owner + 1}の${me().characters[ownerChar].name}の攻撃威力+${clampN(n)}（ダメージ${state.pendingAttack.value}）`,
        );
        emit(state, { t: 'powerUp', player: owner, charIndex: ownerChar, n: clampN(n), total: state.pendingAttack.value });
      }
    },
    setDamage: (n) => {
      if (state.pendingAttack) {
        state.pendingAttack.value = clampN(n);
        pushLog(state, `攻撃のダメージが${clampN(n)}に変わった`);
      }
    },
    addGuardValue: (n) => {
      const pending = state.pendingAttack;
      if (pending && clampN(n) > 0) {
        if (pending.guard) {
          pending.guard.value += clampN(n);
          pushLog(
            state,
            `P${owner + 1}のガード強化+${clampN(n)}（残りダメージ${Math.max(0, pending.value - pending.guard.value)}）`,
          );
          emit(state, { t: 'guardBoost', player: owner, n: clampN(n), remain: Math.max(0, pending.value - pending.guard.value) });
        } else {
          // ガード外から呼ばれた場合は攻撃自体を弱める
          pending.value = Math.max(0, pending.value - clampN(n));
          pushLog(state, `P${owner + 1}のガード強化+${clampN(n)}（残りダメージ${pending.value}）`);
          emit(state, { t: 'guardBoost', player: owner, n: clampN(n), remain: pending.value });
        }
      }
    },

    chargeFromDeck: (who, n) => {
      const idx = who === 'me' ? owner : enemyIdx;
      const p = state.players[idx];
      const moved = p.deck.splice(0, clampN(n));
      p.ap.push(...moved);
      if (moved.length > 0) {
        pushLog(state, `P${idx + 1}はデッキから${moved.length}枚チャージ（AP: ${p.ap.length}）`);
        emit(state, { t: 'chargeDeck', player: idx, n: moved.length, ap: p.ap.length });
      }
    },
    chargeAllHand: () => {
      const p = me();
      const n = p.hand.length;
      p.ap.push(...p.hand.splice(0));
      if (n > 0) {
        pushLog(state, `P${owner + 1}は手札を全てチャージ（${n}枚）`);
        emit(state, { t: 'chargeAllHand', player: owner, n });
      }
    },
    chargeFromTrashBottom: (n) => {
      const p = me();
      const moved = p.trash.splice(0, clampN(n));
      p.ap.push(...moved);
      if (moved.length > 0) {
        pushLog(state, `P${owner + 1}はトラッシュから${moved.length}枚チャージ（AP: ${p.ap.length}）`);
        emit(state, { t: 'chargeTrash', player: owner, n: moved.length, ap: p.ap.length });
      }
    },
    drawCards: (who, n) => {
      const idx = who === 'me' ? owner : enemyIdx;
      const p = state.players[idx];
      const before = p.hand.length;
      p.hand.push(...p.deck.splice(0, clampN(n)));
      const drawn = p.hand.length - before;
      if (drawn > 0) {
        pushLog(state, `プレイヤー${idx + 1}が${drawn}枚ドロー`);
        emit(state, { t: 'draw', player: idx, n: drawn });
      }
    },
    discardHandAll: () => {
      const p = me();
      const n = p.hand.length;
      p.trash.push(...p.hand.splice(0));
      if (n > 0) {
        pushLog(state, `P${owner + 1}は手札を全てトラッシュ（${n}枚）`);
        emit(state, { t: 'handTrash', player: owner, n });
      }
    },
    millDeck: (who, n) => {
      const idx = who === 'me' ? owner : enemyIdx;
      const p = state.players[idx];
      const moved = p.deck.splice(0, clampN(n));
      p.trash.push(...moved);
      if (moved.length > 0) {
        pushLog(state, `P${idx + 1}のデッキから${moved.length}枚トラッシュ`);
        emit(state, { t: 'mill', player: idx, n: moved.length });
      }
    },
    discardEnemyAp: (n) => {
      const p = enemy();
      const moved = p.ap.splice(0, clampN(n));
      p.trash.push(...moved);
      if (moved.length > 0) {
        pushLog(state, `P${enemyIdx + 1}のAPから${moved.length}枚トラッシュ`);
        emit(state, { t: 'apTrash', player: enemyIdx, n: moved.length });
      }
    },
    damageEnemyActor: (n) => {
      applyDamage(state, enemyIdx, enemy().actorIndex, clampN(n));
    },
    damageAttacker: (n) => {
      const pending = state.pendingAttack;
      if (pending && enemyIdx === state.active) {
        // 攻撃中で、自分（効果の持ち主）が防御側なら、攻撃してきた使用キャラ本人へ
        applyDamage(state, state.active, pending.attackerChar, clampN(n));
      } else {
        applyDamage(state, enemyIdx, enemy().actorIndex, clampN(n));
      }
    },
    damageAllEnemies: (n) => {
      const targets = enemy().characters.map((_, i) => i);
      const judgedActor = enemy().actorIndex; // 途中の強制交代に影響されない
      for (const i of targets) {
        if (state.phase === 'finished') return;
        if (isCharAlive(state, enemyIdx, i)) applyDamage(state, enemyIdx, i, clampN(n), judgedActor, true);
      }
      // 全対象処理後にまとめて強制交代
      if (state.phase !== 'finished' && !isCharAlive(state, enemyIdx, enemy().actorIndex)) {
        enemy().actorIndex = nextAliveIndex(state, enemyIdx, enemy().actorIndex);
        pushLog(state, `P${enemyIdx + 1}のアクターが${enemy().characters[enemy().actorIndex].name}（${enemy().actorIndex + 1}番手）に強制交代`);
        emit(state, { t: 'actorChanged', player: enemyIdx, charIndex: enemy().actorIndex, forced: true });
      }
    },
    damageTarget: (n) => {
      const t = firstTarget();
      if (t !== null) applyDamage(state, defenderIdx(), t, clampN(n));
    },
    healSelf: (n) => healCharacter(state, owner, ownerChar, clampN(n)),
    healMyActor: (n) => healCharacter(state, owner, me().actorIndex, clampN(n)),
    healAllAllies: (n) => {
      me().characters.forEach((_, i) => {
        if (isCharAlive(state, owner, i)) healCharacter(state, owner, i, clampN(n));
      });
    },
    reviveAlly: (hp) => {
      const p = me();
      let best = -1;
      p.characters.forEach((c, i) => {
        if (!isCharAlive(state, owner, i)) {
          if (best === -1 || c.maxHp > p.characters[best].maxHp) best = i;
        }
      });
      if (best === -1) return;
      const c = p.characters[best];
      c.damage = Math.max(0, maxHpOf(state, owner, best) - Math.max(1, hp));
      pushLog(state, `P${owner + 1}の${c.name}が復活（HP${Math.max(1, hp)}）`);
      emit(state, { t: 'revive', player: owner, charIndex: best, hp: Math.max(1, hp) });
    },
    addAttributeToSelf: (attr, n = 1) => {
      const c = me().characters[ownerChar];
      for (let i = 0; i < n && c.addedAttributes.length < MAX_ADDED_ATTRIBUTES; i++) {
        c.addedAttributes.push(attr);
      }
      pushLog(state, `P${owner + 1}の${c.name}に${attr}属性を追加`);
      emit(state, { t: 'attributeAdded', player: owner, charIndex: ownerChar, attr });
    },
    addAttributeToAllAllies: (attr) => {
      me().characters.forEach((c, i) => {
        if (isCharAlive(state, owner, i) && c.addedAttributes.length < MAX_ADDED_ATTRIBUTES) {
          c.addedAttributes.push(attr);
        }
      });
    },
    returnTrashBottomToDeck: (n) => {
      const p = me();
      const moved = p.trash.splice(0, clampN(n));
      p.deck.push(...moved); // デッキの下に戻す
      if (moved.length > 0) {
        pushLog(state, `P${owner + 1}はトラッシュから${moved.length}枚をデッキに戻した`);
        emit(state, { t: 'trashToDeck', player: owner, n: moved.length });
      }
    },
    lockEnemyActor: () => {
      enemy().actorLockUntilTurn = state.turn + 1;
      pushLog(state, `P${enemyIdx + 1}のアクターをロック（ターン${state.turn + 1}終了まで）`);
      emit(state, { t: 'actorLocked', player: enemyIdx, untilTurn: state.turn + 1 });
    },
    lockMyActor: () => {
      me().actorLockUntilTurn = state.turn + 1;
      pushLog(state, `P${owner + 1}のアクターをロック（ターン${state.turn + 1}終了まで）`);
      emit(state, { t: 'actorLocked', player: owner, untilTurn: state.turn + 1 });
    },
    unlockMyActor: () => {
      if (actorLocked(state, owner)) {
        pushLog(state, `P${owner + 1}のアクターのロックを解除`);
        emit(state, { t: 'actorUnlocked', player: owner });
      }
      me().actorLockUntilTurn = 0;
    },
    forceChangeEnemyActor: () => {
      if (actorLocked(state, enemyIdx)) {
        pushLog(state, 'アクターがロックされていて変更できない');
        emit(state, { t: 'lockBlocked', player: enemyIdx });
        return;
      }
      const p = enemy();
      p.actorIndex = nextAliveIndex(state, enemyIdx, p.actorIndex, rotationSkip(state, enemyIdx));
      pushLog(state, `P${enemyIdx + 1}のアクターが${p.characters[p.actorIndex].name}（${p.actorIndex + 1}番手）に変更`);
      emit(state, { t: 'actorChanged', player: enemyIdx, charIndex: p.actorIndex, forced: true });
    },
    changeMyActor: (skip = 0) => {
      if (actorLocked(state, owner)) {
        pushLog(state, 'アクターがロックされていて変更できない');
        emit(state, { t: 'lockBlocked', player: owner });
        return;
      }
      const p = me();
      p.actorIndex = nextAliveIndex(state, owner, p.actorIndex, skip);
      pushLog(state, `プレイヤー${owner + 1}のアクターが${p.characters[p.actorIndex].name}（${p.actorIndex + 1}番手）に交代`);
      emit(state, { t: 'actorChanged', player: owner, charIndex: p.actorIndex, forced: false });
      state.skipRotationFor = owner; // 効果でアクターを動かしたので自動交代はしない
    },
    becomeActor: () => {
      if (actorLocked(state, owner)) {
        pushLog(state, 'アクターがロックされていて変更できない');
        emit(state, { t: 'lockBlocked', player: owner });
        return;
      }
      if (isCharAlive(state, owner, ownerChar)) {
        me().actorIndex = ownerChar;
        pushLog(state, `プレイヤー${owner + 1}のアクターが${me().characters[ownerChar].name}（${ownerChar + 1}番手）に交代`);
        emit(state, { t: 'actorChanged', player: owner, charIndex: ownerChar, forced: false });
        state.skipRotationFor = owner; // 効果でアクターを決めたので自動交代はしない
      }
    },
    reduceNextSkillCost: (n) => {
      me().nextSkillCostDelta -= clampN(n);
    },
    reduceEnemyNextDraw: (n) => {
      enemy().nextDrawDelta -= clampN(n);
    },
    reduceIncomingDamage: (n) => {
      me().incomingDamageReduction = { value: clampN(n), untilTurn: state.turn + 1 };
    },
    searchDeckToHand: (filter) => {
      const p = me();
      const idx = p.deck.findIndex(filter);
      if (idx === -1) return false;
      const [card] = p.deck.splice(idx, 1);
      p.hand.push(card);
      // 見たのでシャッフル
      for (let i = p.deck.length - 1; i > 0; i--) {
        const j = Math.floor(stepRng(state) * (i + 1));
        [p.deck[i], p.deck[j]] = [p.deck[j], p.deck[i]];
      }
      pushLog(state, `デッキから${cardById(card).name}を手札に加えた`);
      emit(state, { t: 'searchToHand', player: owner, cardId: card });
      return true;
    },
    selfHasEquipment: () => me().characters[ownerChar].equipmentCardId !== null,
    destroyTargetEquipment: () => {
      const t = firstTarget();
      if (t === null) return;
      const c = state.players[defenderIdx()].characters[t];
      if (c.equipmentCardId) {
        state.players[defenderIdx()].trash.push(c.equipmentCardId);
        pushLog(state, `P${defenderIdx() + 1}の${c.name}の装備${cardById(c.equipmentCardId).name}を破壊`);
        emit(state, { t: 'equipDestroyed', player: defenderIdx(), charIndex: t, cardId: c.equipmentCardId });
        c.equipmentCardId = null;
      }
    },
    handUsableSkillCount: (by) => {
      const p = me();
      const ci = by === 'self' ? ownerChar : p.actorIndex;
      let count = 0;
      for (const id of p.hand) {
        const card = cardById(id);
        if (card.type !== 'skill') continue;
        if (containsAll(effectiveAttributes(state, owner, ci), card.conditionAttribute)) count++;
      }
      return count;
    },
    consumeAllMyAp: () => {
      const p = me();
      const n = p.ap.length;
      p.trash.push(...p.ap.splice(0));
      if (n > 0) {
        pushLog(state, `P${owner + 1}のAPから${n}枚トラッシュ`);
        emit(state, { t: 'apTrash', player: owner, n });
      }
      return n;
    },
    damageSelf: (n) => {
      applyDamage(state, owner, ownerChar, clampN(n));
    },
    castFromDeck: ({ maxCost, attr }) => {
      const p = me();
      const idx = p.deck.findIndex((id) => {
        const card = cardById(id);
        return (
          card.type === 'skill' &&
          card.valueType !== 'guard' && // guardは割り込み専用なのでデッキからは使えない
          card.costAp <= maxCost &&
          card.conditionAttribute.includes(attr)
        );
      });
      if (idx === -1) {
        pushLog(state, 'デッキに条件に合うカードが無かった');
        emit(state, { t: 'info', text: 'デッキに条件に合うカードが無かった' });
        return;
      }
      const [id] = p.deck.splice(idx, 1);
      const card = cardById(id) as SkillCard;
      p.trash.push(id);
      pushLog(state, `デッキから${card.name}をコストなしで使用`);
      emit(state, { t: 'castFromDeck', player: owner, charIndex: ownerChar, cardId: id });
      // スキルを本当に「使用」する（効果込み）。奇襲扱いでguard割り込みは不可。
      // もとのスキルの効果の一部なので、ここでは絶対にローテーションさせない
      // （させると「1スキルで2回スイッチ」が起きる）
      if (card.valueType === 'attack') {
        beginAttack(state, card, ownerChar, undefined, true, true);
      } else {
        resolveNonAttack(state, card, ownerChar);
        // ローテーションは外側のスキルの処理に任せる（skipRotationForもそのまま引き継ぐ）
      }
    },
    log: (message) => pushLog(state, message),
  };
  return api;
}

// ---------------------------------------------------------------- ダメージ・回復の共通処理

/**
 * ダメージ適用（効果ダメージ・攻撃解決の両方が通る唯一の道）。
 * judgedActor: 「アクターかどうか」の判定に使うアクター番号。
 * 全体攻撃の途中でアクターが戦闘不能→強制交代しても、後続の対象が
 * 「攻撃開始時点では控えだった」ことを正しく扱うために、呼び出し側が
 * 攻撃列の開始時点のアクターを渡せる（省略時は現在のアクター）。
 */
function applyDamage(
  state: BattleState,
  player: PlayerIndex,
  charIndex: number,
  amount: number,
  judgedActor?: number,
  deferForcedSwitch = false,
): number {
  if (state.phase === 'finished' || amount <= 0) return 0;
  const p = state.players[player];
  const c = p.characters[charIndex];
  if (!isCharAlive(state, player, charIndex)) return 0;
  const actorRef = judgedActor ?? p.actorIndex;

  // ビコウ: 控えにいる時はダメージを受けない
  const eff = characterEffectOf(c.cardId);
  if (eff?.standbyImmune && charIndex !== actorRef) {
    pushLog(state, `P${player + 1}の${c.name}は控えのためダメージを受けない`);
    emit(state, { t: 'standbyImmune', player, charIndex });
    return 0;
  }

  const maxHp = maxHpOf(state, player, charIndex);
  const actual = Math.min(amount, maxHp - c.damage);
  c.damage += actual;
  pushLog(state, `P${player + 1}の${c.name}に${actual}ダメージ（残りHP: ${maxHp - c.damage}）`);
  emit(state, { t: 'damage', player, charIndex, n: actual, hpLeft: maxHp - c.damage });

  // 被ダメージ時の常時能力（ミルオン・ボーダン）。アクター判定は攻撃列の開始時点で行う
  if (actual > 0 && eff?.onDamaged && isCharAlive(state, player, charIndex)) {
    runEffectSafely(
      state,
      `${c.name}の被ダメージ能力`,
      () => eff.onDamaged!(makeApi(state, player, charIndex), actual, charIndex === actorRef),
      { player, charIndex },
    );
  }

  // 戦闘不能処理
  if (!isCharAlive(state, player, charIndex)) {
    pushLog(state, `P${player + 1}の${c.name}は戦闘不能`);
    emit(state, { t: 'ko', player, charIndex });
    // 味方戦闘不能時の常時能力（レオン・ソーベルト。倒れた本人も発動する）
    p.characters.forEach((ally, i) => {
      const allyEff = characterEffectOf(ally.cardId);
      if (!allyEff?.onAllyKo) return;
      if (i !== charIndex && !isCharAlive(state, player, i)) return;
      runEffectSafely(state, `${ally.name}の能力`, () => allyEff.onAllyKo!(makeApi(state, player, i)), { player, charIndex: i });
    });
    if (battleOver(state)) return actual;
    if (aliveCount(state, player) === 0) {
      finish(state, (1 - player) as PlayerIndex, 'wipeout');
      return actual;
    }
    // アクターが倒れたら強制交代（ロックより優先）
    // 全体攻撃などの複数対象処理中は、処理が終わるまで陣形を維持する（deferForcedSwitch）
    if (charIndex === p.actorIndex && !deferForcedSwitch) {
      p.actorIndex = nextAliveIndex(state, player, p.actorIndex);
      pushLog(state, `P${player + 1}のアクターが${p.characters[p.actorIndex].name}（${p.actorIndex + 1}番手）に強制交代`);
      emit(state, { t: 'actorChanged', player, charIndex: p.actorIndex, forced: true });
    }
  }
  return actual;
}

function healCharacter(state: BattleState, player: PlayerIndex, charIndex: number, amount: number): number {
  if (state.phase === 'finished' || amount <= 0) return 0;
  const p = state.players[player];
  const c = p.characters[charIndex];
  if (!isCharAlive(state, player, charIndex)) return 0; // 戦闘不能は通常回復できない
  const healed = Math.min(amount, c.damage);
  c.damage -= healed;
  if (healed > 0) {
    pushLog(state, `P${player + 1}の${c.name}を${healed}回復`);
    emit(state, { t: 'heal', player, charIndex, n: healed });
    const eff = characterEffectOf(c.cardId);
    if (eff?.onHealed) {
      runEffectSafely(
        state,
        `${c.name}の回復時能力`,
        () => eff.onHealed!(makeApi(state, player, charIndex), healed),
        { player, charIndex },
      );
    }
  }
  return healed;
}

// ---------------------------------------------------------------- バトル作成

export interface CreateBattleOptions {
  firstPlayer?: PlayerIndex;
  validate?: boolean;
  /** 実験用のデッキ構築ルール（省略時は公式ルール） */
  deckRules?: DeckRules;
  /** このプレイヤーの任意能力（アニマ等）は自動発動せず、手動アクションで発動する */
  manualFor?: PlayerIndex;
}

export function createBattle(
  decks: [DeckList, DeckList],
  seed: number,
  options: CreateBattleOptions = {},
): BattleState {
  const rng = mulberry32(seed);

  if (options.validate !== false) {
    decks.forEach((deck, i) => {
      const problems = deckProblems(deck, options.deckRules ?? DEFAULT_DECK_RULES);
      if (problems.length > 0) {
        throw new Error(`プレイヤー${i + 1}のデッキが不正です: ${problems.join(' / ')}`);
      }
    });
  }

  const firstPlayer: PlayerIndex = options.firstPlayer ?? (rng() < 0.5 ? 0 : 1);

  const players = decks.map((deck) => {
    const shuffledDeck = shuffled(deck.cardIds, rng);
    const characters: CharacterInstance[] = deck.characterIds.map((id) => {
      const card = cardById(id) as CharacterCard;
      return {
        cardId: card.id,
        name: card.name,
        maxHp: card.hp,
        attributes: [...card.attribute],
        addedAttributes: [],
        damage: 0,
        equipmentCardId: null,
      };
    });
    const player: PlayerBattle = {
      deck: shuffledDeck,
      hand: shuffledDeck.splice(0, HAND_REFILL_TO),
      trash: [],
      ap: [],
      characters,
      actorIndex: 0,
      skillsUsedThisTurn: 0,
      nextSkillCostDelta: 0,
      nextDrawDelta: 0,
      actorLockUntilTurn: 0,
      incomingDamageReduction: null,
    };
    return player;
  }) as [PlayerBattle, PlayerBattle];

  const second = players[(1 - firstPlayer) as PlayerIndex];
  second.ap.push(...second.deck.splice(0, SECOND_PLAYER_STARTING_AP));

  const state: BattleState = {
    turn: 1,
    active: firstPlayer,
    phase: 'play',
    players,
    firstPlayer,
    pendingAttack: null,
    skipRotationFor: null,
    manualFor: options.manualFor ?? null,
    field: null,
    winner: null,
    endReason: null,
    rngState: (seed * 2654435761) >>> 0,
    effectDepth: 0,
    log: [`バトル開始。先攻: プレイヤー${firstPlayer + 1}`],
    logSeq: 1,
    events: [],
    eventSeq: 0,
  };
  pushLog(
    state,
    `後攻のP${(1 - firstPlayer) + 1}はデッキから${SECOND_PLAYER_STARTING_AP}枚チャージ（AP: ${second.ap.length}）`,
  );
  emit(state, { t: 'battleStart', first: firstPlayer });
  emit(state, { t: 'bonusCharge', player: (1 - firstPlayer) as PlayerIndex, n: SECOND_PLAYER_STARTING_AP });

  // バトル開始時の常時能力（先攻側から）
  for (const pIdx of [firstPlayer, (1 - firstPlayer) as PlayerIndex]) {
    state.players[pIdx].characters.forEach((c, i) => {
      const eff = characterEffectOf(c.cardId);
      if (eff?.onBattleStart) {
        runEffectSafely(
          state,
          `${c.name}のバトル開始能力`,
          () => eff.onBattleStart!(makeApi(state, pIdx, i)),
          { player: pIdx, charIndex: i },
        );
      }
    });
  }

  beginTurn(state);
  return state;
}

// ---------------------------------------------------------------- ターン進行

function beginTurn(state: BattleState): void {
  const p = state.players[state.active];
  p.skillsUsedThisTurn = 0;

  // 任意のターン開始能力（アニマ等）は「ドローの前に1回だけ」選択する
  const hasManualChoice =
    state.manualFor === state.active &&
    !isActorLocked(state, state.active) && // ロック中はアクター変更系の選択肢自体を出さない
    p.characters.some(
      (c, i) =>
        isCharAlive(state, state.active, i) &&
        i !== p.actorIndex &&
        characterEffectOf(c.cardId)?.turnStartAction,
    );
  if (hasManualChoice) {
    state.phase = 'choice';
    return; // 選択（またはスキップ）後に runTurnStartAndDraw が呼ばれる
  }

  runAutoTurnStart(state);
  if (!battleOver(state)) drawPhase(state);
}

/** AI側などの自動ターン開始能力（ドロー前） */
function runAutoTurnStart(state: BattleState): void {
  const p = state.players[state.active];
  p.characters.forEach((c, i) => {
    if (battleOver(state)) return;
    if (!isCharAlive(state, state.active, i)) return;
    const eff = characterEffectOf(c.cardId);
    if (!eff?.onOwnTurnStart) return;
    if (state.manualFor === state.active && eff.turnStartAction) return;
    runEffectSafely(
      state,
      `${c.name}のターン開始能力`,
      () => eff.onOwnTurnStart!(makeApi(state, state.active, i), i === p.actorIndex),
      { player: state.active, charIndex: i },
    );
  });
}

/** ドローフェーズ本体 */
function drawPhase(state: BattleState): void {
  const p = state.players[state.active];

  // 手札上限（アイ: +1）
  let cap = HAND_REFILL_TO;
  p.characters.forEach((c, i) => {
    if (!isCharAlive(state, state.active, i)) return;
    cap += characterEffectOf(c.cardId)?.handRefillBonus ?? 0;
  });
  if (state.field) cap += fieldEffectOf(state.field.cardId)?.drawBonusAll ?? 0;

  const need = Math.max(0, cap - p.hand.length);
  const drawCount = Math.max(0, need + p.nextDrawDelta);
  p.nextDrawDelta = 0;

  if (drawCount > 0) {
    const drawn = Math.min(drawCount, p.deck.length);
    p.hand.push(...p.deck.splice(0, drawn));
    if (drawn > 0) {
      pushLog(state, `プレイヤー${state.active + 1}が${drawn}枚ドロー`);
      emit(state, { t: 'draw', player: state.active, n: drawn });
    }
    if (p.hand.length < HAND_REFILL_TO && p.deck.length === 0 && drawn < drawCount) {
      pushLog(state, `プレイヤー${state.active + 1}は山札切れで手札を${HAND_REFILL_TO}枚にできない`);
      emit(state, { t: 'deckout', player: state.active });
      finish(state, (1 - state.active) as PlayerIndex, 'deckout');
      return;
    }
  }
  state.phase = 'play';
}

// ---------------------------------------------------------------- スキルの使用判定

/** スキルの実際の消費AP（キャラ能力・スイッチ・カード自身の修正込み） */
export function effectiveSkillCost(
  state: BattleState,
  player: PlayerIndex,
  card: SkillCard,
  usingChar?: number,
): number {
  const p = state.players[player];
  const ci = usingChar ?? p.actorIndex;
  let cost = card.costAp;
  cost += characterEffectOf(p.characters[ci].cardId)?.skillCostDelta ?? 0;
  const equipId = p.characters[ci].equipmentCardId;
  if (equipId) cost += equipmentEffectOf(equipId)?.skillCostDelta ?? 0;
  if (state.field) cost += fieldEffectOf(state.field.cardId)?.skillCostDeltaAll ?? 0;
  cost += p.nextSkillCostDelta;
  const eff = skillEffectOf(card.id);
  if (eff?.costDelta) {
    try {
      cost += eff.costDelta(makeApi(state, player, ci));
    } catch {
      /* 無視 */
    }
  }
  return Math.max(0, cost);
}

/** このスキルを使えるキャラの候補一覧。guardはアクター専用（控えは使えない）。
 * アクターがロック中は「控えから使える」スキルも控えからは使えない
 * （飛び出る等でロックをすり抜けられないように）。 */
export function eligibleUsingChars(state: BattleState, player: PlayerIndex, card: SkillCard): number[] {
  const p = state.players[player];
  const eff = skillEffectOf(card.id);
  const anyOk = card.valueType !== 'guard' && eff?.anyCharacterCanUse && !isActorLocked(state, player);
  const candidates = anyOk
    ? p.characters.map((_, i) => i).filter((i) => isCharAlive(state, player, i))
    : [p.actorIndex];
  return candidates.filter((ci) => containsAll(effectiveAttributes(state, player, ci), card.conditionAttribute));
}

/** このスキルを使うキャラの番号を返す（使えなければ null）。requested で使用キャラを指定できる */
export function resolveUsingChar(
  state: BattleState,
  player: PlayerIndex,
  card: SkillCard,
  requested?: number,
): number | null {
  const eligible = eligibleUsingChars(state, player, card);
  if (requested !== undefined) return eligible.includes(requested) ? requested : null;
  return eligible.length > 0 ? eligible[0] : null;
}

export function canPlaySkill(state: BattleState, player: PlayerIndex, skill: SkillCard): boolean {
  const ci = resolveUsingChar(state, player, skill);
  if (ci === null) return false;
  return state.players[player].ap.length >= effectiveSkillCost(state, player, skill, ci);
}

export function canPlayCharacterCard(
  state: BattleState,
  player: PlayerIndex,
  card: CharacterCard,
): boolean {
  return state.players[player].characters.some(
    (c, i) => c.name === card.name && isCharAlive(state, player, i),
  );
}

function guardOptions(state: BattleState, defender: PlayerIndex): number[] {
  const p = state.players[defender];
  const options: number[] = [];
  p.hand.forEach((id, i) => {
    const card = cardById(id);
    if (card.type === 'skill' && card.valueType === 'guard' && canPlaySkill(state, defender, card)) {
      options.push(i);
    }
  });
  return options;
}

export function legalActions(state: BattleState): BattleAction[] {
  if (state.phase === 'finished') return [];
  const actions: BattleAction[] = [];

  if (state.phase === 'choice') {
    const p = state.players[state.active];
    p.characters.forEach((c, i) => {
      if (!isCharAlive(state, state.active, i) || i === p.actorIndex) return;
      // アクターがロック中は、アニマ等の「アクターになる」選択肢も出さない
      if (isActorLocked(state, state.active)) return;
      if (characterEffectOf(c.cardId)?.turnStartAction) {
        actions.push({ type: 'turnStartAbility', charIndex: i });
      }
    });
    actions.push({ type: 'skipTurnStart' });
    return actions;
  }

  if (state.phase === 'play') {
    const p = state.players[state.active];
    const enemyIdx = (1 - state.active) as PlayerIndex;
    const enemy = state.players[enemyIdx];
    p.hand.forEach((id, handIndex) => {
      const card = cardById(id);
      if (card.type === 'skill' && card.valueType !== 'guard' && canPlaySkill(state, state.active, card)) {
        const eff = skillEffectOf(card.id);
        if (eff?.anyCharacterCanUse) {
          // 使用キャラを選べる（控えからも使えるスキル）
          for (const ci of eligibleUsingChars(state, state.active, card)) {
            actions.push({ type: 'playSkill', handIndex, usingIndex: ci });
          }
        } else if (card.valueType === 'heal' && eff?.healTargeting === 'ko') {
          // 復活スキル: 戦闘不能の味方だけが対象。誰も倒れていなければ使えない
          p.characters.forEach((_, i) => {
            if (!isCharAlive(state, state.active, i)) {
              actions.push({ type: 'playSkill', handIndex, healTargetIndex: i });
            }
          });
        } else if (card.valueType === 'heal') {
          p.characters.forEach((c, i) => {
            if (isCharAlive(state, state.active, i)) {
              actions.push({ type: 'playSkill', handIndex, healTargetIndex: i });
            }
          });
        } else if (card.valueType === 'attack' && eff?.targeting === 'choose') {
          enemy.characters.forEach((_, i) => {
            if (isCharAlive(state, enemyIdx, i)) {
              actions.push({ type: 'playSkill', handIndex, targetIndex: i });
            }
          });
        } else {
          actions.push({ type: 'playSkill', handIndex });
        }
      }
      if (card.type === 'character' && canPlayCharacterCard(state, state.active, card)) {
        actions.push({ type: 'playCharacter', handIndex });
      }
      if (card.type === 'equipment') {
        p.characters.forEach((_, i) => {
          if (isCharAlive(state, state.active, i)) {
            actions.push({ type: 'playEquipment', handIndex, targetIndex: i });
          }
        });
      }
      if (card.type === 'field') {
        actions.push({ type: 'playField', handIndex });
      }
    });
    actions.push({ type: 'endPlay' });
  }

  if (state.phase === 'guard') {
    for (const handIndex of guardOptions(state, actingPlayer(state))) {
      actions.push({ type: 'playGuard', handIndex });
    }
    actions.push({ type: 'pass' });
  }

  if (state.phase === 'charge') {
    state.players[state.active].hand.forEach((_, handIndex) => actions.push({ type: 'charge', handIndex }));
    actions.push({ type: 'endTurn' });
  }

  return actions;
}

// ---------------------------------------------------------------- 行動の適用

export function applyAction(state: BattleState, action: BattleAction): void {
  if (state.phase === 'finished') throw new Error('バトルは終了しています');
  if (action.type !== 'playGuard' && action.type !== 'pass') {
    state.skipRotationFor = null; // 攻撃解決をまたぐ場合以外はリセット
  }

  switch (action.type) {
    case 'playSkill': {
      requirePhase(state, 'play');
      const p = state.players[state.active];
      const card = cardAtHand(p, action.handIndex);
      if (card.type !== 'skill') throw new Error(`スキルカードではありません: ${card.name}`);
      if (card.valueType === 'guard') {
        throw new Error(`guardスキルは攻撃された時にだけ使えます: ${card.name}`);
      }
      const usingChar = resolveUsingChar(state, state.active, card, action.usingIndex);
      if (usingChar === null) throw new Error(`属性の条件を満たしていません: ${card.name}`);
      const cost = effectiveSkillCost(state, state.active, card, usingChar);
      if (p.ap.length < cost) throw new Error(`APが足りません: ${card.name}`);

      p.trash.push(...p.ap.splice(0, cost));
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      p.skillsUsedThisTurn++;
      p.nextSkillCostDelta = 0; // コスト修正は1回で消費
      pushLog(state, `P${state.active + 1}の${p.characters[usingChar].name}（${usingChar + 1}番手）が${card.name}を使用`);
      emit(state, { t: 'skillUsed', player: state.active, charIndex: usingChar, cardId: card.id });
      if (card.effectText !== '' && !hasEffectImplementation(card.id)) {
        pushLog(state, `※${card.name}の効果は未実装: 「${card.effectText}」`);
      }

      if (card.valueType === 'attack') {
        beginAttack(state, card, usingChar, action.targetIndex);
      } else {
        const wasActor = usingChar === p.actorIndex;
        resolveNonAttack(state, card, usingChar, action.healTargetIndex);
        // 自動ローテーションは「使用キャラがまだアクターのまま」の時だけ
        // （控えの使用や、効果中の強制交代があった場合は回さない）
        if (!battleOver(state)) {
          if (wasActor && p.actorIndex === usingChar) rotateActorAfterSkill(state, state.active);
          else if (state.skipRotationFor === state.active) state.skipRotationFor = null;
        }
      }
      return;
    }

    case 'playGuard': {
      requirePhase(state, 'guard');
      const defender = actingPlayer(state);
      const p = state.players[defender];
      const card = cardAtHand(p, action.handIndex);
      if (card.type !== 'skill' || card.valueType !== 'guard') {
        throw new Error(`guardスキルではありません: ${card.name}`);
      }
      if (!canPlaySkill(state, defender, card)) {
        throw new Error(`guardを使う条件を満たしていません: ${card.name}`);
      }
      const pending = state.pendingAttack;
      if (!pending) throw new Error('割り込む攻撃がありません');

      const cost = effectiveSkillCost(state, defender, card);
      p.trash.push(...p.ap.splice(0, cost));
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      if (card.effectText !== '' && !hasEffectImplementation(card.id)) {
        pushLog(state, `※${card.name}の効果は未実装: 「${card.effectText}」`);
      }

      // ガードはアクター本人が使い、軽減されるのは本人への被弾のみ（全体攻撃の他対象には効かない）
      pending.guard = { charIndex: p.actorIndex, value: card.baseValue };
      // 演出順: カットイン（割り込み宣言）→ ガード効果 → 解決
      pushLog(
        state,
        `${card.name}で割り込み（${pending.value} → 残りダメージ${Math.max(0, pending.value - card.baseValue)}）`,
      );
      emit(state, {
        t: 'guardPlayed',
        player: defender,
        charIndex: p.actorIndex,
        cardId: card.id,
        before: pending.value,
        after: Math.max(0, pending.value - card.baseValue),
      });
      const eff = skillEffectOf(card.id);
      if (eff?.onGuardDeclare) {
        runEffectSafely(
          state,
          `${card.name}のguard効果`,
          () => eff.onGuardDeclare!(makeApi(state, defender, p.actorIndex)),
          { player: defender, charIndex: p.actorIndex },
        );
      }

      // ガードは1回の攻撃に1枚まで。使ったら即解決する
      if (state.phase === 'guard') {
        resolvePendingAttack(state);
      }
      return;
    }

    case 'pass': {
      requirePhase(state, 'guard');
      resolvePendingAttack(state);
      return;
    }

    case 'playEquipment': {
      requirePhase(state, 'play');
      const p = state.players[state.active];
      const card = cardAtHand(p, action.handIndex);
      if (card.type !== 'equipment') throw new Error(`装備カードではありません: ${card.name}`);
      const target = p.characters[action.targetIndex];
      if (!target || !isCharAlive(state, state.active, action.targetIndex)) {
        throw new Error('装備は生きている味方にだけ付けられます');
      }
      // 付け替えOK: 古い装備はトラッシュへ
      if (target.equipmentCardId) {
        p.trash.push(target.equipmentCardId);
        pushLog(state, `P${state.active + 1}の${target.name}の${cardById(target.equipmentCardId).name}を外してトラッシュ`);
        emit(state, { t: 'info', text: `${target.name}の${cardById(target.equipmentCardId).name}は外れた` });
      }
      p.hand.splice(action.handIndex, 1);
      target.equipmentCardId = card.id;
      pushLog(state, `P${state.active + 1}の${target.name}に${card.name}を装備`);
      emit(state, { t: 'equip', player: state.active, charIndex: action.targetIndex, cardId: card.id });
      return;
    }

    case 'playField': {
      requirePhase(state, 'play');
      const p = state.players[state.active];
      const card = cardAtHand(p, action.handIndex);
      if (card.type !== 'field') throw new Error(`フィールドカードではありません: ${card.name}`);
      // 上書きOK: 古いフィールドは持ち主のトラッシュへ
      if (state.field) {
        state.players[state.field.owner].trash.push(state.field.cardId);
        pushLog(state, `${cardById(state.field.cardId).name}は上書きされてトラッシュへ`);
        emit(state, { t: 'info', text: `${cardById(state.field.cardId).name}は上書きされた` });
      }
      p.hand.splice(action.handIndex, 1);
      state.field = { cardId: card.id, owner: state.active };
      pushLog(state, `フィールド${card.name}を展開`);
      emit(state, { t: 'fieldSet', player: state.active, cardId: card.id });
      return;
    }

    case 'playCharacter': {
      requirePhase(state, 'play');
      const p = state.players[state.active];
      const card = cardAtHand(p, action.handIndex);
      if (card.type !== 'character') throw new Error(`キャラクターカードではありません: ${card.name}`);
      if (!canPlayCharacterCard(state, state.active, card)) {
        throw new Error(`同名の生きているキャラクターがいません: ${card.name}`);
      }
      let best = -1;
      p.characters.forEach((c, i) => {
        if (c.name === card.name && isCharAlive(state, state.active, i)) {
          if (best === -1 || c.damage > p.characters[best].damage) best = i;
        }
      });
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      pushLog(state, `${card.name}のカードを使用`);
      emit(state, { t: 'characterCardUsed', player: state.active, cardId: card.id });
      healCharacter(state, state.active, best, CHARACTER_CARD_HEAL);
      return;
    }

    case 'turnStartAbility': {
      requirePhase(state, 'choice');
      const p = state.players[state.active];
      const c = p.characters[action.charIndex];
      if (!c || !isCharAlive(state, state.active, action.charIndex)) {
        throw new Error('そのキャラクターは能力を使えません');
      }
      const eff = characterEffectOf(c.cardId);
      if (!eff?.turnStartAction) throw new Error('任意のターン開始能力がありません');
      runEffectSafely(
        state,
        `${c.name}のターン開始能力`,
        () => eff.turnStartAction!(makeApi(state, state.active, action.charIndex)),
        { player: state.active, charIndex: action.charIndex },
      );
      if (!battleOver(state)) drawPhase(state);
      return;
    }

    case 'skipTurnStart': {
      requirePhase(state, 'choice');
      drawPhase(state);
      return;
    }

    case 'endPlay': {
      requirePhase(state, 'play');
      state.phase = 'charge';
      return;
    }

    case 'charge': {
      requirePhase(state, 'charge');
      const p = state.players[state.active];
      const card = cardAtHand(p, action.handIndex);
      p.hand.splice(action.handIndex, 1);
      p.ap.push(card.id);
      pushLog(state, `プレイヤー${state.active + 1}が${card.name}をチャージ（AP: ${p.ap.length}）`);
      emit(state, { t: 'chargeHand', player: state.active, cardId: card.id, ap: p.ap.length });
      return;
    }

    case 'endTurn': {
      requirePhase(state, 'charge');
      // ターン終了時の常時能力（ジエンド・ヤクビ・グロウ）
      const p = state.players[state.active];
      p.characters.forEach((c, i) => {
        if (battleOver(state)) return;
        if (!isCharAlive(state, state.active, i)) return;
        const eff = characterEffectOf(c.cardId);
        if (eff?.onOwnTurnEnd) {
          runEffectSafely(
            state,
            `${c.name}のターン終了能力`,
            () => eff.onOwnTurnEnd!(makeApi(state, state.active, i), i === p.actorIndex),
            { player: state.active, charIndex: i },
          );
        }
        const equipEff = c.equipmentCardId ? equipmentEffectOf(c.equipmentCardId) : null;
        if (equipEff?.onOwnTurnEnd) {
          runEffectSafely(
            state,
            `${c.name}の装備効果`,
            () => equipEff.onOwnTurnEnd!(makeApi(state, state.active, i)),
            { player: state.active, charIndex: i },
          );
        }
      });
      if (battleOver(state)) return;

      state.active = (1 - state.active) as PlayerIndex;
      state.turn += 1;
      pushLog(state, `--- ターン${state.turn}: プレイヤー${state.active + 1} ---`);
      emit(state, { t: 'turnStart', turn: state.turn, player: state.active });
      beginTurn(state);
      return;
    }
  }
}

/** 攻撃対象を「今の状況」から決める（宣言時ではなく解決時基準） */
function resolveAttackTargets(state: BattleState, pending: PendingAttack): number[] {
  const defenderIdx = (1 - state.active) as PlayerIndex;
  const defender = state.players[defenderIdx];
  const aliveIdx = defender.characters.map((_, i) => i).filter((i) => isCharAlive(state, defenderIdx, i));
  switch (pending.targeting) {
    case 'all':
      return aliveIdx;
    case 'standby':
      return aliveIdx.filter((i) => i !== defender.actorIndex);
    case 'choose': {
      const t = pending.chosenIndex;
      if (t !== undefined && isCharAlive(state, defenderIdx, t)) return [t];
      return aliveIdx.includes(defender.actorIndex) ? [defender.actorIndex] : aliveIdx.slice(0, 1);
    }
    default:
      return aliveIdx.includes(defender.actorIndex) ? [defender.actorIndex] : aliveIdx.slice(0, 1);
  }
}

function requirePhase(state: BattleState, phase: Phase): void {
  if (state.phase !== phase) {
    throw new Error(`今は${phase}フェーズではありません（今: ${state.phase}）`);
  }
}

/** スキルを使う前の予想値（UI表示用）。状況で効果が変わるスキルの「今使ったらどうなるか」 */
export interface SkillPrediction {
  kind: 'attack' | 'heal' | 'guard' | 'support';
  /** 予想ダメージ / 回復量 / ガード軽減量（supportは0） */
  value: number;
  /** 攻撃の対象数（attack以外は0） */
  targets: number;
  cost: number;
}

export function predictSkill(
  state: BattleState,
  player: PlayerIndex,
  card: SkillCard,
  usingIndex?: number,
): SkillPrediction | null {
  const usingChar = resolveUsingChar(state, player, card, usingIndex);
  if (usingChar === null) return null;
  const cost = effectiveSkillCost(state, player, card, usingChar);

  if (card.valueType === 'attack') {
    // 実際の宣言処理をクローン上で走らせて、修正込みのダメージを読む
    const clone = structuredClone(state);
    clone.active = player;
    const eff = skillEffectOf(card.id);
    clone.pendingAttack = {
      skillId: card.id,
      skillName: card.name,
      value: card.baseValue,
      targeting: eff?.targeting ?? 'actor',
      chosenIndex: undefined,
      noGuard: eff?.noGuard ?? false,
      attackerChar: usingChar,
      attackerWasActor: usingChar === clone.players[player].actorIndex,
      guard: null,
    };
    try {
      eff?.onAttackDeclare?.(makeApi(clone, player, usingChar));
      const charEff = characterEffectOf(clone.players[player].characters[usingChar].cardId);
      charEff?.onAttackDeclare?.(makeApi(clone, player, usingChar));
    } catch {
      /* 予測なので効果エラーは無視 */
    }
    const value = clone.pendingAttack?.value ?? card.baseValue;
    const targets = clone.pendingAttack ? resolveAttackTargets(clone, clone.pendingAttack).length : 0;
    return { kind: 'attack', value, targets, cost };
  }
  if (card.valueType === 'heal') {
    const value = skillEffectOf(card.id)?.healTargeting === 'ko' ? Math.max(1, card.baseValue) : card.baseValue;
    return { kind: 'heal', value, targets: 0, cost };
  }
  if (card.valueType === 'guard') {
    return { kind: 'guard', value: card.baseValue, targets: 0, cost };
  }
  return { kind: 'support', value: 0, targets: 0, cost };
}

function cardAtHand(p: PlayerBattle, handIndex: number) {
  const id = p.hand[handIndex];
  if (id === undefined) throw new Error(`手札にない番号です: ${handIndex}`);
  return cardById(id);
}

// ---------------------------------------------------------------- 攻撃の宣言と解決

function beginAttack(
  state: BattleState,
  card: SkillCard,
  usingChar: number,
  targetIndex?: number,
  forceNoGuard = false,
  noRotate = false, // 効果の中から放つ攻撃（デッキから使用など）は1スキル扱いなので回転させない
): void {
  const defenderIdx = (1 - state.active) as PlayerIndex;
  const eff = skillEffectOf(card.id);

  state.pendingAttack = {
    skillId: card.id,
    skillName: card.name,
    value: card.baseValue,
    targeting: eff?.targeting ?? 'actor',
    chosenIndex: eff?.targeting === 'choose' ? targetIndex : undefined,
    noGuard: forceNoGuard || (eff?.noGuard ?? false),
    attackerChar: usingChar,
    attackerWasActor: !noRotate && usingChar === state.players[state.active].actorIndex,
    guard: null,
  };

  // ダメージ修正（スキル効果 → 使用キャラの常時能力の順）
  if (eff?.onAttackDeclare) {
    runEffectSafely(
      state,
      `${card.name}の攻撃効果`,
      () => eff.onAttackDeclare!(makeApi(state, state.active, usingChar)),
      { player: state.active, charIndex: usingChar },
    );
  }
  const charEff = characterEffectOf(state.players[state.active].characters[usingChar].cardId);
  if (charEff?.onAttackDeclare) {
    runEffectSafely(
      state,
      `使用キャラの攻撃能力`,
      () => charEff.onAttackDeclare!(makeApi(state, state.active, usingChar)),
      { player: state.active, charIndex: usingChar },
    );
  }
  // プレイ時の付随効果（属性追加・アクター化など）
  if (eff?.onPlay) {
    runEffectSafely(
      state,
      `${card.name}のプレイ効果`,
      () => eff.onPlay!(makeApi(state, state.active, usingChar)),
      { player: state.active, charIndex: usingChar },
    );
  }
  if (state.phase === 'finished') return;

  const pending = state.pendingAttack;
  if (!pending) return;

  if (!pending.noGuard && guardOptions(state, defenderIdx).length > 0) {
    state.phase = 'guard';
    pushLog(state, `${card.name}で攻撃 → 相手は割り込みできる（ダメージ${pending.value}）`);
    emit(state, { t: 'attackDeclared', player: state.active, cardId: card.id, value: pending.value, noGuard: false });
  } else {
    if (pending.noGuard) {
      pushLog(state, `${card.name}は防御で割り込めない攻撃`);
      emit(state, { t: 'attackDeclared', player: state.active, cardId: card.id, value: pending.value, noGuard: true });
    } else {
      // 相手がガードできない場合も攻撃宣言の演出は必ず出す
      pushLog(state, `${card.name}で攻撃（ダメージ${pending.value}）`);
      emit(state, { t: 'attackDeclared', player: state.active, cardId: card.id, value: pending.value, noGuard: false });
    }
    resolvePendingAttack(state);
  }
}

function resolvePendingAttack(state: BattleState): void {
  const pending = state.pendingAttack;
  if (!pending) throw new Error('解決する攻撃がありません');
  const attackerIdx = state.active;
  const defenderIdx = (1 - state.active) as PlayerIndex;
  const defender = state.players[defenderIdx];

  // オールディフェンス等の被ダメージ軽減
  const reduction =
    defender.incomingDamageReduction && state.turn <= defender.incomingDamageReduction.untilTurn
      ? defender.incomingDamageReduction.value
      : 0;

  let dealtTotal = 0;
  let damagedCount = 0;
  // 対象もアクター判定も「解決を始める時点」で確定する
  // （飛翔でアクターが変われば攻撃先も変わる。解決中の強制交代では変わらない）
  const targets = resolveAttackTargets(state, pending);
  const judgedActor = defender.actorIndex;
  for (const ti of targets) {
    if (battleOver(state)) break;
    if (!isCharAlive(state, defenderIdx, ti)) continue;
    // ガードの軽減はガード使用者（防御側アクター）本人への被弾にだけ効く
    const guardCut = pending.guard && ti === pending.guard.charIndex ? pending.guard.value : 0;
    // 複数対象の処理中は陣形（ポジション）を維持し、交代は全処理後に行う
    const dealt = applyDamage(state, defenderIdx, ti, Math.max(0, pending.value - reduction - guardCut), judgedActor, true);
    dealtTotal += dealt;
    if (dealt > 0) damagedCount++;
  }
  // 全対象の処理が終わってからアクターの強制交代
  if (!battleOver(state) && !isCharAlive(state, defenderIdx, defender.actorIndex)) {
    defender.actorIndex = nextAliveIndex(state, defenderIdx, defender.actorIndex);
    pushLog(state, `P${defenderIdx + 1}のアクターが${defender.characters[defender.actorIndex].name}（${defender.actorIndex + 1}番手）に強制交代`);
    emit(state, { t: 'actorChanged', player: defenderIdx, charIndex: defender.actorIndex, forced: true });
  }

  if (!battleOver(state)) {
    const eff = skillEffectOf(pending.skillId);
    if (eff?.onAttackResolved) {
      runEffectSafely(
        state,
        `${pending.skillName}の攻撃後効果`,
        () => eff.onAttackResolved!(makeApi(state, attackerIdx, pending.attackerChar), dealtTotal, damagedCount),
        { player: attackerIdx, charIndex: pending.attackerChar },
      );
    }
  }

  const wasActor = pending.attackerWasActor;
  const attackerChar = pending.attackerChar;
  state.pendingAttack = null;
  if (state.phase === 'finished') return;
  state.phase = 'play';
  // 自動ローテーションは「使用キャラがまだアクターのまま」の時だけ。
  // 反射などで使用キャラが倒れて強制交代済みなら、それが交代の代わりになる
  // （さらに回すと1スキルで2回スイッチしてしまう）
  if (wasActor && state.players[attackerIdx].actorIndex === attackerChar) {
    rotateActorAfterSkill(state, attackerIdx);
  } else if (state.skipRotationFor === attackerIdx) {
    state.skipRotationFor = null;
  }
}

function resolveNonAttack(state: BattleState, card: SkillCard, usingChar: number, healTargetIndex?: number): void {
  const me = state.players[state.active];
  if (card.valueType === 'heal') {
    if (skillEffectOf(card.id)?.healTargeting === 'ko') {
      // 復活: 選んだ戦闘不能キャラをHP=baseValue（最低1）で復活させる
      const target = healTargetIndex ?? me.characters.findIndex((_, i) => !isCharAlive(state, state.active, i));
      if (target >= 0 && !isCharAlive(state, state.active, target)) {
        const c = me.characters[target];
        const hp = Math.max(1, card.baseValue);
        c.damage = Math.max(0, maxHpOf(state, state.active, target) - hp);
        pushLog(state, `P${state.active + 1}の${c.name}が復活（HP${hp}）`);
        emit(state, { t: 'revive', player: state.active, charIndex: target, hp });
      }
    } else {
      const target = healTargetIndex ?? me.actorIndex;
      if (isCharAlive(state, state.active, target)) {
        healCharacter(state, state.active, target, card.baseValue);
      }
    }
  }
  const eff = skillEffectOf(card.id);
  if (eff?.onPlay) {
    runEffectSafely(
      state,
      `${card.name}の効果`,
      () => eff.onPlay!(makeApi(state, state.active, usingChar)),
      { player: state.active, charIndex: usingChar },
    );
  }
}

function rotateActorAfterSkill(state: BattleState, player: PlayerIndex): void {
  if (state.skipRotationFor === player) {
    state.skipRotationFor = null;
    return;
  }
  if (actorLocked(state, player)) return;
  const p = state.players[player];
  const before = p.actorIndex;
  p.actorIndex = nextAliveIndex(state, player, p.actorIndex, rotationSkip(state, player));
  if (p.actorIndex !== before) {
    pushLog(state, `プレイヤー${player + 1}のアクターが${p.characters[p.actorIndex].name}（${p.actorIndex + 1}番手）に交代`);
    emit(state, { t: 'actorChanged', player, charIndex: p.actorIndex, forced: false });
  }
}

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

export type Phase = 'play' | 'guard' | 'charge' | 'finished';
export type EndReason = 'wipeout' | 'deckout' | 'turnLimit';

export interface PendingAttack {
  skillId: string;
  skillName: string;
  value: number;
  targets: number[]; // 防御側キャラの番号
  noGuard: boolean;
  attackerChar: number; // 使用キャラの番号
}

export interface BattleState {
  turn: number;
  active: PlayerIndex;
  phase: Phase;
  players: [PlayerBattle, PlayerBattle];
  firstPlayer: PlayerIndex;
  pendingAttack: PendingAttack | null;
  /** 場のフィールドカード（両者共有・1枚だけ） */
  field: { cardId: string; owner: PlayerIndex } | null;
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  rngState: number;
  effectDepth: number;
  log: string[];
}

export type BattleAction =
  | { type: 'playSkill'; handIndex: number; healTargetIndex?: number; targetIndex?: number }
  | { type: 'playCharacter'; handIndex: number }
  | { type: 'playEquipment'; handIndex: number; targetIndex: number }
  | { type: 'playField'; handIndex: number }
  | { type: 'endPlay' }
  | { type: 'playGuard'; handIndex: number }
  | { type: 'pass' }
  | { type: 'charge'; handIndex: number }
  | { type: 'endTurn' };

// ---------------------------------------------------------------- 基本ヘルパー

function pushLog(state: BattleState, message: string): void {
  state.log.push(message);
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
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
}

// ---------------------------------------------------------------- 効果の安全実行

/**
 * 効果をスナップショット保護つきで実行する。
 * 効果が例外を投げたら、状態を実行前に巻き戻してログを残し、バトルを続行する。
 */
function runEffectSafely(state: BattleState, label: string, fn: () => void): void {
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
  });
  state.effectDepth++;
  try {
    fn();
  } catch (e) {
    Object.assign(state, backup);
    pushLog(state, `効果でエラーが起きたためスキップ: ${label}（${e instanceof Error ? e.message : e}）`);
  } finally {
    state.effectDepth--;
  }
}

// ---------------------------------------------------------------- EffectApi 実装

function makeApi(state: BattleState, owner: PlayerIndex, ownerChar: number): EffectApi {
  const me = () => state.players[owner];
  const enemyIdx = (1 - owner) as PlayerIndex;
  const enemy = () => state.players[enemyIdx];
  const clampN = (n: number) => Math.max(0, Math.floor(n));
  const firstTarget = () => {
    const t = state.pendingAttack?.targets[0];
    return t === undefined ? null : t;
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
    skillsUsedThisTurn: () => me().skillsUsedThisTurn,

    addDamage: (n) => {
      if (state.pendingAttack) state.pendingAttack.value += clampN(n);
    },
    setDamage: (n) => {
      if (state.pendingAttack) state.pendingAttack.value = clampN(n);
    },
    addGuardValue: (n) => {
      if (state.pendingAttack) state.pendingAttack.value = Math.max(0, state.pendingAttack.value - clampN(n));
    },

    chargeFromDeck: (who, n) => {
      const p = who === 'me' ? me() : enemy();
      const moved = p.deck.splice(0, clampN(n));
      p.ap.push(...moved);
      if (moved.length > 0) pushLog(state, `デッキから${moved.length}枚チャージ（AP: ${p.ap.length}）`);
    },
    chargeAllHand: () => {
      const p = me();
      p.ap.push(...p.hand.splice(0));
    },
    chargeFromTrashBottom: (n) => {
      const p = me();
      const moved = p.trash.splice(0, clampN(n));
      p.ap.push(...moved);
    },
    drawCards: (who, n) => {
      const p = who === 'me' ? me() : enemy();
      p.hand.push(...p.deck.splice(0, clampN(n)));
    },
    discardHandAll: () => {
      const p = me();
      p.trash.push(...p.hand.splice(0));
    },
    millDeck: (who, n) => {
      const p = who === 'me' ? me() : enemy();
      const moved = p.deck.splice(0, clampN(n));
      p.trash.push(...moved);
      if (moved.length > 0) pushLog(state, `デッキから${moved.length}枚トラッシュ`);
    },
    discardEnemyAp: (n) => {
      const p = enemy();
      p.trash.push(...p.ap.splice(0, clampN(n)));
    },
    damageEnemyActor: (n) => {
      applyDamage(state, enemyIdx, enemy().actorIndex, clampN(n));
    },
    damageAllEnemies: (n) => {
      const targets = enemy().characters.map((_, i) => i);
      for (const i of targets) {
        if (state.phase === 'finished') return;
        if (isCharAlive(state, enemyIdx, i)) applyDamage(state, enemyIdx, i, clampN(n));
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
      pushLog(state, `${c.name}が復活（HP${Math.max(1, hp)}）`);
    },
    addAttributeToSelf: (attr, n = 1) => {
      const c = me().characters[ownerChar];
      for (let i = 0; i < n && c.addedAttributes.length < MAX_ADDED_ATTRIBUTES; i++) {
        c.addedAttributes.push(attr);
      }
      pushLog(state, `${c.name}に${attr}属性を追加`);
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
    },
    lockEnemyActor: () => {
      enemy().actorLockUntilTurn = state.turn + 1;
      pushLog(state, `相手のアクターをロック（ターン${state.turn + 1}終了まで）`);
    },
    lockMyActor: () => {
      me().actorLockUntilTurn = state.turn + 1;
    },
    unlockMyActor: () => {
      me().actorLockUntilTurn = 0;
    },
    forceChangeEnemyActor: () => {
      if (actorLocked(state, enemyIdx)) {
        pushLog(state, 'アクターがロックされていて変更できない');
        return;
      }
      const p = enemy();
      p.actorIndex = nextAliveIndex(state, enemyIdx, p.actorIndex, rotationSkip(state, enemyIdx));
      pushLog(state, `相手のアクターが${p.characters[p.actorIndex].name}に変更`);
    },
    changeMyActor: (skip = 0) => {
      if (actorLocked(state, owner)) {
        pushLog(state, 'アクターがロックされていて変更できない');
        return;
      }
      const p = me();
      p.actorIndex = nextAliveIndex(state, owner, p.actorIndex, skip);
    },
    becomeActor: () => {
      if (isCharAlive(state, owner, ownerChar)) me().actorIndex = ownerChar;
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
      return true;
    },
    selfHasEquipment: () => me().characters[ownerChar].equipmentCardId !== null,
    destroyTargetEquipment: () => {
      const t = firstTarget();
      if (t === null) return;
      const c = state.players[defenderIdx()].characters[t];
      if (c.equipmentCardId) {
        state.players[defenderIdx()].trash.push(c.equipmentCardId);
        pushLog(state, `${c.name}の装備${cardById(c.equipmentCardId).name}を破壊`);
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
        return;
      }
      const [id] = p.deck.splice(idx, 1);
      const card = cardById(id) as SkillCard;
      p.trash.push(id);
      pushLog(state, `デッキから${card.name}をコストなしで使用`);
      // スキルを本当に「使用」する（効果込み）。奇襲扱いでguard割り込みは不可
      if (card.valueType === 'attack') {
        beginAttack(state, card, ownerChar, undefined, true);
      } else {
        resolveNonAttack(state, card, ownerChar);
        rotateActorAfterSkill(state, owner);
      }
    },
    log: (message) => pushLog(state, message),
  };
  return api;
}

// ---------------------------------------------------------------- ダメージ・回復の共通処理

/** ダメージ適用（効果ダメージ・攻撃解決の両方が通る唯一の道） */
function applyDamage(state: BattleState, player: PlayerIndex, charIndex: number, amount: number): number {
  if (state.phase === 'finished' || amount <= 0) return 0;
  const p = state.players[player];
  const c = p.characters[charIndex];
  if (!isCharAlive(state, player, charIndex)) return 0;

  // ビコウ: 控えにいる時はダメージを受けない
  const eff = characterEffectOf(c.cardId);
  if (eff?.standbyImmune && charIndex !== p.actorIndex) {
    pushLog(state, `${c.name}は控えのためダメージを受けない`);
    return 0;
  }

  const maxHp = maxHpOf(state, player, charIndex);
  const actual = Math.min(amount, maxHp - c.damage);
  c.damage += actual;
  pushLog(state, `${c.name}に${actual}ダメージ（残りHP: ${maxHp - c.damage}）`);

  // 被ダメージ時の常時能力（ミルオン・ボーダン）
  if (actual > 0 && eff?.onDamaged && isCharAlive(state, player, charIndex)) {
    runEffectSafely(state, `${c.name}の被ダメージ能力`, () =>
      eff.onDamaged!(makeApi(state, player, charIndex), actual, charIndex === p.actorIndex),
    );
  }

  // 戦闘不能処理
  if (!isCharAlive(state, player, charIndex)) {
    pushLog(state, `${c.name}は戦闘不能`);
    // 味方戦闘不能時の常時能力（レオン・ソーベルト。倒れた本人も発動する）
    p.characters.forEach((ally, i) => {
      const allyEff = characterEffectOf(ally.cardId);
      if (!allyEff?.onAllyKo) return;
      if (i !== charIndex && !isCharAlive(state, player, i)) return;
      runEffectSafely(state, `${ally.name}の能力`, () => allyEff.onAllyKo!(makeApi(state, player, i)));
    });
    if (battleOver(state)) return actual;
    if (aliveCount(state, player) === 0) {
      finish(state, (1 - player) as PlayerIndex, 'wipeout');
      return actual;
    }
    // アクターが倒れたら強制交代（ロックより優先）
    if (charIndex === p.actorIndex) {
      p.actorIndex = nextAliveIndex(state, player, p.actorIndex);
      pushLog(state, `アクターが${p.characters[p.actorIndex].name}に強制交代`);
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
    pushLog(state, `${c.name}を${healed}回復`);
    const eff = characterEffectOf(c.cardId);
    if (eff?.onHealed) {
      runEffectSafely(state, `${c.name}の回復時能力`, () =>
        eff.onHealed!(makeApi(state, player, charIndex), healed),
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
    field: null,
    winner: null,
    endReason: null,
    rngState: (seed * 2654435761) >>> 0,
    effectDepth: 0,
    log: [`バトル開始。先攻: プレイヤー${firstPlayer + 1}`],
  };

  // バトル開始時の常時能力（先攻側から）
  for (const pIdx of [firstPlayer, (1 - firstPlayer) as PlayerIndex]) {
    state.players[pIdx].characters.forEach((c, i) => {
      const eff = characterEffectOf(c.cardId);
      if (eff?.onBattleStart) {
        runEffectSafely(state, `${c.name}のバトル開始能力`, () =>
          eff.onBattleStart!(makeApi(state, pIdx, i)),
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
    if (drawn > 0) pushLog(state, `プレイヤー${state.active + 1}が${drawn}枚ドロー`);
    // 山札切れで手札を5枚にできなければ負け
    if (p.hand.length < HAND_REFILL_TO && p.deck.length === 0 && drawn < drawCount) {
      pushLog(state, `プレイヤー${state.active + 1}は山札切れで手札を${HAND_REFILL_TO}枚にできない`);
      finish(state, (1 - state.active) as PlayerIndex, 'deckout');
      return;
    }
  }
  state.phase = 'play';

  // ターン開始時の常時能力（アニマなど。ドロー後に発動）
  p.characters.forEach((c, i) => {
    if (battleOver(state)) return;
    if (!isCharAlive(state, state.active, i)) return;
    const eff = characterEffectOf(c.cardId);
    if (eff?.onOwnTurnStart) {
      runEffectSafely(state, `${c.name}のターン開始能力`, () =>
        eff.onOwnTurnStart!(makeApi(state, state.active, i), i === p.actorIndex),
      );
    }
  });
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

/** このスキルを使うキャラの番号を返す（使えなければ null） */
export function resolveUsingChar(state: BattleState, player: PlayerIndex, card: SkillCard): number | null {
  const p = state.players[player];
  const eff = skillEffectOf(card.id);
  const candidates = eff?.anyCharacterCanUse
    ? p.characters.map((_, i) => i).filter((i) => isCharAlive(state, player, i))
    : [p.actorIndex];
  for (const ci of candidates) {
    if (containsAll(effectiveAttributes(state, player, ci), card.conditionAttribute)) return ci;
  }
  return null;
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

  if (state.phase === 'play') {
    const p = state.players[state.active];
    const enemyIdx = (1 - state.active) as PlayerIndex;
    const enemy = state.players[enemyIdx];
    p.hand.forEach((id, handIndex) => {
      const card = cardById(id);
      if (card.type === 'skill' && card.valueType !== 'guard' && canPlaySkill(state, state.active, card)) {
        const eff = skillEffectOf(card.id);
        if (card.valueType === 'heal') {
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

  switch (action.type) {
    case 'playSkill': {
      requirePhase(state, 'play');
      const p = state.players[state.active];
      const card = cardAtHand(p, action.handIndex);
      if (card.type !== 'skill') throw new Error(`スキルカードではありません: ${card.name}`);
      if (card.valueType === 'guard') {
        throw new Error(`guardスキルは攻撃された時にだけ使えます: ${card.name}`);
      }
      const usingChar = resolveUsingChar(state, state.active, card);
      if (usingChar === null) throw new Error(`属性の条件を満たしていません: ${card.name}`);
      const cost = effectiveSkillCost(state, state.active, card, usingChar);
      if (p.ap.length < cost) throw new Error(`APが足りません: ${card.name}`);

      p.trash.push(...p.ap.splice(0, cost));
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      p.skillsUsedThisTurn++;
      p.nextSkillCostDelta = 0; // コスト修正は1回で消費
      pushLog(state, `${p.characters[usingChar].name}が${card.name}を使用`);
      if (card.effectText !== '' && !hasEffectImplementation(card.id)) {
        pushLog(state, `※${card.name}の効果は未実装: 「${card.effectText}」`);
      }

      if (card.valueType === 'attack') {
        beginAttack(state, card, usingChar, action.targetIndex);
      } else {
        resolveNonAttack(state, card, usingChar, action.healTargetIndex);
        if (!battleOver(state)) rotateActorAfterSkill(state, state.active);
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

      const before = pending.value;
      pending.value = Math.max(0, pending.value - card.baseValue);
      const eff = skillEffectOf(card.id);
      if (eff?.onGuardDeclare) {
        runEffectSafely(state, `${card.name}のguard効果`, () =>
          eff.onGuardDeclare!(makeApi(state, defender, p.actorIndex)),
        );
      }
      pushLog(state, `${card.name}で割り込み（${before} → 残りダメージ${state.pendingAttack?.value ?? 0}）`);

      if (state.phase === 'guard' && guardOptions(state, defender).length === 0) {
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
        pushLog(state, `${target.name}の${cardById(target.equipmentCardId).name}を外してトラッシュ`);
      }
      p.hand.splice(action.handIndex, 1);
      target.equipmentCardId = card.id;
      pushLog(state, `${target.name}に${card.name}を装備`);
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
      }
      p.hand.splice(action.handIndex, 1);
      state.field = { cardId: card.id, owner: state.active };
      pushLog(state, `フィールド${card.name}を展開`);
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
      healCharacter(state, state.active, best, CHARACTER_CARD_HEAL);
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
          runEffectSafely(state, `${c.name}のターン終了能力`, () =>
            eff.onOwnTurnEnd!(makeApi(state, state.active, i), i === p.actorIndex),
          );
        }
        const equipEff = c.equipmentCardId ? equipmentEffectOf(c.equipmentCardId) : null;
        if (equipEff?.onOwnTurnEnd) {
          runEffectSafely(state, `${c.name}の装備効果`, () =>
            equipEff.onOwnTurnEnd!(makeApi(state, state.active, i)),
          );
        }
      });
      if (battleOver(state)) return;

      state.active = (1 - state.active) as PlayerIndex;
      state.turn += 1;
      pushLog(state, `--- ターン${state.turn}: プレイヤー${state.active + 1} ---`);
      beginTurn(state);
      return;
    }
  }
}

function requirePhase(state: BattleState, phase: Phase): void {
  if (state.phase !== phase) {
    throw new Error(`今は${phase}フェーズではありません（今: ${state.phase}）`);
  }
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
): void {
  const defenderIdx = (1 - state.active) as PlayerIndex;
  const defender = state.players[defenderIdx];
  const eff = skillEffectOf(card.id);

  let targets: number[];
  switch (eff?.targeting) {
    case 'all':
      targets = defender.characters.map((_, i) => i).filter((i) => isCharAlive(state, defenderIdx, i));
      break;
    case 'standby':
      targets = defender.characters
        .map((_, i) => i)
        .filter((i) => i !== defender.actorIndex && isCharAlive(state, defenderIdx, i));
      break;
    case 'choose': {
      const t = targetIndex ?? defender.actorIndex;
      targets = isCharAlive(state, defenderIdx, t) ? [t] : [defender.actorIndex];
      break;
    }
    default:
      targets = [defender.actorIndex];
  }

  state.pendingAttack = {
    skillId: card.id,
    skillName: card.name,
    value: card.baseValue,
    targets,
    noGuard: forceNoGuard || (eff?.noGuard ?? false),
    attackerChar: usingChar,
  };

  // ダメージ修正（スキル効果 → 使用キャラの常時能力の順）
  if (eff?.onAttackDeclare) {
    runEffectSafely(state, `${card.name}の攻撃効果`, () =>
      eff.onAttackDeclare!(makeApi(state, state.active, usingChar)),
    );
  }
  const charEff = characterEffectOf(state.players[state.active].characters[usingChar].cardId);
  if (charEff?.onAttackDeclare) {
    runEffectSafely(state, `使用キャラの攻撃能力`, () =>
      charEff.onAttackDeclare!(makeApi(state, state.active, usingChar)),
    );
  }
  // プレイ時の付随効果（属性追加・アクター化など）
  if (eff?.onPlay) {
    runEffectSafely(state, `${card.name}のプレイ効果`, () =>
      eff.onPlay!(makeApi(state, state.active, usingChar)),
    );
  }
  if (state.phase === 'finished') return;

  const pending = state.pendingAttack;
  if (!pending) return;

  if (!pending.noGuard && guardOptions(state, defenderIdx).length > 0) {
    state.phase = 'guard';
    pushLog(state, `${card.name}で攻撃 → 相手は割り込みできる（ダメージ${pending.value}）`);
  } else {
    if (pending.noGuard) pushLog(state, `${card.name}は防御で割り込めない攻撃`);
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
  for (const ti of pending.targets) {
    if (battleOver(state)) break;
    if (!isCharAlive(state, defenderIdx, ti)) continue;
    const dealt = applyDamage(state, defenderIdx, ti, Math.max(0, pending.value - reduction));
    dealtTotal += dealt;
    if (dealt > 0) damagedCount++;
  }

  if (!battleOver(state)) {
    const eff = skillEffectOf(pending.skillId);
    if (eff?.onAttackResolved) {
      runEffectSafely(state, `${pending.skillName}の攻撃後効果`, () =>
        eff.onAttackResolved!(makeApi(state, attackerIdx, pending.attackerChar), dealtTotal, damagedCount),
      );
    }
  }

  state.pendingAttack = null;
  if (state.phase === 'finished') return;
  state.phase = 'play';
  rotateActorAfterSkill(state, attackerIdx);
}

function resolveNonAttack(state: BattleState, card: SkillCard, usingChar: number, healTargetIndex?: number): void {
  const me = state.players[state.active];
  if (card.valueType === 'heal') {
    const target = healTargetIndex ?? me.actorIndex;
    if (isCharAlive(state, state.active, target)) {
      healCharacter(state, state.active, target, card.baseValue);
    }
  }
  const eff = skillEffectOf(card.id);
  if (eff?.onPlay) {
    runEffectSafely(state, `${card.name}の効果`, () =>
      eff.onPlay!(makeApi(state, state.active, usingChar)),
    );
  }
}

function rotateActorAfterSkill(state: BattleState, player: PlayerIndex): void {
  if (actorLocked(state, player)) return;
  const p = state.players[player];
  const before = p.actorIndex;
  p.actorIndex = nextAliveIndex(state, player, p.actorIndex, rotationSkip(state, player));
  if (p.actorIndex !== before) {
    pushLog(state, `プレイヤー${player + 1}のアクターが${p.characters[p.actorIndex].name}に交代`);
  }
}

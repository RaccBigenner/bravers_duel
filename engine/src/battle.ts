/**
 * バトルエンジン本体。
 * ルールの正しい情報源は docs/GAME_RULES.md（v0.4）。
 *
 * まだ実装していないこと（ルール未決定 or 今後の作業）:
 * - カードの効果文（effectText）の個別効果
 * - 装備カード・フィールドカードのプレイ（ルール未決定のためプレイ不可。APチャージには使える）
 * - support スキルの共通効果（今は場に影響しない）
 */
import { cardById } from './cards';
import { containsAll, deckProblems, type DeckList } from './decks';
import { mulberry32, shuffled } from './rng';
import {
  CHARACTER_CARD_HEAL,
  HAND_REFILL_TO,
  SECOND_PLAYER_STARTING_AP,
  type Attribute,
  type CharacterCard,
  type SkillCard,
} from './types';

export type PlayerIndex = 0 | 1;

export interface CharacterInstance {
  cardId: string;
  name: string;
  maxHp: number;
  attributes: Attribute[]; // カード本来の属性
  addedAttributes: Attribute[]; // 効果などで追加された属性
  damage: number; // 累積ダメージ（HP以上で戦闘不能）
}

export interface PlayerBattle {
  deck: string[]; // 先頭が山札の一番上
  hand: string[];
  trash: string[];
  ap: string[];
  characters: CharacterInstance[]; // 並び順 = アクターの交代順
  actorIndex: number;
}

/**
 * guard = 攻撃への割り込み待ちフェーズ（行動するのは攻撃されている側）
 */
export type Phase = 'play' | 'guard' | 'charge' | 'finished';
export type EndReason = 'wipeout' | 'deckout' | 'turnLimit';

/** 解決待ちの攻撃（guard フェーズの間だけ存在する） */
export interface PendingAttack {
  skillName: string;
  value: number; // ガードで軽減された後の今のダメージ値
}

export interface BattleState {
  turn: number; // 1始まりの通しターン数
  active: PlayerIndex; // ターンを進めているプレイヤー
  phase: Phase;
  players: [PlayerBattle, PlayerBattle];
  firstPlayer: PlayerIndex;
  pendingAttack: PendingAttack | null;
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  log: string[];
}

export type BattleAction =
  | { type: 'playSkill'; handIndex: number; healTargetIndex?: number }
  | { type: 'playCharacter'; handIndex: number }
  | { type: 'endPlay' }
  | { type: 'playGuard'; handIndex: number } // 攻撃への割り込み（攻撃されている側）
  | { type: 'pass' } // 割り込みしないで攻撃を受ける
  | { type: 'charge'; handIndex: number }
  | { type: 'endTurn' };

// ---------------------------------------------------------------- ヘルパー

export function isAlive(c: CharacterInstance): boolean {
  return c.damage < c.maxHp;
}

export function aliveCount(p: PlayerBattle): number {
  return p.characters.filter(isAlive).length;
}

/** 今行動を選ぶべきプレイヤー（guardフェーズだけは攻撃されている側） */
export function actingPlayer(state: BattleState): PlayerIndex {
  return state.phase === 'guard' ? ((1 - state.active) as PlayerIndex) : state.active;
}

/** from の次から順番に見て、最初の生きているキャラの番号を返す（1→2→3→1） */
function nextAliveIndex(p: PlayerBattle, from: number): number {
  for (let step = 1; step <= p.characters.length; step++) {
    const i = (from + step) % p.characters.length;
    if (isAlive(p.characters[i])) return i;
  }
  return from;
}

function actorOf(p: PlayerBattle): CharacterInstance {
  return p.characters[p.actorIndex];
}

/** アクターの属性（本来の属性＋追加された属性） */
function actorAttributes(p: PlayerBattle): Attribute[] {
  const actor = actorOf(p);
  return [...actor.attributes, ...actor.addedAttributes];
}

function finish(state: BattleState, winner: PlayerIndex | null, reason: EndReason): void {
  state.phase = 'finished';
  state.winner = winner;
  state.endReason = reason;
  state.log.push(
    winner === null ? `決着つかず（${reason}）` : `プレイヤー${winner + 1}の勝ち（${reason}）`,
  );
}

// ---------------------------------------------------------------- バトル作成

export interface CreateBattleOptions {
  /** テスト用: 先攻を固定する（省略時はランダム） */
  firstPlayer?: PlayerIndex;
  /** テスト用: デッキ検証を飛ばす（省略時は検証する） */
  validate?: boolean;
}

export function createBattle(
  decks: [DeckList, DeckList],
  seed: number,
  options: CreateBattleOptions = {},
): BattleState {
  const rng = mulberry32(seed);

  if (options.validate !== false) {
    decks.forEach((deck, i) => {
      const problems = deckProblems(deck);
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
      };
    });
    const player: PlayerBattle = {
      deck: shuffledDeck,
      hand: shuffledDeck.splice(0, HAND_REFILL_TO),
      trash: [],
      ap: [],
      characters,
      actorIndex: 0,
    };
    return player;
  }) as [PlayerBattle, PlayerBattle];

  // 後攻はデッキの上から2枚をチャージした状態で始める（後攻の補償）
  const second = players[(1 - firstPlayer) as PlayerIndex];
  second.ap.push(...second.deck.splice(0, SECOND_PLAYER_STARTING_AP));

  const state: BattleState = {
    turn: 1,
    active: firstPlayer,
    phase: 'play',
    players,
    firstPlayer,
    pendingAttack: null,
    winner: null,
    endReason: null,
    log: [`バトル開始。先攻: プレイヤー${firstPlayer + 1}`],
  };

  beginTurn(state);
  return state;
}

// ---------------------------------------------------------------- ターン進行

/** ドローフェーズ（自動処理）: 手札が5枚になるまで引く。引けなければ負け */
function beginTurn(state: BattleState): void {
  const p = state.players[state.active];
  const need = HAND_REFILL_TO - p.hand.length;
  if (need > 0) {
    if (p.deck.length < need) {
      state.log.push(`プレイヤー${state.active + 1}は山札切れで手札を${HAND_REFILL_TO}枚にできない`);
      finish(state, (1 - state.active) as PlayerIndex, 'deckout');
      return;
    }
    p.hand.push(...p.deck.splice(0, need));
    state.log.push(`プレイヤー${state.active + 1}が${need}枚ドロー`);
  }
  state.phase = 'play';
}

// ---------------------------------------------------------------- 判定

/** このスキルのAPと属性条件を満たしているか（属性は自分のアクターで判定） */
export function canPlaySkill(state: BattleState, player: PlayerIndex, skill: SkillCard): boolean {
  const p = state.players[player];
  if (p.ap.length < skill.costAp) return false;
  return containsAll(actorAttributes(p), skill.conditionAttribute);
}

/** このキャラクターカードを今プレイできるか（同名の生きた味方がいるか） */
export function canPlayCharacterCard(
  state: BattleState,
  player: PlayerIndex,
  card: CharacterCard,
): boolean {
  return state.players[player].characters.some((c) => c.name === card.name && isAlive(c));
}

/** 攻撃されている側が今使える guard スキルの手札番号 */
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

/** 今行動を選ぶべきプレイヤーができる行動をすべて列挙する */
export function legalActions(state: BattleState): BattleAction[] {
  if (state.phase === 'finished') return [];
  const actions: BattleAction[] = [];

  if (state.phase === 'play') {
    const p = state.players[state.active];
    p.hand.forEach((id, handIndex) => {
      const card = cardById(id);
      if (card.type === 'skill' && card.valueType !== 'guard' && canPlaySkill(state, state.active, card)) {
        if (card.valueType === 'heal') {
          p.characters.forEach((c, i) => {
            if (isAlive(c)) actions.push({ type: 'playSkill', handIndex, healTargetIndex: i });
          });
        } else {
          actions.push({ type: 'playSkill', handIndex });
        }
      }
      if (card.type === 'character' && canPlayCharacterCard(state, state.active, card)) {
        actions.push({ type: 'playCharacter', handIndex });
      }
    });
    actions.push({ type: 'endPlay' });
  }

  if (state.phase === 'guard') {
    const defender = actingPlayer(state);
    for (const handIndex of guardOptions(state, defender)) {
      actions.push({ type: 'playGuard', handIndex });
    }
    actions.push({ type: 'pass' });
  }

  if (state.phase === 'charge') {
    const p = state.players[state.active];
    p.hand.forEach((_, handIndex) => actions.push({ type: 'charge', handIndex }));
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
      if (!canPlaySkill(state, state.active, card)) {
        throw new Error(`スキルを使う条件を満たしていません: ${card.name}`);
      }

      // コスト支払い: APエリアの先頭からコスト分をトラッシュへ。スキルカードもトラッシュへ
      p.trash.push(...p.ap.splice(0, card.costAp));
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      if (card.effectText !== '') {
        state.log.push(`※${card.name}の効果文は未実装: 「${card.effectText}」`);
      }

      if (card.valueType === 'attack') {
        beginAttack(state, card);
      } else {
        resolveNonAttack(state, card, action.healTargetIndex);
        rotateActor(state, state.active); // 自分のターンにスキルを使うとアクター交代
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

      p.trash.push(...p.ap.splice(0, card.costAp));
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      if (card.effectText !== '') {
        state.log.push(`※${card.name}の効果文は未実装: 「${card.effectText}」`);
      }

      const reduced = Math.min(card.baseValue, pending.value);
      pending.value -= reduced;
      state.log.push(`${card.name}で割り込み（${reduced}軽減 → 残りダメージ${pending.value}）`);
      // 相手ターン中のスキル使用ではアクターは交代しない

      // もう割り込めるguardがなければ自動で攻撃を解決する
      if (guardOptions(state, defender).length === 0) {
        resolvePendingAttack(state);
      }
      return;
    }

    case 'pass': {
      requirePhase(state, 'guard');
      resolvePendingAttack(state);
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
      // 同名の生きた味方1枚を2回復（一番ダメージが大きいもの）
      const targets = p.characters.filter((c) => c.name === card.name && isAlive(c));
      const target = targets.sort((a, b) => b.damage - a.damage)[0];
      const healed = Math.min(CHARACTER_CARD_HEAL, target.damage);
      target.damage -= healed;
      p.hand.splice(action.handIndex, 1);
      p.trash.push(card.id);
      state.log.push(`${card.name}のカードで${target.name}を${healed}回復`);
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
      state.log.push(`プレイヤー${state.active + 1}が${card.name}をチャージ（AP: ${p.ap.length}）`);
      return;
    }

    case 'endTurn': {
      requirePhase(state, 'charge');
      state.active = (1 - state.active) as PlayerIndex;
      state.turn += 1;
      state.log.push(`--- ターン${state.turn}: プレイヤー${state.active + 1} ---`);
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

// ---------------------------------------------------------------- スキル解決

/** 攻撃を開始する。相手が割り込める時は guard フェーズへ、できなければ即解決 */
function beginAttack(state: BattleState, skill: SkillCard): void {
  const defender = (1 - state.active) as PlayerIndex;
  state.pendingAttack = { skillName: skill.name, value: skill.baseValue };

  if (guardOptions(state, defender).length > 0) {
    state.phase = 'guard';
    state.log.push(`${skill.name}で攻撃 → 相手は割り込みできる（ダメージ${skill.baseValue}）`);
  } else {
    resolvePendingAttack(state);
  }
}

/** 割り込みが終わった攻撃を実際に解決する */
function resolvePendingAttack(state: BattleState): void {
  const pending = state.pendingAttack;
  if (!pending) throw new Error('解決する攻撃がありません');
  state.pendingAttack = null;

  const enemy = state.players[(1 - state.active) as PlayerIndex];
  const target = actorOf(enemy);
  target.damage = Math.min(target.maxHp, target.damage + pending.value);
  state.log.push(
    `${pending.skillName}で${target.name}に${pending.value}ダメージ（残りHP: ${target.maxHp - target.damage}）`,
  );

  if (!isAlive(target)) {
    state.log.push(`${target.name}は戦闘不能`);
    if (aliveCount(enemy) === 0) {
      finish(state, state.active, 'wipeout');
      return;
    }
    // アクターが戦闘不能になったら次の生きているキャラに強制交代
    enemy.actorIndex = nextAliveIndex(enemy, enemy.actorIndex);
    state.log.push(`相手のアクターが${actorOf(enemy).name}に強制交代`);
  }

  state.phase = 'play';
  rotateActor(state, state.active); // 攻撃側はスキルを使ったのでアクター交代
}

/** 攻撃以外のスキル（heal / support）の解決 */
function resolveNonAttack(state: BattleState, skill: SkillCard, healTargetIndex?: number): void {
  const me = state.players[state.active];

  switch (skill.valueType) {
    case 'heal': {
      const target = me.characters[healTargetIndex ?? me.actorIndex];
      if (!target || !isAlive(target)) throw new Error('回復対象が正しくありません');
      const healed = Math.min(skill.baseValue, target.damage);
      target.damage -= healed;
      state.log.push(`${skill.name}で${target.name}を${healed}回復`);
      break;
    }
    case 'support': {
      // 共通効果なし。効果文の個別実装はこれから
      state.log.push(`${skill.name}を使用（supportの効果は未実装）`);
      break;
    }
    default:
      break;
  }
}

/** 自分のターンにスキルを使った時のアクター交代（1→2→3→1で次の生きているキャラへ） */
function rotateActor(state: BattleState, player: PlayerIndex): void {
  const p = state.players[player];
  const before = p.actorIndex;
  p.actorIndex = nextAliveIndex(p, p.actorIndex);
  if (p.actorIndex !== before) {
    state.log.push(`プレイヤー${player + 1}のアクターが${actorOf(p).name}に交代`);
  }
}

/**
 * リプレイの記録・再生と、試合が参照する版の固定。
 *
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 11.4「決定論とリプレイ」
 *
 * 設計 11.4 が試合ごとに保存すると決めているもの:
 *   seed / engine version / content version / format version /
 *   初期デッキsnapshot / 全command / 各command後のstate hash / 終了理由
 *
 * ここはエンジン側の純粋な入れ物と検査だけを持つ。保存先・配信の制御はサーバーの仕事で、
 * 「seedと完全ログは試合終了までプレイヤーへ渡さない」（設計 11.4）もサーバー側で守る。
 * エンジン内では `Math.random()` / `Date.now()` / 外部I/O を使わない。
 */
import {
  actingPlayer,
  applyAction,
  createBattle,
  type BattleAction,
  type BattleState,
  type EndReason,
  type PlayerIndex,
} from './battle';
import type { BattleAi } from './ai';
import type { DeckList } from './decks';
import { DEFAULT_FORMAT, formatVersionId, parseFormatVersionId, type FormatDefinition } from './formats';
import { CONTENT_VERSION, ENGINE_VERSION, fingerprintOf } from './versions';

/** リプレイ形式そのものの版。中身の並びを変えたら上げる */
export const REPLAY_FORMAT_VERSION = 1;

/** 試合開始時に固定して、以後は変えない情報 */
export interface ReplayHeader {
  replayFormatVersion: number;
  /** ルール実装の版（設計 11.4） */
  engineVersion: string;
  /** 公開カード・弾の版（設計 10.5） */
  contentVersion: string;
  /** デッキ構築ルールの版。`FREE_V1@1` の形（設計 4.5） */
  formatVersionId: string;
  /** サーバーが生成した seed。試合終了までプレイヤーへ渡さない */
  seed: number;
  /** 実際に先攻だったプレイヤー */
  firstPlayer: PlayerIndex;
  /**
   * 先攻を seed のコイントスで決めたか、外から指定したか。
   *
   * `createBattle` は先攻を省略されたときだけ乱数を1つ引くので、
   * 同じ seed でも「省略」と「明示」では以後の山札の並びが変わる。
   * 再生時に記録時と同じ呼び方を再現するために残す。
   */
  firstPlayerFromSeed: boolean;
  /**
   * 引き分けにするターン上限。
   * 上限による終了はプレイヤーの手ではなく進行ルールで起きるので、
   * 再生側が同じ判断をできるようheaderへ残す。
   */
  maxTurns: number;
  /** 初期デッキsnapshot。printing ID のまま持つ（既存デッキJSONと同じ値） */
  decks: [DeckList, DeckList];
}

/** 1手ぶんの記録 */
export interface ReplayCommand {
  /** 0から始まる通し番号 */
  index: number;
  /** 手を選んだプレイヤー（guardフェーズは攻撃されている側） */
  player: PlayerIndex;
  action: BattleAction;
  /** この手を適用した直後の state hash */
  stateHash: string;
}

export interface ReplayResult {
  winner: PlayerIndex | null;
  endReason: EndReason;
  turns: number;
  finalStateHash: string;
}

export interface ReplayRecord {
  header: ReplayHeader;
  commands: ReplayCommand[];
  result: ReplayResult;
}

/**
 * state hash に含める「ルール上の状態」だけを取り出す。
 *
 * `log` / `events` / それらの通し番号は入れない。演出や文言を直しただけで
 * 決定論の検査が落ちると、本当のルール変更に気づけなくなるため。
 * イベントは同じ状態遷移から作られるので、盤面が一致していれば別途検査できる。
 */
function rulesStateOf(state: BattleState) {
  return {
    turn: state.turn,
    active: state.active,
    phase: state.phase,
    firstPlayer: state.firstPlayer,
    pendingAttack: state.pendingAttack,
    skipRotationFor: state.skipRotationFor,
    manualFor: state.manualFor,
    field: state.field,
    winner: state.winner,
    endReason: state.endReason,
    rngState: state.rngState,
    effectDepth: state.effectDepth,
    players: state.players.map((p) => ({
      deck: p.deck,
      hand: p.hand,
      trash: p.trash,
      ap: p.ap,
      characters: p.characters,
      actorIndex: p.actorIndex,
      skillsUsedThisTurn: p.skillsUsedThisTurn,
      nextSkillCostDelta: p.nextSkillCostDelta,
      nextDrawDelta: p.nextDrawDelta,
      actorLockUntilTurn: p.actorLockUntilTurn,
      incomingDamageReduction: p.incomingDamageReduction,
      chargedThisTurn: p.chargedThisTurn,
    })),
  };
}

/** 盤面の指紋。同じ盤面なら必ず同じ値になる */
export function stateHash(state: BattleState): string {
  return fingerprintOf(rulesStateOf(state));
}

export interface RecordBattleOptions {
  maxTurns?: number;
  firstPlayer?: PlayerIndex;
  /** この試合が参照するフォーマット版（省略時は既定フォーマットの最新版） */
  format?: FormatDefinition;
}

/**
 * AI同士で1試合を回し、リプレイとして記録する。
 * `runBattle` と同じ進行だが、1手ごとに command と state hash を残す。
 */
export function recordBattle(
  decks: [DeckList, DeckList],
  ais: [BattleAi, BattleAi],
  seed: number,
  options: RecordBattleOptions = {},
): { state: BattleState; replay: ReplayRecord } {
  const maxTurns = options.maxTurns ?? 200;
  const format = options.format ?? DEFAULT_FORMAT;
  const state = createBattle(decks, seed, { firstPlayer: options.firstPlayer, format });

  const header: ReplayHeader = {
    replayFormatVersion: REPLAY_FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    formatVersionId: formatVersionId(format),
    seed,
    firstPlayer: state.firstPlayer,
    firstPlayerFromSeed: options.firstPlayer === undefined,
    maxTurns,
    // 進行中に書き換えられないよう、開始時点の中身をコピーして持つ
    decks: [
      { characterIds: [...decks[0].characterIds], cardIds: [...decks[0].cardIds] },
      { characterIds: [...decks[1].characterIds], cardIds: [...decks[1].cardIds] },
    ],
  };

  const commands: ReplayCommand[] = [];
  let safety = 0;
  while (state.phase !== 'finished') {
    if (state.turn > maxTurns) {
      state.phase = 'finished';
      state.winner = null;
      state.endReason = 'turnLimit';
      break;
    }
    if (++safety > 100000) {
      throw new Error('バトルが終わりません（AIが進行しない行動を選び続けています）');
    }
    // guardフェーズでは攻撃されている側が手番を持つ
    const player = actingPlayer(state);
    const action = ais[player].choose(state, player);
    applyAction(state, action);
    commands.push({ index: commands.length, player, action, stateHash: stateHash(state) });
  }

  return {
    state,
    replay: {
      header,
      commands,
      result: {
        winner: state.winner,
        endReason: state.endReason ?? 'turnLimit',
        turns: state.turn,
        finalStateHash: stateHash(state),
      },
    },
  };
}

export interface ReplayVerification {
  ok: boolean;
  /** 食い違った command の index（一致していれば null） */
  mismatchAt: number | null;
  /** 人が読める理由 */
  reason: string | null;
  /** 再生し終えた盤面（途中で食い違ったらそこまで） */
  state: BattleState;
}

/**
 * 記録した command を同じ seed から流し直し、各手の state hash が一致するか調べる。
 * 「同じ入力から同じ結果になる」ことのCI検査（設計 11.4）に使う。
 */
export function verifyReplay(
  replay: ReplayRecord,
  format: FormatDefinition = DEFAULT_FORMAT,
): ReplayVerification {
  const { header } = replay;
  const state = createBattle(replay.header.decks as [DeckList, DeckList], header.seed, {
    // 記録時とまったく同じ呼び方をする（省略/明示で乱数の消費が変わるため）
    firstPlayer: header.firstPlayerFromSeed ? undefined : header.firstPlayer,
    format,
    // 保存済みリプレイは記録時に検証済み。再生時に落とさない
    validate: false,
  });

  if (state.firstPlayer !== header.firstPlayer) {
    return {
      ok: false,
      mismatchAt: null,
      reason: `先攻が違います（記録: ${header.firstPlayer} / 再生: ${state.firstPlayer}）`,
      state,
    };
  }

  for (const command of replay.commands) {
    applyAction(state, command.action);
    const hash = stateHash(state);
    if (hash !== command.stateHash) {
      return {
        ok: false,
        mismatchAt: command.index,
        reason: `${command.index}手目で盤面が違います（記録: ${command.stateHash} / 再生: ${hash}）`,
        state,
      };
    }
  }

  // ターン上限による引き分けは手ではなく進行ルールで起きる。記録時と同じ判断をここでも行う。
  if (state.phase !== 'finished' && state.turn > header.maxTurns) {
    state.phase = 'finished';
    state.winner = null;
    state.endReason = 'turnLimit';
  }

  const finalHash = stateHash(state);
  if (finalHash !== replay.result.finalStateHash) {
    return {
      ok: false,
      mismatchAt: null,
      reason: `最終盤面が違います（記録: ${replay.result.finalStateHash} / 再生: ${finalHash}）`,
      state,
    };
  }
  return { ok: true, mismatchAt: null, reason: null, state };
}

/**
 * 旧版の保持方針（設計 10.5）。
 *
 * 進行中の試合とリプレイは開始時の版を参照し続けるため、参照中の旧版は消さない。
 * 「今の版と同じか」を判定できるようにして、違う版のリプレイを
 * 黙って今の版で再生しない（結果が変わってしまうため）ことを保証する。
 */
export const REPLAY_RETENTION_POLICY = Object.freeze({
  /** 参照中の engine/content/format 版はデプロイから削除しない */
  keepReferencedVersions: true,
  /** 版が違うリプレイは「再生できない」として扱い、今の版で流し直さない */
  refuseCrossVersionReplay: true,
});

export type ReplayCompatibility = 'exact' | 'engineChanged' | 'contentChanged' | 'formatChanged' | 'unknownFormat';

/**
 * このリプレイを今のビルドでそのまま再生してよいか。
 * 1つでも版が違えば `exact` 以外を返し、呼び出し側は再生せず「当時の版が必要」と扱う。
 */
export function replayCompatibility(
  header: ReplayHeader,
  format: FormatDefinition = DEFAULT_FORMAT,
): ReplayCompatibility {
  if (header.engineVersion !== ENGINE_VERSION) return 'engineChanged';
  if (header.contentVersion !== CONTENT_VERSION) return 'contentChanged';
  const parsed = parseFormatVersionId(header.formatVersionId);
  if (!parsed) return 'unknownFormat';
  if (header.formatVersionId !== formatVersionId(format)) return 'formatChanged';
  return 'exact';
}

/** そのまま再生してよいリプレイか */
export function canReplayExactly(header: ReplayHeader, format?: FormatDefinition): boolean {
  return replayCompatibility(header, format) === 'exact';
}

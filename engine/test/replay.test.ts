/**
 * リプレイ（版の固定・state hash・golden replay）のテスト。
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 10.5 / 11.4
 */
import { describe, expect, it } from 'vitest';
import { simpleAi, randomAi } from '../src/ai';
import { applyAction, createBattle } from '../src/battle';
import { sampleArchetypeDecks } from '../src/sampleDecks';
import { sampleDeck } from '../src/decks';
import { validateFormat, DEFAULT_FORMAT, type FormatDefinition } from '../src/formats';
import {
  REPLAY_FORMAT_VERSION,
  REPLAY_RETENTION_POLICY,
  canReplayExactly,
  recordBattle,
  replayCompatibility,
  stateHash,
  verifyReplay,
  type ReplayRecord,
} from '../src/replay';
import { CONTENT_MANIFEST, CONTENT_VERSION, ENGINE_VERSION } from '../src/versions';
import goldenJson from './golden/replay.json';
import { GOLDEN_REPLAY_SETUP } from './golden/setup';

const golden = goldenJson as unknown as ReplayRecord;

function presetDecks(): [ReturnType<typeof sampleArchetypeDecks>[number], ReturnType<typeof sampleArchetypeDecks>[number]] {
  const all = sampleArchetypeDecks();
  const [a, b] = GOLDEN_REPLAY_SETUP.deckNames.map((name) => {
    const found = all.find((d) => d.name === name);
    if (!found) throw new Error(`プリセットが見つかりません: ${name}`);
    return found;
  });
  return [a, b];
}

describe('golden replay', () => {
  it('記録した全手を流し直しても、各手のstate hashが一致する', () => {
    const verification = verifyReplay(golden);
    expect(verification.reason).toBeNull();
    expect(verification.ok).toBe(true);
  });

  it('golden replayは版を固定して持っている', () => {
    expect(golden.header.replayFormatVersion).toBe(REPLAY_FORMAT_VERSION);
    expect(golden.header.formatVersionId).toBe('FREE_V1@1');
    expect(golden.header.seed).toBe(GOLDEN_REPLAY_SETUP.seed);
    expect(golden.header.firstPlayer).toBe(GOLDEN_REPLAY_SETUP.firstPlayer);
  });

  it('今のビルドの版と一致する（ズレたら golden:update で作り直す）', () => {
    // ここが落ちたら、engine か公開カードデータを変えたということ。
    // 変更が意図したものか確かめ、必要なら ENGINE_VERSION を上げてから
    // `npm --workspace engine run golden:update` で作り直す。
    expect(golden.header.engineVersion).toBe(ENGINE_VERSION);
    expect(golden.header.contentVersion).toBe(CONTENT_VERSION);
    expect(canReplayExactly(golden.header)).toBe(true);
  });

  it('初期デッキsnapshotが自己完結している（今のプリセットに依存せず再生できる）', () => {
    expect(golden.header.decks).toHaveLength(2);
    for (const deck of golden.header.decks) {
      expect(deck.characterIds.length).toBeGreaterThan(0);
      expect(deck.cardIds).toHaveLength(40);
    }
  });

  it('終了理由と勝者を記録している', () => {
    expect(['wipeout', 'deckout', 'turnLimit']).toContain(golden.result.endReason);
    expect(golden.result.turns).toBeGreaterThan(0);
    expect(golden.commands.length).toBeGreaterThan(0);
  });

  it('1手でも書き換えると検査が落ちる', () => {
    const tampered: ReplayRecord = {
      ...golden,
      commands: golden.commands.map((c, i) => (i === 3 ? { ...c, stateHash: 'ffffffffffffffff' } : c)),
    };
    const verification = verifyReplay(tampered);
    expect(verification.ok).toBe(false);
    expect(verification.mismatchAt).toBe(3);
  });

  it('最終盤面のhashが違えば落ちる', () => {
    const tampered: ReplayRecord = {
      ...golden,
      result: { ...golden.result, finalStateHash: 'ffffffffffffffff' },
    };
    const verification = verifyReplay(tampered);
    expect(verification.ok).toBe(false);
    expect(verification.mismatchAt).toBeNull();
    expect(verification.reason).toContain('最終盤面');
  });
});

describe('決定論', () => {
  it('同じ入力からは毎回まったく同じ記録になる', () => {
    const [a, b] = presetDecks();
    const first = recordBattle([a.deck, b.deck], [simpleAi(), simpleAi()], GOLDEN_REPLAY_SETUP.seed, {
      firstPlayer: GOLDEN_REPLAY_SETUP.firstPlayer,
    });
    const second = recordBattle([a.deck, b.deck], [simpleAi(), simpleAi()], GOLDEN_REPLAY_SETUP.seed, {
      firstPlayer: GOLDEN_REPLAY_SETUP.firstPlayer,
    });
    expect(second.replay).toEqual(first.replay);
  });

  it('今のプリセットで記録し直しても golden と一致する', () => {
    const [a, b] = presetDecks();
    const { replay } = recordBattle(
      [a.deck, b.deck],
      [simpleAi(), simpleAi()],
      GOLDEN_REPLAY_SETUP.seed,
      { firstPlayer: GOLDEN_REPLAY_SETUP.firstPlayer },
    );
    expect(replay).toEqual(golden);
  });

  it('seedが違えば記録も違う', () => {
    const [a, b] = presetDecks();
    const other = recordBattle([a.deck, b.deck], [simpleAi(), simpleAi()], GOLDEN_REPLAY_SETUP.seed + 1, {
      firstPlayer: GOLDEN_REPLAY_SETUP.firstPlayer,
    });
    expect(other.replay.result.finalStateHash).not.toBe(golden.result.finalStateHash);
  });

  it('ターン上限で引き分けた試合も再生できる', () => {
    const [a, b] = presetDecks();
    const { replay } = recordBattle([a.deck, b.deck], [simpleAi(), simpleAi()], 42, { maxTurns: 3 });
    expect(replay.result.endReason).toBe('turnLimit');
    expect(replay.result.winner).toBeNull();
    expect(replay.header.maxTurns).toBe(3);
    expect(verifyReplay(replay).ok).toBe(true);
  });

  it('記録したリプレイはその場で検査を通る（ランダムAIでも）', () => {
    for (const seed of [1, 2, 3]) {
      const { replay } = recordBattle(
        [sampleDeck(seed), sampleDeck(seed + 10)],
        [randomAi(seed), randomAi(seed + 1)],
        seed,
      );
      expect(verifyReplay(replay).ok, `seed=${seed}`).toBe(true);
    }
  });
});

describe('state hash', () => {
  const decks: [ReturnType<typeof sampleDeck>, ReturnType<typeof sampleDeck>] = [
    sampleDeck(1),
    sampleDeck(2),
  ];

  it('同じ盤面なら同じ値', () => {
    const a = createBattle(decks, 42, { firstPlayer: 0 });
    const b = createBattle(decks, 42, { firstPlayer: 0 });
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('盤面が動けば変わる', () => {
    const state = createBattle(decks, 42, { firstPlayer: 0 });
    const before = stateHash(state);
    const ai = simpleAi();
    applyAction(state, ai.choose(state, state.active));
    expect(stateHash(state)).not.toBe(before);
  });

  it('ログや演出イベントを足しただけでは変わらない（文言の修正で決定論検査を壊さない）', () => {
    const state = createBattle(decks, 42, { firstPlayer: 0 });
    const before = stateHash(state);
    state.log.push('表示用のログ');
    state.logSeq++;
    state.eventSeq++;
    expect(stateHash(state)).toBe(before);
  });

  it('16桁の16進で返る', () => {
    expect(stateHash(createBattle(decks, 42))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('content manifest', () => {
  it('公開カードと公開弾から版を作る', () => {
    expect(CONTENT_MANIFEST.contentVersion).toMatch(/^c1-[0-9a-f]{16}$/);
    expect(CONTENT_MANIFEST.cardCount).toBeGreaterThan(0);
    expect(CONTENT_MANIFEST.setCount).toBeGreaterThan(0);
    expect(CONTENT_MANIFEST.oracleCount).toBeLessThanOrEqual(CONTENT_MANIFEST.cardCount);
  });

  it('書き換えられない（進行中の試合が参照している版を守る）', () => {
    expect(Object.isFrozen(CONTENT_MANIFEST)).toBe(true);
    expect(() => {
      (CONTENT_MANIFEST as { contentVersion: string }).contentVersion = 'c1-0000000000000000';
    }).toThrow();
    expect(CONTENT_MANIFEST.contentVersion).toBe(CONTENT_VERSION);
  });

  it('engine versionを持っている', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('旧版の保持方針', () => {
  const otherFormat: FormatDefinition = validateFormat({
    formatId: 'FREE_V1',
    version: 2,
    nameKey: 'format.free.name',
    name: 'フリー',
    activeFrom: '2026-08-01',
    activeTo: null,
    setPolicy: 'ALL',
    latestN: null,
    allowedSetIds: [],
    bannedOracleIds: [],
    restrictedOracleIds: [],
    deckSize: 40,
    maxCopies: 4,
    characterSlotPolicy: 'EXACT_CAPACITY_3',
    zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
  });

  it('参照中の旧版は消さず、版違いは今の版で再生しない', () => {
    expect(REPLAY_RETENTION_POLICY.keepReferencedVersions).toBe(true);
    expect(REPLAY_RETENTION_POLICY.refuseCrossVersionReplay).toBe(true);
  });

  it('版が全部一致していれば exact', () => {
    expect(replayCompatibility(golden.header)).toBe('exact');
    expect(canReplayExactly(golden.header)).toBe(true);
  });

  it('engine版が違えば engineChanged', () => {
    const header = { ...golden.header, engineVersion: '9.9.9' };
    expect(replayCompatibility(header)).toBe('engineChanged');
    expect(canReplayExactly(header)).toBe(false);
  });

  it('content版が違えば contentChanged', () => {
    const header = { ...golden.header, contentVersion: 'c1-0000000000000000' };
    expect(replayCompatibility(header)).toBe('contentChanged');
  });

  it('format版が違えば formatChanged（同じformatIdでもversion違いは別物）', () => {
    expect(replayCompatibility(golden.header, otherFormat)).toBe('formatChanged');
    const header = { ...golden.header, formatVersionId: 'FREE_V1@2' };
    expect(replayCompatibility(header, DEFAULT_FORMAT)).toBe('formatChanged');
  });

  it('壊れたformat参照子は unknownFormat', () => {
    expect(replayCompatibility({ ...golden.header, formatVersionId: 'こわれた' })).toBe(
      'unknownFormat',
    );
  });
});

describe('リプレイのheader', () => {
  it('設計11.4が求める項目をすべて持つ', () => {
    const [a, b] = presetDecks();
    const { replay } = recordBattle([a.deck, b.deck], [simpleAi(), simpleAi()], 7);
    const header = replay.header;
    expect(header.seed).toBe(7);
    expect(header.engineVersion).toBe(ENGINE_VERSION);
    expect(header.contentVersion).toBe(CONTENT_VERSION);
    expect(header.formatVersionId).toBe('FREE_V1@1');
    expect(header.decks[0].cardIds).toHaveLength(40);
    expect(replay.result.endReason).toBeTruthy();
    expect(replay.commands.every((c) => /^[0-9a-f]{16}$/.test(c.stateHash))).toBe(true);
  });

  it('初期デッキsnapshotは後からデッキを触っても変わらない', () => {
    const deck = sampleDeck(5);
    const { replay } = recordBattle([deck, sampleDeck(6)], [simpleAi(), simpleAi()], 9);
    const recorded = [...replay.header.decks[0].cardIds];
    deck.cardIds.push('1-A129-C');
    expect(replay.header.decks[0].cardIds).toEqual(recorded);
  });

  it('フォーマット版を渡すとheaderへ記録される', () => {
    const [a, b] = presetDecks();
    const { replay } = recordBattle([a.deck, b.deck], [simpleAi(), simpleAi()], 3, {
      format: DEFAULT_FORMAT,
    });
    expect(replay.header.formatVersionId).toBe('FREE_V1@1');
  });
});

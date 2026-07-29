import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PublishCardSetError,
  cleanupCardSet,
  gitBlobSha,
  prepareCardSet,
  verifyCardSet,
  unlockCardSet,
} from './publish-card-set.mjs';

const REQUEST_ID = '15f7ea40-b0c4-4d9b-bc1f-4512bb5dbe37';
const SECRET_NAME = 'UNRELEASED_SECRET_CARD_NAME';
const SECRET_META = 'UNRELEASED_SECRET_SET_META';

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function putJson(path, value) {
  await put(path, jsonBytes(value));
}

function skill({
  oracleId,
  printingId,
  vol,
  code,
  name,
  baseValue = 3,
}) {
  return {
    oracleId,
    printingId,
    vol,
    code,
    rarity: 'C',
    name,
    type: 'skill',
    effectText: '',
    flavorText: '',
    costAp: 1,
    conditionAttribute: ['斬'],
    baseValue,
    valueType: 'attack',
  };
}

async function fixture({ drift = false, orphanCollision = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bravers-publish-test-'));
  const publicDir = resolve(root, 'public');
  const wipDir = resolve(root, 'wip');
  const publicCard = skill({
    oracleId: 'shared-oracle',
    printingId: '1-A001-C',
    vol: 1,
    code: 'A001',
    name: '公開済みカード',
  });
  const wipCard = skill({
    oracleId: 'shared-oracle',
    printingId: '2-A001-C',
    vol: 2,
    code: 'A001',
    name: SECRET_NAME,
    baseValue: drift ? 99 : 3,
  });
  const wipSet = {
    vol: 2,
    status: 'publishing',
    publishOperationId: REQUEST_ID,
    themeName: SECRET_META,
    packType: 'DX',
  };
  const publicSets = {
    _comment: 'public',
    sets: [{ vol: 1, status: 'released', themeName: '公開済み' }],
  };
  const wipSets = {
    _comment: 'private',
    sets: [wipSet],
  };
  const image = Buffer.from(
    'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
    'base64',
  );
  const effects = Buffer.from(
    'export const VOL2_EFFECTS = {};\n',
    'utf8',
  );
  const effectTests = Buffer.from(
    "import { expect, test } from 'vitest';\n" +
      "test('vol2 effects', () => expect(true).toBe(true));\n",
    'utf8',
  );
  const cardsBytes = jsonBytes([wipCard]);

  await Promise.all([
    putJson(resolve(publicDir, 'data/cards.json'), [publicCard]),
    putJson(resolve(publicDir, 'data/sets.json'), publicSets),
    put(
      resolve(publicDir, `assets/card_images/${publicCard.printingId}.webp`),
      Buffer.from('public-image'),
    ),
    put(resolve(wipDir, 'cards/vol2.json'), cardsBytes),
    put(resolve(wipDir, 'effects/vol2.ts'), effects),
    put(resolve(wipDir, 'effects/vol2.test.ts'), effectTests),
    putJson(resolve(wipDir, 'sets.wip.json'), wipSets),
    put(
      resolve(wipDir, `images/${wipCard.printingId}.webp`),
      image,
    ),
  ]);
  const active = {
    schemaVersion: 3,
    vol: 2,
    requestId: REQUEST_ID,
    set: wipSet,
    cardsSha: gitBlobSha(cardsBytes),
    effectsSha: gitBlobSha(effects),
    effectTestsSha: gitBlobSha(effectTests),
    imageShas: {
      [wipCard.printingId]: gitBlobSha(image),
    },
    cardCount: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
  };
  await putJson(resolve(wipDir, 'publish_jobs/active.json'), active);
  if (orphanCollision) {
    await put(
      resolve(publicDir, `assets/card_images/${wipCard.printingId}.webp`),
      Buffer.from('orphan'),
    );
  }
  return {
    root,
    publicDir,
    wipDir,
    publicCard,
    wipCard,
    wipSet,
    active,
    image,
    effects,
    effectTests,
    options: {
      vol: 2,
      publicDir,
      wipDir,
      requestId: REQUEST_ID,
    },
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

test('prepareは正規の再録を公開完成形へし、公開済み再実行を冪等判定する', async () => {
  const f = await fixture();
  assert.deepEqual(await prepareCardSet(f.options), {
    ok: true,
    state: 'prepared',
  });

  const cards = JSON.parse(
    await readFile(resolve(f.publicDir, 'data/cards.json'), 'utf8'),
  );
  assert.equal(cards.length, 2);
  assert.equal(cards[1].oracleId, f.publicCard.oracleId);
  assert.equal(cards[1].printingId, f.wipCard.printingId);
  const sets = JSON.parse(
    await readFile(resolve(f.publicDir, 'data/sets.json'), 'utf8'),
  );
  assert.equal(
    sets.sets.find((set) => set.vol === 2).status,
    'released',
  );
  assert.equal(
    'publishOperationId' in sets.sets.find((set) => set.vol === 2),
    false,
  );
  assert.deepEqual(
    await readFile(
      resolve(
        f.publicDir,
        `assets/card_images/${f.wipCard.printingId}.webp`,
      ),
    ),
    f.image,
  );
  assert.deepEqual(
    await readFile(
      resolve(f.publicDir, 'engine/src/effects/vol2.ts'),
    ),
    f.effects,
  );
  assert.deepEqual(
    await readFile(
      resolve(f.publicDir, 'engine/test/effects/vol2.test.ts'),
    ),
    f.effectTests,
  );
  const releasedEffects = await readFile(
    resolve(f.publicDir, 'engine/src/effects/released.ts'),
    'utf8',
  );
  assert.match(releasedEffects, /VOL1_EFFECTS/);
  assert.match(releasedEffects, /VOL2_EFFECTS/);

  const before = await Promise.all([
    readFile(resolve(f.publicDir, 'data/cards.json')),
    readFile(resolve(f.publicDir, 'data/sets.json')),
  ]);
  assert.deepEqual(await prepareCardSet(f.options), {
    ok: true,
    state: 'already-released',
  });
  const after = await Promise.all([
    readFile(resolve(f.publicDir, 'data/cards.json')),
    readFile(resolve(f.publicDir, 'data/sets.json')),
  ]);
  assert.deepEqual(after, before);
});

test('prepareはOracle driftと公開画像衝突を一般化エラーで拒否し、公開側を変えない', async (t) => {
  for (const [label, options] of [
    ['drift', { drift: true }],
    ['collision', { orphanCollision: true }],
  ]) {
    await t.test(label, async () => {
      const f = await fixture(options);
      const before = await Promise.all([
        readFile(resolve(f.publicDir, 'data/cards.json')),
        readFile(resolve(f.publicDir, 'data/sets.json')),
      ]);
      await assert.rejects(
        prepareCardSet(f.options),
        (error) => {
          assert.ok(error instanceof PublishCardSetError);
          assert.equal(error.message, '公開準備の検証に失敗しました');
          assert.doesNotMatch(error.message, new RegExp(SECRET_NAME));
          assert.doesNotMatch(error.message, new RegExp(SECRET_META));
          assert.doesNotMatch(
            error.message,
            new RegExp(f.wipCard.printingId),
          );
          return true;
        },
      );
      const after = await Promise.all([
        readFile(resolve(f.publicDir, 'data/cards.json')),
        readFile(resolve(f.publicDir, 'data/sets.json')),
      ]);
      assert.deepEqual(after, before);
    });
  }
});

test('manifestのrequestIdまたはGit blob SHAが違えばprepareを拒否する', async (t) => {
  await t.test('requestId', async () => {
    const f = await fixture();
    await assert.rejects(
      prepareCardSet({
        ...f.options,
        requestId: 'f2d25e2f-b93a-4488-bec7-1fc11ea42ad4',
      }),
      /公開準備の検証に失敗/,
    );
  });
  await t.test('cards SHA', async () => {
    const f = await fixture();
    await putJson(resolve(f.wipDir, 'cards/vol2.json'), [
      { ...f.wipCard, flavorText: 'manifest作成後の改変' },
    ]);
    await assert.rejects(
      prepareCardSet(f.options),
      /公開準備の検証に失敗/,
    );
  });
  await t.test('image SHA', async () => {
    const f = await fixture();
    await writeFile(
      resolve(f.wipDir, `images/${f.wipCard.printingId}.webp`),
      Buffer.from('tampered'),
    );
    await assert.rejects(
      prepareCardSet(f.options),
      /公開準備の検証に失敗/,
    );
  });
  await t.test('effects SHA', async () => {
    const f = await fixture();
    await writeFile(
      resolve(f.wipDir, 'effects/vol2.ts'),
      'export const VOL2_EFFECTS = { tampered: true };\n',
    );
    await assert.rejects(
      prepareCardSet(f.options),
      /公開準備の検証に失敗/,
    );
  });
  await t.test('effect tests SHA', async () => {
    const f = await fixture();
    await writeFile(
      resolve(f.wipDir, 'effects/vol2.test.ts'),
      "import { test } from 'vitest'; test('tampered', () => {});\n",
    );
    await assert.rejects(
      prepareCardSet(f.options),
      /公開準備の検証に失敗/,
    );
  });
});

test('prepareは暫定Oracle・ID前後空白・不正なPrinting IDを拒否する', async (t) => {
  for (const [label, mutateCard] of [
    [
      'provisional oracle',
      (card) => ({
        ...card,
        oracleId: card.printingId,
        oracleIdProvisional: true,
      }),
    ],
    [
      'invalid printing ID',
      (card) => ({ ...card, printingId: '2-A1-C' }),
    ],
    [
      'oracle ID whitespace',
      (card) => ({ ...card, oracleId: ` ${card.oracleId}` }),
    ],
    [
      'printing ID whitespace',
      (card) => ({ ...card, printingId: `${card.printingId} ` }),
    ],
  ]) {
    await t.test(label, async () => {
      const f = await fixture();
      const cardsBytes = jsonBytes([mutateCard(f.wipCard)]);
      await put(resolve(f.wipDir, 'cards/vol2.json'), cardsBytes);
      await putJson(resolve(f.wipDir, 'publish_jobs/active.json'), {
        ...f.active,
        cardsSha: gitBlobSha(cardsBytes),
      });

      await assert.rejects(
        prepareCardSet(f.options),
        /公開準備の検証に失敗/,
      );
      const publicCards = JSON.parse(
        await readFile(resolve(f.publicDir, 'data/cards.json'), 'utf8'),
      );
      assert.deepEqual(publicCards, [f.publicCard]);
      assert.equal(
        await exists(
          resolve(
            f.publicDir,
            `assets/card_images/${f.wipCard.printingId}.webp`,
          ),
        ),
        false,
      );
    });
  }
});

test('cleanupは公開側との完全一致後だけWIPとactive manifestを削除する', async () => {
  const f = await fixture();
  await prepareCardSet(f.options);
  assert.deepEqual(await verifyCardSet(f.options), {
    ok: true,
    state: 'verified',
  });
  assert.deepEqual(await cleanupCardSet(f.options), {
    ok: true,
    state: 'cleaned',
  });

  assert.equal(
    await exists(resolve(f.wipDir, 'cards/vol2.json')),
    false,
  );
  assert.equal(
    await exists(resolve(f.wipDir, 'effects/vol2.ts')),
    false,
  );
  assert.equal(
    await exists(resolve(f.wipDir, 'effects/vol2.test.ts')),
    false,
  );
  const sets = JSON.parse(
    await readFile(resolve(f.wipDir, 'sets.wip.json'), 'utf8'),
  );
  assert.equal(sets.sets.some((set) => set.vol === 2), false);
  assert.equal(
    await exists(
      resolve(f.wipDir, `images/${f.wipCard.printingId}.webp`),
    ),
    false,
  );
  assert.equal(
    await exists(resolve(f.wipDir, 'publish_jobs/active.json')),
    false,
  );
});

test('cleanupは公開画像が一致しなければWIPを一切削除しない', async () => {
  const f = await fixture();
  await prepareCardSet(f.options);
  await writeFile(
    resolve(
      f.publicDir,
      `assets/card_images/${f.wipCard.printingId}.webp`,
    ),
    Buffer.from('tampered-public'),
  );
  await assert.rejects(
    cleanupCardSet(f.options),
    /公開後処理の検証に失敗/,
  );
  assert.equal(
    await exists(resolve(f.wipDir, 'publish_jobs/active.json')),
    true,
  );
  assert.equal(
    await exists(
      resolve(f.wipDir, `images/${f.wipCard.printingId}.webp`),
    ),
    true,
  );
  const cards = JSON.parse(
    await readFile(resolve(f.wipDir, 'cards/vol2.json'), 'utf8'),
  );
  assert.equal(cards.length, 1);
});

test('unlockはmanifest検証後にsetをdraftへ戻し、activeをfailed_validation履歴へ移す', async () => {
  const f = await fixture();
  assert.deepEqual(
    await unlockCardSet({
      vol: 2,
      wipDir: f.wipDir,
      requestId: REQUEST_ID,
    }),
    { ok: true, state: 'unlocked' },
  );
  const sets = JSON.parse(
    await readFile(resolve(f.wipDir, 'sets.wip.json'), 'utf8'),
  );
  assert.equal(sets.sets[0].status, 'draft');
  assert.equal('publishOperationId' in sets.sets[0], false);
  const history = JSON.parse(
    await readFile(
      resolve(
        f.wipDir,
        `publish_jobs/history/${REQUEST_ID}.json`,
      ),
      'utf8',
    ),
  );
  assert.equal(history.status, 'failed_validation');
  assert.equal(history.requestId, REQUEST_ID);
  assert.equal(
    await exists(resolve(f.wipDir, 'publish_jobs/active.json')),
    false,
  );
  assert.equal(
    await exists(resolve(f.wipDir, 'cards/vol2.json')),
    true,
  );
  assert.equal(
    await exists(
      resolve(f.wipDir, `images/${f.wipCard.printingId}.webp`),
    ),
    true,
  );
});

test('unlockはカードsnapshot破損後でもロックを解除できる', async () => {
  const f = await fixture();
  await putJson(resolve(f.wipDir, 'cards/vol2.json'), [
    { ...f.wipCard, printingId: 'invalid' },
  ]);
  assert.deepEqual(
    await unlockCardSet({
      vol: 2,
      wipDir: f.wipDir,
      requestId: REQUEST_ID,
    }),
    { ok: true, state: 'unlocked' },
  );
  const sets = JSON.parse(
    await readFile(resolve(f.wipDir, 'sets.wip.json'), 'utf8'),
  );
  assert.equal(sets.sets[0].status, 'draft');
  assert.equal(
    await exists(resolve(f.wipDir, 'publish_jobs/active.json')),
    false,
  );
});

test('unlockは履歴・draft保存後の中断から冪等に完了する', async () => {
  const f = await fixture();
  const draftSet = { ...f.wipSet, status: 'draft' };
  delete draftSet.publishOperationId;
  const failedHistory = {
    ...f.active,
    status: 'failed_validation',
  };
  await Promise.all([
    putJson(resolve(f.wipDir, 'sets.wip.json'), { sets: [draftSet] }),
    putJson(
      resolve(
        f.wipDir,
        `publish_jobs/history/${REQUEST_ID}.json`,
      ),
      failedHistory,
    ),
  ]);

  assert.deepEqual(
    await unlockCardSet({
      vol: 2,
      wipDir: f.wipDir,
      requestId: REQUEST_ID,
    }),
    { ok: true, state: 'unlocked' },
  );
  assert.equal(
    await exists(resolve(f.wipDir, 'publish_jobs/active.json')),
    false,
  );
});

test('plain node CLIの成功・失敗出力へ未公開値を出さない', async () => {
  const success = await fixture();
  const script = fileURLToPath(
    new URL('./publish-card-set.mjs', import.meta.url),
  );
  const ok = spawnSync(
    process.execPath,
    [
      script,
      'prepare',
      '--vol',
      '2',
      '--public-dir',
      success.publicDir,
      '--wip-dir',
      success.wipDir,
      '--request-id',
      REQUEST_ID,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');
  assert.match(ok.stdout, /"state":"prepared"/);
  assert.doesNotMatch(ok.stdout, new RegExp(SECRET_NAME));
  assert.doesNotMatch(ok.stdout, new RegExp(SECRET_META));

  const failure = await fixture({ drift: true });
  const ng = spawnSync(
    process.execPath,
    [
      script,
      'prepare',
      '--vol',
      '2',
      '--public-dir',
      failure.publicDir,
      '--wip-dir',
      failure.wipDir,
      '--request-id',
      REQUEST_ID,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(ng.status, 1);
  assert.equal(ng.stdout, '');
  assert.match(ng.stderr, /公開準備の検証に失敗/);
  for (const secret of [
    SECRET_NAME,
    SECRET_META,
    failure.wipCard.printingId,
  ]) {
    assert.equal(ng.stderr.includes(secret), false);
  }
});

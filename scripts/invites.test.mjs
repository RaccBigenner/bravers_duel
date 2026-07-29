/**
 * 招待コード純粋ロジック（invites.mjs）のテスト。
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 8.6
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  REDEMPTION_REJECTION_REASONS,
  applyRedemption,
  checkBatchIssuance,
  checkRedemption,
  generateCode,
  isValidCodeFormat,
  planBatchIssuance,
} from './invites.mjs';

function code(overrides = {}) {
  return {
    id: 'code-1',
    status: 'active',
    expiresAt: '2026-08-26T00:00:00Z',
    useCount: 0,
    maxUses: 1,
    issuedBy: null,
    ...overrides,
  };
}

function account(overrides = {}) {
  return { id: 'acc-1', hasRedeemedInvite: false, ...overrides };
}

const NOW = '2026-08-01T00:00:00Z';

test('generateCode: 決められた文字数・アルファベットで作る', () => {
  let calls = 0;
  const c = generateCode((max) => {
    calls++;
    assert.equal(max, CODE_ALPHABET.length);
    return 0;
  });
  assert.equal(calls, CODE_LENGTH);
  assert.equal(c.length, CODE_LENGTH);
  assert.ok(isValidCodeFormat(c));
});

test('generateCode: 乱数の戻り値をそのまま文字に反映する', () => {
  let i = 0;
  const indices = [0, 1, 2, 3, 4, 5];
  const c = generateCode(() => indices[i++]);
  assert.equal(c, indices.map((idx) => CODE_ALPHABET[idx]).join(''));
});

test('isValidCodeFormat: 紛らわしい文字（I/L/O/0/1）は使わない', () => {
  for (const ch of ['I', 'L', 'O', '0', '1']) {
    assert.equal(CODE_ALPHABET.includes(ch), false, ch);
  }
});

test('isValidCodeFormat: 正しい形だけ通す', () => {
  assert.equal(isValidCodeFormat('ABCDEF'), true);
  assert.equal(isValidCodeFormat('abcdef'), false, '小文字は不可');
  assert.equal(isValidCodeFormat('ABCDE'), false, '5文字は不可');
  assert.equal(isValidCodeFormat('ABCDEFG'), false, '7文字は不可');
  assert.equal(isValidCodeFormat('ABCDE0'), false, '0を含む');
  assert.equal(isValidCodeFormat('ABCDEI'), false, 'Iを含む');
  assert.equal(isValidCodeFormat(''), false);
  assert.equal(isValidCodeFormat(null), false);
  assert.equal(isValidCodeFormat(undefined), false);
  assert.equal(isValidCodeFormat(123456), false, '文字列でない');
});

test('checkRedemption: 存在しないコードは NOT_FOUND', () => {
  assert.deepEqual(checkRedemption(null, account(), NOW), { ok: false, reason: 'NOT_FOUND' });
});

test('checkRedemption: 取り消し済みは REVOKED', () => {
  const result = checkRedemption(code({ status: 'revoked' }), account(), NOW);
  assert.deepEqual(result, { ok: false, reason: 'REVOKED' });
});

test('checkRedemption: 期限切れは EXPIRED（境界: ちょうど期限は成立する）', () => {
  const expired = checkRedemption(code({ expiresAt: '2026-07-31T23:59:59Z' }), account(), NOW);
  assert.deepEqual(expired, { ok: false, reason: 'EXPIRED' });

  const exactlyOnDeadline = checkRedemption(code({ expiresAt: NOW }), account(), NOW);
  assert.deepEqual(exactlyOnDeadline, { ok: true });

  const notYetExpired = checkRedemption(
    code({ expiresAt: '2026-08-01T00:00:01Z' }),
    account(),
    NOW,
  );
  assert.deepEqual(notYetExpired, { ok: true });
});

test('checkRedemption: expiresAtがnullなら期限なし', () => {
  assert.deepEqual(checkRedemption(code({ expiresAt: null }), account(), NOW), { ok: true });
});

test('checkRedemption: 使用回数の上限（境界値）', () => {
  assert.deepEqual(checkRedemption(code({ useCount: 0, maxUses: 1 }), account(), NOW), {
    ok: true,
  });
  assert.deepEqual(checkRedemption(code({ useCount: 1, maxUses: 1 }), account(), NOW), {
    ok: false,
    reason: 'EXHAUSTED',
  });
  assert.deepEqual(checkRedemption(code({ useCount: 1, maxUses: 2 }), account(), NOW), {
    ok: true,
  });
  assert.deepEqual(checkRedemption(code({ useCount: 2, maxUses: 2 }), account(), NOW), {
    ok: false,
    reason: 'EXHAUSTED',
  });
});

test('checkRedemption: 自分が発行したコードは自分で消費できない', () => {
  const result = checkRedemption(
    code({ issuedBy: 'acc-1' }),
    account({ id: 'acc-1' }),
    NOW,
  );
  assert.deepEqual(result, { ok: false, reason: 'SELF_REDEEM' });
});

test('checkRedemption: 他人が発行したコードは消費できる', () => {
  const result = checkRedemption(
    code({ issuedBy: 'acc-2' }),
    account({ id: 'acc-1' }),
    NOW,
  );
  assert.deepEqual(result, { ok: true });
});

test('checkRedemption: issuedByがnull（admin_batch）は誰でも消費できる', () => {
  const result = checkRedemption(code({ issuedBy: null }), account({ id: 'acc-1' }), NOW);
  assert.deepEqual(result, { ok: true });
});

test('checkRedemption: 1アカウント1回まで（既に招待済みなら ALREADY_INVITED）', () => {
  const result = checkRedemption(code(), account({ hasRedeemedInvite: true }), NOW);
  assert.deepEqual(result, { ok: false, reason: 'ALREADY_INVITED' });
});

test('checkRedemption: 複数条件に同時に違反しても、最初に見つかった理由を返す', () => {
  // REVOKED はEXPIREDより先に判定される
  const result = checkRedemption(
    code({ status: 'revoked', expiresAt: '2020-01-01T00:00:00Z' }),
    account(),
    NOW,
  );
  assert.equal(result.reason, 'REVOKED');
});

test('checkRedemption: 拒否理由は定義済みの一覧に含まれる', () => {
  const cases = [
    [null, account()],
    [code({ status: 'revoked' }), account()],
    [code({ expiresAt: '2020-01-01T00:00:00Z' }), account()],
    [code({ useCount: 1, maxUses: 1 }), account()],
    [code({ issuedBy: 'acc-1' }), account({ id: 'acc-1' })],
    [code(), account({ hasRedeemedInvite: true })],
  ];
  for (const [c, a] of cases) {
    const result = checkRedemption(c, a, NOW);
    assert.equal(result.ok, false);
    assert.ok(REDEMPTION_REJECTION_REASONS.includes(result.reason), result.reason);
  }
});

test('applyRedemption: useCountを1増やし、redemption記録を作る', () => {
  const c = code({ id: 'code-42', useCount: 0 });
  const a = account({ id: 'acc-9' });
  const { updatedCode, redemption, referralSeeds } = applyRedemption(c, a, NOW);
  assert.equal(updatedCode.useCount, 1);
  assert.equal(c.useCount, 0, '元のオブジェクトは変えない');
  assert.deepEqual(redemption, { inviteCodeId: 'code-42', redeemedBy: 'acc-9', redeemedAt: NOW });
  assert.deepEqual(referralSeeds, []);
});

test('applyRedemption: grantReferralCodesがtrueなら2枠ぶんの種を返す', () => {
  const { referralSeeds } = applyRedemption(code(), account({ id: 'acc-9' }), NOW, {
    grantReferralCodes: true,
  });
  assert.equal(referralSeeds.length, 2);
  for (const seed of referralSeeds) {
    assert.deepEqual(seed, { source: 'referral', issuedBy: 'acc-9', maxUses: 1 });
  }
});

test('applyRedemption: grantReferralCodesを渡さなければ種は作らない（ゲストのまま消費した場合）', () => {
  const { referralSeeds } = applyRedemption(code(), account(), NOW);
  assert.deepEqual(referralSeeds, []);
  const { referralSeeds: seeds2 } = applyRedemption(code(), account(), NOW, {
    grantReferralCodes: false,
  });
  assert.deepEqual(seeds2, []);
});

test('checkBatchIssuance: wave計画人数を超えない発行は成立する', () => {
  const wave = { wave: 1, plannedCount: 10 };
  assert.deepEqual(checkBatchIssuance(wave, 0, 10), { ok: true });
  assert.deepEqual(checkBatchIssuance(wave, 5, 5), { ok: true });
});

test('checkBatchIssuance: 計画人数を1でも超えると拒否する（境界値）', () => {
  const wave = { wave: 1, plannedCount: 10 };
  const result = checkBatchIssuance(wave, 5, 6);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WAVE_CAP_EXCEEDED');
  assert.equal(result.remaining, 5);
});

test('checkBatchIssuance: 既に上限まで発行済みなら残りは0', () => {
  const wave = { wave: 1, plannedCount: 10 };
  const result = checkBatchIssuance(wave, 10, 1);
  assert.equal(result.ok, false);
  assert.equal(result.remaining, 0);
});

test('checkBatchIssuance: 0件以下の発行要求は拒否する', () => {
  const wave = { wave: 1, plannedCount: 10 };
  assert.equal(checkBatchIssuance(wave, 0, 0).ok, false);
  assert.equal(checkBatchIssuance(wave, 0, -1).ok, false);
});

test('planBatchIssuance: 要求した件数ぶんadmin_batchの雛形を作る', () => {
  const wave = { wave: 2, plannedCount: 15 };
  const plans = planBatchIssuance(wave, 3, '2026-08-19T00:00:00Z');
  assert.equal(plans.length, 3);
  for (const plan of plans) {
    assert.deepEqual(plan, {
      source: 'admin_batch',
      wave: 2,
      issuedBy: null,
      maxUses: 1,
      status: 'active',
      expiresAt: '2026-08-19T00:00:00Z',
    });
  }
});

test('planBatchIssuance: 0件を要求すれば空配列', () => {
  assert.deepEqual(planBatchIssuance({ wave: 1, plannedCount: 10 }, 0, null), []);
});

test('MARKETING-001の3波（10/15/10）が単純合計で35人ぶん収まる', () => {
  const waves = [
    { wave: 1, plannedCount: 10 },
    { wave: 2, plannedCount: 15 },
    { wave: 3, plannedCount: 10 },
  ];
  const total = waves.reduce((sum, w) => sum + w.plannedCount, 0);
  assert.equal(total, 35);
  for (const wave of waves) {
    assert.equal(checkBatchIssuance(wave, 0, wave.plannedCount).ok, true);
    assert.equal(checkBatchIssuance(wave, 0, wave.plannedCount + 1).ok, false);
  }
});

test('シナリオ: referralで招待の輪が1段広がる', () => {
  // acc-1（外部ID連携済み）がadmin_batchコードを消費 → referral 2枠を得る
  const batchCode = code({ id: 'batch-1', issuedBy: null });
  const acc1 = account({ id: 'acc-1' });
  assert.deepEqual(checkRedemption(batchCode, acc1, NOW), { ok: true });
  const step1 = applyRedemption(batchCode, acc1, NOW, { grantReferralCodes: true });
  assert.equal(step1.referralSeeds.length, 2);

  // 発行されたreferralコードの1つをacc-2が消費する
  const referralCode = code({ id: 'ref-1', issuedBy: 'acc-1', ...step1.referralSeeds[0] });
  const acc2 = account({ id: 'acc-2' });
  assert.deepEqual(checkRedemption(referralCode, acc2, NOW), { ok: true });

  // acc-1は自分が発行したreferralコードを自分では使えない
  assert.deepEqual(checkRedemption(referralCode, acc1, NOW), {
    ok: false,
    reason: 'SELF_REDEEM',
  });

  // acc-2は一度消費したら、別のコードももう消費できない
  const acc2AfterRedeem = account({ id: 'acc-2', hasRedeemedInvite: true });
  const anotherCode = code({ id: 'ref-2' });
  assert.deepEqual(checkRedemption(anotherCode, acc2AfterRedeem, NOW), {
    ok: false,
    reason: 'ALREADY_INVITED',
  });
});

/**
 * 招待コード（G2 Collection Closed Betaの受け口）の純粋ロジック。
 *
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 8.6「招待コード（G2）」
 * 背景: docs/MARKETING-001_招待βの集客計画.md
 *
 * `server/`workspace（OLG-101）がまだ無いため、DB・行ロック・APIを持たない
 * 決定論的な判定・状態遷移だけをここへ置く。engine/src/deckLegality.ts や
 * engine/src/formats.ts と同じ考え方（I/Oも現在時刻も持ち込まない）。
 * OLG-101がscaffoldされたら、この中身をそのまま`server/src/auth/`か
 * `server/src/economy/`へ移す想定。
 *
 * 行ロック（`invite_code`行のFOR UPDATE）、`invite_redemption`への永続化、
 * rate limitはサーバー側の責務。ここでは「今の状態でこの消費が成立するか」と
 * 「成立したら次の状態はどうなるか」だけを決める。
 */

/** 読み上げ・手書きの誤読を避けるため I/L/O/0/1 を除いた31文字（設計8.6.2） */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/**
 * 招待コードを1つ生成する。
 * `randomInt(max)` は `[0, max)` の一様乱数を返す関数（呼び出し側が用意する）。
 * サーバーは暗号学的乱数を渡し、テストは決定論的な乱数を渡す。
 */
export function generateCode(randomInt) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

const CODE_FORMAT_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** コードの見た目が正しいか（存在確認はしない） */
export function isValidCodeFormat(code) {
  return typeof code === 'string' && CODE_FORMAT_RE.test(code);
}

export const INVITE_SOURCES = ['admin_batch', 'referral'];

export const REDEMPTION_REJECTION_REASONS = [
  'NOT_FOUND',
  'REVOKED',
  'EXPIRED',
  'EXHAUSTED',
  'SELF_REDEEM',
  'ALREADY_INVITED',
];

/**
 * このコードをこのアカウントが今消費できるか（設計8.6.4の受理条件）。
 *
 * @param inviteCode - `{ status, expiresAt, useCount, maxUses, issuedBy }` の形。
 *   `null`ならコードが存在しない（サーバーのDB検索結果をそのまま渡す）
 * @param account - `{ id, hasRedeemedInvite }`
 * @param now - ISO日時文字列（呼び出し側が渡す。エンジン同様ここでは現在時刻を読まない）
 * @returns 成立なら `{ ok: true }`、拒否なら `{ ok: false, reason }`
 */
export function checkRedemption(inviteCode, account, now) {
  if (!inviteCode) return { ok: false, reason: 'NOT_FOUND' };
  if (inviteCode.status === 'revoked') return { ok: false, reason: 'REVOKED' };
  if (inviteCode.expiresAt !== null && now > inviteCode.expiresAt) {
    return { ok: false, reason: 'EXPIRED' };
  }
  if (inviteCode.useCount >= inviteCode.maxUses) return { ok: false, reason: 'EXHAUSTED' };
  if (inviteCode.issuedBy !== null && inviteCode.issuedBy === account.id) {
    return { ok: false, reason: 'SELF_REDEEM' };
  }
  if (account.hasRedeemedInvite) return { ok: false, reason: 'ALREADY_INVITED' };
  return { ok: true };
}

/**
 * 消費が成立した後の状態を計算する（判定はしない。呼び出し側が
 * `checkRedemption` を先に通してから呼ぶこと。サーバーは行ロック内で
 * 「読む→ここで計算→書く」を1トランザクションにする）。
 *
 * `grantReferralCodes` はtrueのときだけ、成立に加えてreferralコード2枠ぶんの
 * 種（`issuedBy`だけを持つ雛形）を返す。呼び出し側は、消費したアカウントが
 * 外部ID連携済み（設計8.6.4）のときだけtrueを渡す。ゲストのままでは常にfalse。
 */
export function applyRedemption(inviteCode, account, now, { grantReferralCodes } = {}) {
  const redemption = {
    inviteCodeId: inviteCode.id,
    redeemedBy: account.id,
    redeemedAt: now,
  };
  const updatedCode = { ...inviteCode, useCount: inviteCode.useCount + 1 };
  const referralSeeds = grantReferralCodes
    ? [
        { source: 'referral', issuedBy: account.id, maxUses: 1 },
        { source: 'referral', issuedBy: account.id, maxUses: 1 },
      ]
    : [];
  return { updatedCode, redemption, referralSeeds };
}

/**
 * `admin_batch`のwave発行が計画人数を超えないか調べる（設計8.6.3）。
 * `wave.plannedCount`が上限。既発行数 + 今回発行したい数が上限を超えたら拒否する。
 */
export function checkBatchIssuance(wave, alreadyIssuedCount, requestedCount) {
  if (requestedCount <= 0) {
    return { ok: false, reason: 'INVALID_COUNT' };
  }
  const total = alreadyIssuedCount + requestedCount;
  if (total > wave.plannedCount) {
    return {
      ok: false,
      reason: 'WAVE_CAP_EXCEEDED',
      remaining: Math.max(0, wave.plannedCount - alreadyIssuedCount),
    };
  }
  return { ok: true };
}

/**
 * `admin_batch`コードの雛形を`requestedCount`個作る（実際のcode文字列はサーバーが
 * `generateCode`＋一意性検査で払い出す。ここではwave/期限/上限だけを固定する）。
 */
export function planBatchIssuance(wave, requestedCount, expiresAt) {
  return Array.from({ length: requestedCount }, () => ({
    source: 'admin_batch',
    wave: wave.wave,
    issuedBy: null,
    maxUses: 1,
    status: 'active',
    expiresAt,
  }));
}

import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_NAME = '20260801160640_secure_sessions.sql';
const MIGRATION_PATH = join(ROOT, 'server', 'migrations', MIGRATION_NAME);
const DB_TEST_PATH = join(ROOT, 'server', 'test', 'db', 'secure_sessions.test.sql');

async function normalizedMigration() {
  return (await readFile(MIGRATION_PATH, 'utf8')).replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('OLG-113 secure session migration', () => {
  it('Supabase CLIとserverが同じmigration正本を見る', async () => {
    const serverMigration = await realpath(MIGRATION_PATH);
    const supabaseMigration = await realpath(join(ROOT, 'supabase', 'migrations', MIGRATION_NAME));

    assert.equal(supabaseMigration, serverMigration);
  });

  it('bootstrap/session/credentialを分離しraw token列を持たない', async () => {
    const sql = await normalizedMigration();

    assert.match(sql, /create table public\.guest_bootstrap_attempt/);
    assert.match(sql, /bootstrap_digest bytea not null unique/);
    assert.match(sql, /create table public\.app_session \(/);
    assert.match(sql, /auth_grant_ciphertext bytea not null/);
    assert.match(sql, /auth_grant_nonce bytea not null/);
    assert.match(sql, /create table public\.app_session_credential/);
    assert.match(sql, /token_digest bytea not null unique/);
    assert.match(sql, /where credential_state = 'current'/);
    assert.match(sql, /auth_grant_format_version smallint not null default 1/);
    assert.match(sql, /auth_grant_revision bigint not null default 1/);
    assert.match(sql, /unique \(auth_grant_key_version, auth_grant_nonce\)/);
    assert.doesNotMatch(sql, /(?:bootstrap|session|claim|refresh|access)_token\s+(?:text|varchar|bytea)/);
  });

  it('Data APIの全roleからtable DMLを外し限定RPCだけをservice_roleへ許可する', async () => {
    const sql = await normalizedMigration();

    for (const table of ['guest_bootstrap_attempt', 'app_session', 'app_session_credential']) {
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
      assert.match(
        sql,
        new RegExp(
          `revoke all on table public\\.${table} from public, anon, authenticated, service_role`,
        ),
      );
    }
    assert.doesNotMatch(sql, /create policy/);
    assert.doesNotMatch(sql, /grant (?:select|insert|update|delete)[^;]* to service_role/);
    assert.doesNotMatch(sql, /grant [^;]* to (?:anon|authenticated)/);

    for (const rpc of [
      'create_guest_bootstrap_attempt',
      'claim_guest_bootstrap_attempt',
      'claim_guest_bootstrap_attempt_candidates',
      'release_guest_bootstrap_claim',
      'reset_guest_bootstrap_after_auth_delete',
      'complete_guest_app_session',
      'resolve_app_session',
      'resolve_app_session_candidates',
      'validate_app_session_version',
      'revoke_app_session',
    ]) {
      assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\(`));
      const functionStart = sql.indexOf(`create or replace function public.${rpc}(`);
      const functionEnd = sql.indexOf('$$;', functionStart);
      const definition = sql.slice(functionStart, functionEnd);
      assert.match(definition, /security definer/);
      assert.match(definition, /set search_path = ''/);
      assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}\\(`));
    }
  });

  it('claim世代をAuth metadata triggerで検査し古いsignupをrollbackする', async () => {
    const sql = await normalizedMigration();

    assert.match(sql, /claim_id uuid/);
    assert.match(sql, /claim_generation bigint not null default 0/);
    assert.match(sql, /attempt_state text not null default 'ready'/);
    assert.match(sql, /claim_lease_until timestamptz/);
    assert.match(sql, /guest_bootstrap_attempt_id/);
    assert.match(sql, /guest_bootstrap_claim_id/);
    assert.match(sql, /v_attempt\.claim_id is distinct from v_claim_id/);
    assert.match(sql, /v_attempt\.claim_lease_until <= v_now/);
    assert.match(sql, /v_now := clock_timestamp\(\)/);
    assert.match(sql, /message = 'guest_bootstrap_claim_rejected'/);
    assert.match(
      sql,
      /create trigger on_auth_user_created_link_guest_bootstrap after insert on auth\.users/,
    );
    assert.ok(
      'on_auth_user_created_create_game_account' < 'on_auth_user_created_link_guest_bootstrap',
      'account trigger name sorts before the bootstrap FK trigger',
    );
  });

  it('session期限・失効version・credential stateをDB時刻で判定する', async () => {
    const sql = await normalizedMigration();

    assert.match(sql, /idle_expires_at timestamptz not null default \(statement_timestamp\(\) \+ interval '90 days'\)/);
    assert.match(sql, /absolute_expires_at timestamptz not null default \(statement_timestamp\(\) \+ interval '365 days'\)/);
    assert.match(sql, /session_version = session_version \+ 1/);
    assert.doesNotMatch(sql, /credential_state = 'grace'/);
    assert.match(sql, /credential_state = 'revoked'/);
    assert.match(sql, /last_seen_at <= v_now - interval '5 minutes'/);
    assert.match(sql, /v_attempt\.attempt_state not in \('auth_linked', 'cleanup_pending'\)/);
    assert.match(sql, /p_token_digest_key_version <> v_attempt\.session_derivation_key_version/);
    assert.match(sql, /return jsonb_build_object\('state', 'ambiguous'\)/);
    assert.doesNotMatch(sql, /\{34,65536\}/);
    assert.match(sql, /length\(p_auth_grant_ciphertext_hex\) not between 34 and 65536/);
    assert.match(sql, /not exists \(select 1 from public\.account where account_id = p_account_id\)/);
  });

  it('実stack受入でschema/ACL/claim/期限/失効/cascadeを検査する', async () => {
    const sql = (await readFile(DB_TEST_PATH, 'utf8')).replace(/\s+/g, ' ').toLowerCase();

    assert.match(sql, /select plan\(92\)/);
    assert.match(sql, /table_privs_are/);
    assert.match(sql, /function_privs_are/);
    assert.match(sql, /guest_bootstrap_claim_rejected/);
    assert.match(sql, /resolve_app_session/);
    assert.match(sql, /revoke_app_session/);
    assert.match(sql, /delete from auth\.users/);
    assert.match(sql, /expired auth grant cannot create an app session/);
    assert.match(sql, /auth grant beyond the storage horizon cannot create an app session/);
    assert.match(sql, /expired unlinked claimed attempt is reclaimed by bounded cleanup/);
    assert.match(sql, /claim returns the derivation key version chosen when bootstrap was created/);
    assert.match(sql, /bootstrap multi-hit mutates neither matching attempt/);
    assert.match(sql, /session multi-hit does not refresh either activity timestamp/);
    assert.match(sql, /auth_linked attempt enters compensation even inside the completion margin/);
    assert.match(sql, /retry after a lost auth_linked response is offered recovery instead of a fresh claim/);
    assert.match(sql, /cleanup-after-delete refuses to run while the auth user the recovery is meant to save still exists/);
    assert.match(sql, /recovered cleanup_pending claim completes the app session the lost response was supposed to deliver/);
    assert.match(sql, /recovered attempt reaches completed instead of being permanently stuck in cleanup_pending/);
    assert.match(sql, /cleanup-after-delete succeeds once the auth user and its cascaded account are both confirmed gone/);
    assert.match(sql, /compensated attempt returns to ready with every auth_linked trace cleared/);
    assert.match(sql, /the same bootstrap cookie can drive a brand new signup after compensation completes/);
    assert.match(sql, /a cleanup_pending claim racing a concurrent account hard-delete fails closed instead of raising an fk violation/);
    assert.match(sql, /the raced completion leaves no partially-created app_session row behind/);
  });
});

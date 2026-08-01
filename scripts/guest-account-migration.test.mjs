import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_NAME = '20260801053807_guest_accounts.sql';
const MIGRATION_PATH = join(ROOT, 'server', 'migrations', MIGRATION_NAME);
const DB_TEST_PATH = join(ROOT, 'server', 'test', 'db', 'guest_accounts.test.sql');

async function normalizedMigration() {
  return (await readFile(MIGRATION_PATH, 'utf8')).replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('OLG-111 guest account migration', () => {
  it('local Authは匿名sign-inだけを先に有効化し、manual linkは後続へ残す', async () => {
    const config = await readFile(join(ROOT, 'supabase', 'config.toml'), 'utf8');

    assert.match(config, /^enable_anonymous_sign_ins = true$/m);
    assert.match(config, /^enable_manual_linking = false$/m);
  });

  it('Supabase CLIとserverが同じmigration正本を見る', async () => {
    const serverMigration = await realpath(MIGRATION_PATH);
    const supabaseMigration = await realpath(join(ROOT, 'supabase', 'migrations', MIGRATION_NAME));

    assert.equal(supabaseMigration, serverMigration);
  });

  it('auth userと同一UUIDのaccount行を同じtransactionのtriggerで作る', async () => {
    const sql = await normalizedMigration();

    assert.match(
      sql,
      /account_id uuid primary key references auth\.users \(id\) on delete cascade/,
    );
    assert.match(sql, /created_at timestamptz not null default now\(\)/);
    assert.match(sql, /insert into public\.account \(account_id\) values \(new\.id\)/);
    assert.doesNotMatch(sql, /new\.(?!id\b)[a-z_]+/);
    assert.match(sql, /security definer set search_path = ''/);
    assert.match(
      sql,
      /after insert on auth\.users for each row execute function public\.handle_new_auth_user_account\(\)/,
    );
    assert.doesNotMatch(sql, /on conflict/);

    const lockIndex = sql.indexOf('lock table auth.users in share row exclusive mode');
    const backfillIndex = sql.indexOf(
      'insert into public.account (account_id) select auth_user.id from auth.users as auth_user',
    );
    const triggerIndex = sql.indexOf('create trigger on_auth_user_created_create_game_account');
    assert.ok(lockIndex >= 0, 'existing auth users are locked before backfill');
    assert.ok(lockIndex < backfillIndex, 'backfill runs after the auth.users lock');
    assert.ok(backfillIndex < triggerIndex, 'trigger is installed without a concurrent insert gap');
  });

  it('Data APIからaccount rootを直接read/writeできない', async () => {
    const sql = await normalizedMigration();

    assert.match(sql, /alter table public\.account enable row level security/);
    assert.match(
      sql,
      /revoke all on table public\.account from public, anon, authenticated, service_role/,
    );
    assert.match(sql, /grant select on table public\.account to service_role/);
    assert.match(
      sql,
      /revoke all on function public\.handle_new_auth_user_account\(\) from public, anon, authenticated, service_role/,
    );
    assert.doesNotMatch(sql, /create policy/);
    assert.doesNotMatch(sql, /grant [^;]* to (?:anon|authenticated)/);
    assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]* to service_role/);
  });

  it('実stack受入で原子性・権限・削除cascadeまで検査する', async () => {
    const sql = (await readFile(DB_TEST_PATH, 'utf8')).replace(/\s+/g, ' ').toLowerCase();

    assert.match(sql, /select plan\(27\)/);
    assert.match(sql, /table_privs_are/);
    assert.match(sql, /trigger_is/);
    assert.match(sql, /delete from auth\.users/);
    assert.match(sql, /account trigger failure rejects auth user insert/);
    assert.match(sql, /failed account creation leaves neither auth user nor account/);
  });
});

import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_NAME = '20260803001000_guest_activity_retention.sql';
const MIGRATION_PATH = join(ROOT, 'server', 'migrations', MIGRATION_NAME);

async function sql() {
  return (await readFile(MIGRATION_PATH, 'utf8')).replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('OLG-116 guest activity migration', () => {
  it('Supabaseとserverが同じmigrationを参照する', async () => {
    assert.equal(
      await realpath(join(ROOT, 'supabase', 'migrations', MIGRATION_NAME)),
      await realpath(MIGRATION_PATH),
    );
  });

  it('活動時刻・匿名flag・保持indexを追加する', async () => {
    const value = await sql();
    assert.match(value, /alter table public\.account add column if not exists is_anonymous boolean not null default true/);
    assert.match(value, /add column if not exists last_active_at timestamptz not null default statement_timestamp\(\)/);
    assert.match(value, /create index if not exists account_guest_retention_idx on public\.account \(is_anonymous, last_active_at, account_id\)/);
  });

  it('活動更新RPCをservice_roleだけに公開し、search_pathを固定する', async () => {
    const value = await sql();
    const start = value.indexOf('create or replace function public.touch_account_last_active(');
    const end = value.indexOf('$$;', start);
    assert.ok(start >= 0 && end > start);
    const definition = value.slice(start, end);
    assert.match(definition, /security definer/);
    assert.match(definition, /set search_path = ''/);
    assert.match(value, /revoke all on function public\.touch_account_last_active\(uuid\) from public, anon, authenticated/);
    assert.match(value, /grant execute on function public\.touch_account_last_active\(uuid\) to service_role/);
  });
});

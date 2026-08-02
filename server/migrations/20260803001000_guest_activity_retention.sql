-- OLG-116: 休眠ゲストの判定に使うサーバー管理の活動時刻。
-- account_idは認証情報ではなく、更新はWorkerの限定RPCだけに閉じる。
alter table public.account
  add column if not exists is_anonymous boolean not null default true,
  add column if not exists last_active_at timestamptz not null default statement_timestamp();

comment on column public.account.is_anonymous is
  'Server-maintained protection flag. External identity linking must set this false in a later transaction.';
comment on column public.account.last_active_at is
  'Last activity observed by the authoritative Worker. Used for the 90-day guest retention window.';

create index if not exists account_guest_retention_idx
  on public.account (is_anonymous, last_active_at, account_id);

create or replace function public.touch_account_last_active(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account
     set last_active_at = statement_timestamp()
   where account_id = p_account_id;
  return found;
end;
$$;

revoke all on function public.touch_account_last_active(uuid)
  from public, anon, authenticated;
grant execute on function public.touch_account_last_active(uuid) to service_role;

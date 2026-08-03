-- OLG-116: 休眠ゲストの判定に使うサーバー管理の活動時刻。
-- account_idは認証情報ではなく、更新はWorkerの限定RPCだけに閉じる。
alter table public.account
  add column if not exists is_anonymous boolean not null default true,
  add column if not exists retention_protected boolean not null default false,
  add column if not exists last_active_at timestamptz not null default statement_timestamp();

comment on column public.account.is_anonymous is
  'Server-maintained protection flag. External identity linking must set this false in a later transaction.';
comment on column public.account.last_active_at is
  'Last activity observed by the authoritative Worker. Used for the 365-day guest retention window.';
comment on column public.account.retention_protected is
  'True for purchased/owned value, starter recipients, linked identities, or any account that must survive cleanup.';

create index if not exists account_guest_retention_idx
  on public.account (is_anonymous, retention_protected, last_active_at, account_id);

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

create or replace function public.delete_guest_if_eligible(
  p_account_id uuid,
  p_cutoff timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.account%rowtype;
begin
  -- accountを先にロックし、活動更新と削除候補の再検査を同じtransactionに閉じる。
  select * into v_account
    from public.account
   where account_id = p_account_id
   for update;
  if not found or not v_account.is_anonymous or v_account.retention_protected or v_account.last_active_at > p_cutoff then
    return false;
  end if;
  if exists (
    select 1 from public.app_session
     where account_id = p_account_id
       and revoked_at is null
       and idle_expires_at > statement_timestamp()
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.guest_bootstrap_attempt
     where account_id = p_account_id
       and attempt_state <> 'COMPLETED'
  ) then
    return false;
  end if;
  delete from auth.users where id = p_account_id;
  return found;
end;
$$;

revoke all on function public.delete_guest_if_eligible(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.delete_guest_if_eligible(uuid, timestamptz) to service_role;

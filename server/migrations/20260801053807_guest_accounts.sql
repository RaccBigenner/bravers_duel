-- OLG-111: Supabase Auth userとゲーム内accountを同じUUIDで1対1にする。
-- auth.usersへのINSERTとこの行の作成は同じtransactionで、trigger失敗時はsignupも失敗する。
create table public.account (
  account_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.account is
  'Game account root. account_id stays stable when an anonymous Auth user links an external identity.';

alter table public.account enable row level security;

-- ゲームデータは必ずWorker APIを通す。匿名Auth userもPostgres上はauthenticated roleになるため、
-- policyを置かず、Data APIからの直接read/write権限も明示的に外す。
revoke all on table public.account from public, anon, authenticated, service_role;
grant select on table public.account to service_role;

create function public.handle_new_auth_user_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account (account_id)
  values (new.id);
  return new;
end;
$$;

-- public schemaの関数はData APIのRPC候補になり得るため、trigger以外から呼ばせない。
revoke all on function public.handle_new_auth_user_account()
  from public, anon, authenticated, service_role;

-- 既存のdev/staging userも1:1不変条件へ揃える。lock取得前に進行中だったINSERTのcommitを待ち、
-- backfillとtrigger作成の隙間へ新しいAuth userが入らないようmigration transaction内で直列化する。
lock table auth.users in share row exclusive mode;

insert into public.account (account_id)
select auth_user.id
from auth.users as auth_user;

create trigger on_auth_user_created_create_game_account
  after insert on auth.users
  for each row execute function public.handle_new_auth_user_account();

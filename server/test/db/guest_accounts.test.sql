begin;

-- Supabase CLI 2.111.0がpgTAPをextensions schemaへ用意してから実行する。
set local search_path = extensions, public;
select plan(27);

select has_table('public', 'account', 'account root exists');
select columns_are(
  'public',
  'account',
  array['account_id', 'created_at']::name[],
  'account columns stay minimal'
);
select col_type_is('public', 'account', 'account_id', 'uuid', 'account_id is uuid');
select col_is_pk('public', 'account', 'account_id', 'account_id is the sole primary key');
select fk_ok(
  'public',
  'account',
  'account_id',
  'auth',
  'users',
  'id',
  'account_id references auth.users.id'
);
select is(
  (
    select array_agg(constraint_definition.confdeltype::text order by constraint_definition.conname)
    from pg_constraint as constraint_definition
    where constraint_definition.contype = 'f'
      and constraint_definition.conrelid = 'public.account'::regclass
      and constraint_definition.confrelid = 'auth.users'::regclass
  ),
  array['c']::text[],
  'the sole auth.users FK uses ON DELETE CASCADE'
);
select col_type_is(
  'public',
  'account',
  'created_at',
  'timestamp with time zone',
  'created_at is timestamptz'
);
select col_not_null('public', 'account', 'created_at', 'created_at is required');
select col_default_is(
  'public',
  'account',
  'created_at',
  'now()',
  'created_at defaults to now()'
);

select ok(
  (select source_table.relrowsecurity from pg_class as source_table where source_table.oid = 'public.account'::regclass),
  'RLS is enabled'
);
select policies_are(
  'public',
  'account',
  array[]::name[],
  'account has no client-facing RLS policy'
);
select table_privs_are(
  'public',
  'account',
  'anon',
  array[]::name[],
  'anon has no table privilege'
);
select table_privs_are(
  'public',
  'account',
  'authenticated',
  array[]::name[],
  'authenticated has no table privilege'
);
select table_privs_are(
  'public',
  'account',
  'service_role',
  array['SELECT']::name[],
  'service_role can only SELECT'
);

select function_returns(
  'public',
  'handle_new_auth_user_account',
  array[]::name[],
  'trigger',
  'handler returns trigger'
);
select is_definer(
  'public',
  'handle_new_auth_user_account',
  array[]::name[],
  'handler is SECURITY DEFINER'
);
select ok(
  coalesce(
    (
      select exists (
        select 1
        from unnest(coalesce(function_definition.proconfig, array[]::text[])) as setting(value)
        where split_part(setting.value, '=', 1) = 'search_path'
          and btrim(split_part(setting.value, '=', 2), '" ') = ''
      )
      from pg_proc as function_definition
      join pg_namespace as function_schema
        on function_schema.oid = function_definition.pronamespace
      where function_schema.nspname = 'public'
        and function_definition.proname = 'handle_new_auth_user_account'
        and function_definition.pronargs = 0
    ),
    false
  ),
  'handler search_path is empty'
);
select function_privs_are(
  'public',
  'handle_new_auth_user_account',
  array[]::name[],
  'anon',
  array[]::name[],
  'anon cannot execute handler'
);
select function_privs_are(
  'public',
  'handle_new_auth_user_account',
  array[]::name[],
  'authenticated',
  array[]::name[],
  'authenticated cannot execute handler'
);
select function_privs_are(
  'public',
  'handle_new_auth_user_account',
  array[]::name[],
  'service_role',
  array[]::name[],
  'service_role cannot execute handler directly'
);

select has_trigger(
  'auth',
  'users',
  'on_auth_user_created_create_game_account',
  'auth trigger exists'
);
select trigger_is(
  'auth',
  'users',
  'on_auth_user_created_create_game_account',
  'public',
  'handle_new_auth_user_account',
  'auth trigger calls handler'
);
select ok(
  coalesce(
    (
      select trigger_definition.tgtype = 5
        and trigger_definition.tgenabled = 'O'
        and not trigger_definition.tgisinternal
      from pg_trigger as trigger_definition
      where trigger_definition.tgrelid = 'auth.users'::regclass
        and trigger_definition.tgname = 'on_auth_user_created_create_game_account'
    ),
    false
  ),
  'trigger is enabled AFTER INSERT FOR EACH ROW only'
);

create temporary table olg111_guest_test_ids (
  scenario text primary key,
  id uuid not null unique,
  attempt_id uuid,
  claim_id uuid
) on commit drop;
insert into olg111_guest_test_ids values
  ('normal', gen_random_uuid(), null, null),
  ('rollback', gen_random_uuid(), null, null);

update olg111_guest_test_ids
set attempt_id = (
  public.create_guest_bootstrap_attempt(
    case scenario when 'normal' then repeat('11', 32) else repeat('22', 32) end,
    1::smallint,
    1::smallint
  ) ->> 'attempt_id'
)::uuid;
update olg111_guest_test_ids
set claim_id = (
  public.claim_guest_bootstrap_attempt(
    case scenario when 'normal' then repeat('11', 32) else repeat('22', 32) end,
    1::smallint
  ) ->> 'claim_id'
)::uuid;

insert into auth.users (id, is_anonymous, raw_user_meta_data)
select id, true, jsonb_build_object(
  'guest_bootstrap_attempt_id', attempt_id,
  'guest_bootstrap_claim_id', claim_id
)
from olg111_guest_test_ids
where scenario = 'normal';
select results_eq(
  $$
    select game_account.account_id
    from public.account as game_account
    join pg_temp.olg111_guest_test_ids as test_id
      on test_id.id = game_account.account_id
    where test_id.scenario = 'normal'
  $$,
  $$
    select id
    from pg_temp.olg111_guest_test_ids
    where scenario = 'normal'
  $$,
  'anonymous auth insert creates the same account_id'
);

delete from auth.users as auth_user
using pg_temp.olg111_guest_test_ids as test_id
where test_id.scenario = 'normal'
  and auth_user.id = test_id.id;
select is_empty(
  $$
    select game_account.account_id
    from public.account as game_account
    join pg_temp.olg111_guest_test_ids as test_id
      on test_id.id = game_account.account_id
    where test_id.scenario = 'normal'
  $$,
  'deleting auth user cascades to account'
);

create function public.zzz_olg111_test_reject_account_insert()
returns trigger
language plpgsql
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'OLG111_TEST_ACCOUNT_INSERT_REJECTED';
end;
$function$;
create trigger zzz_olg111_test_reject_account_insert
  before insert on public.account
  for each row execute function public.zzz_olg111_test_reject_account_insert();

select throws_ok(
  format(
    'insert into auth.users (id, is_anonymous, raw_user_meta_data) values (%L::uuid, true, jsonb_build_object(''guest_bootstrap_attempt_id'', %L::uuid, ''guest_bootstrap_claim_id'', %L::uuid))',
    (
      select id::text
      from pg_temp.olg111_guest_test_ids
      where scenario = 'rollback'
    ),
    (
      select attempt_id::text
      from pg_temp.olg111_guest_test_ids
      where scenario = 'rollback'
    ),
    (
      select claim_id::text
      from pg_temp.olg111_guest_test_ids
      where scenario = 'rollback'
    )
  ),
  'P0001',
  'OLG111_TEST_ACCOUNT_INSERT_REJECTED',
  'account trigger failure rejects auth user insert'
);
select is_empty(
  $$
    select auth_user.id
    from auth.users as auth_user
    join pg_temp.olg111_guest_test_ids as test_id
      on test_id.id = auth_user.id
    where test_id.scenario = 'rollback'
    union all
    select game_account.account_id
    from public.account as game_account
    join pg_temp.olg111_guest_test_ids as test_id
      on test_id.id = game_account.account_id
    where test_id.scenario = 'rollback'
  $$,
  'failed account creation leaves neither auth user nor account'
);

select * from finish();
rollback;

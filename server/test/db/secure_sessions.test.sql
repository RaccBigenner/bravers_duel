begin;

set local search_path = extensions, public;
select plan(82);

-- schema / FK / RLS / ACL (1-27)
select has_table('public', 'guest_bootstrap_attempt', 'bootstrap attempt table exists');
select has_table('public', 'app_session', 'app session table exists');
select has_table('public', 'app_session_credential', 'session credential table exists');
select col_type_is('public', 'guest_bootstrap_attempt', 'bootstrap_digest', 'bytea', 'bootstrap stores digest bytes');
select col_type_is('public', 'app_session', 'auth_grant_ciphertext', 'bytea', 'grant ciphertext is bytea');
select col_type_is('public', 'app_session', 'auth_grant_nonce', 'bytea', 'grant nonce is bytea');
select col_type_is('public', 'app_session_credential', 'token_digest', 'bytea', 'session token stores digest bytes');
select col_is_pk('public', 'guest_bootstrap_attempt', 'attempt_id', 'attempt id is primary key');
select col_is_pk('public', 'app_session', 'session_id', 'session id is primary key');
select col_is_pk('public', 'app_session_credential', 'credential_id', 'credential id is primary key');
select fk_ok('public', 'app_session', 'account_id', 'public', 'account', 'account_id', 'session belongs to account');
select fk_ok('public', 'app_session_credential', 'session_id', 'public', 'app_session', 'session_id', 'credential belongs to session');
select ok((select relrowsecurity from pg_class where oid = 'public.guest_bootstrap_attempt'::regclass), 'bootstrap RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.app_session'::regclass), 'session RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.app_session_credential'::regclass), 'credential RLS enabled');
select policies_are('public', 'guest_bootstrap_attempt', array[]::name[], 'bootstrap has no Data API policy');
select policies_are('public', 'app_session', array[]::name[], 'session has no Data API policy');
select policies_are('public', 'app_session_credential', array[]::name[], 'credential has no Data API policy');
select table_privs_are('public', 'guest_bootstrap_attempt', 'anon', array[]::name[], 'anon cannot access bootstrap');
select table_privs_are('public', 'guest_bootstrap_attempt', 'authenticated', array[]::name[], 'authenticated cannot access bootstrap');
select table_privs_are('public', 'guest_bootstrap_attempt', 'service_role', array[]::name[], 'service role cannot access bootstrap directly');
select table_privs_are('public', 'app_session', 'anon', array[]::name[], 'anon cannot access session');
select table_privs_are('public', 'app_session', 'authenticated', array[]::name[], 'authenticated cannot access session');
select table_privs_are('public', 'app_session', 'service_role', array[]::name[], 'service role cannot access session directly');
select table_privs_are('public', 'app_session_credential', 'anon', array[]::name[], 'anon cannot access credential');
select table_privs_are('public', 'app_session_credential', 'authenticated', array[]::name[], 'authenticated cannot access credential');
select table_privs_are('public', 'app_session_credential', 'service_role', array[]::name[], 'service role cannot access credential directly');

-- trigger / function boundary (28-42)
select has_trigger('auth', 'users', 'on_auth_user_created_link_guest_bootstrap', 'bootstrap Auth trigger exists');
select trigger_is('auth', 'users', 'on_auth_user_created_link_guest_bootstrap', 'public', 'link_guest_bootstrap_from_auth_user', 'bootstrap trigger calls handler');
select function_returns('public', 'link_guest_bootstrap_from_auth_user', array[]::name[], 'trigger', 'bootstrap handler returns trigger');
select is_definer('public', 'link_guest_bootstrap_from_auth_user', array[]::name[], 'bootstrap handler is SECURITY DEFINER');
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
      join pg_namespace as function_schema on function_schema.oid = function_definition.pronamespace
      where function_schema.nspname = 'public'
        and function_definition.proname = 'link_guest_bootstrap_from_auth_user'
        and function_definition.pronargs = 0
    ),
    false
  ),
  'bootstrap handler search_path is empty'
);
select function_privs_are('public', 'link_guest_bootstrap_from_auth_user', array[]::name[], 'anon', array[]::name[], 'anon cannot call trigger handler');
select function_privs_are('public', 'link_guest_bootstrap_from_auth_user', array[]::name[], 'service_role', array[]::name[], 'service role cannot call trigger handler');
select function_privs_are('public', 'create_guest_bootstrap_attempt', array['text', 'smallint', 'smallint']::name[], 'service_role', array['EXECUTE']::name[], 'service role can create bootstrap through RPC');
select function_privs_are('public', 'create_guest_bootstrap_attempt', array['text', 'smallint', 'smallint']::name[], 'anon', array[]::name[], 'anon cannot create bootstrap through Data API');
select function_privs_are('public', 'resolve_app_session', array['text', 'smallint']::name[], 'service_role', array['EXECUTE']::name[], 'service role can resolve session through RPC');
select function_privs_are('public', 'resolve_app_session', array['text', 'smallint']::name[], 'authenticated', array[]::name[], 'authenticated cannot resolve session through Data API');
select function_privs_are('public', 'claim_guest_bootstrap_attempt_candidates', array['jsonb']::name[], 'service_role', array['EXECUTE']::name[], 'service role can atomically claim bootstrap candidates');
select function_privs_are('public', 'claim_guest_bootstrap_attempt_candidates', array['jsonb']::name[], 'anon', array[]::name[], 'anon cannot claim bootstrap candidates');
select function_privs_are('public', 'resolve_app_session_candidates', array['jsonb']::name[], 'service_role', array['EXECUTE']::name[], 'service role can atomically resolve session candidates');
select function_privs_are('public', 'resolve_app_session_candidates', array['jsonb']::name[], 'authenticated', array[]::name[], 'authenticated cannot resolve session candidates');

create temporary table olg113_session_case (
  case_name text primary key,
  bootstrap_digest_hex text not null,
  account_id uuid not null,
  session_id uuid not null,
  attempt_id uuid,
  first_claim_id uuid,
  second_claim_id uuid,
  create_result jsonb,
  first_claim_result jsonb,
  second_claim_result jsonb,
  complete_result jsonb
) on commit drop;

insert into olg113_session_case (case_name, bootstrap_digest_hex, account_id, session_id)
values
  ('complete', repeat('31', 32), gen_random_uuid(), gen_random_uuid()),
  ('stale', repeat('42', 32), gen_random_uuid(), gen_random_uuid());

update olg113_session_case
set create_result = public.create_guest_bootstrap_attempt(
      bootstrap_digest_hex,
      1::smallint,
      1::smallint
    )
where case_name = 'complete';
update olg113_session_case
set attempt_id = (create_result ->> 'attempt_id')::uuid
where case_name = 'complete';

-- happy path / input boundary / idempotency / expiry / revoke / cleanup (43-65)
select is((select create_result ->> 'state' from olg113_session_case where case_name = 'complete'), 'created', 'bootstrap creation succeeds');

update olg113_session_case
set first_claim_result = public.claim_guest_bootstrap_attempt(bootstrap_digest_hex, 1::smallint)
where case_name = 'complete';
update olg113_session_case
set first_claim_id = (first_claim_result ->> 'claim_id')::uuid
where case_name = 'complete';
select is((select first_claim_result ->> 'state' from olg113_session_case where case_name = 'complete'), 'create_auth', 'first claim owns Auth creation');
select is(
  (select (first_claim_result ->> 'session_derivation_key_version')::integer from olg113_session_case where case_name = 'complete'),
  1,
  'claim returns the derivation key version chosen when bootstrap was created'
);

update olg113_session_case
set second_claim_result = public.claim_guest_bootstrap_attempt(bootstrap_digest_hex, 1::smallint)
where case_name = 'complete';
select is((select second_claim_result ->> 'state' from olg113_session_case where case_name = 'complete'), 'pending', 'duplicate claim is pending while lease is active');

insert into auth.users (id, is_anonymous, raw_user_meta_data)
select account_id, true, jsonb_build_object(
  'guest_bootstrap_attempt_id', attempt_id,
  'guest_bootstrap_claim_id', first_claim_id
)
from olg113_session_case
where case_name = 'complete';
select ok(
  exists (
    select 1
    from public.guest_bootstrap_attempt as attempt
    join olg113_session_case as fixture on fixture.attempt_id = attempt.attempt_id
    where fixture.case_name = 'complete'
      and attempt.attempt_state = 'AUTH_LINKED'
      and attempt.account_id = fixture.account_id
      and attempt.auth_linked_at is not null
  ),
  'matching Auth metadata links the same account to the claim'
);
select is(
  (
    select raw_user_meta_data
    from auth.users as auth_user
    join olg113_session_case as fixture on fixture.account_id = auth_user.id
    where fixture.case_name = 'complete'
  ),
  '{}'::jsonb,
  'internal attempt and claim IDs are scrubbed from Auth metadata'
);

select throws_ok(
  format(
    'select public.complete_guest_app_session(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L, 1::smallint, %L, %L, 7::smallint, %s::bigint)',
    (select attempt_id::text from olg113_session_case where case_name = 'complete'),
    (select first_claim_id::text from olg113_session_case where case_name = 'complete'),
    (select account_id::text from olg113_session_case where case_name = 'complete'),
    (select session_id::text from olg113_session_case where case_name = 'complete'),
    repeat('55', 32),
    repeat('aa', 17),
    repeat('bb', 12),
    extract(epoch from clock_timestamp() - interval '1 second')::bigint
  ),
  '22023',
  'INVALID_SESSION_INPUT',
  'expired Auth grant cannot create an app session'
);
select throws_ok(
  format(
    'select public.complete_guest_app_session(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L, 1::smallint, %L, %L, 7::smallint, %s::bigint)',
    (select attempt_id::text from olg113_session_case where case_name = 'complete'),
    (select first_claim_id::text from olg113_session_case where case_name = 'complete'),
    (select account_id::text from olg113_session_case where case_name = 'complete'),
    (select session_id::text from olg113_session_case where case_name = 'complete'),
    repeat('55', 32),
    repeat('aa', 17),
    repeat('bb', 12),
    extract(epoch from clock_timestamp() + interval '7 days 1 minute')::bigint
  ),
  '22023',
  'INVALID_SESSION_INPUT',
  'Auth grant beyond the storage horizon cannot create an app session'
);

select is(
  public.complete_guest_app_session(
    (select attempt_id from olg113_session_case where case_name = 'complete'),
    (select first_claim_id from olg113_session_case where case_name = 'complete'),
    (select account_id from olg113_session_case where case_name = 'complete'),
    (select session_id from olg113_session_case where case_name = 'complete'),
    repeat('56', 32),
    2::smallint,
    repeat('ac', 17),
    repeat('bd', 12),
    7::smallint,
    extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  ) ->> 'state',
  'invalid',
  'session digest key version must match the bootstrap derivation key version'
);

update olg113_session_case
set complete_result = public.complete_guest_app_session(
  attempt_id,
  first_claim_id,
  account_id,
  session_id,
  repeat('55', 32),
  1::smallint,
  repeat('aa', 17),
  repeat('bb', 12),
  7::smallint,
  extract(epoch from clock_timestamp() + interval '1 hour')::bigint
)
where case_name = 'complete';
select is((select complete_result ->> 'state' from olg113_session_case where case_name = 'complete'), 'session_ready', 'matching claim completes app session atomically');
select ok(
  exists (
    select 1
    from public.app_session as session
    join olg113_session_case as fixture on fixture.session_id = session.session_id
    where fixture.case_name = 'complete'
      and session.account_id = fixture.account_id
      and session.auth_grant_format_version = 1
      and session.auth_grant_revision = 1
  ),
  'session stores immutable account and crypto format metadata'
);
select ok(
  exists (
    select 1
    from public.app_session_credential as credential
    join olg113_session_case as fixture on fixture.session_id = credential.session_id
    where fixture.case_name = 'complete'
      and credential.token_digest = decode(repeat('55', 32), 'hex')
      and credential.credential_state = 'CURRENT'
  ),
  'credential stores only the HMAC digest'
);
select ok(
  exists (
    select 1
    from public.app_session as session
    join olg113_session_case as fixture on fixture.session_id = session.session_id
    where fixture.case_name = 'complete'
      and session.auth_grant_ciphertext = decode(repeat('aa', 17), 'hex')
      and session.auth_grant_nonce = decode(repeat('bb', 12), 'hex')
  ),
  'grant ciphertext and nonce are server-only bytes'
);
select is(
  (public.resolve_app_session(repeat('55', 32), 1::smallint) ->> 'account_id')::uuid,
  (select account_id from olg113_session_case where case_name = 'complete'),
  'valid credential resolves the same account'
);
select ok(
  public.validate_app_session_version(
    (select session_id from olg113_session_case where case_name = 'complete'),
    1
  ),
  'active session version validates'
);

update public.app_session as session
set idle_expires_at = clock_timestamp(),
    absolute_expires_at = clock_timestamp() + interval '1 day'
from olg113_session_case as fixture
where fixture.case_name = 'complete' and fixture.session_id = session.session_id;
select is(public.resolve_app_session(repeat('55', 32), 1::smallint), null::jsonb, 'idle-expired session resolves as the same null failure');
update public.app_session as session
set idle_expires_at = clock_timestamp() + interval '90 days',
    absolute_expires_at = clock_timestamp() + interval '365 days'
from olg113_session_case as fixture
where fixture.case_name = 'complete' and fixture.session_id = session.session_id;
select is(
  (public.resolve_app_session(repeat('55', 32), 1::smallint) ->> 'account_id')::uuid,
  (select account_id from olg113_session_case where case_name = 'complete'),
  'restored active expiry resolves again'
);
select is(
  (public.revoke_app_session(repeat('55', 32), 1::smallint, 'LOGOUT') ->> 'already_revoked')::boolean,
  false,
  'first logout revokes session once'
);
select is(public.resolve_app_session(repeat('55', 32), 1::smallint), null::jsonb, 'revoked credential resolves as null');
select ok(
  not public.validate_app_session_version(
    (select session_id from olg113_session_case where case_name = 'complete'),
    1
  ),
  'old session version fails after revoke'
);
select is(
  (public.revoke_app_session(repeat('55', 32), 1::smallint, 'LOGOUT') ->> 'already_revoked')::boolean,
  true,
  'duplicate logout is idempotently already revoked'
);

delete from auth.users as auth_user
using olg113_session_case as fixture
where fixture.case_name = 'complete' and auth_user.id = fixture.account_id;
select is_empty(
  $$
    select account.account_id
    from public.account as account
    join pg_temp.olg113_session_case as fixture on fixture.account_id = account.account_id
    where fixture.case_name = 'complete'
    union all
    select session.account_id
    from public.app_session as session
    join pg_temp.olg113_session_case as fixture on fixture.session_id = session.session_id
    where fixture.case_name = 'complete'
    union all
    select session.account_id
    from public.app_session_credential as credential
    join public.app_session as session on session.session_id = credential.session_id
    join pg_temp.olg113_session_case as fixture on fixture.session_id = credential.session_id
    where fixture.case_name = 'complete'
  $$,
  'Auth delete cascades account session and credential'
);

insert into olg113_session_case (case_name, bootstrap_digest_hex, account_id, session_id)
values ('expired-claimed', repeat('74', 32), gen_random_uuid(), gen_random_uuid());
update olg113_session_case
set create_result = public.create_guest_bootstrap_attempt(
      bootstrap_digest_hex,
      1::smallint,
      1::smallint
    )
where case_name = 'expired-claimed';
update olg113_session_case
set attempt_id = (create_result ->> 'attempt_id')::uuid,
    first_claim_result = public.claim_guest_bootstrap_attempt(bootstrap_digest_hex, 1::smallint)
where case_name = 'expired-claimed';
update public.guest_bootstrap_attempt as attempt
set created_at = clock_timestamp() - interval '20 minutes',
    expires_at = clock_timestamp() - interval '10 minutes'
from olg113_session_case as fixture
where fixture.case_name = 'expired-claimed' and fixture.attempt_id = attempt.attempt_id;
do $cleanup$
begin
  perform public.create_guest_bootstrap_attempt(repeat('75', 32), 1::smallint, 1::smallint);
end;
$cleanup$;
select is_empty(
  $$
    select attempt.attempt_id
    from public.guest_bootstrap_attempt as attempt
    join pg_temp.olg113_session_case as fixture on fixture.attempt_id = attempt.attempt_id
    where fixture.case_name = 'expired-claimed'
  $$,
  'expired unlinked CLAIMED attempt is reclaimed by bounded cleanup'
);

-- lease generation fence / mandatory binding (66-71)
update olg113_session_case
set create_result = public.create_guest_bootstrap_attempt(
      bootstrap_digest_hex,
      1::smallint,
      1::smallint
    )
where case_name = 'stale';
update olg113_session_case
set attempt_id = (create_result ->> 'attempt_id')::uuid,
    first_claim_result = public.claim_guest_bootstrap_attempt(bootstrap_digest_hex, 1::smallint)
where case_name = 'stale';
update olg113_session_case
set first_claim_id = (first_claim_result ->> 'claim_id')::uuid
where case_name = 'stale';
select is((select create_result ->> 'state' from olg113_session_case where case_name = 'stale'), 'created', 'stale-claim fixture bootstrap is created');

update public.guest_bootstrap_attempt as attempt
set claim_lease_until = clock_timestamp() - interval '1 second'
from olg113_session_case as fixture
where fixture.case_name = 'stale' and fixture.attempt_id = attempt.attempt_id;
update olg113_session_case
set second_claim_result = public.claim_guest_bootstrap_attempt(bootstrap_digest_hex, 1::smallint)
where case_name = 'stale';
update olg113_session_case
set second_claim_id = (second_claim_result ->> 'claim_id')::uuid
where case_name = 'stale';
select ok(
  (select first_claim_id <> second_claim_id from olg113_session_case where case_name = 'stale')
  and (
    select attempt.claim_generation = 2
    from public.guest_bootstrap_attempt as attempt
    join olg113_session_case as fixture on fixture.attempt_id = attempt.attempt_id
    where fixture.case_name = 'stale'
  ),
  'expired lease receives a new fenced claim generation'
);
select throws_ok(
  format(
    'insert into auth.users (id, is_anonymous, raw_user_meta_data) values (%L::uuid, true, jsonb_build_object(''guest_bootstrap_attempt_id'', %L::uuid, ''guest_bootstrap_claim_id'', %L::uuid))',
    (select account_id::text from olg113_session_case where case_name = 'stale'),
    (select attempt_id::text from olg113_session_case where case_name = 'stale'),
    (select first_claim_id::text from olg113_session_case where case_name = 'stale')
  ),
  '23514',
  'GUEST_BOOTSTRAP_CLAIM_REJECTED',
  'late Auth transaction with an old claim is rolled back'
);
select is_empty(
  $$
    select auth_user.id
    from auth.users as auth_user
    join pg_temp.olg113_session_case as fixture on fixture.account_id = auth_user.id
    where fixture.case_name = 'stale'
    union all
    select account.account_id
    from public.account as account
    join pg_temp.olg113_session_case as fixture on fixture.account_id = account.account_id
    where fixture.case_name = 'stale'
  $$,
  'stale claim leaves neither Auth user nor account'
);

insert into olg113_session_case (case_name, bootstrap_digest_hex, account_id, session_id)
values ('missing-metadata', repeat('63', 32), gen_random_uuid(), gen_random_uuid());
select throws_ok(
  format(
    'insert into auth.users (id, is_anonymous) values (%L::uuid, true)',
    (select account_id::text from olg113_session_case where case_name = 'missing-metadata')
  ),
  '23514',
  'INVALID_GUEST_BOOTSTRAP_METADATA',
  'anonymous signup cannot bypass bootstrap metadata'
);
select is_empty(
  $$
    select auth_user.id
    from auth.users as auth_user
    join pg_temp.olg113_session_case as fixture on fixture.account_id = auth_user.id
    where fixture.case_name = 'missing-metadata'
    union all
    select account.account_id
    from public.account as account
    join pg_temp.olg113_session_case as fixture on fixture.account_id = account.account_id
    where fixture.case_name = 'missing-metadata'
  $$,
  'metadata bypass rollback leaves neither Auth user nor account'
);

-- batch candidate input / ambiguity / near-expiry ordering (72-79)
select throws_ok(
  $$
    select public.claim_guest_bootstrap_attempt_candidates(
      jsonb_build_array(
        jsonb_build_object(
          'digest_hex', repeat('80', 32),
          'digest_key_version', 1000000000000000000000000000000000000000::numeric
        )
      )
    )
  $$,
  '22023',
  'INVALID_BOOTSTRAP_INPUT',
  'bootstrap candidate validates numeric shape before bounded cast'
);
select throws_ok(
  $$ select public.resolve_app_session_candidates('{"digest_hex":"not-an-array"}'::jsonb) $$,
  '22023',
  'INVALID_SESSION_INPUT',
  'session candidate rejects a non-array before expansion'
);

do $batch_bootstrap_setup$
begin
  perform public.create_guest_bootstrap_attempt(repeat('81', 32), 1::smallint, 1::smallint);
  perform public.create_guest_bootstrap_attempt(repeat('82', 32), 2::smallint, 2::smallint);
end;
$batch_bootstrap_setup$;
select is(
  public.claim_guest_bootstrap_attempt_candidates(
    jsonb_build_array(
      jsonb_build_object('digest_hex', repeat('81', 32), 'digest_key_version', 1),
      jsonb_build_object('digest_hex', repeat('82', 32), 'digest_key_version', 2)
    )
  ) ->> 'state',
  'ambiguous',
  'bootstrap multi-hit fails closed'
);
select is(
  (
    select count(*)::integer
    from public.guest_bootstrap_attempt
    where bootstrap_digest in (decode(repeat('81', 32), 'hex'), decode(repeat('82', 32), 'hex'))
      and attempt_state = 'READY'
      and claim_id is null
      and claim_generation = 0
  ),
  2,
  'bootstrap multi-hit mutates neither matching attempt'
);
select is(
  public.claim_guest_bootstrap_attempt_candidates(
    jsonb_build_array(
      jsonb_build_object('digest_hex', repeat('81', 32), 'digest_key_version', 1)
    )
  ) ->> 'state',
  'create_auth',
  'one bootstrap candidate claims exactly one attempt'
);

do $near_expiry_setup$
begin
  perform public.create_guest_bootstrap_attempt(repeat('83', 32), 1::smallint, 1::smallint);
  perform public.create_guest_bootstrap_attempt(repeat('84', 32), 1::smallint, 1::smallint);
  perform public.claim_guest_bootstrap_attempt(repeat('84', 32), 1::smallint);
end;
$near_expiry_setup$;
update public.guest_bootstrap_attempt
set expires_at = clock_timestamp() + interval '44 seconds'
where bootstrap_digest in (decode(repeat('83', 32), 'hex'), decode(repeat('84', 32), 'hex'));
select is(
  public.claim_guest_bootstrap_attempt(repeat('83', 32), 1::smallint) ->> 'state',
  'invalid',
  'READY attempt inside the completion margin does not start Auth'
);
select is(
  public.claim_guest_bootstrap_attempt(repeat('84', 32), 1::smallint) ->> 'state',
  'pending',
  'active lease stays pending inside the completion margin'
);

insert into olg113_session_case (case_name, bootstrap_digest_hex, account_id, session_id)
values ('near-linked', repeat('85', 32), gen_random_uuid(), gen_random_uuid());
update olg113_session_case
set create_result = public.create_guest_bootstrap_attempt(
      bootstrap_digest_hex,
      1::smallint,
      1::smallint
    )
where case_name = 'near-linked';
update olg113_session_case
set attempt_id = (create_result ->> 'attempt_id')::uuid,
    first_claim_result = public.claim_guest_bootstrap_attempt(bootstrap_digest_hex, 1::smallint)
where case_name = 'near-linked';
update olg113_session_case
set first_claim_id = (first_claim_result ->> 'claim_id')::uuid
where case_name = 'near-linked';
insert into auth.users (id, is_anonymous, raw_user_meta_data)
select account_id, true, jsonb_build_object(
  'guest_bootstrap_attempt_id', attempt_id,
  'guest_bootstrap_claim_id', first_claim_id
)
from olg113_session_case
where case_name = 'near-linked';
update public.guest_bootstrap_attempt as attempt
set expires_at = clock_timestamp() + interval '44 seconds',
    claim_lease_until = clock_timestamp() - interval '1 second'
from olg113_session_case as fixture
where fixture.case_name = 'near-linked' and fixture.attempt_id = attempt.attempt_id;
select is(
  public.claim_guest_bootstrap_attempt(repeat('85', 32), 1::smallint) ->> 'state',
  'recover_auth',
  'AUTH_LINKED attempt enters compensation even inside the completion margin'
);

-- session candidate ambiguity must not touch activity timestamps (80-82)
create temporary table olg113_batch_session_fixture (
  account_id uuid primary key,
  session_id uuid not null unique,
  digest_hex text not null unique,
  key_version smallint not null
) on commit drop;
insert into olg113_batch_session_fixture (account_id, session_id, digest_hex, key_version)
values
  (gen_random_uuid(), gen_random_uuid(), repeat('91', 32), 1::smallint),
  (gen_random_uuid(), gen_random_uuid(), repeat('92', 32), 2::smallint);
insert into auth.users (id, is_anonymous)
select account_id, false from olg113_batch_session_fixture;
insert into public.app_session (
  session_id,
  account_id,
  auth_grant_ciphertext,
  auth_grant_nonce,
  auth_grant_key_version,
  auth_grant_expires_at,
  created_at,
  last_seen_at,
  idle_expires_at,
  absolute_expires_at
)
select
  session_id,
  account_id,
  decode(repeat(case when key_version = 1 then 'c1' else 'c2' end, 17), 'hex'),
  decode(repeat(case when key_version = 1 then 'd1' else 'd2' end, 12), 'hex'),
  key_version,
  statement_timestamp() + interval '1 hour',
  statement_timestamp() - interval '10 minutes',
  statement_timestamp() - interval '10 minutes',
  statement_timestamp() + interval '90 days',
  statement_timestamp() + interval '365 days'
from olg113_batch_session_fixture;
insert into public.app_session_credential (
  session_id,
  token_digest,
  token_digest_key_version
)
select session_id, decode(digest_hex, 'hex'), key_version
from olg113_batch_session_fixture;
select is(
  public.resolve_app_session_candidates(
    jsonb_build_array(
      jsonb_build_object('digest_hex', repeat('91', 32), 'digest_key_version', 1),
      jsonb_build_object('digest_hex', repeat('92', 32), 'digest_key_version', 2)
    )
  ) ->> 'state',
  'ambiguous',
  'session multi-hit fails closed instead of choosing the first key'
);
select is(
  (
    select count(*)::integer
    from public.app_session as session
    join olg113_batch_session_fixture as fixture on fixture.session_id = session.session_id
    where session.last_seen_at < clock_timestamp() - interval '9 minutes'
  ),
  2,
  'session multi-hit does not refresh either activity timestamp'
);
select is(
  (
    public.resolve_app_session_candidates(
      jsonb_build_array(
        jsonb_build_object('digest_hex', repeat('91', 32), 'digest_key_version', 1)
      )
    ) ->> 'credential_key_version'
  )::integer,
  1,
  'one session candidate resolves with the matched credential key version'
);

select * from finish();
rollback;

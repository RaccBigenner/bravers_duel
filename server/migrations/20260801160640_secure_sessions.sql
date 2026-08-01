-- OLG-113: browserへSupabase tokenを出さず、HttpOnly opaque sessionへ収容する。
-- raw bootstrap/session tokenは保存せず、server-side HMAC digestだけを置く。
-- claim_idは秘密credentialではなく、遅延したAuth transactionを拒否する短命fencing ID。

create table public.guest_bootstrap_attempt (
  attempt_id uuid primary key default gen_random_uuid(),
  bootstrap_digest bytea not null unique,
  digest_format_version smallint not null default 1,
  digest_key_version smallint not null,
  session_derivation_key_version smallint not null,
  attempt_state text not null default 'READY',
  claim_id uuid,
  claim_generation bigint not null default 0,
  claim_lease_until timestamptz,
  account_id uuid unique,
  last_auth_account_id uuid,
  session_id uuid unique,
  safe_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  auth_linked_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  constraint guest_bootstrap_digest_length check (octet_length(bootstrap_digest) = 32),
  constraint guest_bootstrap_key_versions check (
    digest_format_version = 1
    and claim_generation >= 0
    and digest_key_version between 1 and 32767
    and session_derivation_key_version between 1 and 32767
  ),
  constraint guest_bootstrap_state check (
    attempt_state in ('READY', 'CLAIMED', 'AUTH_LINKED', 'CLEANUP_PENDING', 'COMPLETED')
  ),
  constraint guest_bootstrap_claim_pair check (
    (claim_id is null and claim_lease_until is null)
    or (claim_id is not null and claim_lease_until is not null)
  ),
  constraint guest_bootstrap_session_requires_account check (
    session_id is null or account_id is not null
  ),
  constraint guest_bootstrap_state_shape check (
    (attempt_state = 'READY'
      and claim_id is null and account_id is null and session_id is null
      and auth_linked_at is null and completed_at is null)
    or (attempt_state = 'CLAIMED'
      and claim_id is not null and account_id is null and session_id is null
      and auth_linked_at is null and completed_at is null)
    or (attempt_state = 'AUTH_LINKED'
      and claim_id is not null and account_id is not null and last_auth_account_id = account_id
      and session_id is null and auth_linked_at is not null and completed_at is null)
    or (attempt_state = 'CLEANUP_PENDING'
      and claim_id is not null and last_auth_account_id is not null
      and session_id is null and auth_linked_at is not null and completed_at is null)
    or (attempt_state = 'COMPLETED'
      and claim_id is null and account_id is not null and session_id is not null
      and auth_linked_at is not null and completed_at is not null)
  ),
  constraint guest_bootstrap_expiry_order check (expires_at > created_at),
  constraint guest_bootstrap_safe_error_format check (
    safe_error_code is null or safe_error_code ~ '^[A-Z0-9_]{1,64}$'
  )
);

comment on table public.guest_bootstrap_attempt is
  'Short-lived server-side claim ledger for idempotent anonymous account bootstrap.';
comment on column public.guest_bootstrap_attempt.bootstrap_digest is
  'HMAC-SHA-256 digest only. The HttpOnly bootstrap cookie raw value is never stored.';
comment on column public.guest_bootstrap_attempt.last_auth_account_id is
  'Historical ID used to prove Auth/account cascade before a failed bootstrap claim is released.';

create index guest_bootstrap_attempt_expires_idx
  on public.guest_bootstrap_attempt (expires_at);

create table public.app_session (
  session_id uuid primary key,
  account_id uuid not null references public.account (account_id) on delete cascade,
  auth_grant_ciphertext bytea not null,
  auth_grant_nonce bytea not null,
  auth_grant_format_version smallint not null default 1,
  auth_grant_key_version smallint not null,
  auth_grant_revision bigint not null default 1,
  auth_grant_expires_at timestamptz not null,
  session_version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  idle_expires_at timestamptz not null default (statement_timestamp() + interval '90 days'),
  absolute_expires_at timestamptz not null default (statement_timestamp() + interval '365 days'),
  revoked_at timestamptz,
  revoke_reason text,
  constraint app_session_nonce_length check (octet_length(auth_grant_nonce) = 12),
  constraint app_session_ciphertext_length check (
    octet_length(auth_grant_ciphertext) between 17 and 32768
  ),
  constraint app_session_key_versions check (
    auth_grant_format_version = 1
    and auth_grant_key_version between 1 and 32767
    and auth_grant_revision > 0
  ),
  constraint app_session_version_positive check (session_version > 0),
  constraint app_session_expiry_order check (
    last_seen_at >= created_at
    and idle_expires_at > last_seen_at
    and absolute_expires_at >= idle_expires_at
    and auth_grant_expires_at > created_at
  ),
  constraint app_session_revoke_pair check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null)
  ),
  constraint app_session_revoke_reason_format check (
    revoke_reason is null or revoke_reason ~ '^[A-Z0-9_]{1,64}$'
  )
);

alter table public.app_session
  add constraint app_session_auth_grant_nonce_unique
  unique (auth_grant_key_version, auth_grant_nonce);

comment on table public.app_session is
  'Server-authoritative browser session. Direct Data API access is forbidden.';
comment on column public.app_session.auth_grant_ciphertext is
  'AES-GCM encrypted Supabase grant for server-side identity linking/refresh only.';

create index app_session_account_active_idx
  on public.app_session (account_id, revoked_at, idle_expires_at);

create table public.app_session_credential (
  credential_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.app_session (session_id) on delete cascade,
  token_digest bytea not null unique,
  digest_format_version smallint not null default 1,
  token_digest_key_version smallint not null,
  credential_generation bigint not null default 1,
  credential_state text not null default 'CURRENT',
  issued_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  constraint app_session_credential_digest_length check (octet_length(token_digest) = 32),
  constraint app_session_credential_key_version check (
    digest_format_version = 1
    and token_digest_key_version between 1 and 32767
    and credential_generation > 0
  ),
  constraint app_session_credential_state check (
    credential_state in ('CURRENT', 'REVOKED')
  ),
  constraint app_session_credential_acceptance check (
    (credential_state = 'CURRENT' and revoked_at is null)
    or (credential_state = 'REVOKED' and revoked_at is not null)
  ),
  unique (session_id, credential_generation)
);

comment on table public.app_session_credential is
  'Versioned opaque cookie lookup credentials, separated from immutable encrypted Auth grant.';
comment on column public.app_session_credential.token_digest is
  'HMAC-SHA-256 lookup digest. The opaque cookie raw value is never stored.';

create unique index app_session_one_current_credential_idx
  on public.app_session_credential (session_id)
  where credential_state = 'CURRENT';
create index app_session_credential_session_idx
  on public.app_session_credential (session_id, credential_state, revoked_at);

alter table public.guest_bootstrap_attempt enable row level security;
alter table public.app_session enable row level security;
alter table public.app_session_credential enable row level security;

revoke all on table public.guest_bootstrap_attempt
  from public, anon, authenticated, service_role;
revoke all on table public.app_session
  from public, anon, authenticated, service_role;
revoke all on table public.app_session_credential
  from public, anon, authenticated, service_role;

create or replace function public.create_guest_bootstrap_attempt(
  p_bootstrap_digest_hex text,
  p_digest_key_version smallint,
  p_session_derivation_key_version smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
begin
  if p_bootstrap_digest_hex is null
    or p_bootstrap_digest_hex !~ '^[0-9a-f]{64}$'
    or p_digest_key_version is null
    or p_digest_key_version not between 1 and 32767
    or p_session_derivation_key_version is null
    or p_session_derivation_key_version not between 1 and 32767
  then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
  end if;

  -- 完了済み/未着手/未Auth作成の期限切れだけを少量ずつ掃除する。CLAIMEDは
  -- account/sessionが無いものに限定し、遅延signupは後段triggerでfail closedになる。
  -- Auth作成済み・session未完成はOLG-116の補償対象なので、ここで証跡を消さない。
  with expired as (
    select attempt_id
    from public.guest_bootstrap_attempt
    where expires_at <= statement_timestamp()
      and (
        attempt_state in ('READY', 'COMPLETED')
        or (
          attempt_state = 'CLAIMED'
          and account_id is null
          and session_id is null
        )
      )
    order by expires_at
    for update skip locked
    limit 32
  )
  delete from public.guest_bootstrap_attempt as attempt
  using expired
  where attempt.attempt_id = expired.attempt_id;

  insert into public.guest_bootstrap_attempt (
    bootstrap_digest,
    digest_key_version,
    session_derivation_key_version
  )
  values (
    decode(p_bootstrap_digest_hex, 'hex'),
    p_digest_key_version,
    p_session_derivation_key_version
  )
  returning attempt_id into v_attempt_id;

  return jsonb_build_object('state', 'created', 'attempt_id', v_attempt_id);
end;
$$;

create or replace function public.claim_guest_bootstrap_attempt_candidates(
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.guest_bootstrap_attempt%rowtype;
  v_candidate_attempt public.guest_bootstrap_attempt%rowtype;
  v_candidate_item jsonb;
  v_candidate_version_text text;
  v_match_count integer := 0;
  v_claim_id uuid;
  v_session public.app_session%rowtype;
  v_now timestamptz;
begin
  -- PostgreSQLはboolean項の評価順を保証しない。型確認→shape→castを段階化し、
  -- security-definer入口で不正JSONがraw SQL errorへ化けないようにする。
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
  end if;
  if jsonb_array_length(p_candidates) not between 1 and 8 then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
  end if;
  for v_candidate_item in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate_item) <> 'object'
      or not (v_candidate_item ?& array['digest_hex', 'digest_key_version'])
      or v_candidate_item - 'digest_hex' - 'digest_key_version' <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
    end if;
    if jsonb_typeof(v_candidate_item -> 'digest_hex') <> 'string'
      or jsonb_typeof(v_candidate_item -> 'digest_key_version') <> 'number'
    then
      raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
    end if;
    v_candidate_version_text := v_candidate_item ->> 'digest_key_version';
    if v_candidate_item ->> 'digest_hex' !~ '^[0-9a-f]{64}$'
      or v_candidate_version_text !~ '^[0-9]{1,5}$'
    then
      raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
    end if;
    if v_candidate_version_text::integer not between 1 and 32767 then
      raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
    end if;
  end loop;
  if (
    select count(*) <> count(distinct (
      candidate.item ->> 'digest_hex',
      candidate.item ->> 'digest_key_version'
    ))
    from jsonb_array_elements(p_candidates) as candidate(item)
  ) then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
  end if;

  -- versionなしcookieのactive+retained候補を1 transactionで照合する。
  -- 2行以上に当たった場合はどの行もclaimせず、credential ambiguityとしてfail closedする。
  for v_candidate_attempt in
    select attempt.*
    from public.guest_bootstrap_attempt as attempt
    join jsonb_array_elements(p_candidates) as candidate(item)
      on attempt.bootstrap_digest = decode(candidate.item ->> 'digest_hex', 'hex')
      and attempt.digest_key_version = (candidate.item ->> 'digest_key_version')::smallint
    where attempt.expires_at > statement_timestamp()
    order by attempt.attempt_id
    for update of attempt
  loop
    v_match_count := v_match_count + 1;
    v_attempt := v_candidate_attempt;
  end loop;

  if v_match_count = 0 then
    return jsonb_build_object('state', 'invalid');
  end if;
  if v_match_count > 1 then
    return jsonb_build_object('state', 'ambiguous');
  end if;

  v_now := clock_timestamp();
  if v_attempt.expires_at <= v_now then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_attempt.attempt_state = 'COMPLETED' and v_attempt.session_id is not null then
    select * into v_session
    from public.app_session
    where session_id = v_attempt.session_id;

    if found
      and v_session.account_id = v_attempt.account_id
      and v_session.revoked_at is null
      and v_session.idle_expires_at > v_now
      and v_session.absolute_expires_at > v_now
    then
      return jsonb_build_object(
        'state', 'session_ready',
        'attempt_id', v_attempt.attempt_id,
        'session_id', v_session.session_id,
        'account_id', v_session.account_id,
        'session_version', v_session.session_version,
        'session_derivation_key_version', v_attempt.session_derivation_key_version
      );
    end if;
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_attempt.claim_lease_until is not null
    and v_attempt.claim_lease_until > v_now
  then
    return jsonb_build_object('state', 'pending', 'retry_after_seconds', 1);
  end if;

  v_claim_id := gen_random_uuid();
  if v_attempt.attempt_state in ('AUTH_LINKED', 'CLEANUP_PENDING')
    and v_attempt.last_auth_account_id is not null
  then
    update public.guest_bootstrap_attempt
    set attempt_state = 'CLEANUP_PENDING',
        claim_id = v_claim_id,
        claim_generation = claim_generation + 1,
        claim_lease_until = v_now + interval '30 seconds',
        updated_at = v_now,
        safe_error_code = null
    where attempt_id = v_attempt.attempt_id;
    return jsonb_build_object(
      'state', 'recover_auth',
      'attempt_id', v_attempt.attempt_id,
      'claim_id', v_claim_id,
      'account_id', v_attempt.last_auth_account_id
    );
  end if;

  -- 新しいAuth signupを完走する余裕がないattemptだけを拒否する。補償回収は上で許可済み。
  if v_attempt.expires_at <= v_now + interval '45 seconds' then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_attempt.attempt_state not in ('READY', 'CLAIMED')
    or v_attempt.account_id is not null
    or v_attempt.session_id is not null
  then
    return jsonb_build_object('state', 'invalid');
  end if;

  update public.guest_bootstrap_attempt
  set attempt_state = 'CLAIMED',
      claim_id = v_claim_id,
      claim_generation = claim_generation + 1,
      claim_lease_until = v_now + interval '30 seconds',
      updated_at = v_now,
      safe_error_code = null
  where attempt_id = v_attempt.attempt_id;

  return jsonb_build_object(
    'state', 'create_auth',
    'attempt_id', v_attempt.attempt_id,
    'claim_id', v_claim_id,
    'session_derivation_key_version', v_attempt.session_derivation_key_version
  );
end;
$$;

create or replace function public.claim_guest_bootstrap_attempt(
  p_bootstrap_digest_hex text,
  p_digest_key_version smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_bootstrap_digest_hex is null
    or p_bootstrap_digest_hex !~ '^[0-9a-f]{64}$'
    or p_digest_key_version is null
    or p_digest_key_version not between 1 and 32767
  then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_INPUT';
  end if;
  return public.claim_guest_bootstrap_attempt_candidates(
    jsonb_build_array(
      jsonb_build_object(
        'digest_hex', p_bootstrap_digest_hex,
        'digest_key_version', p_digest_key_version
      )
    )
  );
end;
$$;

create or replace function public.release_guest_bootstrap_claim(
  p_attempt_id uuid,
  p_claim_id uuid,
  p_safe_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_safe_error_code is null or p_safe_error_code !~ '^[A-Z0-9_]{1,64}$' then
    raise exception using errcode = '22023', message = 'INVALID_SAFE_ERROR_CODE';
  end if;

  update public.guest_bootstrap_attempt
  set attempt_state = 'READY',
      claim_id = null,
      claim_lease_until = null,
      safe_error_code = p_safe_error_code,
      updated_at = statement_timestamp()
  where attempt_id = p_attempt_id
    and claim_id = p_claim_id
    and attempt_state = 'CLAIMED'
    and account_id is null
    and session_id is null;
  return found;
end;
$$;

create or replace function public.reset_guest_bootstrap_after_auth_delete(
  p_attempt_id uuid,
  p_claim_id uuid,
  p_deleted_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guest_bootstrap_attempt as attempt
  set attempt_state = 'READY',
      claim_id = null,
      claim_lease_until = null,
      account_id = null,
      last_auth_account_id = null,
      auth_linked_at = null,
      safe_error_code = 'AUTH_COMPENSATED',
      updated_at = statement_timestamp()
  where attempt.attempt_id = p_attempt_id
    and attempt.claim_id = p_claim_id
    and attempt.attempt_state = 'CLEANUP_PENDING'
    and attempt.account_id = p_deleted_account_id
    and attempt.session_id is null
    and attempt.last_auth_account_id = p_deleted_account_id
    and not exists (
      select 1 from auth.users as auth_user where auth_user.id = p_deleted_account_id
    )
    and not exists (
      select 1 from public.account as account where account.account_id = p_deleted_account_id
    );
  return found;
end;
$$;

create or replace function public.complete_guest_app_session(
  p_attempt_id uuid,
  p_claim_id uuid,
  p_account_id uuid,
  p_session_id uuid,
  p_token_digest_hex text,
  p_token_digest_key_version smallint,
  p_auth_grant_ciphertext_hex text,
  p_auth_grant_nonce_hex text,
  p_auth_grant_key_version smallint,
  p_auth_grant_expires_at_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.guest_bootstrap_attempt%rowtype;
  v_session public.app_session%rowtype;
  v_credential public.app_session_credential%rowtype;
  v_now timestamptz;
begin
  v_now := clock_timestamp();
  if p_token_digest_hex is null
    or p_token_digest_hex !~ '^[0-9a-f]{64}$'
    or p_attempt_id is null
    or p_claim_id is null
    or p_account_id is null
    or p_session_id is null
    or p_token_digest_key_version is null
    or p_token_digest_key_version not between 1 and 32767
    or p_auth_grant_ciphertext_hex is null
    -- PostgreSQLのPOSIX boundは255以下なので、巨大な{min,max}を使わず分離する。
    or p_auth_grant_ciphertext_hex !~ '^[0-9a-f]+$'
    or length(p_auth_grant_ciphertext_hex) not between 34 and 65536
    or length(p_auth_grant_ciphertext_hex) % 2 <> 0
    or p_auth_grant_nonce_hex is null
    or p_auth_grant_nonce_hex !~ '^[0-9a-f]{24}$'
    or p_auth_grant_key_version is null
    or p_auth_grant_key_version not between 1 and 32767
    or p_auth_grant_expires_at_epoch is null
    or p_auth_grant_expires_at_epoch <= extract(epoch from v_now)::bigint
    or p_auth_grant_expires_at_epoch > extract(epoch from v_now + interval '7 days')::bigint
  then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;

  select * into v_attempt
  from public.guest_bootstrap_attempt
  where attempt_id = p_attempt_id
  for update;

  -- row lock待ちを含めた最新DB時刻でlease/expiryを最終判定する。
  v_now := clock_timestamp();
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_attempt.attempt_state = 'COMPLETED' and v_attempt.session_id is not null then
    select * into v_session
    from public.app_session
    where session_id = v_attempt.session_id;
    select * into v_credential
    from public.app_session_credential
    where session_id = v_attempt.session_id
      and credential_state = 'CURRENT';
    if found
      and v_session.account_id = p_account_id
      and v_session.revoked_at is null
      and v_session.idle_expires_at > v_now
      and v_session.absolute_expires_at > v_now
      and v_credential.token_digest = decode(p_token_digest_hex, 'hex')
      and v_credential.token_digest_key_version = p_token_digest_key_version
    then
      return jsonb_build_object(
        'state', 'session_ready',
        'attempt_id', v_attempt.attempt_id,
        'session_id', v_session.session_id,
        'account_id', v_session.account_id,
        'session_version', v_session.session_version,
        'idle_expires_at', v_session.idle_expires_at,
        'absolute_expires_at', v_session.absolute_expires_at
      );
    end if;
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_attempt.attempt_state <> 'AUTH_LINKED'
    or v_attempt.claim_id is distinct from p_claim_id
    or v_attempt.claim_lease_until is null
    or v_attempt.claim_lease_until <= v_now
    or v_attempt.account_id is distinct from p_account_id
    or v_attempt.last_auth_account_id is distinct from p_account_id
    or p_token_digest_key_version <> v_attempt.session_derivation_key_version
    or p_auth_grant_expires_at_epoch <= extract(epoch from v_now)::bigint
    or p_auth_grant_expires_at_epoch > extract(epoch from v_now + interval '7 days')::bigint
  then
    return jsonb_build_object('state', 'invalid');
  end if;

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
  values (
    p_session_id,
    p_account_id,
    decode(p_auth_grant_ciphertext_hex, 'hex'),
    decode(p_auth_grant_nonce_hex, 'hex'),
    p_auth_grant_key_version,
    to_timestamp(p_auth_grant_expires_at_epoch),
    v_now,
    v_now,
    v_now + interval '90 days',
    v_now + interval '365 days'
  )
  returning * into v_session;

  insert into public.app_session_credential (
    session_id,
    token_digest,
    token_digest_key_version
  )
  values (
    v_session.session_id,
    decode(p_token_digest_hex, 'hex'),
    p_token_digest_key_version
  );

  update public.guest_bootstrap_attempt
  set attempt_state = 'COMPLETED',
      session_id = v_session.session_id,
      claim_id = null,
      claim_lease_until = null,
      safe_error_code = null,
      completed_at = v_now,
      updated_at = v_now
  where attempt_id = v_attempt.attempt_id;

  return jsonb_build_object(
    'state', 'session_ready',
    'attempt_id', v_attempt.attempt_id,
    'session_id', v_session.session_id,
    'account_id', v_session.account_id,
    'session_version', v_session.session_version,
    'idle_expires_at', v_session.idle_expires_at,
    'absolute_expires_at', v_session.absolute_expires_at
  );
end;
$$;

create or replace function public.resolve_app_session_candidates(
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.app_session%rowtype;
  v_credential public.app_session_credential%rowtype;
  v_candidate_credential public.app_session_credential%rowtype;
  v_candidate_item jsonb;
  v_candidate_version_text text;
  v_match_count integer := 0;
  v_now timestamptz;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;
  if jsonb_array_length(p_candidates) not between 1 and 8 then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;
  for v_candidate_item in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate_item) <> 'object'
      or not (v_candidate_item ?& array['digest_hex', 'digest_key_version'])
      or v_candidate_item - 'digest_hex' - 'digest_key_version' <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
    end if;
    if jsonb_typeof(v_candidate_item -> 'digest_hex') <> 'string'
      or jsonb_typeof(v_candidate_item -> 'digest_key_version') <> 'number'
    then
      raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
    end if;
    v_candidate_version_text := v_candidate_item ->> 'digest_key_version';
    if v_candidate_item ->> 'digest_hex' !~ '^[0-9a-f]{64}$'
      or v_candidate_version_text !~ '^[0-9]{1,5}$'
    then
      raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
    end if;
    if v_candidate_version_text::integer not between 1 and 32767 then
      raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
    end if;
  end loop;
  if (
    select count(*) <> count(distinct (
      candidate.item ->> 'digest_hex',
      candidate.item ->> 'digest_key_version'
    ))
    from jsonb_array_elements(p_candidates) as candidate(item)
  ) then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;

  for v_candidate_credential in
    select credential.*
    from public.app_session_credential as credential
    join jsonb_array_elements(p_candidates) as candidate(item)
      on credential.token_digest = decode(candidate.item ->> 'digest_hex', 'hex')
      and credential.token_digest_key_version =
        (candidate.item ->> 'digest_key_version')::smallint
    where credential.credential_state = 'CURRENT'
    order by credential.credential_id
    for update of credential
  loop
    v_match_count := v_match_count + 1;
    v_credential := v_candidate_credential;
  end loop;

  if v_match_count = 0 then
    return null;
  end if;
  if v_match_count > 1 then
    return jsonb_build_object('state', 'ambiguous');
  end if;

  select * into v_session
  from public.app_session
  where session_id = v_credential.session_id
  for update;

  v_now := clock_timestamp();
  if not found
    or v_session.revoked_at is not null
    or v_session.idle_expires_at <= v_now
    or v_session.absolute_expires_at <= v_now
  then
    return null;
  end if;

  if v_session.last_seen_at <= v_now - interval '5 minutes' then
    update public.app_session
    set last_seen_at = v_now,
        idle_expires_at = least(absolute_expires_at, v_now + interval '90 days')
    where session_id = v_session.session_id
    returning * into v_session;
  end if;

  return jsonb_build_object(
    'session_id', v_session.session_id,
    'account_id', v_session.account_id,
    'session_version', v_session.session_version,
    'credential_state', v_credential.credential_state,
    'credential_key_version', v_credential.token_digest_key_version,
    'idle_expires_at', v_session.idle_expires_at,
    'absolute_expires_at', v_session.absolute_expires_at
  );
end;
$$;

create or replace function public.resolve_app_session(
  p_token_digest_hex text,
  p_token_digest_key_version smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_digest_hex is null
    or p_token_digest_hex !~ '^[0-9a-f]{64}$'
    or p_token_digest_key_version is null
    or p_token_digest_key_version not between 1 and 32767
  then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;
  return public.resolve_app_session_candidates(
    jsonb_build_array(
      jsonb_build_object(
        'digest_hex', p_token_digest_hex,
        'digest_key_version', p_token_digest_key_version
      )
    )
  );
end;
$$;

create or replace function public.validate_app_session_version(
  p_session_id uuid,
  p_session_version bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_session
    where session_id = p_session_id
      and session_version = p_session_version
      and revoked_at is null
      and idle_expires_at > statement_timestamp()
      and absolute_expires_at > statement_timestamp()
  );
$$;

create or replace function public.revoke_app_session(
  p_token_digest_hex text,
  p_token_digest_key_version smallint,
  p_revoke_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.app_session%rowtype;
  v_credential public.app_session_credential%rowtype;
  v_already_revoked boolean;
begin
  if p_token_digest_hex is null
    or p_token_digest_hex !~ '^[0-9a-f]{64}$'
    or p_token_digest_key_version is null
    or p_token_digest_key_version not between 1 and 32767
    or p_revoke_reason is null
    or p_revoke_reason !~ '^[A-Z0-9_]{1,64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;

  select * into v_credential
  from public.app_session_credential
  where token_digest = decode(p_token_digest_hex, 'hex')
    and token_digest_key_version = p_token_digest_key_version
  for update;

  if not found then
    return null;
  end if;

  select * into v_session
  from public.app_session
  where session_id = v_credential.session_id
  for update;

  if not found then
    return null;
  end if;

  -- session/credential row lock取得後の実時刻を失効のlinearization pointにする。
  v_already_revoked := v_session.revoked_at is not null;
  if v_session.revoked_at is null then
    update public.app_session
    set revoked_at = clock_timestamp(),
        revoke_reason = p_revoke_reason,
        session_version = session_version + 1
    where session_id = v_session.session_id
    returning * into v_session;

    update public.app_session_credential
    set credential_state = 'REVOKED',
        revoked_at = clock_timestamp()
    where session_id = v_session.session_id
      and credential_state <> 'REVOKED';
  end if;

  return jsonb_build_object(
    'session_id', v_session.session_id,
    'account_id', v_session.account_id,
    'session_version', v_session.session_version,
    'already_revoked', v_already_revoked
  );
end;
$$;

create or replace function public.link_guest_bootstrap_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_text text;
  v_claim_text text;
  v_attempt_id uuid;
  v_claim_id uuid;
  v_attempt public.guest_bootstrap_attempt%rowtype;
  v_now timestamptz;
begin
  if new.is_anonymous is distinct from true then
    return new;
  end if;

  v_attempt_text := new.raw_user_meta_data ->> 'guest_bootstrap_attempt_id';
  v_claim_text := new.raw_user_meta_data ->> 'guest_bootstrap_claim_id';
  if v_attempt_text is null
    or v_claim_text is null
    or v_attempt_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_claim_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception using errcode = '23514', message = 'INVALID_GUEST_BOOTSTRAP_METADATA';
  end if;

  v_attempt_id := v_attempt_text::uuid;
  v_claim_id := v_claim_text::uuid;
  select * into v_attempt
  from public.guest_bootstrap_attempt
  where attempt_id = v_attempt_id
  for update;

  v_now := clock_timestamp();
  if not found
    or v_attempt.attempt_state <> 'CLAIMED'
    or v_attempt.claim_id is distinct from v_claim_id
    or v_attempt.claim_lease_until is null
    or v_attempt.claim_lease_until <= v_now
    or v_attempt.expires_at <= v_now
    or v_attempt.account_id is not null
    or v_attempt.session_id is not null
  then
    raise exception using errcode = '23514', message = 'GUEST_BOOTSTRAP_CLAIM_REJECTED';
  end if;

  update public.guest_bootstrap_attempt
  set attempt_state = 'AUTH_LINKED',
      account_id = new.id,
      last_auth_account_id = new.id,
      auth_linked_at = v_now,
      updated_at = v_now
  where attempt_id = v_attempt_id;

  -- fencing IDはlink後のAuth user metadataに残さない。attempt台帳だけが監査正本。
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    - 'guest_bootstrap_attempt_id'
    - 'guest_bootstrap_claim_id'
  where id = new.id;
  return new;
end;
$$;

-- PostgreSQLは同じevent/timingのtriggerを名前順に実行する。OLG-111の
-- on_auth_user_created_create_game_accountより後にして、account FKを先に成立させる。
create trigger on_auth_user_created_link_guest_bootstrap
  after insert on auth.users
  for each row execute function public.link_guest_bootstrap_from_auth_user();

revoke all on function public.create_guest_bootstrap_attempt(text, smallint, smallint)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_guest_bootstrap_attempt(text, smallint)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_guest_bootstrap_attempt_candidates(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.release_guest_bootstrap_claim(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_guest_bootstrap_after_auth_delete(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_guest_app_session(uuid, uuid, uuid, uuid, text, smallint, text, text, smallint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_app_session(text, smallint)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_app_session_candidates(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.validate_app_session_version(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_app_session(text, smallint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.link_guest_bootstrap_from_auth_user()
  from public, anon, authenticated, service_role;

grant execute on function public.create_guest_bootstrap_attempt(text, smallint, smallint)
  to service_role;
grant execute on function public.claim_guest_bootstrap_attempt(text, smallint)
  to service_role;
grant execute on function public.claim_guest_bootstrap_attempt_candidates(jsonb)
  to service_role;
grant execute on function public.release_guest_bootstrap_claim(uuid, uuid, text)
  to service_role;
grant execute on function public.reset_guest_bootstrap_after_auth_delete(uuid, uuid, uuid)
  to service_role;
grant execute on function public.complete_guest_app_session(uuid, uuid, uuid, uuid, text, smallint, text, text, smallint, bigint)
  to service_role;
grant execute on function public.resolve_app_session(text, smallint)
  to service_role;
grant execute on function public.resolve_app_session_candidates(jsonb)
  to service_role;
grant execute on function public.validate_app_session_version(uuid, bigint)
  to service_role;
grant execute on function public.revoke_app_session(text, smallint, text)
  to service_role;

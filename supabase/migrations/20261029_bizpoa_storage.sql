create table if not exists public.bizpoa_state_meta (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.bizpoa_state_meta (id) values (true) on conflict (id) do nothing;

create table if not exists public.bizpoa_businesses (
  phone_number text primary key,
  code text not null unique check (code ~ '^BZ-[A-Z0-9]{6}$'),
  name text not null,
  category text,
  category_label text,
  type text,
  registered_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.bizpoa_transactions (
  id text primary key,
  phone_number text not null,
  business_code text references public.bizpoa_businesses(code) on update cascade on delete set null,
  type text not null check (type in ('sale', 'expense')),
  amount numeric(14, 2) not null check (amount > 0),
  date date not null,
  created_at timestamptz not null
);
create index if not exists bizpoa_transactions_business_date_idx
  on public.bizpoa_transactions (business_code, date desc);
create index if not exists bizpoa_transactions_phone_date_idx
  on public.bizpoa_transactions (phone_number, date desc);

create table if not exists public.bizpoa_sms_notes (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  business_code text references public.bizpoa_businesses(code) on update cascade on delete set null,
  text text not null,
  message_id text unique,
  ai_topic text,
  ai_summary text,
  ai_reply text,
  received_at timestamptz not null
);
create index if not exists bizpoa_sms_notes_business_received_idx
  on public.bizpoa_sms_notes (business_code, received_at desc);

create table if not exists public.bizpoa_users (
  phone_number text primary key,
  language text check (language in ('en', 'sw')),
  updated_at timestamptz not null
);

create table if not exists public.bizpoa_ussd_sessions (
  session_id text primary key,
  phone_number text not null,
  payload jsonb not null
);

create table if not exists public.bizpoa_owner_otp_challenges (
  challenge_key text primary key,
  code_hash text not null,
  expires_at_ms bigint not null,
  sent_at_ms bigint not null,
  attempts integer not null default 0 check (attempts >= 0)
);

create table if not exists public.bizpoa_owner_otp_rate_limits (
  challenge_key text primary key,
  request_times_ms jsonb not null default '[]'::jsonb,
  last_sent_at_ms bigint not null default 0
);

alter table public.bizpoa_state_meta enable row level security;
alter table public.bizpoa_businesses enable row level security;
alter table public.bizpoa_transactions enable row level security;
alter table public.bizpoa_sms_notes enable row level security;
alter table public.bizpoa_users enable row level security;
alter table public.bizpoa_ussd_sessions enable row level security;
alter table public.bizpoa_owner_otp_challenges enable row level security;
alter table public.bizpoa_owner_otp_rate_limits enable row level security;

revoke all on public.bizpoa_state_meta, public.bizpoa_businesses, public.bizpoa_transactions,
  public.bizpoa_sms_notes, public.bizpoa_users, public.bizpoa_ussd_sessions,
  public.bizpoa_owner_otp_challenges, public.bizpoa_owner_otp_rate_limits
  from public, anon, authenticated;
grant all on public.bizpoa_state_meta, public.bizpoa_businesses, public.bizpoa_transactions,
  public.bizpoa_sms_notes, public.bizpoa_users, public.bizpoa_ussd_sessions,
  public.bizpoa_owner_otp_challenges, public.bizpoa_owner_otp_rate_limits
  to service_role;

create or replace function public.bizpoa_read_state()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'revision', (select revision from public.bizpoa_state_meta where id = true),
    'users', coalesce((
      select jsonb_object_agg(phone_number, jsonb_build_object('language', language, 'updatedAt', updated_at))
      from public.bizpoa_users
    ), '{}'::jsonb),
    'sessions', coalesce((
      select jsonb_object_agg(session_id, payload)
      from public.bizpoa_ussd_sessions
    ), '{}'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'phoneNumber', phone_number, 'businessCode', business_code,
        'type', type, 'amount', amount, 'date', date, 'createdAt', created_at
      ) order by created_at desc, id)
      from public.bizpoa_transactions
    ), '[]'::jsonb),
    'businesses', coalesce((
      select jsonb_object_agg(phone_number, jsonb_build_object(
        'code', code, 'name', name, 'category', category, 'categoryLabel', category_label,
        'type', type, 'phoneNumber', phone_number, 'registeredAt', registered_at, 'updatedAt', updated_at
      ))
      from public.bizpoa_businesses
    ), '{}'::jsonb),
    'smsNotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'phoneNumber', phone_number, 'businessCode', business_code, 'text', text,
        'messageId', message_id, 'aiTopic', ai_topic, 'aiSummary', ai_summary,
        'aiReply', ai_reply, 'receivedAt', received_at
      ) order by received_at desc, id)
      from public.bizpoa_sms_notes
    ), '[]'::jsonb),
    'ownerOtpChallenges', coalesce((
      select jsonb_object_agg(challenge_key, jsonb_build_object(
        'codeHash', code_hash, 'expiresAt', expires_at_ms, 'sentAt', sent_at_ms, 'attempts', attempts
      ))
      from public.bizpoa_owner_otp_challenges
    ), '{}'::jsonb),
    'ownerOtpRateLimits', coalesce((
      select jsonb_object_agg(challenge_key, jsonb_build_object(
        'requestTimes', request_times_ms, 'lastSentAt', last_sent_at_ms
      ))
      from public.bizpoa_owner_otp_rate_limits
    ), '{}'::jsonb)
  );
$$;

create or replace function public.bizpoa_apply_state_delta(p_expected_revision bigint, p_delta jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_revision bigint;
begin
  select revision into current_revision
  from public.bizpoa_state_meta
  where id = true
  for update;

  if current_revision is distinct from p_expected_revision then
    return jsonb_build_object('conflict', true, 'revision', current_revision);
  end if;

  insert into public.bizpoa_businesses (phone_number, code, name, category, category_label, type, registered_at, updated_at)
  select phone_number, code, name, category, category_label, type, registered_at, updated_at
  from jsonb_to_recordset(coalesce(p_delta -> 'businesses_upsert', '[]'::jsonb)) as x(
    phone_number text, code text, name text, category text, category_label text, type text,
    registered_at timestamptz, updated_at timestamptz
  )
  on conflict (phone_number) do update set
    code = excluded.code, name = excluded.name, category = excluded.category,
    category_label = excluded.category_label, type = excluded.type,
    registered_at = excluded.registered_at, updated_at = excluded.updated_at;

  insert into public.bizpoa_users (phone_number, language, updated_at)
  select phone_number, language, updated_at
  from jsonb_to_recordset(coalesce(p_delta -> 'users_upsert', '[]'::jsonb)) as x(
    phone_number text, language text, updated_at timestamptz
  )
  on conflict (phone_number) do update set language = excluded.language, updated_at = excluded.updated_at;

  insert into public.bizpoa_ussd_sessions (session_id, phone_number, payload)
  select session_id, phone_number, payload
  from jsonb_to_recordset(coalesce(p_delta -> 'sessions_upsert', '[]'::jsonb)) as x(
    session_id text, phone_number text, payload jsonb
  )
  on conflict (session_id) do update set phone_number = excluded.phone_number, payload = excluded.payload;

  insert into public.bizpoa_transactions (id, phone_number, business_code, type, amount, date, created_at)
  select id, phone_number, business_code, type, amount, date, created_at
  from jsonb_to_recordset(coalesce(p_delta -> 'transactions_upsert', '[]'::jsonb)) as x(
    id text, phone_number text, business_code text, type text, amount numeric, date date, created_at timestamptz
  )
  on conflict (id) do update set
    phone_number = excluded.phone_number, business_code = excluded.business_code,
    type = excluded.type, amount = excluded.amount, date = excluded.date, created_at = excluded.created_at;

  insert into public.bizpoa_sms_notes (id, phone_number, business_code, text, message_id, ai_topic, ai_summary, ai_reply, received_at)
  select id, phone_number, business_code, text, message_id, ai_topic, ai_summary, ai_reply, received_at
  from jsonb_to_recordset(coalesce(p_delta -> 'sms_notes_upsert', '[]'::jsonb)) as x(
    id uuid, phone_number text, business_code text, text text, message_id text,
    ai_topic text, ai_summary text, ai_reply text, received_at timestamptz
  )
  on conflict (id) do update set
    phone_number = excluded.phone_number, business_code = excluded.business_code,
    text = excluded.text, message_id = excluded.message_id, ai_topic = excluded.ai_topic,
    ai_summary = excluded.ai_summary, ai_reply = excluded.ai_reply, received_at = excluded.received_at;

  insert into public.bizpoa_owner_otp_challenges (challenge_key, code_hash, expires_at_ms, sent_at_ms, attempts)
  select challenge_key, code_hash, expires_at_ms, sent_at_ms, attempts
  from jsonb_to_recordset(coalesce(p_delta -> 'otp_challenges_upsert', '[]'::jsonb)) as x(
    challenge_key text, code_hash text, expires_at_ms bigint, sent_at_ms bigint, attempts integer
  )
  on conflict (challenge_key) do update set
    code_hash = excluded.code_hash, expires_at_ms = excluded.expires_at_ms,
    sent_at_ms = excluded.sent_at_ms, attempts = excluded.attempts;

  insert into public.bizpoa_owner_otp_rate_limits (challenge_key, request_times_ms, last_sent_at_ms)
  select challenge_key, request_times_ms, last_sent_at_ms
  from jsonb_to_recordset(coalesce(p_delta -> 'otp_rate_limits_upsert', '[]'::jsonb)) as x(
    challenge_key text, request_times_ms jsonb, last_sent_at_ms bigint
  )
  on conflict (challenge_key) do update set
    request_times_ms = excluded.request_times_ms, last_sent_at_ms = excluded.last_sent_at_ms;

  delete from public.bizpoa_transactions
  where id in (select jsonb_array_elements_text(coalesce(p_delta -> 'transactions_delete', '[]'::jsonb)));
  delete from public.bizpoa_sms_notes
  where id in (select jsonb_array_elements_text(coalesce(p_delta -> 'sms_notes_delete', '[]'::jsonb))::uuid);
  delete from public.bizpoa_ussd_sessions
  where session_id in (select jsonb_array_elements_text(coalesce(p_delta -> 'sessions_delete', '[]'::jsonb)));
  delete from public.bizpoa_owner_otp_challenges
  where challenge_key in (select jsonb_array_elements_text(coalesce(p_delta -> 'otp_challenges_delete', '[]'::jsonb)));
  delete from public.bizpoa_owner_otp_rate_limits
  where challenge_key in (select jsonb_array_elements_text(coalesce(p_delta -> 'otp_rate_limits_delete', '[]'::jsonb)));
  delete from public.bizpoa_users
  where phone_number in (select jsonb_array_elements_text(coalesce(p_delta -> 'users_delete', '[]'::jsonb)));
  delete from public.bizpoa_businesses
  where phone_number in (select jsonb_array_elements_text(coalesce(p_delta -> 'businesses_delete', '[]'::jsonb)));

  update public.bizpoa_state_meta
  set revision = revision + 1, updated_at = now()
  where id = true
  returning revision into current_revision;

  return jsonb_build_object('conflict', false, 'revision', current_revision);
end;
$$;

revoke all on function public.bizpoa_read_state() from public, anon, authenticated;
revoke all on function public.bizpoa_apply_state_delta(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.bizpoa_read_state() to service_role;
grant execute on function public.bizpoa_apply_state_delta(bigint, jsonb) to service_role;

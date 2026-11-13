-- Vibii core schema. Works on Supabase and on local Postgres with db/local/000_auth_shim.sql.
-- Every user-owned row carries owner_id and is isolated by RLS (auth.uid()) for the
-- `authenticated` role. The server additionally checks ownership before privileged work.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  ui_language text not null default 'en' check (ui_language in ('en','he')),
  song_languages text[] not null default '{}',
  is_admin boolean not null default false,          -- server-managed only (column privilege revoked below)
  is_demo boolean not null default false,           -- isolated local demo account
  identity_key text,                                -- HMAC of verified identity; used for once-per-identity grants
  last_tab text not null default 'dj' check (last_tab in ('dj','vibes','create')),
  last_vibe text,
  last_track_id uuid,
  last_position_seconds numeric not null default 0,
  reveal_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Retained (hashed) after deletion so re-registration of the same identity cannot duplicate one-time grants.
create table public.grant_identities (
  identity_key text not null,
  grant_key text not null,
  granted_at timestamptz not null default now(),
  primary key (identity_key, grant_key)
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  version int not null,
  personal_details boolean not null,      -- may use family/pet/partner details
  provider_processing boolean not null,   -- may send permitted details to creation providers
  llm_processing boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.consent_records(owner_id, created_at desc);

-- ---------------------------------------------------------------- onboarding
create table public.onboarding_state (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  current_step text,
  profile_version int not null default 0,
  draft_plan jsonb,                       -- private, never sent to consumer screens
  frozen_profile jsonb,                   -- frozen at completion
  frozen_consent_id uuid references public.consent_records(id),
  updated_at timestamptz not null default now()
);

create table public.onboarding_answers (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  value jsonb not null default '{}'::jsonb,
  skipped boolean not null default false,
  is_private boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, category)
);

create table public.vibes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  taste_tags text[] not null default '{}',
  moment text,
  personal_context_scope text not null default 'taste_only',
  created_at timestamptz not null default now()
);

-- "references" is an SQL keyword, hence the prefix.
create table public.music_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  artist text,
  url text,                               -- stored only; never fetched by the server
  liked_attributes text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- playlists / generation
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('starter','library')),
  name text not null,
  released_at timestamptz,                -- the persisted release gate
  created_at timestamptz not null default now()
);
create unique index playlists_one_starter on public.playlists(owner_id) where kind = 'starter';

create table public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('starter_slot','create_new')),
  playlist_id uuid references public.playlists(id) on delete cascade,
  slot int check (slot between 1 and 5),
  idempotency_key text not null,
  provider_mode text not null check (provider_mode in ('demo','manual','official_api')),
  state text not null default 'queued' check (state in (
    'queued','preparing','awaiting_operator','submitted','processing','needs_review',
    'ready','failed','cancelled','unknown_submission')),
  brief jsonb,
  brief_version int not null default 0,
  title text,
  summary jsonb,                          -- what the listener entered (create new) — shown back to them
  variation_of uuid references public.generation_requests(id) on delete set null,
  quota_source text not null check (quota_source in ('starter_album','song')),
  error_code text,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);
create unique index generation_requests_slot on public.generation_requests(playlist_id, slot) where slot is not null;
create index on public.generation_requests(state, created_at);

create table public.generation_request_events (
  id bigserial primary key,
  request_id uuid not null references public.generation_requests(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor text not null,                    -- 'system' | 'worker' | 'operator:<uuid>' | 'user'
  note text,
  created_at timestamptz not null default now()
);

create table public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.generation_requests(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  attempt_no int not null,
  provider text not null,                 -- 'demo_fixture' | 'suno_manual' | 'operator_upload' | 'suno_api'
  provider_job_id text,
  submission_key text not null unique,    -- persisted per-attempt idempotency key
  state text not null default 'created' check (state in (
    'created','submitted','processing','succeeded','failed','unknown_submission','cancelled')),
  estimated_cost_credits numeric,
  actual_cost_credits numeric,
  monetary_cost_usd numeric,              -- null = unknown (never invented)
  monetary_cost_known boolean not null default false,
  error_code text,
  brief_version int not null default 0,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, attempt_no)
);
create unique index generation_attempts_job on public.generation_attempts(provider, provider_job_id) where provider_job_id is not null;

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.generation_requests(id) on delete set null,
  attempt_id uuid references public.generation_attempts(id) on delete set null,
  status text not null default 'candidate' check (status in ('candidate','approved','rejected','deleted')),
  title text not null,
  artist_label text not null default 'DJ Vibii',
  duration_seconds numeric,
  storage_key text,                       -- private storage object (playable in app)
  mime_type text,
  external_url text,                      -- external-only result (e.g. a Suno song page)
  external_service text,
  source text not null check (source in ('demo_fixture','suno_manual','operator_upload','suno_api')),
  is_demo_fixture boolean not null default false,
  rights_status text not null default 'unverified' check (rights_status in ('unverified','authorized','external_link_only','rejected')),
  provenance jsonb not null default '{}'::jsonb,
  moment text,
  energy text,
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (storage_key is not null or external_url is not null)
);
create index on public.tracks(owner_id, status);
create unique index tracks_one_approved_per_request on public.tracks(request_id) where status = 'approved';

create table public.covers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null references public.generation_requests(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','ready','failed')),
  kind text check (kind in ('local_illustration','provider')),
  art_brief jsonb not null,               -- abstracted scene only: no names, no portraits, no private text
  palette text[] not null default '{}',
  motif text,
  alt_text text,
  rights_source text,
  svg text,                               -- local illustration (non-personal, deterministic)
  storage_key text,
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  unique (request_id)
);

create table public.playlist_items (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.generation_requests(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  position int not null,
  primary key (playlist_id, position)
);

-- ---------------------------------------------------------------- listening & feedback
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  action text not null check (action in ('like','unlike','more_bass','less_lyrics','too_slow','not_my_taste')),
  created_at timestamptz not null default now()
);
create index on public.feedback(owner_id, track_id);

create table public.listening_events (
  id bigserial primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  session_id text not null,
  event_id text not null,
  event text not null check (event in ('playback_started','heartbeat','skip','ended','paused')),
  listened_seconds numeric not null default 0 check (listened_seconds >= 0 and listened_seconds <= 120),
  excluded boolean not null default false,   -- demo/admin accounts
  occurred_at timestamptz not null default now(),
  unique (owner_id, event_id)
);
create index on public.listening_events(track_id, occurred_at);

-- No story text or names: props are whitelisted server-side.
create table public.analytics_events (
  id bigserial primary key,
  owner_id uuid references public.profiles(id) on delete cascade,
  session_id text,
  event_id text not null,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  excluded boolean not null default false,
  occurred_at timestamptz not null default now(),
  unique (event_id)
);
create index on public.analytics_events(name, occurred_at);

-- ---------------------------------------------------------------- entitlements & ledger
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('starter_album','song')),
  source text not null check (source in ('onboarding','admin_test_grant','pilot_external_payment','subscription','credit_redemption')),
  quantity int not null check (quantity > 0),
  period text,
  grant_key text not null unique,
  note text,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Append-only. Unique event keys make every grant/reserve/consume/release happen once.
create table public.usage_ledger (
  id bigserial primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  unit text not null check (unit in ('starter_album','song','credit')),
  entry text not null check (entry in ('grant','reserve','consume','release','award','spend')),
  amount int not null check (amount > 0),
  request_id uuid references public.generation_requests(id) on delete set null,
  event_key text not null unique,
  note text,
  created_at timestamptz not null default now()
);
create index on public.usage_ledger(owner_id, unit);

create or replace function public.prevent_ledger_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('vibii.allow_owner_delete', true) = 'on' then
    return old;  -- account deletion only
  end if;
  raise exception 'usage_ledger is append-only';
end $$;
create trigger usage_ledger_append_only before update or delete on public.usage_ledger
  for each row execute function public.prevent_ledger_mutation();

-- ---------------------------------------------------------------- operations
create table public.provider_configuration (
  id int primary key default 1 check (id = 1),
  mode text not null default 'demo' check (mode in ('demo','manual','official_api')),
  official_api_available boolean not null default false,
  daily_call_cap int not null default 20,
  monthly_call_cap int not null default 200,
  max_concurrency int not null default 2,
  monetary_cost_known boolean not null default false,
  commercial_agreement_evidence text,     -- required before publishing provider output to non-operator accounts
  commercial_agreement_recorded_at timestamptz,
  commercial_agreement_recorded_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.provider_configuration (id) values (1);

create table public.job_queue (
  id bigserial primary key,
  kind text not null check (kind in ('audio','cover')),
  request_id uuid not null references public.generation_requests(id) on delete cascade,
  unique_key text not null unique,
  state text not null default 'pending' check (state in ('pending','running','done','failed','cancelled')),
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 4,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_queue_due on public.job_queue(state, run_after);

create table public.audit_events (
  id bigserial primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.deletion_jobs (
  id bigserial primary key,
  storage_key text not null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.consent_records enable row level security;
alter table public.onboarding_state enable row level security;
alter table public.onboarding_answers enable row level security;
alter table public.vibes enable row level security;
alter table public.music_references enable row level security;
alter table public.playlists enable row level security;
alter table public.generation_requests enable row level security;
alter table public.generation_request_events enable row level security;
alter table public.generation_attempts enable row level security;
alter table public.tracks enable row level security;
alter table public.covers enable row level security;
alter table public.playlist_items enable row level security;
alter table public.feedback enable row level security;
alter table public.listening_events enable row level security;
alter table public.analytics_events enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.provider_configuration enable row level security;
alter table public.job_queue enable row level security;
alter table public.audit_events enable row level security;
alter table public.grant_identities enable row level security;
alter table public.deletion_jobs enable row level security;
alter table public.rate_limits enable row level security;

create policy own_profile_select on public.profiles for select to authenticated using (id = auth.uid());
create policy own_profile_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Owner read access for user data. Writes go through the server (privileged connection) after authorization,
-- except the few self-service writes granted below.
do $$
declare t text;
begin
  foreach t in array array['consent_records','onboarding_answers','vibes','music_references','playlists',
    'generation_requests','generation_request_events','tracks','covers','playlist_items','feedback',
    'listening_events','entitlements','usage_ledger']
  loop
    execute format('create policy own_select on public.%I for select to authenticated using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Candidate/rejected tracks stay private to operators until approved.
drop policy own_select on public.tracks;
create policy own_select on public.tracks for select to authenticated
  using (owner_id = auth.uid() and status = 'approved');
-- Draft plan is not readable by the listener through RLS (only completed flag via a view).
create policy own_select on public.onboarding_state for select to authenticated using (owner_id = auth.uid());

create policy own_write on public.onboarding_answers for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_insert on public.feedback for insert to authenticated with check (owner_id = auth.uid());
create policy own_insert on public.vibes for insert to authenticated with check (owner_id = auth.uid());
create policy own_insert on public.music_references for insert to authenticated with check (owner_id = auth.uid());

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.provider_configuration, public.job_queue, public.audit_events,
  public.grant_identities, public.deletion_jobs, public.rate_limits, public.generation_attempts from authenticated;
-- Column-level: the private draft plan and frozen profile are never readable by the listener.
revoke select on public.onboarding_state from authenticated;
grant select (owner_id, started_at, completed_at, current_step, profile_version, updated_at) on public.onboarding_state to authenticated;
grant insert, update, delete on public.onboarding_answers to authenticated;
grant insert on public.feedback, public.vibes, public.music_references to authenticated;
grant update (display_name, ui_language, song_languages, last_tab, last_vibe, last_track_id, last_position_seconds)
  on public.profiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;

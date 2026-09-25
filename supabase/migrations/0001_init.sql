-- 0001_init.sql
-- Randomster core schema. Run in order against a Supabase Postgres project.

create extension if not exists citext;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- =========================================================
-- profiles
-- =========================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique,
  username_changed_at timestamptz,
  country_code char(2) not null default 'US',
  match_scope text not null default 'SAME_COUNTRY'
    check (match_scope in ('SAME_COUNTRY', 'ALL_COUNTRIES', 'REGION')),

  -- Age / identity verification (stub — wire to a real vendor before launch).
  -- 'unverified': only self-attested 18+ checkbox at signup.
  -- 'pending':    verification session created with vendor, awaiting result.
  -- 'verified':   vendor confirmed 18+.
  -- 'rejected':   vendor confirmed under 18 or verification failed -> must be banned/blocked from matching.
  age_verification_status text not null default 'unverified'
    check (age_verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  age_verified_at timestamptz,
  age_verification_provider text, -- e.g. 'persona', 'veriff'
  age_verification_ref text,      -- vendor session id, never store raw ID documents here

  is_banned boolean not null default false,
  ban_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_country_code on profiles(country_code);

-- =========================================================
-- matches
-- =========================================================
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz, -- messages purge horizon = ended_at + 1h

  -- Moderation stub: set true if either party's stream triggered a CSAM/nudity
  -- classifier hit during the call (see moderation_events). Used to fast-path
  -- review and to suppress "rematch" of either participant pending review.
  flagged boolean not null default false,

  constraint different_users check (user_a <> user_b)
);

create index if not exists idx_matches_status on matches(status);
create index if not exists idx_matches_expires_at on matches(expires_at);

-- =========================================================
-- messages
-- =========================================================
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text not null check (char_length(content) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour')
);

create index if not exists idx_messages_match_id on messages(match_id);
create index if not exists idx_messages_expires_at on messages(expires_at);

-- =========================================================
-- blocks
-- =========================================================
create table if not exists blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- =========================================================
-- reports
-- =========================================================
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete set null,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_id uuid not null references profiles(id) on delete cascade,
  reason text not null check (reason in (
    'nudity_sexual_content', 'minor_suspected', 'harassment', 'spam',
    'violence_threats', 'csam_suspected', 'other'
  )),
  details text,
  created_at timestamptz not null default now(),
  reviewed boolean not null default false,
  reviewed_at timestamptz
);

create index if not exists idx_reports_reported_id on reports(reported_id);
create index if not exists idx_reports_reviewed on reports(reviewed);

-- =========================================================
-- moderation_events (stub for CSAM / nudity classifier hits)
-- =========================================================
-- Populated by a server-side webhook from your video moderation vendor
-- (e.g. Cloudflare Stream CSAM scanning, Hive, or Thorn Safer). Never store
-- raw frames/video here — store only classifier metadata and references.
create table if not exists moderation_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete set null,
  subject_user_id uuid references profiles(id) on delete set null,
  source text not null, -- 'cloudflare_stream_csam', 'hive_nudity', 'thorn_safer', etc.
  category text not null check (category in ('csam', 'nudity', 'sexual_content', 'other')),
  confidence numeric,
  vendor_ref text,
  action_taken text check (action_taken in (
    'none', 'call_terminated', 'account_suspended', 'reported_to_ncmec', 'reported_to_law_enforcement'
  )),
  created_at timestamptz not null default now()
);

create index if not exists idx_moderation_events_subject on moderation_events(subject_user_id);

-- =========================================================
-- ip_bans / user_bans
-- =========================================================
create table if not exists bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  ip_hash text, -- store a salted hash of the IP, never the raw IP
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz -- null = permanent
);

create index if not exists idx_bans_user_id on bans(user_id);
create index if not exists idx_bans_ip_hash on bans(ip_hash);

-- =========================================================
-- match_queue (atomic pairing via FOR UPDATE SKIP LOCKED)
-- =========================================================
create table if not exists match_queue (
  user_id uuid primary key references profiles(id) on delete cascade,
  match_scope text not null,
  country_code char(2) not null,
  joined_at timestamptz not null default now()
);

-- =========================================================
-- updated_at trigger
-- =========================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- =========================================================
-- cron: purge expired messages + stale matches every 5 minutes
-- =========================================================
select cron.schedule(
  'purge_expired_messages',
  '*/5 * * * *',
  $$ delete from messages where expires_at < now(); $$
);

select cron.schedule(
  'purge_stale_queue_entries',
  '*/5 * * * *',
  $$ delete from match_queue where joined_at < now() - interval '2 minutes'; $$
);

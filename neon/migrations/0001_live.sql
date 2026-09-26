-- 0001_live.sql
-- Live-stream data, stored in Neon Postgres (kept separate from Supabase,
-- which stays the source of truth for accounts/profiles/matches).
--
-- Everything in here is EPHEMERAL: rows belonging to a live session are
-- deleted once that session ends (see apps/api/src/routes/live.ts `/end`).
-- The only things that outlive a session are:
--   - the reaction total, folded into the broadcaster's Supabase
--     profiles.total_likes (+1 total_lives) right before the Neon rows are
--     deleted
--   - reports, which are written straight into Supabase's existing
--     `reports` table (not stored here at all) so moderators can still see
--     them after the stream is long gone.
--
-- Run this against your Neon project (`psql "$NEON_DATABASE_URL" -f
-- neon/migrations/0001_live.sql`), separately from the Supabase migrations
-- in supabase/migrations.

create extension if not exists pgcrypto;

-- =========================================================
-- live_sessions
-- =========================================================
-- One row per active (or just-ended, briefly) live stream. broadcaster_id /
-- partner_id are Supabase auth.users ids, but this DB has no FK relationship
-- to Supabase -- it's a separate Postgres instance -- so they're plain uuid
-- columns. Usernames are denormalized at creation time so the feed and
-- viewer UI never need a cross-database join just to render a name.
create table if not exists live_sessions (
  id uuid primary key default gen_random_uuid(),

  match_id uuid not null,               -- the underlying Randomster match (Supabase `matches.id`)
  broadcaster_id uuid not null,
  broadcaster_username text not null,
  partner_id uuid,                      -- the random stranger the broadcaster is paired with, once matched
  partner_username text,

  status text not null default 'active' check (status in ('active', 'ended')),
  reaction_count integer not null default 0,

  started_at timestamptz not null default now(),
  ended_at timestamptz,

  -- The broadcaster's client pings `/api/live/:id/state` every few seconds
  -- while live. If this goes stale (tab closed, crash, network loss) the
  -- session is treated as abandoned and auto-closed by the feed/read paths
  -- instead of sitting active forever — there's no external cron on this
  -- database, so cleanup piggybacks on normal traffic.
  last_heartbeat_at timestamptz not null default now()
);

create index if not exists idx_live_sessions_status on live_sessions(status);
create index if not exists idx_live_sessions_started_at on live_sessions(started_at desc);
-- A broadcaster can only have one active live session at a time.
create unique index if not exists idx_live_sessions_one_active_per_broadcaster
  on live_sessions(broadcaster_id) where status = 'active';

-- =========================================================
-- live_viewers
-- =========================================================
-- Presence table. Rows are upserted on join / heartbeat and deleted on
-- leave (or swept out with the rest of the session on `/end`).
create table if not exists live_viewers (
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null,
  username text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists idx_live_viewers_session on live_viewers(session_id);

-- =========================================================
-- live_comments
-- =========================================================
create table if not exists live_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null,
  username text not null,
  text text not null check (char_length(text) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists idx_live_comments_session_created on live_comments(session_id, created_at);

-- =========================================================
-- live_reports
-- =========================================================
-- Reports filed against a live stream. Deliberately has NO foreign key /
-- cascade back to live_sessions: it must survive the session row being
-- deleted when the stream ends, since moderators still need to review it
-- afterward. This is the one live-data table that is NOT wiped on `/end`.
-- broadcaster_id / reporter_id are Supabase auth.users ids (same
-- cross-database reference pattern as live_sessions above).
create table if not exists live_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  match_id uuid not null,
  broadcaster_id uuid not null,
  reporter_id uuid not null,
  reason text not null,
  details text,
  created_at timestamptz not null default now(),
  reviewed boolean not null default false
);

create index if not exists idx_live_reports_broadcaster on live_reports(broadcaster_id);
create index if not exists idx_live_reports_reviewed on live_reports(reviewed) where reviewed = false;

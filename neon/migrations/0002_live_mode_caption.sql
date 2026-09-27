-- 0002_live_mode_caption.sql
--
-- apps/api/src/routes/live.ts reads/writes `mode` and `caption` on every
-- live_sessions row (POST /start inserts them, PATCH /caption updates
-- `caption`, GET /feed, /join and /state all select them) but 0001_live.sql
-- never created either column, so every one of those queries fails against
-- a database that only ran 0001 — "Go Live" (solo or random), viewing a
-- caption, and editing a caption while live were all broken at the schema
-- level, no matter what the frontend did.
--
-- Run this against your Neon project after 0001_live.sql:
--   psql "$NEON_DATABASE_URL" -f neon/migrations/0002_live_mode_caption.sql

alter table live_sessions
  add column if not exists mode text not null default 'random' check (mode in ('random', 'solo')),
  add column if not exists caption text check (char_length(caption) <= 200);

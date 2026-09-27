-- 0003_live_match_id_nullable.sql
--
-- POST /api/live/start in "solo" mode inserts a live_sessions row with
-- match_id left NULL (solo streams have no match at all — see the comment
-- on live_sessions.match_id in 0001_live.sql, which documents it as
-- nullable). The database actually deployed in production still has a
-- NOT NULL constraint on that column, so every solo go-live crashed the
-- request with a `23502 null value in column "match_id"` error, taking the
-- whole /api/live/start call down (and with it comments, viewers,
-- everything downstream — nothing about live could work once this failed).
--
-- `DROP NOT NULL` is idempotent — if a database already has match_id
-- nullable (e.g. one that only ever ran 0001_live.sql as written), this is
-- a harmless no-op there too.
--
-- Run this against your Neon project after 0001_live.sql and
-- 0002_live_mode_caption.sql:
--   psql "$NEON_DATABASE_URL" -f neon/migrations/0003_live_match_id_nullable.sql

-- Same defensive fix for partner_id / partner_username: solo mode also
-- leaves these NULL (no stranger), so if production's schema has them
-- NOT NULL too, this heads that off before it surfaces as the exact same
-- crash on the next request.
alter table live_sessions alter column match_id drop not null;
alter table live_sessions alter column partner_id drop not null;
alter table live_sessions alter column partner_username drop not null;

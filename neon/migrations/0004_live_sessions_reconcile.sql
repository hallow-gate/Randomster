-- 0004_live_sessions_reconcile.sql
--
-- Root cause of the "comments toggle does nothing, and defaults to off"
-- bug: production's live_sessions table has NO comments_enabled column at
-- all — every query that read or wrote it failed with
-- `column "comments_enabled" of relation "live_sessions" does not exist`.
--
-- That happened even though 0001_live.sql's CREATE TABLE text includes
-- comments_enabled, because `create table if not exists` is a no-op on a
-- table that already exists — it does NOT add new columns to it. This
-- production database's live_sessions table was evidently created from an
-- earlier version of that file, before comments_enabled (and, per
-- 0002/0003, before mode/caption and before match_id was nullable) existed
-- — so every later addition to the CREATE TABLE text in 0001_live.sql
-- silently never applied here.
--
-- This migration is idempotent and safe to run on any database, however
-- much of 0002/0003 it has or hasn't already run: every column is added
-- with `if not exists`, so already-correct columns are untouched.
--
-- Run this against your Neon project after 0001-0003:
--   psql "$NEON_DATABASE_URL" -f neon/migrations/0004_live_sessions_reconcile.sql

alter table live_sessions
  add column if not exists mode text not null default 'random' check (mode in ('random', 'solo')),
  add column if not exists caption text check (char_length(caption) <= 200),
  add column if not exists comments_enabled boolean not null default true;

alter table live_sessions alter column match_id drop not null;
alter table live_sessions alter column partner_id drop not null;
alter table live_sessions alter column partner_username drop not null;

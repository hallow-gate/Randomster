-- 0007_live_stats.sql
-- Adds the permanent, cross-session stats that live streaming feeds back
-- into a user's profile. The live streams themselves (comments, per-viewer
-- reaction events, viewer presence) live in Neon and are deleted when a
-- stream ends -- only these running totals persist here.

alter table profiles
  add column if not exists total_likes bigint not null default 0,
  add column if not exists total_lives bigint not null default 0,
  add column if not exists is_live boolean not null default false;

create index if not exists idx_profiles_is_live on profiles(is_live) where is_live = true;

-- Re-create the public view to also expose the stats + live flag needed for
-- the profile "stalk view" page and the red live-ring indicator. Still no
-- raw ban/age-verification/etc. columns exposed.
create or replace view profiles_public as
  select id, username, country_code, total_likes, total_lives, is_live
  from profiles
  where is_banned = false and age_verification_status <> 'rejected';

grant select on profiles_public to authenticated;

-- Called once, server-side (service_role only -- never exposed to clients),
-- when a live session ends: folds that session's Neon reaction_count into
-- the broadcaster's running total, bumps total_lives, and clears is_live.
-- Atomic single-statement update avoids a read-then-write race with
-- anything else touching this profile concurrently.
create or replace function increment_live_stats(p_user_id uuid, p_likes bigint)
returns void as $$
  update profiles
  set total_likes = total_likes + greatest(p_likes, 0),
      total_lives = total_lives + 1,
      is_live = false
  where id = p_user_id;
$$ language sql;

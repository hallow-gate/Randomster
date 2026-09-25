-- 0005_handle_new_user.sql
-- Auto-create a `profiles` row whenever a new auth.users row is created
-- (email/password signup, Google OAuth, etc). Without this, the client's
-- first `profiles` select after login returns 0 rows, and since the client
-- uses `.single()`, PostgREST responds 406 Not Acceptable.
--
-- Table defaults (country_code='US', match_scope='SAME_COUNTRY',
-- age_verification_status='unverified') cover every NOT NULL column other
-- than id, so nothing else needs to be supplied here.

create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill: create profiles for any existing auth.users that don't have one
-- yet (e.g. users who signed up before this migration ran).
insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

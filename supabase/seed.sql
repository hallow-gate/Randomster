-- seed.sql — local/dev only. Do NOT run against production.
-- Creates fake auth users + profiles across a few countries so matchmaking
-- can be exercised locally. Requires supabase CLI (`supabase db reset` runs
-- this automatically if placed at supabase/seed.sql).

do $$
declare
  v_ids uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
  ];
  v_usernames text[] := array['neon_fox', 'acid_koala', 'lime_drift', 'cyan_static', 'ph_wanderer', 'magenta_owl'];
  v_countries char(2)[] := array['US', 'US', 'GB', 'DE', 'PH', 'PH'];
  i int;
begin
  for i in 1..array_length(v_ids, 1) loop
    insert into auth.users (id, email, email_confirmed_at, created_at)
    values (v_ids[i], format('seed_user_%s@example.test', i), now(), now())
    on conflict do nothing;

    insert into profiles (id, username, country_code, match_scope, age_verification_status, age_verified_at)
    values (v_ids[i], v_usernames[i], v_countries[i], 'SAME_COUNTRY', 'verified', now())
    on conflict (id) do nothing;
  end loop;
end $$;

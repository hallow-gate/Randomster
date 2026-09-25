-- 0003_try_match_fn.sql
-- Atomic matchmaking. Called via supabaseAdmin.rpc('try_match', ...) from the
-- backend only (never directly from the client). SECURITY DEFINER so it can
-- bypass RLS to manage the shared queue table safely.

create or replace function try_match(
  p_user_id uuid,
  p_scope text,
  p_country_code char(2)
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
  v_match_id uuid;
begin
  -- Remove any stale queue entry for this user first (idempotent re-join).
  delete from match_queue where user_id = p_user_id;

  -- Look for a compatible waiting partner, respecting scope, blocks, and
  -- excluding anyone currently banned or under moderation review.
  select q.user_id into v_partner_id
  from match_queue q
  join profiles p on p.id = q.user_id
  where q.user_id <> p_user_id
    and p.is_banned = false
    and p.age_verification_status <> 'rejected'
    and (
      p_scope = 'ALL_COUNTRIES'
      or q.country_code = p_country_code
    )
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = p_user_id and b.blocked_id = q.user_id)
         or (b.blocker_id = q.user_id and b.blocked_id = p_user_id)
    )
  order by q.joined_at asc
  for update of q skip locked
  limit 1;

  if v_partner_id is not null then
    delete from match_queue where user_id = v_partner_id;
    delete from match_queue where user_id = p_user_id;

    insert into matches (user_a, user_b, status)
    values (p_user_id, v_partner_id, 'active')
    returning id into v_match_id;

    return jsonb_build_object('status', 'matched', 'matchId', v_match_id, 'partnerId', v_partner_id);
  else
    insert into match_queue (user_id, match_scope, country_code)
    values (p_user_id, p_scope, p_country_code)
    on conflict (user_id) do update set match_scope = excluded.match_scope, joined_at = now();

    return jsonb_build_object('status', 'queued');
  end if;
end;
$$;

revoke all on function try_match(uuid, text, char) from public;
grant execute on function try_match(uuid, text, char) to service_role;

-- 0002_rls.sql
-- Row Level Security. Every table locked down; service_role bypasses RLS
-- automatically and is only ever used from the backend, never the client.

alter table profiles enable row level security;
alter table matches enable row level security;
alter table messages enable row level security;
alter table blocks enable row level security;
alter table reports enable row level security;
alter table moderation_events enable row level security;
alter table bans enable row level security;
alter table match_queue enable row level security;

-- ---------- profiles ----------
-- Anyone authenticated can read minimal public profile info (username, country,
-- flag) of anyone -- needed to render the matched stranger's identity. Full row
-- read still restricted; app should select only public-safe columns client-side
-- via a view (see profiles_public below) rather than relying on column-level trust.
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_insert_own"
  on profiles for insert
  with check (auth.uid() = id);

-- Public-safe view: only what a matched stranger should see.
create or replace view profiles_public as
  select id, username, country_code
  from profiles
  where is_banned = false and age_verification_status <> 'rejected';

grant select on profiles_public to authenticated;

-- ---------- matches ----------
create policy "matches_select_participant"
  on matches for select
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Inserts/updates to matches happen via backend using service_role only.
-- No client-side insert/update policy is granted.

-- ---------- messages ----------
create policy "messages_select_participant_not_expired"
  on messages for select
  using (
    expires_at > now()
    and exists (
      select 1 from matches m
      where m.id = messages.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

create policy "messages_insert_participant"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from matches m
      where m.id = messages.match_id
        and m.status = 'active'
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- ---------- blocks ----------
create policy "blocks_select_own"
  on blocks for select
  using (auth.uid() = blocker_id);

create policy "blocks_insert_own"
  on blocks for insert
  with check (auth.uid() = blocker_id);

create policy "blocks_delete_own"
  on blocks for delete
  using (auth.uid() = blocker_id);

-- ---------- reports ----------
create policy "reports_insert_own"
  on reports for insert
  with check (auth.uid() = reporter_id);

create policy "reports_select_own"
  on reports for select
  using (auth.uid() = reporter_id);

-- No update/delete policy for clients -- only moderators via service_role.

-- ---------- moderation_events ----------
-- No client access at all. Backend/service_role only (webhook consumer).

-- ---------- bans ----------
-- No client access at all.

-- ---------- match_queue ----------
create policy "queue_select_own"
  on match_queue for select
  using (auth.uid() = user_id);

-- Inserts/deletes to the queue happen via backend (service_role) inside the
-- atomic pairing transaction, not directly from the client.

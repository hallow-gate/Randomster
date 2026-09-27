-- 0005_live_comments_seq.sql
--
-- Fixes the comment poller re-delivering the same comment forever.
--
-- GET /api/live/:id/state used `created_at > $after` as its "give me
-- what's new since I last checked" cursor, with `$after` being the
-- created_at of the last comment the client already has. `created_at` is
-- `timestamptz`, which Postgres stores with microsecond precision. The
-- `pg` driver parses it into a JS `Date`, which only has millisecond
-- precision, and `res.json()` serializes that `Date` with
-- `toISOString()` -- so the value that actually leaves the server has
-- already lost whatever sub-millisecond precision the row had.
--
-- When the client echoed that truncated string back as `after` on its
-- next poll, the comparison became "is this row's real (microsecond)
-- created_at greater than a rounded-down version of itself?" -- which is
-- true. So the newest comment matched `created_at > after` again on
-- every subsequent poll, forever, getting appended to the comment list
-- each time: one comment, sent once, flooding the feed.
--
-- A `timestamptz` cursor can't fix this reliably (rounding a column to
-- millisecond precision would just trade the bug for silently dropping a
-- second comment that lands in the same millisecond). A plain,
-- monotonically increasing integer has neither problem: no precision to
-- lose in JSON, and no two rows can ever tie.
alter table live_comments add column if not exists seq bigserial;

create index if not exists idx_live_comments_session_seq on live_comments(session_id, seq);

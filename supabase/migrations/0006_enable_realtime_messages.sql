-- 0006_enable_realtime_messages.sql
-- The `messages` table was never added to the `supabase_realtime` publication,
-- so ChatPanel's `postgres_changes` subscription (INSERT on `messages`) never
-- fired for either participant -- sent messages appeared to vanish for both
-- sender and receiver, even though the row was inserted correctly server-side.

alter publication supabase_realtime add table messages;

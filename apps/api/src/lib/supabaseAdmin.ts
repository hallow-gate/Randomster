import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// service_role key lives ONLY here, on the backend. It must never be sent to,
// bundled into, or logged from any frontend code.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

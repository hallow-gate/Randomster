import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Only the anon/public key ever ships to the browser. service_role stays
// backend-only (apps/api/src/lib/supabaseAdmin.ts).
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string;

import pg from "pg";
import { env } from "./env.js";
import { logger } from "./logger.js";

const { Pool } = pg;

// Separate Postgres instance from Supabase — holds only the ephemeral
// live-stream tables (live_sessions / live_viewers / live_comments). Never
// point this at Supabase, and never put account/profile/match data here.
export const neonPool = new Pool({
  connectionString: env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,
});

neonPool.on("error", (err) => {
  // A background/idle client erroring out shouldn't crash the whole API
  // process — log it and let the pool recycle the connection.
  logger.error({ err: err.message }, "neon_pool_idle_error");
});

export async function neonQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await neonPool.query(text, params);
  return result.rows as T[];
}

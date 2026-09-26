import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(20),

  // Separate Neon Postgres project. Holds ONLY ephemeral live-stream data
  // (live_sessions / live_viewers / live_comments — see neon/migrations).
  // Never used for accounts, matches, or anything Supabase already owns.
  NEON_DATABASE_URL: z.string().min(1),

  ALLOWED_ORIGINS: z.string().min(1), // comma-separated

  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_CALLS_APP_ID: z.string().min(1),
  CLOUDFLARE_CALLS_APP_SECRET: z.string().min(1),
  CLOUDFLARE_TURN_KEY_ID: z.string().min(1),
  CLOUDFLARE_TURN_API_TOKEN: z.string().min(1),

  // Moderation vendor stub — see moderation.ts
  MODERATION_WEBHOOK_SECRET: z.string().min(16),
  NCMEC_REPORTING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  IP_HASH_SALT: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast and loud at boot — never start with a misconfigured env.
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { containsProfanity } from "../lib/profanity.js";
import { logger } from "../lib/logger.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

const usernameSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, "alphanumeric and underscore only"),
});

profileRouter.post("/username", authLimiter, validateBody(usernameSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { username } = req.body as z.infer<typeof usernameSchema>;

  if (containsProfanity(username)) {
    return res.status(400).json({ error: "username_not_allowed" });
  }

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("username, username_changed_at")
    .eq("id", userId)
    .single();

  if (existing?.username_changed_at) {
    const changedAt = new Date(existing.username_changed_at);
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - changedAt.getTime() < cooldownMs) {
      return res.status(429).json({ error: "username_change_cooldown" });
    }
  }

  // Case-insensitive uniqueness enforced by `citext` column type + unique
  // index in the schema; catch the resulting constraint violation cleanly.
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ username, username_changed_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "username_taken" });
    }
    logger.error({ err: error.message }, "username_update_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  res.json({ status: "ok", username });
});

const countrySchema = z.object({
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/),
});

profileRouter.post("/country", validateBody(countrySchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { countryCode } = req.body as z.infer<typeof countrySchema>;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ country_code: countryCode })
    .eq("id", userId);

  if (error) return res.status(500).json({ error: "internal_error" });
  res.json({ status: "ok", countryCode });
});

const scopeSchema = z.object({
  scope: z.enum(["SAME_COUNTRY", "ALL_COUNTRIES", "REGION"]),
});

profileRouter.post("/scope", validateBody(scopeSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { scope } = req.body as z.infer<typeof scopeSchema>;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ match_scope: scope })
    .eq("id", userId);

  if (error) return res.status(500).json({ error: "internal_error" });
  res.json({ status: "ok", scope });
});

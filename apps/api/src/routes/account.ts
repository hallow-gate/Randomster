import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { logger } from "../lib/logger.js";

export const accountRouter = Router();
accountRouter.use(requireAuth);

/** GDPR data export: everything tied to the user, excluding others' data. */
accountRouter.get("/export", authLimiter, async (req: AuthedRequest, res) => {
  const userId = req.userId!;

  const [profile, matches, messages, reportsFiled, blocks] = await Promise.all([
    supabaseAdmin.from("profiles").select("*").eq("id", userId).single(),
    supabaseAdmin.from("matches").select("*").or(`user_a.eq.${userId},user_b.eq.${userId}`),
    supabaseAdmin.from("messages").select("*").eq("sender_id", userId),
    supabaseAdmin.from("reports").select("*").eq("reporter_id", userId),
    supabaseAdmin.from("blocks").select("*").eq("blocker_id", userId),
  ]);

  res.json({
    profile: profile.data,
    matches: matches.data ?? [],
    messagesSent: messages.data ?? [],
    reportsFiled: reportsFiled.data ?? [],
    blocks: blocks.data ?? [],
    exportedAt: new Date().toISOString(),
  });
});

/** GDPR delete: removes the auth user, cascading to profile/matches/etc. */
accountRouter.delete("/", authLimiter, async (req: AuthedRequest, res) => {
  const userId = req.userId!;

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    logger.error({ err: error.message, userId }, "account_delete_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  // profiles/matches/messages/blocks/reports all cascade via FK on auth.users
  // delete (see schema `on delete cascade`), except reports.reported_id and
  // moderation_events, which are retained for trust & safety history.
  res.json({ status: "deleted" });
});

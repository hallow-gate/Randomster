import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNotBanned } from "../middleware/banGate.js";
import { matchActionLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { logger } from "../lib/logger.js";
import { notifyUserMatched, notifyCallEnded } from "../lib/realtime.js";

export const matchRouter = Router();
matchRouter.use(requireAuth, requireNotBanned, matchActionLimiter);

const joinSchema = z.object({
  scope: z.enum(["SAME_COUNTRY", "ALL_COUNTRIES", "REGION"]),
});

/**
 * Atomic pairing using SELECT ... FOR UPDATE SKIP LOCKED via a Postgres
 * function (see supabase/migrations for the `try_match` SQL function this
 * calls through rpc). This avoids two concurrent requests double-matching
 * the same user, without needing an external lock service.
 */
matchRouter.post("/join", validateBody(joinSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { scope } = req.body as z.infer<typeof joinSchema>;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("country_code")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    return res.status(404).json({ error: "profile_not_found" });
  }

  // Never match users who have blocked each other, or who are still flagged
  // from a moderation event pending review — enforced inside try_match().
  const { data, error } = await supabaseAdmin.rpc("try_match", {
    p_user_id: userId,
    p_scope: scope,
    p_country_code: profile.country_code,
  });

  if (error) {
    logger.error({ err: error.message, userId }, "match_join_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  // try_match returns either { status: 'queued' } or { status: 'matched', matchId, partnerId }.
  // The joiner (this request) learns the result synchronously in this response.
  // The *partner*, who was already sitting in the queue, doesn't know yet —
  // push them a Realtime notification so their client can transition out of
  // the "queued" state without polling.
  if (data?.status === "matched" && data.partnerId) {
    notifyUserMatched(data.partnerId, data.matchId, userId).catch((err) =>
      logger.error({ err: (err as Error).message }, "notify_user_matched_failed")
    );
  }

  res.json(data);
});

const skipSchema = z.object({ matchId: z.string().uuid() });

matchRouter.post("/skip", validateBody(skipSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { matchId } = req.body as z.infer<typeof skipSchema>;

  const { data: match, error: fetchErr } = await supabaseAdmin
    .from("matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .single();

  if (fetchErr || !match) return res.status(404).json({ error: "match_not_found" });
  if (match.user_a !== userId && match.user_b !== userId) {
    return res.status(403).json({ error: "not_a_participant" });
  }
  if (match.status !== "active") {
    return res.json({ status: "already_ended" });
  }

  const endedAt = new Date();
  const expiresAt = new Date(endedAt.getTime() + 60 * 60 * 1000); // +1h TTL for messages

  const { error: updateErr } = await supabaseAdmin
    .from("matches")
    .update({ status: "ended", ended_at: endedAt.toISOString(), expires_at: expiresAt.toISOString() })
    .eq("id", matchId);

  if (updateErr) {
    logger.error({ err: updateErr.message }, "match_skip_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  await supabaseAdmin.from("messages").update({ expires_at: expiresAt.toISOString() }).eq("match_id", matchId);

  await notifyCallEnded(matchId, "skip");

  res.json({ status: "ended" });
});

const reportSchema = z.object({
  matchId: z.string().uuid().optional(),
  reportedId: z.string().uuid(),
  reason: z.enum([
    "nudity_sexual_content",
    "minor_suspected",
    "harassment",
    "spam",
    "violence_threats",
    "csam_suspected",
    "other",
  ]),
  details: z.string().max(1000).optional(),
});

matchRouter.post("/report", validateBody(reportSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { matchId, reportedId, reason, details } = req.body as z.infer<typeof reportSchema>;

  const { error } = await supabaseAdmin.from("reports").insert({
    match_id: matchId ?? null,
    reporter_id: userId,
    reported_id: reportedId,
    reason,
    details,
  });

  if (error) {
    logger.error({ err: error.message }, "report_insert_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  // minor_suspected / csam_suspected reports should page a human moderator
  // immediately, not wait for a review queue sweep.
  if (reason === "minor_suspected" || reason === "csam_suspected") {
    logger.error({ reportedId, matchId }, "HIGH_PRIORITY_REPORT");
    // TODO: wire to on-call/PagerDuty + auto-suspend pending review.
    await supabaseAdmin
      .from("profiles")
      .update({ is_banned: true, ban_reason: `pending_review:${reason}` })
      .eq("id", reportedId);

    if (matchId) await notifyCallEnded(matchId, "report");
  }

  res.json({ status: "reported" });
});

const blockSchema = z.object({ blockedId: z.string().uuid(), matchId: z.string().uuid().optional() });

matchRouter.post("/block", validateBody(blockSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { blockedId, matchId } = req.body as z.infer<typeof blockSchema>;

  const { error: blockErr } = await supabaseAdmin
    .from("blocks")
    .upsert({ blocker_id: userId, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id" });

  if (blockErr) {
    logger.error({ err: blockErr.message }, "block_insert_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  if (matchId) {
    const endedAt = new Date();
    const expiresAt = new Date(endedAt.getTime() + 60 * 60 * 1000);
    await supabaseAdmin
      .from("matches")
      .update({ status: "ended", ended_at: endedAt.toISOString(), expires_at: expiresAt.toISOString() })
      .eq("id", matchId);

    await notifyCallEnded(matchId, "block");
  }

  res.json({ status: "blocked" });
});

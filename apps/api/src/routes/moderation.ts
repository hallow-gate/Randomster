import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../lib/env.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { logger } from "../lib/logger.js";
import { notifyCallEnded } from "../lib/realtime.js";

/**
 * STUB — wire this to a real video moderation vendor before launch.
 *
 * This endpoint is NOT for the client. It's a server-to-server webhook that
 * your video moderation vendor calls when its classifier flags a live frame
 * from an active call. Two production-ready options:
 *
 *   1. Cloudflare Stream's built-in CSAM scanning (if using Cloudflare Stream
 *      for the media path) — https://developers.cloudflare.com/stream/
 *      This can be paired with Cloudflare's CSAM Scanning Tool for hashed
 *      matching against known CSAM (NCMEC/PhotoDNA-style hash lists).
 *   2. A perceptual classifier for *novel* content (not just known-hash
 *      matches) via Hive Moderation or Thorn's Safer API, sampling frames
 *      from the WebRTC/SFU stream server-side.
 *
 * On a CSAM-category hit:
 *   - Immediately terminate the call (do not wait for human review)
 *   - Suspend the subject account pending review
 *   - If NCMEC_REPORTING_ENABLED, route to your NCMEC CyberTipline reporting
 *     pipeline (US legal requirement for US-based electronic service
 *     providers — implement per NCMEC's ESP reporting API, not shown here;
 *     this is a compliance-critical integration, get legal counsel involved)
 *
 * On a nudity/sexual-content (non-CSAM) hit:
 *   - Terminate the call, log a moderation_event, leave account action to
 *     manual review / your strikes policy.
 *
 * Never persist raw video frames — only classifier metadata.
 */

const webhookSchema = z.object({
  matchId: z.string().uuid(),
  subjectUserId: z.string().uuid(),
  source: z.string().min(1),
  category: z.enum(["csam", "nudity", "sexual_content", "other"]),
  confidence: z.number().min(0).max(1).optional(),
  vendorRef: z.string().optional(),
});

export const moderationRouter = Router();

function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", env.MODERATION_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

moderationRouter.post("/webhook", async (req, res) => {
  // Assumes an upstream raw-body capture middleware sets req.rawBody;
  // wire this per your chosen vendor's signing scheme.
  const signature = req.headers["x-moderation-signature"] as string | undefined;
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("moderation_webhook_bad_signature");
    return res.status(401).json({ error: "invalid_signature" });
  }

  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload" });
  }
  const { matchId, subjectUserId, source, category, confidence, vendorRef } = parsed.data;

  const actionTaken = category === "csam" ? "call_terminated" : "call_terminated";

  await supabaseAdmin.from("moderation_events").insert({
    match_id: matchId,
    subject_user_id: subjectUserId,
    source,
    category,
    confidence,
    vendor_ref: vendorRef,
    action_taken: actionTaken,
  });

  await supabaseAdmin
    .from("matches")
    .update({ status: "ended", ended_at: new Date().toISOString(), flagged: true })
    .eq("id", matchId);

  await notifyCallEnded(matchId, "moderation");

  if (category === "csam") {
    await supabaseAdmin
      .from("profiles")
      .update({ is_banned: true, ban_reason: "csam_classifier_hit_pending_review" })
      .eq("id", subjectUserId);

    logger.error({ matchId, subjectUserId }, "CSAM_CLASSIFIER_HIT");

    if (env.NCMEC_REPORTING_ENABLED) {
      // TODO: integrate NCMEC CyberTipline ESP reporting API here.
      // Do not attempt to build this without legal/compliance review —
      // mandatory reporting has strict format and retention requirements.
      logger.error({ matchId }, "NCMEC_REPORT_REQUIRED_NOT_IMPLEMENTED");
    }
  }

  res.status(200).json({ ok: true });
});

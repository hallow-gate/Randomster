import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../lib/env.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { logger } from "../lib/logger.js";

/**
 * STUB — mirrors the signature-verification pattern in routes/moderation.ts.
 * Swap the payload shape for whatever your real vendor (Persona/Veriff/
 * Stripe Identity) actually sends; this models the state transition only.
 */
const webhookSchema = z.object({
  vendorRef: z.string().min(1),
  result: z.enum(["verified", "rejected"]),
});

export const ageVerificationWebhookRouter = Router();

function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", env.MODERATION_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

ageVerificationWebhookRouter.post("/webhook", async (req, res) => {
  const signature = req.headers["x-verification-signature"] as string | undefined;
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    logger.warn("age_verification_webhook_bad_signature");
    return res.status(401).json({ error: "invalid_signature" });
  }

  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payload" });
  const { vendorRef, result } = parsed.data;

  const { data: profile, error: findErr } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("age_verification_ref", vendorRef)
    .single();

  if (findErr || !profile) return res.status(404).json({ error: "profile_not_found" });

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      age_verification_status: result,
      age_verified_at: result === "verified" ? new Date().toISOString() : null,
      ...(result === "rejected" ? { is_banned: true, ban_reason: "age_verification_rejected" } : {}),
    })
    .eq("id", profile.id);

  if (error) {
    logger.error({ err: error.message }, "age_verification_webhook_update_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  res.json({ ok: true });
});

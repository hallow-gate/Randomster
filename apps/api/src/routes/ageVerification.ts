import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

/**
 * STUB — replace with a real vendor (Persona, Veriff, Stripe Identity, etc.)
 * before launch. A self-attested checkbox at signup is NOT sufficient
 * age verification for an anonymous stranger-video-matching product; this
 * route models what real integration looks like so it's a drop-in swap.
 *
 * Flow:
 *   1. Client calls POST /api/age-verification/start
 *   2. Backend creates a verification session with the vendor SDK/API,
 *      sets profiles.age_verification_status = 'pending'
 *   3. Vendor redirects/webhooks back with a result
 *   4. A vendor webhook (not shown — mirror the pattern in moderation.ts)
 *      flips status to 'verified' or 'rejected'
 *   5. Users with 'rejected' status are blocked from matchmaking by
 *      requireNotBanned + RLS (age_verification_status <> 'rejected' in
 *      profiles_public).
 */
export const ageVerificationRouter = Router();

ageVerificationRouter.post("/start", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;

  // TODO: call vendor's "create verification session" API here and store
  // the real session id instead of this placeholder.
  const vendorRef = `stub_session_${userId.slice(0, 8)}`;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      age_verification_status: "pending",
      age_verification_provider: "stub_vendor",
      age_verification_ref: vendorRef,
    })
    .eq("id", userId);

  if (error) {
    logger.error({ err: error.message }, "age_verification_start_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  res.json({
    status: "pending",
    // In production, return the vendor's hosted verification URL / SDK token.
    verificationUrl: `https://verify.example-vendor.com/session/${vendorRef}`,
  });
});

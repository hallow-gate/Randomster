import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNotBanned } from "../middleware/banGate.js";
import { messageLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { containsProfanity } from "../lib/profanity.js";
import { logger } from "../lib/logger.js";

export const chatRouter = Router();
chatRouter.use(requireAuth, requireNotBanned, messageLimiter);

const sendSchema = z.object({
  matchId: z.string().uuid(),
  content: z.string().min(1).max(500),
});

// Text is inserted server-side (not client -> DB directly) so profanity
// filtering and active-match validation happen before anything is persisted.
// Realtime delivery to the peer still happens via Supabase Realtime on the
// `messages` table (INSERT event), which the RLS policy in 0002_rls.sql
// scopes to match participants only.
chatRouter.post("/send", validateBody(sendSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { matchId, content } = req.body as z.infer<typeof sendSchema>;

  const { data: match, error: matchErr } = await supabaseAdmin
    .from("matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .single();

  if (matchErr || !match) return res.status(404).json({ error: "match_not_found" });
  if (match.status !== "active") return res.status(409).json({ error: "match_ended" });
  if (match.user_a !== userId && match.user_b !== userId) {
    return res.status(403).json({ error: "not_a_participant" });
  }

  const cleanContent = containsProfanity(content) ? content.replace(/./g, "*") : content;
  // Full replacement with asterisks is intentionally blunt for v1; swap for
  // a real word-level filter if you want partial masking instead.

  const { error: insertErr } = await supabaseAdmin.from("messages").insert({
    match_id: matchId,
    sender_id: userId,
    content: cleanContent,
  });

  if (insertErr) {
    logger.error({ err: insertErr.message }, "message_insert_failed");
    return res.status(500).json({ error: "internal_error" });
  }

  res.json({ status: "sent" });
});

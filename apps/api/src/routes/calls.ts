import { Router } from "express";
import { z } from "zod";
import { env } from "../lib/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNotBanned } from "../middleware/banGate.js";
import { matchActionLimiter } from "../middleware/rateLimit.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { logger } from "../lib/logger.js";

/**
 * Cloudflare Calls (Realtime SFU) requires the App Secret on every API call
 * (session creation, pushing/pulling tracks, renegotiation). That secret can
 * never reach the browser, so the frontend never talks to
 * rtc.live.cloudflare.com directly for the Calls app API — only for the
 * separate TURN credentials endpoint (routes/turn.ts), which uses a
 * differently-scoped, short-TTL token instead.
 *
 * This router proxies the small set of Calls API calls the client needs,
 * validating on the way in that the caller is actually a participant of an
 * active match before letting any session/track operation through — without
 * that check, a stranger could push tracks into or pull tracks out of
 * someone else's call.
 */
export const callsRouter = Router();
callsRouter.use(requireAuth, requireNotBanned, matchActionLimiter);

const CALLS_BASE = `https://rtc.live.cloudflare.com/v1/apps/${env.CLOUDFLARE_CALLS_APP_ID}`;

async function cfFetch(path: string, body: unknown) {
  const res = await fetch(`${CALLS_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_CALLS_APP_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    logger.error({ status: res.status, path, data }, "cloudflare_calls_error");
    throw new Error(`cloudflare_calls_${res.status}`);
  }
  return data;
}

async function assertActiveParticipant(userId: string, matchId: string) {
  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .single();
  if (!match || match.status !== "active") throw new Error("match_not_active");
  if (match.user_a !== userId && match.user_b !== userId) throw new Error("not_a_participant");
}

/** Create a new local Calls session for the caller's own outgoing tracks. */
const newSessionSchema = z.object({ matchId: z.string().uuid() });
callsRouter.post("/session/new", async (req: AuthedRequest, res) => {
  const parsed = newSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  try {
    await assertActiveParticipant(req.userId!, parsed.data.matchId);
    const data = await cfFetch("/sessions/new", {});
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});

/** Push local tracks (send local SDP offer, get Cloudflare's answer). */
const pushTracksSchema = z.object({
  matchId: z.string().uuid(),
  sessionId: z.string().min(1),
  tracks: z.array(z.object({ location: z.literal("local"), trackName: z.string(), mid: z.string().optional() })),
  sessionDescription: z.object({ type: z.literal("offer"), sdp: z.string() }),
});
callsRouter.post("/tracks/push", async (req: AuthedRequest, res) => {
  const parsed = pushTracksSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
  const { matchId, sessionId, tracks, sessionDescription } = parsed.data;

  try {
    await assertActiveParticipant(req.userId!, matchId);
    const data = await cfFetch(`/sessions/${sessionId}/tracks/new`, { tracks, sessionDescription });
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});

/**
 * Pull the partner's remote tracks into the caller's own session. The
 * partner's Cloudflare sessionId/trackName pair is learned via the
 * `match:{matchId}` Supabase Broadcast signaling channel on the client,
 * never trusted from anywhere else.
 */
const pullTracksSchema = z.object({
  matchId: z.string().uuid(),
  sessionId: z.string().min(1),
  tracks: z.array(
    z.object({
      location: z.literal("remote"),
      sessionId: z.string().min(1),
      trackName: z.string().min(1),
    })
  ),
});
callsRouter.post("/tracks/pull", async (req: AuthedRequest, res) => {
  const parsed = pullTracksSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
  const { matchId, sessionId, tracks } = parsed.data;

  try {
    await assertActiveParticipant(req.userId!, matchId);
    const data = await cfFetch(`/sessions/${sessionId}/tracks/new`, { tracks });
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});

/** Answer a renegotiation offer Cloudflare sends back after pulling tracks. */
const renegotiateSchema = z.object({
  matchId: z.string().uuid(),
  sessionId: z.string().min(1),
  sessionDescription: z.object({ type: z.literal("answer"), sdp: z.string() }),
});
callsRouter.put("/renegotiate", async (req: AuthedRequest, res) => {
  const parsed = renegotiateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
  const { matchId, sessionId, sessionDescription } = parsed.data;

  try {
    await assertActiveParticipant(req.userId!, matchId);
    const response = await fetch(`${CALLS_BASE}/sessions/${sessionId}/renegotiate`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_CALLS_APP_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionDescription }),
    });
    if (!response.ok) throw new Error(`cloudflare_calls_${response.status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});

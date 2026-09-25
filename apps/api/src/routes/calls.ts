import { Router, type Response } from "express";
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

class NotAParticipantError extends Error {}
class CloudflareCallsError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

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
    // Surface the actual Cloudflare response, not just the status -- a 401
    // here almost always means CLOUDFLARE_CALLS_APP_ID/APP_SECRET are wrong
    // or expired, which previously looked identical to a real "not your
    // match" 403 from our own side.
    logger.error({ status: res.status, path, data }, "cloudflare_calls_error");
    throw new CloudflareCallsError(`cloudflare_calls_${res.status}`, res.status);
  }
  return data;
}

async function assertActiveParticipant(userId: string, matchId: string) {
  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .single();
  if (!match || match.status !== "active") throw new NotAParticipantError("match_not_active");
  if (match.user_a !== userId && match.user_b !== userId) throw new NotAParticipantError("not_a_participant");
}

/** Maps a caught error to the right HTTP status instead of always 403. */
function respondToCallsError(res: Response, err: unknown) {
  if (err instanceof NotAParticipantError) {
    return res.status(403).json({ error: err.message });
  }
  if (err instanceof CloudflareCallsError) {
    // The caller did everything right; Cloudflare's own API rejected or
    // failed the request (bad credentials, app misconfigured, outage, etc).
    return res.status(502).json({ error: "calls_provider_error" });
  }
  logger.error({ err: (err as Error).message }, "calls_unexpected_error");
  return res.status(500).json({ error: "internal_error" });
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
    respondToCallsError(res, err);
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
    respondToCallsError(res, err);
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
    respondToCallsError(res, err);
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
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      logger.error({ status: response.status, data }, "cloudflare_calls_error");
      throw new CloudflareCallsError(`cloudflare_calls_${response.status}`, response.status);
    }
    res.json({ ok: true });
  } catch (err) {
    respondToCallsError(res, err);
  }
});

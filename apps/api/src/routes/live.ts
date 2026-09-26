import { Router, type Response } from "express";
import { z } from "zod";
import { env } from "../lib/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNotBanned } from "../middleware/banGate.js";
import { liveActionLimiter, liveCommentLimiter, liveReactionLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { neonQuery } from "../lib/neonDb.js";
import { containsProfanity } from "../lib/profanity.js";
import { logger } from "../lib/logger.js";
import { notifyCallEnded } from "../lib/realtime.js";

/**
 * Live streaming: a broadcaster goes through the exact same random
 * matchmaking flow as a normal call (see routes/match.ts), then wraps that
 * match in a `live_sessions` row so an audience can watch it. The two
 * participants' video is exactly the same 1:1 Cloudflare Calls call the
 * rest of the app already uses — viewers just get a read-only, third-party
 * subscription onto both of their published tracks (see the /calls/* routes
 * at the bottom of this file).
 *
 * All live-specific data (sessions, viewers, comments, reports) lives in a
 * separate Neon Postgres database, NOT Supabase — see
 * apps/api/src/lib/neonDb.ts and neon/migrations/0001_live.sql. Session,
 * viewer and comment rows are deleted the moment a stream ends. Reports are
 * the one exception: they're kept in Neon too (never Supabase), just
 * without the cascade delete, so moderators can still review them
 * afterward. The only things that ever cross over into Supabase are the
 * running reaction/live-count totals folded into the broadcaster's profile
 * on `/end`, and an account ban if a report is high-priority — both of
 * those are account data, which is what Supabase is for.
 */
export const liveRouter = Router();
liveRouter.use(requireAuth, requireNotBanned);

interface LiveSessionRow {
  id: string;
  match_id: string | null;
  broadcaster_id: string;
  broadcaster_username: string;
  partner_id: string | null;
  partner_username: string | null;
  status: "active" | "ended";
  reaction_count: number;
  started_at: string;
  ended_at: string | null;
  last_heartbeat_at: string;
  comments_enabled: boolean;
}

const HEARTBEAT_STALE_SECONDS = 25;
const ABANDONED_SECONDS = 120;

async function getUsername(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("username").eq("id", userId).maybeSingle();
  return data?.username ?? "user";
}

/** Folds a session's reaction count into the broadcaster's profile, then deletes it (cascades viewers/comments). */
async function closeLiveSession(session: LiveSessionRow) {
  await supabaseAdmin.rpc("increment_live_stats", {
    p_user_id: session.broadcaster_id,
    p_likes: session.reaction_count,
  });
  await neonQuery("delete from live_sessions where id = $1", [session.id]);
}

/** Best-effort sweep of abandoned sessions (no heartbeat for a while). Never throws. */
async function sweepAbandonedSessions() {
  try {
    const stale = await neonQuery<LiveSessionRow>(
      `select * from live_sessions where status = 'active' and last_heartbeat_at < now() - interval '${ABANDONED_SECONDS} seconds'`
    );
    for (const session of stale) {
      await closeLiveSession(session).catch((err) =>
        logger.error({ err: (err as Error).message, sessionId: session.id }, "live_sweep_close_failed")
      );
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, "live_sweep_failed");
  }
}

async function getActiveSession(id: string | undefined): Promise<LiveSessionRow | null> {
  if (!id) return null;
  const rows = await neonQuery<LiveSessionRow>("select * from live_sessions where id = $1 and status = 'active'", [
    id,
  ]);
  return rows[0] ?? null;
}

async function getViewerCount(sessionId: string): Promise<number> {
  const rows = await neonQuery<{ count: string }>(
    `select count(*)::text as count from live_viewers where session_id = $1 and last_seen_at > now() - interval '${HEARTBEAT_STALE_SECONDS} seconds'`,
    [sessionId]
  );
  return Number(rows[0]?.count ?? 0);
}

// =========================================================
// POST /api/live/start — broadcaster wraps an active match in a live
// session. If the broadcaster already has one running (they hit "Next" and
// matched with someone new), this RE-PARTNERS the existing session instead
// of ending it — the live stream, its comments, reactions and viewers all
// carry straight through to the new stranger, exactly like tapping "next"
// on a normal TikTok-style live host view.
// =========================================================
const startSchema = z.object({ matchId: z.string().uuid() });
liveRouter.post("/start", liveActionLimiter, validateBody(startSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { matchId } = req.body as z.infer<typeof startSchema>;

  const { data: match, error } = await supabaseAdmin
    .from("matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .single();

  if (error || !match || match.status !== "active") {
    return res.status(404).json({ error: "match_not_active" });
  }
  if (match.user_a !== userId && match.user_b !== userId) {
    return res.status(403).json({ error: "not_a_participant" });
  }

  const partnerId = match.user_a === userId ? match.user_b : match.user_a;

  const existing = await neonQuery<LiveSessionRow>(
    "select * from live_sessions where broadcaster_id = $1 and status = 'active'",
    [userId]
  );
  if (existing[0]) {
    const session = existing[0];
    if (session.match_id !== matchId) {
      const partnerUsername = await getUsername(partnerId);
      await neonQuery(
        "update live_sessions set match_id = $1, partner_id = $2, partner_username = $3 where id = $4",
        [matchId, partnerId, partnerUsername, session.id]
      );
    }
    return res.json({ id: session.id, matchId });
  }

  const broadcasterUsername = await getUsername(userId);
  const partnerUsername = await getUsername(partnerId);

  const inserted = await neonQuery<{ id: string }>(
    `insert into live_sessions (match_id, broadcaster_id, broadcaster_username, partner_id, partner_username)
     values ($1, $2, $3, $4, $5) returning id`,
    [matchId, userId, broadcasterUsername, partnerId, partnerUsername]
  );

  await supabaseAdmin.from("profiles").update({ is_live: true }).eq("id", userId);

  res.json({ id: inserted[0]?.id, matchId });
});

// =========================================================
// POST /api/live/:id/clear-partner — host tapped "Next" (or the partner
// skipped/blocked/reported them): drop the stale match/partner so viewers
// immediately see "waiting for next stranger" instead of a frozen or
// broken video, WITHOUT ending the stream itself. Comments, reactions and
// viewers all carry straight through.
// =========================================================
liveRouter.post("/:id/clear-partner", liveActionLimiter, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (session.broadcaster_id !== userId) return res.status(403).json({ error: "not_broadcaster" });

  await neonQuery("update live_sessions set match_id = null, partner_id = null, partner_username = null where id = $1", [
    session.id,
  ]);
  res.json({ status: "ok" });
});

// =========================================================
// PATCH /api/live/:id/comments-enabled — host toggles comments on/off,
// same as other live platforms. Reactions are unaffected.
// =========================================================
const commentsEnabledSchema = z.object({ enabled: z.boolean() });
liveRouter.patch(
  "/:id/comments-enabled",
  liveActionLimiter,
  validateBody(commentsEnabledSchema),
  async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const session = await getActiveSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.broadcaster_id !== userId) return res.status(403).json({ error: "not_broadcaster" });

    const { enabled } = req.body as z.infer<typeof commentsEnabledSchema>;
    await neonQuery("update live_sessions set comments_enabled = $1 where id = $2", [enabled, session.id]);
    res.json({ commentsEnabled: enabled });
  }
);

// =========================================================
// POST /api/live/:id/end — broadcaster ends the stream
// =========================================================
liveRouter.post("/:id/end", liveActionLimiter, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (session.broadcaster_id !== userId) return res.status(403).json({ error: "not_broadcaster" });

  await neonQuery("update live_sessions set status = 'ended', ended_at = now() where id = $1", [session.id]);
  await closeLiveSession(session);

  res.json({ status: "ended", totalReactions: session.reaction_count });
});

// =========================================================
// GET /api/live/feed — currently-live sessions, most-watched first
// =========================================================
liveRouter.get("/feed", liveActionLimiter, async (_req: AuthedRequest, res) => {
  await sweepAbandonedSessions();

  const rows = await neonQuery<
    LiveSessionRow & { viewer_count: string }
  >(
    `select ls.*, count(lv.user_id) filter (where lv.last_seen_at > now() - interval '${HEARTBEAT_STALE_SECONDS} seconds')::text as viewer_count
     from live_sessions ls
     left join live_viewers lv on lv.session_id = ls.id
     where ls.status = 'active'
     group by ls.id
     order by viewer_count desc, ls.started_at desc
     limit 50`
  );

  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      broadcasterId: r.broadcaster_id,
      broadcasterUsername: r.broadcaster_username,
      partnerId: r.partner_id,
      partnerUsername: r.partner_username,
      viewerCount: Number(r.viewer_count),
      startedAt: r.started_at,
    })),
  });
});

// =========================================================
// GET /api/live/active-session/:userId — for the profile red-ring redirect
// =========================================================
liveRouter.get("/active-session/:userId", liveActionLimiter, async (req: AuthedRequest, res) => {
  const rows = await neonQuery<{ id: string }>(
    "select id from live_sessions where broadcaster_id = $1 and status = 'active'",
    [req.params.userId!]
  );
  res.json({ sessionId: rows[0]?.id ?? null });
});

// =========================================================
// POST /api/live/:id/join — register presence, return a full snapshot
// =========================================================
liveRouter.post("/:id/join", liveActionLimiter, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });

  const username = await getUsername(userId);
  await neonQuery(
    `insert into live_viewers (session_id, user_id, username)
     values ($1, $2, $3)
     on conflict (session_id, user_id) do update set last_seen_at = now()`,
    [session.id, userId, username]
  );

  const comments = await neonQuery(
    "select id, user_id, username, text, created_at from live_comments where session_id = $1 order by created_at desc limit 30",
    [session.id]
  );
  const viewerCount = await getViewerCount(session.id);

  res.json({
    id: session.id,
    matchId: session.match_id,
    broadcasterId: session.broadcaster_id,
    broadcasterUsername: session.broadcaster_username,
    partnerId: session.partner_id,
    partnerUsername: session.partner_username,
    reactionCount: session.reaction_count,
    commentsEnabled: session.comments_enabled,
    viewerCount,
    comments: session.comments_enabled ? comments.reverse() : [],
  });
});

// =========================================================
// POST /api/live/:id/leave
// =========================================================
liveRouter.post("/:id/leave", liveActionLimiter, async (req: AuthedRequest, res) => {
  await neonQuery("delete from live_viewers where session_id = $1 and user_id = $2", [
    req.params.id!,
    req.userId!,
  ]);
  res.json({ status: "ok" });
});

// =========================================================
// GET /api/live/:id/state — lightweight poll: heartbeat + new comments + counts
// =========================================================
liveRouter.get("/:id/state", liveActionLimiter, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const session = await getActiveSession(req.params.id);
  if (!session) return res.json({ ended: true });

  if (session.broadcaster_id === userId) {
    await neonQuery("update live_sessions set last_heartbeat_at = now() where id = $1", [session.id]);
  } else {
    await neonQuery("update live_viewers set last_seen_at = now() where session_id = $1 and user_id = $2", [
      session.id,
      userId,
    ]);
  }

  const after = typeof req.query.after === "string" ? req.query.after : null;
  const comments =
    session.comments_enabled && after
      ? await neonQuery(
          "select id, user_id, username, text, created_at from live_comments where session_id = $1 and created_at > $2 order by created_at asc limit 50",
          [session.id, after]
        )
      : [];
  const viewerCount = await getViewerCount(session.id);

  res.json({
    ended: false,
    matchId: session.match_id,
    partnerId: session.partner_id,
    partnerUsername: session.partner_username,
    reactionCount: session.reaction_count,
    commentsEnabled: session.comments_enabled,
    viewerCount,
    comments,
  });
});

// =========================================================
// GET /api/live/:id/viewers — list of current viewer usernames
// =========================================================
liveRouter.get("/:id/viewers", liveActionLimiter, async (req: AuthedRequest, res) => {
  const rows = await neonQuery<{ user_id: string; username: string }>(
    `select user_id, username from live_viewers
     where session_id = $1 and last_seen_at > now() - interval '${HEARTBEAT_STALE_SECONDS} seconds'
     order by joined_at asc limit 200`,
    [req.params.id!]
  );
  res.json({ viewers: rows });
});

// =========================================================
// POST /api/live/:id/comment
// =========================================================
const commentSchema = z.object({ text: z.string().trim().min(1).max(200) });
liveRouter.post("/:id/comment", liveCommentLimiter, validateBody(commentSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { text } = req.body as z.infer<typeof commentSchema>;

  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (!session.comments_enabled) return res.status(403).json({ error: "comments_disabled" });
  if (containsProfanity(text)) return res.status(400).json({ error: "comment_not_allowed" });

  const username = await getUsername(userId);
  const rows = await neonQuery(
    `insert into live_comments (session_id, user_id, username, text)
     values ($1, $2, $3, $4) returning id, user_id, username, text, created_at`,
    [session.id, userId, username, text]
  );

  res.json({ comment: rows[0] });
});

// =========================================================
// POST /api/live/:id/react — heart tap
// =========================================================
liveRouter.post("/:id/react", liveReactionLimiter, async (req: AuthedRequest, res) => {
  const rows = await neonQuery<{ reaction_count: number }>(
    "update live_sessions set reaction_count = reaction_count + 1 where id = $1 and status = 'active' returning reaction_count",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "session_not_found" });
  res.json({ reactionCount: rows[0].reaction_count });
});

// =========================================================
// POST /api/live/:id/report — written into Neon's live_reports table
// (NOT Supabase — Supabase is only touched here to ban an account, which
// is account data, not live-stream data). live_reports has no cascade
// delete, so it outlives the session for moderator review.
// =========================================================
const reportSchema = z.object({
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
liveRouter.post("/:id/report", liveActionLimiter, validateBody(reportSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { reason, details } = req.body as z.infer<typeof reportSchema>;

  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });

  await neonQuery(
    `insert into live_reports (session_id, match_id, broadcaster_id, reporter_id, reason, details)
     values ($1, $2, $3, $4, $5, $6)`,
    [session.id, session.match_id, session.broadcaster_id, userId, reason, details ?? null]
  );

  if (reason === "minor_suspected" || reason === "csam_suspected") {
    logger.error({ sessionId: session.id, broadcasterId: session.broadcaster_id }, "HIGH_PRIORITY_LIVE_REPORT");
    // Banning the account is Supabase's job (account data, not live data).
    await supabaseAdmin
      .from("profiles")
      .update({ is_banned: true, ban_reason: `pending_review:${reason}` })
      .eq("id", session.broadcaster_id);
    await neonQuery("update live_sessions set status = 'ended', ended_at = now() where id = $1", [session.id]);
    await closeLiveSession(session);
    if (session.match_id) await notifyCallEnded(session.match_id, "report");
  }

  res.json({ status: "reported" });
});

// =========================================================
// Viewer-side Cloudflare Calls proxy — a viewer is not a match participant,
// so this intentionally does NOT reuse routes/calls.ts's
// assertActiveParticipant; it authorizes against an active live_session
// instead, and only ever *pulls* tracks (viewers never publish).
// =========================================================
const CALLS_BASE = `https://rtc.live.cloudflare.com/v1/apps/${env.CLOUDFLARE_CALLS_APP_ID}`;

class CloudflareCallsError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function cfFetch(path: string, body?: unknown) {
  const res = await fetch(`${CALLS_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_CALLS_APP_SECRET}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    logger.error({ status: res.status, path, data }, "cloudflare_calls_error_live");
    throw new CloudflareCallsError(`cloudflare_calls_${res.status}`, res.status);
  }
  return data;
}

// Same per-session single-flight queue as routes/calls.ts, kept separate
// since these are viewers' own sessions, never a broadcaster/partner one.
const sessionQueues = new Map<string, Promise<unknown>>();
function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => {});
  sessionQueues.set(sessionId, settled);
  settled.then(() => {
    if (sessionQueues.get(sessionId) === settled) sessionQueues.delete(sessionId);
  });
  return next;
}

function respondToCallsError(res: Response, err: unknown) {
  if (err instanceof CloudflareCallsError) return res.status(502).json({ error: "calls_provider_error" });
  logger.error({ err: (err as Error).message }, "live_calls_unexpected_error");
  return res.status(500).json({ error: "internal_error" });
}

liveRouter.post("/:id/calls/session/new", liveActionLimiter, async (req: AuthedRequest, res) => {
  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  try {
    res.json(await cfFetch("/sessions/new"));
  } catch (err) {
    respondToCallsError(res, err);
  }
});

const pullSchema = z.object({
  sessionId: z.string().min(1),
  tracks: z.array(
    z.object({ location: z.literal("remote"), sessionId: z.string().min(1), trackName: z.string().min(1) })
  ),
});
liveRouter.post("/:id/calls/tracks/pull", liveActionLimiter, validateBody(pullSchema), async (req: AuthedRequest, res) => {
  const session = await getActiveSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  const { sessionId, tracks } = req.body as z.infer<typeof pullSchema>;
  try {
    const data = await withSessionLock(sessionId, () => cfFetch(`/sessions/${sessionId}/tracks/new`, { tracks }));
    res.json(data);
  } catch (err) {
    respondToCallsError(res, err);
  }
});

const renegotiateSchema = z.object({
  sessionId: z.string().min(1),
  sessionDescription: z.object({ type: z.literal("answer"), sdp: z.string() }),
});
liveRouter.put(
  "/:id/calls/renegotiate",
  liveActionLimiter,
  validateBody(renegotiateSchema),
  async (req: AuthedRequest, res) => {
    const session = await getActiveSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    const { sessionId, sessionDescription } = req.body as z.infer<typeof renegotiateSchema>;
    try {
      await withSessionLock(sessionId, async () => {
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
          logger.error({ status: response.status, data }, "cloudflare_calls_error_live");
          throw new CloudflareCallsError(`cloudflare_calls_${response.status}`, response.status);
        }
      });
      res.json({ ok: true });
    } catch (err) {
      respondToCallsError(res, err);
    }
  }
);

import { rateLimit } from "express-rate-limit";
import { slowDown } from "express-slow-down";
import type { AuthedRequest } from "./auth.js";

/** Generic per-IP limiter for public/auth endpoints. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

/** Slows down repeated hits before the hard limiter kicks in, on sensitive routes. */
export const authSlowDown = slowDown({
  windowMs: 60_000,
  delayAfter: 5,
  delayMs: (hits) => hits * 200,
});

/** Per-authenticated-user limiter for matchmaking actions (join/skip/report/block). */
export const matchActionLimiter = rateLimit({
  windowMs: 10_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthedRequest).userId ?? req.ip ?? "unknown",
  message: { error: "rate_limited" },
});

/** Chat message limiter: 5 msg/sec per user, per spec. */
export const messageLimiter = rateLimit({
  windowMs: 1_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthedRequest).userId ?? req.ip ?? "unknown",
  message: { error: "rate_limited" },
});

/**
 * Per-authenticated-user limiter for Cloudflare Calls signaling
 * (session/new, tracks/push, tracks/pull, renegotiate).
 *
 * This used to share `matchActionLimiter` (5 requests / 10s), which is sized
 * for infrequent actions like join/skip/report. A single call setup alone
 * needs at least 4 requests back-to-back (session/new, push, pull,
 * renegotiate), and any retry after a transient Cloudflare negotiation
 * conflict (see the per-session queue in calls.ts) pushes a user over that
 * limit within the same window -- so the retry that was meant to recover
 * the call instead got 429'd, leaving the call dead with no way to recover.
 * Signaling traffic is bursty-but-bounded (one call setup, occasional
 * renegotiation), so this allows a much higher burst while still guarding
 * against abuse.
 */
export const callsSignalingLimiter = rateLimit({
  windowMs: 10_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthedRequest).userId ?? req.ip ?? "unknown",
  message: { error: "rate_limited" },
});

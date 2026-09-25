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

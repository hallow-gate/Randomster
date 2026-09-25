import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

/**
 * Verifies the Supabase-issued JWT on the Authorization header.
 * Rejects requests for users who are banned or whose age verification
 * was rejected (see profiles.is_banned / age_verification_status).
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET) as { sub?: string };
    if (!decoded.sub) {
      return res.status(401).json({ error: "invalid_token" });
    }
    req.userId = decoded.sub;
    next();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "jwt_verification_failed");
    return res.status(401).json({ error: "invalid_token" });
  }
}

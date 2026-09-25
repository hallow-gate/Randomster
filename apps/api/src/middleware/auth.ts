import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

const jwks = createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", env.SUPABASE_URL));

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const { payload } = await jwtVerify(token, jwks);
    if (!payload.sub) {
      return res.status(401).json({ error: "invalid_token" });
    }
    req.userId = payload.sub;
    return next();
  } catch (jwksErr) {
    try {
      const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET) as { sub?: string };
      if (!decoded.sub) {
        return res.status(401).json({ error: "invalid_token" });
      }
      req.userId = decoded.sub;
      return next();
    } catch (hsErr) {
      logger.warn(
        { jwksErr: (jwksErr as Error).message, hsErr: (hsErr as Error).message },
        "jwt_verification_failed",
      );
      return res.status(401).json({ error: "invalid_token" });
    }
  }
}

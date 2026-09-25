import { Router } from "express";
import { env } from "../lib/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNotBanned } from "../middleware/banGate.js";
import { logger } from "../lib/logger.js";

export const turnRouter = Router();

/**
 * Issues short-TTL Cloudflare TURN credentials for the caller. No public
 * STUN servers are returned — Cloudflare TURN only, to avoid leaking user
 * IPs beyond what's strictly necessary for connectivity.
 */
turnRouter.get("/", requireAuth, requireNotBanned, async (_req: AuthedRequest, res) => {
  try {
    const ttlSeconds = 120; // short-lived; re-fetch per call

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: ttlSeconds }),
      }
    );

    if (!response.ok) {
      logger.error({ status: response.status }, "turn_credential_fetch_failed");
      return res.status(502).json({ error: "turn_unavailable" });
    }

    const data = await response.json();
    res.json({ iceServers: data.iceServers, ttl: ttlSeconds });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "turn_credential_error");
    res.status(500).json({ error: "internal_error" });
  }
});

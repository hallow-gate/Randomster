import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";

import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { authLimiter, authSlowDown } from "./middleware/rateLimit.js";

import { matchRouter } from "./routes/match.js";
import { chatRouter } from "./routes/chat.js";
import { profileRouter } from "./routes/profile.js";
import { accountRouter } from "./routes/account.js";
import { turnRouter } from "./routes/turn.js";
import { moderationRouter } from "./routes/moderation.js";
import { ageVerificationRouter } from "./routes/ageVerification.js";
import { ageVerificationWebhookRouter } from "./routes/ageVerificationWebhook.js";
import { callsRouter } from "./routes/calls.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // required for correct req.ip behind Render/Cloudflare

const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", env.SUPABASE_URL, "https://rtc.live.cloudflare.com"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    frameguard: { action: "deny" },
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(
  pinoHttp({
    logger,
    redact: ["req.headers.authorization", "req.headers.cookie"],
  })
);

// Sensitive endpoints get an extra IP-based limiter/slowdown layer on top of
// the per-route limiters defined inside each router.
app.use("/api/profile/username", authLimiter, authSlowDown);
app.use("/api/account", authLimiter, authSlowDown);
app.use("/api/age-verification", authLimiter, authSlowDown);

app.use("/api/match", matchRouter);
app.use("/api/chat", chatRouter);
app.use("/api/profile", profileRouter);
app.use("/api/account", accountRouter);
app.use("/api/turn-credentials", turnRouter);
app.use("/api/moderation", moderationRouter);
app.use("/api/age-verification", ageVerificationRouter);
app.use("/api/age-verification", ageVerificationWebhookRouter);
app.use("/api/calls", callsRouter);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Centralized error handler — never leak stack traces in production.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message }, "unhandled_error");
  const body =
    env.NODE_ENV === "production" ? { error: "internal_error" } : { error: "internal_error", message: err.message };
  res.status(500).json(body);
});

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "randomster_api_started");
});

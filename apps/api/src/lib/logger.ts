import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.email",
      "*.ip",
      "*.content", // chat message bodies are never logged in full
    ],
    censor: "[redacted]",
  },
});

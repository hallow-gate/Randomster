# Security Checklist

## Implemented in this scaffold

**Database (Supabase/Postgres)**
- [x] RLS enabled on every table (`0002_rls.sql`)
- [x] Policies scope reads/writes to `auth.uid()` — own profile, own matches, messages where a participant
- [x] `profiles_public` view exposes only safe columns to matched strangers
- [x] service_role key used only in `apps/api`, never shipped to frontend
- [x] Atomic matchmaking pairing via `SELECT ... FOR UPDATE SKIP LOCKED` (`try_match` function)
- [x] Messages auto-expire (`expires_at`), enforced both by `pg_cron` deletion and by RLS read policy

**Backend (Node/Express)**
- [x] `helmet` with CSP, HSTS, frameguard: deny, CORP
- [x] Strict CORS allowlist from `ALLOWED_ORIGINS`
- [x] `express-rate-limit` (per-IP and per-user) + `express-slow-down` on auth/account routes
- [x] Zod validation on every route body
- [x] JWT verification (`requireAuth`) on every protected route
- [x] Body size limit (10kb)
- [x] No stack traces leaked in production error responses
- [x] `pino` logging with redaction of auth headers, tokens, emails, IPs, message content

**Auth**
- [x] Google OAuth only, via Supabase Auth
- [x] Forced username setup with 30-day change cooldown
- [x] Banned / age-rejected users blocked at both API (`requireNotBanned`) and RLS layer

**WebRTC**
- [x] Ephemeral, short-TTL (120s) Cloudflare TURN credentials, generated server-side per session
- [x] No public STUN servers configured — Cloudflare TURN only
- [x] DTLS-SRTP is WebRTC's default and is not disabled anywhere in this stack
- [x] Cloudflare Calls App Secret lives only in `apps/api/src/routes/calls.ts` — the browser never talks
      to Cloudflare's Calls API directly, only to this backend proxy
- [x] Every session/track/renegotiate call is checked against active match participancy
      (`assertActiveParticipant`) before being forwarded to Cloudflare, so a stranger can't push into or
      pull tracks out of someone else's call
- [x] Track/session-ID exchange between the two peers happens only over the `match:{matchId}` Supabase
      Broadcast channel, which RLS/channel auth scopes to the two participants

**Realtime signaling integrity**
- [x] "You've been matched" and "call ended" events are pushed by the backend only
      (`apps/api/src/lib/realtime.ts`), never written by clients — a user can't spoof a match or fake an
      end-of-call for someone else

**Abuse prevention**
- [x] Report + block endpoints and tables
- [x] Blocked users excluded from matchmaking (`try_match` checks `blocks`)
- [x] Profanity filter on usernames and chat messages
- [x] `minor_suspected` / `csam_suspected` reports auto-suspend the reported account pending review
- [x] `bans` table (IP stored only as a salted hash, never raw)

**Data privacy**
- [x] Message content never persisted past 1hr post-skip
- [x] No video/audio recording anywhere in this stack
- [x] GDPR export (`GET /api/account/export`) and delete (`DELETE /api/account`)

## Gaps you must close before any real launch — not optional

- [ ] **Video moderation is a stub.** `routes/moderation.ts` defines the webhook contract but you must
      integrate a real vendor (Cloudflare Stream CSAM scanning for known-hash matches, plus Hive
      Moderation or Thorn Safer for novel-content classification) before allowing any real user traffic.
      This is the single highest-risk gap in this scaffold for a stranger-video-matching product.
- [ ] **Age verification is a stub.** A self-attested checkbox is not verification. Wire
      `routes/ageVerification.ts` to a real identity/liveness vendor (Persona, Veriff, Stripe Identity)
      and gate matchmaking on `age_verification_status = 'verified'`, not just "not rejected."
- [ ] **NCMEC CyberTipline reporting is not implemented** (`NCMEC_REPORTING_ENABLED` just logs a TODO).
      If you operate in/serve the US, mandatory reporting obligations apply the moment you detect CSAM.
      Get legal counsel involved before writing this integration — the format and retention
      requirements are strict and non-negotiable.
- [ ] Rate limiting here is in-memory (`express-rate-limit` default store); move to a shared Redis
      store before running more than one backend instance, or limits reset per-instance.
- [ ] Add human moderator tooling (a review queue UI) — `reports` and `moderation_events` are stubs
      for a pipeline, not a full trust & safety system.
- [ ] Penetration test the WebRTC signaling path and TURN credential issuance specifically —
      this is the part of the stack most exposed to abuse (IP leaks, unauthorized call joins).
- [ ] The Cloudflare Calls proxy (`routes/calls.ts`) mirrors the documented SFU push/pull/renegotiate
      flow but has not been run against a live Cloudflare Calls app — validate the exact request/response
      shapes against current Cloudflare docs before relying on it, their API evolves.
- [ ] Legal review: terms of service, privacy policy, GDPR/CCPA compliance beyond the two endpoints
      here, and region-specific requirements for platforms serving minors-adjacent risk categories.

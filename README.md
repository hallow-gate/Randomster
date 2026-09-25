# Randomster

Random video chat with text messaging, Google-only auth, country-based matchmaking, and
ephemeral (1hr TTL) chat storage.

⚠️ **Before running this for real users, read `SECURITY_CHECKLIST.md`.** Video moderation
(CSAM/nudity detection) and identity age verification are stubbed in this scaffold and must be
wired to real vendors before launch — this is not optional for a product in this category.

## Stack
- Frontend: React 18 + Vite + TypeScript + Tailwind + Framer Motion (`apps/web`)
- Backend: Node.js + Express + TypeScript (`apps/api`)
- DB/Auth: Supabase (Postgres + RLS + Supabase Auth, Google OAuth only)
- Video: Cloudflare Calls (WebRTC) with ephemeral Cloudflare TURN credentials
- Realtime: Supabase Realtime (Postgres changes for chat, Broadcast for WebRTC signaling)
- Deploy: Render (backend), any static host (frontend — Vercel/Netlify/Cloudflare Pages)

## Local development

### 1. Supabase project
1. Create a project at supabase.com.
2. In the SQL editor, run the migrations in order from `supabase/migrations/`:
   `0001_init.sql`, `0002_rls.sql`, `0003_try_match_fn.sql`.
3. Enable the Google provider under Authentication → Providers, with your OAuth client
   ID/secret from Google Cloud Console.
4. (Optional, local only) run `supabase/seed.sql` to create test users across a few countries.

### 2. Cloudflare
1. Create a Cloudflare Calls app (Realtime SFU) — note the App ID and secret.
2. Create a TURN key under Cloudflare's Realtime TURN service — note the Key ID and API token.

### 3. Environment
```
cp .env.example apps/api/.env
cp .env.example apps/web/.env   # only the VITE_* vars are read by the frontend
```
Fill in every value — the backend fails fast at boot if any required var is missing
(see `apps/api/src/lib/env.ts`).

### 4. Install & run
```
cd apps/api && npm install && npm run dev     # http://localhost:8080
cd apps/web && npm install && npm run dev     # http://localhost:5173
```

## Deploy

### Backend (Render)
`render.yaml` is at the repo root — connect the repo in the Render dashboard and it will pick
up the config. Set every `sync: false` env var in the Render dashboard (never commit real
secrets). Health check is `GET /healthz`.

### Frontend
Build with `npm run build` in `apps/web` and deploy the `dist/` folder to any static host.
Set `VITE_API_BASE_URL` to your deployed backend URL and `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` to your Supabase project's public values.

## Repo layout
```
apps/web        React frontend
apps/api        Express backend (all secrets live here)
packages/shared Shared TypeScript types between frontend/backend
supabase/       SQL migrations, seed script
render.yaml     Render deploy config
.env.example    All required environment variables
SECURITY_CHECKLIST.md
```

# Vibii

**Your life. Your sound. Just press play.** A mobile-first web app (installable PWA) that gives adults a personal
soundtrack: a two-minute interview, a surprise five-song first playlist, and an operator workflow for making the songs.

- **DJ Vibii** (music note) — original songs made for the listener; real playback through one persistent audio element.
- **My vibes** (globe) — recommendations of existing songs, opened in Spotify/YouTube (never played inside Vibii).
- **create new** (plus) — an intentional request for a personal song, using a song entitlement.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · PostgreSQL (Supabase or local) · Supabase Auth +
private Storage · Vitest · Playwright.

> Docs: [Admin fulfillment guide](docs/ADMIN_GUIDE.md) · [Implementation report](docs/IMPLEMENTATION_REPORT.md) ·
> Product spec: [Vibii-MRD-PRD.md](Vibii-MRD-PRD.md) · mockups in [docs/mockups](docs/mockups)

## Run it locally (no credentials needed)

Requirements: Node ≥ 20.9, PostgreSQL 16 (e.g. `brew install postgresql@16 && brew services start postgresql@16`), ffmpeg
(only to regenerate demo audio).

```bash
npm install
cp .env.example .env.local          # then set VIBII_SECRET to 32+ random characters
createdb vibii_dev
npm run db:migrate
npm run db:seed -- --mode demo      # stores the 5 labelled demo loops in private storage
npm run dev                         # http://localhost:3000
```

If `next dev` hangs on the first request (seen in some sandboxed macOS setups), use `npm run dev:webpack`
(webpack + polling file watcher).

Without Supabase variables the login page offers an **isolated local demo account** — clearly labelled, stored only in
your local database, and impossible to enable in production (`NODE_ENV=production` or on Vercel).

To use the operator console locally, make your demo user an admin:

```bash
psql -d vibii_dev -c "select id from profiles order by created_at desc limit 1"
npm run db:seed -- --admin <that-id>
```

Then open `/admin`. `npm run worker` starts the separate queue worker (only needed for automated providers; demo mode is
also processed by a bounded tick after each request, and manual mode needs no worker).

## Real multi-user mode (Supabase)

1. Create a Supabase project. In **Authentication → Providers** enable **Email** (confirm email ON) and **Google**
   (create an OAuth client in Google Cloud; authorized redirect: `https://<project>.supabase.co/auth/v1/callback`).
2. In **Authentication → URL configuration** set Site URL to your app URL and add `https://<your-app>/auth/callback` as a
   redirect URL.
3. Set the environment variables (see [.env.example](.env.example)):
   `DATABASE_URL` (use the connection pooler URI on Vercel), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server only), `VIBII_SECRET`, `NEXT_PUBLIC_SITE_URL`, `VIBII_ADMIN_EMAILS`, `CRON_SECRET`.
4. `npm run db:migrate` then `npm run db:seed -- --mode demo` (creates the **private** bucket `vibii-private` and uploads the
   demo loops). Run both with the production env loaded, e.g. `vercel env pull .env.production.local` and
   `npx tsx --env-file=.env.production.local scripts/migrate.ts`.

The browser only ever receives the public Supabase URL/anon key. The service-role key, database URL, `VIBII_SECRET` and
any provider credentials stay on the server. Migration `…300_privilege_lockdown.sql` revokes Supabase's default
anon/authenticated table grants so the public REST API can't be used to write around the server.

### Deploying on Vercel

```bash
npx vercel login
npx vercel link
npx vercel env add …   # each variable above, for Production (and Preview if wanted)
npx vercel deploy --prod
```

Vercel runs the web app only. Options for the queue worker: run `npm run worker` on any always-on host with `DATABASE_URL`,
or call `GET /api/worker/tick` with `Authorization: Bearer $CRON_SECRET` from a scheduler. Demo and manual modes work
without either.

## Provider modes (Suno)

| Mode | Status | What happens |
|---|---|---|
| `demo` | **working** | Five locally synthesised instrumental loops (`scripts/make-demo-audio.sh`), labelled "Demo loop" everywhere. Not Suno output. |
| `manual` | **working** | Requests wait for an operator who exports the brief, makes the song through an authorised workflow (e.g. your own Suno account, or Suno's MCP in Claude Code), records the job ID and uploads a permitted file or attaches a suno.com link. See the [admin guide](docs/ADMIN_GUIDE.md). |
| `official_api` | **unavailable** (shown as such) | Suno's API portal (platform.suno.com, checked 2026-11-01) documents no request schema, auth method, pricing or limits for this account. Nothing is invented; the adapter refuses and requests fall back to the operator queue. |

Suno's official MCP (`claude mcp add --transport http suno https://api.suno.com/mcp`, then `/mcp` to sign in) runs in the
**operator's** Claude Code session and uses the operator's Suno credits and library. It is not a backend integration: the
web server never receives those credentials.

**Rights gate.** Suno's terms restrict competing services and tie commercial use to permitted downloads. Vibii therefore
refuses to *approve* Suno output for any listener other than the operator until **provider agreement evidence** is recorded
in `/admin → Provider` (an agreement permitting generation for customers, storage and streaming in Vibii). An ordinary
subscription does not establish that. External-only links are delivered as "Open in Suno" and never count as in-app audio
for the first album.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `dev:webpack` | Dev server |
| `npm run build` / `start` | Production build / server |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit + integration tests (needs a local `vibii_test` database; it is reset on every run) |
| `npm run test:e2e` | Playwright E2E (creates/resets `vibii_e2e`, starts its own dev server on :3100, writes screenshots to `test-results/screenshots`) |
| `npm run db:migrate` / `db:seed` | Apply migrations / store demo fixtures, set mode, grant admin |
| `npm run worker` | Durable queue worker |
| `npm run demo:audio` | Regenerate the demo loops with ffmpeg |
| `npm run links:validate` | Re-verify My vibes links through Spotify/YouTube oEmbed |

## Layout

```
src/app/(app)/         DJ Vibii (/), My vibes, create new, profile — share one PlayerProvider (single <audio>)
src/app/onboarding     v0.3 interview          src/app/admin   operator console + metrics
src/app/api/           route handlers (auth, onboarding, player, media, events, requests, admin, worker tick)
src/lib/onboarding.ts  categories, follow-ups, stale-branch rules (shared client/server)
src/lib/creative/      planner (5 internal roles), template brief builder, local cover illustrations
src/lib/server/        db (RLS via asUser), ledger, pipeline (queue/worker/release gate), providers, storage, admin, metrics
supabase/migrations/   schema, RLS, grants        worker/index.ts   separate worker entry point
tests/                 unit, integration (real Postgres), e2e (Playwright)
```

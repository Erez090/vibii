# Vibii MVP — implementation report (2026-11-01)

## What was built

A working Next.js 16 / TypeScript / Tailwind 4 / PostgreSQL app covering the full v0.3 spec in demo and manual provider
modes: auth (Supabase Google + verified email; isolated local demo login outside production), the 12-category onboarding
with up to two follow-ups, consent paths (personal / taste-only / no provider processing), credit awards, atomic first-album
creation, a durable job queue with leases and a separate worker, a persisted release gate, real playback through one
global audio element, My vibes recommendations with verified external links, create new with idempotent requests and
entitlements, an operator console with provenance and review, account deletion, analytics and operator metrics, EN/HE
with RTL, and a shell-only PWA service worker.

## Verified (this run)

| Area | How |
|---|---|
| Lint, typecheck, production build | `npm run lint`, `npm run typecheck`, `npm run build` (all routes compile) |
| 40 unit/integration tests against real Postgres | `npm test` |
| 2 Playwright E2E tests | `npm run test:e2e` |
| Manual walkthrough in a browser at 390 px | login → onboarding → reveal → play → seek → tab switching → create new → admin |

Integration tests cover the required regression risks:
- Two users can't read each other's rows, tracks, covers or ledger under RLS; listeners can't read operator tables or the
  draft plan; can't make themselves admin; unapproved candidates are invisible; signed media URLs expire and can't be
  re-targeted; Supabase default grants are revoked.
- Four concurrent submissions with one idempotency key → one request, one reservation.
- Lost provider response → `unknown_submission`, exactly one submit, quota still reserved; a crash between persisting an
  attempt and submitting is treated as unknown for non-idempotent providers.
- Expired lease is recovered by another worker; duplicate/late completion creates no extra track or charge;
  non-retryable failure releases the reservation exactly once; provider call caps block submission.
- Release gate: four ready songs reveal nothing; late fifth song releases once; failing art provider → five distinct local
  covers; starter consumed once; `first_track_ready` recorded once. A released playlist stays playable while a later
  request is pending.
- Final save alone queues exactly five slots + five cover tasks; double tap/concurrent completion → one album; reload
  doesn't duplicate; profile edits after completion don't regenerate; private details never reach lyrics; stale follow-up
  removed when its branch changes; 40 + 12×5 credits, no duplicates on re-save or re-registration of the same identity
  (no second album either); taste-only uses no lyric facts; declining provider processing routes to authorised fixtures.
- Manual workflow: reject (no charge) → Suno approval blocked without agreement evidence → approve → delivered to the
  right account only, consumed once, provenance with reviewer; external links stay external and can't satisfy the first
  album; manual first album reveals only after the fifth approval; upload validation (type, size, duration, evidence);
  link allowlist; reconcile-unknown and cancellation keep quota consistent.

E2E (Playwright, Chromium): all-skip onboarding through the UI (9 skips; the 3 household screens auto-skipped on the
taste-only path) → one reveal with five distinct covers → one tap plays → time advances → seeking to the end advances to
track 2 with a new cover, still playing → My vibes and create new keep the single audio element playing → My vibes has
links, a concept-art label and no player controls → keyboard pause → three tabs in one row without truncation at 390 px →
Hebrew RTL. Also: listeners get 404 on `/admin`, 403 on admin APIs, 404 for another track's URL; anonymous API → 401.
Screenshots: `test-results/screenshots/` (390, 430, desktop, Hebrew).

Bugs found and fixed by these checks: the draft plan was readable through a table-level grant; the release-gate query used
`FOR UPDATE` with `GROUP BY`; JS-vs-DB clock skew delayed job claims; listener position saves failed on a missing column
grant; Supabase default grants would have allowed `profiles.is_admin` updates through the public REST API.

## Not verified / pending

- **Supabase cloud & Google OAuth**: code paths implemented against `@supabase/ssr` 0.12 / `supabase-js` 2.117, but not run
  against a real project (no credentials here). Email-link and Google sign-in, Storage signed URLs and
  `auth.admin.deleteUser` need a live check after configuration.
- **Vercel deployment**: not deployed yet — needs your Vercel login and a Supabase project (see README).
- **Suno**: no Suno MCP connection exists in this environment and no generation was run. `official_api` stays unavailable:
  platform.suno.com shows a landing page without request schema, auth, pricing or limits. Needed to enable it: Suno API
  documentation and credentials for your account, the rate/price limits, and a written agreement permitting generation for
  customers, storage and streaming in Vibii.
- **iPhone background / lock-screen playback**: Media Session handlers are wired, but nothing was tested on a real device.
  Check on iOS Safari (standalone PWA and browser): lock-screen controls, playback continuing with the screen off, and
  resume after an interruption (call, Siri).
- **Timing claims**: none made. Metrics record interview duration, final answer → five playable songs, and first question
  → ready (p50/p90 per provider mode) once real users run.
- **LLM brief adapter**: not implemented beyond configuration placeholders; briefs are deterministic templates and are
  labelled "no AI model was used".
- **Billing**: disabled by design. Admin grants and externally paid pilot periods only.
- **Art provider**: none configured; covers are distinct local illustrations per slot (motif + palette + seed).

## Notable decisions

- Server talks to Postgres directly (`pg`). User-facing reads run inside `asUser()` (role `authenticated`, JWT claims set
  per transaction), so RLS is enforced locally and on Supabase in addition to server checks.
- The first album is a separate entitlement keyed by a hashed verified identity that survives account deletion, so
  re-registration can't duplicate it or the welcome/category credits.
- `references` is an SQL keyword; the table is `music_references`.
- In Hebrew the three tabs mirror right-to-left (DJ Vibii stays first in reading order).
- Dev server: Turbopack's dev server hung in this sandbox; `npm run dev:webpack` (webpack + polling) is provided. Production
  builds use Turbopack and pass.

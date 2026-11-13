# Vibii operator guide — manual fulfillment

The operator console lives at `/admin`. Admins are set by the server only: either list the email in `VIBII_ADMIN_EMAILS`
(granted on next sign-in) or run `npm run db:seed -- --admin <user-id>`. Listeners can't change this.

## 1. Before the first real listener

1. **Provider → Mode**: choose `manual`. (`demo` attaches labelled demo loops automatically; `official_api` is shown as
   unavailable until Suno documents an API for this account.)
2. **Caps**: set the daily/monthly call caps and concurrency. These are enforced per provider, independently of what
   listeners are entitled to. Monetary cost per call is unknown, so caps are counted in calls.
3. **Provider agreement evidence**: Suno's terms restrict competing services and tie commercial use to permitted
   downloads. Until you record evidence here of an agreement that allows generating for customers, storing and streaming
   in Vibii, the console will refuse to approve Suno output for anyone except you. A personal subscription alone is not
   that evidence. You can still test with your own account (you are the listener) or deliver other audio you have the
   rights to.

## 2. Optional: connect Suno to Claude Code (your own account)

```bash
claude mcp add --transport http suno https://api.suno.com/mcp
```

Then run `/mcp` in an interactive Claude Code session and sign in to Suno. This uses **your** Suno credits and saves songs
to **your** Suno library; MCP access may require Suno's beta. List the tools the server exposes (Claude Code shows them
after sign-in) before relying on them — Vibii doesn't assume any tool names. Agree a specific generation budget before
asking Claude to create songs; never run bulk generations.

## 3. Fulfilling a request

Open **Requests**. Items needing you sort first: `unknown_submission`, then `needs_review`, then `awaiting_operator`.

1. Open the request. The **Brief** shows only what's needed: title, style, language, energy, moment, exclusions and lyrics
   (a structured template — no AI model wrote it). Use **Copy brief**, or copy style / lyrics separately. The job ID
   (request id) is in the header — keep it with the song in Suno (e.g. in the title or notes) so files never get mixed up.
2. Create the song through an authorised workflow (Suno web app or Suno MCP).
3. **Record provider job**: paste the Suno song/job id. This is counted against your caps and stored as an attempt.
4. Deliver one of:
   - **Upload candidate** — an audio file you are permitted to download and redistribute (mp3/m4a/wav/ogg/flac, ≤ 25 MB,
     10 s – 10 min). Fill in the download evidence (e.g. "Downloaded from my Suno Premier library; plan permits download").
     The file goes to private storage and is invisible to the listener until approved.
   - **Attach link** — a `https://suno.com/...` link only. The listener sees "Open in Suno"; it's never shown as local
     playback, and it can't complete a first album (those need in-app audio).
5. **Review**: preview the candidate. Check for wrong or embarrassing details, mispronunciations, and fit with the brief.
   Write an authorization statement and **Approve & publish** — or **Reject (no charge)**; rejected candidates are kept for
   cost/quality analysis and the request goes back to your queue. Only one approved output per request is ever charged.

When all five first-album slots have approved in-app audio and covers (covers are drawn automatically), the listener's
playlist is revealed. Nothing is revealed early.

## 4. Problems

- **unknown_submission** — the provider may have accepted (and charged) a request but the response was lost. Check your
  Suno library first. If you find the song: "It was accepted" (+ job id). If not: "Not accepted — allow resubmit".
  Never just resubmit.
- **failed** — "Retry audio only" re-queues the song without touching its cover; "Retry cover only" re-draws the cover.
- **Cancel** — releases the listener's reservation. If a provider already accepted the job, the history records that cost
  may still have been incurred.

## 5. Entitlements and pilots

Billing is off. Under **Grant test entitlement / record pilot payment**, find the user and grant songs:
- *test grant* — internal testing.
- *pilot — paid externally* with a period (`YYYY-MM`) — recorded once per user per period.

The first five-song album is separate and granted once per verified identity. Wallet credits (40 welcome + 5 per answered
or skipped core question, 100 = one song) are redeemed by the listener.

## 6. Metrics

`/admin/metrics` shows numerator/denominator and the date window for onboarding completion, activation, same-track return,
week-two listening, renewal (pilot payments only), candidate acceptance, provider cost (credits; money unknown unless
recorded) and p50/p90 timings per provider mode. Demo and admin accounts are excluded. Targets are configuration, not
results.

## 7. Deletion

A listener can delete their account from Profile. Rows and private files are removed (file removal is retried by the
worker). Anything already entered into Suno stays subject to Suno's own retention and deletion — tell the listener if
they ask, and delete it in your Suno library where possible.

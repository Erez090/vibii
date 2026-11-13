// Durable PostgreSQL job queue + generation pipeline. Jobs are claimed atomically with a lease;
// expired leases are recovered. Nothing here runs inside a user's HTTP request lifecycle except the
// optional bounded tick (demo mode / cron), and manual mode needs no worker at all.
import { randomUUID } from "node:crypto";
import { pool, tx, type Db } from "./db";
import { audit, setRequestState } from "./audit";
import { consumeReservation, consumeStarter, releaseReservation } from "./ledger";
import { configuredArtProvider, providerFor, ProviderTransportError, type AuthorizedAsset, type ProviderMode } from "./providers";
import { renderCoverSvg } from "../creative/cover";
import { trackEvent } from "./analytics";
import { ALBUM_SIZE } from "../onboarding";
import { agentRunnerEnabled } from "./suno-agent";

export const LEASE_SECONDS = 60;
const BACKOFF_SECONDS = [15, 60, 300, 900];

export interface Job {
  id: number;
  kind: "audio" | "cover";
  request_id: string;
  attempts: number;
  max_attempts: number;
}

export async function enqueue(db: Db, kind: "audio" | "cover", requestId: string, uniqueKey: string) {
  await db.query(
    "insert into job_queue(kind, request_id, unique_key) values ($1,$2,$3) on conflict (unique_key) do nothing",
    [kind, requestId, uniqueKey],
  );
}

/** Atomically claim one due job (or one whose lease expired). */
/** `at` overrides the database clock (tests use it to simulate lease expiry). */
export async function claimJob(workerId: string, at?: Date, opts: { includeAgent?: boolean } = {}): Promise<Job | null> {
  const includeAgent = opts.includeAgent ?? agentRunnerEnabled();
  const { rows } = await pool().query(
    `update job_queue j set state = 'running', lease_owner = $1,
       lease_expires_at = coalesce($2::timestamptz, now()) + make_interval(secs => $3),
       attempts = j.attempts + 1, updated_at = now()
     where j.id = (
       select id from job_queue
       where ((state = 'pending' and run_after <= coalesce($2::timestamptz, now()))
          or (state = 'running' and lease_expires_at < coalesce($2::timestamptz, now())))
         and ($4::boolean or kind <> 'audio' or not exists (
               select 1 from generation_requests g where g.id = job_queue.request_id and g.provider_mode = 'agent'))
       order by run_after, id
       for update skip locked limit 1)
     returning j.id, j.kind, j.request_id, j.attempts, j.max_attempts`,
    [workerId, at?.toISOString() ?? null, LEASE_SECONDS, includeAgent],
  );
  return (rows[0] as Job) ?? null;
}

async function finishJob(jobId: number, workerId: string, state: "done" | "failed" | "cancelled", error?: string) {
  await pool().query(
    "update job_queue set state = $3, last_error = $4, lease_owner = null, lease_expires_at = null, updated_at = now() where id = $1 and lease_owner = $2",
    [jobId, workerId, state, error ?? null],
  );
}

async function retryJob(job: Job, workerId: string, error: string, delaySeconds?: number) {
  if (job.attempts >= job.max_attempts) return finishJob(job.id, workerId, "failed", error);
  const delay = delaySeconds ?? BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];
  await pool().query(
    `update job_queue set state = 'pending', run_after = now() + make_interval(secs => $3), last_error = $4,
       lease_owner = null, lease_expires_at = null, updated_at = now() where id = $1 and lease_owner = $2`,
    [job.id, workerId, delay, error],
  );
}

export async function providerConfig(db: Db) {
  const { rows } = await db.query("select * from provider_configuration where id = 1");
  return rows[0] as {
    mode: ProviderMode; daily_call_cap: number; monthly_call_cap: number; max_concurrency: number;
    monetary_cost_known: boolean; commercial_agreement_evidence: string | null;
  };
}

/** Provider spend caps & concurrency, independent of user entitlements. Demo fixtures are free. */
async function withinBudget(db: Db, provider: string, cfg: Awaited<ReturnType<typeof providerConfig>>) {
  if (provider === "demo_fixture") return { ok: true };
  const { rows } = await db.query(
    `select
       count(*) filter (where created_at >= date_trunc('day', now()))::int as today,
       count(*) filter (where created_at >= date_trunc('month', now()))::int as month,
       count(*) filter (where state in ('created','submitted','processing'))::int as inflight
     from generation_attempts where provider = $1`,
    [provider],
  );
  const r = rows[0];
  if (r.today >= cfg.daily_call_cap) return { ok: false, reason: "daily_cap" };
  if (r.month >= cfg.monthly_call_cap) return { ok: false, reason: "monthly_cap" };
  if (r.inflight >= cfg.max_concurrency) return { ok: false, reason: "concurrency" };
  return { ok: true };
}

// ------------------------------------------------------------------ cover task
export async function processCover(requestId: string) {
  const cover = await tx(async (db) => {
    const { rows } = await db.query("select * from covers where request_id = $1 for update", [requestId]);
    return rows[0];
  });
  if (!cover || cover.state === "ready") return;
  const brief = cover.art_brief as { scene: string; motif: string; palette: string[]; alt: string };
  const art = configuredArtProvider();
  let svg: string | null = null;
  let kind = "local_illustration";
  let rights = "Vibii local illustration (generated in-house from the slot's motif and palette)";
  if (art) {
    try {
      const out = await art.render({ scene: brief.scene, palette: brief.palette, seed: requestId });
      if (out.svg) {
        svg = out.svg;
        kind = "provider";
        rights = "art provider output";
      }
    } catch {
      // fall through to a distinct local composition for this slot
    }
  }
  if (!svg) svg = renderCoverSvg({ motif: brief.motif, palette: brief.palette, seed: requestId, alt: brief.alt });
  await tx(async (db) => {
    await db.query(
      `update covers set state = 'ready', kind = $2, svg = $3, rights_source = $4, attempts = attempts + 1, updated_at = now()
       where request_id = $1 and state <> 'ready'`,
      [requestId, kind, svg, rights],
    );
    await checkReleaseGate(db, requestId);
  });
}

// ------------------------------------------------------------------ audio task
export async function processAudio(requestId: string): Promise<{ retryAfter?: number; error?: string } | void> {
  const ctx = await tx(async (db) => {
    const { rows } = await db.query("select * from generation_requests where id = $1 for update", [requestId]);
    const req = rows[0];
    if (!req) return null;
    const cfg = await providerConfig(db);
    const att = await db.query(
      "select * from generation_attempts where request_id = $1 order by attempt_no desc limit 1",
      [requestId],
    );
    return { req, cfg, last: att.rows[0] ?? null };
  });
  if (!ctx) return;
  const { req, last } = ctx;
  if (["ready", "failed", "cancelled", "awaiting_operator", "needs_review", "unknown_submission"].includes(req.state)) return;

  const provider = providerFor(req.provider_mode);
  if (!provider.capabilities.automated) {
    await tx((db) => setRequestState(db, requestId, "awaiting_operator", { actor: "worker", note: "manual delivery" }));
    return;
  }
  const avail = provider.availability();
  if (!avail.ok) {
    await tx((db) => setRequestState(db, requestId, "awaiting_operator", { actor: "worker", note: avail.reason, errorCode: "provider_unavailable" }));
    return;
  }

  // A previous attempt that was persisted but whose outcome is unknown (crash/lost response).
  if (last && last.state === "created") {
    if (!provider.capabilities.idempotency) {
      await tx(async (db) => {
        await db.query("update generation_attempts set state = 'unknown_submission', error_code = 'lost_response' where id = $1", [last.id]);
        await setRequestState(db, requestId, "unknown_submission", { actor: "worker", note: "submission outcome unknown; reconcile before resubmitting", errorCode: "lost_response" });
      });
      return;
    }
  }

  let attempt = last && ["created", "submitted", "processing"].includes(last.state) ? last : null;
  if (!attempt) {
    const created = await tx(async (db) => {
      const budget = await withinBudget(db, provider.id, ctx.cfg);
      if (!budget.ok) return { wait: budget.reason };
      const n = (last?.attempt_no ?? 0) + 1;
      const { rows } = await db.query(
        `insert into generation_attempts(request_id, owner_id, attempt_no, provider, submission_key, brief_version, monetary_cost_known)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [requestId, req.owner_id, n, provider.id, `${requestId}:${n}`, req.brief_version, ctx.cfg.monetary_cost_known && provider.id !== "demo_fixture"],
      );
      await setRequestState(db, requestId, "preparing", { actor: "worker", from: ["queued", "preparing", "processing"] });
      return { attempt: rows[0] };
    });
    if ("wait" in created) return { retryAfter: 600, error: `budget:${created.wait}` };
    attempt = created.attempt;
  }

  if (attempt.state === "created") {
    let result;
    try {
      result = await provider.submit({ brief: req.brief, submissionKey: attempt.submission_key, slot: req.slot });
    } catch (err) {
      const maybe = err instanceof ProviderTransportError ? err.maybeAccepted : true;
      await tx(async (db) => {
        if (maybe) {
          await db.query("update generation_attempts set state = 'unknown_submission', error_code = 'transport_error' where id = $1", [attempt.id]);
          await setRequestState(db, requestId, "unknown_submission", { actor: "worker", note: "provider may have accepted the request", errorCode: "transport_error" });
        } else {
          await db.query("update generation_attempts set state = 'failed', error_code = 'transport_error', completed_at = now() where id = $1", [attempt.id]);
        }
      });
      if (maybe) return;
      return { error: "transport_error_not_accepted" };
    }
    if (result.kind === "awaiting_operator") {
      await tx((db) => setRequestState(db, requestId, "awaiting_operator", { actor: "worker" }));
      return;
    }
    if (result.kind === "rejected") {
      await tx(async (db) => {
        await db.query("update generation_attempts set state = 'failed', error_code = $2, completed_at = now() where id = $1", [attempt.id, result.code]);
        if (!result.retryable) await failRequest(db, requestId, result.code);
      });
      return result.retryable ? { error: result.code } : undefined;
    }
    await tx(async (db) => {
      await db.query(
        "update generation_attempts set state = 'submitted', provider_job_id = $2, submitted_at = now() where id = $1",
        [attempt.id, result.jobId],
      );
      await setRequestState(db, requestId, "submitted", { actor: "worker" });
    });
    attempt = { ...attempt, state: "submitted", provider_job_id: result.jobId };
  }

  const status = await provider.getStatus(attempt.provider_job_id);
  if (status.state === "processing") {
    await tx((db) => setRequestState(db, requestId, "processing", { actor: "worker", from: ["submitted", "processing"] }));
    return { retryAfter: 30, error: "processing" };
  }
  if (status.state === "failed") {
    await tx(async (db) => {
      await db.query("update generation_attempts set state = 'failed', error_code = $2, completed_at = now() where id = $1", [attempt.id, status.code]);
      if (!status.retryable) await failRequest(db, requestId, status.code);
    });
    return status.retryable ? { error: status.code } : undefined;
  }
  await completeAttempt(attempt.id, status.candidates.map((c) => c.ref));
}

/** Idempotent: a duplicate completion (late callback, worker restart) creates no extra tracks or charges. */
export async function completeAttempt(attemptId: string, refs: string[]) {
  const pre = await pool().query("select * from generation_attempts where id = $1", [attemptId]);
  const attempt = pre.rows[0];
  if (!attempt) return;
  const provider = providerFor(
    attempt.provider === "demo_fixture" ? "demo" : attempt.provider === "suno_api" ? "official_api" : attempt.provider === "suno_agent" ? "agent" : "manual",
  );
  const assets: { ref: string; asset: AuthorizedAsset }[] = [];
  for (const ref of refs) assets.push({ ref, asset: await provider.resolveAuthorizedAsset(attempt.provider_job_id, ref) });

  await tx(async (db) => {
    const { rows } = await db.query("select * from generation_attempts where id = $1 for update", [attemptId]);
    const a = rows[0];
    if (a.state === "succeeded") return; // duplicate completion
    await db.query(
      "update generation_attempts set state = 'succeeded', completed_at = now(), actual_cost_credits = coalesce(actual_cost_credits, estimated_cost_credits) where id = $1",
      [attemptId],
    );
    const req = (await db.query("select * from generation_requests where id = $1 for update", [a.request_id])).rows[0];
    if (["cancelled", "failed", "ready"].includes(req.state)) {
      await audit(db, { action: "late_completion_ignored", targetType: "generation_request", targetId: req.id, details: { attemptId } });
      return;
    }
    let firstTrack: string | null = null;
    for (const { ref, asset } of assets) {
      const ins = await db.query(
        `insert into tracks(owner_id, request_id, attempt_id, title, storage_key, mime_type, duration_seconds, external_url, external_service,
           source, is_demo_fixture, rights_status, provenance, moment, energy, artist_label)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [
          req.owner_id, req.id, attemptId, req.brief?.title ?? req.title ?? "Untitled",
          asset.kind === "stored" ? asset.storageKey : null, asset.kind === "stored" ? asset.mimeType : null,
          asset.kind === "stored" ? asset.durationSeconds : null,
          asset.kind === "external" ? asset.url : null, asset.kind === "external" ? asset.service : null,
          a.provider, a.provider === "demo_fixture",
          a.provider === "demo_fixture" ? "authorized" : asset.kind === "external" ? "external_link_only" : "unverified",
          JSON.stringify({
            provider: a.provider, generation_reference: a.provider_job_id, candidate_ref: ref,
            download: asset.kind === "stored" ? (a.provider === "demo_fixture" ? "Vibii-owned demo fixture" : "pending review") : "external link only",
            authorization: a.provider === "demo_fixture" ? "authorized: Vibii-generated demo loop" : "pending review",
            label: asset.kind === "stored" ? asset.label : null,
          }),
          req.brief?.moment ?? null, req.brief?.energy ?? null,
          a.provider === "demo_fixture" ? "DJ Vibii · demo loop" : "DJ Vibii",
        ],
      );
      firstTrack ??= ins.rows[0].id;
    }
    if (a.provider === "demo_fixture" && firstTrack) {
      // Demo fixtures are Vibii-owned and pre-authorized: publish without operator QA.
      await publishTrack(db, firstTrack, null);
    } else if (a.provider === "suno_agent" && firstTrack && (await agentAutoPublishAllowed(db, req.owner_id))) {
      await db.query(
        `update tracks set rights_status = 'authorized',
           provenance = provenance || jsonb_build_object('download', 'downloaded by Vibii from the operator''s Suno account',
             'authorization', 'auto-delivered by the Vibii Suno agent (operator-enabled)') where id = $1`,
        [firstTrack],
      );
      await publishTrack(db, firstTrack, null);
    } else {
      await setRequestState(db, req.id, "needs_review", { actor: "worker" });
    }
  });
}

/**
 * Agent-made Suno songs go straight to the listener only when the operator turned that on
 * (VIBII_AGENT_AUTOPUBLISH=on), recorded a provider agreement, or the listener is an operator.
 * Otherwise they wait in the review queue like manual uploads.
 */
async function agentAutoPublishAllowed(db: Db, ownerId: string) {
  if (process.env.VIBII_AGENT_AUTOPUBLISH === "on") return true;
  const cfg = await providerConfig(db);
  if (cfg.commercial_agreement_evidence) return true;
  const { rows } = await db.query("select is_admin from profiles where id = $1", [ownerId]);
  return Boolean(rows[0]?.is_admin);
}

async function failRequest(db: Db, requestId: string, code: string) {
  const req = (await db.query("select * from generation_requests where id = $1", [requestId])).rows[0];
  await setRequestState(db, requestId, "failed", { actor: "worker", errorCode: code });
  if (req.kind === "create_new") await releaseReservation(db, req.owner_id, requestId, "song", `reserve:${requestId}`);
  await trackEvent(db, { ownerId: req.owner_id, name: "request_failed", eventId: `request_failed:${requestId}`, props: { kind: req.kind, code } });
}

/** Approve a candidate and deliver it to the request owner. Shared by worker (demo) and operators. */
export async function publishTrack(db: Db, trackId: string, reviewerId: string | null) {
  const { rows } = await db.query("select * from tracks where id = $1 for update", [trackId]);
  const t = rows[0];
  if (!t) throw new Error("track_not_found");
  if (t.status === "approved") return { ok: true, duplicate: true };
  if (t.status !== "candidate") throw new Error("track_not_candidate");
  const req = (await db.query("select * from generation_requests where id = $1 for update", [t.request_id])).rows[0];
  if (!req) throw new Error("request_not_found");
  if (["cancelled", "failed"].includes(req.state)) throw new Error("request_closed");
  if (req.kind === "starter_slot" && !t.storage_key) throw new Error("starter_requires_in_app_audio");
  const existing = await db.query("select id from tracks where request_id = $1 and status = 'approved'", [req.id]);
  if (existing.rowCount) throw new Error("request_already_fulfilled");

  await db.query(
    "update tracks set status = 'approved', reviewer_id = $2, reviewed_at = now(), published_at = now() where id = $1",
    [trackId, reviewerId],
  );
  await setRequestState(db, req.id, "ready", { actor: reviewerId ? `operator:${reviewerId}` : "worker" });
  if (req.kind === "create_new") {
    await consumeReservation(db, req.owner_id, req.id, "song", `reserve:${req.id}`);
    await db.query(
      "insert into playlists(owner_id, kind, name) select $1, 'library', 'My Vibii songs' where not exists (select 1 from playlists where owner_id = $1 and kind = 'library')",
      [req.owner_id],
    );
    await db.query(
      `insert into playlist_items(playlist_id, owner_id, request_id, track_id, position)
       select p.id, $1, $2, $3, coalesce((select max(position) from playlist_items where playlist_id = p.id), 0) + 1
       from playlists p where p.owner_id = $1 and p.kind = 'library'
       on conflict do nothing`,
      [req.owner_id, req.id, trackId],
    );
  } else {
    await db.query("update playlist_items set track_id = $3 where playlist_id = $1 and request_id = $2", [req.playlist_id, req.id, trackId]);
  }
  await checkReleaseGate(db, req.id);
  return { ok: true, duplicate: false };
}

/** The single persisted release gate: all ALBUM_SIZE (7) slots playable in-app AND all covers ready. */
export async function checkReleaseGate(db: Db, requestId: string) {
  const { rows } = await db.query("select playlist_id, owner_id, kind from generation_requests where id = $1", [requestId]);
  const r = rows[0];
  if (!r || r.kind !== "starter_slot") return false;
  // Lock the playlist row so concurrent slot completions evaluate the gate one at a time.
  const pl = await db.query("select released_at from playlists where id = $1 for update", [r.playlist_id]);
  if (!pl.rowCount || pl.rows[0].released_at) return false;
  const gate = await db.query(
    `select count(*) filter (where t.status = 'approved' and t.storage_key is not null)::int as playable,
            count(*) filter (where c.state = 'ready')::int as covers
     from generation_requests g
     left join tracks t on t.request_id = g.id and t.status = 'approved'
     left join covers c on c.request_id = g.id
     where g.playlist_id = $1`,
    [r.playlist_id],
  );
  const g = gate.rows[0];
  if (g.playable < ALBUM_SIZE || g.covers < ALBUM_SIZE) return false;
  await db.query("update playlists set released_at = now() where id = $1 and released_at is null", [r.playlist_id]);
  await consumeStarter(db, r.owner_id, r.playlist_id);
  await trackEvent(db, { ownerId: r.owner_id, name: "first_track_ready", eventId: `first_track_ready:${r.playlist_id}`, props: {} });
  return true;
}

// ------------------------------------------------------------------ worker tick
export async function runJob(job: Job, workerId: string) {
  // Keep the lease alive while a long task (a Suno agent run takes minutes) is in progress, so no other
  // worker loop reclaims the job and starts a second, paid generation.
  const heartbeat = setInterval(() => {
    pool()
      .query("update job_queue set lease_expires_at = now() + make_interval(secs => $3) where id = $1 and lease_owner = $2", [job.id, workerId, LEASE_SECONDS])
      .catch(() => {});
  }, (LEASE_SECONDS * 1000) / 3);
  try {
    return await runJobInner(job, workerId);
  } finally {
    clearInterval(heartbeat);
  }
}

async function runJobInner(job: Job, workerId: string) {
  try {
    if (job.kind === "cover") {
      await processCover(job.request_id);
      return finishJob(job.id, workerId, "done");
    }
    const out = await processAudio(job.request_id);
    if (out && (out.retryAfter || out.error)) return retryJob(job, workerId, out.error ?? "retry", out.retryAfter);
    return finishJob(job.id, workerId, "done");
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "error";
    return retryJob(job, workerId, msg);
  }
}

/** Process up to `limit` due jobs. Bounded, so it is safe to call from a cron route. */
export async function tick(limit = 10, workerId = `w-${randomUUID().slice(0, 8)}`) {
  let n = 0;
  for (; n < limit; n++) {
    const job = await claimJob(workerId);
    if (!job) break;
    await runJob(job, workerId);
  }
  return n;
}

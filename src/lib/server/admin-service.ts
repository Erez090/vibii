// Operator workflow. Every action is authorized by the caller (requireAdmin) and audited.
import { randomUUID } from "node:crypto";
import { parseBuffer } from "music-metadata";
import { pool, tx, type Db } from "./db";
import { audit, setRequestState } from "./audit";
import { checkReleaseGate, enqueue, processCover, providerConfig, publishTrack } from "./pipeline";
import { grantSongs, releaseReservation } from "./ledger";
import { putObject } from "./storage";
import { trackEvent } from "./analytics";
import type { SessionUser } from "./auth";

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_MIME: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/flac": "flac",
};
export const MIN_DURATION = 10;
export const MAX_DURATION = 600;
/** External result links are accepted only for these hosts (https). */
export const EXTERNAL_LINK_HOSTS = ["suno.com", "www.suno.com"];

export class AdminError extends Error {}

export async function listRequests(filter: { state?: string }) {
  const { rows } = await pool().query(
    `select r.id, r.owner_id, r.kind, r.slot, r.state, r.provider_mode, r.title, r.created_at, r.updated_at, r.error_code,
       p.display_name, (select count(*) from tracks t where t.request_id = r.id and t.status = 'candidate')::int as candidates
     from generation_requests r join profiles p on p.id = r.owner_id
     where ($1::text is null or r.state = $1)
     order by case r.state when 'unknown_submission' then 0 when 'needs_review' then 1 when 'awaiting_operator' then 2 else 3 end, r.created_at
     limit 200`,
    [filter.state ?? null],
  );
  return rows;
}

export async function requestDetail(id: string) {
  const db = pool();
  const r = (await db.query("select r.*, p.display_name from generation_requests r join profiles p on p.id = r.owner_id where r.id = $1", [id])).rows[0];
  if (!r) return null;
  const [attempts, tracks, cover, events] = await Promise.all([
    db.query("select * from generation_attempts where request_id = $1 order by attempt_no", [id]),
    db.query("select id, status, title, storage_key, external_url, external_service, source, rights_status, provenance, duration_seconds, created_at, reviewer_id from tracks where request_id = $1 order by created_at", [id]),
    db.query("select state, kind, alt_text, motif, rights_source, attempts from covers where request_id = $1", [id]),
    db.query("select from_state, to_state, actor, note, created_at from generation_request_events where request_id = $1 order by id", [id]),
  ]);
  const b = r.brief ?? {};
  // Minimal relevant brief: creative fields only. No email, no raw onboarding answers.
  const brief = {
    request_id: r.id, title: b.title, style: b.style, lyrics: b.lyrics, language: b.language, energy: b.energy,
    moment: b.moment, instrumental: b.instrumental, excluded: b.excluded, generator: b.generator, generatorNote: b.generatorNote,
  };
  return { request: { ...r, brief: undefined }, brief, attempts: attempts.rows, tracks: tracks.rows, cover: cover.rows[0] ?? null, events: events.rows };
}

export function exportBriefText(brief: Record<string, unknown>) {
  return [
    `Vibii job: ${brief.request_id}`,
    `Title: ${brief.title}`,
    `Style: ${brief.style}`,
    `Language: ${brief.language}`,
    `Exclude: ${(brief.excluded as string[] | undefined)?.join("; ")}`,
    "",
    "Lyrics:",
    String(brief.lyrics ?? ""),
    "",
    `(${brief.generatorNote ?? ""})`,
  ].join("\n");
}

async function lockRequest(db: Db, id: string) {
  const r = (await db.query("select * from generation_requests where id = $1 for update", [id])).rows[0];
  if (!r) throw new AdminError("request_not_found");
  return r;
}

/** Record that an operator submitted the brief through an authorized workflow (e.g. their Suno account / MCP). */
export async function recordProviderJob(admin: SessionUser, requestId: string, input: { providerJobId: string; note?: string }) {
  return tx(async (db) => {
    const r = await lockRequest(db, requestId);
    if (["ready", "cancelled", "failed"].includes(r.state)) throw new AdminError("request_closed");
    const cfg = await providerConfig(db);
    const counts = (await db.query(
      `select count(*) filter (where created_at >= date_trunc('day', now()))::int as today,
              count(*) filter (where created_at >= date_trunc('month', now()))::int as month
       from generation_attempts where provider = 'suno_manual'`,
    )).rows[0];
    if (counts.today >= cfg.daily_call_cap || counts.month >= cfg.monthly_call_cap) throw new AdminError("provider_cap_reached");
    const n = ((await db.query("select coalesce(max(attempt_no),0)::int as n from generation_attempts where request_id = $1", [requestId])).rows[0].n) + 1;
    const jobId = input.providerJobId.trim().slice(0, 200) || null;
    const a = await db.query(
      `insert into generation_attempts(request_id, owner_id, attempt_no, provider, provider_job_id, submission_key, state, submitted_at, brief_version)
       values ($1,$2,$3,'suno_manual',$4,$5,'submitted',now(),$6) returning id`,
      [requestId, r.owner_id, n, jobId, `${requestId}:${n}`, r.brief_version],
    );
    await setRequestState(db, requestId, "submitted", { actor: `operator:${admin.id}`, note: input.note?.slice(0, 200) });
    await audit(db, { actorId: admin.id, action: "provider_job_recorded", targetType: "generation_request", targetId: requestId, details: { attemptNo: n, jobId } });
    return a.rows[0].id as string;
  });
}

async function latestAttempt(db: Db, requestId: string, adminId: string, r: { owner_id: string; brief_version: number }) {
  const a = (await db.query("select id from generation_attempts where request_id = $1 order by attempt_no desc limit 1", [requestId])).rows[0];
  if (a) return a.id as string;
  const ins = await db.query(
    `insert into generation_attempts(request_id, owner_id, attempt_no, provider, submission_key, state, submitted_at, brief_version)
     values ($1,$2,1,'operator_upload',$3,'submitted',now(),$4) returning id`,
    [requestId, r.owner_id, `${requestId}:1`, r.brief_version],
  );
  await audit(db, { actorId: adminId, action: "attempt_created_for_upload", targetType: "generation_request", targetId: requestId });
  return ins.rows[0].id as string;
}

export async function validateAudio(buf: Buffer, mime: string) {
  const ext = UPLOAD_MIME[mime];
  if (!ext) throw new AdminError("unsupported_type");
  if (buf.length === 0 || buf.length > UPLOAD_MAX_BYTES) throw new AdminError("file_too_large");
  let duration: number | undefined;
  try {
    const meta = await parseBuffer(new Uint8Array(buf), { mimeType: mime }, { duration: true });
    duration = meta.format.duration;
  } catch {
    throw new AdminError("unreadable_audio");
  }
  if (!duration || duration < MIN_DURATION || duration > MAX_DURATION) throw new AdminError("invalid_duration");
  return { ext, duration };
}

export async function attachUpload(
  admin: SessionUser,
  requestId: string,
  file: { buf: Buffer; mime: string; name: string },
  evidence: { source: "suno_manual" | "operator_upload"; downloadEvidence: string; generationReference?: string },
) {
  const { ext, duration } = await validateAudio(file.buf, file.mime);
  if (!evidence.downloadEvidence.trim()) throw new AdminError("download_evidence_required");
  const r0 = (await pool().query("select owner_id, state from generation_requests where id = $1", [requestId])).rows[0];
  if (!r0) throw new AdminError("request_not_found");
  const key = `candidates/${r0.owner_id}/${requestId}/${randomUUID()}.${ext}`;
  await putObject(key, file.buf, file.mime); // private; not visible to the listener until approved
  return tx(async (db) => {
    const r = await lockRequest(db, requestId);
    if (["ready", "cancelled", "failed"].includes(r.state)) throw new AdminError("request_closed");
    const attemptId = await latestAttempt(db, requestId, admin.id, r);
    const t = await db.query(
      `insert into tracks(owner_id, request_id, attempt_id, title, storage_key, mime_type, duration_seconds, source, rights_status, provenance, moment, energy)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'unverified',$9,$10,$11) returning id`,
      [r.owner_id, requestId, attemptId, r.brief?.title ?? r.title ?? "Untitled", key, file.mime, Math.round(duration),
        evidence.source,
        JSON.stringify({ provider: evidence.source, generation_reference: evidence.generationReference ?? null,
          download: evidence.downloadEvidence.slice(0, 500), authorization: "pending review", uploaded_by: admin.id, original_name: file.name.slice(0, 100) }),
        r.brief?.moment ?? null, r.brief?.energy ?? null],
    );
    await setRequestState(db, requestId, "needs_review", { actor: `operator:${admin.id}` });
    await audit(db, { actorId: admin.id, action: "candidate_uploaded", targetType: "track", targetId: t.rows[0].id, details: { requestId, duration: Math.round(duration) } });
    return t.rows[0].id as string;
  });
}

export function validateExternalLink(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AdminError("invalid_url");
  }
  if (u.protocol !== "https:" || !EXTERNAL_LINK_HOSTS.includes(u.hostname) || u.username || u.password || u.port) {
    throw new AdminError("host_not_allowed");
  }
  return u.toString();
}

export async function attachExternalLink(admin: SessionUser, requestId: string, url: string, generationReference?: string) {
  const clean = validateExternalLink(url); // stored only; never fetched
  return tx(async (db) => {
    const r = await lockRequest(db, requestId);
    if (["ready", "cancelled", "failed"].includes(r.state)) throw new AdminError("request_closed");
    const attemptId = await latestAttempt(db, requestId, admin.id, r);
    const t = await db.query(
      `insert into tracks(owner_id, request_id, attempt_id, title, external_url, external_service, source, rights_status, provenance, moment, energy)
       values ($1,$2,$3,$4,$5,'Suno','suno_manual','external_link_only',$6,$7,$8) returning id`,
      [r.owner_id, requestId, attemptId, r.brief?.title ?? r.title ?? "Untitled", clean,
        JSON.stringify({ provider: "suno_manual", generation_reference: generationReference ?? null, download: "none — external link only", authorization: "pending review" }),
        r.brief?.moment ?? null, r.brief?.energy ?? null],
    );
    await setRequestState(db, requestId, "needs_review", { actor: `operator:${admin.id}` });
    await audit(db, { actorId: admin.id, action: "external_link_attached", targetType: "track", targetId: t.rows[0].id, details: { requestId } });
    return t.rows[0].id as string;
  });
}

export async function approveCandidate(admin: SessionUser, trackId: string, input: { authorization: string }) {
  if (!input.authorization.trim()) throw new AdminError("authorization_statement_required");
  return tx(async (db) => {
    const t = (await db.query("select * from tracks where id = $1 for update", [trackId])).rows[0];
    if (!t) throw new AdminError("track_not_found");
    const cfg = await providerConfig(db);
    // Delivering provider (Suno) output to someone other than the operator requires a recorded agreement.
    if (t.source === "suno_manual" && t.owner_id !== admin.id && !cfg.commercial_agreement_evidence) {
      throw new AdminError("provider_agreement_required");
    }
    const prov = {
      ...t.provenance,
      authorization: input.authorization.slice(0, 500),
      reviewer: admin.id,
      reviewed_at: new Date().toISOString(),
      agreement_evidence_on_file: Boolean(cfg.commercial_agreement_evidence),
    };
    await db.query("update tracks set provenance = $2, rights_status = case when storage_key is null then 'external_link_only' else 'authorized' end where id = $1", [
      trackId, JSON.stringify(prov),
    ]);
    try {
      await publishTrack(db, trackId, admin.id);
    } catch (e) {
      throw new AdminError(e instanceof Error ? e.message : "publish_failed");
    }
    await audit(db, { actorId: admin.id, action: "candidate_approved", targetType: "track", targetId: trackId });
    return true;
  });
}

/** Rejecting a candidate never charges the listener; the request goes back to the operator queue. */
export async function rejectCandidate(admin: SessionUser, trackId: string, reason: string) {
  return tx(async (db) => {
    const t = (await db.query("select * from tracks where id = $1 for update", [trackId])).rows[0];
    if (!t || t.status !== "candidate") throw new AdminError("track_not_candidate");
    await db.query("update tracks set status = 'rejected', rights_status = 'rejected', reviewer_id = $2, reviewed_at = now(), provenance = provenance || $3 where id = $1", [
      trackId, admin.id, JSON.stringify({ rejection_reason: reason.slice(0, 300) }),
    ]);
    const open = await db.query("select 1 from tracks where request_id = $1 and status = 'candidate'", [t.request_id]);
    if (!open.rowCount) await setRequestState(db, t.request_id, "awaiting_operator", { actor: `operator:${admin.id}`, note: "candidate rejected", from: ["needs_review"] });
    await audit(db, { actorId: admin.id, action: "candidate_rejected", targetType: "track", targetId: trackId, details: { reason: reason.slice(0, 300) } });
    return true;
  });
}

/** Resolve an unknown_submission after checking the provider (operator confirms what happened). */
export async function reconcileUnknown(admin: SessionUser, requestId: string, outcome: { accepted: boolean; providerJobId?: string }) {
  return tx(async (db) => {
    const r = await lockRequest(db, requestId);
    if (r.state !== "unknown_submission") throw new AdminError("not_unknown");
    const a = (await db.query("select * from generation_attempts where request_id = $1 and state = 'unknown_submission' order by attempt_no desc limit 1", [requestId])).rows[0];
    if (outcome.accepted) {
      if (a) await db.query("update generation_attempts set state = 'submitted', provider_job_id = coalesce($2, provider_job_id) where id = $1", [a.id, outcome.providerJobId ?? null]);
      await setRequestState(db, requestId, r.provider_mode === "manual" ? "submitted" : "processing", { actor: `operator:${admin.id}`, note: "reconciled: accepted by provider" });
      if (r.provider_mode !== "manual") await enqueue(db, "audio", requestId, `audio:${requestId}:reconcile:${a?.id}`);
    } else {
      if (a) await db.query("update generation_attempts set state = 'failed', error_code = 'not_accepted', completed_at = now() where id = $1", [a.id]);
      await setRequestState(db, requestId, "queued", { actor: `operator:${admin.id}`, note: "reconciled: not accepted; safe to resubmit" });
      if (r.provider_mode === "manual") await setRequestState(db, requestId, "awaiting_operator", { actor: `operator:${admin.id}` });
      else await enqueue(db, "audio", requestId, `audio:${requestId}:resubmit:${a?.id}`);
    }
    await audit(db, { actorId: admin.id, action: "unknown_submission_reconciled", targetType: "generation_request", targetId: requestId, details: outcome });
  });
}

export async function cancelRequest(admin: SessionUser, requestId: string) {
  return tx(async (db) => {
    const r = await lockRequest(db, requestId);
    if (["ready", "cancelled"].includes(r.state)) throw new AdminError("request_closed");
    const sent = (await db.query("select count(*)::int as n from generation_attempts where request_id = $1 and state in ('submitted','processing','succeeded','unknown_submission')", [requestId])).rows[0].n;
    await setRequestState(db, requestId, "cancelled", {
      actor: `operator:${admin.id}`,
      note: sent ? "cancelled after provider acceptance — provider cost may still have been incurred" : "cancelled before sending",
    });
    await db.query("update job_queue set state = 'cancelled' where request_id = $1 and state = 'pending'", [requestId]);
    if (r.kind === "create_new") await releaseReservation(db, r.owner_id, requestId, "song", `reserve:${requestId}`);
    await audit(db, { actorId: admin.id, action: "request_cancelled", targetType: "generation_request", targetId: requestId, details: { providerAttemptsSent: sent } });
  });
}

/** Retry only the failed slot/asset: re-queue audio for a failed request, never touching its cover. */
export async function retryAudio(admin: SessionUser, requestId: string) {
  return tx(async (db) => {
    const r = await lockRequest(db, requestId);
    if (r.state !== "failed") throw new AdminError("not_failed");
    if (r.kind === "create_new") {
      const rel = await db.query("select 1 from usage_ledger where event_key = $1", [`release:${requestId}`]);
      if (rel.rowCount) throw new AdminError("reservation_released_ask_listener_to_resubmit");
    }
    await setRequestState(db, requestId, r.provider_mode === "manual" ? "awaiting_operator" : "queued", { actor: `operator:${admin.id}`, note: "retry" });
    if (r.provider_mode !== "manual") await enqueue(db, "audio", requestId, `audio:${requestId}:retry:${randomUUID()}`);
  });
}

export async function retryCover(admin: SessionUser, requestId: string) {
  await tx(async (db) => {
    await db.query("update covers set state = 'pending', updated_at = now() where request_id = $1 and state = 'failed'", [requestId]);
    await audit(db, { actorId: admin.id, action: "cover_retry", targetType: "generation_request", targetId: requestId });
  });
  await processCover(requestId);
}

export async function grantTestEntitlement(
  admin: SessionUser,
  input: { ownerId: string; quantity: number; source: "admin_test_grant" | "pilot_external_payment"; period?: string; note?: string },
) {
  return tx(async (db) => {
    const exists = await db.query("select 1 from profiles where id = $1", [input.ownerId]);
    if (!exists.rowCount) throw new AdminError("user_not_found");
    const q = Math.max(1, Math.min(20, Math.floor(input.quantity)));
    const key = input.source === "pilot_external_payment" && input.period ? `pilot:${input.ownerId}:${input.period}` : `admin:${randomUUID()}`;
    const ok = await grantSongs(db, { ownerId: input.ownerId, quantity: q, source: input.source, grantKey: key, period: input.period, note: input.note, grantedBy: admin.id });
    if (!ok) throw new AdminError("already_granted_for_period");
    await trackEvent(db, { ownerId: input.ownerId, name: "entitlement_granted", eventId: `grant:${key}`, props: { source: input.source, quantity: q } });
    await audit(db, { actorId: admin.id, action: "entitlement_granted", targetType: "profile", targetId: input.ownerId, details: { q, source: input.source, period: input.period } });
  });
}

export async function updateProviderConfig(
  admin: SessionUser,
  input: { mode?: string; dailyCap?: number; monthlyCap?: number; concurrency?: number; agreementEvidence?: string | null },
) {
  return tx(async (db) => {
    if (input.mode === "official_api") throw new AdminError("official_api_unavailable");
    await db.query(
      `update provider_configuration set
         mode = coalesce($1, mode), daily_call_cap = coalesce($2, daily_call_cap), monthly_call_cap = coalesce($3, monthly_call_cap),
         max_concurrency = coalesce($4, max_concurrency),
         commercial_agreement_evidence = case when $5::text is null then commercial_agreement_evidence when $5 = '' then null else $5 end,
         commercial_agreement_recorded_at = case when $5::text is null then commercial_agreement_recorded_at when $5 = '' then null else now() end,
         commercial_agreement_recorded_by = case when $5::text is null then commercial_agreement_recorded_by when $5 = '' then null else $6::uuid end,
         updated_at = now() where id = 1`,
      [input.mode ?? null, input.dailyCap ?? null, input.monthlyCap ?? null, input.concurrency ?? null, input.agreementEvidence ?? null, admin.id],
    );
    await audit(db, { actorId: admin.id, action: "provider_configuration_updated", details: { ...input, agreementEvidence: input.agreementEvidence ? "recorded" : input.agreementEvidence } });
  });
}

export async function findUser(query: string) {
  const db = pool();
  const { rows } = await db.query(
    `select p.id, p.display_name, u.email, p.is_demo, p.is_admin, p.created_at from profiles p join auth.users u on u.id = p.id
     where u.email ilike $1 or p.id::text = $2 or p.display_name ilike $1 limit 20`,
    [`%${query}%`, query],
  );
  return rows;
}

export { checkReleaseGate };

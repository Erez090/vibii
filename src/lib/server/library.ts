// Listener-facing reads (always under RLS via asUser) and listener actions.
import { asUser, tx, type Db } from "./db";
import type { SessionUser } from "./auth";
import { balances, lockOwner, redeemCredits, reserveSong } from "./ledger";
import { enqueue, providerConfig } from "./pipeline";
import { buildCreateNewBrief } from "../creative/brief";
import { trackEvent } from "./analytics";
import { setRequestState } from "./audit";

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  coverUrl: string | null;
  coverAlt: string | null;
  moment: string | null;
  energy: string | null;
  isDemoFixture: boolean;
  demoLabel: string | null;
  external: { url: string; service: string } | null;
  liked: boolean;
  feedback: string[];
  playlist: "starter" | "library";
  position: number;
}

export async function playerState(user: SessionUser) {
  return asUser(user.id, async (db) => {
    const profile = (await db.query("select last_tab, last_vibe, last_track_id, last_position_seconds, reveal_seen_at, ui_language from profiles where id = $1", [user.id])).rows[0];
    const st = (await db.query("select completed_at from onboarding_state where owner_id = $1", [user.id])).rows[0];
    const starter = (await db.query("select id, released_at from playlists where owner_id = $1 and kind = 'starter'", [user.id])).rows[0];
    let starterStatus: "none" | "waiting" | "delayed" | "manual_waiting" | "released" | "not_eligible" = "none";
    if (st?.completed_at && !starter) starterStatus = "not_eligible";
    if (starter && !starter.released_at) {
      const reqs = (await db.query("select state, provider_mode from generation_requests where playlist_id = $1", [starter.id])).rows;
      if (!reqs.length) starterStatus = "not_eligible";
      else if (reqs.some((r) => ["failed", "unknown_submission"].includes(r.state))) starterStatus = "delayed";
      else if (reqs.some((r) => r.provider_mode === "manual" || r.state === "awaiting_operator")) starterStatus = "manual_waiting";
      else starterStatus = "waiting";
    }
    if (starter?.released_at) starterStatus = "released";

    // Released starter tracks only (never leak the plan before reveal) + delivered library tracks.
    const { rows } = await db.query(
      `select t.id, t.title, t.artist_label, t.duration_seconds, t.moment, t.energy, t.is_demo_fixture, t.provenance->>'label' as demo_label,
              t.external_url, t.external_service, t.storage_key is not null as playable, t.request_id,
              p.kind as playlist_kind, pi.position, c.alt_text, c.state as cover_state
       from tracks t
       join playlist_items pi on pi.track_id = t.id
       join playlists p on p.id = pi.playlist_id
       left join covers c on c.request_id = t.request_id
       where t.owner_id = $1 and t.status = 'approved' and (p.kind = 'library' or p.released_at is not null)
       order by p.kind desc, pi.position`,
      [user.id],
    );
    const fb = (await db.query("select track_id, action from feedback where owner_id = $1 order by created_at", [user.id])).rows;
    const tracks: PlayerTrack[] = rows.map((r) => {
      const actions = fb.filter((f) => f.track_id === r.id).map((f) => f.action as string);
      const likeState = actions.filter((a) => a === "like" || a === "unlike").pop();
      return {
        id: r.id, title: r.title, artist: r.artist_label, durationSeconds: r.duration_seconds ? Number(r.duration_seconds) : null,
        coverUrl: r.cover_state === "ready" ? `/api/covers/${r.request_id}` : null, coverAlt: r.alt_text,
        moment: r.moment, energy: r.energy, isDemoFixture: r.is_demo_fixture, demoLabel: r.demo_label,
        external: !r.playable && r.external_url ? { url: r.external_url, service: r.external_service ?? "Suno" } : null,
        liked: likeState === "like", feedback: actions.filter((a) => !["like", "unlike"].includes(a)),
        playlist: r.playlist_kind, position: r.position,
      };
    });
    const b = await balances(db, user.id);
    return {
      onboardingComplete: Boolean(st?.completed_at),
      starterStatus,
      revealSeen: Boolean(profile?.reveal_seen_at),
      lastTrackId: profile?.last_track_id ?? null,
      lastPosition: Number(profile?.last_position_seconds ?? 0),
      lastVibe: profile?.last_vibe ?? null,
      tracks,
      balances: b,
    };
  });
}

/** Transparent ranking: explicit feedback first. Not a trained model. */
export function rankForVibe(tracks: PlayerTrack[], vibe: string | null) {
  const inVibe = vibe && vibe !== "all" ? tracks.filter((t) => t.moment === vibe || (vibe === "focus" && t.moment === "work")) : tracks;
  const score = (t: PlayerTrack) => (t.liked ? 2 : 0) - (t.feedback.includes("not_my_taste") ? 5 : 0);
  return [...inVibe].sort((a, b) => score(b) - score(a) || (a.playlist === b.playlist ? a.position - b.position : a.playlist === "starter" ? -1 : 1));
}

export async function myRequests(user: SessionUser) {
  return asUser(user.id, async (db) => {
    const { rows } = await db.query(
      `select r.id, r.kind, r.state, r.provider_mode, r.title, r.summary, r.created_at, r.ready_at, r.variation_of,
         (select t.id from tracks t where t.request_id = r.id and t.status = 'approved') as track_id
       from generation_requests r where r.owner_id = $1 and r.kind = 'create_new' order by r.created_at desc limit 50`,
      [user.id],
    );
    return rows;
  });
}

export interface CreateNewInput {
  forWhom: "me" | "gift";
  topic: string;
  language: string;
  vibe: string;
  story: string;
  useStory: boolean;
  variationOf?: string | null;
  confirmed: boolean;
}

/** Idempotent create: same (owner, key) returns the same request; quota reserved exactly once. */
export async function createNewRequest(user: SessionUser, input: CreateNewInput, idempotencyKey: string) {
  if (!input.confirmed) return { ok: false as const, code: "confirmation_required" };
  return tx(async (db) => {
    await lockOwner(db, user.id);
    const existing = await db.query("select id, state from generation_requests where owner_id = $1 and idempotency_key = $2", [user.id, idempotencyKey]);
    if (existing.rowCount) return { ok: true as const, requestId: existing.rows[0].id as string, duplicate: true };
    if (input.variationOf) {
      const v = await db.query("select 1 from generation_requests where id = $1 and owner_id = $2", [input.variationOf, user.id]);
      if (!v.rowCount) return { ok: false as const, code: "not_found" };
    }
    const b = await balances(db, user.id);
    if (b.songsAvailable < 1) return { ok: false as const, code: "no_entitlement" };
    const cfg = await providerConfig(db);
    const consent = (await db.query("select provider_processing from consent_records where owner_id = $1 order by created_at desc limit 1", [user.id])).rows[0];
    const mode = consent && !consent.provider_processing ? "demo" : cfg.mode;
    const brief = buildCreateNewBrief(input);
    const summary = { forWhom: input.forWhom, topic: input.topic.slice(0, 80), language: input.language, vibe: input.vibe, usesStory: input.useStory && !!input.story };
    const r = await db.query(
      `insert into generation_requests(owner_id, kind, idempotency_key, provider_mode, brief, brief_version, title, summary, variation_of, quota_source)
       values ($1,'create_new',$2,$3,$4,1,$5,$6,$7,'song') returning id`,
      [user.id, idempotencyKey, mode, JSON.stringify(brief), brief.title, JSON.stringify(summary), input.variationOf ?? null],
    );
    const requestId = r.rows[0].id as string;
    if (!(await reserveSong(db, user.id, requestId))) throw new Error("reservation_failed");
    await db.query("insert into generation_request_events(request_id, owner_id, to_state, actor) values ($1,$2,'queued','user')", [requestId, user.id]);
    await db.query(
      "insert into covers(owner_id, request_id, art_brief, palette, motif, alt_text) values ($1,$2,$3,$4,$5,$6)",
      [user.id, requestId, JSON.stringify(brief.art), brief.art.palette, brief.art.motif, brief.art.alt],
    );
    await enqueue(db, "cover", requestId, `cover:${requestId}`);
    if (mode === "manual") await setRequestState(db, requestId, "awaiting_operator", { actor: "system", note: "manual delivery" });
    else await enqueue(db, "audio", requestId, `audio:${requestId}`);
    await trackEvent(db, { ownerId: user.id, name: "request_created", eventId: `request_created:${requestId}`, props: { kind: "create_new", mode } });
    return { ok: true as const, requestId, duplicate: false };
  });
}

export async function redeem(user: SessionUser, key: string) {
  return tx((db) => redeemCredits(db, user.id, `${user.id}:${key}`));
}

const FEEDBACK = new Set(["like", "unlike", "more_bass", "less_lyrics", "too_slow", "not_my_taste"]);
export async function addFeedback(user: SessionUser, trackId: string, action: string) {
  if (!FEEDBACK.has(action)) throw new Error("invalid_feedback");
  return asUser(user.id, async (db) => {
    const t = await db.query("select id from tracks where id = $1", [trackId]); // RLS: own + approved only
    if (!t.rowCount) return false;
    await db.query("insert into feedback(owner_id, track_id, action) values ($1,$2,$3)", [user.id, trackId, action]);
    return true;
  });
}

export async function savePlayerPosition(user: SessionUser, p: { tab?: string; vibe?: string | null; trackId?: string | null; position?: number }) {
  return asUser(user.id, (db) =>
    db.query(
      `update profiles set last_tab = coalesce($2, last_tab), last_vibe = coalesce($3, last_vibe),
         last_track_id = coalesce($4, last_track_id), last_position_seconds = coalesce($5, last_position_seconds), updated_at = now()
       where id = $1`,
      [user.id, p.tab ?? null, p.vibe ?? null, p.trackId ?? null, p.position ?? null],
    ),
  );
}

export async function markRevealSeen(user: SessionUser) {
  await tx((db) => db.query("update profiles set reveal_seen_at = coalesce(reveal_seen_at, now()) where id = $1", [user.id]));
}

export async function ownsTrack(db: Db, trackId: string) {
  const { rows } = await db.query("select id, storage_key, external_url from tracks where id = $1", [trackId]);
  return rows[0] ?? null;
}

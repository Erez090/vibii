// Onboarding persistence, credit awards, stale-branch cleanup, the private draft plan and the
// atomic completion that freezes the profile and queues exactly seven slots (+ seven cover tasks).
import type { Db } from "./db";
import {
  type Answers, type Category, type ConsentChoice, CORE_CATEGORIES, FOLLOWUPS, autoSkipped, isComplete,
  sanitizeAnswer, screenSequence, staleFollowups, PERSONAL_CATEGORIES,
} from "../onboarding";
import { planAlbum, type AlbumPlan } from "../creative/planner";
import { buildBrief } from "../creative/brief";
import { awardCategoryCredits, balances, grantAndReserveStarter, lockOwner } from "./ledger";
import { enqueue, providerConfig } from "./pipeline";
import { setRequestState } from "./audit";
import { trackEvent } from "./analytics";
import type { SessionUser } from "./auth";

export const CONSENT_VERSION = 1;
const VALID = new Set<string>([...CORE_CATEGORIES, ...FOLLOWUPS]);

export async function loadAnswers(db: Db, ownerId: string): Promise<Answers> {
  const { rows } = await db.query("select category, value, skipped, is_private from onboarding_answers where owner_id = $1", [ownerId]);
  const out: Answers = {};
  for (const r of rows) out[r.category as Category] = { value: r.value, skipped: r.skipped, isPrivate: r.is_private };
  return out;
}

export async function latestConsent(db: Db, ownerId: string): Promise<(ConsentChoice & { id: string; version: number }) | null> {
  const { rows } = await db.query(
    "select id, version, personal_details, provider_processing from consent_records where owner_id = $1 order by created_at desc, id desc limit 1",
    [ownerId],
  );
  const r = rows[0];
  return r ? { id: r.id, version: r.version, personalDetails: r.personal_details, providerProcessing: r.provider_processing } : null;
}

async function ensureState(db: Db, ownerId: string) {
  const res = await db.query("insert into onboarding_state(owner_id) values ($1) on conflict do nothing", [ownerId]);
  return res.rowCount === 1;
}

async function award(db: Db, user: SessionUser, category: Category) {
  if (!user.identityKey || !(CORE_CATEGORIES as readonly string[]).includes(category)) return false;
  return awardCategoryCredits(db, user.id, user.identityKey, category);
}

async function refreshDraftPlan(db: Db, ownerId: string, answers: Answers, consent: ConsentChoice | null) {
  if (!consent) return;
  const st = await db.query("update onboarding_state set profile_version = profile_version + 1, updated_at = now() where owner_id = $1 returning profile_version, completed_at", [ownerId]);
  if (st.rows[0]?.completed_at) return; // released/queued albums are never re-planned
  const plan = planAlbum(answers, consent, st.rows[0].profile_version);
  // Reversible, private, no provider spend: style palettes and permitted briefs only.
  const draft = { plan, briefs: plan.slots.map((slot) => buildBrief(slot)) };
  await db.query("update onboarding_state set draft_plan = $2 where owner_id = $1", [ownerId, JSON.stringify(draft)]);
}

export async function startOnboarding(db: Db, user: SessionUser) {
  if (await ensureState(db, user.id)) {
    await trackEvent(db, { ownerId: user.id, name: "onboarding_started", eventId: `onboarding_started:${user.id}` });
  }
}

export async function recordConsent(db: Db, user: SessionUser, choice: ConsentChoice & { llm?: boolean }) {
  await lockOwner(db, user.id);
  await ensureState(db, user.id);
  const prev = await latestConsent(db, user.id);
  await db.query(
    "insert into consent_records(owner_id, version, personal_details, provider_processing, llm_processing) values ($1,$2,$3,$4,$5)",
    [user.id, CONSENT_VERSION, choice.personalDetails, choice.providerProcessing, Boolean(choice.llm)],
  );
  if (!choice.personalDetails) {
    // Taste-only path: drop any household details already given, record the personal categories as skipped.
    await db.query("delete from onboarding_answers where owner_id = $1 and category = any($2)", [user.id, PERSONAL_CATEGORIES]);
    for (const c of autoSkipped(choice)) {
      await db.query(
        "insert into onboarding_answers(owner_id, category, value, skipped) values ($1,$2,'{}',true) on conflict do nothing",
        [user.id, c],
      );
      await award(db, user, c);
    }
  } else if (prev && !prev.personalDetails) {
    // Re-opted in: remove the auto-skips so those screens are asked again.
    await db.query("delete from onboarding_answers where owner_id = $1 and category = any($2) and skipped and value = '{}'::jsonb", [user.id, PERSONAL_CATEGORIES]);
  }
  if (prev?.providerProcessing && !choice.providerProcessing) await stopUnsentExternalWork(db, user.id);
  const answers = await loadAnswers(db, user.id);
  await refreshDraftPlan(db, user.id, answers, choice);
  return maybeComplete(db, user, answers, choice);
}

export async function saveAnswer(
  db: Db,
  user: SessionUser,
  input: { category: string; value: Record<string, unknown>; skipped: boolean; isPrivate: boolean },
) {
  if (!VALID.has(input.category)) throw new Error("invalid_category");
  const category = input.category as Category;
  await lockOwner(db, user.id);
  await ensureState(db, user.id);
  const consent = await latestConsent(db, user.id);
  if (!consent) throw new Error("consent_required");
  if (!consent.personalDetails && PERSONAL_CATEGORIES.includes(category)) throw new Error("not_permitted_by_consent");
  const value = input.skipped ? {} : sanitizeAnswer(category, input.value);
  await db.query(
    `insert into onboarding_answers(owner_id, category, value, skipped, is_private, updated_at) values ($1,$2,$3,$4,$5,now())
     on conflict (owner_id, category) do update set value = excluded.value, skipped = excluded.skipped,
       is_private = excluded.is_private, updated_at = now()`,
    [user.id, category, JSON.stringify(value), input.skipped, input.isPrivate],
  );
  let answers = await loadAnswers(db, user.id);
  const stale = staleFollowups(answers, consent);
  if (stale.length) {
    await db.query("delete from onboarding_answers where owner_id = $1 and category = any($2)", [user.id, stale]);
    answers = await loadAnswers(db, user.id);
  }
  if (category === "display_name" && !input.skipped && value.text) {
    await db.query("update profiles set display_name = $2, updated_at = now() where id = $1", [user.id, value.text]);
  }
  const awarded = await award(db, user, category);
  await db.query("update onboarding_state set current_step = $2 where owner_id = $1", [user.id, category]);
  await refreshDraftPlan(db, user.id, answers, consent);
  const res = await maybeComplete(db, user, answers, consent);
  return { ...res, awarded, removedFollowups: stale };
}

async function maybeComplete(db: Db, user: SessionUser, answers: Answers, consent: ConsentChoice & { id?: string }) {
  const st = (await db.query("select completed_at from onboarding_state where owner_id = $1", [user.id])).rows[0];
  if (st?.completed_at) return { completed: true, justCompleted: false };
  if (!isComplete(answers, consent)) return { completed: false, justCompleted: false };
  await completeOnboarding(db, user, answers, consent);
  return { completed: true, justCompleted: true };
}

/**
 * Atomic completion: freeze profile + consent version, reserve the once-per-identity starter album,
 * create one starter playlist with ALBUM_SIZE (7) unique slots and enqueue one audio + one cover task each.
 * Re-entrant: unique keys make a double tap / reload return the same album.
 */
export async function completeOnboarding(db: Db, user: SessionUser, answers: Answers, consent: ConsentChoice & { id?: string }) {
  const c = consent.id ? consent : await latestConsent(db, user.id);
  const state = await db.query(
    "update onboarding_state set completed_at = now(), frozen_profile = $2, frozen_consent_id = $3 where owner_id = $1 and completed_at is null returning started_at, profile_version",
    [user.id, JSON.stringify(answers), c && "id" in c ? c.id : null],
  );
  if (!state.rowCount) return null;
  await db.query(
    "insert into playlists(owner_id, kind, name) select $1, 'library', 'My Vibii songs' where not exists (select 1 from playlists where owner_id = $1 and kind = 'library')",
    [user.id],
  );
  const pl = await db.query(
    `insert into playlists(owner_id, kind, name) values ($1,'starter','Your first Vibii playlist')
     on conflict (owner_id) where kind = 'starter' do nothing returning id`,
    [user.id],
  );
  const playlistId: string =
    pl.rows[0]?.id ?? (await db.query("select id from playlists where owner_id = $1 and kind = 'starter'", [user.id])).rows[0].id;

  const durationMs = Date.now() - new Date(state.rows[0].started_at).getTime();
  await trackEvent(db, {
    ownerId: user.id, name: "onboarding_completed", eventId: `onboarding_completed:${user.id}`,
    props: { duration_ms: durationMs, taste_only: !consent.personalDetails },
  });

  if (!user.identityKey || !(await grantAndReserveStarter(db, user.id, user.identityKey, playlistId))) {
    return { playlistId, starter: false };
  }
  const cfg = await providerConfig(db);
  const mode = consent.providerProcessing ? cfg.mode : "demo"; // declined processing → existing authorized audio only
  const plan: AlbumPlan = planAlbum(answers, consent, state.rows[0].profile_version);
  for (const slot of plan.slots) {
    const brief = buildBrief(slot);
    const r = await db.query(
      `insert into generation_requests(owner_id, kind, playlist_id, slot, idempotency_key, provider_mode, brief, brief_version, title, quota_source)
       values ($1,'starter_slot',$2,$3,$4,$5,$6,1,$7,'starter_album')
       on conflict (owner_id, idempotency_key) do nothing returning id`,
      [user.id, playlistId, slot.slot, `starter:${playlistId}:${slot.slot}`, mode, JSON.stringify({ ...brief, plan: slot }), brief.title],
    );
    if (!r.rowCount) continue;
    const requestId = r.rows[0].id;
    await db.query("insert into playlist_items(playlist_id, owner_id, request_id, position) values ($1,$2,$3,$4) on conflict do nothing", [
      playlistId, user.id, requestId, slot.slot,
    ]);
    await db.query(
      "insert into covers(owner_id, request_id, art_brief, palette, motif, alt_text) values ($1,$2,$3,$4,$5,$6) on conflict do nothing",
      [user.id, requestId, JSON.stringify(brief.art), brief.art.palette, brief.art.motif, brief.art.alt],
    );
    await db.query(
      "insert into generation_request_events(request_id, owner_id, to_state, actor) values ($1,$2,'queued','system')",
      [requestId, user.id],
    );
    await enqueue(db, "cover", requestId, `cover:${requestId}`);
    if (mode === "manual") {
      await setRequestState(db, requestId, "awaiting_operator", { actor: "system", note: "manual delivery" });
    } else {
      await enqueue(db, "audio", requestId, `audio:${requestId}`);
    }
    await trackEvent(db, { ownerId: user.id, name: "request_created", eventId: `request_created:${requestId}`, props: { kind: "starter_slot", mode } });
  }
  return { playlistId, starter: true };
}

/** Consent withdrawn: stop work that has not been sent anywhere; switch unsent starter slots to authorized fixtures. */
export async function stopUnsentExternalWork(db: Db, ownerId: string) {
  const { rows } = await db.query(
    `select id, kind from generation_requests where owner_id = $1 and provider_mode <> 'demo'
       and state in ('queued','preparing','awaiting_operator')
       and not exists (select 1 from generation_attempts a where a.request_id = generation_requests.id and a.state <> 'created')`,
    [ownerId],
  );
  for (const r of rows) {
    await db.query("update job_queue set state = 'cancelled' where request_id = $1 and kind = 'audio' and state = 'pending'", [r.id]);
    if (r.kind === "starter_slot") {
      await db.query("update generation_requests set provider_mode = 'demo', state = 'queued', updated_at = now() where id = $1", [r.id]);
      await db.query(
        "insert into job_queue(kind, request_id, unique_key) values ('audio',$1,$2) on conflict (unique_key) do nothing",
        [r.id, `audio:${r.id}:consent_fallback`],
      );
    } else {
      await setRequestState(db, r.id, "cancelled", { actor: "user", note: "consent withdrawn before sending" });
    }
  }
  return rows.length;
}

export async function onboardingSnapshot(db: Db, user: SessionUser) {
  const answers = await loadAnswers(db, user.id);
  const consent = await latestConsent(db, user.id);
  const st = (await db.query("select completed_at, current_step from onboarding_state where owner_id = $1", [user.id])).rows[0];
  const b = await balances(db, user.id);
  return {
    answers,
    consent: consent ? { personalDetails: consent.personalDetails, providerProcessing: consent.providerProcessing } : null,
    sequence: screenSequence(answers, consent),
    completed: Boolean(st?.completed_at),
    currentStep: st?.current_step ?? null,
    displayName: user.displayName, // prefill for the nickname screen (e.g. from Google)
    credits: b.credits,
  };
}

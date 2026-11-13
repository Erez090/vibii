// Product analytics. Only whitelisted, non-personal props are stored — never story text,
// names or answer values. Events are de-duplicated by event_id. Demo/admin accounts are flagged
// `excluded` and left out of operator metrics.
import type { Db } from "./db";

export const EVENT_NAMES = [
  "onboarding_started", "onboarding_completed", "request_created", "first_track_ready", "playback_started",
  "listening_heartbeat", "track_liked", "skip", "return_on_another_day", "request_failed", "entitlement_granted",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const ALLOWED_PROPS = new Set(["kind", "code", "mode", "slot", "category_count", "duration_ms", "path", "source", "quantity", "taste_only"]);

export function cleanProps(props: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 40);
  }
  return out;
}

export async function trackEvent(
  db: Db,
  e: { ownerId: string | null; name: EventName; eventId: string; sessionId?: string; props?: Record<string, unknown> },
) {
  await db.query(
    `insert into analytics_events(owner_id, session_id, event_id, name, props, excluded)
     values ($1,$2,$3,$4,$5, coalesce((select is_demo or is_admin from profiles where id = $1), false))
     on conflict (event_id) do nothing`,
    [e.ownerId, e.sessionId ?? null, e.eventId, e.name, JSON.stringify(cleanProps(e.props ?? {}))],
  );
}

import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";
import { asUser, tx } from "@/lib/server/db";
import { trackEvent } from "@/lib/server/analytics";

const LISTEN = new Set(["playback_started", "heartbeat", "skip", "ended", "paused"]);

// Listening telemetry. Seconds come from the client's measured play time (only while actually playing),
// are capped per event, and de-duplicated by event_id.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`ev:${u.id}`, 240, 60);
    const b = await req.json();
    const event = String(b.event);
    const eventId = String(b.eventId ?? "").slice(0, 80);
    const sessionId = String(b.sessionId ?? "").slice(0, 80);
    if (!LISTEN.has(event) || !eventId || !sessionId) return json({ error: "invalid_event" }, 400);
    const trackId = typeof b.trackId === "string" && /^[0-9a-f-]{36}$/.test(b.trackId) ? b.trackId : null;
    const seconds = Math.max(0, Math.min(120, Number(b.listenedSeconds) || 0));
    const owned = trackId ? await asUser(u.id, async (db) => (await db.query("select 1 from tracks where id = $1", [trackId])).rowCount) : 0;
    if (!owned) return json({ error: "not_found" }, 404);
    await tx(async (db) => {
      const ins = await db.query(
        `insert into listening_events(owner_id, track_id, session_id, event_id, event, listened_seconds, excluded)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (owner_id, event_id) do nothing`,
        [u.id, trackId, sessionId, eventId, event, seconds, u.isDemo || u.isAdmin],
      );
      if (!ins.rowCount) return;
      const name = event === "heartbeat" ? "listening_heartbeat" : event === "skip" ? "skip" : event === "playback_started" ? "playback_started" : null;
      if (name) await trackEvent(db, { ownerId: u.id, name, eventId: `${name}:${u.id}:${eventId}`, sessionId });
      if (event === "playback_started") {
        const prior = await db.query(
          "select 1 from listening_events where owner_id = $1 and track_id = $2 and event = 'playback_started' and occurred_at::date < current_date limit 1",
          [u.id, trackId],
        );
        if (prior.rowCount) await trackEvent(db, { ownerId: u.id, name: "return_on_another_day", eventId: `return:${u.id}:${trackId}:${new Date().toISOString().slice(0, 10)}`, sessionId });
      }
    });
    return json({ ok: true });
  });
}

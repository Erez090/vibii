import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";
import { addFeedback } from "@/lib/server/library";
import { tx } from "@/lib/server/db";
import { trackEvent } from "@/lib/server/analytics";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`fb:${u.id}`, 120, 60);
    const { id } = await params;
    const b = await req.json();
    const ok = await addFeedback(u, id, String(b.action));
    if (!ok) return json({ error: "not_found" }, 404);
    if (b.action === "like") await tx((db) => trackEvent(db, { ownerId: u.id, name: "track_liked", eventId: `like:${u.id}:${id}` }));
    return json({ ok: true });
  });
}

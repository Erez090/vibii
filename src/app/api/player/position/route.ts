import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { savePlayerPosition } from "@/lib/server/library";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const b = await req.json();
    const tab = ["dj", "vibes", "create"].includes(b.tab) ? b.tab : undefined;
    const trackId = typeof b.trackId === "string" && /^[0-9a-f-]{36}$/.test(b.trackId) ? b.trackId : undefined;
    const position = Number.isFinite(b.position) ? Math.max(0, Math.min(36000, Number(b.position))) : undefined;
    const vibe = typeof b.vibe === "string" ? b.vibe.slice(0, 30) : undefined;
    await savePlayerPosition(u, { tab, trackId, position, vibe });
    return json({ ok: true });
  });
}

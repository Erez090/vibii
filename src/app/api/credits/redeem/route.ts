import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";
import { redeem } from "@/lib/server/library";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`redeem:${u.id}`, 10, 3600);
    const b = await req.json();
    const key = String(b.idempotencyKey ?? "");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return json({ error: "idempotency_key_required" }, 400);
    const r = await redeem(u, key);
    return r.ok ? json(r) : json({ error: r.reason }, 402);
  });
}

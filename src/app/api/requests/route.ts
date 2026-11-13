import { after } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";
import { createNewRequest, myRequests } from "@/lib/server/library";
import { tx } from "@/lib/server/db";
import { balances } from "@/lib/server/ledger";
import { providerConfig } from "@/lib/server/pipeline";
import { kickPipeline } from "@/lib/server/kick";

export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    const [requests, b, cfg] = await Promise.all([myRequests(u), tx((db) => balances(db, u.id)), tx((db) => providerConfig(db))]);
    return json({ requests, balances: b, deliveryMode: cfg.mode });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`create:${u.id}`, 10, 3600);
    const b = await req.json();
    const key = String(b.idempotencyKey ?? "");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return json({ error: "idempotency_key_required" }, 400);
    const res = await createNewRequest(
      u,
      {
        forWhom: b.forWhom === "gift" ? "gift" : "me",
        topic: String(b.topic ?? "").slice(0, 120),
        language: String(b.language ?? "en").slice(0, 20),
        vibe: String(b.vibe ?? "chill").slice(0, 20),
        story: String(b.story ?? "").slice(0, 600),
        useStory: Boolean(b.useStory),
        variationOf: typeof b.variationOf === "string" ? b.variationOf : null,
        confirmed: b.confirmed === true,
      },
      key,
    );
    if (!res.ok) return json({ error: res.code }, res.code === "no_entitlement" ? 402 : 400);
    if (!res.duplicate) after(kickPipeline);
    return json(res);
  });
}

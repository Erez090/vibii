import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { asUser } from "@/lib/server/db";
import { signedUrl } from "@/lib/server/storage";
import { ownsTrack } from "@/lib/server/library";

// Ownership is checked under RLS (own + approved only) before any URL is signed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "not_found" }, 404);
    const t = await asUser(u.id, (db) => ownsTrack(db, id));
    if (!t) return json({ error: "not_found" }, 404);
    if (!t.storage_key) return json({ error: "external_only", externalUrl: t.external_url }, 409);
    return json(await signedUrl(t.storage_key));
  });
}

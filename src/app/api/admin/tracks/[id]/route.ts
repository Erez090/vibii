import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { approveCandidate, rejectCandidate } from "@/lib/server/admin-service";
import { pool } from "@/lib/server/db";
import { signedUrl } from "@/lib/server/storage";

// Operator preview of a private candidate (admin only; short-lived signed URL).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const t = (await pool().query("select storage_key from tracks where id = $1", [id])).rows[0];
    if (!t?.storage_key) return json({ error: "not_found" }, 404);
    return json(await signedUrl(t.storage_key));
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const b = await req.json();
    if (b.action === "approve") await approveCandidate(admin, id, { authorization: String(b.authorization ?? "") });
    else if (b.action === "reject") await rejectCandidate(admin, id, String(b.reason ?? ""));
    else return json({ error: "unknown_action" }, 400);
    return json({ ok: true });
  });
}

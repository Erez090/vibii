import { requireUser } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";

export async function GET(_req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const u = await requireUser().catch(() => null);
  if (!u) return new Response("unauthorized", { status: 401 });
  const { requestId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(requestId)) return new Response("not found", { status: 404 });
  // RLS: only the owner's cover; and only once the matching track is visible (approved).
  const row = await asUser(u.id, async (db) =>
    (await db.query(
      "select c.svg from covers c where c.request_id = $1 and c.state = 'ready' and exists (select 1 from tracks t where t.request_id = c.request_id)",
      [requestId],
    )).rows[0],
  );
  if (!row?.svg) return new Response("not found", { status: 404 });
  return new Response(row.svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=3600", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
}

import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { grantTestEntitlement } from "@/lib/server/admin-service";

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const b = await req.json();
    await grantTestEntitlement(admin, {
      ownerId: String(b.ownerId), quantity: Number(b.quantity ?? 1),
      source: b.source === "pilot_external_payment" ? "pilot_external_payment" : "admin_test_grant",
      period: typeof b.period === "string" && /^\d{4}-\d{2}$/.test(b.period) ? b.period : undefined,
      note: typeof b.note === "string" ? b.note.slice(0, 200) : undefined,
    });
    return json({ ok: true });
  });
}

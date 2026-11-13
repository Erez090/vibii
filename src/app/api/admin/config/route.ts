import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { updateProviderConfig } from "@/lib/server/admin-service";

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const b = await req.json();
    const int = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : undefined);
    await updateProviderConfig(admin, {
      mode: ["demo", "manual", "official_api"].includes(b.mode) ? b.mode : undefined,
      dailyCap: int(b.dailyCap), monthlyCap: int(b.monthlyCap), concurrency: int(b.concurrency),
      agreementEvidence: typeof b.agreementEvidence === "string" ? b.agreementEvidence.slice(0, 1000) : undefined,
    });
    return json({ ok: true });
  });
}

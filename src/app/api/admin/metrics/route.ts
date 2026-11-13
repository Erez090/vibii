import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { computeMetrics } from "@/lib/server/metrics";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const to = sp.get("to") ? new Date(sp.get("to")!) : new Date();
    const from = sp.get("from") ? new Date(sp.get("from")!) : new Date(to.getTime() - 30 * 86400000);
    return json(await computeMetrics(from, to));
  });
}

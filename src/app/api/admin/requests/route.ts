import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { listRequests } from "@/lib/server/admin-service";
import { tx } from "@/lib/server/db";
import { providerConfig } from "@/lib/server/pipeline";
import { officialApiProvider } from "@/lib/server/providers";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const state = new URL(req.url).searchParams.get("state") || undefined;
    const [requests, config] = await Promise.all([listRequests({ state }), tx((db) => providerConfig(db))]);
    return json({ requests, config, officialApi: officialApiProvider.availability() });
  });
}

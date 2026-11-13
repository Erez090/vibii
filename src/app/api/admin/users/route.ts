import { requireAdmin } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { findUser } from "@/lib/server/admin-service";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
    return json({ users: q ? await findUser(q) : [] });
  });
}

import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { markRevealSeen } from "@/lib/server/library";

export async function POST() {
  return handle(async () => {
    await markRevealSeen(await requireUser());
    return json({ ok: true });
  });
}

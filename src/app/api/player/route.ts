import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { playerState } from "@/lib/server/library";

export async function GET() {
  return handle(async () => json(await playerState(await requireUser())));
}

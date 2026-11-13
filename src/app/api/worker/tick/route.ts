import { timingSafeEqual } from "node:crypto";
import { json } from "@/lib/server/http";
import { tick } from "@/lib/server/pipeline";
import { processDeletionJobs } from "@/lib/server/account";

// Bounded queue tick for schedulers (e.g. Vercel Cron). Requires CRON_SECRET as a Bearer token.
export const maxDuration = 60;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return json({ error: "unauthorized" }, 401);
  const processed = await tick(20);
  await processDeletionJobs();
  return json({ processed });
}

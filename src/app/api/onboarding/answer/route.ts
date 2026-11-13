import { after } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";
import { tx } from "@/lib/server/db";
import { onboardingSnapshot, saveAnswer } from "@/lib/server/onboarding-service";
import { kickPipeline } from "@/lib/server/kick";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`onb:${u.id}`, 300, 3600);
    const b = await req.json();
    const res = await tx((db) =>
      saveAnswer(db, u, { category: String(b.category), value: typeof b.value === "object" && b.value ? b.value : {}, skipped: Boolean(b.skipped), isPrivate: Boolean(b.isPrivate) }),
    );
    if (res.justCompleted) after(kickPipeline);
    const snap = await tx((db) => onboardingSnapshot(db, u));
    return json({ ...snap, awarded: res.awarded, justCompleted: res.justCompleted, removedFollowups: res.removedFollowups });
  });
}

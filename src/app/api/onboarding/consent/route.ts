import { after } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";
import { tx } from "@/lib/server/db";
import { onboardingSnapshot, recordConsent } from "@/lib/server/onboarding-service";
import { kickPipeline } from "@/lib/server/kick";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    await rateLimit(`onb:${u.id}`, 300, 3600);
    const b = await req.json();
    const res = await tx((db) => recordConsent(db, u, { personalDetails: Boolean(b.personalDetails), providerProcessing: Boolean(b.providerProcessing), llm: Boolean(b.llm) }));
    if (res.justCompleted) after(kickPipeline);
    return json({ ...(await tx((db) => onboardingSnapshot(db, u))), justCompleted: res.justCompleted });
  });
}

import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { tx } from "@/lib/server/db";
import { onboardingSnapshot, startOnboarding } from "@/lib/server/onboarding-service";

export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    const snap = await tx(async (db) => {
      await startOnboarding(db, u);
      return onboardingSnapshot(db, u);
    });
    return json(snap);
  });
}

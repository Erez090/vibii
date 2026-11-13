import { getUser } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { balances } from "@/lib/server/ledger";
import { latestConsent } from "@/lib/server/onboarding-service";
import { ProfileClient } from "@/components/ProfileClient";

export default async function Profile() {
  const user = (await getUser())!;
  const [b, consent] = await tx(async (db) => [await balances(db, user.id), await latestConsent(db, user.id)] as const);
  return (
    <ProfileClient
      user={{ displayName: user.displayName, email: user.email, isAdmin: user.isAdmin, isDemo: user.isDemo, uiLanguage: user.uiLanguage }}
      balances={b}
      consent={consent ? { personalDetails: consent.personalDetails, providerProcessing: consent.providerProcessing } : null}
    />
  );
}

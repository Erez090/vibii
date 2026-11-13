import { redirect } from "next/navigation";
import { getUser } from "@/lib/server/auth";
import { authMode } from "@/lib/server/env";
import { tx } from "@/lib/server/db";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (authMode() === "unconfigured") redirect("/login");
  const user = await getUser();
  if (!user) redirect("/login");
  const st = await tx(async (db) => (await db.query("select completed_at from onboarding_state where owner_id = $1", [user.id])).rows[0]);
  if (!st?.completed_at) redirect("/onboarding");
  return (
    <PlayerProvider>
      <AppShell isDemo={user.isDemo}>{children}</AppShell>
    </PlayerProvider>
  );
}

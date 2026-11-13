import { redirect } from "next/navigation";
import { getUser } from "@/lib/server/auth";
import { authMode } from "@/lib/server/env";
import { Onboarding } from "@/components/onboarding/Onboarding";

export default async function Page() {
  if (authMode() === "unconfigured") redirect("/login");
  const user = await getUser();
  if (!user) redirect("/login");
  return <Onboarding />;
}

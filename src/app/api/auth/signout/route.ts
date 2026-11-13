import { cookies } from "next/headers";
import { DEMO_COOKIE, supabaseServer } from "@/lib/server/auth";
import { authMode } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";

export async function POST() {
  return handle(async () => {
    if (authMode() === "supabase") await (await supabaseServer()).auth.signOut();
    (await cookies()).delete(DEMO_COOKIE);
    return json({ ok: true });
  });
}

import { redirect } from "next/navigation";
import { authMode } from "@/lib/server/env";
import { getUser } from "@/lib/server/auth";
import { LoginClient } from "@/components/LoginClient";

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const mode = authMode();
  const user = mode === "unconfigured" ? null : await getUser().catch(() => null);
  if (user) redirect("/");
  const sp = await searchParams;
  return (
    <LoginClient
      mode={mode}
      supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? null}
      supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null}
      notice={sp.deleted ? "deleted" : sp.expired ? "expired" : sp.error ? "error" : null}
    />
  );
}

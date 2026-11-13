// Server configuration. Nothing in here is ever sent to the browser except the explicitly
// public Supabase URL/anon key (NEXT_PUBLIC_*), which are designed to be public.

export type AuthMode = "supabase" | "local_demo" | "unconfigured";

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

/**
 * Guest pilot: no sign-up, each visitor gets an isolated cookie account (the same mechanism as the local
 * demo). Explicit opt-in by the operator (VIBII_GUEST_ACCESS=on), gated by an invite code when one is set.
 */
export function guestAccess() {
  return process.env.VIBII_GUEST_ACCESS === "on";
}
export function inviteCode() {
  return (process.env.VIBII_INVITE_CODE ?? "").trim();
}
export function adminKey() {
  const k = (process.env.VIBII_ADMIN_KEY ?? "").trim();
  return k.length >= 16 ? k : "";
}

export function authMode(): AuthMode {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return "supabase";
  if (guestAccess()) return "local_demo";
  // Isolated local demo auth is never available in a production runtime.
  if (!isProductionRuntime() && process.env.VIBII_LOCAL_DEMO_AUTH !== "off") return "local_demo";
  return "unconfigured";
}

export function databaseUrl() {
  // POSTGRES_URL is what the Vercel ↔ Supabase integration sets.
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

export function serverSecret() {
  const s = process.env.VIBII_SECRET;
  if (s && s.length >= 32) return s;
  if (isProductionRuntime()) throw new Error("VIBII_SECRET (32+ chars) is required in production");
  return "local-development-only-secret-not-for-production-use";
}

export function adminEmails(): string[] {
  return (process.env.VIBII_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function storageMode(): "supabase" | "local" {
  return process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

export function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export function llmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.VIBII_LLM_BRIEFS === "on";
}

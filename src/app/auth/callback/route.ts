import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/server/auth";
import { authMode } from "@/lib/server/env";

// OAuth (Google) and email-link callback: exchanges the one-time code for a session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (authMode() === "supabase" && code) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=auth_callback", url.origin));
}

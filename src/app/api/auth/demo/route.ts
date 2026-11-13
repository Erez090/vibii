import { cookies } from "next/headers";
import { createLocalDemoUser, demoCookieValue, DEMO_COOKIE } from "@/lib/server/auth";
import { authMode } from "@/lib/server/env";
import { handle, json, rateLimit } from "@/lib/server/http";

// Isolated local demo sign-in. Unavailable whenever a production runtime or Supabase is configured.
export async function POST(req: Request) {
  return handle(async () => {
    if (authMode() !== "local_demo") return json({ error: "demo_auth_disabled" }, 404);
    await rateLimit(`demo:${req.headers.get("x-forwarded-for") ?? "local"}`, 30, 3600);
    const body = await req.json().catch(() => ({}));
    const id = await createLocalDemoUser(String(body.label ?? "Local demo"));
    (await cookies()).set(DEMO_COOKIE, demoCookieValue(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return json({ ok: true });
  });
}

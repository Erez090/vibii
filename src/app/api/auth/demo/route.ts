import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createLocalDemoUser, demoCookieValue, DEMO_COOKIE, ensureProfile, identityKeyFor } from "@/lib/server/auth";
import { adminKey, authMode, guestAccess, inviteCode } from "@/lib/server/env";
import { tx } from "@/lib/server/db";
import { handle, json, rateLimit } from "@/lib/server/http";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Cookie-account sign-in: the isolated local demo, or — when the operator enables guest access — the
// public guest pilot (invite code required when VIBII_INVITE_CODE is set).
export async function POST(req: Request) {
  return handle(async () => {
    if (authMode() !== "local_demo") return json({ error: "demo_auth_disabled" }, 404);
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const body = (await req.json().catch(() => ({}))) as { label?: string; invite?: string; adminKey?: string };
    const key = adminKey();
    const asAdmin = Boolean(key && body.adminKey && same(String(body.adminKey), key));
    if (guestAccess() && !asAdmin) {
      const code = inviteCode();
      if (code && !same(String(body.invite ?? "").trim().toLowerCase(), code.toLowerCase())) return json({ error: "invite_required" }, 403);
      await rateLimit(`guest:${ip}`, 5, 86400);
    } else if (!asAdmin) {
      await rateLimit(`demo:${ip}`, 30, 3600);
    }
    const id = await createLocalDemoUser(String(body.label ?? (guestAccess() ? "Guest" : "Local demo")));
    if (asAdmin) {
      await tx(async (db) => {
        await ensureProfile(db, { id, email: null, emailVerified: true, identityKey: identityKeyFor("local_demo", id), isDemo: true });
        await db.query("update profiles set is_admin = true where id = $1", [id]);
      });
    }
    (await cookies()).set(DEMO_COOKIE, demoCookieValue(id), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: req.url.startsWith("https://") || Boolean(req.headers.get("cf-connecting-ip")),
    });
    return json({ ok: true, admin: asAdmin });
  });
}

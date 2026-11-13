// Session resolution. Supabase Auth (Google OAuth / verified email) in real multi-user mode;
// an isolated, clearly labelled local demo login only outside production runtimes.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { adminEmails, authMode, serverSecret } from "./env";
import { tx, type Db } from "./db";
import { awardWelcomeCredits } from "./ledger";
import { trackEvent } from "./analytics";

export interface SessionUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  identityKey: string | null; // only for verified identities
  isAdmin: boolean;
  isDemo: boolean;
  uiLanguage: "en" | "he";
  displayName: string | null;
}

export const DEMO_COOKIE = "vibii_local_demo";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session cookies instead.
        }
      },
    },
  });
}

export function identityKeyFor(provider: string, subject: string) {
  return createHmac("sha256", serverSecret()).update(`identity:${provider}:${subject.trim().toLowerCase()}`).digest("hex");
}

function signDemo(id: string) {
  return createHmac("sha256", serverSecret()).update(`demo:${id}`).digest("base64url");
}
export function demoCookieValue(id: string) {
  return `${id}.${signDemo(id)}`;
}
function readDemoCookie(v: string | undefined) {
  if (!v) return null;
  const [id, sig] = v.split(".");
  if (!id || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(signDemo(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Creates/refreshes the profile row and one-time welcome grant. Idempotent. */
export async function ensureProfile(
  db: Db,
  u: { id: string; email: string | null; emailVerified: boolean; identityKey: string | null; isDemo: boolean; displayName?: string | null },
) {
  const isAdminByEnv = !!u.email && adminEmails().includes(u.email.toLowerCase());
  const ins = await db.query(
    `insert into profiles(id, display_name, is_demo, identity_key, is_admin) values ($1,$2,$3,$4,$5)
     on conflict (id) do update set identity_key = coalesce(profiles.identity_key, excluded.identity_key),
       is_admin = profiles.is_admin or excluded.is_admin
     returning *, (xmax = 0) as inserted`,
    [u.id, u.displayName ?? null, u.isDemo, u.identityKey, isAdminByEnv],
  );
  const profile = ins.rows[0];
  if (u.identityKey && u.emailVerified) {
    const granted = await awardWelcomeCredits(db, u.id, u.identityKey);
    if (granted) {
      await trackEvent(db, { ownerId: u.id, name: "entitlement_granted", eventId: `welcome:${u.id}`, props: { kind: "welcome_credits" } });
    }
  }
  return profile;
}

export async function getUser(): Promise<SessionUser | null> {
  const mode = authMode();
  let base: { id: string; email: string | null; emailVerified: boolean; identityKey: string | null; isDemo: boolean; name?: string | null } | null = null;

  if (mode === "supabase") {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const u = data.user;
    const verified = Boolean(u.email_confirmed_at);
    base = {
      id: u.id,
      email: u.email ?? null,
      emailVerified: verified,
      identityKey: verified && u.email ? identityKeyFor("email", u.email) : null,
      isDemo: false,
      name: (u.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? null,
    };
  } else if (mode === "local_demo") {
    const store = await cookies();
    const id = readDemoCookie(store.get(DEMO_COOKIE)?.value);
    if (!id) return null;
    base = { id, email: null, emailVerified: true, identityKey: identityKeyFor("local_demo", id), isDemo: true };
  } else {
    return null;
  }

  const b = base;
  const profile = await tx(async (db) => {
    if (b.isDemo) {
      const exists = await db.query("select 1 from auth.users where id = $1", [b.id]);
      if (!exists.rowCount) return null; // deleted demo account
    }
    return ensureProfile(db, { ...b, displayName: b.name });
  });
  if (!profile) return null;
  return {
    id: b.id,
    email: b.email,
    emailVerified: b.emailVerified,
    identityKey: b.identityKey,
    isAdmin: profile.is_admin,
    isDemo: b.isDemo,
    uiLanguage: profile.ui_language,
    displayName: profile.display_name,
  };
}

/** Local demo only: creates an isolated account in the local database. */
export async function createLocalDemoUser(label: string) {
  if (authMode() !== "local_demo") throw new Error("local demo auth is disabled");
  const id = randomUUID();
  await tx((db) =>
    db.query("insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data) values ($1, null, now(), $2)", [
      id,
      JSON.stringify({ provider: "local_demo", label: label.slice(0, 40) }),
    ]),
  );
  return id;
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export async function requireUser() {
  const u = await getUser();
  if (!u) throw new HttpError(401, "session_expired");
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (!u.isAdmin) throw new HttpError(403, "forbidden");
  return u;
}

import { randomUUID } from "node:crypto";
import { pool, tx } from "../src/lib/server/db";
import { ensureProfile, identityKeyFor, type SessionUser } from "../src/lib/server/auth";
import { recordConsent, saveAnswer } from "../src/lib/server/onboarding-service";
import { CORE_CATEGORIES, FOLLOWUPS } from "../src/lib/onboarding";
import { tick } from "../src/lib/server/pipeline";

export async function makeUser(opts: { identity?: string; admin?: boolean; name?: string } = {}): Promise<SessionUser> {
  const id = randomUUID();
  const identity = opts.identity ?? `${id}@example.test`;
  await pool().query("insert into auth.users(id, email, email_confirmed_at) values ($1,$2,now())", [id, identity]);
  const identityKey = identityKeyFor("email", identity);
  await tx((db) => ensureProfile(db, { id, email: identity, emailVerified: true, identityKey, isDemo: false, displayName: opts.name ?? "Tester" }));
  if (opts.admin) await pool().query("update profiles set is_admin = true where id = $1", [id]);
  return { id, email: identity, emailVerified: true, identityKey, isAdmin: !!opts.admin, isDemo: false, uiLanguage: "en", displayName: opts.name ?? "Tester" };
}

/** Each test starts with an empty queue so leftover jobs from other tests can't interfere. */
export async function resetQueue() {
  await pool().query("update job_queue set state = 'done' where state in ('pending','running')");
}

export async function setMode(mode: "demo" | "manual") {
  await resetQueue();
  await pool().query("update provider_configuration set mode = $1, daily_call_cap = 100, monthly_call_cap = 1000, max_concurrency = 10, commercial_agreement_evidence = null where id = 1", [mode]);
}

export const RICH: Record<string, Record<string, unknown>> = {
  display_name: { text: "Dana" },
  country: { country: "Israel" },
  age_band: { band: "35-44" },
  genres: { genres: ["pop", "electronic"] },
  song_language: { languages: ["he", "en"] },
  moments: { moments: ["drive", "work", "winding_down"] },
  relationship: { status: "married", nickname: "Mooki" },
  children: { count: 1, names: "Noa", youngest: "baby" },
  pet: { status: "now", name: "Bell", species: "dog" },
  hobby: { hobbies: ["cooking"] },
  work: { field: "tech", role: "engineer" },
  upcoming_event: { kind: "trip", text: "Greece in May" },
  fu_baby_word: { text: "bamba" },
  fu_pet_joy: { text: "the beach", chips: ["activity"] },
};

/** Answers every screen in order (rich) or skips everything. Returns the result of the final save. */
export async function completeOnboarding(user: SessionUser, path: "rich" | "skip" | "taste_only" = "rich", providerProcessing = true) {
  await tx((db) => recordConsent(db, user, { personalDetails: path !== "taste_only", providerProcessing }));
  let last: Awaited<ReturnType<typeof saveAnswer>> | null = null;
  const cats = path === "taste_only" ? CORE_CATEGORIES.filter((c) => !["relationship", "children", "pet"].includes(c)) : [...CORE_CATEGORIES, ...FOLLOWUPS];
  for (const c of cats) {
    const skipped = path === "skip" || !RICH[c];
    try {
      last = await tx((db) => saveAnswer(db, user, { category: c, value: RICH[c] ?? {}, skipped, isPrivate: false }));
    } catch (e) {
      if ((e as Error).message !== "not_permitted_by_consent") throw e;
    }
    if (last?.completed) break;
  }
  return last;
}

export async function drain(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    const n = await tick(50, `test-${i}`);
    if (!n) break;
  }
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await pool().query(sql, params)).rows[0] as T;
}
export async function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await pool().query(sql, params)).rows as T[];
}

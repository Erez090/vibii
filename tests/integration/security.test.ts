import { describe, expect, it } from "vitest";
import { asUser, pool } from "../../src/lib/server/db";
import { ownsTrack, playerState } from "../../src/lib/server/library";
import { signedUrl, verifyLocalSignature } from "../../src/lib/server/storage";
import { deleteAccount } from "../../src/lib/server/account";
import { all, completeOnboarding, drain, makeUser, one, setMode } from "../helpers";

describe("isolation & privacy", () => {
  it("two users cannot read each other's rows, tracks or private audio", async () => {
    await setMode("demo");
    const a = await makeUser();
    const b = await makeUser();
    await completeOnboarding(a, "rich");
    await drain();
    const aTrack = await one<{ id: string }>("select id from tracks where owner_id = $1 limit 1", [a.id]);

    // B sees nothing of A's under RLS, even with direct queries.
    await asUser(b.id, async (db) => {
      for (const t of ["generation_requests", "tracks", "onboarding_answers", "usage_ledger", "covers", "playlists", "consent_records"]) {
        const r = await db.query(`select count(*)::int as n from ${t} where owner_id = $1`, [a.id]);
        expect(r.rows[0].n, t).toBe(0);
      }
      expect((await db.query("select count(*)::int as n from profiles where id = $1", [a.id])).rows[0].n).toBe(0);
      expect(await ownsTrack(db, aTrack.id)).toBeNull();
    });
    // B's player state shows none of A's tracks.
    expect((await playerState(b)).tracks).toHaveLength(0);
    // A sees own.
    await asUser(a.id, async (db) => expect(await ownsTrack(db, aTrack.id)).not.toBeNull());
  });

  it("operator-only tables and the draft plan are not readable by listeners", async () => {
    const u = await makeUser();
    await asUser(u.id, async (db) => {
      for (const t of ["provider_configuration", "job_queue", "audit_events", "generation_attempts", "grant_identities"]) {
        await db.query("savepoint s");
        await expect(db.query(`select * from ${t} limit 1`)).rejects.toThrow(/permission denied/);
        await db.query("rollback to savepoint s");
      }
      await db.query("savepoint s2");
      await expect(db.query("select draft_plan from onboarding_state")).rejects.toThrow(/permission denied/);
      await db.query("rollback to savepoint s2");
    });
  });

  it("listeners cannot grant themselves admin", async () => {
    const u = await makeUser();
    await asUser(u.id, async (db) => {
      await expect(db.query("update profiles set is_admin = true where id = $1", [u.id])).rejects.toThrow(/permission denied/);
    });
    expect((await one<{ is_admin: boolean }>("select is_admin from profiles where id = $1", [u.id])).is_admin).toBe(false);
  });

  it("candidate (unapproved) tracks are invisible to their owner", async () => {
    const u = await makeUser();
    await pool().query("insert into tracks(owner_id, title, storage_key, source) values ($1,'cand','candidates/x.mp3','operator_upload')", [u.id]);
    await asUser(u.id, async (db) => expect((await db.query("select * from tracks")).rowCount).toBe(0));
  });

  it("signed media URLs expire and cannot be forged", async () => {
    const { url } = await signedUrl("fixtures/demo-loop-1.mp3", 60);
    const p = new URL(url, "http://x").searchParams;
    expect(verifyLocalSignature(p.get("key")!, Number(p.get("exp")), p.get("sig")!)).toBe(true);
    expect(verifyLocalSignature("candidates/other.mp3", Number(p.get("exp")), p.get("sig")!)).toBe(false);
    expect(verifyLocalSignature(p.get("key")!, Math.floor(Date.now() / 1000) - 1, p.get("sig")!)).toBe(false);
  });

  it("account deletion removes linked rows but keeps hashed one-time grant identities", async () => {
    await setMode("demo");
    const u = await makeUser({ identity: "delete-me@example.test" });
    await completeOnboarding(u, "skip");
    await drain();
    await deleteAccount(u);
    for (const t of ["generation_requests", "tracks", "onboarding_answers", "usage_ledger", "playlists"]) {
      expect((await one<{ n: number }>(`select count(*)::int as n from ${t} where owner_id = $1`, [u.id])).n, t).toBe(0);
    }
    expect((await all("select 1 from profiles where id = $1", [u.id])).length).toBe(0);
    expect((await all("select 1 from grant_identities where identity_key = $1", [u.identityKey])).length).toBeGreaterThan(0);
  });
});

describe("listener self-service writes", () => {
  it("can save player position (and nothing privileged)", async () => {
    const { savePlayerPosition } = await import("../../src/lib/server/library");
    const u = await makeUser();
    await savePlayerPosition(u, { tab: "vibes", position: 42 });
    const p = await one<{ last_tab: string; last_position_seconds: string }>("select last_tab, last_position_seconds from profiles where id = $1", [u.id]);
    expect(p.last_tab).toBe("vibes");
    expect(Number(p.last_position_seconds)).toBe(42);
  });
});

describe("privilege lockdown (Supabase default grants)", () => {
  it("authenticated/anon have no write path to privileged columns or ledgers", async () => {
    const rows = await all<{ ok: boolean; what: string }>(`
      select has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE') as ok, 'profiles.is_admin' as what
      union all select has_table_privilege('authenticated', 'public.usage_ledger', 'INSERT'), 'usage_ledger insert'
      union all select has_table_privilege('authenticated', 'public.onboarding_answers', 'INSERT'), 'answers insert'
      union all select has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon profiles'
      union all select has_table_privilege('authenticated', 'public.analytics_events', 'SELECT'), 'analytics select'`);
    for (const r of rows) expect(r.ok, r.what).toBe(false);
  });
});

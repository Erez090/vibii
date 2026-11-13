import { describe, expect, it, beforeEach } from "vitest";
import { tx } from "../../src/lib/server/db";
import { recordConsent, saveAnswer, completeOnboarding as complete, loadAnswers, latestConsent } from "../../src/lib/server/onboarding-service";
import { balances } from "../../src/lib/server/ledger";
import { playerState } from "../../src/lib/server/library";
import { CORE_CATEGORIES } from "../../src/lib/onboarding";
import { all, completeOnboarding, drain, makeUser, one, setMode } from "../helpers";

describe("onboarding v0.3", () => {
  beforeEach(() => setMode("demo"));

  it("household-rich path: final save alone queues exactly five slots + five cover tasks", async () => {
    const u = await makeUser();
    const res = await completeOnboarding(u, "rich");
    expect(res?.justCompleted).toBe(true);
    const reqs = await all<{ slot: number; state: string }>("select slot, state from generation_requests where owner_id = $1 order by slot", [u.id]);
    expect(reqs.map((r) => r.slot)).toEqual([1, 2, 3, 4, 5]);
    expect((await one<{ n: number }>("select count(*)::int as n from job_queue j join generation_requests r on r.id = j.request_id where r.owner_id = $1 and j.kind = 'audio'", [u.id])).n).toBe(5);
    expect((await one<{ n: number }>("select count(*)::int as n from job_queue j join generation_requests r on r.id = j.request_id where r.owner_id = $1 and j.kind = 'cover'", [u.id])).n).toBe(5);
    // Rich facts shape the plan: baby phrase opener, partner song.
    const briefs = await all<{ brief: { plan: { role: string; theme: string } } }>("select brief from generation_requests where owner_id = $1 order by slot", [u.id]);
    expect(briefs[0].brief.plan.theme).toBe("family_hook");
    expect(briefs[2].brief.plan.theme).toBe("partner");
    expect(new Set(briefs.map((b) => b.brief.plan.theme)).size).toBe(5);
  });

  it("all-skip path completes and still yields five distinct songs", async () => {
    const u = await makeUser();
    const res = await completeOnboarding(u, "skip");
    expect(res?.completed).toBe(true);
    const briefs = await all<{ brief: { plan: { theme: string; motif: string } } }>("select brief from generation_requests where owner_id = $1 order by slot", [u.id]);
    expect(briefs).toHaveLength(5);
    expect(new Set(briefs.map((b) => b.brief.plan.motif)).size).toBe(5);
  });

  it("taste-only consent skips household questions and uses no personal facts", async () => {
    const u = await makeUser();
    await completeOnboarding(u, "taste_only");
    const answers = await tx((db) => loadAnswers(db, u.id));
    expect(answers.children?.skipped).toBe(true);
    const briefs = await all<{ brief: { sourceFacts: { scope: string }[] } }>("select brief from generation_requests where owner_id = $1", [u.id]);
    expect(briefs).toHaveLength(5);
    expect(briefs.flatMap((b) => b.brief.sourceFacts).some((f) => f.scope === "lyric")).toBe(false);
  });

  it("declining all provider processing routes the first album to authorised existing audio (demo fixtures)", async () => {
    await setMode("manual");
    const u = await makeUser();
    await tx((db) => recordConsent(db, u, { personalDetails: false, providerProcessing: false }));
    const c = await tx((db) => latestConsent(db, u.id));
    expect(c?.providerProcessing).toBe(false);
    await completeOnboarding(u, "skip", false);
    const modes = await all<{ provider_mode: string }>("select provider_mode from generation_requests where owner_id = $1", [u.id]);
    expect(modes.every((m) => m.provider_mode === "demo")).toBe(true);
  });

  it("stale branch cleanup: changing pet to 'no' removes its follow-up", async () => {
    const u = await makeUser();
    await tx((db) => recordConsent(db, u, { personalDetails: true, providerProcessing: true }));
    await tx((db) => saveAnswer(db, u, { category: "pet", value: { status: "now", name: "Bell", species: "dog" }, skipped: false, isPrivate: false }));
    await tx((db) => saveAnswer(db, u, { category: "fu_pet_joy", value: { text: "the beach" }, skipped: false, isPrivate: false }));
    const r = await tx((db) => saveAnswer(db, u, { category: "pet", value: { status: "no" }, skipped: false, isPrivate: false }));
    expect(r.removedFollowups).toContain("fu_pet_joy");
    const a = await tx((db) => loadAnswers(db, u.id));
    expect(a.fu_pet_joy).toBeUndefined();
    expect(a.pet?.value.name).toBe(""); // name dropped with the branch
  });

  it("credits: 40 welcome + 5 per core category (incl. Skip), never duplicated by re-saves or re-registration", async () => {
    const u = await makeUser({ identity: "same@example.test" });
    await completeOnboarding(u, "skip");
    expect((await tx((db) => balances(db, u.id))).credits).toBe(100);
    // Back navigation / re-saving the same category awards nothing extra.
    const again = await tx((db) => saveAnswer(db, u, { category: "country", value: { country: "IL" }, skipped: false, isPrivate: false }));
    expect(again.awarded).toBe(false);
    expect((await tx((db) => balances(db, u.id))).credits).toBe(100);
    // A new account for the same verified identity gets no second welcome/category grants and no second album.
    const u2 = await makeUser({ identity: "same@example.test" });
    await completeOnboarding(u2, "skip");
    const b2 = await tx((db) => balances(db, u2.id));
    expect(b2.credits).toBe(0);
    expect((await all("select 1 from generation_requests where owner_id = $1", [u2.id])).length).toBe(0);
    expect((await playerState(u2)).starterStatus).toBe("not_eligible");
  });

  it("concurrent final saves / double tap create one album", async () => {
    const u = await makeUser();
    await completeOnboarding(u, "skip");
    const answers = await tx((db) => loadAnswers(db, u.id));
    const consent = (await tx((db) => latestConsent(db, u.id)))!;
    await Promise.all([1, 2, 3].map(() => tx((db) => complete(db, u, answers, consent))));
    expect((await one<{ n: number }>("select count(*)::int as n from playlists where owner_id = $1 and kind = 'starter'", [u.id])).n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from generation_requests where owner_id = $1", [u.id])).n).toBe(5);
    expect((await one<{ n: number }>("select count(*)::int as n from usage_ledger where owner_id = $1 and unit = 'starter_album' and entry = 'reserve'", [u.id])).n).toBe(1);
  });

  it("does not leak the plan before reveal; profile edits after completion don't regenerate", async () => {
    const u = await makeUser();
    await completeOnboarding(u, "rich");
    const before = await playerState(u);
    expect(before.starterStatus).toBe("waiting");
    expect(before.tracks).toHaveLength(0);
    await tx((db) => saveAnswer(db, u, { category: "hobby", value: { hobbies: ["reading"] }, skipped: false, isPrivate: false }));
    expect((await one<{ n: number }>("select count(*)::int as n from generation_requests where owner_id = $1", [u.id])).n).toBe(5);
    await drain();
    const after = await playerState(u);
    expect(after.starterStatus).toBe("released");
  });

  it("private flagged details never enter lyric briefs", async () => {
    const u = await makeUser();
    await tx((db) => recordConsent(db, u, { personalDetails: true, providerProcessing: true }));
    await tx((db) => saveAnswer(db, u, { category: "children", value: { count: 1, names: "Secret", youngest: "baby" }, skipped: false, isPrivate: true }));
    await tx((db) => saveAnswer(db, u, { category: "fu_baby_word", value: { text: "zibzib" }, skipped: false, isPrivate: true }));
    for (const c of CORE_CATEGORIES.filter((c) => c !== "children")) {
      await tx((db) => saveAnswer(db, u, { category: c, value: {}, skipped: true, isPrivate: false }));
    }
    expect((await one<{ n: number }>("select count(*)::int as n from generation_requests where owner_id = $1", [u.id])).n).toBe(5);
    const briefs = await all<{ brief: { lyrics: string } }>("select brief from generation_requests where owner_id = $1", [u.id]);
    for (const b of briefs) {
      expect(b.brief.lyrics).not.toContain("zibzib");
      expect(b.brief.lyrics).not.toContain("Secret");
    }
  });
});

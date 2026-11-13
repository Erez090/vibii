import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool, tx } from "../../src/lib/server/db";
import { claimJob, completeAttempt, processAudio, runJob, tick } from "../../src/lib/server/pipeline";
import { __setArtProviderForTests, __setProviderForTests, demoProvider, ProviderTransportError, type Provider } from "../../src/lib/server/providers";
import { createNewRequest, playerState } from "../../src/lib/server/library";
import { balances, grantSongs } from "../../src/lib/server/ledger";
import { all, completeOnboarding, drain, makeUser, one, setMode } from "../helpers";

function countingProvider(over: Partial<Provider> = {}) {
  const calls = { submit: 0 };
  const p: Provider = {
    ...demoProvider,
    capabilities: { ...demoProvider.capabilities, idempotency: false },
    async submit(input) {
      calls.submit++;
      return demoProvider.submit(input);
    },
    ...over,
  };
  return { p, calls };
}

async function grant(userId: string, n = 3) {
  await tx((db) => grantSongs(db, { ownerId: userId, quantity: n, source: "admin_test_grant", grantKey: `t:${userId}:${Math.random()}` }));
}
const input = { forWhom: "me" as const, topic: "Morning run", language: "en", vibe: "drive", story: "", useStory: false, confirmed: true };

describe("generation pipeline", () => {
  beforeEach(() => setMode("demo"));
  afterEach(() => {
    __setProviderForTests("demo", null);
    __setArtProviderForTests(null);
  });

  it("two concurrent submissions with the same key create one request and reserve quota once", async () => {
    const u = await makeUser();
    await grant(u.id, 2);
    const results = await Promise.all([1, 2, 3, 4].map(() => createNewRequest(u, input, "same-key-123456")));
    const ids = new Set(results.map((r) => (r.ok ? r.requestId : null)));
    expect(ids.size).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from generation_requests where owner_id = $1", [u.id])).n).toBe(1);
    const b = await tx((db) => balances(db, u.id));
    expect(b.songsAvailable).toBe(1);
    expect(b.songsReserved).toBe(1);
  });

  it("no entitlement → clear error and no provider request", async () => {
    const u = await makeUser();
    const r = await createNewRequest(u, input, "nokey-0000001");
    expect(r).toEqual({ ok: false, code: "no_entitlement" });
    expect((await all("select 1 from generation_requests where owner_id = $1", [u.id])).length).toBe(0);
  });

  it("lost provider response → unknown_submission, never auto-resubmitted", async () => {
    const { p, calls } = countingProvider({
      async submit() {
        calls.submit++;
        throw new ProviderTransportError("socket hang up", true);
      },
    });
    __setProviderForTests("demo", p);
    const u = await makeUser();
    await grant(u.id);
    const r = await createNewRequest(u, input, "lost-0000001");
    if (!r.ok) throw new Error("expected ok");
    await drain();
    await drain();
    expect(calls.submit).toBe(1);
    const req = await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId]);
    expect(req.state).toBe("unknown_submission");
    // Quota stays reserved (not released, not consumed) until an operator reconciles.
    const b = await tx((db) => balances(db, u.id));
    expect(b.songsReserved).toBe(1);
    // Even if a job is re-enqueued, processAudio refuses to resubmit an unknown submission.
    await processAudio(r.requestId);
    expect(calls.submit).toBe(1);
  });

  it("worker crash between persisting the attempt and the provider response is treated as unknown (non-idempotent provider)", async () => {
    const { p, calls } = countingProvider();
    __setProviderForTests("demo", p);
    const u = await makeUser();
    await grant(u.id);
    const r = await createNewRequest(u, input, "crash-0000001");
    if (!r.ok) throw new Error();
    // Simulate: attempt row persisted, process died before submit.
    await pool().query(
      "insert into generation_attempts(request_id, owner_id, attempt_no, provider, submission_key) values ($1,$2,1,'demo_fixture',$3)",
      [r.requestId, u.id, `${r.requestId}:1`],
    );
    await drain();
    expect(calls.submit).toBe(0);
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("unknown_submission");
  });

  it("expired lease is recovered by another worker", async () => {
    const u = await makeUser();
    await grant(u.id);
    const r = await createNewRequest(u, input, "lease-0000001");
    if (!r.ok) throw new Error();
    await pool().query("update job_queue set state = 'done' where request_id <> $1 and state in ('pending','running')", [r.requestId]);
    // Worker A claims the audio job and dies.
    await pool().query("update job_queue set run_after = now() - interval '1 hour' where request_id = $1 and kind = 'audio'", [r.requestId]);
    const claimedA = await claimJob("worker-A");
    expect(claimedA).not.toBeNull();
    // Not yet expired: B cannot steal it.
    const early = await claimJob("worker-B");
    expect(early?.id).not.toBe(claimedA!.id);
    if (early) await runJob(early, "worker-B");
    // Lease expires → B recovers it.
    const later = new Date(Date.now() + 5 * 60 * 1000);
    const recovered = await claimJob("worker-B", later);
    expect(recovered?.id).toBe(claimedA!.id);
    await runJob(recovered!, "worker-B");
    await drain();
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("ready");
  });

  it("duplicate completion / late callback creates no extra tracks or charges", async () => {
    const u = await makeUser();
    await grant(u.id, 2);
    const r = await createNewRequest(u, input, "dupe-0000001");
    if (!r.ok) throw new Error();
    await drain();
    const a = await one<{ id: string }>("select id from generation_attempts where request_id = $1", [r.requestId]);
    await completeAttempt(a.id, ["1"]);
    await completeAttempt(a.id, ["1"]);
    expect((await one<{ n: number }>("select count(*)::int as n from tracks where request_id = $1", [r.requestId])).n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from usage_ledger where request_id = $1 and entry = 'consume'", [r.requestId])).n).toBe(1);
    const b = await tx((db) => balances(db, u.id));
    expect(b.songsAvailable).toBe(1);
    expect(b.songsReserved).toBe(0);
  });

  it("non-retryable provider failure releases the reservation exactly once", async () => {
    __setProviderForTests("demo", { ...demoProvider, async submit() { return { kind: "rejected", code: "content_policy", retryable: false }; } });
    const u = await makeUser();
    await grant(u.id, 1);
    const r = await createNewRequest(u, input, "fail-0000001");
    if (!r.ok) throw new Error();
    await drain();
    await drain();
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("failed");
    expect((await one<{ n: number }>("select count(*)::int as n from usage_ledger where request_id = $1 and entry = 'release'", [r.requestId])).n).toBe(1);
    expect((await tx((db) => balances(db, u.id))).songsAvailable).toBe(1);
  });

  it("release gate: waits for all seven audio + seven covers; failed art falls back to distinct local covers", async () => {
    // Art provider always fails → local illustrations.
    __setArtProviderForTests({ async render() { throw new Error("art down"); } });
    // Hold back slot 5's audio (late audio).
    let holdSlot5 = true;
    __setProviderForTests("demo", {
      ...demoProvider,
      async getStatus(jobId) {
        if (holdSlot5 && jobId.startsWith("demo:5:")) return { state: "processing" };
        return demoProvider.getStatus(jobId);
      },
    });
    const u = await makeUser();
    await completeOnboarding(u, "rich");
    await drain();
    const four = await playerState(u);
    expect(four.starterStatus).toBe("waiting");
    expect(four.tracks).toHaveLength(0); // four ready songs are not revealed
    expect((await one<{ n: number }>("select count(*)::int as n from tracks where owner_id = $1 and status = 'approved'", [u.id])).n).toBe(6);
    expect(four.starterProgress).toEqual({ ready: 6, total: 7 });
    holdSlot5 = false;
    await pool().query("update job_queue set run_after = now() where state = 'pending'");
    await drain();
    const st = await playerState(u);
    expect(st.starterStatus).toBe("released");
    const starter = st.tracks.filter((t) => t.playlist === "starter");
    expect(starter).toHaveLength(7);
    expect(starter.every((t) => t.coverUrl && !t.external)).toBe(true);
    const covers = await all<{ svg: string; kind: string }>("select svg, kind from covers where owner_id = $1", [u.id]);
    expect(covers.every((c) => c.kind === "local_illustration")).toBe(true);
    expect(new Set(covers.map((c) => c.svg)).size).toBe(7);
    expect((await one<{ n: number }>("select count(*)::int as n from analytics_events where owner_id = $1 and name = 'first_track_ready'", [u.id])).n).toBe(1);
    // Starter consumed exactly once.
    expect((await one<{ n: number }>("select count(*)::int as n from usage_ledger where owner_id = $1 and unit = 'starter_album' and entry = 'consume'", [u.id])).n).toBe(1);
  });

  it("an existing released playlist stays playable while a later request is pending", async () => {
    const u = await makeUser();
    await completeOnboarding(u, "skip");
    await drain();
    await setMode("manual");
    await grant(u.id);
    const r = await createNewRequest(u, input, "later-0000001");
    if (!r.ok) throw new Error();
    const st = await playerState(u);
    expect(st.starterStatus).toBe("released");
    expect(st.tracks.filter((t) => t.playlist === "starter")).toHaveLength(7);
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("awaiting_operator");
  });

  it("provider caps are enforced independently of user entitlements", async () => {
    await pool().query("update provider_configuration set daily_call_cap = 0 where id = 1");
    const { p, calls } = countingProvider();
    // Use a non-demo provider id so caps apply.
    __setProviderForTests("demo", { ...p, id: "suno_api" });
    const u = await makeUser();
    await grant(u.id);
    const r = await createNewRequest(u, input, "cap-00000001");
    if (!r.ok) throw new Error();
    await tick(5);
    expect(calls.submit).toBe(0);
    const job = await one<{ last_error: string; state: string }>("select last_error, state from job_queue where request_id = $1 and kind = 'audio'", [r.requestId]);
    expect(job.last_error).toBe("budget:daily_cap");
    expect(job.state).toBe("pending");
  });
});

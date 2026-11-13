import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { pool, tx } from "../../src/lib/server/db";
import {
  AdminError, approveCandidate, attachExternalLink, attachUpload, cancelRequest, reconcileUnknown, recordProviderJob,
  rejectCandidate, updateProviderConfig, validateExternalLink,
} from "../../src/lib/server/admin-service";
import { createNewRequest, playerState } from "../../src/lib/server/library";
import { balances, grantSongs } from "../../src/lib/server/ledger";
import { completeOnboarding, makeUser, one, setMode } from "../helpers";

const mp3 = () => readFileSync("fixtures/audio/demo-loop-3.mp3");
const input = { forWhom: "me" as const, topic: "Sunday", language: "en", vibe: "calm", story: "", useStory: false, confirmed: true };

describe("manual operator workflow", () => {
  beforeEach(() => setMode("manual"));

  it("upload → review → publish delivers to the correct account; reject never double-charges", async () => {
    const admin = await makeUser({ admin: true });
    const listener = await makeUser();
    const other = await makeUser();
    await tx((db) => grantSongs(db, { ownerId: listener.id, quantity: 1, source: "admin_test_grant", grantKey: `g:${listener.id}` }));
    const r = await createNewRequest(listener, input, "manual-000001");
    if (!r.ok) throw new Error();
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("awaiting_operator");
    await recordProviderJob(admin, r.requestId, { providerJobId: "suno-song-abc" });

    // First candidate rejected: no charge, back to the operator queue.
    const c1 = await attachUpload(admin, r.requestId, { buf: mp3(), mime: "audio/mpeg", name: "take1.mp3" }, { source: "operator_upload", downloadEvidence: "Own composition" });
    expect((await playerState(listener)).tracks).toHaveLength(0); // private until approved
    await rejectCandidate(admin, c1, "wrong mood");
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("awaiting_operator");

    // Suno output to a non-operator requires a recorded agreement.
    const c2 = await attachUpload(admin, r.requestId, { buf: mp3(), mime: "audio/mpeg", name: "take2.mp3" }, { source: "suno_manual", downloadEvidence: "Downloaded from Pro library" });
    await expect(approveCandidate(admin, c2, { authorization: "ok" })).rejects.toThrow("provider_agreement_required");
    await updateProviderConfig(admin, { agreementEvidence: "Test agreement ref T-1 (test only)" });
    await approveCandidate(admin, c2, { authorization: "Reviewed, matches brief" });

    const st = await playerState(listener);
    expect(st.tracks.map((t) => t.id)).toContain(c2);
    expect((await playerState(other)).tracks).toHaveLength(0);
    const b = await tx((db) => balances(db, listener.id));
    expect(b.songsAvailable).toBe(0);
    expect(b.songsReserved).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from usage_ledger where request_id = $1 and entry = 'consume'", [r.requestId])).n).toBe(1);
    const prov = await one<{ provenance: Record<string, unknown>; reviewer_id: string }>("select provenance, reviewer_id from tracks where id = $1", [c2]);
    expect(prov.reviewer_id).toBe(admin.id);
    expect(prov.provenance.download).toBe("Downloaded from Pro library");
  });

  it("external-link-only results stay external and cannot satisfy the first-album gate", async () => {
    const admin = await makeUser({ admin: true });
    const listener = await makeUser();
    await completeOnboarding(listener, "skip");
    const slot = await one<{ id: string }>("select id from generation_requests where owner_id = $1 and slot = 1", [listener.id]);
    const t = await attachExternalLink(admin, slot.id, "https://suno.com/song/00000000-test");
    await updateProviderConfig(admin, { agreementEvidence: "Test agreement" });
    await expect(approveCandidate(admin, t, { authorization: "ok" })).rejects.toThrow("starter_requires_in_app_audio");
    expect((await playerState(listener)).starterStatus).toBe("manual_waiting");

    // For create-new, an approved external link is delivered as external (no local playback).
    await tx((db) => grantSongs(db, { ownerId: listener.id, quantity: 1, source: "admin_test_grant", grantKey: `g2:${listener.id}` }));
    const r = await createNewRequest(listener, input, "external-00001");
    if (!r.ok) throw new Error();
    const t2 = await attachExternalLink(admin, r.requestId, "https://suno.com/song/11111111-test");
    await approveCandidate(admin, t2, { authorization: "ok" });
    const st = await playerState(listener);
    const ext = st.tracks.find((x) => x.id === t2)!;
    expect(ext.external?.url).toBe("https://suno.com/song/11111111-test");
    const row = await one<{ storage_key: string | null; rights_status: string }>("select storage_key, rights_status from tracks where id = $1", [t2]);
    expect(row.storage_key).toBeNull();
    expect(row.rights_status).toBe("external_link_only");
  });

  it("manual starter album: operator uploads all five → one reveal", async () => {
    const admin = await makeUser({ admin: true });
    const listener = await makeUser();
    await completeOnboarding(listener, "rich");
    await updateProviderConfig(admin, { agreementEvidence: "Test agreement" });
    // Covers are rendered locally without a worker.
    const { processCover } = await import("../../src/lib/server/pipeline");
    const slots = (await pool().query("select id from generation_requests where owner_id = $1 order by slot", [listener.id])).rows;
    for (const s of slots) await processCover(s.id);
    for (const [i, s] of slots.entries()) {
      const t = await attachUpload(admin, s.id, { buf: mp3(), mime: "audio/mpeg", name: `s${i}.mp3` }, { source: "operator_upload", downloadEvidence: "Operator-owned test audio" });
      if (i < 4) {
        await approveCandidate(admin, t, { authorization: "ok" });
        expect((await playerState(listener)).starterStatus).toBe("manual_waiting");
      } else {
        await approveCandidate(admin, t, { authorization: "ok" });
      }
    }
    const st = await playerState(listener);
    expect(st.starterStatus).toBe("released");
    expect(st.tracks.filter((t) => t.playlist === "starter")).toHaveLength(5);
  });

  it("validates uploads and links", async () => {
    const admin = await makeUser({ admin: true });
    const listener = await makeUser();
    await tx((db) => grantSongs(db, { ownerId: listener.id, quantity: 1, source: "admin_test_grant", grantKey: `g3:${listener.id}` }));
    const r = await createNewRequest(listener, input, "validate-00001");
    if (!r.ok) throw new Error();
    await expect(attachUpload(admin, r.requestId, { buf: Buffer.from("not audio"), mime: "audio/mpeg", name: "x.mp3" }, { source: "operator_upload", downloadEvidence: "x" })).rejects.toBeInstanceOf(AdminError);
    await expect(attachUpload(admin, r.requestId, { buf: mp3(), mime: "text/html", name: "x.html" }, { source: "operator_upload", downloadEvidence: "x" })).rejects.toThrow("unsupported_type");
    await expect(attachUpload(admin, r.requestId, { buf: mp3(), mime: "audio/mpeg", name: "x.mp3" }, { source: "operator_upload", downloadEvidence: " " })).rejects.toThrow("download_evidence_required");
    expect(() => validateExternalLink("http://suno.com/song/x")).toThrow("host_not_allowed");
    expect(() => validateExternalLink("https://evil.example/song")).toThrow("host_not_allowed");
    expect(() => validateExternalLink("https://user:pw@suno.com/x")).toThrow("host_not_allowed");
    expect(validateExternalLink("https://suno.com/song/abc")).toBe("https://suno.com/song/abc");
  });

  it("unknown submission reconcile and cancellation keep quota consistent", async () => {
    const admin = await makeUser({ admin: true });
    const listener = await makeUser();
    await tx((db) => grantSongs(db, { ownerId: listener.id, quantity: 1, source: "admin_test_grant", grantKey: `g4:${listener.id}` }));
    const r = await createNewRequest(listener, input, "reconcile-0001");
    if (!r.ok) throw new Error();
    await pool().query("update generation_requests set state = 'unknown_submission' where id = $1", [r.requestId]);
    await reconcileUnknown(admin, r.requestId, { accepted: false });
    expect((await one<{ state: string }>("select state from generation_requests where id = $1", [r.requestId])).state).toBe("awaiting_operator");
    await recordProviderJob(admin, r.requestId, { providerJobId: "job-2" });
    await cancelRequest(admin, r.requestId);
    const ev = await one<{ note: string }>("select note from generation_request_events where request_id = $1 and to_state = 'cancelled'", [r.requestId]);
    expect(ev.note).toMatch(/cost may still/);
    const b = await tx((db) => balances(db, listener.id));
    expect(b.songsAvailable).toBe(1);
    await expect(cancelRequest(admin, r.requestId)).rejects.toThrow("request_closed");
    expect((await one<{ n: number }>("select count(*)::int as n from usage_ledger where request_id = $1 and entry = 'release'", [r.requestId])).n).toBe(1);
  });
});

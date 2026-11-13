"use client";
import { useCallback, useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "rounded-2xl border border-line p-4";
const input = "rounded-lg border border-line bg-white/[0.04] px-2 py-1.5";
const btn = "rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5";

export function AdminRequest({ id }: { id: string }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [link, setLink] = useState("");
  const [ref, setRef] = useState("");
  const [evidence, setEvidence] = useState("");
  const [source, setSource] = useState("suno_manual");
  const [file, setFile] = useState<File | null>(null);
  const [auth, setAuth] = useState("");
  const [preview, setPreview] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/requests/${id}`, { cache: "no-store" });
    if (r.ok) setD(await r.json());
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the await
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, label: string) => {
    const r = await fetch(`/api/admin/requests/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${label}: done` : `${label}: ${j.error}`);
    await load();
  };
  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("downloadEvidence", evidence);
    fd.set("generationReference", ref);
    fd.set("source", source);
    const r = await fetch(`/api/admin/requests/${id}`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Upload: candidate stored privately" : `Upload: ${j.error}`);
    await load();
  };
  const review = async (trackId: string, action: "approve" | "reject") => {
    const body = action === "approve" ? { action, authorization: auth } : { action, reason: prompt("Reason for rejection?") ?? "" };
    const r = await fetch(`/api/admin/tracks/${trackId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${action}: done` : `${action}: ${j.error}`);
    await load();
  };
  const listen = async (trackId: string) => {
    const r = await fetch(`/api/admin/tracks/${trackId}`);
    if (r.ok) setPreview({ ...preview, [trackId]: (await r.json()).url });
  };

  if (!d) return <p className="text-muted">Loading…</p>;
  const r = d.request;
  const open = !["ready", "cancelled", "failed"].includes(r.state);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-medium">{d.brief.title ?? "Request"}</h1>
        <p className="text-sm text-muted">
          {r.kind}{r.slot ? ` · slot ${r.slot}` : ""} · {r.provider_mode} · state <b className="text-lavender">{r.state}</b> · listener {r.display_name ?? r.owner_id.slice(0, 8)} · job ID <code>{r.id}</code>
        </p>
      </div>
      {msg && <p role="status" className="rounded-xl border border-lavender/50 p-3 text-sm">{msg}</p>}

      {r.state === "unknown_submission" && (
        <section className={`${card} border-peach`}>
          <h2 className="font-medium text-peach">Unknown submission — reconcile before resubmitting</h2>
          <p className="mt-1 text-sm text-muted">The provider may have accepted (and charged) this request but the response was lost. Check the provider library first.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="provider job / song id if found" className={input} />
            <button className={btn} onClick={() => act({ action: "reconcile", accepted: true, providerJobId: jobId }, "Reconcile (accepted)")}>It was accepted</button>
            <button className={btn} onClick={() => act({ action: "reconcile", accepted: false }, "Reconcile (not accepted)")}>Not accepted — allow resubmit</button>
          </div>
        </section>
      )}

      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Brief</h2>
          <button className={btn} onClick={() => navigator.clipboard.writeText(d.exportText).then(() => setMsg("Brief copied"))}>Copy brief</button>
        </div>
        <p className="mt-1 text-xs text-muted">{d.brief.generatorNote}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Style</dt><dd>{d.brief.style} <button className="text-xs text-lavender underline" onClick={() => navigator.clipboard.writeText(d.brief.style)}>copy</button></dd>
          <dt className="text-muted">Language</dt><dd>{d.brief.language}</dd>
          <dt className="text-muted">Moment / energy</dt><dd>{d.brief.moment} · {d.brief.energy}</dd>
          <dt className="text-muted">Exclude</dt><dd>{d.brief.excluded?.join("; ")}</dd>
        </dl>
        <div className="mt-3">
          <div className="flex items-center justify-between text-sm text-muted">Lyrics <button className="text-xs text-lavender underline" onClick={() => navigator.clipboard.writeText(d.brief.lyrics)}>copy</button></div>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-sm">{d.brief.lyrics}</pre>
        </div>
      </section>

      {open && (
        <section className={card}>
          <h2 className="font-medium">Fulfil</h2>
          <ol className="mt-2 list-decimal space-y-4 ps-5 text-sm">
            <li>
              Create the song through an authorised workflow (e.g. Suno, your account / MCP), then record the provider job:
              <div className="mt-1 flex flex-wrap gap-2">
                <input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="Suno song / job id" className={input} />
                <button className={btn} onClick={() => act({ action: "record_job", providerJobId: jobId }, "Record job")}>Record provider job</button>
              </div>
            </li>
            <li>
              Attach a permitted audio file (private until approved):
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
                <select value={source} onChange={(e) => setSource(e.target.value)} className={input}>
                  <option value="suno_manual" className="bg-[#1a1430]">Suno output</option>
                  <option value="operator_upload" className="bg-[#1a1430]">Other authorised audio</option>
                </select>
                <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="generation reference" className={input} />
              </div>
              <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Download permission evidence (e.g. 'Downloaded from my Suno Pro library, plan permits download')" className={`${input} mt-2 w-full`} />
              <button className={`${btn} mt-2`} onClick={upload} disabled={!file}>Upload candidate</button>
            </li>
            <li>
              …or attach an external Suno link only (stays external; does not count as in-app audio for the first album):
              <div className="mt-1 flex flex-wrap gap-2">
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://suno.com/song/…" className={`${input} w-80`} />
                <button className={btn} onClick={() => act({ action: "external_link", url: link, generationReference: ref }, "External link")}>Attach link</button>
              </div>
            </li>
          </ol>
        </section>
      )}

      <section className={card}>
        <h2 className="font-medium">Candidates & provenance</h2>
        {!d.tracks.length && <p className="mt-2 text-sm text-muted">No candidates yet.</p>}
        <label className="mt-2 block text-sm">Authorization statement (required to approve)
          <input value={auth} onChange={(e) => setAuth(e.target.value)} placeholder="e.g. Reviewed; matches brief; download permitted under agreement ref …" className={`${input} mt-1 w-full`} />
        </label>
        <ul className="mt-3 space-y-3">
          {d.tracks.map((t: any) => (
            <li key={t.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{t.title}</b><span className="text-lavender">{t.status}</span><span className="text-muted">{t.source} · rights: {t.rights_status}{t.duration_seconds ? ` · ${t.duration_seconds}s` : ""}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-muted">{JSON.stringify(t.provenance, null, 1)}</pre>
              {t.external_url && <a href={t.external_url} target="_blank" rel="noopener noreferrer" className="text-peach underline">Open external link ↗</a>}
              {t.storage_key && (preview[t.id] ? <audio controls src={preview[t.id]} className="mt-2 w-full" /> : <button className={btn} onClick={() => listen(t.id)}>Preview</button>)}
              {t.status === "candidate" && (
                <div className="mt-2 flex gap-2">
                  <button className="rounded-lg bg-peach px-3 py-1.5 text-sm font-medium text-peach-ink" onClick={() => review(t.id, "approve")}>Approve & publish</button>
                  <button className={btn} onClick={() => review(t.id, "reject")}>Reject (no charge)</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="font-medium">Attempts</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {d.attempts.map((a: any) => (
            <li key={a.id}>#{a.attempt_no} {a.provider} · {a.state} · job {a.provider_job_id ?? "—"} · est {a.estimated_cost_credits ?? "?"} / actual {a.actual_cost_credits ?? "?"} credits · USD {a.monetary_cost_known ? a.monetary_cost_usd : "unknown"}{a.error_code ? ` · ${a.error_code}` : ""}</li>
          ))}
          {!d.attempts.length && <li className="text-muted">None.</li>}
        </ul>
        <p className="mt-3 text-sm">Cover: {d.cover ? `${d.cover.state} · ${d.cover.kind ?? ""} · ${d.cover.motif}` : "—"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.state === "failed" && <button className={btn} onClick={() => act({ action: "retry_audio" }, "Retry audio")}>Retry audio only</button>}
          {d.cover?.state === "failed" && <button className={btn} onClick={() => act({ action: "retry_cover" }, "Retry cover")}>Retry cover only</button>}
          {open && <button className={btn} onClick={() => confirm("Cancel this request? If the provider already accepted it, cost may still apply.") && act({ action: "cancel" }, "Cancel")}>Cancel request</button>}
        </div>
      </section>

      <section className={card}>
        <h2 className="font-medium">History</h2>
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {d.events.map((e: any, i: number) => <li key={i}>{new Date(e.created_at).toLocaleString()} · {e.from_state ?? "∅"} → {e.to_state} · {e.actor}{e.note ? ` · ${e.note}` : ""}</li>)}
        </ul>
      </section>
    </div>
  );
}

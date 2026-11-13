"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Row { id: string; kind: string; slot: number | null; state: string; provider_mode: string; title: string; created_at: string; display_name: string | null; candidates: number; error_code: string | null }
interface Config { mode: string; daily_call_cap: number; monthly_call_cap: number; max_concurrency: number; commercial_agreement_evidence: string | null; monetary_cost_known: boolean }

const STATES = ["", "awaiting_operator", "needs_review", "unknown_submission", "submitted", "processing", "queued", "ready", "failed", "cancelled"];
const card = "rounded-2xl border border-line p-4";
const input = "rounded-lg border border-line bg-white/[0.04] px-2 py-1.5";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? null : (j.error ?? "error");
}

export function AdminHome() {
  const [state, setState] = useState("");
  const [data, setData] = useState<{ requests: Row[]; config: Config; officialApi: { ok: boolean; reason?: string } } | null>(null);
  const [cfg, setCfg] = useState<Partial<Config> & { agreement?: string }>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<{ id: string; display_name: string | null; email: string | null; is_demo: boolean }[]>([]);
  const [grant, setGrant] = useState({ ownerId: "", quantity: 1, source: "admin_test_grant", period: "", note: "" });

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/requests${state ? `?state=${state}` : ""}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setData(j);
      setCfg((c) => (Object.keys(c).length ? c : { ...j.config, agreement: j.config.commercial_agreement_evidence ?? "" }));
    }
  }, [state]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the await
    void load();
  }, [load]);

  const saveCfg = async () => {
    const err = await post("/api/admin/config", {
      mode: cfg.mode, dailyCap: cfg.daily_call_cap, monthlyCap: cfg.monthly_call_cap, concurrency: cfg.max_concurrency,
      agreementEvidence: cfg.agreement ?? undefined,
    });
    setMsg(err ? `Config: ${err}` : "Provider configuration saved.");
    void load();
  };
  const search = async () => {
    const r = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`);
    if (r.ok) setUsers((await r.json()).users);
  };
  const doGrant = async () => {
    const err = await post("/api/admin/grants", grant);
    setMsg(err ? `Grant: ${err}` : "Entitlement granted.");
  };

  return (
    <div className="space-y-6">
      {msg && <p role="status" className="rounded-xl border border-lavender/50 p-3 text-sm">{msg}</p>}

      <section className={card}>
        <h2 className="mb-3 text-lg font-medium">Provider</h2>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>Mode<br />
            <select value={cfg.mode ?? ""} onChange={(e) => setCfg({ ...cfg, mode: e.target.value })} className={input}>
              <option value="demo" className="bg-[#1a1430]">demo — labelled local fixtures</option>
              <option value="manual" className="bg-[#1a1430]">manual — operator (e.g. your Suno account)</option>
              <option value="official_api" disabled className="bg-[#1a1430]">official_api — unavailable</option>
            </select>
          </label>
          <label>Daily call cap<br /><input type="number" min={0} value={cfg.daily_call_cap ?? 0} onChange={(e) => setCfg({ ...cfg, daily_call_cap: Number(e.target.value) })} className={`${input} w-24`} /></label>
          <label>Monthly call cap<br /><input type="number" min={0} value={cfg.monthly_call_cap ?? 0} onChange={(e) => setCfg({ ...cfg, monthly_call_cap: Number(e.target.value) })} className={`${input} w-24`} /></label>
          <label>Concurrency<br /><input type="number" min={1} value={cfg.max_concurrency ?? 1} onChange={(e) => setCfg({ ...cfg, max_concurrency: Number(e.target.value) })} className={`${input} w-20`} /></label>
        </div>
        <label className="mt-3 block text-sm">Provider agreement evidence (required before delivering Suno output to anyone other than you)
          <textarea rows={2} value={cfg.agreement ?? ""} onChange={(e) => setCfg({ ...cfg, agreement: e.target.value })} className={`${input} mt-1 w-full`}
            placeholder="e.g. Written agreement with Suno dated …, reference …, permits generation for customers, storage and streaming in Vibii" />
        </label>
        <p className="mt-2 text-xs text-muted">
          official_api: {data?.officialApi.ok ? "available" : data?.officialApi.reason}. Monetary cost per call: unknown — call caps enforced instead.
        </p>
        <button onClick={saveCfg} className="mt-3 rounded-lg bg-peach px-4 py-2 font-medium text-peach-ink">Save</button>
      </section>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">Requests</h2>
          <select value={state} onChange={(e) => setState(e.target.value)} className={`${input} text-sm`} aria-label="Filter by state">
            {STATES.map((s) => <option key={s} value={s} className="bg-[#1a1430]">{s || "all states"}</option>)}
          </select>
          <button onClick={load} className="text-sm text-lavender">Refresh</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="py-1 pe-3">Request</th><th className="pe-3">Listener</th><th className="pe-3">Kind</th><th className="pe-3">Mode</th><th className="pe-3">State</th><th>Created</th></tr></thead>
            <tbody>
              {data?.requests.map((r) => (
                <tr key={r.id} className="border-t border-line/50">
                  <td className="py-2 pe-3"><Link className="text-peach underline" href={`/admin/requests/${r.id}`}>{r.title || r.id.slice(0, 8)}</Link></td>
                  <td className="pe-3">{r.display_name ?? "—"}</td>
                  <td className="pe-3">{r.kind}{r.slot ? ` #${r.slot}` : ""}</td>
                  <td className="pe-3">{r.provider_mode}</td>
                  <td className="pe-3">{r.state}{r.candidates ? ` (${r.candidates} cand.)` : ""}{r.error_code ? ` · ${r.error_code}` : ""}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {!data?.requests.length && <tr><td colSpan={6} className="py-3 text-muted">No requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-3 text-lg font-medium">Grant test entitlement / record pilot payment</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="email, name or user id" className={input} />
          <button onClick={search} className="rounded-lg border border-line px-3">Find</button>
        </div>
        <ul className="mt-2 text-sm">
          {users.map((u) => (
            <li key={u.id}><button onClick={() => setGrant({ ...grant, ownerId: u.id })} className="underline">{u.email ?? "(no email)"} · {u.display_name ?? "—"} · {u.id.slice(0, 8)}{u.is_demo ? " · demo" : ""}</button></li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label>User id<br /><input value={grant.ownerId} onChange={(e) => setGrant({ ...grant, ownerId: e.target.value })} className={`${input} w-72`} /></label>
          <label>Songs<br /><input type="number" min={1} max={20} value={grant.quantity} onChange={(e) => setGrant({ ...grant, quantity: Number(e.target.value) })} className={`${input} w-20`} /></label>
          <label>Source<br />
            <select value={grant.source} onChange={(e) => setGrant({ ...grant, source: e.target.value })} className={input}>
              <option value="admin_test_grant" className="bg-[#1a1430]">test grant</option>
              <option value="pilot_external_payment" className="bg-[#1a1430]">pilot — paid externally</option>
            </select>
          </label>
          {grant.source === "pilot_external_payment" && (
            <label>Period (YYYY-MM)<br /><input value={grant.period} onChange={(e) => setGrant({ ...grant, period: e.target.value })} className={`${input} w-28`} /></label>
          )}
          <label>Note<br /><input value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} className={input} /></label>
          <button onClick={doGrant} className="rounded-lg bg-peach px-4 py-2 font-medium text-peach-ink">Grant</button>
        </div>
        <p className="mt-2 text-xs text-muted">Billing is disabled. A pilot payment is granted once per user per period.</p>
      </section>
    </div>
  );
}

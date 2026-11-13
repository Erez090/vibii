"use client";
import { useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function AdminMetrics() {
  const [d, setD] = useState<any>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    fetch(`/api/admin/metrics?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => r.json()).then(setD);
  }, [days]);
  if (!d) return <p className="text-muted">Loading…</p>;
  const pct = (n: number, den: number) => (den ? `${Math.round((n / den) * 100)}%` : "—");
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-medium">Metrics</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-line bg-white/[0.04] px-2 py-1 text-sm" aria-label="Window">
          {[7, 30, 90].map((x) => <option key={x} value={x} className="bg-[#1a1430]">last {x} days</option>)}
        </select>
      </div>
      <p className="text-xs text-muted">Demo and admin accounts are excluded. Targets are experiment configuration, not results. Small samples are signals, not proof.</p>
      <table className="w-full text-left text-sm">
        <thead className="text-muted"><tr><th className="py-1">Metric</th><th>Numerator / denominator</th><th>Rate</th><th>Target</th><th>Window</th></tr></thead>
        <tbody>
          {d.ratios.map((r: any) => (
            <tr key={r.key} className="border-t border-line/50">
              <td className="py-2 pe-3">{r.label}{r.note && <div className="text-xs text-muted">{r.note}</div>}</td>
              <td>{r.numerator} / {r.denominator}</td>
              <td>{pct(r.numerator, r.denominator)}</td>
              <td>{r.target != null ? `${r.target * 100}%` : "—"}</td>
              <td className="text-xs text-muted">{r.from.slice(0, 10)} → {r.to.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="rounded-2xl border border-line p-4 text-sm">
        <h2 className="mb-2 font-medium">Provider cost</h2>
        <p>Attempts: {d.costs.attempts} · estimated credits {d.costs.estimated_credits} · actual credits {d.costs.actual_credits}</p>
        <p>Attempts with known money cost: {d.costs.attempts_with_known_money} (USD {d.costs.known_usd})</p>
        <p className="text-xs text-muted">{d.costs.monetary_cost_note}</p>
      </section>
      <section className="rounded-2xl border border-line p-4 text-sm">
        <h2 className="mb-2 font-medium">Latency by provider mode (seconds)</h2>
        {!d.latency.length && <p className="text-muted">No released first playlists in this window.</p>}
        {d.latency.map((l: any) => (
          <p key={l.mode}>{l.mode} (n={l.n}): interview p50 {Math.round(l.interview_p50)} / p90 {Math.round(l.interview_p90)} · final answer → ready p50 {Math.round(l.final_to_ready_p50)} / p90 {Math.round(l.final_to_ready_p90)} · first question → ready p50 {Math.round(l.first_q_to_ready_p50)} / p90 {Math.round(l.first_q_to_ready_p90)}</p>
        ))}
      </section>
    </div>
  );
}

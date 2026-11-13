"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../LangProvider";
import type { TKey } from "@/lib/i18n";

interface Req { id: string; state: string; provider_mode: string; title: string; summary: { topic?: string; forWhom?: string } | null; created_at: string; track_id: string | null }
interface Bal { songsAvailable: number; credits: number }

const LANGS = [["en", "English"], ["he", "עברית"], ["es", "Español"], ["instrumental", "Instrumental"]] as const;
const VIBES = ["chill", "drive", "party", "calm"] as const;
const DRAFT_KEY = "vibii_create_draft";
const EMPTY = { forWhom: "me", topic: "", language: "en", vibe: "chill", story: "", useStory: false };

function newKey() {
  return (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
}

export function CreateNew() {
  const { t } = useT();
  const [data, setData] = useState<{ requests: Req[]; balances: Bal; deliveryMode: string } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [key, setKey] = useState<string>("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variationOf, setVariationOf] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/requests", { cache: "no-store" });
    if (r.status === 401) return void (window.location.href = "/login?expired=1");
    if (r.ok) setData(await r.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the await
    void load();
  }, [load]);

  // Restore an unsent draft with its idempotency key (sessionStorage is client-only, so after hydration),
  // so a refresh + resubmit cannot double-create.
  useEffect(() => {
    let d: { key?: string; form?: typeof EMPTY } | null = null;
    try {
      d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {}
    /* eslint-disable react-hooks/set-state-in-effect -- one-time sync from browser storage */
    setKey(d?.key ?? newKey());
    if (d?.form) setForm(d.form);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    try {
      if (key) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ key, form }));
    } catch {}
  }, [key, form]);

  useEffect(() => {
    if (!data?.requests.some((r) => !["ready", "failed", "cancelled"].includes(r.state))) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [data, load]);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/requests", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, idempotencyKey: key, confirmed: true, variationOf }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      setKey(newKey());
      setForm(EMPTY);
      setVariationOf(null);
      setStep("form");
      await load();
    } else if (body.error === "no_entitlement") setMsg(t("noEntitlement"));
    else if (res.status === 401) window.location.href = "/login?expired=1";
    else setMsg(t("networkError"));
  };

  const redeem = async () => {
    setBusy(true);
    const res = await fetch("/api/credits/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: newKey() }) });
    setBusy(false);
    if (res.ok) await load();
  };

  const b = data?.balances;
  const field = "w-full rounded-xl border border-line bg-white/[0.04] px-3 py-2.5 text-text placeholder:text-muted";

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-line p-3 text-sm">
        <span>{t("remaining")}: <b className="text-peach" data-testid="songs-available">{b?.songsAvailable ?? "…"}</b></span>
        <span>{t("credits")}: <b className="text-lavender">{b?.credits ?? "…"}</b> / 100</span>
      </div>
      {b && b.songsAvailable < 1 && b.credits >= 100 && (
        <button onClick={redeem} disabled={busy} className="w-full rounded-xl border border-lavender px-3 py-2.5 text-lavender">{t("redeem")}</button>
      )}

      {step === "form" ? (
        <form onSubmit={(e) => { e.preventDefault(); setStep("confirm"); }} className="space-y-4">
          <h1 className="text-2xl font-medium">{variationOf ? t("newVariation") : t("createTitle")}</h1>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {(["me", "gift"] as const).map((w) => (
              <button type="button" role="radio" aria-checked={form.forWhom === w} key={w} onClick={() => setForm({ ...form, forWhom: w })}
                className={`rounded-xl border px-3 py-2.5 ${form.forWhom === w ? "border-peach bg-peach text-peach-ink" : "border-line"}`}>
                {w === "me" ? t("forMe") : t("gift")}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("topic")}</span>
            <input required maxLength={120} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t("language")}</span>
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className={field}>
                {LANGS.map(([v, l]) => <option key={v} value={v} className="bg-[#1a1430]">{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t("vibe")}</span>
              <select value={form.vibe} onChange={(e) => setForm({ ...form, vibe: e.target.value })} className={field}>
                {VIBES.map((v) => <option key={v} value={v} className="bg-[#1a1430]">{v}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("story")}</span>
            <textarea maxLength={600} rows={3} value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} className={field} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.useStory} onChange={(e) => setForm({ ...form, useStory: e.target.checked })} className="h-4 w-4 accent-[var(--peach)]" />
            {t("useStory")}
          </label>
          <button type="submit" className="h-12 w-full rounded-xl bg-peach font-medium text-peach-ink">{t("next_q")}</button>
        </form>
      ) : (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <h2 className="text-lg font-medium">{t("summary")}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">{t("topic")}</dt><dd>{form.topic}</dd>
            <dt className="text-muted">{t("language")}</dt><dd>{form.language}</dd>
            <dt className="text-muted">{t("vibe")}</dt><dd>{form.vibe}</dd>
            <dt className="text-muted">{t("story")}</dt><dd>{form.story ? (form.useStory ? "✓" : "—") : "—"}</dd>
          </dl>
          <p className="text-sm text-lavender">{t("remaining")}: {b?.songsAvailable ?? 0} → {Math.max(0, (b?.songsAvailable ?? 0) - 1)}</p>
          <p className="text-xs text-muted">{t("consequence")}</p>
          <p className="text-xs text-muted">{data?.deliveryMode === "manual" ? t("deliveryManual") : data?.deliveryMode === "demo" ? t("deliveryDemo") : ""}</p>
          {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setStep("form")} className="rounded-xl border border-line py-2.5">{t("back")}</button>
            <button onClick={submit} disabled={busy || (b?.songsAvailable ?? 0) < 1} className="rounded-xl bg-peach py-2.5 font-medium text-peach-ink disabled:opacity-50" data-testid="confirm-create">
              {t("confirmCreate")}
            </button>
          </div>
        </div>
      )}

      {!!data?.requests.length && (
        <div>
          <h2 className="mb-2 text-lg font-medium">{t("yourRequests")}</h2>
          <ul className="space-y-2">
            {data.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{r.summary?.topic || r.title}</span>
                  <span className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString()} · {r.provider_mode}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={r.state === "ready" ? "text-peach" : r.state === "failed" ? "text-danger" : "text-lavender"}>{t(`st_${r.state}` as TKey)}</span>
                  {r.state === "ready" && (
                    <button onClick={() => { setVariationOf(r.id); setForm({ ...form, topic: r.summary?.topic ?? "" }); setStep("form"); window.scrollTo({ top: 0 }); }} className="text-xs text-muted underline">
                      {t("newVariation")}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

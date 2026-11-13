"use client";
import Link from "next/link";
import { useState } from "react";
import { useT } from "./LangProvider";
import { setLanguage, signOut } from "./auth-client";

export function ProfileClient(props: {
  user: { displayName: string | null; email: string | null; isAdmin: boolean; isDemo: boolean; uiLanguage: "en" | "he" };
  guest?: boolean;
  balances: { songsAvailable: number; credits: number; starterAvailable: number };
  consent: { personalDetails: boolean; providerProcessing: boolean } | null;
}) {
  const { t, lang } = useT();
  const [name, setName] = useState(props.user.displayName ?? "");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(props.consent);
  const [err, setErr] = useState<string | null>(null);

  const saveName = async () => {
    await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name }) });
  };
  const withdrawProcessing = async () => {
    if (!consent) return;
    const next = { ...consent, providerProcessing: !consent.providerProcessing };
    const r = await fetch("/api/onboarding/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    if (r.ok) setConsent(next);
  };
  const del = async () => {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/me", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm }) });
    setBusy(false);
    if (r.ok) window.location.href = "/login?deleted=1";
    else setErr(t("networkError"));
  };

  const card = "rounded-2xl border border-line p-4";
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-medium">{t("profile")}</h1>
      <div className={card}>
        <label className="block text-sm text-muted">Name</label>
        <div className="mt-1 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="flex-1 rounded-xl border border-line bg-white/[0.04] px-3 py-2" />
          <button onClick={saveName} className="rounded-xl border border-line px-3">✓</button>
        </div>
        {props.user.email && <p className="mt-2 text-sm text-muted">{props.user.email}</p>}
        {props.user.isDemo && <p className="mt-2 text-xs text-lavender">{props.guest ? "Guest account — it lives in this browser. Clearing cookies signs you out for good." : "Local demo account (isolated, this machine only)."}</p>}
      </div>

      <div className={card}>
        <p className="mb-2 text-sm text-muted">{t("uiLanguage")}</p>
        <div className="grid grid-cols-2 gap-2">
          {(["en", "he"] as const).map((l) => (
            <button key={l} onClick={() => setLanguage(l)} aria-pressed={lang === l}
              className={`rounded-xl border py-2 ${lang === l ? "border-peach bg-peach text-peach-ink" : "border-line"}`}>
              {l === "en" ? "English" : "עברית"}
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} text-sm`}>
        <p>{t("remaining")}: <b className="text-peach">{props.balances.songsAvailable}</b></p>
        <p>{t("credits")}: <b className="text-lavender">{props.balances.credits}</b></p>
      </div>

      {consent && (
        <div className={`${card} text-sm`}>
          <p>Personal details in songs: <b>{consent.personalDetails ? "on" : "off (taste only)"}</b></p>
          <p className="mt-1">Send permitted details to creation providers: <b>{consent.providerProcessing ? "on" : "off"}</b></p>
          <button onClick={withdrawProcessing} className="mt-2 rounded-xl border border-line px-3 py-1.5">
            {consent.providerProcessing ? "Withdraw provider processing" : "Allow provider processing"}
          </button>
          <p className="mt-2 text-xs text-muted">Withdrawing stops work not yet sent. Songs already delivered stay in your library.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={signOut} className="rounded-xl border border-line py-2.5">{t("signOut")}</button>
        {props.user.isAdmin && <Link href="/admin" className="rounded-xl border border-lavender py-2.5 text-center text-lavender">Admin</Link>}
      </div>

      <details className={card}>
        <summary className="cursor-pointer text-danger">{t("deleteAccount")}</summary>
        <p className="mt-2 text-sm text-muted">{t("deleteWarning")}</p>
        <label className="mt-3 block text-sm">
          {t("typeDelete")}
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-3 py-2" />
        </label>
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
        <button onClick={del} disabled={confirm !== "DELETE" || busy} className="mt-3 w-full rounded-xl bg-danger/90 py-2.5 font-medium text-black disabled:opacity-40">
          {t("deleteAccount")}
        </button>
      </details>
    </section>
  );
}

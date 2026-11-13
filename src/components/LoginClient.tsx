"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useT } from "./LangProvider";
import { setLanguage } from "./auth-client";

export function LoginClient(props: {
  mode: "supabase" | "local_demo" | "unconfigured";
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  notice: "deleted" | "expired" | "error" | null;
}) {
  const { t, lang } = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supa = () => createBrowserClient(props.supabaseUrl!, props.supabaseAnonKey!);
  const redirectTo = () => `${window.location.origin}/auth/callback`;

  const google = async () => {
    setBusy(true);
    const { error } = await supa().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) {
      setErr(error.message);
      setBusy(false);
    }
  };
  const magic = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supa().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };
  const demo = async () => {
    setBusy(true);
    const r = await fetch("/api/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Local demo" }) });
    if (r.ok) window.location.href = "/onboarding";
    else {
      setErr("Local demo sign-in is unavailable.");
      setBusy(false);
    }
  };

  const notice = props.notice === "deleted" ? "Your account was deleted." : props.notice === "expired" ? t("sessionExpired") : props.notice === "error" ? "Sign-in failed. Please try again." : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-6 py-10">
      <h1 className="logo-text text-center text-[72px] font-medium leading-none">Vibii</h1>
      <p className="mt-3 text-center text-lg text-lavender">{t("tagline")}</p>
      {notice && <p role="status" className="mt-6 rounded-xl border border-line p-3 text-center text-sm">{notice}</p>}

      <div className="mt-10 space-y-3">
        {props.mode === "supabase" && (
          <>
            <button onClick={google} disabled={busy} className="h-12 w-full rounded-xl bg-peach font-medium text-peach-ink">Continue with Google</button>
            <div className="py-1 text-center text-xs text-muted">or</div>
            {sent ? (
              <p role="status" className="rounded-xl border border-line p-3 text-center text-sm">Check your inbox for a sign-in link. Your email is verified when you open it.</p>
            ) : (
              <form onSubmit={magic} className="space-y-2">
                <label className="block text-sm text-muted" htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                  className="h-12 w-full rounded-xl border border-line bg-white/[0.04] px-3" />
                <button disabled={busy} className="h-12 w-full rounded-xl border border-line">Email me a sign-in link</button>
              </form>
            )}
            <p className="text-center text-xs text-muted">Adults only (18+).</p>
          </>
        )}
        {props.mode === "local_demo" && (
          <>
            <button onClick={demo} disabled={busy} className="h-12 w-full rounded-xl bg-peach font-medium text-peach-ink" data-testid="demo-login">
              Start local demo account
            </button>
            <p className="text-center text-xs text-muted">
              Isolated local demo: data stays in this machine&apos;s database. Supabase is not configured, so Google/email sign-in is off.
              This option never exists in production.
            </p>
          </>
        )}
        {props.mode === "unconfigured" && (
          <p className="rounded-xl border border-line p-4 text-sm text-muted">
            Sign-in isn&apos;t configured on this deployment yet. The operator needs to set the Supabase environment variables (see README).
          </p>
        )}
        {err && <p role="alert" className="text-center text-sm text-danger">{err}</p>}
      </div>

      <div className="mt-10 flex justify-center gap-3 text-sm">
        <button onClick={() => setLanguage("en")} aria-pressed={lang === "en"} className={lang === "en" ? "text-peach" : "text-muted"}>English</button>
        <span className="text-muted">·</span>
        <button onClick={() => setLanguage("he")} aria-pressed={lang === "he"} className={lang === "he" ? "text-peach" : "text-muted"}>עברית</button>
      </div>
    </main>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Answers, Category } from "@/lib/onboarding";
import { useT } from "../LangProvider";
import { setLanguage } from "../auth-client";
import { CHILD_AGES, FOLLOWUP_CHIP_OPTS, type Opt, QUESTIONS, SECTIONS, SPECIES } from "./questions";

interface Snapshot {
  answers: Answers;
  consent: { personalDetails: boolean; providerProcessing: boolean } | null;
  sequence: Category[];
  completed: boolean;
  credits: number;
  displayName?: string | null;
  awarded?: boolean;
  justCompleted?: boolean;
}

type Phase = "opener" | "consent" | "question";

export function Onboarding() {
  const { t, lang } = useT();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<Phase>("opener");
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState<Record<string, unknown>>({});
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [award, setAward] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showProviders, setShowProviders] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const he = lang === "he";
  const L = (x: Record<"en" | "he", string>) => x[lang];

  /** Move to a screen and load its saved answer (resume / Back keep what was entered). */
  const goTo = useCallback((s: Snapshot, i: number) => {
    const c = s.sequence[i];
    const a = c ? s.answers[c] : undefined;
    setIdx(i);
    setValue(a && !a.skipped ? a.value : c === "display_name" && s.displayName ? { text: s.displayName } : {});
    setIsPrivate(a?.isPrivate ?? false);
  }, []);
  const load = useCallback(async () => {
    const r = await fetch("/api/onboarding", { cache: "no-store" });
    if (r.status === 401) return void (window.location.href = "/login?expired=1");
    const s: Snapshot = await r.json();
    if (s.completed) return void (window.location.href = "/");
    setSnap(s);
    if (s.consent) {
      // Resume at the first unanswered screen.
      const first = s.sequence.findIndex((c) => !s.answers[c]);
      goTo(s, first < 0 ? s.sequence.length - 1 : first);
      setPhase("question");
    }
  }, [goTo]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the await
    void load();
  }, [load]);

  const category = snap?.sequence[idx];
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase, category]);

  const giveConsent = async (personalDetails: boolean, providerProcessing: boolean) => {
    setBusy(true);
    const r = await fetch("/api/onboarding/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personalDetails, providerProcessing }) });
    setBusy(false);
    if (!r.ok) return setErr(t("networkError"));
    const s: Snapshot = await r.json();
    setSnap(s);
    const first = s.sequence.findIndex((c) => !s.answers[c]);
    goTo(s, first < 0 ? 0 : first);
    setPhase("question");
  };

  const save = async (skipped: boolean) => {
    if (!category || !snap) return;
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/onboarding/answer", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, value, skipped, isPrivate }),
    });
    setBusy(false);
    if (r.status === 401) return void (window.location.href = "/login?expired=1");
    if (!r.ok) return setErr(t("networkError"));
    const s: Snapshot = await r.json();
    if (s.awarded) {
      setAward(he ? "+5 קרדיטים" : "+5 credits");
      setTimeout(() => setAward(null), 1600);
    }
    if (s.completed) {
      window.location.href = "/";
      return;
    }
    setSnap(s);
    const pos = s.sequence.indexOf(category);
    const nextUnanswered = s.sequence.findIndex((c, i) => i > pos && !s.answers[c]);
    goTo(s, nextUnanswered >= 0 ? nextUnanswered : Math.min(pos + 1, s.sequence.length - 1));
  };

  if (!snap) return <main className="grid min-h-dvh place-items-center text-muted pulse-soft">{t("loading")}</main>;

  const shell = (children: React.ReactNode, progress?: React.ReactNode) => (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <span className="logo-text text-3xl font-medium">Vibii</span>
        <span className="text-sm text-lavender" aria-live="polite">{award ?? `${snap.credits} ${he ? "קרדיטים" : "credits"}`}</span>
      </div>
      {progress}
      {children}
    </main>
  );

  if (phase === "opener") {
    return shell(
      <section className="fade-in flex flex-1 flex-col justify-center text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-medium leading-snug">
          {he ? "יש שתי דקות? בואו נכיר." : "Got two minutes? Let’s get to know you."}
        </h1>
        <p className="mt-3 text-muted">{he ? "שאלות יומיומיות קצרות. בסוף מחכה לך הפתעה." : "A few everyday questions. There’s a surprise at the end."}</p>
        <button onClick={() => setPhase("consent")} className="mx-auto mt-10 h-14 w-full max-w-xs rounded-full bg-peach text-lg font-medium text-peach-ink">
          {he ? "יאללה" : "Let’s go"}
        </button>
        <div className="mt-6 flex justify-center gap-3 text-sm">
          <button onClick={() => setLanguage("en")} className={!he ? "text-peach" : "text-muted"}>English</button>
          <button onClick={() => setLanguage("he")} className={he ? "text-peach" : "text-muted"}>עברית</button>
        </div>
      </section>,
    );
  }

  if (phase === "consent") {
    return shell(
      <section className="fade-in flex flex-1 flex-col justify-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-medium">{he ? "לפני שמתחילים" : "Before we start"}</h1>
        <p className="mt-3 text-muted">
          {he
            ? "Vibii משתמשת רק בפרטים שבחרת לשתף כדי להתאים לך מוזיקה פרטית. שמות ופרטים אישיים הם רשות, ואפשר לסמן כל פרט כפרטי."
            : "Vibii uses only the details you choose to share to personalise private music for you. Names and personal details are optional, and you can mark any detail as private."}
        </p>
        <button onClick={() => setShowProviders((v) => !v)} aria-expanded={showProviders} className="mt-2 self-start text-sm text-lavender underline">
          {he ? "מי מעבד את המידע?" : "Who processes this?"}
        </button>
        {showProviders && (
          <div className="mt-2 rounded-xl border border-line p-3 text-sm text-muted">
            {he
              ? "התשובות נשמרות אצלנו (Supabase, אחסון פרטי). כדי ליצור שירים, צוות Vibii עשוי להעביר בריף מוזיקלי — סגנון, מילים ופרטים שהרשית — לספק יצירת מוזיקה (כיום Suno, דרך החשבון של המפעיל). שמות ילדים ופרטים פרטיים לא נשלחים לספק תמונות. אין שימוש בפרטים לפרסום."
              : "Your answers are stored by Vibii (Supabase, private storage). To make songs, a Vibii operator may send a music brief — style, lyrics and the details you permit — to a music-creation provider (currently Suno, via the operator’s account). Children’s names and private details are never sent to an image provider. Nothing is used for advertising."}
          </div>
        )}
        <div className="mt-6 space-y-2">
          <button disabled={busy} onClick={() => giveConsent(true, true)} className="w-full rounded-xl bg-peach px-4 py-3 text-start font-medium text-peach-ink">
            {he ? "מסכים/ה — כולל פרטים אישיים שאבחר לשתף" : "I agree — including personal details I choose to share"}
          </button>
          <button disabled={busy} onClick={() => giveConsent(false, true)} className="w-full rounded-xl border border-line px-4 py-3 text-start">
            {he ? "רק טעם מוזיקלי — בלי שאלות על משפחה" : "Taste only — skip family and personal questions"}
          </button>
          <button disabled={busy} onClick={() => giveConsent(false, false)} className="w-full rounded-xl border border-line px-4 py-3 text-start text-sm text-muted">
            {he ? "לא לשלוח את התשובות לאף ספק — להשתמש רק באודיו מורשה קיים" : "Don’t send my answers to any provider — use existing authorised audio only"}
          </button>
        </div>
        {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        <p className="mt-6 text-xs text-muted">{he ? "השירות מיועד לבני 18 ומעלה." : "Vibii is for adults (18+)."}</p>
      </section>,
    );
  }

  if (!category) return null;
  const q = QUESTIONS[category];
  const petName = String(snap.answers.pet?.value.name ?? "");
  const title = typeof q.title === "function" ? q.title({ petName }) : q.title;
  const section = q.section;
  const inSection = snap.sequence.filter((c) => QUESTIONS[c].section === section);
  const posInSection = inSection.indexOf(category);

  const chips = (opts: Opt[], field: string, multi: boolean, max = 3) => {
    const cur = value[field];
    const arr = Array.isArray(cur) ? (cur as string[]) : [];
    return (
      <div role={multi ? "group" : "radiogroup"} className="flex flex-wrap gap-2">
        {opts.map((op) => {
          const on = multi ? arr.includes(op.value) : cur === op.value;
          return (
            <button key={op.value} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on}
              onClick={() => setValue((v) => ({
                ...v,
                [field]: multi ? (on ? arr.filter((x) => x !== op.value) : arr.length >= max ? arr : [...arr, op.value]) : op.value,
              }))}
              className={`rounded-full border px-4 py-2.5 ${on ? "border-peach bg-peach text-peach-ink" : "border-line bg-white/[0.03]"}`}>
              {L(op.label)}
            </button>
          );
        })}
      </div>
    );
  };
  const text = (field: string, placeholder: string, max = 60) => (
    <input value={String(value[field] ?? "")} maxLength={max} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => setValue((v) => ({ ...v, [field]: e.target.value }))}
      className="mt-3 h-12 w-full rounded-xl border border-line bg-white/[0.04] px-3 placeholder:text-muted" />
  );
  const privateToggle = (
    <label className="mt-4 flex items-center gap-2 text-sm text-muted">
      <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="h-4 w-4 accent-[var(--peach)]" />
      {he ? "לשמור כפרטי — לא לשלב במילים" : "Keep private — don’t use in lyrics"}
    </label>
  );

  let body: React.ReactNode = null;
  switch (category) {
    case "display_name":
    case "country":
      body = text(q.field!, L(q.placeholder!), 40);
      break;
    case "age_band":
      body = chips(q.options!, "band", false);
      break;
    case "genres":
      body = (
        <>
          {chips(q.options!, "genres", true, 3)}
          <div className="mt-4 flex flex-wrap gap-2">
            {[["surprise", he ? "תפתיעו אותי" : "Surprise me"], ["instrumental", he ? "מעדיף/ה בלי מילים" : "I prefer instrumental"]].map(([f, l]) => (
              <button key={f} type="button" role="checkbox" aria-checked={Boolean(value[f])} onClick={() => setValue((v) => ({ ...v, [f]: !v[f] }))}
                className={`rounded-full border px-4 py-2 text-sm ${value[f] ? "border-lavender bg-lavender/20" : "border-line"}`}>{l}</button>
            ))}
          </div>
        </>
      );
      break;
    case "song_language":
    case "moments":
      body = chips(q.options!, q.field!, true, 3);
      break;
    case "relationship":
      body = (
        <>
          {chips(q.options!, "status", false)}
          {(value.status === "partnered" || value.status === "married") && text("nickname", he ? "כינוי לבן/בת הזוג (רשות)" : "Partner’s nickname (optional)", 30)}
          {privateToggle}
        </>
      );
      break;
    case "children": {
      const count = Number(value.count ?? -1);
      body = (
        <>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setValue((v) => ({ ...v, count: n }))}
                className={`min-w-14 rounded-full border px-4 py-2.5 ${count === n ? "border-peach bg-peach text-peach-ink" : "border-line"}`}>
                {n === 0 ? (he ? "אין" : "None") : n === 4 ? "4+" : n}
              </button>
            ))}
          </div>
          {count > 0 && (
            <>
              {text("names", he ? "שמות או כינויים (רשות)" : "First names or nicknames (optional)", 80)}
              <p className="mt-4 mb-2 text-sm text-muted">{he ? "הצעיר/ה ביותר:" : "Youngest:"}</p>
              {chips(CHILD_AGES, "youngest", false)}
            </>
          )}
          {privateToggle}
        </>
      );
      break;
    }
    case "pet":
      body = (
        <>
          {chips(q.options!, "status", false)}
          {(value.status === "now" || value.status === "past") && (
            <>
              {text("name", he ? "שם (רשות)" : "Name (optional)", 30)}
              <div className="mt-3">{chips(SPECIES, "species", false)}</div>
            </>
          )}
          {privateToggle}
        </>
      );
      break;
    case "hobby":
      body = (<>{chips(q.options!, "hobbies", true, 3)}{text("text", he ? "או במילים שלך" : "Or in your own words", 80)}</>);
      break;
    case "work":
      body = (<>{chips(q.options!, "field", false)}{text("role", he ? "תפקיד (רשות)" : "Role (optional)", 60)}</>);
      break;
    case "upcoming_event":
      body = (<>{chips(q.options!, "kind", false)}{value.kind && value.kind !== "none" && text("text", he ? "כמה מילים (רשות)" : "A few words (optional)", 100)}</>);
      break;
    default:
      body = (
        <>
          {text("text", he ? "כמה מילים" : "A few words", 120)}
          <div className="mt-3">{chips(FOLLOWUP_CHIP_OPTS, "chips", true, 3)}</div>
          {privateToggle}
        </>
      );
  }

  const progress = (
    <div className="mt-4" aria-label="Progress">
      <div className="flex gap-1.5">
        {SECTIONS.map((s, i) => (
          <div key={i} className="flex-1">
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-peach" style={{ width: i < section ? "100%" : i > section ? "0%" : `${((posInSection + 1) / inSection.length) * 100}%` }} />
            </div>
            <p className={`mt-1 text-[11px] ${i === section ? "text-lavender" : "text-muted"}`}>{L(s)}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return shell(
    <form key={category} className="fade-in flex flex-1 flex-col pt-8" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
      <h1 ref={headingRef} tabIndex={-1} className="text-[26px] font-medium leading-snug" data-testid="question">{L(title)}</h1>
      <div className="mt-6">{body}</div>
      {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
      <div className="mt-auto grid grid-cols-[auto_1fr_auto] items-center gap-2 pt-8">
        <button type="button" onClick={() => (idx > 0 ? goTo(snap, idx - 1) : setPhase("consent"))} className="rounded-xl px-3 py-3 text-muted">{t("back")}</button>
        <button type="submit" disabled={busy} className="h-12 rounded-xl bg-peach font-medium text-peach-ink" data-testid="next">{t("next_q")}</button>
        <button type="button" disabled={busy} onClick={() => save(true)} className="rounded-xl px-3 py-3 text-muted" data-testid="skip">{t("skip")}</button>
      </div>
    </form>,
    progress,
  );
}

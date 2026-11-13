"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../LangProvider";
import { usePlayer, type QTrack } from "../player/PlayerProvider";
import { NowPlaying } from "../player/NowPlaying";

interface Track extends QTrack {
  moment: string | null;
  energy: string | null;
  external: { url: string; service: string } | null;
  feedback: string[];
  playlist: "starter" | "library";
  position: number;
}
interface State {
  onboardingComplete: boolean;
  starterStatus: "none" | "waiting" | "delayed" | "manual_waiting" | "released" | "not_eligible";
  revealSeen: boolean;
  lastTrackId: string | null;
  lastPosition: number;
  lastVibe: string | null;
  tracks: Track[];
}

const VIBE_LABELS: Record<string, { en: string; he: string }> = {
  drive: { en: "Drive", he: "נהיגה" }, work: { en: "Focus", he: "פוקוס" }, workout: { en: "Workout", he: "אימון" },
  walking: { en: "Walk", he: "הליכה" }, home: { en: "Home", he: "בבית" }, winding_down: { en: "Evening", he: "ערב" },
  chill: { en: "Chill", he: "צ׳יל" }, party: { en: "Party", he: "מסיבה" }, calm: { en: "Calm", he: "רוגע" },
};

function rank(tracks: Track[], vibe: string) {
  const list = vibe === "all" ? tracks : tracks.filter((t) => t.moment === vibe);
  const score = (t: Track) => (t.liked ? 2 : 0) - (t.feedback.includes("not_my_taste") ? 5 : 0);
  return [...list].sort((a, b) => score(b) - score(a) || (a.playlist === b.playlist ? a.position - b.position : a.playlist === "starter" ? -1 : 1));
}

export function DjVibii() {
  const { t, lang } = useT();
  const player = usePlayer();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [vibe, setVibe] = useState<string>("all");
  const restored = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/player", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login?expired=1";
        return;
      }
      if (!res.ok) throw new Error();
      setState(await res.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set after the await
    void load();
  }, [load]);

  // Real waiting state: poll the persisted gate while the album is being produced.
  useEffect(() => {
    if (!state || state.starterStatus === "released" || state.starterStatus === "not_eligible" || state.starterStatus === "none") return;
    const ms = state.starterStatus === "waiting" ? 4000 : 30000;
    const id = setInterval(load, ms);
    return () => clearInterval(id);
  }, [state, load]);

  const playable = useMemo(() => (state?.tracks ?? []).filter((x) => !x.external), [state]);
  const externalOnly = useMemo(() => (state?.tracks ?? []).filter((x) => x.external), [state]);
  const vibes = useMemo(() => ["all", ...Array.from(new Set(playable.map((x) => x.moment).filter(Boolean) as string[]))], [playable]);

  // Return to the last vibe & track without autoplay (play requires a tap).
  useEffect(() => {
    if (!state || restored.current || player.queue.length) return;
    if (state.starterStatus === "released" && !state.revealSeen) return;
    restored.current = true;
    const v = state.lastVibe && vibes.includes(state.lastVibe) ? state.lastVibe : "all";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore alongside the external player
    setVibe(v);
    const list = rank(playable, v);
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((x) => x.id === state.lastTrackId));
    player.setQueue(list, i, { autoplay: false, startAt: list[i]?.id === state.lastTrackId ? state.lastPosition : 0 });
  }, [state, playable, vibes, player]);

  const chooseVibe = (v: string) => {
    setVibe(v);
    void fetch("/api/player/position", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vibe: v }) });
    // Changing vibe only re-orders existing tracks: never triggers generation or a charge.
    const list = rank(playable, v);
    if (list.length) player.setQueue(list, 0, { autoplay: player.isPlaying });
  };

  if (loadError && !state) {
    return (
      <div className="mt-10 text-center">
        <p className="text-muted">{t("networkError")}</p>
        <button onClick={load} className="mt-4 rounded-xl border border-line px-4 py-2">{t("retry")}</button>
      </div>
    );
  }
  if (!state) return <p className="mt-10 text-center text-muted pulse-soft">{t("loading")}</p>;

  // ---------------------------------------------------------------- waiting / delayed
  if (["waiting", "manual_waiting", "delayed"].includes(state.starterStatus) && !player.queue.length) {
    const body = state.starterStatus === "delayed" ? t("delayed") : state.starterStatus === "manual_waiting" ? t("manualWaiting") : t("waitingBody");
    return (
      <section aria-live="polite" className="mt-6 flex flex-1 flex-col items-center text-center">
        <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-[#2a1840] via-[#1a1530] to-[#0f1a33]">
          <div className="pulse-soft absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(247,168,115,0.55),transparent_65%)]" />
          <div className="absolute inset-0 grid place-items-center text-6xl text-peach/80" aria-hidden>♪</div>
        </div>
        <h1 className="mt-6 text-2xl font-medium">{t("waitingTitle")}</h1>
        <p className="mt-2 max-w-sm text-muted">{body}</p>
      </section>
    );
  }

  // ---------------------------------------------------------------- reveal
  if (state.starterStatus === "released" && !state.revealSeen && !player.queue.length) {
    const starter = playable.filter((x) => x.playlist === "starter").sort((a, b) => a.position - b.position);
    return (
      <section className="fade-in mt-2 flex flex-1 flex-col items-center text-center">
        <h1 className="text-[28px] font-medium">{t("revealTitle")}</h1>
        <ol className="mt-4 grid w-full grid-cols-3 gap-2" aria-label={t("revealTitle")}>
          {starter.map((x, i) => (
            <li key={x.id} className="min-w-0 text-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={x.coverUrl ?? ""} alt={x.coverAlt ?? ""} className="aspect-square w-full rounded-xl" />
              <p className="mt-1 truncate text-[13px] font-medium">{i + 1}. {x.title}</p>
              {x.isDemoFixture && <p className="text-[10px] text-lavender">{t("demoBadge")}</p>}
            </li>
          ))}
        </ol>
        <button
          onClick={() => {
            player.setQueue(starter, 0, { autoplay: true });
            void fetch("/api/player/reveal", { method: "POST" });
            setState({ ...state, revealSeen: true });
          }}
          className="mt-6 h-16 w-full max-w-xs rounded-full bg-peach text-xl font-medium text-peach-ink shadow-[0_8px_30px_rgba(247,168,115,0.35)]"
        >
          {t("revealPlay")}
        </button>
      </section>
    );
  }

  // ---------------------------------------------------------------- player
  return (
    <section className="flex flex-1 flex-col">
      {state.starterStatus === "not_eligible" && !playable.length && <p className="mb-3 text-center text-sm text-muted">{t("notEligible")}</p>}
      {vibes.length > 2 && (
        <div role="group" aria-label="Vibes" className="no-scrollbar -mx-1 mb-3 flex gap-2 overflow-x-auto px-1">
          {vibes.map((v) => (
            <button key={v} onClick={() => chooseVibe(v)} aria-pressed={vibe === v}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm ${vibe === v ? "border-lavender bg-lavender/20 text-text" : "border-line text-muted"}`}>
              {v === "all" ? t("vibeAll") : VIBE_LABELS[v]?.[lang] ?? v}
            </button>
          ))}
        </div>
      )}
      {player.queue.length ? (
        <NowPlaying onFeedback={load} />
      ) : (
        <p className="mt-10 text-center text-muted">{t("noTracks")}</p>
      )}
      {externalOnly.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line p-3">
          {externalOnly.map((x) => (
            <a key={x.id} href={x.external!.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between py-1.5 text-sm">
              <span className="truncate">{x.title}</span>
              <span className="shrink-0 text-lavender">{t("openIn")} {x.external!.service} ↗</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

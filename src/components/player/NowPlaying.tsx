"use client";
import { useState } from "react";
import { Heart, More, Next, PauseIcon, PlayIcon, Prev, QueueIcon, Repeat, Shuffle } from "../Icons";
import { useT } from "../LangProvider";
import { usePlayer } from "./PlayerProvider";

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const FEEDBACK = ["more_bass", "less_lyrics", "too_slow", "not_my_taste"] as const;

export function NowPlaying({ onFeedback }: { onFeedback?: () => void }) {
  const p = usePlayer();
  const { t } = useT();
  const [sheet, setSheet] = useState<null | "feedback" | "queue">(null);
  const [toast, setToast] = useState<string | null>(null);
  const c = p.current;
  if (!c) return null;
  const pct = p.duration ? (p.currentTime / p.duration) * 100 : 0;

  const sendFeedback = async (action: string) => {
    const res = await fetch(`/api/tracks/${c.id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (res.ok) {
      if (action === "like" || action === "unlike") p.updateTrack(c.id, { liked: action === "like" });
      else {
        setToast(t("feedbackThanks"));
        setTimeout(() => setToast(null), 2500);
      }
      onFeedback?.();
    }
    setSheet(null);
  };

  const errorText = p.error === "autoplay_blocked" ? t("autoplayBlocked") : p.error === "network" ? t("networkError")
    : p.error === "track_gone" ? t("trackGone") : p.error === "session_expired" ? t("sessionExpired") : null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative">
        {c.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={c.id} src={c.coverUrl} alt={c.coverAlt ?? ""} className="fade-in aspect-square w-full rounded-2xl object-cover shadow-[0_20px_60px_rgba(0,0,0,0.45)]" />
        ) : (
          <div className="aspect-square w-full rounded-2xl bg-white/5" />
        )}
        {c.isDemoFixture && (
          <span title={c.demoLabel ?? ""} className="absolute start-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-lavender backdrop-blur">
            {t("demoBadge")}
          </span>
        )}
      </div>

      <div className="mt-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[30px] font-semibold leading-tight" data-testid="track-title">{c.title}</h1>
          <p className="truncate text-xl text-lavender">{c.artist}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <button onClick={() => sendFeedback(c.liked ? "unlike" : "like")} aria-pressed={c.liked} aria-label={c.liked ? t("unlike") : t("like")} className="rounded-full p-2 text-lavender">
            <Heart filled={c.liked} width={30} height={30} />
          </button>
          <button onClick={() => setSheet("feedback")} aria-label={t("more")} aria-haspopup="dialog" className="rounded-full p-2">
            <More width={28} height={28} />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <input
          type="range" className="seek" min={0} max={Math.max(1, p.duration)} step={0.1} value={Math.min(p.currentTime, p.duration || 0)}
          onChange={(e) => p.seek(Number(e.target.value))} aria-label={t("seek")} aria-valuetext={`${fmt(p.currentTime)} / ${fmt(p.duration)}`}
          style={{ ["--pct" as string]: `${pct}%` }} data-testid="seek"
        />
        <div className="mt-0.5 flex justify-between text-sm text-muted tabular-nums" dir="ltr">
          <span data-testid="elapsed">{fmt(p.currentTime)}</span>
          <span>{fmt(p.duration)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between" dir="ltr">
        <button onClick={p.toggleShuffle} aria-pressed={p.shuffle} aria-label={t("shuffle")} className={`p-2 ${p.shuffle ? "text-peach" : "text-text"}`}>
          <Shuffle width={30} height={30} />
        </button>
        <button onClick={p.prev} aria-label={t("prev")} className="p-2"><Prev width={34} height={34} /></button>
        <button
          onClick={p.toggle} aria-label={p.isPlaying ? t("pause") : t("play")} data-testid="play-toggle"
          className={`grid h-[84px] w-[84px] place-items-center rounded-full bg-peach text-peach-ink shadow-[0_10px_30px_rgba(247,168,115,0.35)] ${p.isLoading ? "pulse-soft" : ""}`}
        >
          {p.isPlaying ? <PauseIcon width={38} height={38} /> : <PlayIcon width={40} height={40} className="translate-x-0.5" />}
        </button>
        <button onClick={p.next} aria-label={t("next")} className="p-2"><Next width={34} height={34} /></button>
        <button onClick={p.cycleRepeat} aria-pressed={p.repeat !== "off"} aria-label={p.repeat === "one" ? t("repeatOne") : t("repeat")}
          className={`relative p-2 ${p.repeat !== "off" ? "text-peach" : "text-text"}`}>
          <Repeat width={30} height={30} />
          {p.repeat === "one" && <span className="absolute end-0 top-0 text-[10px] font-bold">1</span>}
        </button>
      </div>

      {errorText && <p role="status" className="mt-3 text-center text-sm text-lavender">{errorText}</p>}
      {toast && <p role="status" className="mt-3 text-center text-sm text-lavender">{toast}</p>}

      <div className="mt-auto flex justify-end pt-4">
        <button onClick={() => setSheet("queue")} aria-label={t("queue")} aria-haspopup="dialog" className="p-2"><QueueIcon width={30} height={30} /></button>
      </div>

      {sheet && (
        <div role="dialog" aria-modal="true" aria-label={sheet === "queue" ? t("queue") : t("feedbackTitle")} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setSheet(null)}
          onKeyDown={(e) => e.key === "Escape" && setSheet(null)}>
          <div className="w-full max-w-[480px] rounded-t-3xl border border-line bg-[#1a1430] p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">{sheet === "queue" ? t("queue") : t("feedbackTitle")}</h2>
              <button autoFocus onClick={() => setSheet(null)} className="rounded-lg px-2 py-1 text-muted">{t("close")}</button>
            </div>
            {sheet === "feedback" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {FEEDBACK.map((f) => (
                    <button key={f} onClick={() => sendFeedback(f)} className="rounded-xl border border-line px-3 py-3 text-start hover:bg-white/5">
                      {t(`fb_${f}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">{t("rankingNote")}</p>
              </>
            ) : (
              <ol className="max-h-[50dvh] space-y-1 overflow-y-auto">
                {p.queue.map((q, i) => (
                  <li key={q.id}>
                    <button onClick={() => { p.jumpTo(i); setSheet(null); }} aria-current={i === p.index ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl p-2 text-start hover:bg-white/5 ${i === p.index ? "bg-white/10" : ""}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {q.coverUrl ? <img src={q.coverUrl} alt="" className="h-10 w-10 rounded-md" /> : <span className="h-10 w-10 rounded-md bg-white/10" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{q.title}</span>
                        <span className="block truncate text-xs text-lavender">{q.artist}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

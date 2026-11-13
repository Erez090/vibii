"use client";
import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../player/PlayerProvider";

export interface VibeCard {
  itunesId: number;
  title: string;
  artist: string;
  artwork: string | null;
  reason: string;
  tags: string[];
  links: { apple: string; spotify: string; youtube: string };
}

const PREVIEW_SECONDS = 15;

function Ring({ progress }: { progress: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
      <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} strokeLinecap="round" />
    </svg>
  );
}

const SERVICE_STYLE: Record<string, string> = {
  Spotify: "bg-[#1DB954] text-black",
  YouTube: "bg-[#FF0033] text-white",
  "Apple Music": "bg-white/10 text-white border border-line",
};

export function VibesList({ items, lang }: { items: VibeCard[]; lang: "en" | "he" }) {
  const player = usePlayer();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<number | null>(null);
  const he = lang === "he";

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
    setElapsed(0);
  };
  useEffect(() => () => audio.current?.pause(), []);

  const toggle = async (id: number) => {
    if (playing === id) return stop();
    stop();
    setError(null);
    setLoading(id);
    try {
      const res = await fetch(`/api/preview/${id}`, { cache: "no-store" });
      const body = (await res.json()) as { url?: string };
      if (!res.ok || !body.url) throw new Error();
      player.pause(); // never play two things at once
      const a = new Audio(body.url);
      audio.current = a;
      a.addEventListener("timeupdate", () => {
        setElapsed(a.currentTime);
        if (a.currentTime >= PREVIEW_SECONDS) stop();
      });
      a.addEventListener("ended", stop);
      await a.play();
      setPlaying(id);
    } catch {
      setError(id);
      stop();
    } finally {
      setLoading(null);
    }
  };

  return (
    <ul className="space-y-3" data-testid="vibes-list">
      {items.map((it, i) => {
        const isPlaying = playing === it.itunesId;
        const left = Math.max(0, Math.ceil(PREVIEW_SECONDS - elapsed));
        return (
          <li key={it.itunesId} className="rounded-2xl border border-line bg-white/[0.04] p-3" data-testid="vibe-card">
            <div className="flex items-center gap-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/5">
                {it.artwork && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.artwork} alt={`${it.title} — ${it.artist} artwork`} className="h-full w-full object-cover" loading={i < 4 ? "eager" : "lazy"} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted">#{i + 1}</p>
                <h2 className="truncate text-base font-semibold">{it.title}</h2>
                <p className="truncate text-sm text-lavender">{it.artist}</p>
              </div>
              <button
                onClick={() => toggle(it.itunesId)}
                aria-label={isPlaying ? (he ? "עצירת תצוגה מקדימה" : "Stop preview") : he ? "השמעת 15 שניות" : "Play 15-second preview"}
                className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-peach text-peach-ink"
                data-testid="preview-button"
              >
                {isPlaying && <Ring progress={Math.min(1, elapsed / PREVIEW_SECONDS)} />}
                {loading === it.itunesId ? (
                  <span className="pulse-soft text-lg">…</span>
                ) : isPlaying ? (
                  <span className="text-sm font-semibold tabular-nums">{left}</span>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>
                )}
              </button>
            </div>
            <p className="mt-2 text-sm text-muted">{it.reason}</p>
            {error === it.itunesId && <p className="mt-1 text-xs text-peach">{he ? "התצוגה המקדימה לא זמינה כרגע." : "Preview isn't available right now."}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {([["Spotify", it.links.spotify], ["YouTube", it.links.youtube], ["Apple Music", it.links.apple]] as const).map(([name, url]) => (
                <a key={name} href={url} target="_blank" rel="noopener noreferrer"
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${SERVICE_STYLE[name]}`}>
                  {name}
                </a>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

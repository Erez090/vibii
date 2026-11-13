"use client";
import Link from "next/link";
import { PauseIcon, PlayIcon } from "../Icons";
import { useT } from "../LangProvider";
import { usePlayer } from "./PlayerProvider";

/** Compact controls shown on other tabs so the same global audio stays visible and controllable. */
export function MiniPlayer() {
  const { current, isPlaying, toggle, currentTime, duration } = usePlayer();
  const { t } = useT();
  if (!current) return null;
  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <div className="sticky bottom-2 mt-4 overflow-hidden rounded-2xl border border-line bg-[#1b1430]/90 backdrop-blur">
      <div className="flex items-center gap-3 p-2.5">
        {current.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.coverUrl} alt={current.coverAlt ?? ""} className="h-11 w-11 rounded-lg" />
        ) : <div className="h-11 w-11 rounded-lg bg-white/10" />}
        <Link href="/" className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{current.title}</p>
          <p className="truncate text-xs text-lavender">{t("nowPlaying")} · {current.artist}</p>
        </Link>
        <button onClick={toggle} aria-label={isPlaying ? t("pause") : t("play")} className="grid h-11 w-11 place-items-center rounded-full bg-peach text-peach-ink">
          {isPlaying ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
        </button>
      </div>
      <div className="h-0.5 bg-white/10"><div className="h-full bg-peach" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

"use client";
// One persistent <audio> element for the whole signed-in app. It lives in the (app) layout, so
// switching tabs/routes never creates a second player. Playback only starts from a user gesture.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface QTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  coverUrl: string | null;
  coverAlt: string | null;
  isDemoFixture: boolean;
  demoLabel: string | null;
  liked: boolean;
}

export type PlayerError = null | "autoplay_blocked" | "network" | "track_gone" | "session_expired";
export type RepeatMode = "off" | "all" | "one";

interface PlayerApi {
  queue: QTrack[];
  index: number;
  current: QTrack | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  error: PlayerError;
  shuffle: boolean;
  repeat: RepeatMode;
  setQueue: (tracks: QTrack[], start: number, opts?: { autoplay?: boolean; startAt?: number }) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (s: number) => void;
  next: () => void;
  prev: () => void;
  jumpTo: (i: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  updateTrack: (id: string, patch: Partial<QTrack>) => void;
}

const Ctx = createContext<PlayerApi | null>(null);
export const usePlayer = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer outside PlayerProvider");
  return c;
};

const HEARTBEAT_SECONDS = 15;
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

async function postJson(url: string, body: unknown) {
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  } catch {
    // telemetry is best-effort
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueueState] = useState<QTrack[]>([]);
  const [order, setOrder] = useState<number[]>([]); // play order (indices into queue)
  const [pos, setPos] = useState(0);                // position within order
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<PlayerError>(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  const sessionId = useRef(uid());
  const loadedId = useRef<string | null>(null);
  const urlExpiry = useRef(0);
  const wantPlay = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const refreshTries = useRef(0);
  const lastTick = useRef<number | null>(null);
  const listened = useRef(0);
  const startedSent = useRef(false);
  const lastSaved = useRef(0);

  const index = order[pos] ?? -1;
  const current = index >= 0 ? queue[index] ?? null : null;

  const flushListening = useCallback((trackId: string | null, event: "heartbeat" | "skip" | "ended" | "paused") => {
    const secs = Math.round(listened.current * 10) / 10;
    if (!trackId || (secs <= 0 && event === "heartbeat")) return;
    listened.current = 0;
    void postJson("/api/events", { event, eventId: uid(), sessionId: sessionId.current, trackId, listenedSeconds: Math.min(secs, 120) });
  }, []);

  const savePosition = useCallback((trackId: string, position: number) => {
    void postJson("/api/player/position", { trackId, position });
  }, []);

  const loadSource = useCallback(async (track: QTrack, startAt = 0) => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracks/${track.id}/url`, { cache: "no-store" });
      if (res.status === 401) {
        setError("session_expired");
        setIsLoading(false);
        return false;
      }
      if (res.status === 404 || res.status === 409) {
        setError("track_gone");
        setIsLoading(false);
        return false;
      }
      if (!res.ok) throw new Error("network");
      const { url, expiresAt } = await res.json();
      urlExpiry.current = expiresAt;
      loadedId.current = track.id;
      pendingSeek.current = startAt > 0 ? startAt : null;
      audio.src = url;
      audio.load();
      if (wantPlay.current) {
        try {
          await audio.play();
        } catch (e) {
          if (e instanceof DOMException && e.name === "NotAllowedError") setError("autoplay_blocked");
          wantPlay.current = false;
        }
      }
      return true;
    } catch {
      setError("network");
      setIsLoading(false);
      return false;
    }
  }, []);

  // Load whenever the current track changes.
  const currentId = current?.id ?? null;
  const startAtRef = useRef(0);
  useEffect(() => {
    if (!current || loadedId.current === current.id) return;
    startedSent.current = false;
    refreshTries.current = 0;
    setCurrentTime(startAtRef.current);
    setDuration(current.durationSeconds ?? 0);
    void loadSource(current, startAtRef.current);
    startAtRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const advance = useCallback((dir: 1 | -1, auto = false) => {
    setPos((p) => {
      const n = order.length;
      if (!n) return p;
      let np = p + dir;
      if (np >= n) {
        if (repeat === "all" || !auto) np = 0;
        else {
          wantPlay.current = false;
          return p;
        }
      }
      if (np < 0) np = n - 1;
      return np;
    });
  }, [order.length, repeat]);

  const setQueue = useCallback<PlayerApi["setQueue"]>((tracks, start, opts) => {
    const idxs = tracks.map((_, i) => i);
    const ord = shuffle ? [start, ...idxs.filter((i) => i !== start).sort(() => Math.random() - 0.5)] : idxs;
    wantPlay.current = Boolean(opts?.autoplay);
    startAtRef.current = opts?.startAt ?? 0;
    const sameTrack = tracks[start]?.id === loadedId.current;
    setQueueState(tracks);
    setOrder(ord);
    setPos(shuffle ? 0 : start);
    if (sameTrack && opts?.autoplay) void audioRef.current?.play().catch(() => setError("autoplay_blocked"));
  }, [shuffle]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    wantPlay.current = true;
    setError(null);
    const expired = Date.now() > urlExpiry.current - 5000;
    if (!audio.src || loadedId.current !== current.id || expired || audio.error) {
      const at = audio.currentTime || currentTime;
      void loadSource(current, at);
      return;
    }
    audio.play().catch((e) => {
      if (e instanceof DOMException && e.name === "NotAllowedError") setError("autoplay_blocked");
      else void loadSource(current, audio.currentTime);
    });
  }, [current, currentTime, loadSource]);

  const pause = useCallback(() => {
    wantPlay.current = false;
    audioRef.current?.pause();
  }, []);

  const api = useMemo<PlayerApi>(() => ({
    queue, index, current, isPlaying, isLoading, currentTime, duration, error, shuffle, repeat,
    setQueue,
    play,
    pause,
    toggle: () => (isPlaying ? pause() : play()),
    seek: (s) => {
      const a = audioRef.current;
      if (!a) return;
      const target = Math.max(0, Math.min(s, a.duration || duration || s));
      if (a.readyState > 0) a.currentTime = target;
      else pendingSeek.current = target;
      setCurrentTime(target);
    },
    next: () => {
      const a = audioRef.current;
      if (current && a && a.duration && a.currentTime < a.duration - 5) {
        flushListening(current.id, "skip");
      }
      wantPlay.current = wantPlay.current || isPlaying;
      advance(1);
    },
    prev: () => {
      const a = audioRef.current;
      if (a && a.currentTime > 3) {
        a.currentTime = 0;
        return;
      }
      wantPlay.current = wantPlay.current || isPlaying;
      advance(-1);
    },
    jumpTo: (i) => {
      const p = order.indexOf(i);
      if (p < 0) return;
      wantPlay.current = true;
      setPos(p);
      if (queue[i]?.id === loadedId.current) play();
    },
    toggleShuffle: () => {
      setShuffle((s) => {
        const on = !s;
        setOrder(() => {
          const idxs = queue.map((_, i) => i);
          if (!on) {
            setPos(index >= 0 ? index : 0);
            return idxs;
          }
          const rest = idxs.filter((i) => i !== index).sort(() => Math.random() - 0.5);
          setPos(0);
          return index >= 0 ? [index, ...rest] : rest;
        });
        return on;
      });
    },
    cycleRepeat: () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    updateTrack: (id, patch) => setQueueState((q) => q.map((t) => (t.id === id ? { ...t, ...patch } : t))),
  }), [queue, index, current, isPlaying, isLoading, currentTime, duration, error, shuffle, repeat, setQueue, play, pause, advance, flushListening, order]);

  // Audio element events.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => {
      setIsPlaying(true);
      lastTick.current = performance.now();
      if (current && !startedSent.current) {
        startedSent.current = true;
        void postJson("/api/events", { event: "playback_started", eventId: uid(), sessionId: sessionId.current, trackId: current.id, listenedSeconds: 0 });
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      lastTick.current = null;
      if (current) {
        flushListening(current.id, "paused");
        savePosition(current.id, a.currentTime);
      }
    };
    const onTime = () => {
      setCurrentTime(a.currentTime);
      if (!a.paused && lastTick.current != null) {
        const now = performance.now();
        const delta = (now - lastTick.current) / 1000;
        lastTick.current = now;
        if (delta > 0 && delta < 2) listened.current += delta; // only real play time
        if (listened.current >= HEARTBEAT_SECONDS && current) flushListening(current.id, "heartbeat");
      }
      if (current && Math.abs(a.currentTime - lastSaved.current) > 10) {
        lastSaved.current = a.currentTime;
        savePosition(current.id, a.currentTime);
      }
    };
    const onMeta = () => {
      setDuration(a.duration || current?.durationSeconds || 0);
      if (pendingSeek.current != null) {
        a.currentTime = Math.min(pendingSeek.current, a.duration || pendingSeek.current);
        pendingSeek.current = null;
      }
      setIsLoading(false);
    };
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const onEnded = () => {
      if (current) flushListening(current.id, "ended");
      if (repeat === "one") {
        a.currentTime = 0;
        void a.play();
        return;
      }
      wantPlay.current = true;
      advance(1, true);
    };
    const onError = () => {
      // Expired signed URL or dropped connection: refresh the URL once and resume at the same spot.
      if (!current) return;
      if (refreshTries.current < 2) {
        refreshTries.current += 1;
        const at = a.currentTime || currentTime;
        void loadSource(current, at);
      } else {
        setError("network");
        setIsPlaying(false);
        setIsLoading(false);
      }
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
    };
  }, [current, repeat, advance, flushListening, savePosition, loadSource, currentTime]);

  // Skip a deleted/unavailable track automatically when the listener wanted playback.
  useEffect(() => {
    if (error === "track_gone" && queue.length > 1 && wantPlay.current) advance(1, true);
  }, [error, queue.length, advance]);

  // Lock-screen / headset controls where the browser supports Media Session.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: "Vibii",
      artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: "512x512", type: "image/svg+xml" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => api.play());
    navigator.mediaSession.setActionHandler("pause", () => api.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => api.next());
    navigator.mediaSession.setActionHandler("previoustrack", () => api.prev());
  }, [current, api]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <audio ref={audioRef} preload="metadata" data-testid="vibii-audio" />
    </Ctx.Provider>
  );
}

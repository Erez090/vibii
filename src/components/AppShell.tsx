"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Globe, MusicNote, Plus, User } from "./Icons";
import { useT } from "./LangProvider";
import { usePlayer } from "./player/PlayerProvider";
import { MiniPlayer } from "./player/MiniPlayer";

const TABS = [
  { href: "/", key: "tabDj", id: "dj", Icon: MusicNote },
  { href: "/my-vibes", key: "tabVibes", id: "vibes", Icon: Globe },
  { href: "/create", key: "tabCreate", id: "create", Icon: Plus },
] as const;

export function AppShell({ children, isDemo }: { children: React.ReactNode; isDemo: boolean }) {
  const path = usePathname();
  const { t } = useT();
  const { current } = usePlayer();
  const active = TABS.find((x) => (x.href === "/" ? path === "/" : path.startsWith(x.href)))?.id ?? null;

  useEffect(() => {
    if (active) void fetch("/api/player/position", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tab: active }) }).catch(() => {});
  }, [active]);

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Ambient: the current cover, blurred, behind everything. Updates on track change. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        {current?.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={current.coverUrl} src={current.coverUrl} alt="" className="fade-in h-full w-full scale-125 object-cover opacity-70 blur-[60px] saturate-150" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#120d1f]/55 via-[#120d1f]/45 to-[#0d1222]/85" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]">
        <header className="relative flex items-center justify-center py-3">
          <Link href="/" className="logo-text text-[52px] font-medium leading-none tracking-tight" aria-label="Vibii home">
            Vibii
          </Link>
          <Link href="/profile" aria-label={t("profile")} className="absolute end-0 top-1/2 -translate-y-1/2 rounded-full p-2 text-peach hover:bg-white/5">
            <User width={30} height={30} />
          </Link>
        </header>
        <div className="h-px w-full bg-line" />

        <nav aria-label="Vibii" className="mt-4 grid grid-cols-3 gap-2">
          {TABS.map(({ href, key, id, Icon }) => {
            const on = active === id;
            return (
              <Link
                key={id}
                href={href}
                aria-current={on ? "page" : undefined}
                className={`flex h-[52px] min-w-0 items-center justify-center gap-1 rounded-xl border px-1 text-[14px] whitespace-nowrap transition-colors min-[400px]:gap-1.5 min-[400px]:text-[15px] ${
                  on ? "border-peach bg-peach font-medium text-peach-ink" : "border-line bg-white/[0.03] text-text hover:bg-white/[0.07]"
                }`}
              >
                <Icon width={20} height={20} className={on ? "text-peach-ink" : id === "dj" ? "text-lavender" : "text-text"} />
                <span>{t(key)}</span>
              </Link>
            );
          })}
        </nav>

        {isDemo && (
          <p className="mt-2 text-center text-[11px] text-muted">Local demo account · isolated to this machine · not a cloud account</p>
        )}

        <main className="flex flex-1 flex-col pt-4">{children}</main>
        {active !== "dj" && <MiniPlayer />}
      </div>
    </div>
  );
}

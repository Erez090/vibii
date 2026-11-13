import Link from "next/link";
import { cookies } from "next/headers";
import { getUser } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { genreLabel, reasonFor, recommend } from "@/lib/catalog";
import { t, type Lang } from "@/lib/i18n";
import { VibesList, type VibeCard } from "@/components/vibes/VibesList";

export default async function MyVibes({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getUser();
  const lang: Lang = (await cookies()).get("vibii_lang")?.value === "he" ? "he" : "en";
  const page = Math.max(0, Math.min(20, Number((await searchParams).page) || 0));
  const answers = user
    ? await tx(async (db) => (await db.query(
        "select category, value from onboarding_answers where owner_id = $1 and category in ('genres','moments','song_language') and not skipped",
        [user.id],
      )).rows)
    : [];
  const get = (cat: string, key: string) => (answers.find((a) => a.category === cat)?.value[key] as string[] | undefined) ?? [];
  const { items, hasMore } = recommend(
    { genres: get("genres", "genres"), moments: get("moments", "moments"), languages: get("song_language", "languages") },
    { page, seed: user?.id ?? "guest" },
  );
  const cards: VibeCard[] = items.map((r) => ({
    itunesId: r.item.itunesId,
    title: r.item.title,
    artist: r.item.artist,
    artwork: r.item.artwork,
    reason: reasonFor(r, lang),
    tags: r.item.genres.map((g) => genreLabel(g, lang)),
    links: { apple: r.item.links.apple, spotify: r.item.links.spotify, youtube: r.item.links.youtube },
  }));

  return (
    <section>
      <h1 className="text-xl font-semibold">{lang === "he" ? "10 שירים בשבילך" : "10 songs for you"}</h1>
      <p className="mb-4 mt-1 text-sm text-muted">{t(lang, "vibesIntro")}</p>
      <VibesList items={cards} lang={lang} />
      <div className="mt-5 flex justify-center gap-3 pb-4">
        {page > 0 && (
          <Link href={page === 1 ? "/my-vibes" : `/my-vibes?page=${page - 1}`} className="rounded-xl border border-line px-4 py-2 text-sm">
            {lang === "he" ? "הקודמים" : "Previous"}
          </Link>
        )}
        {hasMore && (
          <Link href={`/my-vibes?page=${page + 1}`} className="rounded-xl bg-peach px-4 py-2 text-sm font-medium text-peach-ink" data-testid="more-vibes">
            {lang === "he" ? "עוד 10 שירים" : "10 more songs"}
          </Link>
        )}
      </div>
      <p className="pb-6 text-center text-[11px] text-muted">
        {lang === "he"
          ? "תצוגות מקדימות של 15 שניות באדיבות Apple Music. השירים המלאים נפתחים ב־Spotify, YouTube או Apple Music."
          : "15-second previews courtesy of Apple Music. Full songs open in Spotify, YouTube or Apple Music."}
      </p>
    </section>
  );
}

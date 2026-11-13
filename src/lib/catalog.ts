// My vibes: real, existing songs recommended to the listener — 10 at a time, each with a 15-second
// official preview (Apple's public iTunes preview clip) and links to the full song in Spotify, YouTube
// and Apple Music. The data is built and verified by scripts/build-catalog.ts (iTunes Search API +
// YouTube oEmbed); nothing here is guessed at runtime.
import data from "./catalog-data.json";

export type Energy = "low" | "mid" | "high";
export interface CatalogItem {
  id: string;
  itunesId: number;
  store: string;
  title: string;
  artist: string;
  genres: string[];
  moments: string[];
  energy: Energy;
  lang: string;
  artwork: string | null;
  links: { apple: string; spotify: string; youtube: string; youtubeVerified: boolean };
}

export const CATALOG = data as CatalogItem[];
export const PAGE_SIZE = 10;
export const PREVIEW_SECONDS = 15;

export interface TasteTags {
  genres: string[];
  moments: string[];
  languages: string[];
}

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (s: string) => {
    let x = h;
    for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
    return (x >>> 0) / 4294967295;
  };
}

export function score(item: CatalogItem, tags: TasteTags) {
  const g = item.genres.filter((x) => tags.genres.includes(x)).length;
  const m = item.moments.filter((x) => tags.moments.includes(x)).length;
  const langs = tags.languages.filter((l) => l !== "mixed");
  const l = langs.length === 0 ? 0 : langs.includes(item.lang) ? 1 : item.lang === "instrumental" ? 0 : -1;
  return g * 3 + m * 1.5 + l * 2.5;
}

export interface Recommendation {
  item: CatalogItem;
  matched: { genres: string[]; moments: string[]; language: boolean };
}

/** Personal ranking, one song per artist per page, stable per listener (seed) with gentle variety. */
export function recommend(tags: TasteTags, opts: { page?: number; seed?: string; limit?: number } = {}): { items: Recommendation[]; hasMore: boolean } {
  const limit = opts.limit ?? PAGE_SIZE;
  const page = Math.max(0, opts.page ?? 0);
  const jitter = seeded(opts.seed ?? "vibii");
  const ranked = [...CATALOG]
    .map((item) => ({ item, s: score(item, tags) + jitter(item.id) * 1.2 }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
  // Spread artists: walk the ranking in rounds so each page has at most one song per artist.
  const pages: CatalogItem[][] = [];
  const pool = [...ranked];
  while (pool.length) {
    const pageItems: CatalogItem[] = [];
    const artists = new Set<string>();
    for (let i = 0; i < pool.length && pageItems.length < limit; ) {
      const key = pool[i].artist.toLowerCase();
      if (artists.has(key)) {
        i++;
        continue;
      }
      artists.add(key);
      pageItems.push(pool.splice(i, 1)[0]);
    }
    if (!pageItems.length) break;
    pages.push(pageItems);
  }
  const items = (pages[page] ?? []).map((item) => ({
    item,
    matched: {
      genres: item.genres.filter((x) => tags.genres.includes(x)),
      moments: item.moments.filter((x) => tags.moments.includes(x)),
      language: tags.languages.includes(item.lang),
    },
  }));
  return { items, hasMore: page + 1 < pages.length };
}

export function findItem(itunesId: number) {
  return CATALOG.find((c) => c.itunesId === itunesId) ?? null;
}

const GENRE_LABEL: Record<string, { en: string; he: string }> = {
  pop: { en: "Pop", he: "פופ" }, rnb: { en: "R&B", he: "R&B" }, hiphop: { en: "Hip hop", he: "היפ הופ" },
  electronic: { en: "Electronic", he: "אלקטרוני" }, rock: { en: "Rock", he: "רוק" }, indie: { en: "Indie", he: "אינדי" },
  jazz: { en: "Jazz", he: "ג׳אז" }, classical: { en: "Classical", he: "קלאסי" }, latin: { en: "Latin", he: "לטיני" },
  mizrahi: { en: "Mizrahi", he: "מזרחית" }, folk: { en: "Folk", he: "פולק" }, lofi: { en: "Lo-fi", he: "לו־פיי" },
};
const MOMENT_LABEL: Record<string, { en: string; he: string }> = {
  drive: { en: "driving", he: "נהיגה" }, work: { en: "focus time", he: "זמן ריכוז" }, workout: { en: "workouts", he: "אימונים" },
  walking: { en: "walks", he: "הליכות" }, home: { en: "time at home", he: "זמן בבית" }, winding_down: { en: "winding down", he: "סוף היום" },
};

export function genreLabel(g: string, lang: "en" | "he") {
  return GENRE_LABEL[g]?.[lang] ?? g;
}

/** A short, honest "why this song" line built from the tags that actually matched. */
export function reasonFor(r: Recommendation, lang: "en" | "he") {
  const g = r.matched.genres.map((x) => genreLabel(x, lang));
  const m = r.matched.moments.map((x) => MOMENT_LABEL[x]?.[lang] ?? x);
  if (lang === "he") {
    if (g.length && m.length) return `כי את/ה אוהב/ת ${g.join(" ו")} — ומושלם ל${m[0]}.`;
    if (g.length) return `כי את/ה אוהב/ת ${g.join(" ו")}.`;
    if (m.length) return `מושלם ל${m[0]}.`;
    return "משהו חדש שכדאי לגלות.";
  }
  if (g.length && m.length) return `Because you like ${g.join(" & ")} — great for ${m[0]}.`;
  if (g.length) return `Because you like ${g.join(" & ")}.`;
  if (m.length) return `Great for ${m[0]}.`;
  return "Something new worth discovering.";
}

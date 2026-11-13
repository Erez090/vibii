// Builds src/lib/catalog-data.json for "My vibes" from scripts/catalog-seed.json.
// For every seed song it looks up the real track on Apple's public iTunes Search API (track id, 30-second
// official preview, artwork, Apple Music link), finds the official YouTube video and verifies it through
// YouTube's public oEmbed endpoint (title must match), and builds a Spotify search link (Spotify has no
// keyless lookup; its search page lands on the track). Songs that can't be matched are dropped, never guessed.
// Usage: npx tsx scripts/build-catalog.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// [title, artist, genres, moments, energy, lang] — or ["*", artist, …, count] to take that artist's top tracks
// (used for Hebrew/Arabic catalogs, where store titles are in the original script).
type Seed = [string, string, string[], string[], "low" | "mid" | "high", string, number?];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9֐-׿؀-ۿ]+/g, " ").trim();
const BAD = /karaoke|instrumental version|cover|tribute|remix|live|sped up|slowed|8d|made famous|in the style/i;

interface ItunesTrack {
  trackId: number; artistId?: number; trackName: string; artistName: string; collectionName: string; previewUrl?: string;
  artworkUrl100?: string; trackViewUrl: string; kind: string; trackTimeMillis?: number;
}

async function itunes(term: string, country: string): Promise<ItunesTrack[]> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=25&country=${country}`, { headers: { "user-agent": UA } });
    if (res.ok) return ((await res.json()) as { results: ItunesTrack[] }).results.filter((r) => r.kind === "song");
    await sleep(3000 * (i + 1));
  }
  return [];
}

function pick(results: ItunesTrack[], title: string, artist: string) {
  const t = norm(title);
  const a = norm(artist).split(" ")[0];
  const scored = results
    .filter((r) => r.previewUrl && !BAD.test(r.trackName) && !BAD.test(r.collectionName))
    .map((r) => {
      const rt = norm(r.trackName);
      const ra = norm(r.artistName);
      let s = 0;
      if (rt === t) s += 10;
      else if (rt.startsWith(t)) s += 6;
      else if (rt.includes(t)) s += 3;
      if (ra.includes(a)) s += 5;
      return { r, s };
    })
    .filter((x) => x.s >= 11)
    .sort((x, y) => y.s - x.s);
  return scored[0]?.r ?? null;
}

async function youtube(title: string, artist: string) {
  const q = `${artist} ${title} official`;
  const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
  }).then((r) => r.text()).catch(() => "");
  const ids = [...new Set([...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]))].slice(0, 4);
  for (const id of ids) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    const o = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { title?: string } | null;
    if (!o?.title) continue;
    const ot = norm(o.title);
    if (ot.includes(norm(title)) && !BAD.test(o.title)) return { url, title: o.title };
  }
  return null;
}

async function main() {
  const seeds = JSON.parse(readFileSync(path.join(__dirname, "catalog-seed.json"), "utf8")) as Seed[];
  const out: unknown[] = [];
  const dropped: string[] = [];
  const seen = new Set<number>();
  const add = async (r: ItunesTrack, title: string, genres: string[], moments: string[], energy: string, lang: string, country: string) => {
    if (seen.has(r.trackId)) return false;
    seen.add(r.trackId);
    const yt = await youtube(title, r.artistName);
    const q = encodeURIComponent(`${title} ${r.artistName}`);
    out.push({
      id: `it${r.trackId}`, itunesId: r.trackId, store: country, title, artist: r.artistName, genres, moments, energy, lang,
      artwork: r.artworkUrl100?.replace("100x100bb", "400x400bb") ?? null,
      links: {
        apple: r.trackViewUrl.replace(/[?&]uo=\d+/, ""),
        spotify: `https://open.spotify.com/search/${q}`,
        youtube: yt?.url ?? `https://www.youtube.com/results?search_query=${q}`,
        youtubeVerified: Boolean(yt),
      },
      verifiedAt: new Date().toISOString().slice(0, 10),
    });
    console.log(`✓ ${r.artistName} — ${title}${yt ? "  [yt ✓]" : "  [yt search]"}`);
    await sleep(1500);
    return true;
  };
  for (const [title, artist, genres, moments, energy, lang, count] of seeds) {
    const country = lang === "he" ? "IL" : "US";
    if (title === "*") {
      const a = norm(artist);
      const raw = await itunes(artist, country);
      // Store artist names may be in another script than the query (עומר אדם → "Omer Adam"): match by name or by the top hit's artist id.
      const primary = raw.find((r) => norm(r.artistName).includes(a))?.artistId ?? raw[0]?.artistId;
      const results = raw.filter((r) => r.previewUrl && (norm(r.artistName).includes(a) || (primary && r.artistId === primary)) && !BAD.test(r.trackName) && !BAD.test(r.collectionName));
      const names = new Set<string>();
      let n = 0;
      for (const r of results) {
        const name = r.trackName.replace(/\s*[\(\[].*?[\)\]]\s*/g, " ").trim();
        if (names.has(norm(name))) continue;
        names.add(norm(name));
        if (await add(r, name, genres, moments, energy, lang, country)) n++;
        if (n >= (count ?? 2)) break;
      }
      if (!n) dropped.push(`${artist} (no tracks)`);
      continue;
    }
    let r = pick(await itunes(`${title} ${artist}`, country), title, artist);
    if (!r && country !== "US") r = pick(await itunes(`${title} ${artist}`, "US"), title, artist);
    if (!r) {
      dropped.push(`${artist} — ${title} (no iTunes match)`);
      continue;
    }
    await add(r, title, genres, moments, energy, lang, country);
  }
  writeFileSync(path.join(__dirname, "..", "src/lib/catalog-data.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`\n${out.length} songs written, ${dropped.length} dropped`);
  for (const d of dropped) console.log("  ✗", d);
}
main();

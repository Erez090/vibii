// Verifies My vibes destinations via the services' public oEmbed endpoints (no scraping, no auth).
// A link counts as verified only if the returned title mentions the expected song title.
// Usage: npx tsx scripts/validate-links.ts  → writes src/lib/catalog-verified.json
import { writeFileSync } from "node:fs";
import { CATALOG } from "../src/lib/catalog";

const OEMBED: Record<string, (u: string) => string> = {
  Spotify: (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`,
  YouTube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
};

async function main() {
  const out: Record<string, { verifiedAt: string; title: string }> = {};
  for (const item of CATALOG) {
    for (const link of item.links) {
      try {
        const res = await fetch(OEMBED[link.service](link.url), { signal: AbortSignal.timeout(8000) });
        const body = res.ok ? await res.json() : null;
        const title: string = body?.title ?? "";
        const ok = title.toLowerCase().includes(item.title.toLowerCase());
        console.log(`${ok ? "✔" : "✘"} ${item.title} · ${link.service} · ${res.status} · "${title}"`);
        if (ok) out[link.url] = { verifiedAt: new Date().toISOString().slice(0, 10), title };
      } catch (e) {
        console.log(`✘ ${item.title} · ${link.service} · ${(e as Error).message}`);
      }
    }
  }
  writeFileSync("src/lib/catalog-verified.json", JSON.stringify(out, null, 2) + "\n");
}
main();

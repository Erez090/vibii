import { findItem } from "@/lib/catalog";
import { requireUser } from "@/lib/server/auth";
import { handle, json, rateLimit } from "@/lib/server/http";

// Returns a fresh URL for a catalog song's official 30-second preview clip (Apple iTunes Search API).
// Only songs in the verified catalog can be looked up; the player stops after 15 seconds.
const cache = new Map<number, { url: string; at: number }>();
const TTL = 6 * 60 * 60 * 1000;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    await rateLimit(`preview:${user.id}`, 120, 3600);
    const id = Number((await ctx.params).id);
    const item = Number.isSafeInteger(id) ? findItem(id) : null;
    if (!item) return json({ error: "not_found" }, 404);
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL) return json({ url: hit.url });
    const res = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${item.store}&entity=song`, { signal: AbortSignal.timeout(8000) });
    const body = res.ok ? ((await res.json()) as { results?: { previewUrl?: string }[] }) : null;
    const url = body?.results?.find((r) => r.previewUrl)?.previewUrl ?? "";
    if (!/^https:\/\/[a-z0-9.-]+\.(apple|itunes)\.com\//.test(url) && !/^https:\/\/audio-ssl\.itunes\.apple\.com\//.test(url)) {
      return json({ error: "preview_unavailable" }, 404);
    }
    cache.set(id, { url, at: Date.now() });
    return json({ url });
  });
}

import { describe, expect, it } from "vitest";
import { CATALOG, recommend, reasonFor } from "../../src/lib/catalog";

describe("My vibes catalog", () => {
  it("every song has a preview id, artwork and all three service links", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(60);
    for (const c of CATALOG) {
      expect(Number.isSafeInteger(c.itunesId)).toBe(true);
      expect(c.links.spotify).toMatch(/^https:\/\/open\.spotify\.com\//);
      expect(c.links.youtube).toMatch(/^https:\/\/www\.youtube\.com\//);
      expect(c.links.apple).toMatch(/^https:\/\/music\.apple\.com\//);
    }
    expect(new Set(CATALOG.map((c) => c.itunesId)).size).toBe(CATALOG.length);
  });

  it("recommends exactly 10, one song per artist, matching taste first", () => {
    const { items, hasMore } = recommend({ genres: ["rock"], moments: ["drive"], languages: ["en"] }, { seed: "u1" });
    expect(items).toHaveLength(10);
    expect(hasMore).toBe(true);
    expect(new Set(items.map((r) => r.item.artist.toLowerCase())).size).toBe(10);
    expect(items.slice(0, 5).every((r) => r.item.genres.includes("rock"))).toBe(true);
    expect(reasonFor(items[0], "en")).toMatch(/Rock/);
  });

  it("language preference pulls in songs in that language", () => {
    const es = recommend({ genres: ["latin"], moments: [], languages: ["es"] }, { seed: "u2" });
    expect(es.items.filter((r) => r.item.lang === "es").length).toBeGreaterThanOrEqual(5);
  });

  it("pages don't repeat songs and are stable per listener", () => {
    const tags = { genres: ["pop"], moments: ["workout"], languages: ["en"] };
    const p0 = recommend(tags, { seed: "u3" }).items.map((r) => r.item.id);
    const p1 = recommend(tags, { seed: "u3", page: 1 }).items.map((r) => r.item.id);
    expect(p0.filter((id) => p1.includes(id))).toHaveLength(0);
    expect(recommend(tags, { seed: "u3" }).items.map((r) => r.item.id)).toEqual(p0);
  });
});

// My vibes: a small curated catalog of existing songs, recommended — not played — by Vibii.
// Destinations are shown only if scripts/validate-links.ts confirmed them through the service's
// public oEmbed endpoint (title match). Unverified destinations are omitted, never guessed.
import verified from "./catalog-verified.json";

export interface CatalogItem {
  id: string;
  title: string;
  artist: string;
  genres: string[];
  energy: "low" | "mid" | "high";
  moments: string[];
  reason: { en: string; he: string };
  art?: { src: string; conceptLabel: true };
  links: { service: "Spotify" | "YouTube"; url: string }[];
}

export const CATALOG: CatalogItem[] = [
  {
    id: "blinding-lights", title: "Blinding Lights", artist: "The Weeknd", genres: ["pop", "electronic"], energy: "high", moments: ["drive", "workout"],
    reason: { en: "Synth-driven night-drive energy for your drive moments.", he: "אנרגיית סינת׳ של נסיעת לילה — לרגעי הנהיגה שלך." },
    art: { src: "/concept/blinding-lights-concept.jpg", conceptLabel: true },
    links: [
      { service: "Spotify", url: "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b" },
      { service: "YouTube", url: "https://www.youtube.com/watch?v=4NRXx6U8ABQ" },
    ],
  },
  {
    id: "midnight-city", title: "Midnight City", artist: "M83", genres: ["electronic", "indie"], energy: "high", moments: ["drive", "walking"],
    reason: { en: "Big, glowing synths for city lights and open roads.", he: "סינתים גדולים וזוהרים לאורות העיר ולכביש פתוח." },
    links: [{ service: "YouTube", url: "https://www.youtube.com/watch?v=dX3k_QDnzHE" }],
  },
  {
    id: "weightless", title: "Weightless", artist: "Marconi Union", genres: ["electronic", "lofi"], energy: "low", moments: ["winding_down", "work"],
    reason: { en: "Slow ambient textures for winding down or deep focus.", he: "מרקמים אמביינטיים איטיים לסוף היום או לריכוז עמוק." },
    links: [{ service: "YouTube", url: "https://www.youtube.com/watch?v=UfcAVejslrU" }],
  },
  {
    id: "take-five", title: "Take Five", artist: "The Dave Brubeck Quartet", genres: ["jazz"], energy: "mid", moments: ["home", "work"],
    reason: { en: "A relaxed classic groove for an easy hour at home.", he: "גרוב קלאסי ורגוע לשעה נינוחה בבית." },
    links: [{ service: "YouTube", url: "https://www.youtube.com/watch?v=vmDDOFXSgAs" }],
  },
  {
    id: "get-lucky", title: "Get Lucky", artist: "Daft Punk", genres: ["electronic", "pop"], energy: "mid", moments: ["home", "walking", "workout"],
    reason: { en: "Feel-good funk to lift an ordinary afternoon.", he: "פאנק משמח שמרים צהריים רגילים." },
    links: [{ service: "YouTube", url: "https://www.youtube.com/watch?v=5NV6Rdv1a3I" }],
  },
  {
    id: "clair-de-lune", title: "Clair de Lune", artist: "Claude Debussy", genres: ["classical"], energy: "low", moments: ["winding_down", "work"],
    reason: { en: "Gentle piano for quiet evenings and focused work.", he: "פסנתר עדין לערבים שקטים ולעבודה מרוכזת." },
    links: [{ service: "YouTube", url: "https://www.youtube.com/watch?v=CvFH_6DNRCY" }],
  },
];

const VERIFIED = verified as Record<string, { verifiedAt: string; title: string }>;

export function verifiedLinks(item: CatalogItem) {
  return item.links.filter((l) => VERIFIED[l.url]);
}

export function recommend(tags: { genres: string[]; moments: string[] }, limit = 5) {
  const score = (i: CatalogItem) =>
    i.genres.filter((g) => tags.genres.includes(g)).length * 2 + i.moments.filter((m) => tags.moments.includes(m)).length;
  return [...CATALOG].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

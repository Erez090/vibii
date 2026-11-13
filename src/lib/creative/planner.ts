// Deterministic internal album planner. Private: its output is never sent to consumer screens
// before the reveal. It chooses one real detail per personal slot and never invents memories.
import {
  type Answers,
  type ConsentChoice,
  hasBabyOrToddler,
  hasPartner,
  petStatus,
} from "../onboarding";

export type Energy = "low" | "low_mid" | "mid" | "mid_high" | "high";
export type Role = "personal_opener" | "movement" | "connection" | "focus" | "closer";

export interface FactRef {
  id: string; // `${category}.${field}` — source fact ID stored with the brief
  category: string;
  field: string;
  value: string;
  scope: "lyric" | "theme_only";
}

export interface SlotPlan {
  slot: number;
  role: Role;
  theme: string;     // internal theme key, e.g. "pet_joy", "night_drive"
  motif: string;     // visual motif key for the cover
  moment: string;
  energy: Energy;
  genre: string;
  language: string;
  instrumental: boolean;
  facts: FactRef[];
}

export interface AlbumPlan {
  version: 1;
  profileVersion: number;
  tasteOnly: boolean;
  slots: SlotPlan[];
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);

function usable(a: Answers, cat: keyof Answers, field: string): string {
  const r = a[cat];
  if (!r || r.skipped) return "";
  return s(r.value[field]);
}

/** A fact is lyric-usable only when consented and not flagged private; otherwise it can shape theme only. */
function fact(a: Answers, consent: ConsentChoice, cat: keyof Answers, field: string): FactRef | null {
  const value = usable(a, cat, field);
  if (!value) return null;
  const r = a[cat]!;
  const scope = consent.personalDetails && !r.isPrivate ? "lyric" : "theme_only";
  return { id: `${String(cat)}.${field}`, category: String(cat), field, value, scope };
}

const MOVEMENT_ORDER = ["drive", "workout", "walking"];
const ENERGY: Energy[] = ["mid_high", "high", "mid", "low_mid", "low"];

export function planAlbum(a: Answers, consent: ConsentChoice, profileVersion: number): AlbumPlan {
  const personal = consent.personalDetails;
  const genres = arr(a.genres?.value.genres);
  const surprise = Boolean(a.genres?.value.surprise) || genres.length === 0;
  const palette = genres.length ? genres : ["pop", "electronic", "indie"];
  const moments = arr(a.moments?.value.moments);
  const langs = arr(a.song_language?.value.languages).filter((l) => l !== "instrumental");
  const prefersInstrumental =
    arr(a.song_language?.value.languages).includes("instrumental") || Boolean(a.genres?.value.instrumental);
  const language = langs[0] ?? "en";
  const hobbies = arr(a.hobby?.value.hobbies);
  const hobbyText = usable(a, "hobby", "text");
  const used = new Set<string>();
  const slots: SlotPlan[] = [];

  const genreFor = (i: number) => (surprise && i >= genres.length ? ["pop", "electronic", "indie", "rnb", "lofi"][i % 5] : palette[i % palette.length]);
  const push = (p: Omit<SlotPlan, "slot" | "genre" | "language" | "energy"> & Partial<SlotPlan>) => {
    const i = slots.length;
    slots.push({
      slot: i + 1,
      genre: p.genre ?? genreFor(i),
      language: p.instrumental ? "instrumental" : p.language ?? language,
      energy: p.energy ?? ENERGY[i],
      ...p,
    } as SlotPlan);
  };

  const petFacts = () => {
    const f = [fact(a, consent, "pet", "name"), fact(a, consent, "pet", "species")].filter(Boolean) as FactRef[];
    const joy = fact(a, consent, "fu_pet_joy", "text") ?? fact(a, consent, "fu_past_pet_moment", "text");
    return joy ? [...f, joy] : f;
  };
  const petTheme = () => (petStatus(a) === "past" ? "pet_memory" : "pet_joy");
  const petMotif = () => {
    const sp = usable(a, "pet", "species");
    return sp === "cat" ? "cat_window" : sp === "bird" ? "bird_sky" : sp === "fish" ? "fish_bubbles" : "paws_park";
  };
  const hobbyMotif = (h: string) =>
    ({ cooking: "steam_bowl", sports: "pulse_sun", reading: "paper_stars", gaming: "pixel_grid", travel: "paper_plane",
      art: "paint_swirl", gardening: "leaves", music: "notes_wave", outdoors: "mountain_sun", friends: "circles_light" } as Record<string, string>)[h] ?? "notes_wave";

  // (1) Personal opener: baby/child phrase, otherwise pet, otherwise hobby, otherwise taste signature.
  const babyWord = personal && hasBabyOrToddler(a) ? fact(a, consent, "fu_baby_word", "text") : null;
  const petOk = personal && petStatus(a) !== null;
  const petGood = petOk && petFacts().some((f) => f.field !== "species");
  if (babyWord) {
    push({ role: "personal_opener", theme: "family_hook", motif: "lion_sunrise", moment: "home", instrumental: false, facts: [babyWord] });
    used.add("baby");
  } else if (petOk) {
    push({ role: "personal_opener", theme: petTheme(), motif: petMotif(), moment: "home", instrumental: false, facts: petFacts() });
    used.add("pet");
  } else if (hobbies.length || hobbyText) {
    const f = fact(a, consent, "hobby", "text");
    push({ role: "personal_opener", theme: `hobby_${hobbies[0] ?? "free"}`, motif: hobbyMotif(hobbies[0] ?? ""), moment: "home",
      instrumental: false, facts: f ? [f] : [{ id: "hobby.hobbies", category: "hobby", field: "hobbies", value: hobbies[0], scope: "theme_only" }] });
    used.add("hobby");
  } else {
    push({ role: "personal_opener", theme: "taste_signature", motif: "notes_wave", moment: "home", instrumental: false, facts: [] });
  }

  // (2) Movement moment.
  const move = MOVEMENT_ORDER.find((m) => moments.includes(m)) ?? moments[0] ?? "drive";
  push({ role: "movement", theme: move === "drive" ? "night_drive" : `move_${move}`, motif: move === "drive" ? "highway_trails" : "pulse_sun",
    moment: move, instrumental: false, facts: [] });

  // (3) Connection: partner if shared, else unused pet (favoured over a used baby slot), else hobby, else home.
  const partnerFacts = [fact(a, consent, "relationship", "nickname"), fact(a, consent, "fu_partner_phrase", "text")].filter(Boolean) as FactRef[];
  if (personal && hasPartner(a) && partnerFacts.length) {
    push({ role: "connection", theme: "partner", motif: "circles_light", moment: "home", instrumental: false, facts: partnerFacts });
  } else if (petOk && petGood && !used.has("pet")) {
    push({ role: "connection", theme: petTheme(), motif: petMotif(), moment: "home", instrumental: false, facts: petFacts() });
    used.add("pet");
  } else if ((hobbies.length || hobbyText) && !used.has("hobby")) {
    const f = fact(a, consent, "hobby", "text");
    push({ role: "connection", theme: `hobby_${hobbies[0] ?? "free"}`, motif: hobbyMotif(hobbies[0] ?? ""), moment: "home",
      instrumental: false, facts: f ? [f] : [] });
    used.add("hobby");
  } else {
    push({ role: "connection", theme: "home_warmth", motif: "window_glow", moment: moments.includes("home") ? "home" : "walking",
      instrumental: false, facts: [] });
  }

  // (4) Work / focus — instrumental by default.
  const field = usable(a, "work", "field");
  push({ role: "focus", theme: field ? `focus_${field}` : "focus", motif: "lamp_grid", moment: moments.includes("work") ? "work" : "home",
    instrumental: true, facts: field ? [{ id: "work.field", category: "work", field: "field", value: field, scope: "theme_only" }] : [] });

  // (5) Upcoming event, otherwise a contrasting evening closer.
  const ev = usable(a, "upcoming_event", "kind");
  if (ev && ev !== "none") {
    const evText = fact(a, consent, "upcoming_event", "text");
    push({ role: "closer", theme: `event_${ev}`, motif: ev === "trip" ? "paper_plane" : ev === "birthday" ? "lanterns" : "confetti_dawn",
      moment: "home", instrumental: false, energy: "mid_high",
      facts: [{ id: "upcoming_event.kind", category: "upcoming_event", field: "kind", value: ev, scope: "theme_only" }, ...(evText ? [evText] : [])] });
  } else {
    push({ role: "closer", theme: "evening", motif: "moon_water", moment: "winding_down", instrumental: prefersInstrumental, energy: "low", facts: [] });
  }

  return { version: 1, profileVersion, tasteOnly: !personal, slots };
}

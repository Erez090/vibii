// Onboarding v0.3 — shared between client screens and the server. Pure data + pure functions.

export const CORE_CATEGORIES = [
  "display_name",
  "country",
  "age_band",
  "genres",
  "song_language",
  "moments",
  "relationship",
  "children",
  "pet",
  "hobby",
  "work",
  "upcoming_event",
] as const;
export type CoreCategory = (typeof CORE_CATEGORIES)[number];

export const FOLLOWUPS = ["fu_baby_word", "fu_pet_joy", "fu_past_pet_moment", "fu_partner_phrase"] as const;
export type Followup = (typeof FOLLOWUPS)[number];
export type Category = CoreCategory | Followup;

/** Categories that only make sense with consent to use personal/household details. */
export const PERSONAL_CATEGORIES: Category[] = ["relationship", "children", "pet", ...FOLLOWUPS];

/** Exactly 12 interview screens: follow-up questions are switched off (the 12 core questions only). */
export const MAX_FOLLOWUPS = 0;
/** Songs in the first personal album. */
export const ALBUM_SIZE = 7;
export const WELCOME_CREDITS = 40;
export const CREDITS_PER_CATEGORY = 5;
export const CREDITS_PER_SONG = 100;

export const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "prefer_not"] as const;
export const GENRES = [
  "pop", "rnb", "hiphop", "electronic", "rock", "indie", "jazz", "classical", "latin", "mizrahi", "folk", "lofi",
] as const;
export const SONG_LANGUAGES = ["en", "he", "es", "fr", "ar", "mixed", "instrumental"] as const;
export const MOMENTS = ["drive", "work", "workout", "walking", "home", "winding_down"] as const;
export const RELATIONSHIP = ["single", "partnered", "married", "other"] as const;
export const CHILD_AGE = ["baby", "toddler", "older"] as const;
export const PET_STATUS = ["now", "past", "no"] as const;
export const PET_SPECIES = ["dog", "cat", "bird", "fish", "rabbit", "other"] as const;
export const HOBBIES = ["cooking", "sports", "reading", "gaming", "travel", "art", "gardening", "music", "outdoors", "friends"] as const;
export const WORK_FIELDS = [
  "tech", "health", "education", "creative", "trades", "business", "service", "studying", "caregiving", "other",
] as const;
export const EVENTS = ["trip", "birthday", "celebration", "new_beginning", "none"] as const;
export const FOLLOWUP_CHIPS = ["food", "color", "activity"] as const;

export type Answers = Partial<Record<Category, AnswerRecord>>;
export interface AnswerRecord {
  value: Record<string, unknown>;
  skipped: boolean;
  isPrivate: boolean;
}

export interface ConsentChoice {
  personalDetails: boolean;
  providerProcessing: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function hasBabyOrToddler(a: Answers) {
  const c = a.children;
  if (!c || c.skipped) return false;
  const band = str(c.value.youngest);
  return band === "baby" || band === "toddler";
}
export function petStatus(a: Answers): "now" | "past" | null {
  const p = a.pet;
  if (!p || p.skipped) return null;
  const s = str(p.value.status);
  return s === "now" || s === "past" ? s : null;
}
export function hasPartner(a: Answers) {
  const r = a.relationship;
  if (!r || r.skipped) return false;
  const s = str(r.value.status);
  return s === "partnered" || s === "married";
}

/** Up to two follow-ups chosen from household context, in a stable priority order. */
export function applicableFollowups(a: Answers, consent: ConsentChoice | null): Followup[] {
  if (!consent?.personalDetails) return [];
  const out: Followup[] = [];
  if (hasBabyOrToddler(a)) out.push("fu_baby_word");
  const ps = petStatus(a);
  if (ps === "now") out.push("fu_pet_joy");
  if (ps === "past") out.push("fu_past_pet_moment");
  if (hasPartner(a)) out.push("fu_partner_phrase");
  return out.slice(0, MAX_FOLLOWUPS);
}

/** Full ordered screen sequence for the current answers. */
export function screenSequence(a: Answers, consent: ConsentChoice | null): Category[] {
  const core = CORE_CATEGORIES.filter((c) => consent?.personalDetails || !PERSONAL_CATEGORIES.includes(c));
  return [...core, ...applicableFollowups(a, consent)];
}

/** Categories that are auto-skipped on the taste-only path (count as Skip for awards). */
export function autoSkipped(consent: ConsentChoice | null): CoreCategory[] {
  if (consent?.personalDetails) return [];
  return CORE_CATEGORIES.filter((c) => PERSONAL_CATEGORIES.includes(c));
}

export function isComplete(a: Answers, consent: ConsentChoice | null) {
  if (!consent) return false;
  return screenSequence(a, consent).every((c) => a[c]) && CORE_CATEGORIES.every((c) => a[c]);
}

/** Answers for follow-ups whose branch no longer applies must be removed (stale facts). */
export function staleFollowups(a: Answers, consent: ConsentChoice | null): Followup[] {
  const keep = new Set(applicableFollowups(a, consent));
  return FOLLOWUPS.filter((f) => a[f] && !keep.has(f));
}

/** Limits and shape checks for a saved answer. Freeform text is stored as data only. */
export function sanitizeAnswer(category: Category, value: Record<string, unknown>): Record<string, unknown> {
  const text = (v: unknown, max = 120) => str(v).slice(0, max);
  const pick = <T extends readonly string[]>(v: unknown, allowed: T) =>
    (allowed as readonly string[]).includes(str(v)) ? str(v) : "";
  const many = <T extends readonly string[]>(v: unknown, allowed: T, max: number) =>
    Array.isArray(v) ? [...new Set(v.map(str).filter((x) => (allowed as readonly string[]).includes(x)))].slice(0, max) : [];
  switch (category) {
    case "display_name":
      return { text: text(value.text, 40) };
    case "country":
      return { country: text(value.country, 60) };
    case "age_band":
      return { band: pick(value.band, AGE_BANDS) };
    case "genres":
      return {
        genres: many(value.genres, GENRES, 3),
        surprise: Boolean(value.surprise),
        instrumental: Boolean(value.instrumental),
      };
    case "song_language":
      return { languages: many(value.languages, SONG_LANGUAGES, 3) };
    case "moments":
      return { moments: many(value.moments, MOMENTS, 3) };
    case "relationship":
      return { status: pick(value.status, RELATIONSHIP), nickname: text(value.nickname, 30) };
    case "children": {
      const count = Math.max(0, Math.min(12, Number(value.count) || 0));
      return { count, names: count ? text(value.names, 80) : "", youngest: count ? pick(value.youngest, CHILD_AGE) : "" };
    }
    case "pet": {
      const status = pick(value.status, PET_STATUS);
      const has = status === "now" || status === "past";
      return { status, name: has ? text(value.name, 30) : "", species: has ? pick(value.species, PET_SPECIES) : "" };
    }
    case "hobby":
      return { hobbies: many(value.hobbies, HOBBIES, 3), text: text(value.text, 80) };
    case "work":
      return { field: pick(value.field, WORK_FIELDS), role: text(value.role, 60) };
    case "upcoming_event":
      return { kind: pick(value.kind, EVENTS), text: text(value.text, 100) };
    default:
      return { text: text(value.text, 120), chips: many(value.chips, FOLLOWUP_CHIPS, 3) };
  }
}

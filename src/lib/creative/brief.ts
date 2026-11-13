// Deterministic brief builder. Without a configured LLM this produces a clearly labelled structured
// template brief (generator: "template_v1"). Freeform user text is treated as data: it is quoted
// into lyric lines only when consented and not private, never interpreted as instructions.
import type { SlotPlan, FactRef, Energy } from "./planner";

export interface Brief {
  generator: "template_v1" | "llm";
  generatorNote: string;
  title: string;
  style: string;
  lyrics: string;
  language: string;
  energy: Energy;
  moment: string;
  instrumental: boolean;
  excluded: string[];
  sourceFacts: { id: string; scope: FactRef["scope"] }[];
  art: ArtBrief;
}

export interface ArtBrief {
  scene: string;
  motif: string;
  palette: string[];
  alt: string;
}

const BPM: Record<Energy, string> = { low: "68-78", low_mid: "80-92", mid: "96-108", mid_high: "110-122", high: "124-132" };
const GENRE_STYLE: Record<string, string> = {
  pop: "bright modern pop, punchy drums, catchy hook",
  rnb: "smooth R&B, warm keys, laid-back groove",
  hiphop: "boom-bap hip hop, deep bass, crisp snares",
  electronic: "synthwave electronic, analog pads, driving bass",
  rock: "indie rock, jangly guitars, live drums",
  indie: "dreamy indie pop, reverb guitars, soft vocals",
  jazz: "modern jazz trio, brushed drums, upright bass",
  classical: "cinematic strings, piano, gentle swell",
  latin: "latin pop, congas, nylon guitar",
  mizrahi: "mediterranean pop, oud and darbuka, modern beat",
  folk: "acoustic folk, fingerpicked guitar, warm harmonies",
  lofi: "lo-fi chillhop, vinyl crackle, mellow keys",
};

export const MOTIF_SCENES: Record<string, { scene: string; palette: string[] }> = {
  lion_sunrise: { scene: "a soft illustrated lion calling into a sunrise", palette: ["#f6a96b", "#ffd59a", "#7a3f6e", "#2b1840"] },
  paws_park: { scene: "playful paw prints across a sunlit park", palette: ["#9fd8a4", "#f7d27a", "#3d6b57", "#1c2b3a"] },
  cat_window: { scene: "a curled cat silhouette on a moonlit windowsill", palette: ["#c9b6ff", "#6b5bd6", "#f3c78a", "#1a1636"] },
  bird_sky: { scene: "a small bird gliding through layered clouds", palette: ["#9ad3ff", "#ffe1b3", "#4b6fa8", "#18233f"] },
  fish_bubbles: { scene: "a bright fish among rising bubbles", palette: ["#5fd3d0", "#ff9f7a", "#22577a", "#0e1a2b"] },
  highway_trails: { scene: "amber highway light trails at night", palette: ["#ff8a3d", "#ffcf6e", "#d0315c", "#140c24"] },
  pulse_sun: { scene: "pulse lines racing toward a rising sun", palette: ["#ff6f61", "#ffd166", "#3a86ff", "#101a33"] },
  circles_light: { scene: "two overlapping circles of warm light", palette: ["#ff9eb5", "#ffd6a5", "#9b5de5", "#1d1233"] },
  window_glow: { scene: "a glowing window in a quiet street", palette: ["#ffc46b", "#ff8f6b", "#4a3f7a", "#141026"] },
  lamp_grid: { scene: "a single glowing desk lamp over a calm geometric grid", palette: ["#8ecae6", "#ffb703", "#219ebc", "#0b1b2b"] },
  paper_plane: { scene: "a paper plane over a far horizon", palette: ["#a0e7e5", "#ffd3b6", "#5b8def", "#151b3b"] },
  lanterns: { scene: "floating paper lanterns rising into dusk", palette: ["#ffb347", "#ff6f91", "#845ec2", "#1b1033"] },
  confetti_dawn: { scene: "confetti drifting across a pastel dawn", palette: ["#ffd6e0", "#c1fba4", "#7bdff2", "#2a1e4a"] },
  moon_water: { scene: "a crescent moon over still water", palette: ["#d7c4ff", "#8fb8ff", "#3c2a6b", "#0c0a1f"] },
  steam_bowl: { scene: "steam swirls rising from a warm bowl", palette: ["#ffb4a2", "#ffe5d9", "#b56576", "#22162b"] },
  paper_stars: { scene: "pages unfolding into small stars", palette: ["#fde68a", "#c4b5fd", "#6d28d9", "#14112b"] },
  pixel_grid: { scene: "a neon pixel landscape", palette: ["#4cc9f0", "#f72585", "#7209b7", "#10002b"] },
  paint_swirl: { scene: "bold paint swirls meeting in the middle", palette: ["#ff595e", "#ffca3a", "#1982c4", "#1a1423"] },
  leaves: { scene: "layered leaves in morning light", palette: ["#95d5b2", "#ffe8a3", "#2d6a4f", "#0f2018"] },
  notes_wave: { scene: "musical notes riding a soft wave", palette: ["#f4a261", "#e9c46a", "#8d5bd6", "#1a1530"] },
  mountain_sun: { scene: "a mountain ridge under a big sun", palette: ["#f4978e", "#fbc4ab", "#5e548e", "#16132b"] },
};

const THEME_LINES: Record<string, [string, string]> = {
  family_hook: ["Tiny voices fill the hallway light", "and every echo sounds like home"],
  pet_joy: ["Four small feet are dancing at the door", "you make the ordinary bright"],
  pet_memory: ["A little moment that I still keep close", "it plays back soft like summer"],
  night_drive: ["City lights are melting into gold", "I keep the windows down and roll"],
  move_workout: ["Heartbeat louder than the doubt", "one more step and I break out"],
  move_walking: ["Footsteps keeping time with the street", "the morning hums beneath my feet"],
  partner: ["Just a phrase that only we would know", "it turns the quiet into glow"],
  home_warmth: ["Kettle singing, lamps are low", "this is where the good days go"],
  evening: ["Let the evening fold the day away", "slow down, let the moonlight stay"],
  taste_signature: ["Press play, the room begins to move", "every beat is made for you"],
  create_new: ["Here's a song for this very moment", "every line is meant for you"],
};

function titleFor(plan: SlotPlan): string {
  const t: Record<string, string> = {
    family_hook: "Little Echo", pet_joy: "Happy at the Door", pet_memory: "Small Bright Moment", night_drive: "Amber Lanes",
    move_workout: "One More Step", move_walking: "Street Tempo", partner: "Only Us", home_warmth: "Lamps Low",
    evening: "Still Water", taste_signature: "Press Play",
  };
  if (t[plan.theme]) return t[plan.theme];
  if (plan.theme.startsWith("focus")) return "Clear Desk";
  if (plan.theme.startsWith("event_trip")) return "Paper Planes";
  if (plan.theme.startsWith("event_birthday")) return "Lantern Night";
  if (plan.theme.startsWith("event_")) return "New Morning";
  if (plan.theme.startsWith("hobby_")) return "Free Hour";
  return "Your Sound";
}

function lyricFact(plan: SlotPlan): string {
  // Use the strongest single lyric-scoped detail. Names are optional; never force them in.
  const f = plan.facts.find((x) => x.scope === "lyric" && x.field === "text") ?? plan.facts.find((x) => x.scope === "lyric" && (x.field === "name" || x.field === "nickname"));
  return f ? f.value.replace(/[\r\n\[\]{}<>]/g, " ").slice(0, 60) : "";
}

export function buildBrief(plan: SlotPlan, titleOverride?: string): Brief {
  const scene = MOTIF_SCENES[plan.motif] ?? MOTIF_SCENES.notes_wave;
  const title = titleOverride || titleFor(plan);
  const genreStyle = GENRE_STYLE[plan.genre] ?? GENRE_STYLE.pop;
  const style = [genreStyle, `${plan.energy.replace("_", "-")} energy`, `${BPM[plan.energy]} bpm`,
    plan.instrumental ? "instrumental, no vocals" : `vocals in ${plan.language}`].join(", ");
  const [l1, l2] = THEME_LINES[plan.theme] ??
    (plan.theme.startsWith("focus") ? ["", ""] : plan.theme.startsWith("event_") ? ["Something good is waiting up ahead", "I can feel it in the air"] : ["Got an hour that is all my own", "doing what I love, I'm home"]);
  const detail = lyricFact(plan);
  const lyrics = plan.instrumental
    ? "[Instrumental]"
    : [
        "[Verse]", l1, l2,
        detail ? `"${detail}" — I hear it, smile and sing` : "Every little moment, let it ring",
        "[Chorus]", title, `${title}, play it again`, l2,
      ].join("\n");
  return {
    generator: "template_v1",
    generatorNote: "Structured template brief generated by Vibii rules (no AI model was used).",
    title,
    style,
    lyrics,
    language: plan.language,
    energy: plan.energy,
    moment: plan.moment,
    instrumental: plan.instrumental,
    excluded: [
      "real names unless listed as lyric-scoped facts",
      "private or flagged details",
      "invented memories or claims of lived events",
      "explicit content",
      "imitation of a named artist's voice",
    ],
    sourceFacts: plan.facts.map((f) => ({ id: f.id, scope: f.scope })),
    art: {
      scene: scene.scene,
      motif: plan.motif,
      palette: scene.palette,
      alt: `Illustrated cover: ${scene.scene}`,
    },
  };
}

/** Brief for an intentional "create new" request. */
export function buildCreateNewBrief(input: {
  forWhom: "me" | "gift"; topic: string; language: string; vibe: string; story: string; useStory: boolean;
}): Brief {
  const energy: Energy = input.vibe === "calm" ? "low_mid" : input.vibe === "party" ? "high" : input.vibe === "drive" ? "mid_high" : "mid";
  const genre = input.vibe === "party" ? "pop" : input.vibe === "calm" ? "lofi" : input.vibe === "drive" ? "electronic" : "indie";
  const motif = input.vibe === "calm" ? "moon_water" : input.vibe === "drive" ? "highway_trails" : input.vibe === "party" ? "confetti_dawn" : "circles_light";
  const plan: SlotPlan = {
    slot: 1, role: "connection", theme: "create_new", motif, moment: input.vibe, energy, genre,
    language: input.language, instrumental: input.language === "instrumental",
    facts: input.useStory && input.story ? [{ id: "request.story", category: "request", field: "text", value: input.story, scope: "lyric" }] : [],
  };
  const topic = input.topic.replace(/[\r\n\[\]{}<>]/g, " ").slice(0, 80).trim();
  const b = buildBrief(plan, topic ? topic.split(/\s+/).slice(0, 4).join(" ") : "New Song");
  return { ...b, lyrics: plan.instrumental ? "[Instrumental]" : `[Topic] ${topic}\n${b.lyrics}` };
}

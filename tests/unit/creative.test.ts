import { describe, expect, it } from "vitest";
import { planAlbum } from "../../src/lib/creative/planner";
import { buildBrief } from "../../src/lib/creative/brief";
import { renderCoverSvg } from "../../src/lib/creative/cover";
import { applicableFollowups, screenSequence, sanitizeAnswer } from "../../src/lib/onboarding";
import { cleanProps } from "../../src/lib/server/analytics";
import { isPrivateAddress } from "../../src/lib/server/safe-fetch";

const a = (v: Record<string, unknown>, extra: Partial<{ skipped: boolean; isPrivate: boolean }> = {}) => ({ value: v, skipped: false, isPrivate: false, ...extra });

describe("planner & briefs", () => {
  it("favours the pet in an unused slot when baby and pet both have good details", () => {
    const plan = planAlbum({
      children: a({ count: 1, youngest: "baby" }), fu_baby_word: a({ text: "bamba" }),
      pet: a({ status: "now", name: "Bell", species: "dog" }), fu_pet_joy: a({ text: "the beach" }),
      relationship: a({ status: "single" }), moments: a({ moments: ["drive"] }),
    }, { personalDetails: true, providerProcessing: true }, 1);
    expect(plan.slots.map((s) => s.theme)).toEqual(["family_hook", "night_drive", "pet_joy", "focus", "main_character", "first_light", "evening"]);
  });

  it("taste-only profiles still get seven distinct slots with no lyric facts", () => {
    const plan = planAlbum({ genres: a({ genres: ["jazz"] }), display_name: a({ text: "Dana" }) }, { personalDetails: false, providerProcessing: true }, 1);
    expect(plan.slots).toHaveLength(7);
    expect(new Set(plan.slots.map((s) => s.motif)).size).toBe(7);
    expect(new Set(plan.slots.map((s) => s.theme)).size).toBe(7);
    expect(plan.slots.flatMap((s) => s.facts).every((f) => f.scope === "theme_only")).toBe(true);
  });

  it("never assumes a former pet has died and labels template briefs honestly", () => {
    const plan = planAlbum({ pet: a({ status: "past", name: "Rex", species: "dog" }), fu_past_pet_moment: a({ text: "muddy paws" }) }, { personalDetails: true, providerProcessing: true }, 1);
    const b = buildBrief(plan.slots[0]);
    expect(b.lyrics.toLowerCase()).not.toMatch(/died|death|heaven|rest in peace|gone/);
    expect(b.generator).toBe("template_v1");
    expect(b.generatorNote).toMatch(/no AI model/);
  });

  it("art briefs are abstract (no names) and covers are distinct per seed", () => {
    const plan = planAlbum({ pet: a({ status: "now", name: "Bell", species: "dog" }) }, { personalDetails: true, providerProcessing: true }, 1);
    const b = buildBrief(plan.slots[0]);
    expect(JSON.stringify(b.art)).not.toContain("Bell");
    const s1 = renderCoverSvg({ motif: b.art.motif, palette: b.art.palette, seed: "a", alt: b.art.alt });
    const s2 = renderCoverSvg({ motif: b.art.motif, palette: b.art.palette, seed: "b", alt: b.art.alt });
    expect(s1).not.toBe(s2);
    expect(s1.startsWith("<svg")).toBe(true);
  });
});

describe("onboarding rules", () => {
  it("exactly the 12 core questions: no follow-ups, fewer without personal consent", () => {
    const ans = { children: a({ count: 1, youngest: "baby" }), pet: a({ status: "past" }), relationship: a({ status: "married" }) };
    expect(applicableFollowups(ans, { personalDetails: true, providerProcessing: true })).toEqual([]);
    expect(screenSequence(ans, { personalDetails: true, providerProcessing: true })).toHaveLength(12);
    expect(applicableFollowups(ans, { personalDetails: false, providerProcessing: true })).toEqual([]);
    expect(screenSequence(ans, { personalDetails: false, providerProcessing: true })).not.toContain("children");
  });
  it("sanitizes answers (limits, whitelists)", () => {
    expect(sanitizeAnswer("genres", { genres: ["pop", "pop", "x", "jazz", "rock", "indie"] }).genres).toEqual(["pop", "jazz", "rock"]);
    expect(sanitizeAnswer("pet", { status: "no", name: "Bell" }).name).toBe("");
    expect(String(sanitizeAnswer("display_name", { text: "x".repeat(200) }).text)).toHaveLength(40);
  });
});

describe("analytics & network safety", () => {
  it("drops story text and names from analytics props", () => {
    expect(cleanProps({ story: "my son Noa", name: "Bell", kind: "create_new", duration_ms: 5 })).toEqual({ kind: "create_new", duration_ms: 5 });
  });
  it("rejects internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "172.16.0.1", "::1", "fd00::1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
});

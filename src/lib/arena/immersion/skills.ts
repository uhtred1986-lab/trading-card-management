import type { NumberedBeat } from "../beats";
import type { Area } from "../types";

export type SkillStyle = "swap" | "union" | "evolve" | "awaken" | "play" | "drop" | "warp" | "skill";
export interface SkillMoment {
  key: string;
  card: string;
  title: string;
  detail: string;
  style: SkillStyle;
  from?: Area;
  to?: Area;
  flip?: true;
}
const areas: Record<Area, string> = { deck: "Deck", hand: "Hand", drop: "Drop", leader: "Leader", battle: "Battle Area", combo: "Combo", energy: "Energy", life: "Life", warp: "Warp", unison: "Unison", zDeck: "Z-Deck", zEnergy: "Z-Energy", removed: "Removed" };

/** Each picture describes exactly one masked engine beat. A skill name never invents its result. */
export function skillMoment(gameId: number, beat: NumberedBeat | null): SkillMoment | null {
  if (!beat) return null;
  const key = `${gameId}:${beat.n}`;
  if (beat.t === "move") return { key, card: beat.card, title: beat.to === "battle" ? "Enter Battle Area" : `Move to ${areas[beat.to]}`, detail: `${areas[beat.from]} → ${areas[beat.to]}`, style: beat.to === "warp" ? "warp" : beat.to === "drop" ? "drop" : beat.to === "battle" ? "play" : "skill", from: beat.from, to: beat.to };
  if (beat.t === "flip") return { key, card: beat.card, title: "Card flip", detail: "Same card · new face", style: "awaken", flip: true };
  if (beat.t !== "skill" || !beat.label.trim()) return null;
  // Only the engine's skill tag chooses a motif; printed effect text may mention unrelated skills.
  const label = beat.label.replace(/[\[\]]/g, "").trim();
  const style: SkillStyle = /^swap\b/i.test(label) ? "swap" : /^union[\s–—-]/i.test(label) ? "union" : /^(?:ex[\s-]|xeno[\s-])?evolve\b/i.test(label) ? "evolve" : /^(?:awaken|wish)\b/i.test(label) ? "awaken" : "skill";
  return { key, card: beat.card, title: label, detail: beat.noEffect ? "No visible effect" : "Skill resolution", style };
}

import type { CardView } from "../view";
import type { PlayerId } from "../types";
import type { BeatArt, NumberedBeat } from "../beats";
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
  face?: { name: string; imageUrl: string | null };
  side?: "You" | "Opponent";
}
const areas: Record<Area, string> = { deck: "Deck", hand: "Hand", drop: "Drop", leader: "Leader", battle: "Battle Area", combo: "Combo", energy: "Energy", life: "Life", warp: "Warp", unison: "Unison", zDeck: "Z-Deck", zEnergy: "Z-Energy", removed: "Removed" };

/** Each picture describes exactly one masked engine beat. A skill name never invents its result. */
export function skillMoment(gameId: number, beat: NumberedBeat | null, context?: { cardOf: (id: string) => CardView | null; art: Record<string, BeatArt>; viewer: PlayerId }): SkillMoment | null {
  if (!beat) return null;
  const key = `${gameId}:${beat.n}`;
  if (beat.t === "move" && !["battle", "drop", "warp"].includes(beat.to) && !["battle", "drop", "warp"].includes(beat.from)) return null;
  const id = "card" in beat ? beat.card : null;
  const current = id && context ? context.cardOf(id) : null;
  const captured = id && context ? context.art[id] : null;
  const agrees = !captured || (captured.cardId === current?.cardId && captured.name === current?.name);
  // Captures are already viewer-masked. A current hidden card or changed face still wins.
  const face = current && !current.hidden && agrees ? { name: current.name, imageUrl: current.imageUrl }
    : !current && captured && beat.t === "move" && ["battle", "drop", "warp"].includes(beat.to) ? { name: captured.name, imageUrl: captured.imageUrl } : undefined;
  const side = "owner" in beat && context ? beat.owner === context.viewer ? "You" as const : "Opponent" as const : undefined;
  const presentation = { face, side };
  if (beat.t === "move") return { ...presentation, key, card: beat.card, title: beat.to === "battle" ? "Enter Battle Area" : `Move to ${areas[beat.to]}`, detail: `${areas[beat.from]} → ${areas[beat.to]}`, style: beat.to === "warp" ? "warp" : beat.to === "drop" ? "drop" : beat.to === "battle" ? "play" : "skill", from: beat.from, to: beat.to };
  if (beat.t === "flip") return { ...presentation, key, card: beat.card, title: "Card flip", detail: "Same card · new face", style: "awaken", flip: true };
  if (beat.t !== "skill" || !beat.label.trim()) return null;
  // Only the engine's skill tag chooses a motif; printed effect text may mention unrelated skills.
  const label = beat.label.replace(/[\[\]]/g, "").trim();
  const style: SkillStyle = /^swap\b/i.test(label) ? "swap" : /^union[\s–—-]/i.test(label) ? "union" : /^(?:ex[\s-]|xeno[\s-])?evolve\b/i.test(label) ? "evolve" : /^(?:awaken|wish)\b/i.test(label) ? "awaken" : "skill";
  return { ...presentation, key, card: beat.card, title: label, detail: beat.noEffect ? "No visible effect" : "Skill resolution", style };
}

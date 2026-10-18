import type { CardView } from "@/lib/arena/view";
import { plainText } from "./shared-model";

export interface ReaderAbility { key: string; title: string; text: string; state: string; offered: boolean; copied: boolean; /** The first bracketed word ("Auto", "Activate:Main"), shown as the coloured chip. */ tag: string; /** Any further tags ("Once per turn"), shown beside the short name. */ extraTags: string[]; /** A bare keyword line ([Blocker], [Barrier]) rather than a written effect. */ keyword: boolean }
/** Preserve printed <character> selectors, while the existing formatter removes HTML markup. */
export function readerText(text: string): string {
  return plainText(text.replace(/<(?!\/?(?:br|span|b|strong|i|em|p|div)\b)[^>]+>/gi, tag => tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"))).trim();
}
export function readerAbilities(card: CardView): ReaderAbility[] {
  if (card.hidden) return [];
  if (card.abilities?.length) return card.abilities.map(line => ({
    key: `${line.origin}:${line.skillIndex}:${line.category}`,
    tag: line.tags[0] ?? line.kind, extraTags: line.tags.slice(1), keyword: line.category === "keyword",
    title: line.tags.join(" · ") || line.kind,
    text: readerText(line.text), copied: line.origin === "copied",
    offered: line.availability === "offered",
    state: line.origin === "copied" ? "Added ability" : line.pending ? "Pending" : line.availability === "offered" ? "Available now" : line.category === "manual" || line.category === "counter" ? line.availability === "refused" ? "Not available now" : "Read ability" : line.category === "automatic" ? "Automatic" : "Printed ability",
  }));
  return readerText(card.text ?? "").split(/\n+/).filter(Boolean).map((text, i) => {
    const tags = [...text.matchAll(/(?:^|(?<=\]))\s*\[([^\]]+)\]/g)].map(match => match[1]);
    return {key: `printed:${i}`, title: tags.join(" · ") || "Card text", tag: tags[0] ?? "Card text", extraTags: tags.slice(1), keyword: false, text, state: "Printed ability", offered: false, copied: false};
  });
}

// Reviewed against the bundled classic tutorial fronts (and both leader backs).
// This anchors the reading overlay to the rules block, not fabricated per-line OCR boxes.
const CLASSIC = new Set(["056","060","061","062","064","065","066","067","068","070","071","072","079","080","082","084","088","089","090","093","094","096","097","098","099","102","103","104","105","109"].map(n => `BT1-${n}`));
export function hasReviewedRulesArea(card: CardView): boolean {
  return !card.hidden && CLASSIC.has(card.cardId) && (!card.flipped || card.cardId === "BT1-056" || card.cardId === "BT1-084");
}

/** Reading shorthand only: exact rules remain available on expansion. */
export function abilityPreview(text: string): string {
  const short = text.replace(/^\s*\[(?:auto|permanent|activate:\s*(?:main|battle)|counter:\s*(?:attack|play)|blocker|double strike|evolve)\]\s*/i, "")
    .replace(/When this card attacks a Leader Card,/gi, "On attacking a Leader:")
    .replace(/When this card attacks,/gi, "On attack:")
    .replace(/When you play this card,?/gi, "On play:")
    .replace(/your opponent chooses (\d+) cards? from their hand and places (?:it|them) in the Drop Area/gi, "Opponent discards $1 from hand")
    .replace(/choose up to (\d+) of your energy and switch them to Active Mode/gi, "switch up to $1 of your energy to Active")
    .replace(/draw (\d+) cards? from your deck/gi, "draw $1")
    .replace(/draw (\d+) cards?/gi, "draw $1")
    .replace(/for the duration of the turn/gi, "this turn")
    .replace(/for the duration of the battle/gi, "this battle")
    .replace(/this card gains/gi, "Gain")
    .replace(/\s+/g, " ").trim();
  return short.length > 145 ? short.slice(0, 142).replace(/\s+\S*$/, "") + "…" : short || text;
}

/** The tag as a chip reads it: "Activate:Main" becomes "Activate · Main". */
export function chipLabel(tag: string): string {
  return tag.replace(/\s*:\s*/g, " · ");
}

/** Which colour family a chip wears. Anything the app has no colour for falls back to "other". */
export function chipKind(tag: string, keyword: boolean): "auto" | "permanent" | "activate" | "counter" | "keyword" | "other" {
  const t = tag.toLowerCase();
  if (t.startsWith("auto")) return "auto";
  if (t.startsWith("permanent")) return "permanent";
  if (t.startsWith("activate")) return "activate";
  if (t.startsWith("counter")) return "counter";
  return keyword || /^(blocker|barrier|dual attack|triple attack|double strike|evolve|reflect|piercing|critical)/.test(t) ? "keyword" : "other";
}

/**
 * The short name of a skill, the line a player reads instead of the card's tiny printed text.
 * It is `abilityPreview` (the app's existing wording shorthand) cut to one glanceable line, with
 * the first letter capital; a bare keyword with nothing after it is named by its own tag.
 */
export function skillShortName(line: Pick<ReaderAbility, "text" | "tag">): string {
  const body = abilityPreview(line.text).replace(/^(?:\s*\[[^\]]+\])+\s*/, "").trim();
  if (!body) return chipLabel(line.tag);
  const cut = body.length > 52 ? body.slice(0, 50).replace(/[\s,;:]+\S*$/, "") + "…" : body;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

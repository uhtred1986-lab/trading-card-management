import type { CardView } from "@/lib/arena/view";
import { plainText } from "./shared-model";

export interface ReaderAbility { key: string; title: string; text: string; state: string; offered: boolean; copied: boolean }
/** Preserve printed <character> selectors, while the existing formatter removes HTML markup. */
export function readerText(text: string): string {
  return plainText(text.replace(/<(?!\/?(?:br|span|b|strong|i|em|p|div)\b)[^>]+>/gi, tag => tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"))).trim();
}
export function readerAbilities(card: CardView): ReaderAbility[] {
  if (card.hidden) return [];
  if (card.abilities?.length) return card.abilities.map(line => ({
    key: `${line.origin}:${line.skillIndex}:${line.category}`,
    title: line.tags.join(" · ") || line.kind,
    text: readerText(line.text), copied: line.origin === "copied",
    offered: line.availability === "offered",
    state: line.origin === "copied" ? "Added ability" : line.pending ? "Pending" : line.availability === "offered" ? "Available now" : line.category === "manual" || line.category === "counter" ? line.availability === "refused" ? "Not available now" : "Read ability" : line.category === "automatic" ? "Automatic" : "Printed ability",
  }));
  return readerText(card.text ?? "").split(/\n+/).filter(Boolean).map((text, i) => ({key: `printed:${i}`, title: text.match(/^\[([^\]]+)\]/)?.[1] ?? "Card text", text, state: "Printed ability", offered: false, copied: false}));
}

// Reviewed against the bundled classic tutorial fronts (and both leader backs).
// This anchors the reading overlay to the rules block, not fabricated per-line OCR boxes.
const CLASSIC = new Set(["056","060","061","062","064","065","066","067","068","070","071","072","079","080","082","084","088","089","090","093","094","096","097","098","099","102","103","104","105","109"].map(n => `BT1-${n}`));
export function hasReviewedRulesArea(card: CardView): boolean {
  return !card.hidden && CLASSIC.has(card.cardId) && (!card.flipped || card.cardId === "BT1-056" || card.cardId === "BT1-084");
}

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
  // The catalog prints some tags in lower case ("[permanent]"); a chip reads them as names.
  return tag.replace(/\s*:\s*/g, " · ").replace(/(^|[\s·-])([a-z])/g, (_, gap: string, c: string) => gap + c.toUpperCase());
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

/**
 * Keywords that read as a badge rather than a written row (docs/design/arena-keyword-rendering, owner
 * 19 Oct 2026): their meaning never changes, so the card only needs to say which one and its values.
 * Keywords that introduce a card's own effect (Awaken, Heroic, ...) stay rows.
 */
const BADGE_KEYWORDS = [
  "blocker", "barrier", "double strike", "triple strike", "quadruple strike", "dual attack", "triple attack", "critical",
  "deflect", "revenge", "indestructible", "energy-exhaust", "unique", "servant", "victory strike", "field",
  "evolve", "ex-evolve", "xeno-evolve", "union-fusion", "union-potara", "union-absorb", "over realm", "dark over realm",
  "swap", "arrival", "revive", "alliance", "aegis", "z-stack", "empower", "spirit boost",
  "super combo", "ultimate", "dragon ball", "warrior of universe 7", "invoker", "wormhole",
];
const DECK_KEYWORDS = new Set(["super combo", "ultimate", "dragon ball"]);
const BADGE_RE = new RegExp(`^(${BADGE_KEYWORDS.map((k) => k.replace(/[-\s]/g, (c) => (c === "-" ? "[- ]?" : "\\s+"))).sort((a, b) => b.length - a.length).join("|")})\\b\\s*(.*)$`, "i");

/** One keyword as a badge: its name, the values the card prints with it, and its reminder text for a tooltip. */
export interface KeywordBadge {
  key: string;
  label: string;
  /** Energy cost tokens in printed order: a colour letter (r, u, g, y, b) or a generic number. */
  pips: string[];
  /** A number printed with the keyword ("Over Realm 7", "Swap 3"). */
  count: string | null;
  /** The card or character it names ("Grand Supreme Kai"). */
  target: string | null;
  reminder: string;
  /** A deck-building rule (Super Combo, Ultimate, Dragon Ball): shown last and quieter. */
  deck: boolean;
}

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bEx\b/, "EX");

/**
 * A reader line as a keyword badge, or null when it is a skill to write out. A line is a badge when its
 * first bracketed tag is a badge keyword and nothing after it is another skill (no second tag).
 */
export function keywordBadge(line: Pick<ReaderAbility, "key" | "tag" | "text">): KeywordBadge | null {
  const tag = line.tag.trim();
  const m = BADGE_RE.exec(tag);
  if (!m) return null;
  const body = line.text.replace(/^(?:\s*\[[^\]]+\])+\s*/, "");
  if (/\[(?:auto|permanent|activate|counter)/i.test(body)) return null;
  const reminder = [...body.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((r) => r[1].trim()).join(" ");
  const values = body.replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, " ");
  const pips = [...values.matchAll(/\{([a-z]|\d+)\}/gi)].map((p) => p[1].toLowerCase());
  const targets = [...values.matchAll(/<([^>]+)>/g)].map((t) => t[1].trim());
  const name = m[1].toLowerCase().replace(/\s+/g, " ");
  const rest = m[2].trim();
  const count = /^\d+$/.test(rest) ? rest : null;
  return {
    key: line.key,
    label: titleCase(name) + (rest && !count ? ` ${titleCase(rest)}` : ""),
    pips,
    count,
    target: targets.length ? targets.join(" or ") : null,
    reminder,
    deck: DECK_KEYWORDS.has(name),
  };
}

/** A skill's printed text without the bracketed tags it opens with (they are on its chip and pills). */
export function skillBody(text: string): string {
  return text.replace(/^(?:\s*\[[^\]]+\])+\s*/, "").trim() || text;
}

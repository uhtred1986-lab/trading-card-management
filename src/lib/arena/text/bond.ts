/**
 * The specified-card selector a [Bond X] line prints before its colon, read
 * from text alone. It lives beside the text parsers so both the compiler (the
 * typed payment record, `compileCostRecord`) and the VM (`vm/bond.ts`) read the
 * same thing: a descriptor the compiler calls readable is exactly one the VM
 * can count.
 */
import { parseFilter, type CardFilter } from "./filters";
import type { Skill } from "../types";

export type BondSelector = { kind: "any" } | { kind: "filter"; filter: CardFilter } | { kind: "unknown" };

/** A condition word opening the text after the tag: that text is the price's condition (9-1-3), not a Bond descriptor. */
const CUED = /^(?:if|when|while|during)\b/i;
const BRACKET = String.raw`(?:≪[^≫]+≫|<[^>]+>|\{[^}]+\})`;
/** One alternative of a compound descriptor: an optional colour, one bracketed name, "card(s)". */
const PART = String.raw`(?:(?:red|blue|green|yellow|black|white)\s+)?${BRACKET}(?:\s+cards?)?`;
/** "Red ≪Saiyan≫ cards and/or ≪Bardock's Crew≫ cards" (BT13-006): two or more alternatives. */
const COMPOUND = new RegExp(String.raw`^${PART}(?:\s*,?\s+(?:and\/or|or)\s+${PART})+$`, "i");
const SINGLE = new RegExp(String.raw`^${BRACKET}$`);
const ORBS = /\{(?:[rugykbw]|\d+)\}(?:\/\{[rugykbw]\})?/gi;
const NAME_KEYS = ["traits", "characters", "names"] as const;

/** Explanatory notes in parentheses are not rules text (1-5-8). */
function withoutNotes(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Where the line prints its descriptor: before the colon, in `cost`. A bare
 * keyword line has no colon — "[Blocker][Bond 3] Red ≪Saiyan≫ cards and/or
 * ≪Bardock's Crew≫ cards." (BT13-006) — so its descriptor is what the parse
 * left in `effect`.
 */
function descriptorSource(skill: Skill): string {
  return skill.kind === "keyword" && !skill.cost.trim() ? skill.effect : skill.cost;
}

/**
 * The text before the colon with orbs (the Skill carries their parsed energy
 * price separately) and reminder notes removed. `{g}` and `{2}` are energy
 * prices, not card names: only tokens the orb parsers recognize come off.
 */
function bondText(skill: Skill): string {
  return withoutNotes(descriptorSource(skill))
    .replace(ORBS, "")
    .replace(/^[\s,]+/, "")
    .replace(/[\s,.]+$/, "")
    .trim();
}

/** No measure is set on the filter beyond the keys named. */
function onlyKeys(filter: object, allowed: ReadonlySet<string>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (allowed.has(key)) continue;
    if (Array.isArray(value) ? value.length > 0 : value != null && value !== false) return false;
  }
  return true;
}

/** Only names of one kind, at most one colour, and nothing else: a description the Bond count can prove. */
function namesOnly(filter: CardFilter): boolean {
  if (filter.unreadable || filter.characterOrTrait) return false;
  const named = NAME_KEYS.filter((key) => filter[key].length > 0);
  return named.length === 1 && filter.colors.length <= 1 && onlyKeys(filter, new Set<string>([...NAME_KEYS, "colors"]));
}

/** The compound's parsed filter: either alternatives (`anyOf`), each names-only, or one names-only filter whose names are the alternatives. */
function compoundFilter(text: string): CardFilter | null {
  const filter = parseFilter(text);
  if (filter.unreadable) return null;
  const parts = text.split(/\s*,?\s+(?:and\/or|or)\s+/i).length;
  if (filter.anyOf?.length) {
    const { anyOf, ...rest } = filter;
    if (!onlyKeys(rest, new Set<string>())) return null;
    if (anyOf.length !== parts || !anyOf.every((alt) => namesOnly(alt))) return null;
    return filter;
  }
  if (!namesOnly(filter)) return null;
  const named = NAME_KEYS.find((key) => filter[key].length > 0)!;
  // "≪A≫ cards or ≪B≫ cards" folds into one list (either name); a colour
  // printed on one alternative only must not have spread to the other.
  if (filter[named].length !== parts || filter.colors.length) return null;
  return filter;
}

/**
 * A Bond line's text before the colon may name the Battle Cards it counts.
 * Admitted here: one fully bracketed selector ("≪Universe 6≫", #549), or a
 * compound of bracketed names, each with an optional colour, joined by "or"
 * or "and/or" (BT13-006). The existing text filter parser reads its meaning;
 * the exact grammar check proves there is no additional text. A line whose
 * text opens with a condition word ("If your Leader Card is a ≪Slug's Army≫
 * card", BT12-060; "{g}, if your Leader is green and …", BT27-139) names no
 * Battle Card: the count is the plain one, and the condition is the price's
 * (`priceCondition`), read separately.
 */
export function bondSelector(skill: Skill): BondSelector | null {
  if (skill.bond == null) return null;
  const text = bondText(skill);
  if (!text || CUED.test(text)) return { kind: "any" };
  if (SINGLE.test(text)) {
    const filter = parseFilter(text);
    if (!namesOnly(filter) || filter.colors.length) return { kind: "unknown" };
    const named = NAME_KEYS.find((key) => filter[key].length > 0)!;
    return filter[named].length === 1 ? { kind: "filter", filter } : { kind: "unknown" };
  }
  if (COMPOUND.test(text)) {
    const filter = compoundFilter(text);
    return filter ? { kind: "filter", filter } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

/**
 * True when everything the line prints before its colon (or, on a bare keyword
 * line, after its tags) is the Bond's own descriptor and orbs: no condition and
 * no action is left for the price readers. The compiler calls such a price a
 * readable payment of its orbs alone, and a bare keyword line's descriptor no
 * effect text.
 */
export function bondDescriptorOnly(skill: Skill): boolean {
  const selector = bondSelector(skill);
  return selector?.kind === "filter" || (selector?.kind === "any" && !bondText(skill));
}

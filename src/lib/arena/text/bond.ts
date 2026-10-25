/**
 * The specified-card selector a [Bond X] line prints before its colon, read
 * from text alone. It lives beside the text parsers so both the compiler (the
 * typed payment record, `compileCostRecord`) and the VM (`vm/bond.ts`) read the
 * same thing: a descriptor the compiler calls readable is exactly one the VM
 * can count.
 */
import { parseFilter, type CardFilter } from "./filters";
import { eitherOrbsIn, orbsIn } from "./cards";
import type { Skill } from "../types";

export type BondSelector = { kind: "any" } | { kind: "filter"; filter: CardFilter } | { kind: "unknown" };

/**
 * A Bond line's text before the colon may name the Battle Cards it counts.
 * Only a single, fully bracketed selector is admitted here: the existing text
 * filter parser reads its meaning, and the exact wrapper check proves there is
 * no additional condition text after it. Recognized orb tokens are removed
 * first; the Skill carries their parsed energy price separately.
 */
export function bondSelector(skill: Skill): BondSelector | null {
  if (skill.bond == null) return null;
  const raw = skill.cost.trim();
  // `{g}` and `{2}` are energy prices, not card names. The parser has already
  // put them in energyCost/energyEither; remove only tokens those same parsers
  // recognize before reading a possible specified-card selector.
  const hasOrbs = Object.values(orbsIn(raw)).some((count) => (count ?? 0) > 0) || eitherOrbsIn(raw).length > 0;
  const text = raw
    .replace(/\{(?:[rugykbw]|\d+)\}(?:\/\{[rugykbw]\})?/gi, "")
    .trim();
  if (!text && hasOrbs) return { kind: "any" };
  if (!text) return { kind: "any" };
  if (!/^(?:≪[^≫]+≫|<[^>]+>|\{[^}]+\})$/.test(text)) return { kind: "unknown" };

  const filter = parseFilter(text);
  if (filter.unreadable) return { kind: "unknown" };
  const names = [filter.traits, filter.characters, filter.names].filter((items) => items.length === 1);
  if (names.length !== 1 || names[0]?.length !== 1) return { kind: "unknown" };
  const allowed = new Set(["traits", "characters", "names"]);
  for (const [key, value] of Object.entries(filter)) {
    if (allowed.has(key)) continue;
    if (Array.isArray(value) ? value.length > 0 : value != null && value !== false) return { kind: "unknown" };
  }
  return { kind: "filter", filter };
}

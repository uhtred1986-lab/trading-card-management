/** RM 22-43-3-1: the descriptor qualifies the Unison paying markers. */
import type { Skill } from "../types";
import { stripNotes } from "../compile/clauses";
import { parseFilter, type CardFilter } from "./filters";
export type SpiritBoostDescriptor = {
    kind: "none";
} | {
    kind: "unknown";
} | {
    kind: "filter";
    filter: CardFilter;
    rest: string;
};
/** Input is the normalized cost text, with reminder notes and leading orbs removed. */
export function spiritBoostDescriptor(text: string): SpiritBoostDescriptor {
    if (!/^(?:(?:red|blue|green|yellow|black|white)\s+)?(?:z-)?unison(?: cards?)?\b/i.test(text))
        return { kind: "none" };
    const comma = text.indexOf(","), descriptor = (comma < 0 ? text : text.slice(0, comma)).trim();
    if (!/^(?:(?:red|blue|green|yellow|black|white)\s+)?(?:Z-)?Unison(?: Cards?)?(?: with (?:a specified cost(?: of \d+ or more)?|\d+ power or more))?$/i.test(descriptor))
        return { kind: "unknown" };
    // A specified cost means at least one specified orb, not an invented total cost.
    const normalized = descriptor.replace(/with a specified cost$/i, "with a specified cost of 1 or more");
    const filter = parseFilter(normalized);
    return filter.unreadable ? { kind: "unknown" } : { kind: "filter", filter, rest: comma < 0 ? "" : text.slice(comma + 1).trim() };
}
/** Rebuild guards read printed text, never trust an obsolete cost's display text. */
export function printedSpiritBoostDescriptor(skill: Skill): SpiritBoostDescriptor {
    if (skill.spiritBoost == null && !skill.tags.some(tag => /^spirit boost x$/i.test(tag)))
        return { kind: "none" };
    return spiritBoostDescriptor(stripNotes(skill.cost).replace(/^(?:\{[^}]*\}|\s|,|\/)+/, "").trim());
}

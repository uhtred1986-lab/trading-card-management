/**
 * [Union-Fusion] / [Union-Potara] materials, read per character (#925).
 *
 * A Union line prints "[Union-…] cost: <Character Name A> and <Character Name B>"
 * (22-13-4-1, 22-13-5-1), and a few print qualifiers beside each name:
 * "Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000
 * power" (BT22-136), "Green <Vegeta> Z-Battle Card and green <Son Goku> card"
 * (BT23-084), "Blue <Kale> and yellow <Caulifla> with energy costs of 4 or
 * more" (BT7-121), "<Son Goku> card and <Vegeta> card, both black" (BT22-121).
 *
 * Reading the whole description as one filter (`asPrinted`) lost which
 * qualifier belonged to which name: a blue Goku and a yellow Vegeta satisfied
 * BT22-136 because both colours and both names were "on the list", and the
 * "Z-Battle Card" of BT23-084's Vegeta was demanded of Goku too. This reads
 * the description once, splits it at the name boundaries, and gives each name
 * the filter of its own words.
 *
 * Reading (labelled best guess, owner's ruling guidance of 18 Oct 2026; the
 * manual 22-13-4-1/22-13-5-1 and the card FAQ say nothing more than "the
 * specified character's Battle Card"):
 *  - the words around a name up to the joining "and"/comma qualify that name
 *    ("yellow <Son Goku> card with 5000 power" ends at the "and" before
 *    "blue <Vegeta>");
 *  - words after the last name that begin with "both" qualify every name
 *    (", both black"), as in the same-release P-519/SD23-07 wording;
 *  - the name itself is matched exactly (and case-insensitively) by the
 *    caller, so the segment's `characters` are dropped from the filter.
 */
import { printedDescription } from "./cards";
import { emptyFilter, parseFilter, type CardFilter } from "./filters";
import type { Skill } from "../types";

export interface UnionNeed {
  /** The character name printed in ‹…›. */
  name: string;
  /** The words that qualify this name, as read (for logs and the glossary). */
  text: string;
  /** Colour, type, cost, power … of this name alone; `characters` is cleared, the name is matched by the caller. */
  filter: CardFilter;
}

const NAME = /<([^<>]+)>/g;
const JOIN = /\s*,?\s*\band\b\s*|\s*,\s*/gi;

/** The per-character requirements a [Union-Fusion]/[Union-Potara] description prints, in printed order. */
export function unionNeeds(sk: Pick<Skill, "effect" | "cost">): UnionNeed[] {
  return unionNeedsOf(printedDescription(sk));
}

export function unionNeedsOf(description: string): UnionNeed[] {
  const names = [...description.matchAll(NAME)];
  if (!names.length) return [];
  // ", both black" after the last name qualifies every name.
  const tailStart = names[names.length - 1].index! + names[names.length - 1][0].length;
  const tail = description.slice(tailStart);
  const both = /^(.*?)[\s,]*\bboth\s+(.+?)\s*[.]?\s*$/i.exec(tail);
  const shared = both ? both[2].trim() : "";
  const lastTrailing = both ? both[1].trim() : tail.replace(/[.\s]+$/, "").trim();

  // Between two names, the last "and"/comma ends the first name's words and
  // starts the second's ("… with 5000 power and blue <Vegeta> …").
  const leading: string[] = [description.slice(0, names[0].index!).trim()];
  const trailing: string[] = [];
  for (let i = 0; i + 1 < names.length; i++) {
    const between = description.slice(names[i].index! + names[i][0].length, names[i + 1].index!);
    const joins = [...between.matchAll(JOIN)];
    const cut = joins[joins.length - 1];
    if (cut) {
      trailing.push(between.slice(0, cut.index!).trim());
      leading.push(between.slice(cut.index! + cut[0].length).trim());
    } else {
      trailing.push(between.trim());
      leading.push("");
    }
  }
  trailing.push(lastTrailing);

  return names.map((m, i) => {
    const text = [leading[i], m[0], trailing[i], shared].filter(Boolean).join(" ");
    const filter: CardFilter = { ...emptyFilter(), ...parseFilter(text), characters: [] };
    return { name: m[1], text, filter };
  });
}

/**
 * The hand-entered **specified cost** — the coloured half of a play's price —
 * and the checks it can have (issue #255).
 *
 * The deckplanet feed carries no cost orbs at all (checked card by card on
 * 12 Sep 2026; `npm run arena:specified` re-checks it every run), so the
 * orbs an X-cost card demands come from a person: the `cards.specified_cost`
 * column, written from the rules record on the workbench or seeded by a
 * migration on an owner's ruling, in the language's own orb notation —
 * `{u}{u}` is two blue, `{r}{u}` one red and one blue — never a bare count,
 * because relaxing blue and relaxing yellow are different changes. Null means
 * **unknown**, and unknown is a gap the engine says rather than fills:
 * `specifiedCostOf` charges no colour for it and `specifiedCostUnknown` is
 * what the record, the probe and the report ask so they can say so.
 *
 * The owner chose the column over a table in code (13 Sep 2026) so the value
 * is reachable from the UI. The hazard that choice carries is named on the
 * column itself: `sync:catalog` upserts every card column, so the upsert
 * `coalesce`s this one like `image_url` — otherwise the next sync erases the
 * entry. What errata's self-check cannot do here — re-verify the entry
 * against the payload, since the payload says nothing — `staleSpecifiedCosts`
 * does in the one way left to it: an entry on a card that no longer prints an
 * X cost, or no longer prints a specified-cost clause, has outlived what it
 * was entered for and is reported rather than silently kept.
 *
 * Pure; no database, no engine state. `orbsIn` is the same reader the
 * compiler uses on skill text, so the column and the card speak one notation.
 */
import { orbsIn } from "./engine/cards";
import type { Color } from "./engine/types";

export type SpecifiedCost = Partial<Record<Color, number>>;

const LETTER_OF: Partial<Record<Color, string>> = { Red: "r", Blue: "u", Green: "g", Yellow: "y", Black: "k", White: "w" };
const ORDER: Color[] = ["Red", "Blue", "Green", "Yellow", "Black", "White"];

/** What the engine's reducer looks for: "reduce the specified cost of … by {u}". */
export const SPECIFIED_CLAUSE = /specified\s+costs?/i;

/**
 * `{u}{u}` → `{ Blue: 2 }`; null for an empty box, for text that is not orb
 * notation, and for orbs that name no colour (`{2}` says a total, which the
 * cost circle already does). Whitespace between orbs is tolerated; anything
 * else is refused, so a typo becomes "not entered" rather than a wrong price.
 */
export function parseSpecifiedCost(text: string | null | undefined): SpecifiedCost | null {
  if (text == null) return null;
  const compact = text.replace(/\s+/g, "");
  if (!compact) return null;
  if (!/^(\{[rugykbw]\})+$/i.test(compact)) return null;
  const orbs = orbsIn(compact);
  delete orbs.any;
  return Object.keys(orbs).length ? orbs : null;
}

/** `{ Blue: 2 }` → `{u}{u}`, in a fixed colour order so two entries compare as strings. */
export function printSpecifiedCost(cost: SpecifiedCost): string {
  return ORDER.flatMap((c) => Array.from({ length: cost[c] ?? 0 }, () => `{${LETTER_OF[c]}}`)).join("");
}

/** `{ Blue: 2 }` → "2 blue"; `{ Red: 1, Blue: 1 }` → "1 red, 1 blue". */
export function specifiedCostWords(cost: SpecifiedCost): string {
  const parts = ORDER.filter((c) => (cost[c] ?? 0) > 0).map((c) => `${cost[c]} ${c.toLowerCase()}`);
  return parts.length ? parts.join(", ") : "no colour";
}

/** The columns the self-check reads — a catalog row, or anything shaped like one. */
export interface SpecifiedCostRow {
  id: string;
  energyCost: string | null;
  skill: string | null;
  specifiedCost: string | null;
}

/**
 * Entries that have outlived what they were entered for, as one line each:
 * the card no longer prints an X cost (a fixed cost's orbs are filled by
 * convention and the entry now overrides it unseen), no longer prints a
 * specified-cost clause (nothing on the card reads the baseline any more), or
 * the entry itself does not parse (it was never a baseline). Run at catalog
 * sync — the one moment the card's text is fresh — and by `arena:specified`.
 * A row with no entry is never reported; unknown is not stale, it is unknown.
 */
export function staleSpecifiedCosts(rows: SpecifiedCostRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.specifiedCost == null || r.specifiedCost.trim() === "") continue;
    if (!parseSpecifiedCost(r.specifiedCost)) {
      out.push(`${r.id}: specified_cost "${r.specifiedCost}" is not orb notation ({u}{u}) and is ignored`);
      continue;
    }
    if (!/^x$/i.test((r.energyCost ?? "").trim())) out.push(`${r.id}: specified_cost ${r.specifiedCost} entered, but the card's cost is now ${JSON.stringify(r.energyCost)} rather than X — the entry overrides the fixed-cost convention`);
    else if (!SPECIFIED_CLAUSE.test(r.skill ?? "")) out.push(`${r.id}: specified_cost ${r.specifiedCost} entered, but the card no longer prints a specified-cost clause — nothing reads the baseline`);
  }
  return out;
}

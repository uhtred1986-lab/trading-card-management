/**
 * A card as a bag of **declared attributes**.
 *
 * The legacy engine reads `def.power`, `def.colors`, `def.energyCost` — field
 * names baked into 23k lines. An interpreter that plays a `GameDefinition` has
 * none of those: it is handed the `DEFINE ATTRIBUTE` declarations and a catalog
 * row, and everything it later reads about a card it reads by declared name.
 *
 * This module is the adapter between those two, and it is deliberately the
 * *only* place in `vm/` that knows a `CardDef` field name at all. Three things
 * it does, in this order:
 *
 *  1. **Read** each declared card attribute off the catalog row (`CATALOG`
 *     below, keyed by `keyof CardDef`, so a new catalog field fails the
 *     typecheck here until it is read or declared not to be an attribute).
 *  2. **Check** the value against the declaration's `value:` — a card whose
 *     value is of the wrong type loses that one attribute and is *reported*,
 *     never thrown: a catalog of 6,500 cards that cannot start a game because
 *     one row is odd is worse than a game missing one measure (the issue's
 *     "list them once at load, do not crash a game").
 *  3. **Account** for both directions (`attributeGaps`): a declared card
 *     attribute nothing fills, and a field this adapter reads that the game
 *     never declared. Either is a bug in the pair, and `npm test` asserts the
 *     DBS ruleset has none.
 *
 * What is *not* here: the value an effect has changed. `power`, `costOf`,
 * `comboCostOf` and `zEnergyCostOf` declare `layers:` — the order of 9-9-1 and
 * 20-21 — and a layered value is the interpreter's to compute with the effects
 * in force (#140/#142). The three cost attributes are therefore filled by the
 * board, not from the card; `power` has a printed value *and* layers, so its
 * printed face is read here and the layers are applied over it later.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { specifiedCostOf, specifiedCostUnknown } from "../engine/cards";
import { COLORS } from "../engine/script";
import type { CardDef, Color } from "../engine/types";
import type { AttributeDef, GameDefinition } from "../rulesets";

/** What an attribute's value may be — one shape per `value:` word the grammar allows. */
export type AttrValue = number | string | boolean | readonly string[];

/** One card's attributes, by declared name. An attribute the card does not have is absent, which is not the same as zero or empty. */
export type Attrs = Readonly<Record<string, AttrValue>>;

/**
 * A value the catalog gave that the declaration does not describe. Collected
 * and returned, never thrown.
 */
export interface AttrProblem {
  /** The catalog id of the card, so the report names a card a person can open. */
  card: string;
  attr: string;
  /** The declared `value:` word. */
  declared: AttributeDef["value"];
  /** What arrived, in words. */
  got: string;
}

/** Where the adapter and the declarations disagree about what a card has. Both directions, because either is a bug. */
export interface AttributeGaps {
  /** Card attributes the game declares that nothing fills. */
  unfilled: string[];
  /** Fields this adapter reads that the game declares no attribute for. */
  undeclared: string[];
}

/** Reads one declared attribute off a catalog row. `undefined` means the card does not have it (a Leader has no energy cost), which is not a problem to report. */
type Reader = (def: CardDef) => AttrValue | undefined;

/**
 * The catalog adapter, keyed by the `CardDef` field whose name the attribute
 * shares. Keyed by `keyof CardDef` on purpose: a field added to the catalog row
 * fails the typecheck here until someone decides whether it is an attribute,
 * which is the same discipline `FILTER_FIELDS` and `OP_SCHEMA` keep.
 *
 * Two readings are worth their comments:
 *
 * **An X cost is absent, not zero.** 1-2-2-2 says an X cost counts as 0 except
 * while it is being paid, and the declaration says so too — but the value being
 * paid is named by the player at the moment of payment, which is #140's. Read
 * as `0` here, every "energy cost of 1 or less" selector in the catalog would
 * start matching every X-cost card, which the engine playing today does not do
 * (`matches` in `engine/filters.ts` measures a cost only when it is a number).
 * Absent keeps the two engines answering alike, and keeps "this card's cost is
 * 0" from being said about a card whose cost nobody has chosen yet.
 *
 * **The specified cost is the engine's reading, and absent when unknown.** The
 * catalog carries no cost orbs at all (checked card by card, 12 Sep 2026), so
 * `specifiedCostOf` stands in with the one-orb-per-colour convention — the same
 * requirement `playCost` charges. Where it cannot even do that (an X cost with
 * no orbs recorded) the attribute is absent rather than empty, because "this
 * card demands no colour" and "nobody knows what it demands" are different
 * claims and `specifiedCostUnknown` is the one that says which.
 */
const CATALOG: Record<keyof CardDef, Reader> = {
  id: (d) => d.id,
  name: (d) => d.name,
  type: (d) => d.type,
  colors: (d) => d.colors,
  energyCost: (d) => (typeof d.energyCost === "number" ? d.energyCost : undefined),
  specifiedCost: (d) => (specifiedCostUnknown(d) ? undefined : orbs(specifiedCostOf(d))),
  zEnergyCost: (d) => d.zEnergyCost ?? undefined,
  power: (d) => d.power ?? undefined,
  comboCost: (d) => d.comboCost ?? undefined,
  comboPower: (d) => d.comboPower ?? undefined,
  characters: (d) => d.characters,
  traits: (d) => d.traits,
  skill: (d) => d.skill ?? undefined,
  back: (d) => d.back != null,
  alsoNames: (d) => d.alsoNames ?? [],
};

/**
 * The card attributes the *board* fills rather than the card: three prices as
 * they stand, after every reduction in force (20-21), and — since spec
 * §2.5-1/§2.5-3 (#275) — the six that live on the card sitting on the table
 * rather than on the catalog row at all. The three prices declare `layers:`
 * beginning with `printed`, and the printed half is the attribute beside it
 * (`energyCost`, `comboCost`, `zEnergyCost`, paired in `PRINTED_BASE`); the six
 * have no such sibling — `mode`, `markers`, `hidden`, `faceUp` and `flipped`
 * read the live instance state directly and `keywords` the card's currently
 * showing skills, both seeded fresh by `attrsNow` (`vm/program.ts`), which is
 * the one place either half of this set is filled.
 *
 * Listed rather than derived from `layers:` because `power` has layers too and
 * *is* printed: the difference is that none of these nine has a face of its
 * own on `CardDef` to read. #140 computes the first three; #275 the rest.
 */
const FROM_BOARD = new Set(["costOf", "comboCostOf", "zEnergyCostOf", "mode", "markers", "keywords", "hidden", "faceUp", "flipped"]);

/**
 * The printed face each board-filled price is a reading *of* (20-21).
 *
 * `costOf` declares `layers: [printed, reduction, specified]`, and its
 * `printed` layer is not a value of its own — it is the printed total beside
 * it. Without this pairing the attribute reads as absent however many layers
 * are wired, which is the "nothing maps `costOf` back onto the `energyCost` it
 * discounts" `vm/costs.ts` named as one of the four pieces 20-21 was waiting
 * on (#146 fills this one; the other three are still open, and that module's
 * header says which).
 *
 * A pairing rather than a rule about names: the three are the ones
 * `attributeGaps` already calls board-filled, and each says in its own `text:`
 * which printed number it discounts.
 */
export const PRINTED_BASE: Record<string, string> = { costOf: "energyCost", comboCostOf: "comboCost", zEnergyCostOf: "zEnergyCost" };

/** One orb per entry, the way the declaration asks ("one entry per orb"). */
function orbs(cost: Partial<Record<Color, number>>): string[] {
  const out: string[] = [];
  for (const [color, n] of Object.entries(cost)) for (let i = 0; i < (n ?? 0); i++) out.push(color);
  return out;
}

/** The card attributes this game declares, in declaration order. */
export function cardAttributes(game: GameDefinition): string[] {
  return Object.entries(game.attributes)
    .filter(([, a]) => a.of === "card")
    .map(([name]) => name);
}

/** The player attributes this game declares — `energyMarkers` in DBS (1-14). */
export function playerAttributes(game: GameDefinition): string[] {
  return Object.entries(game.attributes)
    .filter(([, a]) => a.of === "player")
    .map(([name]) => name);
}

/**
 * Does this game declare the attributes the adapter reads, and does the adapter
 * fill the ones it declares? Answered once at load, by name in both
 * directions — "15 !== 18" says nothing about which one is missing.
 */
export function attributeGaps(game: GameDefinition): AttributeGaps {
  const declared = new Set(cardAttributes(game));
  const filled = new Set<string>([...Object.keys(CATALOG), ...FROM_BOARD]);
  return {
    unfilled: [...declared].filter((name) => !filled.has(name)),
    undeclared: [...filled].filter((name) => !declared.has(name)),
  };
}

/**
 * One card's attributes, with the values the declarations do not describe left
 * out and reported.
 */
export function attrsOf(def: CardDef, game: GameDefinition): { attrs: Attrs; problems: AttrProblem[] } {
  const attrs: Record<string, AttrValue> = {};
  const problems: AttrProblem[] = [];
  for (const [name, declaration] of Object.entries(game.attributes)) {
    if (declaration.of !== "card") continue;
    const read = CATALOG[name as keyof CardDef] as Reader | undefined;
    if (!read) continue; // filled by the board (`FROM_BOARD`), or a gap `attributeGaps` reports.
    const value = read(def);
    if (value === undefined) continue; // the card does not have this one.
    const wrong = typeError(value, declaration.value);
    if (wrong) problems.push({ card: def.id, attr: name, declared: declaration.value, got: wrong });
    else attrs[name] = value;
  }
  return { attrs, problems };
}

/** Every card's attributes, and one report for the lot. What `createGame` reads the catalog through. */
export function attrsForDefs(defs: Record<string, CardDef>, game: GameDefinition): { attrs: Record<string, Attrs>; problems: AttrProblem[] } {
  const attrs: Record<string, Attrs> = {};
  const problems: AttrProblem[] = [];
  for (const [id, def] of Object.entries(defs)) {
    const one = attrsOf(def, game);
    attrs[id] = one.attrs;
    problems.push(...one.problems);
  }
  return { attrs, problems };
}

/** Null when the value is of the declared type; else what arrived, in words. */
function typeError(value: AttrValue, declared: AttributeDef["value"]): string | null {
  switch (declared) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : words(value);
    case "string":
      return typeof value === "string" ? null : words(value);
    case "boolean":
      return typeof value === "boolean" ? null : words(value);
    case "strings":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? null : words(value);
    case "colors":
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return words(value);
      // A colour word the game does not use is as wrong as a number here: a
      // filter asking for "blue" would silently miss it.
      return value.every((v) => (COLORS as readonly string[]).includes(v)) ? null : `[${value.join(", ")}]`;
  }
}

function words(value: unknown): string {
  if (Array.isArray(value)) return `a list of ${value.length}`;
  return `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * A `CardFilter` as a **predicate over declared attributes**.
 *
 * "Blue ≪Saiyan≫ Battle Card with an energy cost of 3 or less" is read off a
 * card's printed text by the compiler into a `CardFilter` (`engine/filters.ts`),
 * stored in `card_rules`, printed and re-parsed by the language. None of that
 * changes here, and deliberately: the compiler, the drafter, the workbench and
 * every stored program keep the shape they have. What changes is how the filter
 * is *answered* — the legacy engine reads `def.colors` and `def.characters`, and
 * this engine reads the attributes the game declared, by name.
 *
 * Two tables do the work, and neither is allowed to go stale:
 *
 *   `MEASURES`   one row per field of `CardFilter`, keyed by `keyof CardFilter`
 *                so a new measure fails `npm run typecheck` here until it says
 *                which attributes answer it. A row is either the attributes it
 *                reads, or `instance:` — a measure that is not about the card
 *                at all but about the copy of it on the table, which the
 *                selector answers where the instance is known (#140).
 *   `FILTER_FIELDS` (`lang/ast.ts`) the same field list from the language's
 *                side; `npm test` asserts the two agree, so a field cannot be
 *                described for printing and forgotten for playing.
 *
 * **A filter naming an attribute the game lacks fails at load**, by name, with
 * `FilterNeedsAttribute`: a predicate that quietly answered `false` would turn
 * a missing declaration into a card that never matches anything, which is how a
 * whole set of rules goes silently dead. A filter that measures nothing the game
 * lacks costs nothing — only the fields a filter actually *uses* are required.
 *
 * The one reading this module does of card *text* is keywords and skill kinds:
 * those are measured against the printed text box, which is the declared `skill`
 * attribute, and both engines read it with the same functions
 * (`parseSkills`/`keywordsInSkills` in `engine/cards.ts`). There is no second
 * reading of a keyword in this codebase and there must not be.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { keywordsInSkills, parseSkills } from "../engine/cards";
import { emptyFilter, type CardFilter } from "../engine/filters";
import type { KeywordSkill, Skill, SkillKindPrefix } from "../engine/types";
import { FILTER_FIELD_NAMES } from "../lang";
import type { GameDefinition } from "../rulesets";
import type { Attrs, AttrValue } from "./cards";

/** A filter measured an attribute this game does not declare. Thrown when the predicate is built, never while a game is being played. */
export class FilterNeedsAttribute extends Error {
  readonly field: keyof CardFilter;
  readonly attribute: string;
  constructor(field: keyof CardFilter, attribute: string, game: string) {
    super(`a filter measures ${String(field)}, which reads the attribute ${JSON.stringify(attribute)}, and the ${game} ruleset declares no such attribute`);
    this.name = "FilterNeedsAttribute";
    this.field = field;
    this.attribute = attribute;
  }
}

/**
 * What answers one measure: the attributes it reads, or the reason it is not
 * about the card's attributes at all.
 *
 * `reads` is what the measure *needs* — a game that does not declare one of
 * these cannot answer the measure, and `predicateOf` refuses. `also` is an
 * attribute it reads when there is one and does without when there is not: the
 * names a skill gave a card "in all areas" (20-1) widen a name measure where
 * the game has that mechanic, and a game with no such mechanic still measures
 * printed names perfectly well.
 */
export type Measure = { reads: readonly string[]; also?: readonly string[]; instance?: undefined } | { reads?: undefined; also?: undefined; instance: string };

/**
 * One row per field of `CardFilter`. The `reads` lists are what
 * `predicateOf` checks the game declares, so the error can name the attribute
 * and not just the field.
 *
 * The three `instance` rows are the measures a card's attributes cannot answer,
 * and each is the same one the legacy engine's `matches` leaves alone:
 * `faceUp` is about this copy of the card in this area (3-9-2-1), `powerRel`
 * measures against another card the skill is holding, and `unreadable` is the
 * compiler saying it refused the phrase — a filter carrying it selects nothing,
 * and that refusal is the selector's to make rather than a card's to fail.
 */
export const MEASURES: Record<keyof CardFilter, Measure> = {
  colors: { reads: ["colors"] },
  notColors: { reads: ["colors"] },
  monoColor: { reads: ["colors"] },
  multiColor: { reads: ["colors"] },
  characters: { reads: ["characters"] },
  notCharacters: { reads: ["characters"] },
  charactersIncluding: { reads: ["characters"] },
  notCharactersIncluding: { reads: ["characters"] },
  traits: { reads: ["traits"] },
  notTraits: { reads: ["traits"] },
  names: { reads: ["name"], also: ["alsoNames"] },
  notNames: { reads: ["name"], also: ["alsoNames"] },
  namesIncluding: { reads: ["name"], also: ["alsoNames"] },
  notNamesIncluding: { reads: ["name"], also: ["alsoNames"] },
  keywords: { reads: ["skill"] },
  notKeywords: { reads: ["skill"] },
  noKeywords: { reads: ["skill"] },
  skillKind: { reads: ["skill"] },
  type: { reads: ["type"] },
  notType: { reads: ["type"] },
  token: { reads: ["type"] },
  notToken: { reads: ["type"] },
  z: { reads: ["type"] },
  costMin: { reads: ["energyCost"] },
  costMax: { reads: ["energyCost"] },
  powerMin: { reads: ["power"] },
  powerMax: { reads: ["power"] },
  faceUp: { instance: "which copy of the card is face up is about the instance in its area (3-9-2-1), not about the card" },
  powerRel: { instance: "a bound read off another card the skill has chosen, so it is applied where that card is known" },
  unreadable: { instance: "the compiler refused the phrase: the selector offers nothing rather than a card failing to match" },
};

/**
 * Does this filter use this measure? A filter the compiler wrote carries every
 * field; one a person or the referee wrote carries only what it means. Answered
 * by the value's shape rather than by a fourth table — an empty list, a `false`
 * flag and a `null` bound all mean "says nothing".
 */
export function usesMeasure(filter: Partial<CardFilter>, field: keyof CardFilter): boolean {
  const value = filter[field];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return true;
}

/** The fields this filter actually measures. */
export function measuresUsed(filter: Partial<CardFilter>): (keyof CardFilter)[] {
  return FILTER_FIELD_NAMES.filter((field) => usesMeasure(filter, field));
}

/** Every attribute this filter may read — the ones it needs and the ones it widens with (see `Measure`). */
export function attributesRead(filter: Partial<CardFilter>): string[] {
  const out = new Set<string>();
  for (const field of measuresUsed(filter)) {
    for (const attr of MEASURES[field].reads ?? []) out.add(attr);
    for (const attr of MEASURES[field].also ?? []) out.add(attr);
  }
  return [...out];
}

/** The attributes this filter cannot be answered without. What `predicateOf` checks the game declares. */
export function attributesRequired(filter: Partial<CardFilter>): string[] {
  const out = new Set<string>();
  for (const field of measuresUsed(filter)) for (const attr of MEASURES[field].reads ?? []) out.add(attr);
  return [...out];
}

/** The measures this filter uses that a card's attributes cannot answer, with the reason each is left to the selector. */
export function deferredMeasures(filter: Partial<CardFilter>): { field: keyof CardFilter; reason: string }[] {
  return measuresUsed(filter)
    .filter((field) => MEASURES[field].instance !== undefined)
    .map((field) => ({ field, reason: MEASURES[field].instance! }));
}

/**
 * The predicate. Built once per filter — the attribute check and the fill-up
 * happen here, not per card — and then asked of as many cards as the selector
 * finds.
 */
export function predicateOf(filter: Partial<CardFilter>, game: GameDefinition): (attrs: Attrs) => boolean {
  for (const field of measuresUsed(filter)) {
    for (const attr of MEASURES[field].reads ?? []) {
      if (!(attr in game.attributes)) throw new FilterNeedsAttribute(field, attr, game.id);
    }
  }
  const f: CardFilter = { ...emptyFilter(), ...filter };
  return (attrs) => matchesAttrs(f, attrs);
}

// ── the measures themselves ─────────────────────────────────────────────────

/**
 * Every measure, against one card's attributes. The order and the groupings are
 * the legacy engine's `matches` exactly, and `npm test` asserts the two answer
 * alike over the harness cards for every field: this is the one place the rules
 * engine could start selecting different cards from the engine that has been
 * playing, and a difference here would show up as a card that quietly does the
 * wrong thing rather than as a crash.
 *
 * Two groupings are not arbitrary and are the reason this is one function
 * rather than a predicate per field: a name asked for whole and a name asked for
 * in part are two ways to satisfy *one* choice (2-10-1-1 and the
 * `charactersIncluding` note in `engine/filters.ts`), and several colours in one
 * description mean *either* of them unless the card is asked to be multicolour.
 */
function matchesAttrs(f: CardFilter, attrs: Attrs): boolean {
  const type = text(attrs.type) ?? "";
  if (f.z != null && type.startsWith("Z-") !== f.z) return false;
  if (f.token && type !== "TOKEN") return false;
  if (f.notToken && type === "TOKEN") return false;
  const base = baseTypeOf(type);
  if (f.type && base !== f.type) return false;
  if (f.notType && base === f.notType) return false;

  const colors = list(attrs.colors);
  const colourOk = f.multiColor ? f.colors.every((c) => colors.includes(c)) : f.colors.some((c) => colors.includes(c));
  if (f.colors.length && !colourOk) return false;
  if (f.notColors.some((c) => colors.includes(c))) return false;
  if (f.monoColor && colors.length !== 1) return false;
  if (f.multiColor && colors.length < 2) return false;

  // The text box is read only when something asks about it, which is most
  // filters not at all.
  if (f.notKeywords.length || f.keywords.length || f.noKeywords || f.skillKind) {
    const skills = parseSkills(text(attrs.skill) ?? null);
    const keywords = keywordsInSkills(skills);
    if (f.notKeywords.some((k) => hasKeyword(keywords, k))) return false;
    if (f.keywords.some((k) => !hasKeyword(keywords, k))) return false;
    if (f.noKeywords && keywords.length) return false;
    if (f.skillKind && !skills.some((sk) => sk.kind.startsWith(f.skillKind as SkillKindPrefix))) return false;
  }

  const characters = list(attrs.characters);
  const partChars = f.charactersIncluding ?? [];
  if ((f.characters.length || partChars.length) && !f.characters.some((c) => same(characters, c)) && !partChars.some((c) => part(characters, c))) return false;
  if (f.notCharacters.some((c) => same(characters, c))) return false;
  if ((f.notCharactersIncluding ?? []).some((c) => part(characters, c))) return false;

  const traits = list(attrs.traits);
  if (f.traits.length && !f.traits.some((t) => same(traits, t))) return false;
  if (f.notTraits.some((t) => same(traits, t))) return false;

  // 20-1: every name the card answers to — its printed one, and any a skill
  // gave it "in all areas".
  const names = [text(attrs.name) ?? "", ...list(attrs.alsoNames)].filter((n) => n !== "");
  const partNames = f.namesIncluding ?? [];
  if ((f.names.length || partNames.length) && !f.names.some((n) => same(names, n)) && !partNames.some((n) => part(names, n))) return false;
  if (f.notNames.some((n) => same(names, n))) return false;
  if ((f.notNamesIncluding ?? []).some((n) => part(names, n))) return false;

  const cost = number(attrs.energyCost);
  if (f.costMin != null && (cost == null || cost < f.costMin)) return false;
  if (f.costMax != null && (cost == null || cost > f.costMax)) return false;
  const power = number(attrs.power);
  if (f.powerMin != null && (power == null || power < f.powerMin)) return false;
  if (f.powerMax != null && (power == null || power > f.powerMax)) return false;
  return true;
}

/**
 * The type a filter's `type:` is compared against: a Z-card is measured by what
 * it is a Z-card *of* (14-1) and a token is a Battle Card (19-1). The legacy
 * engine's `baseType` over a `CardDef`; here over the declared attribute, since
 * the attribute's domain is wider than the grammar can say (`attributes.rules`
 * records that gap).
 */
function baseTypeOf(type: string): string {
  const bare = type.replace(/^Z-/, "");
  return bare === "TOKEN" ? "BATTLE" : bare;
}

const hasKeyword = (keywords: KeywordSkill[], name: KeywordSkill["name"]) => keywords.some((k) => k.name === name);

/** A name asked for whole: case-insensitive, which is how the catalog's capitalisation varies. */
const same = (values: readonly string[], name: string) => values.some((v) => v.toLowerCase() === name.toLowerCase());
/** A name asked for in part ("<Son Goku> in its character name"), the loose twin of `same` and only for the phrases that mean it. */
const part = (values: readonly string[], piece: string) => values.some((v) => v.toLowerCase().includes(piece.toLowerCase()));

const text = (value: AttrValue | undefined): string | null => (typeof value === "string" ? value : null);
const number = (value: AttrValue | undefined): number | null => (typeof value === "number" ? value : null);
const list = (value: AttrValue | undefined): readonly string[] => (Array.isArray(value) ? value : []);

/** The parsed skills of a text box, for a caller that wants them once rather than per measure. Exported so nothing else re-implements the reading. */
export function skillsIn(skill: AttrValue | undefined): Skill[] {
  return parseSkills(text(skill) ?? null);
}

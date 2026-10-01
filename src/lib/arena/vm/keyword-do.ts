/**
 * A keyword's own line doing something of its own: the `DO` of a `DEFINE
 * KEYWORD`, and the two fields that say when it runs (Stage 7's groundwork).
 *
 * About fifteen keywords are not hooks at all. [Overlord] is a move a player
 * makes; [Offering] is something that happens when its card is played. The
 * legacy engine has each as a `case` in `activatable`/`whyNotActivate`/
 * `activate` or in `keywordTriggers`/`resolveKeywordOrText`; here each is one
 * paragraph of `keywords.rules`:
 *
 *   `offer: "<skill kind>"` — the line is **a move**. `vm/activate.ts` lists it
 *   among the candidates of the action whose `skills:` takes lines of that
 *   family, gates it like any line of that kind plus the keyword's own
 *   `REFUSE` lines, charges its printed price, and queues `DO` in place of the
 *   card's record.
 *
 *   `at: [<moment>, …]` — the line **answers to moments**. `vm/triggers.ts`
 *   pends it the way it pends an [Auto] whose record names that moment, and
 *   `vm/flow.ts`'s checkpoint runs `DO` when it resolves.
 *
 * This module is only the reading both halves share: which declaration a line
 * carries, and its program with the printed keyword's parameters bound. It is
 * a leaf — no interpreter, no state — so `activate.ts`, `triggers.ts` and
 * `flow.ts` can all import it without importing each other.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { printedDescription, printedNames } from "../engine/cards";
import type { Cond, Op } from "../engine/script";
import type { Skill } from "../engine/types";
import { bindKeywordCond, bindKeywordParams, type GameDefinition, type KeywordDef } from "../rulesets";

/** The declaration of the keyword a line *is* — a line printed as nothing but its keyword tag (22-1-1), never a printed [Activate] that also carries one. */
function declarationOf(game: GameDefinition, sk: Skill): KeywordDef | undefined {
  if (sk.kind !== "keyword" || !sk.keyword) return undefined;
  const def = game.keywords[sk.keyword.name];
  return def?.do ? def : undefined;
}

/**
 * The keyword this line is a move of, when its declaration says `offer:`.
 *
 * One printed shape besides the bare tag is the keyword's move too: a line
 * whose printed kind *is* the kind the move is offered as —
 * "[Union-Absorb][Activate: Main] …" (22-13-6-2) is the [Union] activation
 * itself, printed with the tag of the window it is used in, not a second
 * [Activate] that happens to carry a keyword.
 */
export function keywordMoveOf(game: GameDefinition, sk: Skill): KeywordDef | undefined {
  const def = declarationOf(game, sk) ?? (sk.keyword && sk.kind !== "keyword" ? game.keywords[sk.keyword.name] : undefined);
  return def?.do && def.offer !== undefined && (sk.kind === "keyword" || sk.kind === def.offer) ? def : undefined;
}

/** The keyword this line answers to `trigger` as, when its declaration names that moment in `at:`. */
export function keywordMomentOf(game: GameDefinition, sk: Skill, trigger?: string): KeywordDef | undefined {
  const def = declarationOf(game, sk);
  if (!def?.at) return undefined;
  return trigger === undefined || def.at.includes(trigger) ? def : undefined;
}

/**
 * The keyword's `DO`, with its parameters filled in from the line as printed —
 * `[Swap 3]` runs its body with `x` bound to 3. The `KeywordSkill` the card
 * parser hands back carries exactly the fields `TAKES` declares, which
 * `scripts/verify/rulesets.ts` holds equal.
 */
export function keywordProgram(game: GameDefinition, def: KeywordDef, sk: Skill): Op[] {
  return bindKeywordParams(def.do ?? [], def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game);
}

/** The keyword's `AFTER` — what a move runs once the line's printed effect has — bound the way its `DO` is (#155). */
export function keywordAfterProgram(game: GameDefinition, def: KeywordDef, sk: Skill): Op[] {
  return def.after ? bindKeywordParams(def.after, def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game) : [];
}

/** A `REFUSE … UNLESS` of the keyword's move, with its parameters filled in from the line as printed (`$variant`, `$x`), the way its `DO` is. */
export function keywordRefusalCond(game: GameDefinition, def: KeywordDef, sk: Skill, cond: Cond): Cond {
  return bindKeywordCond(cond, def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game);
}

/**
 * The words a keyword's move shows — its `label:` and the text of a `REFUSE`'s
 * requirement — with the line's own words put in: `{card}` is the card's name,
 * `{line}` the description the line prints ("<Nail>"), `{names}` the
 * characters it names in ‹…› joined by "and", `{back}` the name its other face
 * prints (a Leader's awakened side), and `{<param>}` a parameter the
 * keyword `TAKES`, as printed (`{variant}` is "Xeno-Evolve", `{x}` is 3), and
 * `{<param>?<words>}` the words only when a boolean parameter is set. The
 * legacy engine builds each of these sentences by hand per keyword; here the
 * declaration writes it once.
 */
export function keywordWords(text: string, def: KeywordDef, sk: Skill, card: string, back?: string): string {
  const values = (sk.keyword ?? {}) as Record<string, unknown>;
  // `{<param>?<words>}` — the words when a boolean parameter is set, nothing
  // when it is not: "{dark?Dark }Over Realm" (#157).
  text = text.replace(/\{(\w+)\?([^{}]*)\}/g, (whole, name: string, words: string) => (def.takes?.some((p) => p.name === name) ? (values[name] === true ? words : "") : whole));
  return text.replace(/\{(\w+)(:and)?\}/g, (whole, name: string, and?: string) => {
    if (name === "card") return card;
    // The name the card's other face prints — a Leader's awakened side (#155).
    if (name === "back" && back !== undefined) return back;
    if (name === "line") return printedDescription(sk);
    if (name === "names") return printedNames(sk).join(" and ");
    if (def.takes?.some((p) => p.name === name) && values[name] !== undefined) {
      // A list parameter ([Arrival]'s colours) is written as printed,
      // "Red/Blue" — or "Red and Blue" as `{colors:and}`.
      const v = values[name];
      return Array.isArray(v) ? v.join(and ? " and " : "/") : String(v);
    }
    return whole;
  });
}

/**
 * The names a keyword's own move is announced under for `keywordActivated`:
 * the keyword, and — when the card prints a variant of it — the variant as
 * printed, so "when this card's [Union-Absorb] is activated" (22-13-5) hears
 * an Absorb and "when you activate a [Union] skill" hears every [Union].
 */
export function keywordMomentNames(def: KeywordDef, sk: Skill): string[] {
  const variant = (sk.keyword as { variant?: unknown } | null)?.variant;
  if (typeof variant !== "string" || variant === def.name) return [def.name];
  return [def.name, variant.includes(def.name) ? variant : `${def.name}-${variant}`];
}

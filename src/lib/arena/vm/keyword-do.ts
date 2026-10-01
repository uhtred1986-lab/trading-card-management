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
import type { Op } from "../engine/script";
import type { Skill } from "../engine/types";
import { bindKeywordParams, type GameDefinition, type KeywordDef } from "../rulesets";

/** The declaration of the keyword a line *is* — a line printed as nothing but its keyword tag (22-1-1), never a printed [Activate] that also carries one. */
function declarationOf(game: GameDefinition, sk: Skill): KeywordDef | undefined {
  if (sk.kind !== "keyword" || !sk.keyword) return undefined;
  const def = game.keywords[sk.keyword.name];
  return def?.do ? def : undefined;
}

/** The keyword this line is a move of, when its declaration says `offer:`. */
export function keywordMoveOf(game: GameDefinition, sk: Skill): KeywordDef | undefined {
  const def = declarationOf(game, sk);
  return def?.offer !== undefined ? def : undefined;
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

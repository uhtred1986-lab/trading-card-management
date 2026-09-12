/**
 * The points a keyword's body may hang on.
 *
 * A `DEFINE KEYWORD` declares what a keyword means and, from Stage 7, one
 * program per moment the interpreter offers it — `HOOK attackDeclared { … }`.
 * The moments are the *interpreter's*, not the game's: a game may say which of
 * them its keywords use, but it cannot invent one, because a hook point is a
 * place in an algorithm and declaring it would move a decision nobody can make
 * to a place nothing tests (`docs/arena-ruleset-spec.md` §7).
 *
 * **Provisional.** §4 of that spec, "the hook contract", is #153's: an
 * inventory taken from the inline keyword sites in the legacy engine, each
 * with an example body. This list is what the loader checks a `HOOK` against
 * until then — drawn from the categories §4 names (choosing, immunity, enter
 * and leave, battle, play/charge/pay) and from the two the language doc's own
 * examples use. Adding one here is not a decision about the engine; it is a
 * promise #153 has to keep or correct.
 */
export const HOOK_POINTS = [
  // play, charge and pay
  "cardPlayed",
  "cardCharged",
  "costChecked",
  "costPaid",
  // entering and leaving a Battle Area
  "enterPlay",
  "leavePlay",
  // the battle (7-x, 8-x)
  "attackDeclared",
  "blockDeclared",
  "battleEnd",
  "damageDealt",
  // being chosen, and the immunities that refuse it
  "beingChosen",
  "beingKOd",
  "beingNegated",
  // what a card is, read rather than resolved
  "powerCalculated",
  "keywordsCalculated",
  // the turn
  "turnStart",
  "turnEnd",
] as const;

export type HookPoint = (typeof HOOK_POINTS)[number];

export const isHookPoint = (name: string): name is HookPoint => (HOOK_POINTS as readonly string[]).includes(name);

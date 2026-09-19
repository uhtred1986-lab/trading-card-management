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
 * **Confirmed by #153's inventory** of every inline keyword site in the
 * legacy engine (`src/lib/arena/engine/`) against the plan's own fifteen
 * names, grouped exactly as `docs/arena-backlog/s7-0{2,3,4,5}-*.md` split
 * them (`docs/arena-ruleset-spec.md` §4 has the full site-by-site table):
 *
 *   A. choosing, immunity, KO by effect  — `chooseable`, `koByEffect`, `attrBonus`
 *   B. entering, leaving, after a skill  — `onEnter`, `onLeave`, `afterSkill`, `activeStep`
 *   C. battle                            — `block`, `counterWindow`, `onAttackDeclared`, `beforeDamage`, `battleEnd`
 *   D. playing, charging, alt payment    — `playRefused`, `chargeLimit`, `altPayment`
 *
 * `src/lib/arena/vm/hooks.ts` is the other half: what each point binds, what
 * a body found there is read to mean, and the two functions (one per answer
 * kind) that run it. This file stays the loader's — the language's parser and
 * `loadRuleset` both read it and must not import `vm/`, which itself imports
 * this file, so the *names* live here and the *contract* lives beside the
 * interpreter that reads them.
 */
export const HOOK_POINTS = [
  // A — choosing, immunity, KO by effect
  "chooseable",
  "koByEffect",
  "attrBonus",
  // B — entering, leaving, after a skill
  "onEnter",
  "onLeave",
  "afterSkill",
  "activeStep",
  // C — battle: blocking, counters, attack, damage, battle end
  "block",
  "counterWindow",
  "onAttackDeclared",
  "beforeDamage",
  "battleEnd",
  // D — playing, charging, alternative payment
  "playRefused",
  "chargeLimit",
  "altPayment",
] as const;

export type HookPoint = (typeof HOOK_POINTS)[number];

export const isHookPoint = (name: string): name is HookPoint => (HOOK_POINTS as readonly string[]).includes(name);

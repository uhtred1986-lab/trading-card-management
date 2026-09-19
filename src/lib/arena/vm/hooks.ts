/**
 * The hook contract: where a `DEFINE KEYWORD` body may hang, and what running
 * one means.
 *
 * `rulesets/hooks.ts` carries the **names** — the closed vocabulary the loader
 * checks a `HOOK <point> { … }` against, so a game cannot invent a moment
 * nothing tests (`docs/arena-ruleset-spec.md` §7). `vm/hook-contract.ts`
 * carries the **table** — `HOOK_CONTRACT`, what each point binds and whether
 * it is read or run — as a leaf with no dependency on the interpreter, so
 * both halves below can import it without importing each other. This file is
 * the **public surface**: the whole contract re-exported from one place, and
 * `fireHook`, the runner for an *effect* hook. `queryHookStatics`, the runner
 * for a *query* hook, lives in `vm/program.ts` instead — not a second lookup,
 * but the same one moved beside the interpreter readings it depends on
 * (`condHolds`, `amount`, `keywordsInForce`), the way `resolveSelector`/
 * `resolveRef`/`amount`/`condHolds` already are. All #153's.
 *
 * **Fifteen points, four groups** — the plan's own split, and the four
 * `docs/arena-backlog/s7-0{2,3,4,5}-*.md` issues that each take one:
 *
 *   A. choosing, immunity, KO by effect  — `chooseable`, `koByEffect`, `attrBonus`
 *   B. entering, leaving, after a skill  — `onEnter`, `onLeave`, `afterSkill`, `activeStep`
 *   C. battle: blocking, counters, attack, damage, battle end
 *                                        — `block`, `counterWindow`, `onAttackDeclared`, `beforeDamage`, `battleEnd`
 *   D. playing, charging, alternative payment — `playRefused`, `chargeLimit`, `altPayment`
 *
 * **Two kinds of hook, not fifteen special cases.** A body is either *read* or
 * *run*, and which is the hook point's own property (`HookSpec.answer`):
 *
 *   `"query"` — asked mid-calculation, for an answer needed *now*: is this
 *   card a legal candidate, how much bonus does it carry, is this play
 *   refused. It can never suspend — nothing waiting on "is this choosable"
 *   can be handed a question instead — so it is read **declaratively**, the
 *   way `vm/effects.ts`'s `permanents()` reads a [Permanent]'s static ops
 *   without ever executing them: `queryHookStatics` (`vm/program.ts`) walks
 *   the body's `if`s to their leaves and reads the one op each leaf ends in
 *   (`forbid`, `modifyAttr` — every query hook's own refusal already has a
 *   `ForbiddenAction` word, so `forbid` folds straight into `prohibitions()`'s
 *   existing 20-14 reading rather than needing `immune`, #154) as a fact in
 *   force, fresh every time it is asked, and applies nothing to `state`
 *   itself. Nothing here decides
 *   *when* to ask — the group issue that reads a query hook still writes its
 *   own call site's condition and its own reading of the boolean/delta the
 *   walker hands back, the same way `permanents()`'s callers already fold
 *   statics into a value.
 *
 *   `"effect"` — something *happens* at the moment: a card enters, a battle
 *   ends, a skill resolves after another does. It is run exactly like a
 *   triggered [Auto]'s `DO` block already is — `fireHook` builds one
 *   `ScriptFrame` per matching body and pushes it onto `state.programs`, so
 *   `vm/flow.ts`'s existing runner drains it, a question it asks is a real
 *   prompt, and nothing about resolving one is new.
 *
 * **Binding.** A body reads its own card as `{special:"self"}`, like any
 * other program (`frame.card`). A battle hook reads the fight through the
 * specials `vm/program.ts` already resolves off `state.battle` —
 * `{special:"attacker"}`, `{special:"guard"}` — so no group needs its own `$`
 * variable for them. `HookSpec.vars` names the few points that bind
 * something *else* a body can reach no other way (a card entering before it
 * has a zone of its own to be selected from, and so on); an empty list is not
 * a placeholder, it is the claim that the specials already cover the moment.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext } from "../engine";
import type { GameDefinition, HookPoint } from "../rulesets";
import { HOOK_CONTRACT } from "./hook-contract";
import { hookBodiesFor, hookFrame } from "./program";
import type { VmState } from "./state";

export { HOOK_CONTRACT, type HookAnswer, type HookSpec } from "./hook-contract";
export { hookBodiesFor, queryHookStatics, type HookBody, type QueryFact } from "./program";

// ── effect hooks: run, exactly like a triggered [Auto] (`vm/triggers.ts`) ──

/**
 * Queues every matching body as a real program, the same `state.programs`
 * queue `vm/flow.ts` already drains for a triggered [Auto]'s `DO` block
 * (`vm/battle.ts`, `vm/activate.ts`, `vm/actions.ts` all `unshift` onto it the
 * same way). A body that asks a question suspends there like any other
 * program, so an effect hook's prompt is a real one rather than a special
 * case this file invents.
 */
export function fireHook(ctx: EngineContext, game: GameDefinition, state: VmState, subject: string, point: HookPoint, vars: Record<string, string[]> = {}): void {
  if (HOOK_CONTRACT[point].answer !== "effect") throw new Error(`vm/hooks.ts: "${point}" is a query hook — use queryHookStatics, not fireHook`);
  for (const body of hookBodiesFor(ctx, game, state, subject, point)) state.programs.unshift(hookFrame(game, state, subject, body.ops, vars));
}

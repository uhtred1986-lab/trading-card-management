/**
 * The hook contract: where a `DEFINE KEYWORD` body may hang, and what running
 * one means.
 *
 * `rulesets/hooks.ts` carries the **names** — the closed vocabulary the loader
 * checks a `HOOK <point> { … }` against, so a game cannot invent a moment
 * nothing tests (`docs/arena-ruleset-spec.md` §7). This file is the other
 * half, the **interpreter's**: what each of those fifteen points binds, what a
 * body found there is read to mean, and the one function per kind that runs
 * it. Both halves are #153's — the loader's list was provisional until this
 * file's inventory confirmed it (`docs/arena-ruleset-spec.md` §4).
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
 *   without ever executing them: `queryHookStatics` walks the body's `if`s to
 *   their leaves and reads the one op each leaf ends in (`immune`, `forbid`,
 *   `modifyAttr`) as a fact in force, fresh every time it is asked, and
 *   applies nothing to `state` itself. Nothing here decides *when* to ask —
 *   the group issue that reads a query hook still writes its own call site's
 *   condition and its own reading of the boolean/delta the walker hands back,
 *   the same way `permanents()`'s callers already fold statics into a value.
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
 * **Out of scope, deliberately** (#153's own line): no keyword names a body
 * yet — `rulesets/dbs/keywords.rules` still declares all 39 with none — so
 * `hookBodiesFor` always returns `[]` today and both runners are no-ops on
 * every real game. What proves the wiring rather than the shape is
 * `scripts/verify/rulesets.ts`'s own tiny ruleset with one worked body per
 * hook, run through both runners for real.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext } from "../engine";
import { costModifierAs, negateAs, type CardAttr, type Op, type Side } from "../engine/script";
import type { KeywordSkill, Prohibition } from "../engine/types";
import type { CardFilter } from "../engine/filters";
import { HOOK_POINTS, type GameDefinition, type HookPoint } from "../rulesets";
import { amount, condHolds, keywordsInForce } from "./program";
import { masterOf } from "./triggers";
import type { VmState } from "./state";

/** Read declaratively (`queryHookStatics`) or run as a real happening (`fireHook`). */
export type HookAnswer = "query" | "effect";

export interface HookSpec {
  /** Which of the plan's four groups — and so which `s7-0{2,3,4,5}` issue — owns writing bodies against it. */
  group: "A" | "B" | "C" | "D";
  answer: HookAnswer;
  /** Names a body may reach with `{var: name}` beyond `self` and the battle specials. */
  vars: readonly string[];
  /** Fires when, reads/runs as what — the sentence the inventory in `docs/arena-ruleset-spec.md` §4 expands per site. */
  doc: string;
}

/**
 * One row per `HookPoint` — a `Record` over the closed union, so a name added
 * to `rulesets/hooks.ts` and not here fails `npm run typecheck`, the same
 * guarantee `OP_CLASS` gives every op (`docs/arena-ruleset-spec.md` §5).
 */
export const HOOK_CONTRACT: Record<HookPoint, HookSpec> = {
  chooseable: {
    group: "A",
    answer: "query",
    vars: [],
    doc: "A selector is testing whether `self` may be chosen at all (9-1-4). A body ends in `immune` (optionally under `if`); its `from`/`fromFilter` say whose skills it refuses, exactly as the op already reads for a [Permanent]'s grant. [Barrier] (22-16) is the worked example.",
  },
  koByEffect: {
    group: "A",
    answer: "query",
    vars: [],
    doc: "Something is about to KO or move `self` out of its Battle Area by an effect rather than by battle (9-1-4, 22-12). A body ends in `immune` the same way `chooseable`'s does; the call site is the one that already knows whether this departure is a skill's doing or battle's. [Indestructible] (22-12) is the worked example.",
  },
  attrBonus: {
    group: "A",
    answer: "query",
    vars: [],
    doc: "An attribute of `self` is being read (power, a life-damage amount, a marker count taken). A body ends in `modifyAttr` naming the `attr` and an `amount`, read fresh on every ask the way a [Permanent]'s own `power`/`comboPower` already are. [Servant]'s flat +10000 power (22-40) is the worked example.",
  },
  onEnter: {
    group: "B",
    answer: "effect",
    vars: ["from"],
    doc: "`self` has just arrived in a zone its keyword cares about (9-6-3). Bound: `from`, the zone it left (empty for a card that had none, a deal or a token). [Field]'s \"drop the Field Extra already out\" (22-3) is the worked example.",
  },
  onLeave: {
    group: "B",
    answer: "effect",
    vars: ["to"],
    doc: "`self` is leaving a zone its keyword cares about. Bound: `to`, the zone it is going to. [Revive]'s KO-triggered play from the Drop (22-34) is the worked example.",
  },
  afterSkill: {
    group: "B",
    answer: "effect",
    vars: ["source"],
    doc: "Another skill has just resolved (20-16's `did`, read one level up: not what *this* program did, but what the *board* just did). Bound: `source`, the card whose skill it was. [Heroic]/[Villainous]'s \"when you play another card with the same keyword\" (22-35/22-36) is the worked example.",
  },
  activeStep: {
    group: "B",
    answer: "query",
    vars: [],
    doc: "The Active Step is deciding whether `self` stands up with the rest of its side (7-1-3). A body ends in `modifyAttr` on `mode`, read the same declarative way `attrBonus` is — the step asks once per card rather than the body scheduling anything. [Servant]'s \"does not switch to Active during its master's Charge Phase\" (22-40) is the worked example.",
  },
  block: {
    group: "C",
    answer: "effect",
    vars: [],
    doc: "`self` has just been declared the guard card (8-1-2-1). The attacker and defender read as `{special:\"attacker\"}`/`{special:\"guard\"}`, already resolved off `state.battle` before this fires. [Blocker]'s own follow-up — switching to Rest Mode to become the guard — is the worked example (the window itself, offering [Blocker] cards as candidates, is #150's `battleBlocker` and stays there: this hook is what happens *after* one is chosen, not the offer).",
  },
  counterWindow: {
    group: "C",
    answer: "query",
    vars: [],
    doc: "A play or a battle is opening a Counter window and asking whether `self` (a candidate in hand) is still offerable. A body ends in `forbid` (what: \"counter\") read declaratively, the way [Deflect] empties the window outright for the card being played (22-20) — the worked example.",
  },
  onAttackDeclared: {
    group: "C",
    answer: "effect",
    vars: [],
    doc: "`self` has just been declared the attacker (8-1-1). `{special:\"attacker\"}`/`{special:\"guard\"}` are both already set. [Alliance]'s \"rest other cards as the cost of the printed effect\" (22-32) is the worked example.",
  },
  beforeDamage: {
    group: "C",
    answer: "effect",
    vars: [],
    doc: "Battle damage is about to be calculated for the current fight (8-4). `{special:\"attacker\"}`/`{special:\"guard\"}` name the two cards; the body changes what `dealDamage` (`vm/battle.ts`, #151) then does — [Critical]'s Drop-face-up destination and [Strike]'s raised amount (22-6/22-7) are the worked examples.",
  },
  battleEnd: {
    group: "C",
    answer: "effect",
    vars: [],
    doc: "The battle's steps have run out (8-1-2-2). `{special:\"attacker\"}`/`{special:\"guard\"}` still resolve here, one step before `state.battle` clears. [Revenge]'s \"KO the attacking card at the end of the battle\" (22-9) is the worked example.",
  },
  playRefused: {
    group: "D",
    answer: "query",
    vars: [],
    doc: "A play of `self` is being checked for legality, before cost (5-5, 20-4). A body ends in `forbid` (what: \"play\") under whatever condition the keyword names — [Unique]'s \"can't play another card with the same name\" (22-39) is the worked example, read fresh against the board rather than the state-based cleanup the legacy engine runs instead.",
  },
  chargeLimit: {
    group: "D",
    answer: "effect",
    vars: [],
    doc: "`self` is about to be placed in an Energy Area, from any source (22-31 is written \"valid in every area\"). A body sets `mode` on itself with `modifyAttr`, run once as the placement happens rather than read back afterward. [Energy-Exhaust]'s \"arrives in Rest Mode\" is the worked example.",
  },
  altPayment: {
    group: "D",
    answer: "query",
    vars: [],
    doc: "A price is being planned and is asking what else may pay it, or what it no longer demands. A body ends in `modifyAttr` on the price attribute it changes (`specifiedCost` for a clearing, an energy-shaped grant for a stand-in payer), read declaratively alongside `attributes.rules`' own cost layers. [Warrior of Universe 7]'s specified-cost clearing (22-19) is the worked example.",
  },
};

// A `Record<HookPoint, HookSpec>` above already forces one row per name the
// loader offers; this just makes the same claim visible without reading the
// type, and catches the loader's own list drifting under the contract's.
if (HOOK_POINTS.length !== Object.keys(HOOK_CONTRACT).length) {
  throw new Error("vm/hooks.ts: HOOK_CONTRACT and rulesets/hooks.ts's HOOK_POINTS have drifted apart");
}

/** One keyword's body at one hook point, with the keyword instance that carries it (so a body can read its own `TAKES` parameters once a group needs to). */
export interface HookBody {
  keyword: KeywordSkill;
  ops: Op[];
}

/**
 * Every body among `subject`'s keywords in force that hangs on `point` —
 * `keywordsInForce`'s own list (`vm/program.ts`), narrowed to the ones whose
 * `DEFINE KEYWORD` declares a `HOOK` there. The one place either runner below
 * looks a body up, so a second lookup written into a call site instead of
 * here would be exactly the special case the contract exists to rule out.
 */
export function hookBodiesFor(ctx: EngineContext, game: GameDefinition, state: VmState, subject: string, point: HookPoint): HookBody[] {
  const out: HookBody[] = [];
  for (const kw of keywordsInForce(ctx, game, state, subject)) {
    const def = game.keywords[kw.name];
    for (const hook of def?.hooks ?? []) if (hook.at === point) out.push({ keyword: kw, ops: hook.ops });
  }
  return out;
}

/** A minimal frame for a hook body: the language's own shape, `self` bound the way every program already reads its own card, plus whatever this hook's `vars` name. */
function hookFrame(game: GameDefinition, state: VmState, subject: string, ops: Op[], vars: Record<string, string[]>) {
  return { ops, ip: 0, vars: { self: [subject], ...vars }, card: subject, master: masterOf(game, state, subject) };
}

// ── query hooks: read, never run (`vm/effects.ts`'s `permanents()`, one level up) ──

export type QueryFact =
  | { keyword: KeywordSkill; op: "immune"; from?: Side; fromFilter?: CardFilter }
  | { keyword: KeywordSkill; op: "forbid"; forbid: Prohibition }
  | { keyword: KeywordSkill; op: "modifyAttr"; attr: CardAttr | "energyMarkers" | "guard"; delta: number };

/**
 * Every fact a query hook's bodies are in force to state right now — read
 * fresh, applying nothing, the way `permanents()` reads a [Permanent]. Walks
 * `if` to its taken branch and reads the leaf op the three query hooks are
 * documented to end in (`immune`, `forbid`, `modifyAttr`); a body that ends
 * in anything else is a ruleset the loader should have refused and this
 * throws `RulesetBroken` naming it, rather than silently reading nothing —
 * `docs/arena-ruleset-spec.md` §4's own "prefer unread to wrongly read"
 * (`docs/arena-tooling.md` §6.2) applies to a hook body exactly as it does to
 * a card's.
 */
export function queryHookStatics(ctx: EngineContext, game: GameDefinition, state: VmState, subject: string, point: HookPoint): QueryFact[] {
  const spec = HOOK_CONTRACT[point];
  if (spec.answer !== "query") throw new Error(`vm/hooks.ts: "${point}" is an effect hook — use fireHook, not queryHookStatics`);
  const out: QueryFact[] = [];
  for (const body of hookBodiesFor(ctx, game, state, subject, point)) {
    const frame = hookFrame(game, state, subject, body.ops, {});
    readLeaf(ctx, game, state, frame, body.ops, body.keyword, out);
  }
  return out;
}

function readLeaf(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  frame: ReturnType<typeof hookFrame>,
  ops: Op[],
  keyword: KeywordSkill,
  out: QueryFact[],
): void {
  for (const raw of ops) {
    // Only `negate`/`costModifier`'s own short spellings are normalised here
    // — deliberately *not* `modifyAttrAs`, which lowers `modifyAttr` to the
    // primitive it stands for (`switchMode`, `addMarker`, `grant`, …) the way
    // `vm/effects.ts`'s `collect()` wants it. A query hook's body is
    // documented to end in `modifyAttr` itself (§4.1/§4.2), so lowering it
    // here would make the very shape the contract promises unreadable.
    const op = costModifierAs(negateAs(raw));
    if (op.op === "if") {
      if (condHolds(ctx, game, state, frame, op.cond)) readLeaf(ctx, game, state, frame, op.then, keyword, out);
      else if (op.else) readLeaf(ctx, game, state, frame, op.else, keyword, out);
      continue;
    }
    if (op.op === "immune") {
      out.push({ keyword, op: "immune", from: op.from, fromFilter: op.fromFilter });
      continue;
    }
    if (op.op === "forbid") {
      out.push({
        keyword,
        op: "forbid",
        forbid: { what: op.what, filter: op.filter, unless: op.unless, uses: op.uses !== undefined ? amount(ctx, game, state, frame, op.uses) : undefined, master: frame.master },
      });
      continue;
    }
    if (op.op === "modifyAttr" && op.attr) {
      out.push({ keyword, op: "modifyAttr", attr: op.attr, delta: op.amount !== undefined ? amount(ctx, game, state, frame, op.amount) : 0 });
      continue;
    }
    throw new Error(`vm/hooks.ts: [${keyword.name}]'s body is a query hook and ends in "${op.op}", which is none of the shapes ${JSON.stringify(HOOK_POINTS)} document`);
  }
}

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
  const spec = HOOK_CONTRACT[point];
  if (spec.answer !== "effect") throw new Error(`vm/hooks.ts: "${point}" is a query hook — use queryHookStatics, not fireHook`);
  for (const body of hookBodiesFor(ctx, game, state, subject, point)) state.programs.unshift(hookFrame(game, state, subject, body.ops, vars));
}

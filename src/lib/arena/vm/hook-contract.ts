/**
 * `HOOK_CONTRACT` — the fifteen hook points' pure data: which group owns a
 * body there, whether it is read or run, what it binds, what it means.
 *
 * A leaf on purpose, with no dependency beyond `rulesets/hooks.ts`'s name
 * list. `vm/program.ts` needs this table (`queryHookStatics` reads
 * `spec.answer` before walking a body) and is itself where `hookBodiesFor`
 * lives, because reading a hook body is a fifth interpreter reading beside
 * `resolveSelector`/`resolveRef`/`amount`/`condHolds` and needs the same
 * recursion-guarded access to `condHolds`/`amount`/`keywordsInForce` those
 * already have; `vm/hooks.ts` needs it too, for `fireHook` and as the
 * documented public surface. Splitting the table out here is what lets
 * both import it without importing each other — `vm/hooks.ts` already
 * imports `vm/program.ts` for the query half, so `vm/program.ts` importing
 * back from `vm/hooks.ts` would be the cycle this file exists to avoid.
 *
 * See `vm/hooks.ts` for the full account of the contract — the two kinds of
 * hook, the four groups, the fifteen points, one worked example each
 * (`docs/arena-ruleset-spec.md` §4).
 */
import { HOOK_POINTS, type HookPoint } from "../rulesets";

/** Read declaratively (`queryHookStatics`, `vm/program.ts`) or run as a real happening (`fireHook`, `vm/hooks.ts`). */
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
    doc: "A selector is testing whether `self` may be chosen at all (9-1-4). A body ends in `forbid(what: beChosen)` (optionally under `if`), folded into `prohibitions()` alongside the card's other own rules — the same `{kind:\"forbidden\", by, until}` shape a printed 20-4 prohibition already produces, since `resolveSelector` reads them through the one `forbids()` call. [Barrier] (22-16) is the worked example.",
  },
  koByEffect: {
    group: "A",
    answer: "query",
    vars: [],
    doc: "Something is about to KO or move `self` out of its Battle Area by an effect rather than by battle (9-1-4, 22-12). A body ends in `forbid(what: beKOdBySkill)`/`forbid(what: beMovedBySkill)` the same way `chooseable`'s ends in `forbid(what: beChosen)`; the call site is the one that already knows whether this departure is a skill's doing or battle's — a battle's own KO reads the keyword directly (`vm/battle.ts`), since 22-12's \"as a result of battle\" half is not an effect at all. [Indestructible] (22-12) is the worked example.",
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
  throw new Error("vm/hook-contract.ts: HOOK_CONTRACT and rulesets/hooks.ts's HOOK_POINTS have drifted apart");
}

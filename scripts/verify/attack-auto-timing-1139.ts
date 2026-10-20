/**
 * #1139 (rules review 20 Oct 2026, batch 6, BT5-101 Time Magic): an attack's
 * "when this card attacks" [Auto] pends at the declaration (Rule Manual 8-1-3),
 * the guard's side gets counter timing (8-1-4), and the Auto resolves at the
 * checkpoint after it (8-1-5). The engine used to run a checkpoint straight
 * after the declaration, so the Auto had already resolved when the [Counter:
 * Attack] was offered: a self-switching attacker was Active and out of reach
 * of Time Magic's "in Rest Mode".
 *
 * Proof on BT5-101's printed [Counter: Attack] and the attacker's
 * "[Auto] When this card attacks, switch this card to Active Mode", compiled
 * from their text. Run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

/** BT5-101 Time Magic's [Counter: Attack], as printed. */
const TIME_MAGIC = "[Counter: Attack] Your Leader Card is yellow: Negate the attack, then choose up to 1 of your opponent's Battle Cards in Rest Mode ignoring [Barrier]. It can't switch to Active Mode until the start of your next turn.";
const SELF_UNTAP = "[Auto] When this card attacks, switch this card to Active Mode.";
const DRAW_ON_ATTACK = "[Auto] When this card attacks, draw 1 card.";

const defs: Record<string, CardDef> = { ...DEFS,
  L_YEL1139: card("L_YEL1139", { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null }),
  TIMEMAGIC1139: card("TIMEMAGIC1139", { type: "EXTRA", colors: ["Yellow"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: TIME_MAGIC }),
  UNTAP1139: card("UNTAP1139", { energyCost: 0, power: 10000, skill: SELF_UNTAP }),
  DRAW1139: card("DRAW1139", { energyCost: 0, power: 10000, skill: DRAW_ON_ATTACK }),
  // The defender's own Battle Card, to show the window is the guard's, not the attacker's.
  FOE1139: card("FOE1139", { colors: ["Yellow"], energyCost: 0, power: 5000 }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// ── the reading ──────────────────────────────────────────────────────────────
{
  const tm = skillRecords(defs.TIMEMAGIC1139)[0];
  assert.equal(tm.kind, "counter:attack");
  assert.deepEqual(tm.ops.map((o) => o.op), ["negateAttack", "choose", "forbid"], "Time Magic reads: negate, choose in Rest Mode, lock");
  const ua = skillRecords(defs.UNTAP1139)[0];
  assert.deepEqual(ua.trigger, ["attacks"]);
  assert.deepEqual(ua.ops.map((o) => o.op), ["switchMode"]);
}

// ── the VM ───────────────────────────────────────────────────────────────────
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const r = RULES.apply(ctx, roundtrip(s), action);
  events = events.concat(r.events as GameEvent[]);
  return r.state as VmState;
}
function fresh(): VmState {
  // p1 is the attacker, on its second turn so it may attack: the first player cannot attack on turn 1 (7-3-4-4-1).
  let s = RULES.createGame(ctx, { seed: 1139, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L_YEL1139", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); if (area === "battle") s.cards[id].mode = mode; return id;
}
const pendingFor = (s: VmState, id: string) => s.pending.filter((p) => p.kind !== "hook" && p.card === id).length;

/** Declare the attack on p2's Leader and return the state at the first window it opens to p2. */
function declare(s: VmState, attacker: string): VmState {
  const target = s.sides.p2.zones.leader[0];
  const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === attacker && l.action.target === target);
  assert.ok(atk, "the attack is offered");
  return take(s, atk.action);
}
/** Answer prompts to the end of the battle (back at `main`): p2 passes, Autos in the first order. */
function finish(s: VmState, want: string | null = null): VmState {
  for (let i = 0; i < 40 && (s.battle || s.prompt.kind !== "main"); i++) {
    const q = s.prompt;
    if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: want && q.choice.candidates.includes(want) ? [want] : q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

// 1. No counter: the Auto still resolves, at the checkpoint after the (empty-handed) counter timing.
{
  const s = fresh();
  const attacker = stage(s, "p1", "UNTAP1139", "battle");
  let r = declare(s, attacker);
  r = finish(r);
  assert.equal(r.cards[attacker].mode, "active", "with nobody countering, the Auto switched the attacker back to Active Mode");
}

// 2. The window opens with the Auto still pending, and Time Magic can choose the attacker.
{
  const s = fresh();
  const attacker = stage(s, "p1", "UNTAP1139", "battle");
  const tm = stage(s, "p2", "TIMEMAGIC1139", "hand");
  let r = declare(s, attacker);
  assert.equal(r.prompt.kind, "counter", "the guard's side gets counter timing (8-1-4)");
  const q = r.prompt as Extract<VmState["prompt"], { kind: "counter" }>;
  assert.equal(q.player, "p2");
  assert.ok(q.candidates.includes(tm), "Time Magic is offered");
  assert.equal(r.cards[attacker].mode, "rest", "8-1-3: the attacker's Auto is only pending at counter timing, so it has not switched the attacker to Active Mode");
  assert.equal(pendingFor(r, attacker), 1, "8-1-3: and it waits in the pending list");

  events = [];
  r = take(r, { type: "counter", player: "p2", card: tm });
  // Time Magic resolves at counter timing: its choice offers the attacker, still in Rest Mode.
  let guard = 0;
  while (r.prompt.kind !== "chooseCards" && guard++ < 10) {
    if (r.prompt.kind === "orderPending") r = take(r, { type: "orderPending", player: r.prompt.player, index: 0 });
    else break;
  }
  assert.equal(r.prompt.kind, "chooseCards", "Time Magic asks which Rest Mode Battle Card to lock");
  const choice = (r.prompt as Extract<VmState["prompt"], { kind: "chooseCards" }>).choice;
  assert.ok(choice.candidates.includes(attacker), "Time Magic can choose the attacker, which has not untapped yet");
  assert.equal(pendingFor(r, attacker), 1, "the Auto is still pending while Time Magic resolves");
  r = take(r, { type: "choose", player: "p2", cards: [attacker] });
  r = finish(r, attacker);
  assert.equal(pendingFor(r, attacker), 0, "8-1-5: the Auto resolved at the checkpoint after counter timing");
  assert.ok(events.some((e) => e.type === "attackNegated"), "Time Magic negated the attack");
  // The Auto resolved (nothing pending) and the lock Time Magic put on the attacker held against it (#1138/#1143, the Q&A's third answer).
  assert.equal(r.cards[attacker].mode, "rest", "the Auto ran, but Time Magic's lock kept the attacker in Rest Mode");
}

// 3. A negated attack does not negate its "when attacks" Autos: they resolve after the negation (the Q&A's first answer).
{
  const s = fresh();
  const attacker = stage(s, "p1", "DRAW1139", "battle");
  const tm = stage(s, "p2", "TIMEMAGIC1139", "hand");
  const hand = s.sides.p1.zones.hand.length;
  let r = declare(s, attacker);
  assert.equal(r.sides.p1.zones.hand.length, hand, "nothing is drawn before counter timing");
  r = take(r, { type: "counter", player: "p2", card: tm });
  r = finish(r, attacker);
  assert.equal(r.sides.p1.zones.hand.length, hand + 1, "the negated attack's Auto still resolved afterwards");
}

console.log("#1139 attack Autos resolve after counter timing: pending at 8-1-3, Time Magic chooses the Rest Mode attacker at 8-1-4, the Auto resolves at the 8-1-5 checkpoint, negation leaves it alone");

/**
 * #1120 (rules review 20 Oct 2026, batch 4, BT3-082 back 10): "When your
 * <filter> is KO'd" is a trigger condition (Rule Manual 9-6), so a KO of a
 * card that does not meet it is no trigger and uses nothing, [Once per turn]
 * included.
 *
 * The compiled record is a lone IF on the KO'd card's filter (`special:
 * "subject"`); `pendAutos` reads that before the Auto is pended, the way it
 * already does for a hand-return. No new record field, so stored rows need no
 * rebuild. Run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { VmState } from "../../src/lib/arena/vm/state";
import { stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { run } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, compileSkill, fifty, parseSkills } from "./harness";

const BT3_082_B10 = "[Auto] [Once per turn] When your ≪Saiyan≫ is KO'd, this card gains +5000 power for the duration of the turn.";
DEFS.T1120_WATCH = card("T1120_WATCH", { type: "BATTLE", colors: ["Red"], energyCost: 0, power: 10000, skill: BT3_082_B10 });
DEFS.T1120_SAIYAN = card("T1120_SAIYAN", { type: "BATTLE", colors: ["Red"], energyCost: 0, traits: ["Saiyan"] });
DEFS.T1120_OTHER = card("T1120_OTHER", { type: "BATTLE", colors: ["Red"], energyCost: 0, traits: ["Android"] });
DEFS.T1120_DRAW_ANY = card("T1120_DRAW_ANY", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Auto] When one of your Battle Cards is KO'd, draw 1 card." });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const DBS = loaded.definition;
const deck = { seed: 1120, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } };

// The compiled record: a lone IF on the KO'd card's <Saiyan> filter.
{
  const s = compileSkill(parseSkills(BT3_082_B10)[0]);
  assert.deepEqual(s.unsupported, []);
  const op = s.ops[0] as Extract<Op, { op: "if" }>;
  assert.equal(s.ops.length, 1);
  assert.equal(op.op, "if");
  assert.ok(!op.else);
  assert.equal(op.cond.kind, "count");
  assert.equal((op.cond as { sel: { special?: string } }).sel.special, "subject");
}

function game(): VmState {
  let s = RULES.createGame(CTX, deck).state as VmState;
  const take = (a: Action): void => { s = RULES.apply(CTX, s, a).state as VmState; };
  take({ type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" });
  take({ type: "mulligan", player: "p1", redraw: false });
  take({ type: "mulligan", player: "p2", redraw: false });
  take({ type: "charge", player: "p1", card: null });
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, cardId: string): string {
  const id = s.sides.p1.zones.deck[0];
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, DBS, id, "battle", { owner: "p1" }).ok);
  s.pending = [];
  return id;
}
function ko(s: VmState, victim: string, source: string): void {
  const ev: GameEvent[] = [];
  const frame: ScriptFrame = { ops: [{ op: "ko", target: { var: "t" } }], ip: 0, vars: { t: [victim] }, card: source, master: "p1" };
  stepScript(vmHost(CTX, DBS, s, ev), frame);
  run(CTX, DBS, s, ev);
}
const power = (s: VmState, id: string): number => Number(attrsNow(CTX, DBS, s, id).power);
const pended = (s: VmState): string[] => s.pending.map((p) => `${s.cards[p.card].cardId}:${p.trigger}`).sort();

// A non-Saiyan KO'd, then a Saiyan the same turn: nothing pended at the first, exactly +5000 at the second.
{
  const s = game();
  const watch = stage(s, "T1120_WATCH");
  const other = stage(s, "T1120_OTHER");
  const saiyan = stage(s, "T1120_SAIYAN");
  const saiyan2 = stage(s, "T1120_SAIYAN");
  assert.equal(power(s, watch), 10000);
  const ev: GameEvent[] = [];
  const frame: ScriptFrame = { ops: [{ op: "ko", target: { var: "t" } }], ip: 0, vars: { t: [other] }, card: watch, master: "p1" };
  stepScript(vmHost(CTX, DBS, s, ev), frame);
  assert.deepEqual(pended(s), [], "a non-<Saiyan> KO is no trigger: nothing pended");
  run(CTX, DBS, s, ev);
  assert.deepEqual(s.cards[watch].usedThisTurn, [], "and the [Once per turn] is not used");
  assert.equal(power(s, watch), 10000);

  ko(s, saiyan, watch);
  assert.equal(power(s, watch), 15000, "the <Saiyan> KO gives exactly +5000");
  assert.deepEqual(s.cards[watch].usedThisTurn, [0]);

  ko(s, saiyan2, watch);
  assert.equal(power(s, watch), 15000, "a second <Saiyan> KO the same turn gives nothing more (once per turn)");
}

// Two Saiyans, nothing else: one +5000.
{
  const s = game();
  const watch = stage(s, "T1120_WATCH");
  const a = stage(s, "T1120_SAIYAN");
  const b = stage(s, "T1120_SAIYAN");
  ko(s, a, watch);
  ko(s, b, watch);
  assert.equal(power(s, watch), 15000, "two <Saiyan> KOs: one +5000");
}

// A KO'd Saiyan pends the Auto at the KO, before anything resolves.
{
  const s = game();
  const watch = stage(s, "T1120_WATCH");
  const a = stage(s, "T1120_SAIYAN");
  const ev: GameEvent[] = [];
  stepScript(vmHost(CTX, DBS, s, ev), { ops: [{ op: "ko", target: { var: "t" } }], ip: 0, vars: { t: [a] }, card: watch, master: "p1" });
  assert.deepEqual(pended(s), ["T1120_WATCH:yourCardKoed"]);
}

// An unfiltered "one of your Battle Cards is KO'd" is unchanged: it pends on any KO.
{
  const s = game();
  const watch = stage(s, "T1120_DRAW_ANY");
  const other = stage(s, "T1120_OTHER");
  const ev: GameEvent[] = [];
  stepScript(vmHost(CTX, DBS, s, ev), { ops: [{ op: "ko", target: { var: "t" } }], ip: 0, vars: { t: [other] }, card: watch, master: "p1" });
  assert.ok(pended(s).includes("T1120_DRAW_ANY:yourCardKoed"));
}

console.log("typed-ko-1120: ok");

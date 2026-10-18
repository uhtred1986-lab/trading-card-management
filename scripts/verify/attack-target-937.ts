/** #937: public card texts → persisted records → actual declaration / Blocker. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { declareAttack } from "../../src/lib/arena/vm/battle";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import { validateProgram } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const printed = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/937/cards.json", import.meta.url), "utf8")) as CardDef[];
const defs = { ...DEFS, ...Object.fromEntries(printed.map(d => [d.id, d])),
  BLANK937: card("BLANK937", { type: "LEADER", skill: "[Permanent] This card can't attack." }),
  LOW937: card("LOW937", { power: 10000 }),
  HIGH937: card("HIGH937", { power: 15000 }),
  BAD937: card("BAD937", { skill: "[Permanent] This card can't attack mysterious wobblers." }),
  CONDITIONAL937: card("CONDITIONAL937", { skill: "[Permanent] This card can't attack if it has 2 or fewer markers on it." }),
  TIMED937: card("TIMED937", { skill: "[Activate: Main] This card can't attack for the turn." }),
};
// Persist and reload every drafted field. These are programs from records,
// rather than runtime compilation; old compiler records are exercised too.
const rows = Object.values(defs).flatMap(d => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const leader = (s: VmState, p: PlayerId) => s.sides[p].zones.leader[0];
function take(s: VmState, action: Action, context = ctx): VmState { return RULES.apply(context, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId, flipped = false): VmState {
  let s = RULES.createGame(ctx, { seed: 937, p1: { name: "First", leader: "BT1-057", main: fifty("V1") }, p2: { name: "Second", leader: "BT1-057", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  s.cards[leader(s, player)].flipped = flipped;
  return s;
}
function stage(s: VmState, p: PlayerId, def = "V1", mode: "active" | "rest" = "rest"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, "battle", { owner: p }).ok); s.cards[id].mode = mode; return id;
}
function attacks(s: VmState, p: PlayerId, context = ctx) { return RULES.legalActions(context, s).filter(l => l.action.type === "attack" && l.action.player === p).map(l => l.action).filter((a): a is Extract<Action, { type: "attack" }> => a.type === "attack"); }
for (const p of ["p1", "p2"] as const) for (const flipped of [false, true]) {
  const s = fresh(p, flipped), opp = other(p), a = leader(s, p), target = leader(s, opp);
  const battle = stage(s, opp), blocker = stage(s, opp, "BLOCKER", "active");
  const list = attacks(s, p).filter(x => x.attacker === a);
  assert.ok(list.some(x => x.target === target), "Broly may declare an attack against a Leader, on either face/seat");
  assert.ok(!list.some(x => x.target === battle), "rested Battle Cards are excluded");
  assert.throws(() => take(s, { type: "attack", player: p, attacker: a, target: battle }));
  assert.throws(() => take(s, { type: "attack", player: p, attacker: a, target: "missing" }));
  assert.throws(() => take(s, { type: "attack", player: p, attacker: a } as Action));
  assert.throws(() => declareAttack(ctx, game, roundtrip(s), [], { type: "attack", player: p, attacker: "missing", target }, true));
  assert.ok(forbiddenBy(ctx, game, s, "attack", { player: p, card: a }), "missing target cannot establish legality");
  assert.ok(forbiddenBy(ctx, game, s, "attack", { player: p, card: a, attackTarget: "missing" }));
  const stale = roundtrip(s); stale.cards[target].cardId = "V1";
  assert.throws(() => declareAttack(ctx, game, stale, [], { type: "attack", player: p, attacker: a, target }, true), "offered actions revalidate target identity");
  const oldRows = roundtrip(rows).map(r => r.cardId === "BT1-057" && r.skillIndex === 0 ? { ...r, ops: [{ op: "forbid", what: "attack", until: "game", target: { sel: { special: "self" } } }] } : r) as RuleRow[];
  const oldCtx = { ...ctx, scripts: rulesFromRows(oldRows, defs) };
  assert.ok(!attacks(s, p, oldCtx).some(x => x.attacker === a), "exact historical blanket program reproduces the missing attack");
  let r = take(s, { type: "attack", player: p, attacker: a, target });
  // Broly's printed attack Autos ask both players for their discards first.
  for (let n = 0; n < 20 && r.prompt.kind !== "blocker"; n++) {
    const q = r.prompt;
    if (q.kind === "chooseCards") r = take(r, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, q.choice.min) });
    else if (q.kind === "orderPending") r = take(r, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") r = take(r, { type: "counter", player: q.player, card: null });
    else throw new Error(`unexpected ${q.kind}`);
  }
  assert.equal(r.prompt.kind, "blocker");
  r = take(r, { type: "block", player: opp, card: blocker });
  assert.equal(r.battle?.guard, blocker, "official FAQ: Blocker may redirect a legal Leader attack");
  const blanket = roundtrip(s); blanket.cards[a].cardId = "BLANK937"; blanket.cards[a].flipped = false;
  assert.ok(!attacks(blanket, p).some(x => x.attacker === a), "blanket can't attack remains blanket");
  const rested = roundtrip(s); rested.cards[a].mode = "rest";
  assert.ok(!attacks(rested, p).some(x => x.attacker === a));
}
// Shared filtering is not a Broly/type-only branch: power-qualified Battle
// targets and inverse Leader restrictions use the same declaration path.
{
  const s = fresh("p1");
  const a = stage(s, "p1", "BT1-023", "active"), low = stage(s, "p2", "LOW937"), high = stage(s, "p2", "HIGH937");
  const list = attacks(s, "p1").filter(x => x.attacker === a);
  assert.ok(list.some(x => x.target === low)); assert.ok(!list.some(x => x.target === high));
  assert.ok(list.some(x => x.target === leader(s, "p2")));
  assert.throws(() => take(s, { type: "attack", player: "p1", attacker: a, target: high }));
  assert.equal(take(s, { type: "attack", player: "p1", attacker: a, target: low }).battle?.guard, low);
}
{
  const s = fresh("p1"), a = stage(s, "p1", "DB3-085", "active"), target = stage(s, "p2");
  const list = attacks(s, "p1").filter(x => x.attacker === a);
  assert.ok(list.some(x => x.target === target)); assert.ok(!list.some(x => x.target === leader(s, "p2")));
}
for (const d of printed) for (const row of skillRecords(d).filter(r => r.printed.includes("cannot attack") || r.printed.includes("can't attack"))) {
  assert.deepEqual(row.unread, []); assert.ok(row.reads.includes("can't attack"));
  const op = row.ops[0]; assert.equal(op.op, "forbid"); if (op.op === "forbid") assert.ok(op.attackTarget);
}
{
  // An attacker condition is not a defender filter. #937 left it unread; #1005
  // reads it as what it is — a condition on this card, over a ban with no
  // defender at all.
  const cond = skillRecords(defs.CONDITIONAL937)[0];
  assert.deepEqual(cond.unread, []);
  // The record stores the condition beside the program, so `ops` is the ban.
  const op = cond.ops[0];
  assert.equal(op.op, "forbid");
  if (op.op === "forbid") assert.equal(op.attackTarget, undefined);
  assert.match(cond.reads, /^if this card has 2 or fewer markers: this card can't attack$/);
}
assert.ok(skillRecords(defs.BAD937)[0].unread.length, "unknown defenders stay unread");
assert.deepEqual(skillRecords(defs.TIMED937)[0].unread, [], "timed blanket attack bans remain supported");
assert.equal(validateProgram([{ op: "forbid", what: "play", until: "turn", attackTarget: {} }]), false);
console.log("#937 target-qualified attacks: stored row regression, both faces/seats, legal menu, forged/stale actions and Blocker passed");

/** R-402: explicitly named areas stay exact; BT7-094's free play excludes Unison. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileSkill, parseConditionClause, parseTarget } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { altCostFor } from "../../src/lib/arena/vm/costs";
import { condHolds, resolveSelector } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { run } from "../../src/lib/arena/vm/flow";
import type { Cond, ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTED = "[Blocker]<br>[Permanent] If there is a <Goku Black> card in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost.";
const defs: Record<string, CardDef> = {
  EA_LEADER: card("EA_LEADER", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  EA_NAMED_LEADER: card("EA_NAMED_LEADER", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, characters: ["Goku Black"] }),
  EA_FILLER: card("EA_FILLER", {}),
  EA_TARGET: card("EA_TARGET", { energyCost: 3, skill: PRINTED }),
  EA_NAMED: card("EA_NAMED", { characters: ["Goku Black"] }),
  EA_UNISON: card("EA_UNISON", { type: "UNISON", characters: ["Goku Black"] }),
};
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
const record = records.find(r => r.cardId === "EA_TARGET" && r.skillIndex === 10)!;
assert.ok(record); assert.equal(record.cond?.kind, "count");
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const generic = parseConditionClause("If you have a <Goku Black> card in play", true)!.cond;
for (const order of ["Battle Area or Leader Area", "Leader Area or Battle Area", "Battle Area and Leader Area", "Leader Area and Battle Area", "Battle Area and/or Leader Area"]) {
  const target = parseTarget(`up to 2 <Goku Black> cards in your ${order}`)!;
  assert.deepEqual([...target.areas!].sort(), ["battle", "leader"]); assert.equal(target.side, "you");
  const theirs = parseTarget(`up to 2 <Goku Black> cards in your opponent's ${order}`)!;
  assert.equal(theirs.side, "opponent"); assert.deepEqual([...theirs.areas!].sort(), ["battle", "leader"]);
  const condition = parseConditionClause(`If there is a <Goku Black> card in your ${order}`, true)!.cond;
  assert.equal(condition.kind, "count"); assert.ok(condition.kind === "count");
  assert.deepEqual([...condition.sel.areas!].sort(), ["battle", "leader"]);
  const selected = compileSkill(parseSkills(`[Activate: Main] Choose up to 2 <Goku Black> cards in your ${order} and switch them to Rest Mode.`)[0]);
  assert.deepEqual(selected.unsupported, []); assert.equal(selected.ops[0].op, "choose", "on-board unions do not become an off-board area-choice menu");
  assert.ok(selected.ops[0].op === "choose"); assert.deepEqual([...selected.ops[0].sel.areas!].sort(), ["battle", "leader"]);
}
const fresh = (first: PlayerId) => {
  let s = RULES.createGame(ctx, { seed: 402, p1: { name: "First", leader: "EA_LEADER", main: fifty("EA_FILLER") }, p2: { name: "Second", leader: "EA_LEADER", main: fifty("EA_FILLER") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: first === "p1" ? "p2" : "p1", redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = copy(RULES.apply(ctx, s, a).state as VmState);
  return s;
};
const stage = (s: VmState, owner: PlayerId, def: string, area: string) => {
  const id = s.sides[owner].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner }).ok);
  if (area === "unison") { s.cards[id].markers = 3; s.cards[id].mode = "active"; }
  s.pending = []; return id;
};
let scenarios = 0;
for (const owner of ["p1", "p2"] as const) for (const placement of ["leader", "battle", "unison", "energy", "hand", "opponentBattle", "opponentLeader", "none"]) {
  let s = fresh(owner); const other = owner === "p1" ? "p2" : "p1";
  const target = stage(s, owner, "EA_TARGET", "hand");
  if (placement === "leader" || placement === "opponentLeader") s.cards[s.sides[placement === "leader" ? owner : other].zones.leader[0]].cardId = "EA_NAMED_LEADER";
  else if (placement !== "none") stage(s, placement === "opponentBattle" ? other : owner, placement === "unison" ? "EA_UNISON" : "EA_NAMED", placement === "opponentBattle" ? "battle" : placement);
  s = copy(s);
  const should = placement === "leader" || placement === "battle";
  const frame: ScriptFrame = { card: target, master: owner, ops: [], ip: 0, vars: {} };
  assert.equal(condHolds(ctx, game, s, frame, record.cond as Cond), should, placement);
  assert.equal(condHolds(ctx, game, s, frame, generic), should || placement === "unison", "generic in-play scope is unchanged");
  assert.equal(altCostFor(ctx, game, s, target, owner, "play")?.pay === "none", should, "stored rule grants free play only from named areas");
  const action = RULES.legalActions(ctx, s).map(a => a.action).find(a => a.type === "play" && a.card === target);
  assert.equal(!!action, should, "without energy only the correctly scoped free play is legal");
  if (action) {
    s = RULES.apply(ctx, s, action).state as VmState;
    while (s.prompt.kind === "counter") s = RULES.apply(ctx, s, { type: "counter", player: s.prompt.player, card: null }).state as VmState;
    assert.ok(s.sides[owner].zones.battle.includes(target)); assert.equal(s.sides[owner].zones.energy.length, 0);
  }
  scenarios++;
}
// Explicit on-board pairs pool their cards, across both named areas only.
for (const owner of ["p1", "p2"] as const) {
  let s = fresh(owner); const leader = s.sides[owner].zones.leader[0]; s.cards[leader].cardId = "EA_NAMED_LEADER";
  const battle = stage(s, owner, "EA_NAMED", "battle"), unison = stage(s, owner, "EA_UNISON", "unison");
  const sel = parseTarget("up to 2 <Goku Black> cards in your Leader Area or Battle Area")!;
  const frame: ScriptFrame = { card: leader, master: owner, ops: [{ op: "choose", sel, as: "picked" }, { op: "switchMode", target: { var: "picked" }, mode: "rest" }], ip: 0, vars: {} };
  assert.deepEqual(resolveSelector(ctx, game, s, frame, sel).sort(), [leader, battle].sort());
  assert.ok(!resolveSelector(ctx, game, s, frame, sel).includes(unison));
  for (const pair of ["Leader Area or Unison Area", "Unison Area and Leader Area"]) {
    const explicit = parseTarget(`up to 2 <Goku Black> cards in your ${pair}`)!;
    assert.deepEqual(resolveSelector(ctx, game, s, frame, explicit).sort(), [leader, unison].sort());
  }
  s.programs.push(frame); run(ctx, game, s, []); assert.equal(s.prompt.kind, "chooseCards");
  for (const id of [leader, battle]) s = RULES.apply(ctx, copy(s), { type: "choose", player: owner, cards: [id] }).state as VmState;
  assert.equal(s.cards[leader].mode, "rest"); assert.equal(s.cards[battle].mode, "rest"); assert.equal(s.cards[unison].mode, "active");
  assert.equal(s.prompt.kind, "main"); scenarios++;
}
console.log(`explicit board areas 4: ${scenarios} stored-rule scenarios passed; both orders, seats, free play and pooled choices`);

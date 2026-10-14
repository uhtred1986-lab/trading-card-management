/**
 * #819's original premise is superseded by Bandai's 2019-11-01 errata:
 * https://www.dbs-cardgame.com/us-en/rule/errata-cards.php (BT5-119).
 * Official full front: https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT5-119&search=true
 * Owner selected the errata on 14 Oct 2026. The limit is 3, independently
 * of energy. The original dynamic wording remains unread; no stored record
 * is rewritten. Synthetic targets isolate type/area/cost on the real VM.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { canonical, parseRule, printRule, validateRule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { describeScript, stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";

const BEFORE = "[Permanent] This card gains ≪Desire≫ in all areas.<br>[Activate: Main] Your Leader Card is a ≪Shenron≫ card: Choose 1 Battle Card in your Drop Area with an energy cost less than or equal to your current energy and play it.";
const AFTER = BEFORE.replace("an energy cost less than or equal to your current energy", "an energy cost of 3 or less");
assert.equal(correctSkillText("BT5-119", BEFORE), AFTER);
assert.equal(correctSkillText("BT5-119", AFTER), AFTER, "the corrected source is idempotent");
assert.equal(correctSkillText("OTHER819", BEFORE), BEFORE, "this is official card-specific errata, not a generic rewriting rule");
assert.equal(correctSkillText("BT5-119", BEFORE.replaceAll(" ", "\n")), AFTER.replaceAll(" ", "\n").replace("an\nenergy\ncost\nof\n3\nor\nless", "an energy cost of 3 or less"), "catalog line breaks cannot evade the correction");

const defs = { ...DEFS,
  "BT5-119": card("BT5-119", { name: "World Peace", type: "EXTRA", colors: ["Black"], energyCost: 4, specifiedCost: {}, power: null, comboCost: null, comboPower: null, skill: correctSkillText("BT5-119", BEFORE) }),
  "LEADER819": card("LEADER819", { type: "LEADER", colors: ["Black"], traits: ["Shenron"], energyCost: null }),
  "COST2-819": card("COST2-819", { energyCost: 2 }),
  "COST3-819": card("COST3-819", { energyCost: 3 }),
  "COST4-819": card("COST4-819", { energyCost: 4 }),
  "EXTRA819": card("EXTRA819", { type: "EXTRA", energyCost: 1, power: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, a: Action) => RULES.apply(ctx, reload(s), a).state as VmState;
const candidates = (s: VmState) => s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
function stage(s: VmState, id: string, area: "hand" | "energy" | "drop", player: PlayerId = "p1"): string {
  const physical = s.sides[player].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: player }).ok);
  return physical;
}
function board(n: number, eligible = true, leader = "LEADER819") {
  let s = RULES.createGame(ctx, { seed: 819, p1: { name: "P1", leader, main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" });
  s = apply(s, { type: "mulligan", player: "p1", redraw: false });
  s = apply(s, { type: "mulligan", player: "p2", redraw: false });
  s = apply(s, { type: "charge", player: "p1", card: null });
  const source = stage(s, "BT5-119", "drop");
  const targets = eligible ? [stage(s, "COST2-819", "drop"), stage(s, "COST3-819", "drop")] : [];
  const excluded = [stage(s, "COST4-819", "drop"), stage(s, "EXTRA819", "drop"), stage(s, "COST3-819", "hand"), stage(s, "COST3-819", "drop", "p2")];
  const energy = Array.from({ length: n }, () => stage(s, "V1", "energy"));
  const mainFlow = structuredClone(s.flow);
  // The resolution frame is staged after activation/price. This covers zero
  // energy without claiming the cost-4 Extra can be normally activated free.
  const frame: ScriptFrame = { ops: skill.ops, ip: 0, master: "p1", card: source, vars: {}, skillIndex: 10 };
  const result = stepScript(vmHost(ctx, game, s, []), frame);
  return { s, source, targets, excluded, energy, result, mainFlow };
}

const skill = compileCard(defs["BT5-119"]).bySkill[10];
assert.deepEqual(skill.unsupported, [], "the complete official Activate line compiles");
assert.match(describeScript(skill.ops), /energy cost of 3 or less/);
assert.match(JSON.stringify(skill.price), /shenron/, "the printed Leader condition is preserved as a price");
assert.ok(compileCard({ ...defs["BT5-119"], skill: BEFORE }).bySkill[10].unsupported.length > 0, "raw historical current-energy wording stays unread");
const rule = { kind: "activate:main", trigger: [], cost: null, cond: null, ops: skill.ops };
const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok, JSON.stringify(parsed));
assert.equal(validateRule(parsed.value, rule.kind), null);
assert.deepEqual(canonical(parsed.value.ops), canonical(skill.ops), "the corrected bound survives the language");

for (const n of [0, 1, 3, 6]) for (const targetIndex of [0, 1]) {
  const b = board(n);
  assert.equal(b.result, "wait");
  assert.deepEqual(candidates(b.s), b.targets, `energy ${n}: costs 2/3 are legal; cost4 and non-Drop/non-Battle/foreign cards excluded`);
  assert.throws(() => apply(b.s, { type: "choose", player: "p1", cards: [] }));
  for (const id of b.excluded) assert.throws(() => apply(b.s, { type: "choose", player: "p1", cards: [id] }));
  // Energy changing between activation and this saved resolution choice
  // cannot change a fixed erratum into an energy-based bound.
  for (const id of b.energy) assert.ok(moveCard(b.s, game, id, "deck", { position: "bottom" }).ok);
  const done = apply(b.s, { type: "choose", player: "p1", cards: [b.targets[targetIndex]] });
  assert.ok(done.sides.p1.zones.battle.includes(b.targets[targetIndex]));
  assert.ok(done.sides.p1.zones.drop.includes(b.targets[1 - targetIndex]));
  assert.ok(done.sides.p1.zones.drop.includes(b.excluded[0]));
}
const empty = board(6, false);
assert.equal(empty.result, "done", "no eligible Drop card means no choice and no play (5-2-6)");
assert.deepEqual(empty.s.sides.p1.zones.battle, []);

// A normal cost-4 activation preserves the condition, moves the Extra to
// Drop, pays energy, and offers precisely the same fixed-bound selector.
{
  const b = board(4);
  b.s.flow = b.mainFlow; b.s.prompt = { kind: "main", player: "p1" };
  assert.ok(moveCard(b.s, game, b.source, "hand").ok);
  const active = RULES.legalActions(ctx, b.s).find((l) => l.action.type === "activate" && l.action.card === b.source);
  assert.ok(active, "the Shenron Leader permits World Peace");
  let s = apply(b.s, active.action);
  if (s.prompt.kind === "payCost") s = apply(s, { type: "payCost", player: "p1", option: 0 });
  assert.deepEqual(candidates(s), b.targets);
  assert.ok(s.sides.p1.zones.drop.includes(b.source));
  assert.ok(b.energy.every((id) => s.cards[id].mode === "rest"));
  s = apply(s, { type: "choose", player: "p1", cards: [b.targets[1]] });
  assert.ok(s.sides.p1.zones.battle.includes(b.targets[1]));
  const wrong = board(4, true, "L-RED");
  wrong.s.flow = wrong.mainFlow; wrong.s.prompt = { kind: "main", player: "p1" };
  assert.ok(moveCard(wrong.s, game, wrong.source, "hand").ok);
  assert.ok(!RULES.legalActions(ctx, wrong.s).some((l) => l.action.type === "activate" && l.action.card === wrong.source), "non-Shenron Leader refuses the activation");
}
console.log("  ok  #819 World Peace: official errata <=3, complete rule, current energy independent, Drop/type/condition, no eligible card");

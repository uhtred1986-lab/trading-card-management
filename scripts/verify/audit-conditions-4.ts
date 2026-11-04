/** Round 4 known misreads: RM 9-1-3, 20-1-3, 20-1-6, 2-10-4; R-380–R-383. */
import assert from "node:assert/strict";
import { skillRecords } from "../../src/lib/arena/draft";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { condHolds } from "../../src/lib/arena/vm/program";
import { run } from "../../src/lib/arena/vm/flow";
import { parseConditionClause } from "../../src/lib/arena/compile/conditions";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond, Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
const cases = [
  [
    "BT26-023",
    "[Activate: Battle][Limit 1]{r}, if your Leader's back side is a red <Super 17> card, you have 2 or more energy, and you have 1 or more <Android 17> card and 1 or more <Hell Fighter 17> card in your Combo Area: Play this card from your hand."
  ],
  [
    "P-468",
    "[Activate: Main][Limit 1] If your Leader is both a yellow <Vegeta> and <Trunks: Future> card and you discard this card from your hand: Choose up to 1 of your opponent's Battle Cards or Unisons with an energy cost of 2 or less and switch it to Rest Mode."
  ],
  [
    "BT19-063",
    "[activate: main][limit 1]{u}, if you have 3 or more energy and a player has a <Son Gohan: SH> card in play: Play this card from your hand."
  ],
  [
    "BT19-064",
    "[activate: main][limit 1]{u}, if you have 3 or more energy and a player has a <Piccolo: SH> card in play: Play this card from your hand."
  ],
  [
    "BT19-112",
    "[activate: main]{y}{y}{y}, if you have 4 or more energy and there are 2 <Lord Slug> cards with combo costs of 1 in your Z-Energy\u20151 with an energy cost of 3 and 1 with an energy cost of 5: Play this card from your hand."
  ],
  [
    "BT19-113",
    "[activate: main][limit 1]{y}{y}, if you have 3 or more energy and a <Lord Slug> card with an energy cost of 3 and combo cost of 1 in your Z-Energy: Play this card from your hand."
  ],
  [
    "BT19-080",
    "[auto] When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost of 6 or less, KO it, and this card gets +5000 power for the turn. Additionally, if you have at least 1 <Son Goku: Br> card and 1 <Vegeta: Br> card in your Z-Energy, draw 1 card."
  ],
  [
    "BT19-145",
    "[activate: main][once per turn] If you have 5 or more Z-Energy or 2 or more Z-Battle Cards in play: Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or more, ignoring [barrier], and place it at the bottom of its owner's deck."
  ]
];

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const recs = Object.fromEntries(cases.map(([id, text]) => {
  const rec = skillRecords(card(id, { skill: text }))[0];
  assert.deepEqual(rec.unread, [], `${id}: reads whole`);
  const rule = copy({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
  assert.equal(validateRule(rule, rec.kind), null, `${id}: valid stored rule`);
  const parsed = parseRule(printRule(rule));
  assert.ok(parsed.ok, `${id}: printable rule reparses`);
  if (parsed.ok) assert.equal(printRule(parsed.value), printRule(rule), `${id}: stable language round trip`);
  return [id, copy(rec)];
}));
const flat = (c: Cond): Cond[] => c.kind === "all" ? c.conds.flatMap(flat) : [c];
const control = flat(recs["BT26-023"].cond!);
assert.equal(control.length, 4, "BT26-023/024 control keeps leader, energy and both combo requirements");
assert.ok(control.some(c => c.kind === "leaderMatches" && c.back));
assert.deepEqual(control.filter(c => c.kind === "count").map(c => [c.sel.area, c.atLeast]), [["energy", 2], ["combo", 1], ["combo", 1]]);

const defs: Record<string, CardDef> = {
  ...DEFS,
  ...Object.fromEntries(cases.map(([id, skill]) => [id, card(id, { skill })])),
  AC4_BOTH: card("AC4_BOTH", { type: "LEADER", colors: ["Yellow"], characters: ["Vegeta", "Trunks: Future"] }),
  AC4_VEGETA: card("AC4_VEGETA", { type: "LEADER", colors: ["Yellow"], characters: ["Vegeta"] }),
  AC4_TRUNKS: card("AC4_TRUNKS", { type: "LEADER", colors: ["Yellow"], characters: ["Trunks: Future"] }),
  AC4_WRONG_COLOUR: card("AC4_WRONG_COLOUR", { type: "LEADER", colors: ["Blue"], characters: ["Vegeta", "Trunks: Future"] }),
  AC4_GOHAN: card("AC4_GOHAN", { characters: ["Son Gohan: SH"] }),
  AC4_PICCOLO: card("AC4_PICCOLO", { characters: ["Piccolo: SH"] }),
  AC4_SLUG3: card("AC4_SLUG3", { characters: ["Lord Slug"], energyCost: 3, comboCost: 1 }),
  AC4_SLUG5: card("AC4_SLUG5", { characters: ["Lord Slug"], energyCost: 5, comboCost: 1 }),
  AC4_SLUG0: card("AC4_SLUG0", { characters: ["Lord Slug"], energyCost: 3, comboCost: 0 }),
  AC4_GOKUBR: card("AC4_GOKUBR", { characters: ["Son Goku: Br"] }),
  AC4_VEGETABR: card("AC4_VEGETABR", { characters: ["Vegeta: Br"] }),
  AC4_Z: card("AC4_Z", { type: "Z-BATTLE" as CardDef["type"] }),
};
const rows = Object.values(defs).flatMap(d => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(copy(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
function fresh(): VmState {
  let s = RULES.createGame(ctx, { seed: 41, p1: { name: "First", leader: "L-BLUE", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const a of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
  ] as Action[]) s = copy(RULES.apply(ctx, s, a).state as VmState);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of [...s.sides[p].zones[area]]) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, def: string, area: string, p: PlayerId = "p1"): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const energy = (s: VmState, n: number) => { for (let i = 0; i < n; i++) stage(s, "V1", "energy"); };
const holds = (s: VmState, c: Cond) => condHolds(ctx, game, s, { ops: [], ip: 0, vars: {}, card: s.sides.p1.zones.leader[0], master: "p1" }, c);

// Both names are required on ONE yellow Leader. The discard-self price survives stored-row conversion.
assert.ok(recs["P-468"].cost, "P-468 retains a discard cost");
for (const leader of ["AC4_BOTH", "AC4_VEGETA", "AC4_TRUNKS", "AC4_WRONG_COLOUR"]) {
  const s = fresh();
  s.cards[s.sides.p1.zones.leader[0]].cardId = leader;
  const source = stage(s, "P-468", "hand");
  const yes = leader === "AC4_BOTH";
  assert.equal(holds(s, recs["P-468"].cond!), yes, `${leader}: both names and colour`);
  assert.equal(RULES.legalActions(ctx, s).some(l => l.action.type === "activate" && l.action.card === source), yes, `${leader}: actual hand activation admission`);
}

// Energy stays an unfiltered count; either player's Leader/Battle card qualifies, not Unison/hand/energy.
for (const [id, def] of [["BT19-063", "AC4_GOHAN"], ["BT19-064", "AC4_PICCOLO"]]) {
  for (const p of ["p1", "p2"] as const) for (const area of ["battle", "leader", "unison", "hand", "energy", "zEnergy"]) {
    const s = fresh(); energy(s, 3);
    if (area === "leader") s.cards[s.sides[p].zones.leader[0]].cardId = def;
    else stage(s, def, area, p);
    assert.equal(holds(s, recs[id].cond!), ["battle", "leader"].includes(area), `${id}: ${p} ${area}`);
  }
  const short = fresh(); energy(short, 2); stage(short, def, "battle");
  assert.equal(holds(short, recs[id].cond!), false, `${id}: two energy not enough`);
}

// Both Slug slots retain name, combo cost, exact energy cost and Z-Energy, separately from ordinary energy.
for (const [id, minimum] of [["BT19-112", 4], ["BT19-113", 3]] as const) {
  for (const [first, second, area, n, expected] of [
    ["AC4_SLUG3", "AC4_SLUG5", "zEnergy", minimum, true],
    ["AC4_SLUG3", "AC4_SLUG5", "zEnergy", minimum - 1, false],
    ["AC4_SLUG0", "AC4_SLUG5", "zEnergy", minimum, false],
    ["AC4_SLUG3", "AC4_SLUG5", "battle", minimum, false],
    ["AC4_SLUG3", "AC4_SLUG3", "zEnergy", minimum, id === "BT19-113"],
    ["AC4_SLUG5", "AC4_SLUG5", "zEnergy", minimum, false],
  ] as const) {
    const s = fresh(); energy(s, n); stage(s, first, area); stage(s, second, area);
    assert.equal(holds(s, recs[id].cond!), expected, `${id}: ${first}/${second} in ${area}, ${n} energy`);
  }
}

// Either bound is independent: 2 Z-Battle Cards suffice without 5 Z-Energy.
for (const [ze, zb, ordinary, expected] of [[0, 2, 0, true], [4, 1, 0, false], [5, 0, 0, true], [0, 0, 5, false]] as const) {
  const s = fresh();
  for (let i = 0; i < ze; i++) stage(s, "V1", "zEnergy");
  for (let i = 0; i < zb; i++) stage(s, "AC4_Z", "battle");
  for (let i = 0; i < ordinary; i++) stage(s, "V1", "battle");
  assert.equal(holds(s, recs["BT19-145"].cond!), expected, `BT19-145: ${ze}/${zb}/${ordinary}`);
}
const lesser = parseConditionClause("if your opponent has 1 or less energy or 2 or less cards in their hand");
assert.ok(lesser);
assert.equal(parseConditionClause("if a player has a {Named Unison} card in play"), null,
  "RM 20-1-6's character areas must not be imposed on a card name that could name a Unison");
// Whole-condition OR stays outside a preceding AND; a trailing shared Leader
// condition still applies to the whole pair of counted alternatives.
{
  const cond = parseConditionClause("if you have 3 or more energy and there is a <Son Goku> card in your Battle Area or your life is at 2 or less");
  assert.ok(cond);
  const s = fresh();
  while (s.sides.p1.zones.life.length > 2) moveCard(s, game, s.sides.p1.zones.life[0], "deck", { owner: "p1" });
  assert.equal(holds(s, cond.cond), true, "low life alone satisfies the outer alternative without energy");
  const shared = parseConditionClause("if you have 5 or more Z-Energy or 2 or more Z-Battle Cards in play and your Leader is red");
  assert.ok(shared);
  for (let i = 0; i < 5; i++) stage(s, "V1", "zEnergy");
  assert.equal(holds(s, shared.cond), false, "the shared red Leader condition still applies to the first alternative");
}
{
  const s = fresh(); stage(s, "V1", "energy", "p2"); stage(s, "V1", "energy", "p2");
  for (let i = 0; i < 3; i++) stage(s, "V1", "hand", "p2");
  assert.equal(holds(s, lesser.cond), false, "opponent alternative bounds both exceeded");
  const id = s.sides.p2.zones.hand[0]; moveCard(s, game, id, "deck", { owner: "p2" });
  assert.equal(holds(s, lesser.cond), true, "second less-than bound is two, not one");
}

// Official Q&A BT19-080: draw with both Z-Energy cards even when no opposing card can be KO'd.
// Execute the compiled program; no fabricated choice or KO-result gate may control the draw.
for (const [goku, vegeta, area, expected] of [[true, true, "zEnergy", 1], [true, false, "zEnergy", 0], [false, true, "zEnergy", 0], [false, false, "zEnergy", 0], [true, true, "battle", 0]] as const) {
  const s = fresh();
  const source = stage(s, "BT19-080", "battle");
  if (goku) stage(s, "AC4_GOKUBR", area);
  if (vegeta) stage(s, "AC4_VEGETABR", area);
  s.programs.push({ ops: copy(recs["BT19-080"].ops as Op[]), ip: 0, vars: {}, card: source, master: "p1" });
  run(ctx, game, s, []);
  assert.equal(s.sides.p1.zones.hand.length, expected, `BT19-080: ${goku}/${vegeta} in ${area}`);
  assert.equal(s.prompt.kind, "main", "draw never invents a Z-Energy choice");
}
console.log("  audit conditions 4: seven known misreads corrected; stored-language, activation and VM boundary checks pass");

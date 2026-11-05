/** R453: card energy, source Drop, then Extra Counter skill costs (12-2-2). */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs: Record<string, CardDef> = {
    BASE: card("BASE", { type: "LEADER", colors: ["Red"], traits: ["Universe 11"] }),
    FILLER: card("FILLER", { power: 10000 }),
    RED: card("RED", { colors: ["Red"] }),
    GREEN: card("GREEN", { colors: ["Green"] }),
    RED3: card("RED3", { type: "UNISON", colors: ["Red"], energyCost: 3, specifiedCost: { Red: 3 }, power: 20000 }),
    GREEN3: card("GREEN3", { type: "UNISON", colors: ["Green"], energyCost: 3, specifiedCost: { Green: 3 }, power: 20000 }),
};
defs["BT14-029"] = card("BT14-029", { type: "EXTRA", colors: ["Red"], energyCost: 0, skill: "[Counter: Attack][Spirit Boost X] If your Leader Card is mono-red: Choose up to 1 of your opponent's cards and it gets -5000 power for the turn. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 of your opponent's cards and it gets -5000 power for the turn for each marker you removed using this skill." });
defs["BT14-030"] = card("BT14-030", { type: "EXTRA", colors: ["Red"], energyCost: 1, skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) If your Leader Card is a red \u226aUniverse 11\u226b card: Negate the attack, add up to 1 red &lt;Jiren&gt; card with an [Evolve] skill and an energy cost of 5 or less from your deck to your hand, then shuffle your deck. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 red \u226aUniverse 11\u226b card with an energy cost of 1 in your Drop Area and play it in Rest Mode with its skills negated for the turn." });
defs["BT14-090"] = card("BT14-090", { type: "EXTRA", colors: ["Green"], energyCost: 1, skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) Negate the attack; if you removed a marker from your green Unison Card using this skill, play 1 Majin Token in Rest Mode. (Majin Tokens have 15000 power, 0 combo cost, and 5000 combo power.)<br>[Permanent] If one of your green Unison Cards is attacked, you may activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 card in your hand and discarding it." });
// Specified costs read from the official BT14-030/090 card images.
defs["BT14-030"].specifiedCost = { Red: 1 };
defs["BT14-090"].specifiedCost = { Green: 1 };
defs["BT7-024"] = card("BT7-024", { "type": "EXTRA", "name": "The Final Guardian", "colors": ["Red"], "specifiedCost": { "Red": 1 }, "energyCost": 1, "skill": "[Counter: Attack] If your Leader Card is red: Negate the attack, then choose up to 1 of your Battle Cards and it gets +5000 power for the duration of the turn.<br>[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 red card in your hand from the game.<br>[Auto] When you activate this card, you can't activate {The Final Guardian} for the duration of the turn." });
defs.GREENLEADER = card("GREENLEADER", { type: "LEADER", colors: ["Green"] });
defs.ANSWER = card("ANSWER", { type: "EXTRA", energyCost: 0, skill: "[Counter: Counter] Choose 1 of your opponent’s Unison Cards and place it in its owner’s Drop Area." });
defs.JIREN = card("JIREN", { colors: ["Red"], characters: ["Jiren"], energyCost: 5, skill: "[Evolve] {r}: <Jiren>." });
defs.U11 = card("U11", { colors: ["Red"], traits: ["Universe 11"], energyCost: 1, skill: "[Double Strike]" });
defs["BT11-148"] = card("BT11-148", {"type": "EXTRA", "colors": ["Black"], "name": "Rebellion Hammer", "skill": "[Counter: Play] If your Leader Card is black and you send 3 black cards from your Drop Area to your Warp: If the Battle Card being played has an energy cost of 4 or less, it is placed in its owner's Drop Area instead of being played.<br>[Permanent] If you have 12 or more black cards in your Warp, reduce the energy cost of this card in your hand by 1.", "energyCost": 2});
defs["DB2-062"] = card("DB2-062", {"type": "EXTRA", "colors": ["Blue"], "name": "Dirty Burst", "skill": "[counter: play] {u}: Draw 1 card; your opponent can't attack with Battle Cards with energy costs of 7 or more for the turn.<br>[counter: attack] Negate the attack.", "energyCost": 1});
defs["EB1-46"] = card("EB1-46", {"type": "EXTRA", "colors": ["Yellow"], "name": "Death Blaster", "skill": "[Counter: Play] If your Leader Card and all of your energy are mono-yellow and you send 2 mono-yellow Extra Cards with energy costs of 1 or more other than this card from your Drop Area to your Warp: The Battle Card being played is played in Rest Mode with its skills negated for the turn.", "energyCost": 2});
defs.BLACK = card("BLACK", { colors: ["Black"] });
defs.YELLOW = card("YELLOW", { colors: ["Yellow"] });
defs.BLUE = card("BLUE", { colors: ["Blue"] });
defs.YELLOWEXTRA = card("YELLOWEXTRA", { type: "EXTRA", colors: ["Yellow"], energyCost: 1 });
defs.BURST = card("BURST", { type: "EXTRA", energyCost: 0, skill: "[Counter: Attack][Burst 2] Negate the attack." });
defs.BOOST = card("BOOST", { type: "EXTRA", energyCost: 0, skill: "[Counter: Attack][Spirit Boost 1] Negate the attack." });
defs.HANDREDUCER = card("HANDREDUCER", { skill: "[Permanent] Reduce the skill cost of Extra Cards in your hand by {u}." });
defs.PHASE = card("PHASE", { type: "EXTRA", energyCost: 0, specifiedCost: {}, skill: "[Counter: Attack] {u}: Negate the attack." });
defs.MULTIBLUE = card("MULTIBLUE", { colors: ["Blue", "Red"] });
defs.GENERICSKILL = { ...defs["DB2-062"], id: "GENERICSKILL", specifiedCost: {} };
// Protocol variation separates generic card energy from the printed blue skill orb.
defs.TAX = card("TAX", { skill: "[Permanent] Your opponent can’t activate skills unless they send 1 card from their hand to their Warp each time." });
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const records = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(p: PlayerId) {
    let s = RULES.createGame(ctx, { seed: 450, p1: { name: "One", leader: "BASE", main: fifty("FILLER") }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER") } }).state as VmState;
    for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
        s = take(s, a);
    s.turn = 2;
    s.sides.p1.attrs.energyMarkers = 0;
    s.sides.p2.attrs.energyMarkers = 0;
    return s;
}
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
function setup(p: PlayerId, id: string, markers: number) {
    let s = fresh(other(p));
    const source = stage(s, p, id, "hand");
    const payer = markers ? stage(s, p, id === "BT14-090" ? "GREEN3" : "RED3", "unison") : undefined;
    if (payer)
        s.cards[payer].markers = markers;
    const energy = stage(s, p, id === "BT14-090" ? "GREEN" : id === "PHASE" ? "BLUE" : "RED", "energy");
    s.cards[energy].mode = "active";
    s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
    return { s, source, payer, energy };
}
let cases = 0;
for (const p of ["p1", "p2"] as const) for (const id of ["BT14-029", "BT14-030", "BT14-090", "BOOST", "BURST"]) {
  const start = setup(p, id, 3);
  const action: Action = { type: "counter", player: p, card: start.source, skill: 0, ...(id.startsWith("BT14") ? { x: 1 } : {}) };
  const result = RULES.apply(ctx, copy(start.s), action);
  const events = result.events;
  const sourceDrop = events.findIndex(e => e.type === "move" && e.card === start.source && e.to === "drop");
  const resource = events.findIndex(e => id === "BURST" ? e.type === "move" && e.from === "deck" && e.to === "drop" : e.type === "markers" && e.delta < 0);
  const activation = events.findIndex(e => e.type === "skill" && e.card === start.source);
  assert.ok(sourceDrop >= 0 && resource > sourceDrop && activation > resource, JSON.stringify(events));
  assert.equal(events.filter(e => e.type === "move" && e.card === start.source && e.to === "drop").length, 1);
  cases++;
}
function playWindow(p: PlayerId, id: string, color: string, drops: string[]) {
  let s = fresh(other(p));
  s.cards[s.sides[p].zones.leader[0]].cardId = "BASE";
  // Fixture Leader color is chosen to satisfy the actual printed payment.
  const leaderId = `LEADER_${color}`;
  defs[leaderId] ??= card(leaderId, { type: "LEADER", colors: [color as "Black"] });
  s.cards[s.sides[p].zones.leader[0]].cardId = leaderId;
  const source = stage(s, p, id, "hand");
  for (let i = 0; i < 2; i++) { const e = stage(s, p, color.toUpperCase(), "energy"); s.cards[e].mode = "active"; }
  const payers = drops.map(d => stage(s, p, d, "drop"));
  const incoming = stage(s, other(p), "FILLER", "hand");
  for (let i = 0; i < 2; i++) { const e = stage(s, other(p), "RED", "energy"); s.cards[e].mode = "active"; }
  s = take(s, { type: "play", player: other(p), card: incoming });
  return { s, source, payers, incoming };
}
for (const p of ["p1", "p2"] as const) {
  const start = playWindow(p, "BT11-148", "Black", ["BLACK", "BLACK"]);
  assert.equal(start.s.prompt.kind, "counter");
  let s = take(copy(start.s), { type: "counter", player: p, card: start.source, skill: 0 });
  // All three eligible Drop cards are forced here, including the source.
  const selected = [start.source, ...start.payers];
  for (const id of selected) {
    if (s.prompt.kind !== "chooseCards") break;
    assert.equal(s.prompt.kind, "chooseCards");
    if (s.prompt.kind !== "chooseCards") throw Error("price choice");
    assert.ok(s.prompt.choice.candidates.includes(id), "no 'other' restriction: source can pay its skill cost");
    s = take(copy(s), { type: "choose", player: p, cards: [id] });
  }
  assert.notEqual(s.outcome?.kind, "interrupted", JSON.stringify(s.outcome));
  assert.ok(s.sides[p].zones.warp.includes(start.source), "activation does not restage a source legitimately spent to Warp");
  assert.ok(s.sides[other(p)].zones.drop.includes(start.incoming));
  cases++;
  const bad = playWindow(p, "EB1-46", "Yellow", ["YELLOWEXTRA"]);
  assert.ok(!RULES.legalActions(ctx, bad.s).some(row => row.action.type === "counter" && row.action.card === bad.source), "printed 'other' cannot count the source after Drop");
  const good = playWindow(p, "EB1-46", "Yellow", ["YELLOWEXTRA", "YELLOWEXTRA"]);
  const g = take(good.s, { type: "counter", player: p, card: good.source, skill: 0 });
  if (g.prompt.kind === "chooseCards") assert.ok(!g.prompt.choice.candidates.includes(good.source));
  assert.ok(g.sides[p].zones.drop.includes(good.source));
  cases++;
}
// The existing timed alternative primitive models BT11-033's permission.
// Its complete printed skill still has an unrelated unread tail; this is an
// explicit cross-card payment protocol control, not a new support claim.
for (const p of ["p1", "p2"] as const) for (const blue of [0, 1]) {
  const start = playWindow(p, "DB2-062", "Blue", []);
  let s = start.s;
  for (const e of s.sides[p].zones.energy) s.cards[e].mode = "rest";
  if (blue) s.cards[s.sides[p].zones.energy[0]].mode = "active";
  const hand = [...s.sides[p].zones.hand].filter(id => id !== start.source);
  stepScript(vmHost(ctx, game, s, []), { ops: [{ op: "altCost", pay: "program", for: "counter", until: "turn", target: { var: "source" }, ops: [{ op: "choose", sel: { side: "you", area: "hand", count: 2 }, as: "discard" }, { op: "moveTo", target: { var: "discard" }, to: "drop" }] }], ip: 0, vars: { source: [start.source] }, card: s.sides[p].zones.leader[0], master: p });
  const offered = RULES.legalActions(ctx, s).some(row => row.action.type === "counter" && row.action.card === start.source && row.action.skill === 0 && row.action.alt);
  assert.equal(offered, blue > 0, "waiving card energy never waives the independent blue skill orb");
  if (blue) {
    s = take(copy(s), { type: "counter", player: p, card: start.source, skill: 0, alt: true });
    assert.ok(s.sides[p].zones.hand.includes(start.source));
    assert.equal(s.cards[s.sides[p].zones.energy[0]].mode, "active", "skill orb waits for completed energy alternative");
    for (const id of hand.slice(0, 2)) s = take(copy(s), { type: "choose", player: p, cards: [id] });
    assert.ok(s.sides[p].zones.drop.includes(start.source));
    assert.equal(s.cards[s.sides[p].zones.energy[0]].mode, "rest");
  }
  cases++;
}
for (const p of ["p1", "p2"] as const) for (const mode of ["filtered", "reload", "staleSkillEnergy"]) {
  const start = playWindow(p, "GENERICSKILL", "Blue", []);
  let s = start.s;
  const [red, blue] = s.sides[p].zones.energy;
  s.cards[red].cardId = "RED";
  const extraBlue = mode === "filtered" ? undefined : stage(s, p, "BLUE", "energy");
  if (extraBlue) { s.cards[extraBlue].mode = "active"; s.cards[extraBlue].cardId = "MULTIBLUE"; }
  s = take(s, { type: "counter", player: p, card: start.source, skill: 0, ...(extraBlue ? { pay: [red] } : {}) });
  assert.equal(s.cards[red].mode, "rest", "complete-cost filtering preserves the sole blue for the skill orb");
  if (mode === "filtered") assert.equal(s.cards[blue].mode, "rest");
  else {
    assert.equal(s.prompt.kind, "chooseMode", "post-Drop skill-energy has its own saved choice");
    assert.ok(s.sides[p].zones.drop.includes(start.source));
    assert.equal(s.cards[blue].mode, "active");
    if (mode === "staleSkillEnergy") {
      const frame = s.programs.find(f => f.counterCost?.extra?.choices)!;
      const id = frame.counterCost!.extra!.choices![0].payment.rest[0];
      moveCard(s, game, id, "hand", { owner: p }); moveCard(s, game, id, "energy", { owner: p });
      assert.throws(() => take(copy(s), { type: "chooseMode", player: p, index: 0 }));
    } else {
      const result = RULES.apply(ctx, copy(s), { type: "chooseMode", player: p, index: 0 });
      s = result.state as VmState;
      assert.equal(result.events.filter(e => e.type === "move" && e.card === start.source).length, 0, "resume does not repeat source placement");
      assert.equal([blue, extraBlue!].filter(id => s.cards[id].mode === "rest").length, 1);
    }
  }
  cases++;
}
for (const p of ["p1", "p2"] as const) for (const mode of ["success", "sourceReentry", "missingBinding", "missingChanged", "missingChild", "missingLegacy", "missingChildSource"]) {
  const start = setup(p, "BT14-029", 3);
  let s = start.s;
  stage(s, other(p), "TAX", "battle");
  s = take(s, { type: "counter", player: p, card: start.source, skill: 0, x: 1 });
  assert.equal(s.prompt.kind, "chooseCards", "tax follows completed printed costs");
  const gate = s.programs.find(f => f.taxGate)!;
  assert.equal(gate.taxGate!.counterExtraSource?.area, "drop");
  assert.equal(gate.taxGate!.counterExtraSource?.card, start.source);
  assert.equal(s.cards[start.payer!].markers, 2);
  if (s.prompt.kind !== "chooseCards") throw Error("tax prompt");
  const payer = s.prompt.choice.candidates[0];
  if (mode === "sourceReentry") { moveCard(s, game, start.source, "hand", { owner: p }); }
  if (mode === "missingBinding" || mode === "missingChanged") delete gate.taxGate!.counterExtraSource;
  if (mode === "missingChanged") s.cards[start.source].cardId = "FILLER";
  if (mode === "missingChild") delete s.programs.find(f => f.extraCounterTax)!.extraCounterTax;
  if (mode === "missingChildSource") delete (s.programs.find(f => f.extraCounterTax)!.extraCounterTax as { source?: unknown }).source;
  if (mode === "missingLegacy") {
    delete gate.taxGate!.counterExtraSource;
    delete s.programs.find(f => f.extraCounterTax)!.extraCounterTax;
    delete s.programs.find(f => f.counterCost?.extra)!.counterCost!.extra;
  }
  const result = RULES.apply(ctx, copy(s), { type: "choose", player: p, cards: [payer] });
  s = result.state as VmState;
  assert.equal(result.events.filter(e => e.type === "skill" && e.card === start.source).length, mode === "success" ? 1 : 0);
  if (mode === "sourceReentry") { assert.ok(s.sides[p].zones.hand.includes(start.source), "failed tax never moves a new source occurrence"); assert.ok(s.sides[p].zones.hand.includes(payer), "saved stale tax does not move its selected payer"); assert.equal(s.lastChoice, null); assert.equal(s.lastMode, null); }
  if (mode.startsWith("missing")) { assert.equal(s.outcome?.kind, "interrupted"); assert.ok(s.sides[p].zones.hand.includes(payer)); }
  cases++;
}
for (const p of ["p1", "p2"] as const) for (const energy of [false, true]) for (const modifier of ["standing", "timed"]) {
  const start = setup(p, "PHASE", 0);
  let s = start.s;
  s.cards[start.energy].cardId = "BLUE"; s.cards[start.energy].mode = energy ? "active" : "rest";
  if (modifier === "standing") stage(s, p, "HANDREDUCER", "battle");
  else stepScript(vmHost(ctx, game, s, []), { ops: [{ op: "costReduction", target: { var: "source" }, amount: 1, colors: ["Blue"], what: "skill", until: "turn" }], ip: 0, vars: { source: [start.source] }, card: s.sides[p].zones.leader[0], master: p });
  assert.deepEqual(ctx.scripts!["HANDREDUCER"].bySkill[0].unsupported, []);
  assert.equal(RULES.legalActions(ctx, s).some(row => row.action.type === "counter" && row.action.card === start.source), energy, "hand-only reduction resets on placement before determining skill cost");
  if (energy) {
    s = take(s, { type: "counter", player: p, card: start.source, skill: 0 });
    assert.equal(s.cards[start.energy].mode, "rest");
  }
  cases++;
}
for (const p of ["p1", "p2"] as const) for (const damage of ["otherCopy", "definition", "missingSkill", "changedX", "missingBinding"]) {
  const start = setup(p, "BT14-030", 3);
  let s = start.s;
  s.sides[p].attrs.energyMarkers = 1;
  const twin = stage(s, p, "BT14-030", "hand");
  s = take(s, { type: "counter", player: p, card: start.source, skill: 0, x: 1 });
  assert.equal(s.prompt.kind, "payCost");
  if (s.prompt.kind !== "payCost" || s.prompt.action.type !== "counter") throw Error("payment prompt");
  if (damage === "otherCopy") s.prompt.action.card = twin;
  if (damage === "definition") s.cards[start.source].cardId = "FILLER";
  if (damage === "missingSkill") delete s.prompt.action.skill;
  if (damage === "changedX") s.prompt.action.x = 2;
  if (damage === "missingBinding") delete s.prompt.extraCounter;
  const before = copy(s);
  assert.throws(() => take(s, { type: "payCost", player: p, option: 0 }));
  assert.deepEqual(copy(s), before);
  cases++;
}
console.log(`Extra Counter phase order5: ${cases} cases passed`);

/** #917: BT19-077/078/081/082 print "[Permanent] This card's [EX-Evolve] can also be activated from your Z-Energy."
 * Real compiled records, real VM, both seats. The Q&A basis: card FAQ on BT19-077 Q1 ("you can activate [EX-Evolve] on this card
 * while it is in your Z-Energy and then play it on top of the target card in the Battle Area"); manual 22-5-3/22-5-5 for the
 * ordinary semantics; 22-5-4's hand-only default is what the printed Permanent overrides, for the evolving card's source only.
 * Runtime fixtures project only the EX-Evolve line and the Permanent, the complete lines the issue verified. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler, skillRecords } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { VmState } from "../../src/lib/arena/vm/state";
import { findCard, moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { answerFor, resolveAnswer } from "../../src/lib/arena/policy/contract";

const PERMANENT = "[Permanent] This card's [EX-Evolve] can also be activated from your Z-Energy.";
const line = (limit: string, cost: string) => `[EX-Evolve]${limit}{g}, draw 1 card: Green <${cost}> with an energy cost of`;
// id, evolving character, base character, the printed base-cost ceiling
const FOUR = [
  ["BT19-077", "Son Goku: Br", 3], ["BT19-078", "Son Goku: Br", 2], ["BT19-081", "Vegeta: Br", 3], ["BT19-082", "Vegeta: Br", 2],
] as const;
const defs: Record<string, CardDef> = { ...DEFS,
  "L-GREEN": { ...DEFS["L-BLUE"], id: "L-GREEN", colors: ["Green"] },
  "V917-G": card("V917-G", { colors: ["Green"] }),
  ...Object.fromEntries(FOUR.map(([id, who, max]) => [id, card(id, { colors: ["Green"], characters: [who], energyCost: 6, power: 35000,
    skill: `${line("[Limit 1]", who)} ${max} or less.<br>${PERMANENT}` })])),
  // The same EX-Evolve line without the Permanent: hand-only, as 22-5-4 says.
  "E917-NO": card("E917-NO", { colors: ["Green"], characters: ["Son Goku: Br"], energyCost: 6, skill: `${line("[Limit 1]", "Son Goku: Br")} 3 or less.` }),
  "E917-ENERGY": card("E917-ENERGY", { colors: ["Green"], characters: ["Son Goku: Br"], energyCost: 6, skill: `${line("[Limit 1]", "Son Goku: Br")} 3 or less.<br>${PERMANENT}<br>[Permanent] When using this card's [Evolve] skill from your hand, you can choose Battle Cards from your energy and play this card in Active Mode.` }),
  "E917-BASE": card("E917-BASE", { colors: ["Green"], characters: ["Son Goku: Br"], energyCost: 2, power: 10000 }),
  "E917-VBASE": card("E917-VBASE", { colors: ["Green"], characters: ["Vegeta: Br"], energyCost: 2, power: 10000 }),
  "E917-WITNESS": card("E917-WITNESS", { colors: ["Green"], characters: ["Son Goku: Br"], energyCost: 6, skill: `${line("", "Son Goku: Br")} 3 or less.<br>${PERMANENT}<br>[Auto] When this card is played, draw 1 card.<br>[Auto] When a card evolves into this card, draw 1 card.<br>[Auto] When you use this card's [Evolve] skill from your hand, draw 1 card.` }),
  "E917-PLACED": card("E917-PLACED", { colors: ["Green"], characters: ["Son Goku: Br"], energyCost: 2, skill: "[Auto] When this card is placed in a Battle Area, draw 1 card." }),
  "E917-COUNTER": card("E917-COUNTER", { type: "EXTRA", colors: ["Green"], energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played." }),
  "E917-REST": card("E917-REST", { type: "EXTRA", colors: ["Green"], energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card being played is played in Rest Mode." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const clone = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area];
const events: GameEvent[] = [];
let counterAnswers = 0;
function take(s: VmState, action: Action): VmState {
  if (action.type === "counter") counterAnswers++;
  const out = RULES.apply(ctx, clone(s), action); events.push(...out.events); return out.state as VmState; // every step reloads through JSON
}
function fresh(p: PlayerId = "p1"): VmState {
  let s = RULES.createGame(ctx, { seed: 917, p1: { name: "P1", leader: "L-GREEN", main: fifty("V-BLUE") }, p2: { name: "P2", leader: "L-GREEN", main: fifty("V-BLUE") } }).state as VmState;
  s = take(s, { type: "chooseFirst", player: s.chooser, first: p });
  for (let n = 0; n < 20 && s.prompt.kind !== "main"; n++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  s.sides.p1.attrs.energyMarkers = 0; s.sides.p2.attrs.energyMarkers = 0;
  events.length = 0; counterAnswers = 0; return s;
}
function stage(s: VmState, cardId: string, area: string, p: PlayerId = "p1"): string {
  const id = zone(s, p, "deck")[0]; assert.ok(id); s.cards[id].cardId = cardId;
  if (area !== "deck") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  return id;
}
function legal(s: VmState, id: string) { return RULES.legalActions(ctx, s).find(({ action }) => action.type === "activate" && action.card === id); }
function finish(s: VmState, preferred?: string): VmState {
  for (let n = 0; n < 70 && s.prompt.kind !== "main"; n++) {
    const p = s.prompt;
    if (p.kind === "payCost") s = take(s, { type: "payCost", player: p.player, option: 0 });
    else if (p.kind === "chooseCards") {
      const pick = preferred && p.choice.candidates.includes(preferred) ? [preferred] : p.choice.candidates.slice(0, p.choice.min || Math.min(1, p.choice.max));
      s = take(s, { type: "choose", player: p.player, cards: pick });
    } else if (p.kind === "counter") s = take(s, { type: "counter", player: p.player, card: null });
    else if (p.kind === "chooseMode") s = take(s, { type: "chooseMode", player: p.player, index: 0 });
    else if (p.kind === "orderPending") s = take(s, { type: "orderPending", player: p.player, index: 0 });
    else if (p.kind === "combo") s = take(s, { type: "pass", player: p.player });
    else if (p.kind === "zEnergyFromCombo") s = take(s, { type: "zEnergyFromCombo", player: p.player, card: null });
    else throw new Error(`unexpected ${p.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); return s;
}
function privacy(s: VmState): void {
  for (const viewer of ["p1", "p2"] as const) {
    const out = JSON.stringify(buildSnapshot({ id: 917, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: clone(s), legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
    const opponent = viewer === "p1" ? "p2" : "p1";
    for (const id of zone(s, opponent, "hand")) assert.ok(!out.includes(`"${id}"`), "opponent hand identities remain hidden");
    const turn = policyTurn({ ctx, state: clone(s), beats: null, art: {}, names: { p1: "P1", p2: "P2" } }, viewer, 917);
    const wire = JSON.stringify(turn.input);
    for (const id of zone(s, opponent, "hand")) assert.ok(!wire.includes(`"${id}"`), "policy observation also hides the opposing hand");
    for (const decision of turn.input.decisions.decisions.filter((d) => d.kind === "menu")) {
      const roundTrip = resolveAnswer(turn.key, answerFor(turn.input.decisions, decision.id));
      assert.ok(roundTrip.ok && roundTrip.actions.length === 1);
      assert.ok(RULES.legalActions(ctx, s).some((l) => JSON.stringify(l.action) === JSON.stringify(roundTrip.actions[0])), "policy menu resolves to a current legal engine action");
    }
  }
}
/** One green orb in energy plus a deck to draw from: the printed {g}, draw 1 card. */
function pay(s: VmState, p: PlayerId = "p1"): string { return stage(s, "V917-G", "energy", p); }

// 1. The complete Permanent compiles to one generic, self-scoped permission on all four cards; nothing hardcoded by id.
for (const [id] of FOUR) {
  const rows = skillRecords(defs[id]);
  const perm = rows.filter((r) => r.kind.toLowerCase() === "permanent");
  assert.equal(perm.length, 1, `${id}: one Permanent`);
  assert.deepEqual(perm[0].unread, [], `${id}: read in full`);
  assert.deepEqual(perm[0].ops, [{ op: "permit", what: "evolveFromZEnergy", target: { sel: { special: "self" } }, until: "game" }]);
  assert.ok(perm[0].reads.includes("Z-Energy") && perm[0].reads.includes("base is still chosen in the Battle Area"), `${id}: reads as a source-area-only extension`);
  assert.ok(!perm[0].reads.includes("Active Mode"));
  const evolve = rows.find((r) => /evolve/i.test(r.printed ?? "") && r.kind.toLowerCase() !== "permanent");
  assert.ok(evolve, `${id}: the EX-Evolve line is still its own record`);
}

// 2. Both seats, both source areas: offered, paid (one green orb + draw 1, once), stacked on a Battle-Area base.
for (const [id, who, max] of FOUR) for (const p of ["p1", "p2"] as const) for (const source of ["zEnergy", "hand"] as const) for (const mode of ["active", "rest"] as const) {
  const s0 = fresh(p); const evo = stage(s0, id, source, p); const base = stage(s0, who === "Son Goku: Br" ? "E917-BASE" : "E917-VBASE", "battle", p);
  s0.cards[base].mode = mode; const orb = pay(s0, p);
  addEffect(s0, [], { source: base, target: base, kind: "power", value: 5000, until: "turn" });
  const handBefore = zone(s0, p, "hand").length - (source === "hand" ? 1 : 0), deckBefore = zone(s0, p, "deck").length;
  const a = legal(s0, evo); assert.ok(a,`${id} ${p}: offered from ${source} over a ${mode} Battle-Area base (cost <= ${max})`);
  let s = take(clone(s0), a.action);
  privacy(s);
  s = finish(s, base);
  assert.equal(findCard(s, evo)?.zone, "battle", "the card ends in the Battle Area"); assert.deepEqual(s.cards[evo].under, [base]);
  assert.ok(!zone(s, p, "zEnergy").includes(evo), "it has left the Z-Energy");
  assert.equal(s.cards[evo].mode, mode, "ordinary Evolve: the base's position carries (no Active Mode override)");
  assert.equal(attrsNow(ctx, game, s, evo).power, 35000 + 5000, "the base's power effect transfers");
  assert.equal(s.cards[orb].mode, "rest", "the green orb was paid");
  assert.equal(zone(s, p, "hand").length, handBefore + 1, "draw 1 card is a cost: exactly one card, not two");
  assert.equal(zone(s, p, "deck").length, deckBefore - 1);
  assert.equal(s.sides[p].limitUses?.[`${id}#0`] ?? Object.values(s.sides[p].limitUses ?? {})[0], 1, "Limit 1 spent once");
  privacy(s);
}

// 3. Refusals: nothing the Permanent says relaxes a base or payment gate; and the permission is the card's own.
for (const change of ["type", "color", "character", "cost", "controller", "area", "payment-orb", "payment-deck", "permission", "other-owner", "energy-only"] as const) for (const p of ["p1", "p2"] as const) {
  const s = fresh(p); const o: PlayerId = p === "p1" ? "p2" : "p1";
  const evo = stage(s, change === "permission" ? "E917-NO" : "BT19-077", "zEnergy", change === "other-owner" ? o : p);
  const bad = `E917-BAD-${change}`;
  defs[bad] = { ...defs["E917-BASE"], id: bad, ...(change === "type" ? { type: "EXTRA" as const } : {}), ...(change === "color" ? { colors: ["Red"] } : {}), ...(change === "character" ? { characters: ["Vegeta: Br"] } : {}), ...(change === "cost" ? { energyCost: 4 } : {}) };
  stage(s, bad, change === "area" ? "drop" : change === "energy-only" ? "energy" : "battle", change === "controller" ? o : p);
  if (change !== "payment-orb") pay(s, p);
  if (change === "payment-deck") { for (const id of zone(s, p, "deck").slice()) assert.ok(moveCard(s, game, id, "drop", { owner: p }).ok); }
  assert.equal(legal(s, evo), undefined, `${p} ${change}: refused`);
  privacy(s);
}
// The same board with a valid base is offered, so each refusal above is about its one change.
{ const s = fresh(); const evo = stage(s, "BT19-077", "zEnergy"); stage(s, "E917-BASE", "battle"); pay(s); assert.ok(legal(s, evo)); }
// A cost-3 base is fine for BT19-077/081 and refused for the "or less 2" cards: the printed bound is per card.
for (const [id, who, max] of FOUR) {
  const s = fresh(); const evo = stage(s, id, "zEnergy"); const bid = `E917-COST3-${id}`;
  defs[bid] = { ...defs["E917-BASE"], id: bid, characters: [who], energyCost: 3 }; stage(s, bid, "battle"); pay(s);
  assert.equal(!!legal(s, evo), max >= 3, `${id}: base of cost 3 vs printed bound ${max}`);
}
// Character identity, not a name substring: a Son Goku: Br evolving card does not take a Vegeta: Br base and vice versa.
for (const [id, who] of FOUR) {
  const s = fresh(); const evo = stage(s, id, "zEnergy"); stage(s, who === "Son Goku: Br" ? "E917-VBASE" : "E917-BASE", "battle"); pay(s);
  assert.equal(legal(s, evo), undefined, `${id}: the other character is no base`);
}

// 4. Source and base permission are independent: Z-Energy does not give an energy base or Active Mode; the Great-Ape-style
// energy-base permission does not give a Z-Energy source.
{
  const s = fresh(); const evo = stage(s, "E917-ENERGY", "zEnergy"); const base = stage(s, "E917-BASE", "energy"); pay(s);
  assert.equal(legal(s, evo), undefined, "an energy base is permitted only from the hand copy that prints it (22-5-3-1)");
  const bb = stage(s, "E917-BASE", "battle"); assert.ok(legal(s, evo), "the Battle-Area base is still fine from Z-Energy"); void base; void bb;
  const t = fresh(); const e2 = stage(t, "E917-ENERGY", "hand"); stage(t, "E917-BASE", "energy"); pay(t); assert.ok(legal(t, e2), "that card's own hand + energy-base path is unchanged");
  const u = fresh(); const e3 = stage(u, "E917-NO", "zEnergy"); stage(u, "E917-BASE", "battle"); pay(u); assert.equal(legal(u, e3), undefined, "no printed permission: Z-Energy is not a source");
}
// A rested Battle-Area base is not turned Active by a Z-Energy source (checked with a witness above too).
// Other areas stay refused even with the Permanent: only hand and Z-Energy.
for (const area of ["drop", "deck", "energy", "warp", "life", "battle"] as const) {
  const s = fresh(); const evo = stage(s, "BT19-077", area); stage(s, "E917-BASE", "battle"); pay(s);
  assert.equal(legal(s, evo), undefined, `${area}: still not a source`);
}
// The Permanent only counts for its own master's Z-Energy copy.
{ const s = fresh(); stage(s, "BT19-077", "zEnergy", "p2"); const mine = stage(s, "BT19-077", "hand"); stage(s, "E917-BASE", "battle"); pay(s); assert.ok(legal(s, mine)); assert.ok(!RULES.legalActions(ctx, s).some(({ action }) => action.type === "activate" && zone(s, "p2", "zEnergy").includes(action.card))); }

// 5. Limit 1 across copies and areas is not bypassed.
for (const order of [["zEnergy", "hand"], ["hand", "zEnergy"], ["zEnergy", "zEnergy"]] as const) {
  let s = fresh(); const a = stage(s, "BT19-077", order[0]); const b = stage(s, "BT19-077", order[1]);
  stage(s, "E917-BASE", "battle"); stage(s, "E917-BASE", "battle"); pay(s); pay(s);
  s = finish(take(s, legal(s, a)!.action));
  assert.equal(findCard(s, a)?.zone, "battle");
  assert.equal(legal(s, b), undefined, `${order.join("+")}: the second copy shares the master's [Limit 1] this turn`);
}

// 6. Source-aware hooks: the from-hand moment is not announced for a Z-Energy use; play/evolved Autos still fire; ordinary from-hand still does.
for (const source of ["zEnergy", "hand"] as const) {
  let s = fresh(); const top = stage(s, "E917-WITNESS", source); stage(s, "E917-BASE", "battle"); pay(s);
  const before = zone(s, "p1", "hand").length - (source === "hand" ? 1 : 0);
  s = finish(take(s, legal(s, top)!.action));
  const skills = events.filter((e) => e.type === "skill" && e.card === top && e.skill !== 0).length;
  assert.equal(skills, source === "hand" ? 3 : 2, `${source}: played + evolved-into fire, from-hand only from the hand`);
  assert.equal(zone(s, "p1", "hand").length, before + 1 + skills, "the cost draws once and each Auto draws once");
}

// 7. Failure, counter and base-validity boundaries all survive JSON reloads (take() reloads every step).
for (const outcome of ["success", "missing", "changed", "countered", "rest-counter"] as const) {
  let s = fresh(); const top = stage(s, "BT19-077", "zEnergy"); const base = stage(s, "E917-BASE", "battle"); pay(s);
  const counter = stage(s, outcome === "rest-counter" ? "E917-REST" : "E917-COUNTER", "hand", "p2");
  s = take(s, legal(s, top)!.action);
  for (let n = 0; n < 6 && s.prompt.kind !== "counter"; n++) {
    privacy(s);
    s = s.prompt.kind === "payCost" ? take(s, { type: "payCost", player: "p1", option: 0 }) : take(s, { type: "choose", player: "p1", cards: [base] });
  }
  assert.equal(s.prompt.kind, "counter"); assert.equal(findCard(s, top)?.zone, "zEnergy", "still in Z-Energy while the counter window is open");
  if (outcome === "missing") vmHost(ctx, game, s, events).move(base, "drop", "p1", { reason: "effect" });
  if (outcome === "changed") s.cards[base].cardId = "V-BLUE";
  s = finish(take(s, { type: "counter", player: "p2", card: outcome === "countered" || outcome === "rest-counter" ? counter : null }));
  assert.equal(counterAnswers, 1, "the normal new-card counter window, once");
  const where = findCard(s, top)?.zone;
  if (outcome === "success") assert.equal(where, "battle");
  if (outcome === "rest-counter") { assert.equal(where, "battle"); assert.equal(s.cards[top].mode, "rest", "Counter: Play mode replacement keeps priority"); }
  if (outcome === "countered") assert.equal(where, "hand", "the counter's own instruction decides where it goes");
  if (outcome === "missing" || outcome === "changed") assert.equal(where, "drop", "22-5-5-1 / 22-5-7: failed Evolve puts the unmoved card in its owner's Drop");
  assert.equal(s.resolving, null); privacy(s);
}

// 8. The Z-Energy count is a real resource elsewhere: an evolving card leaving Z-Energy shrinks it for the Z-cost payers.
{
  let s = fresh(); const top = stage(s, "BT19-077", "zEnergy"); const other = stage(s, "V-BLUE", "zEnergy"); stage(s, "E917-BASE", "battle"); pay(s);
  s = finish(take(s, legal(s, top)!.action));
  assert.deepEqual(zone(s, "p1", "zEnergy"), [other], "only the evolving card left the Z-Energy");
}

// 9. Not the Great-Ape bases: the existing six-seven-card behaviour is unaffected (covered by energy-evolve-913); the permit is inert from hand.
{ const s = fresh(); const evo = stage(s, "BT19-077", "hand"); stage(s, "E917-BASE", "battle"); pay(s); assert.ok(legal(s, evo), "hand activation is unchanged"); }

console.log("z-evolve-917: four Permanents, Z-Energy source, both seats and sources, gates, Limit 1, source-aware hooks and boundaries passed");

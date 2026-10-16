/** #913: complete public Permanents, real keyword payments and named FAQ bases.
 * Runtime top-card projections intentionally omit unrelated skills; this proves
 * the shared evolution capability, not whole-card/deck playability. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty, rulesFromCompiler, skillRecords, parseSkills } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { VmState } from "../../src/lib/arena/vm/state";
import { findCard, moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { run } from "../../src/lib/arena/vm/flow";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { answerFor, resolveAnswer } from "../../src/lib/arena/policy/contract";

const printed = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/913/cards.json", import.meta.url), "utf8")) as CardDef[];
const targets = printed.slice(0, 7);
const permission = "When using this card's [Evolve] skill from your hand, you can choose Battle Cards from your energy and play this card in Active Mode.";
const project = (d: CardDef): CardDef => ({ ...d, skill: parseSkills(d.skill).filter((sk) => sk.keyword?.name === "Evolve" || (sk.kind === "permanent" && /when using this card/i.test(sk.effect))).map((sk) => sk.raw).join("<br>") });
for (const d of targets) {
  const rows = skillRecords(d).filter((r) => r.kind.toLowerCase() === "permanent");
  assert.equal(rows.length, 1, `${d.id}: the complete shared Permanent`);
  assert.deepEqual(rows[0].unread, []);
  assert.deepEqual(rows[0].ops, [{ op: "permit", what: "evolveEnergyBases", target: { sel: { special: "self" } }, until: "game" }]);
  assert.ok(rows[0].reads.includes("from hand") && rows[0].reads.includes("Active Mode"));
}
const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(printed.map((d, i) => [d.id, i < 7 ? project(d) : d])),
  "L-BLUE": { ...DEFS["L-BLUE"], traits: ["Saiyan", "Bardock's Crew"] },
  "E913-BASE": card("E913-BASE", { colors: ["Blue"], characters: ["Bardock"], energyCost: 2 }),
  "E913-NO": card("E913-NO", { colors: ["Blue"], skill: "[EX-Evolve]{u}{u}: Blue <Bardock> with an energy cost of 2 or more." }),
  "E913-WITNESS": card("E913-WITNESS", { colors: ["Blue"], skill: `[EX-Evolve]{u}{u}: Blue <Bardock> with an energy cost of 2 or more.<br>[Permanent] ${permission}<br>[Auto] When this card is played, draw 1 card.<br>[Auto] When a card evolves into this card, draw 1 card.<br>[Auto] When using this card's [Evolve] from your hand, draw 1 card.` }),
  "E913-CREW": card("E913-CREW", { colors: ["Blue"], traits: ["Bardock's Crew"] }),
  "E913-DUAL": card("E913-DUAL", { colors: ["Blue", "Red"] }),
  "E913-NAPPA": card("E913-NAPPA", { colors: ["Blue"], characters: ["Nappa: Adolescence"], energyCost: 2 }),
  "E913-PLACED": card("E913-PLACED", { colors: ["Blue"], characters: ["Bardock"], energyCost: 2, skill: "[Auto] When this card is placed in a Battle Area, draw 1 card." }),
  "E913-WATCHER": card("E913-WATCHER", { colors: ["Blue"], skill: "[Auto] When a card is placed in your Battle Area, draw 1 card." }),
  "E913-UNISON": card("E913-UNISON", { type: "UNISON", colors: ["Blue"], power: 10000 }),
  "E913-COUNTER": card("E913-COUNTER", { type: "EXTRA", colors: ["Blue"], energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played." }),
  "E913-REST": card("E913-REST", { type: "EXTRA", colors: ["Blue"], energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card being played is played in Rest Mode." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const clone = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area];
const events: GameEvent[] = [];
let counterAnswers = 0;
function take(s: VmState, action: Action): VmState {
  if (action.type === "counter") counterAnswers++;
  const out = RULES.apply(ctx, clone(s), action); events.push(...out.events); return out.state as VmState;
}
function fresh(p: PlayerId = "p1"): VmState {
  let s = RULES.createGame(ctx, { seed: 913, p1: { name: "P1", leader: "L-BLUE", main: fifty("V-BLUE") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
function finish(s: VmState, preferred?: string, payWith?: string): VmState {
  for (let n = 0; n < 70 && s.prompt.kind !== "main"; n++) {
    const p = s.prompt;
    if (p.kind === "payCost") {
      const option = payWith ? p.options.findIndex((o) => o.rest.includes(payWith)) : 0;
      assert.ok(option >= 0); s = take(s, { type: "payCost", player: p.player, option });
    } else if (p.kind === "chooseCards") {
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
    const out = JSON.stringify(buildSnapshot({ id: 913, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: clone(s), legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
    const opponent = viewer === "p1" ? "p2" : "p1";
    for (const id of zone(s, opponent, "hand")) assert.ok(!out.includes(`\"${id}\"`), "opponent hand identities remain hidden");
    const turn = policyTurn({ ctx, state: clone(s), beats: null, art: {}, names: { p1: "P1", p2: "P2" } }, viewer, 913);
    const wire = JSON.stringify(turn.input);
    for (const id of zone(s, opponent, "hand")) assert.ok(!wire.includes(`\"${id}\"`), "policy observation also hides the opposing hand");
    for (const decision of turn.input.decisions.decisions.filter((d) => d.kind === "menu")) {
      const roundTrip = resolveAnswer(turn.key, answerFor(turn.input.decisions, decision.id));
      assert.ok(roundTrip.ok && roundTrip.actions.length === 1);
      assert.ok(RULES.legalActions(ctx, s).some((l) => JSON.stringify(l.action) === JSON.stringify(roundTrip.actions[0])), "policy menu resolves to a current legal engine action");
    }
  }
}
// A chosen active energy card can pay one of the two blue orbs: resting it
// changes no area/qualification (22-5-3, 5-8); no extra reserved resource.
for (const p of ["p1", "p2"] as const) for (const mode of ["active", "rest"] as const) {
  let s = fresh(p); const evo = stage(s, "DB3-027", "hand", p); const base = stage(s, "E913-BASE", "energy", p);
  s.cards[base].mode = mode;
  const e1 = stage(s, "V-BLUE", "energy", p); const e2 = mode === "rest" ? stage(s, "V-BLUE", "energy", p) : null;
  addEffect(s, [], { source: base, target: base, kind: "power", value: 5000, until: "turn" });
  const a = legal(s, evo); assert.ok(a, `Bardock offered from hand over ${mode} energy base`);
  s = finish(take(s, a.action), base, mode === "active" ? base : e1);
  assert.equal(findCard(s, evo)?.zone, "battle"); assert.deepEqual(s.cards[evo].under, [base]);
  assert.equal(s.cards[evo].mode, "active"); assert.equal(s.cards[e1].mode, "rest");
  assert.equal(attrsNow(ctx, game, s, evo).power, 20000, "energy-to-Battle is a new area entry before stacking; old energy power effects do not transfer");
  if (e2) assert.equal(s.cards[e2].mode, "rest");
  assert.equal(zone(s, p, "energy").length, mode === "rest" ? 2 : 1);
  assert.equal(events.filter((e) => e.type === "skill" && e.card === base).length, 0);
  privacy(s);
}

// The seventh card uses its exact Nappa: Adolescence character, not a name
// substring; the same mechanism handles its one-blue price.
{
  let s = fresh(); const top = stage(s, "DB3-042", "hand"); const base = stage(s, "E913-NAPPA", "energy");
  s = finish(take(s, legal(s, top)!.action), base);
  assert.ok(s.cards[top].under.includes(base)); assert.equal(s.cards[top].mode, "active");
  assert.equal(zone(s, "p1", "energy").length, 0, "the chosen energy can pay the only orb before leaving");
}

// Permission belongs to the precise hand copy. Every ordinary qualification
// and payment gate remains required; energy access is not a free play.
for (const change of ["type", "color", "character", "cost", "controller", "area", "permission", "source", "payment"] as const) {
  const s = fresh(); const evo = stage(s, change === "permission" ? "E913-NO" : "DB3-027", change === "source" ? "zEnergy" : "hand");
  const bad = `E913-BAD-${change}`;
  defs[bad] = { ...defs["E913-BASE"], id: bad, ...(change === "type" ? { type: "EXTRA" as const } : {}), ...(change === "color" ? { colors: ["Red"] } : {}), ...(change === "character" ? { characters: ["Son Goku"] } : {}), ...(change === "cost" ? { energyCost: 1 } : {}) };
  const base = stage(s, bad, change === "area" ? "drop" : "energy", change === "controller" ? "p2" : "p1");
  if (change !== "payment") { stage(s, "V-BLUE", "energy"); stage(s, "V-BLUE", "energy"); }
  if (change === "permission") stage(s, "DB3-027", "hand");
  assert.equal(legal(s, evo), undefined, `${change}: evolution refused`);
  assert.ok(findCard(s, base)); privacy(s);
}

// Ordinary Battle-area evolution carries mode and power; the energy-only
// Active Mode clause does not turn a rested Battle-area base active.
{
  let s = fresh(); const evo = stage(s, "DB3-027", "hand"); const base = stage(s, "E913-BASE", "battle");
  s.cards[base].mode = "rest"; addEffect(s, [], { source: base, target: base, kind: "power", value: 5000, until: "turn" });
  stage(s, "V-BLUE", "energy"); stage(s, "V-BLUE", "energy");
  s = finish(take(s, legal(s, evo)!.action), base);
  assert.equal(s.cards[evo].mode, "rest"); assert.equal(attrsNow(ctx, game, s, evo).power, 25000);
}

// Six official negative Q&A cases, with actual named base-card skills.
const faqPairs = [["DB3-027", "TB3-019"], ["DB3-030", "DB3-031"], ["DB3-033", "TB3-025"], ["DB3-035", "TB3-027"], ["DB3-037", "TB3-028"], ["DB3-039", "TB3-029"]] as const;
for (const [topId, baseId] of faqPairs) {
  let s = fresh(); const top = stage(s, topId, "hand"); const base = stage(s, baseId, "energy"); s.cards[base].mode = "rest";
  for (let n = 0; n < 3; n++) stage(s, "V-BLUE", "energy");
  const a = legal(s, top); assert.ok(a, `${topId}: real keyword offered over ${baseId}`);
  s = finish(take(s, a.action), base);
  assert.ok(s.cards[top].under.includes(base)); assert.equal(s.cards[top].mode, "active");
  assert.equal(events.filter((e) => e.type === "skill" && e.card === base).length, 0, `${topId}: official underlying Auto does not activate`);
  assert.equal(events.filter((e) => e.type === "mode" && e.card === base).length, 0, "preliminary placement is not a Rest-to-Active switch");
  const preliminary = events.findIndex((e) => e.type === "move" && e.card === base && e.from === "energy" && e.to === "battle");
  const played = events.findIndex((e) => e.type === "move" && e.card === top && e.to === "battle");
  assert.ok(preliminary >= 0 && played > preliminary, "preliminary base placement precedes the normal new-card play");
  privacy(s);
}

// Payment, target choice and counter boundaries all survive JSON. The
// selected base cannot be replaced by a new area-entry of the same instance.
for (const outcome of ["success", "missing", "changed", "leave-return", "countered", "rest-counter"] as const) {
  let s = fresh(); const top = stage(s, "DB3-027", "hand"); const base = stage(s, "E913-BASE", "energy"); s.cards[base].mode = "rest";
  const other = stage(s, "E913-BASE", "battle");
  for (let n = 0; n < 3; n++) stage(s, n === 0 ? "E913-DUAL" : "V-BLUE", "energy");
  const counter = stage(s, outcome === "rest-counter" ? "E913-REST" : "E913-COUNTER", "hand", "p2");
  s = take(s, legal(s, top)!.action);
  assert.equal(s.prompt.kind, "payCost"); privacy(s);
  s = take(clone(s), { type: "payCost", player: "p1", option: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  if (s.prompt.kind === "chooseCards") assert.deepEqual(new Set(s.prompt.choice.candidates), new Set([base, other]));
  assert.throws(() => take(s, { type: "choose", player: "p1", cards: [] }), "an evolution base is mandatory");
  privacy(s); s = take(clone(s), { type: "choose", player: "p1", cards: [base] });
  assert.equal(s.prompt.kind, "counter"); assert.equal(findCard(s, base)?.zone, "energy", "preliminary placement waits for resolution");
  assert.ok(JSON.stringify(s).includes('"evolutionBase"'), "the counter continuation retains chosen-base identity");
  if (outcome === "missing" || outcome === "leave-return") vmHost(ctx, game, s, events).move(base, "drop", "p1", { reason: "effect" });
  if (outcome === "leave-return") vmHost(ctx, game, s, events).move(base, "energy", "p1", { reason: "effect" });
  if (outcome === "changed") s.cards[base].cardId = "V-BLUE";
  s = finish(take(clone(s), { type: "counter", player: "p2", card: outcome === "countered" || outcome === "rest-counter" ? counter : null }));
  assert.equal(counterAnswers, 1, "only the normal new-card counter window occurs");
  assert.equal(findCard(s, top)?.zone, outcome === "success" || outcome === "rest-counter" ? "battle" : outcome === "countered" ? "hand" : "drop");
  if (outcome === "rest-counter") assert.equal(s.cards[top].mode, "rest", "normal Counter: Play mode replacement still applies");
  if (outcome === "countered") assert.equal(findCard(s, base)?.zone, "energy", "countered evolution never preliminarily places its base");
  assert.equal(s.resolving, null); privacy(s);
}

// Existing successful play, evolved-into and from-hand activation moments
// remain separate; no underlying-card program is substituted for the new one.
{
  let s = fresh(); const top = stage(s, "E913-WITNESS", "hand"); const base = stage(s, "E913-BASE", "energy");
  stage(s, "V-BLUE", "energy"); const before = zone(s, "p1", "hand").length;
  s = finish(take(s, legal(s, top)!.action), base);
  assert.equal(zone(s, "p1", "hand").length, before + 2, "one hand card becomes the top and three distinct Autos draw once each");
  assert.equal(events.filter((e) => e.type === "skill" && e.card === top && e.skill !== 0).length, 3);
}

// Causal control: the supported placed trigger really fires for a normal
// energy-to-Battle placement. Evolution suppresses that exact event while
// retaining the new top card's ordinary placement and watcher Auto.
for (const evolution of [false, true]) {
  let s = fresh(); const base = stage(s, "E913-PLACED", "energy"); s.cards[base].mode = "rest";
  const watcher = stage(s, "E913-WATCHER", "battle");
  stage(s, "V-BLUE", "energy"); stage(s, "V-BLUE", "energy");
  const top = evolution ? stage(s, "DB3-027", "hand") : null;
  const before = zone(s, "p1", "hand").length;
  assert.deepEqual(skillRecords(defs["E913-PLACED"])[0].trigger, ["placed"]);
  if (top) s = finish(take(s, legal(s, top)!.action), base);
  else { vmHost(ctx, game, s, events).move(base, "battle", "p1", { reason: "effect" }); run(ctx, game, s, events); s = finish(clone(s)); }
  assert.equal(events.filter((e) => e.type === "skill" && e.card === base).length, evolution ? 0 : 1);
  assert.equal(events.filter((e) => e.type === "skill" && e.card === watcher).length, 1, "only the genuine placement is watched");
  assert.equal(zone(s, "p1", "hand").length, before + (evolution ? 0 : 2));
  assert.equal(events.filter((e) => e.type === "mode" && e.card === base).length, 0, "an arrival never emits an underlying-card mode switch");
}

// Positive controls retain each actual base Auto in its genuine normal event.
// TB3-019 has an existing empty-trigger/unsafe-effect miscompile: #922.
// Do not pretend that absence of a working Auto is a suppression proof.
for (const [, baseId] of faqPairs.slice(1)) {
  let s = fresh(); const base = stage(s, baseId, baseId === "TB3-019" || baseId === "TB3-028" ? "battle" : "hand");
  const unison = stage(s, "E913-UNISON", "drop");
  for (let n = 0; n < 6; n++) stage(s, "V-BLUE", "energy");
  const crew = stage(s, "E913-CREW", baseId === "TB3-027" ? "deck" : "drop");
  if (baseId === "TB3-028") {
    s = take(s, { type: "endMain", player: "p1" });
    s = take(s, { type: "charge", player: "p2", card: null });
    s = take(s, { type: "endMain", player: "p2" });
    s = take(s, { type: "charge", player: "p1", card: null });
    const before = zone(s, "p1", "hand").length;
    s = finish(take(s, { type: "attack", player: "p1", attacker: base, target: zone(s, "p2", "leader")[0] }));
    assert.equal(zone(s, "p1", "hand").length, before + 1, "genuine Shugesh attack may draw a card");
  } else {
    const play = RULES.legalActions(ctx, s).find(({ action }) => action.type === "play" && action.card === base);
    assert.ok(play, `${baseId}: normal play is legal`); s = finish(take(s, play.action), baseId === "DB3-031" ? unison : crew);
    if (baseId === "DB3-031") assert.ok(zone(s, "p1", "hand").includes(unison));
    if (baseId === "TB3-025" || baseId === "TB3-027") assert.ok(zone(s, "p1", "hand").includes(crew));
  }
  assert.ok(events.some((e) => e.type === "skill" && e.card === base), `${baseId}: the actual printed Auto fires on its normal event`);
}


console.log("energy-evolve-913: seven complete Permanents, exact payments, both seats/modes, gates and ordinary stacking passed");

/** #825: saved public card texts, exercised on the real rules engine.
 * Manual 9-6-9 original movement info; 8-5-10-1 cleanup; 22-5-2-3 evolution.
 * Named auxiliary operations stage movement/interruptions; primary skills are
 * never replaced with hand-written programs. No database or provider.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty, rulesFromCompiler, skillRecords } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { vmHost } from "../../src/lib/arena/vm/host";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";
import { matches, parseFilter } from "../../src/lib/arena/text/filters";
import { predicateOf } from "../../src/lib/arena/vm/filters";
import { resolvePlay } from "../../src/lib/arena/vm/play";

const printed = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/825/cards.json", import.meta.url), "utf8")) as CardDef[];
const defs: Record<string, CardDef> = { ...DEFS, ...Object.fromEntries(printed.map((d) => [d.id, d])),
  C825: card("C825", { type: "EXTRA", energyCost: 0, comboCost: null, comboPower: null, skill: "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played." }),
  RED825: card("RED825", { colors: ["Red"], traits: ["Cooler’s Armored Squadron"] }),
  EVO825: card("EVO825", { skill: "[Evolve]{1}: <V1><br>[Auto] When a card evolves into this card, draw 1 card.<br>[Auto] When using this card's [Evolve] from your hand, draw 1 card." }),
  EX825: card("EX825", { skill: "[EX-Evolve]{1}: <V1><br>[Auto] When a card evolves into this card, draw 1 card.<br>[Auto] When using this card's [Evolve] from your hand, draw 1 card." }),
  XENO825: card("XENO825", { skill: "[Xeno-Evolve]{1}: <V1><br>[Auto] When a card evolves into this card, draw 1 card.<br>[Auto] When using this card's [Evolve] from your hand, draw 1 card." }),
  XENOTRUNKS825: card("XENOTRUNKS825", { skill: "[Xeno-Evolve]{1}: <Trunks: Xeno>" }),
  REMOVED825: card("REMOVED825", { characters: ["V1"], skill: "[Auto] When this card is removed from your Battle Area by a skill, draw 1 card." }),
  RETURN825: card("RETURN825", { skill: "[Auto] When your blue Battle Card is played, return it to its owner's hand." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const clone = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area];
const leader = (s: VmState, p: PlayerId) => zone(s, p, "leader")[0];
const events: GameEvent[] = [];
const pendingInfo = (s: VmState) => {
  const first = s.pending[0]; return first && "subjectInfo" in first ? first.subjectInfo : undefined;
};
function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, clone(s), action); events.push(...out.events); return out.state as VmState;
}
function stage(s: VmState, cardId: string, area: string, p: PlayerId = "p1"): string {
  const id = zone(s, p, "deck")[0]; assert.ok(id); s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
function fresh(cooler = false): VmState {
  let s = RULES.createGame(ctx, { seed: 825, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = take(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let n = 0; n < 20 && s.prompt.kind !== "main"; n++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  s = take(s, { type: "endMain", player: "p1" });
  s = take(s, { type: "charge", player: "p2", card: null });
  s = take(s, { type: "endMain", player: "p2" });
  s = take(s, { type: "charge", player: "p1", card: null });
  if (cooler) { s.cards[leader(s, "p1")].cardId = "BT29-029"; s.cards[leader(s, "p1")].flipped = true; }
  return s;
}
function effect(s: VmState, source: string, ops: Op[], master: PlayerId = "p1"): void {
  s.programs.unshift({ card: source, master, ops, ip: 0, vars: {} }); run(ctx, game, s, events);
}
function choose(s: VmState, cards: string[]): VmState {
  assert.equal(s.prompt.kind, "chooseCards"); return take(s, { type: "choose", player: (s.prompt as { player: PlayerId }).player, cards });
}
function finish(s: VmState): VmState {
  for (let n = 0; n < 50 && s.prompt.kind !== "main"; n++) {
    const p = s.prompt;
    if (p.kind === "combo") s = take(s, { type: "pass", player: p.player });
    else if (p.kind === "zEnergyFromCombo") s = take(s, { type: "zEnergyFromCombo", player: p.player, card: null });
    else if (p.kind === "chooseCards") s = choose(s, p.choice.candidates.slice(0, p.choice.min));
    else if (p.kind === "chooseMode") s = take(s, { type: "chooseMode", player: p.player, index: 1 });
    else if (p.kind === "orderPending") s = take(s, { type: "orderPending", player: p.player, index: 0 });
    else if (p.kind === "counter") s = take(s, { type: "counter", player: p.player, card: null });
    else throw Error(`unexpected ${p.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); invariant(s); return s;
}
function invariant(s: VmState): void {
  const seen = new Map<string, number>();
  for (const side of Object.values(s.sides)) for (const ids of Object.values(side.zones)) for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const c of Object.values(s.cards)) for (const id of c.under) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one area/pile`);
}
function privacy(s: VmState): void {
  for (const viewer of ["p1", "p2"] as const) {
    const snap = buildSnapshot({ id: 825, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: s, legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
    const wire = JSON.stringify(snap);
    assert.ok(!wire.includes('"subjectInfo"') && !wire.includes('"sourceNegated"') && !wire.includes('"specialSubjects"'));
  }
}
for (const [id, side, index, trigger] of [
  ["BT29-029", "back", 0, "yourCardReturnedToHand"], ["BT3-112", "front", 10, "battleOrDeckToWarp"],
  ["BT3-098", "front", 10, "comboed"], ["BT3-096", "front", 10, "comboed"],
] as const) {
  const row = skillRecords(defs[id]).find((r) => r.side === side && r.skillIndex === index)!;
  assert.deepEqual(row.trigger, [trigger], `${id}: exact real-card trigger`); assert.deepEqual(row.unread, []);
  assert.deepEqual(runtimeSupportOfRow(row).unsupported, [], `${id}: no unsupported mechanism`);
}
{
  const f = parseFilter("blue ≪Cooler's Armored Squadron≫ card");
  const s = fresh(); const id = stage(s, "BT29-035", "battle");
  assert.equal(matches(defs["BT29-035"], f), true, "curly catalog trait matches normalized printed text");
  assert.equal(predicateOf(f, game)(attrsNow(ctx, game, s, id)), true, "VM/pure identity parity");
  assert.equal(matches({ ...defs["BT29-035"], traits: ["Coolers Armored Squadron"] }, f), false, "missing apostrophe is a distinct trait");
  assert.equal(predicateOf(f, game)({ ...attrsNow(ctx, game, s, id), traits: ["Coolers Armored Squadron"] }), false);
  assert.equal(matches(defs["V-BLUE"], f), false, "blue alone does not make a Squadron card");
}

// Cooler: the two blue alternatives, original-side/area restrictions and one
// occurrence for a subject satisfying both alternatives. Use the skill mover.
for (const kind of ["squadron", "extra", "both", "nonblue", "nontrait", "opponent", "energy", "drop", "deck"] as const) {
  const s = fresh(true); const source = leader(s, "p1");
  const id = stage(s, kind === "extra" || kind === "both" ? "BT29-040" : kind === "nontrait" ? "V-BLUE" : kind === "nonblue" ? "RED825" : "BT29-035",
    ["energy", "drop", "deck"].includes(kind) ? kind : "battle", kind === "opponent" ? "p2" : "p1");
  if (kind === "both") addEffect(s, [], { source: id, target: id, kind: "gains", value: { traits: ["Cooler's Armored Squadron"], colors: [], characters: [], names: [] }, until: "turn" });
  // Inspect event-time pending before the checkpoint runs the optional skill.
  vmHost(ctx, game, s, events).move(id, "hand", s.cards[id].owner);
  const due = s.pending.filter((p) => p.card === source && p.skillIndex === 0);
  assert.equal(due.length, ["squadron", "extra", "both"].includes(kind) ? 1 : 0, kind);
  invariant(s); privacy(s);
}

// Original Battle holder (borrowed card), and qualification frozen before
// temporary color/trait effects disappear; reloading cannot change the answer.
{
  const s = fresh(true); const source = leader(s, "p1");
  const id = stage(s, "BT29-035", "battle", "p2");
  assert.ok(moveCard(s, game, id, "battle", { owner: "p1", carry: true }).ok);
  moved(ctx, game, s, events, id, "hand", { owner: "p2" });
  assert.equal(s.pending.filter((p) => p.card === source).length, 1, "original p1 holder hears return to p2 hand");
  assert.deepEqual(pendingInfo(clone(s))?.colors, ["Blue"]); privacy(s); invariant(s);
}
{
  const s = fresh(true); const source = leader(s, "p1"); const id = stage(s, "V1", "battle");
  addEffect(s, [], { target: id, source: id, kind: "gains", value: { colors: ["Blue"], traits: ["Cooler's Armored Squadron"], characters: [], names: [] }, until: "turn" });
  vmHost(ctx, game, s, events).move(id, "hand", "p1");
  assert.equal(s.pending.filter((p) => p.card === source).length, 1, "qualifies using original gained identity");
  assert.deepEqual(attrsNow(ctx, game, s, id).traits, [], "old identity ended on the skill move");
  const saved = clone(s); assert.deepEqual(pendingInfo(saved)?.traits, ["Cooler's Armored Squadron"]);
  run(ctx, game, saved, events); assert.equal(saved.prompt.kind, "main", "saved qualified Auto safely resolves without an energy target");
  privacy(saved); invariant(saved);
}
// A replacement changes the actual destination, so an attempted hand return
// neither triggers Cooler nor reveals hand-return subject information.
{
  const s = fresh(true); const id = stage(s, "BT29-035", "battle");
  // The replacement's scope is staged on this physical card, not a broad
  // attempted-return event. Use the same registered leave replacement schema.
  addEffect(s, [], { target: id, source: id, kind: "replaceLeave", value: { to: "deck", position: "bottom", requestedTo: "hand" }, until: "turn" });
  vmHost(ctx, game, s, events).move(id, "hand", "p1");
  assert.ok(zone(s, "p1", "deck").includes(id)); assert.equal(s.pending.length, 0); invariant(s);
}
for (const viaSkill of [false, true]) {
  const s = fresh(true); const source = leader(s, "p1"); const id = stage(s, "V1", "battle");
  addEffect(s, [], { target: id, source: id, kind: "gains", value: { colors: ["Blue"], traits: ["Cooler’s Armored Squadron"], characters: [], names: [] }, until: "whileSourceInPlay" });
  addEffect(s, [], { target: id, source: id, kind: "replaceLeave", value: { to: "hand", requestedTo: "drop" }, until: "turn" });
  if (viaSkill) vmHost(ctx, game, s, events).move(id, "drop", "p1");
  else moved(ctx, game, s, events, id, "drop");
  assert.ok(zone(s, "p1", "hand").includes(id));
  assert.equal(s.pending.filter((p) => p.card === source).length, 1, "Drop→Hand redirection uses original qualified attrs");
  run(ctx, game, s, events); assert.equal(s.prompt.kind, "main"); invariant(s);
}

// Full optional play→energy replacement. Decline/no eligible target never
// adds free energy; successful play uses a real cost-5 card and then Rest mode.
for (const accept of [false, true]) {
  let s = fresh(true); const source = leader(s, "p1");
  const returned = stage(s, "BT29-035", "battle"); const target = stage(s, "BT29-038", "energy");
  moved(ctx, game, s, events, returned, "hand"); run(ctx, game, s, events); privacy(s);
  assert.equal(s.prompt.kind, "chooseMode");
  s = take(s, { type: "chooseMode", player: "p1", index: accept ? 0 : 1 });
  if (accept) {
    // Forced energy choice may already have played; the remaining hand
    // choice belongs to the conditional energy replacement.
    assert.equal(s.prompt.kind, "chooseCards"); s = choose(s, [returned]);
  }
  s = finish(s);
  assert.equal(zone(s, "p1", "battle").includes(target), accept);
  assert.equal(zone(s, "p1", "energy").includes(returned), accept);
  if (accept) assert.equal(s.cards[returned].mode, "rest");
  const before = events.length; const next = stage(s, "BT29-035", "battle");
  moved(ctx, game, s, events, next, "hand"); run(ctx, game, s, events);
  assert.equal(s.prompt.kind, "main", "once per turn already resolved");
  assert.equal(events.slice(before).filter((e) => e.type === "skill" && e.card === source).length, 0);
}
{
  const s = fresh(true); const id = stage(s, "BT29-035", "battle");
  moved(ctx, game, s, events, id, "hand"); run(ctx, game, s, events);
  assert.equal(s.prompt.kind, "main", "no cost-5 energy target gives no offer/follow-up");
}
for (const kind of ["forbidden", "countered"] as const) {
  let s = fresh(true); const returned = stage(s, "BT29-035", "battle"); const target = stage(s, "BT29-038", "energy");
  const handBefore = zone(s, "p1", "hand").length;
  const counter = kind === "countered" ? stage(s, "C825", "hand", "p2") : null;
  if (kind === "forbidden") addEffect(s, [], { source: target, target, kind: "forbid", value: 0, forbid: { what: "play", bySkill: true }, until: "turn" });
  moved(ctx, game, s, events, returned, "hand"); run(ctx, game, s, events);
  s = take(s, { type: "chooseMode", player: "p1", index: 0 });
  if (counter) { assert.equal(s.prompt.kind, "counter"); s = take(s, { type: "counter", player: "p2", card: counter }); }
  s = finish(s);
  assert.ok(!zone(s, "p1", "battle").includes(target));
  assert.ok(zone(s, "p1", "hand").includes(returned), "no conditional hand card charged when the optional play failed");
  assert.equal(zone(s, "p1", "hand").length, handBefore + 1 + (counter ? 1 : 0));
}
{
  let s = fresh(true); stage(s, "RETURN825", "battle");
  const returned = stage(s, "BT29-035", "battle"); const target = stage(s, "BT29-038", "energy");
  moved(ctx, game, s, events, returned, "hand"); run(ctx, game, s, events);
  s = take(s, { type: "chooseMode", player: "p1", index: 0 }); s = choose(s, [returned]); s = finish(s);
  assert.ok(zone(s, "p1", "hand").includes(target), "subsequent Auto returned the successfully played card");
  assert.ok(zone(s, "p1", "energy").includes(returned), "IfYouDo remembers actual play despite later board changes");
}
for (const kind of ["absent", "forbidden"] as const) {
  const s = fresh(); const first = stage(s, "V1", "hand"); const second = stage(s, "V1", "hand");
  addEffect(s, [], { source: second, target: second, kind: "forbid", value: 0, forbid: { what: "play", bySkill: true }, until: "turn" });
  const before = zone(s, "p1", "hand").length;
  s.programs.unshift({ card: first, master: "p1", ip: 0, vars: { next: kind === "absent" ? [] : [second] }, ops: [
    { op: "play", target: { sel: { special: "self" } } }, { op: "play", target: { var: "next" } },
    { op: "if", cond: { kind: "did", what: "play" }, then: [{ op: "draw", n: 1 }] },
  ] }); run(ctx, game, s, events);
  assert.equal(zone(s, "p1", "hand").length, before - 1, "a previous successful play cannot satisfy a later failed attempt");
}

// Trunks: only the two printed source areas, actual route, physical identity,
// Hidden Mode and original skill negation. Both movement emitters are covered.
for (const area of ["battle", "deck", "hand", "drop", "energy", "combo"] as const) {
  for (const viaSkill of [false, true]) {
    const s = fresh(); const id = stage(s, "BT3-112", area);
    if (viaSkill) effect(s, id, [{ op: "moveTo", target: { sel: { special: "self" } }, to: "warp" }]);
    else { moved(ctx, game, s, events, id, "warp"); run(ctx, game, s, events); }
    assert.equal(zone(s, "p1", "hand").includes(id), area === "battle" || area === "deck", `${area}/${viaSkill}`);
    if (!["battle", "deck"].includes(area)) assert.ok(zone(s, "p1", "warp").includes(id));
    invariant(s); privacy(s);
  }
}
for (const kind of ["hidden", "negated"] as const) {
  const s = fresh(); const id = stage(s, "BT3-112", "battle");
  if (kind === "hidden") s.cards[id].hidden = true;
  else addEffect(s, [], { target: id, source: leader(s, "p2"), kind: "negateSkills", value: 0, until: "turn" });
  effect(s, id, [{ op: "moveTo", target: { sel: { special: "self" } }, to: "warp" }]);
  assert.ok(zone(s, "p1", "warp").includes(id), kind); invariant(s);
}
for (const viaSkill of [false, true]) {
  const s = fresh(); const id = stage(s, "BT3-112", "battle");
  addEffect(s, [], { target: id, source: id, kind: "negateSkills", value: 0, until: "whileSourceInPlay" });
  addEffect(s, [], { target: id, source: id, kind: "replaceLeave", value: { to: "warp", requestedTo: "drop" }, until: "turn" });
  if (viaSkill) vmHost(ctx, game, s, events).move(id, "drop", "p1");
  else moved(ctx, game, s, events, id, "drop");
  run(ctx, game, s, events); assert.ok(zone(s, "p1", "warp").includes(id), "Drop→Warp keeps original Auto negation"); invariant(s);
}
{
  const s = fresh(); const id = stage(s, "BT3-112", "deck"); const other = stage(s, "BT3-112", "warp");
  moved(ctx, game, s, events, id, "warp"); const saved = clone(s); run(ctx, game, saved, events);
  assert.ok(zone(saved, "p1", "hand").includes(id)); assert.ok(zone(saved, "p1", "warp").includes(other)); invariant(saved); privacy(saved);
}
// The normal Over Realm keyword, not a synthetic hand-written delayed move.
{
  let s = fresh(); const id = stage(s, "BT3-112", "hand");
  for (let n = 0; n < 3; n++) stage(s, "V1", "drop");
  const activation = RULES.legalActions(ctx, s).find(({ action }) => action.type === "activate" && action.card === id);
  assert.ok(activation); s = take(s, activation.action); assert.ok(zone(s, "p1", "battle").includes(id));
  s = take(s, { type: "endMain", player: "p1" });
  assert.ok(zone(s, "p1", "hand").includes(id), "real Over Realm end-turn Warp triggers exact physical Trunks");
  assert.equal(zone(s, "p1", "warp").filter((c) => s.cards[c].cardId === "V1").length, 3, "Drop payment is not a printed source for self Auto");
  invariant(s); privacy(s);
}

// Great Apes: actual paid combos from hand AND Battle, this owner's turn,
// 8-5-8 Drop cleanup, optional real base, successful evolution and #20 payoff.
for (const ape of ["BT3-098", "BT3-096"] as const) for (const area of ["hand", "battle"] as const) {
  let s = fresh(); const combo = stage(s, ape, area); const base = stage(s, ape === "BT3-098" ? "BT3-099" : "BT3-097", "battle");
  s.cards[base].mode = "rest"; addEffect(s, [], { source: base, target: base, kind: "power", value: 5000, until: "turn" });
  const energy = stage(s, "V1", "energy"); const target = stage(s, "V-BLUE", "battle", "p2");
  if (ape === "BT3-096") s.cards[target].mode = "rest";
  s = take(s, { type: "attack", player: "p1", attacker: leader(s, "p1"), target: leader(s, "p2") });
  s = take(s, { type: "combo", player: "p1", card: combo });
  assert.equal(s.cards[energy].mode, "rest", "normal combo price is paid");
  assert.equal(s.pending.filter((p) => p.card === combo).length, 0, "not combo entry");
  for (let n = 0; n < 10 && s.prompt.kind !== "chooseCards"; n++) {
    if (s.prompt.kind === "combo") s = take(s, { type: "pass", player: s.prompt.player });
    else if (s.prompt.kind === "zEnergyFromCombo") s = take(s, { type: "zEnergyFromCombo", player: s.prompt.player, card: null });
    else throw Error(`Ape cleanup stopped at ${s.prompt.kind}`);
  }
  assert.ok(zone(s, "p1", "drop").includes(combo)); privacy(s);
  const candidates = s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
  assert.ok(candidates.includes(base)); assert.ok(!candidates.includes(target));
  s = choose(s, [base]);
  if (s.prompt.kind === "chooseCards") s = choose(s, [target]);
  s = finish(s);
  assert.ok(zone(s, "p1", "battle").includes(combo)); assert.ok(s.cards[combo].under.includes(base));
  assert.equal(s.cards[combo].mode, "rest", "base mode carries");
  assert.equal(attrsNow(ctx, game, s, combo).power, (defs[ape].power ?? 0) + 5000, "base power effect carries");
  assert.equal(zone(s, "p2", "drop").includes(target), ape === "BT3-096", "Tora payoff KOs the rested target");
  if (ape === "BT3-098") assert.equal(s.cards[target].mode, "rest", "Fasha payoff rests target");
  invariant(s); privacy(s);
}

// Decline, wrong turn and Z-Energy diversion do not evolve. The special
// cleanup occurrence belongs to the actual Combo copy that reaches Drop.
for (const kind of ["decline", "opponent", "zEnergy"] as const) {
  let s = fresh(); const owner = kind === "opponent" ? "p2" : "p1";
  const combo = stage(s, "BT3-098", "hand", owner); stage(s, "BT3-099", "battle", owner); stage(s, "V1", "energy", owner);
  s = take(s, { type: "attack", player: "p1", attacker: leader(s, "p1"), target: leader(s, "p2") });
  while (!(s.prompt.kind === "combo" && s.prompt.player === owner)) {
    const p = s.prompt;
    if (p.kind === "blocker") s = take(s, { type: "block", player: p.player, card: null });
    else if (p.kind === "combo") s = take(s, { type: "pass", player: p.player });
    else throw Error(`negative combo entry ${p.kind}`);
  }
  s = take(s, { type: "combo", player: owner, card: combo });
  for (let n = 0; n < 12 && s.prompt.kind !== "main"; n++) {
    if (s.prompt.kind === "combo") s = take(s, { type: "pass", player: s.prompt.player });
    else if (s.prompt.kind === "payCost") s = take(s, { type: "payCost", player: s.prompt.player, option: 0 });
    else if (s.prompt.kind === "zEnergyFromCombo") s = take(s, { type: "zEnergyFromCombo", player: s.prompt.player, card: kind === "zEnergy" && s.prompt.player === owner ? combo : null });
    else if (s.prompt.kind === "chooseCards" && kind === "decline") s = choose(s, []);
    else throw Error(`negative combo ${kind} unexpectedly asks ${s.prompt.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); assert.equal(s.cards[combo].under.length, 0);
  assert.ok(zone(s, owner, kind === "zEnergy" ? "zEnergy" : "drop").includes(combo)); invariant(s); privacy(s);
}
{
  let s = fresh(); const combo = stage(s, "BT3-098", "hand"); stage(s, "BT3-099", "battle"); stage(s, "V1", "energy");
  s = take(s, { type: "attack", player: "p1", attacker: leader(s, "p1"), target: leader(s, "p2") });
  s = take(s, { type: "combo", player: "p1", card: combo });
  moved(ctx, game, s, events, combo, "drop");
  assert.equal(s.pending.filter((p) => p.card === combo).length, 0, "mid-battle exit is not the special cleanup occurrence");
  s = finish(s); assert.ok(zone(s, "p1", "drop").includes(combo));
}

// Revalidation after a saved choice/counter opportunity: missing or changed
// base cannot fall back to an ordinary play, and no evolvedInto payoff occurs.
for (const kind of ["missing", "changed", "countered", "ordinary"] as const) {
  let s = fresh(); const combo = stage(s, "BT3-098", "drop"); const base = stage(s, "BT3-099", "battle");
  const target = stage(s, "V-BLUE", "battle", "p2");
  if (kind === "ordinary") {
    resolvePlay(ctx, game, s, events, combo, "p1", { onto: base }); run(ctx, game, s, events);
    assert.equal(s.cards[target].mode, "active", "plain stacking is not explicit evolution");
  } else {
    const counter = stage(s, "C825", "hand", "p2");
    // Stage only the entry to this real compiled Auto; all its choice/play
    // instructions, price and #20 payoff still come from printed card text.
    s.pending.push({ card: combo, skillIndex: 10, master: "p1", trigger: "comboed" });
    run(ctx, game, s, events); s = choose(s, [base]);
    assert.equal(s.prompt.kind, "counter"); privacy(s);
    if (kind === "missing") assert.ok(moveCard(s, game, base, "drop").ok);
    if (kind === "changed") s.cards[base].cardId = "BT3-097";
    s = take(s, { type: "counter", player: "p2", card: kind === "countered" ? counter : null }); s = finish(s);
    assert.ok(zone(s, "p1", kind === "countered" ? "hand" : "drop").includes(combo));
    assert.equal(s.cards[target].mode, "active", "failed evolution gives no resting payoff");
  }
  invariant(s); privacy(s);
}
for (const variant of ["EVO825", "EX825", "XENO825"]) for (const outcome of ["success", "missing", "changed", "countered"]) {
  let s = fresh(); const evo = stage(s, variant, "hand"); const base = stage(s, "V1", "battle");
  stage(s, "V1", "battle"); stage(s, "V1", "energy"); const counter = stage(s, "C825", "hand", "p2");
  const before = events.length;
  const activation = RULES.legalActions(ctx, s).find(({ action }) => action.type === "activate" && action.card === evo);
  assert.ok(activation); s = take(s, activation.action);
  assert.equal(s.prompt.kind, "chooseCards");
  assert.throws(() => take(s, { type: "choose", player: "p1", cards: [] }), "a paid ordinary Evolve base choice is required");
  s = choose(s, [base]); assert.equal(s.prompt.kind, "counter");
  if (outcome === "missing") assert.ok(moveCard(s, game, base, "drop").ok);
  if (outcome === "changed") s.cards[base].cardId = "V-BLUE";
  s = take(s, { type: "counter", player: "p2", card: outcome === "countered" ? counter : null }); s = finish(s);
  assert.equal(zone(s, "p1", "battle").includes(evo), outcome === "success", `${variant}/${outcome}`);
  if (outcome === "success") {
    assert.equal(s.cards[evo].under.includes(base), variant !== "XENO825");
    assert.equal(zone(s, "p1", "warp").includes(base), variant === "XENO825");
    assert.equal(s.cards[evo].playedUsing, variant === "EVO825" ? "Evolve" : variant === "EX825" ? "EX-Evolve" : "Xeno-Evolve");
  } else assert.ok(zone(s, "p1", outcome === "countered" ? "hand" : "drop").includes(evo), "failed keyword Evolve obeys 22-5-7, explicit return obeys its exception");
  assert.equal(events.slice(before).filter((e) => e.type === "skill" && e.card === evo && e.skill === 10).length, outcome === "success" ? 1 : 0, "normal Evolve/EX/Xeno payoff occurs exactly once on success");
  assert.equal(events.slice(before).filter((e) => e.type === "skill" && e.card === evo && e.skill === 20).length, 1, "from-hand activation Auto remains distinct from successful evolution");
}
// Xeno uses the skill mover after the counter/base checkpoint: target-bound
// effects end on the area change, movement Autos pend once, then the card lands.
{
  let s = fresh(); const evo = stage(s, "XENO825", "hand"); const base = stage(s, "REMOVED825", "battle"); stage(s, "V1", "energy");
  const power = addEffect(s, [], { target: base, source: leader(s, "p1"), kind: "power", value: 5000, until: "turn" });
  const before = events.length;
  const activation = RULES.legalActions(ctx, s).find(({ action }) => action.type === "activate" && action.card === evo);
  assert.ok(activation); s = take(s, activation.action); s = finish(s);
  assert.ok(zone(s, "p1", "warp").includes(base));
  assert.equal(attrsNow(ctx, game, s, base).power, defs.REMOVED825.power, "Warp base has no old Battle power effect");
  assert.ok(!s.effects.some((e) => e.id === power.id), "area change clears target-bound effects");
  const trace = events.slice(before);
  const removed = trace.findIndex((e) => e.type === "effectEnded" && e.effect.id === power.id);
  const warped = trace.findIndex((e) => e.type === "move" && e.card === base && e.to === "warp");
  const played = trace.findIndex((e) => e.type === "move" && e.card === evo && e.to === "battle");
  assert.ok(removed >= 0 && removed < warped && warped < played, "old effects end, base moves, then evolving card lands");
  assert.equal(trace.filter((e) => e.type === "skill" && e.card === base && e.skill === 0).length, 1, "skill removal Auto fires exactly once");
  invariant(s); privacy(s);
}
for (const negated of [false, true]) {
  let s = fresh(); const evo = stage(s, "XENOTRUNKS825", "hand"); const base = stage(s, "BT3-112", "battle"); stage(s, "V1", "energy");
  if (negated) addEffect(s, [], { target: base, source: leader(s, "p1"), kind: "negateSkills", value: 0, until: "turn" });
  const before = events.length;
  const activation = RULES.legalActions(ctx, s).find(({ action }) => action.type === "activate" && action.card === evo);
  assert.ok(activation); s = take(s, activation.action); s = finish(s);
  assert.ok(zone(s, "p1", negated ? "warp" : "hand").includes(base), "real Trunks respects pre-departure Auto negation");
  assert.ok(!s.effects.some((e) => e.target === base), "Xeno departure clears old negation without restoring a previously negated Auto");
  const trace = events.slice(before);
  assert.equal(trace.filter((e) => e.type === "move" && e.card === base && e.to === "warp").length, 1);
  assert.equal(trace.filter((e) => e.type === "skill" && e.card === base && e.skill === 10).length, negated ? 0 : 1);
  const played = trace.findIndex((e) => e.type === "move" && e.card === evo && e.to === "battle");
  const returned = trace.findIndex((e) => e.type === "move" && e.card === base && e.to === "hand");
  assert.ok(played >= 0 && (negated || returned > played), "pending Warp return resolves after the evolution lands");
  invariant(s); privacy(s);
}
console.log("qualified-movement-evolve-825: real card compiler/movement/paid-combo regressions passed");

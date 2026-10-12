/** #597: independent expected-state evidence for original-colour keyword payments. */
import assert from "node:assert/strict";
import { CTX, rulesFromCompiler } from "./harness";
import { playableEngine } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow, condHolds, resolveSelector } from "../../src/lib/arena/vm/program";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { parseCond, parseDefinitions, printCond, printDefinitions, printFilter } from "../../src/lib/arena/lang";
import { describeCond, describeFilter, validateProgram, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import { FILES } from "../../src/lib/arena/rulesets/dbs/files";
import type { VmState } from "../../src/lib/arena/vm/state";

const engine = playableEngine("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const def = (id: string, colors: CardDef["colors"], skill = ""): CardDef => ({ ...CTX.defs.V1, id, name: id, colors, skill });
const defs = {
  ...CTX.defs,
  R597: def("R597", ["Red"]), B597: def("B597", ["Blue"]), M597: def("M597", ["Red", "Blue"]), G597: def("G597", ["Green"]),
  ARR597: def("ARR597", ["Green"], "[Arrival red/blue] {r}"),
  AEG597: def("AEG597", ["Green"], "[Aegis red/blue] {r}"),
  REV597: def("REV597", ["Green"], "[Revive red/blue]"),
  REVFEE597: def("REVFEE597", ["Green"], "[Revive red/blue] {r}"),
  SOURCE597: def("SOURCE597", ["Green"], "[Permanent] Cards in all your areas gain Red and Blue."),
};
const identity: Op[] = [{ op: "gains", target: { sel: { side: "you", areas: ["hand", "combo", "life"], count: 99 } }, colors: ["Red", "Blue"] }];
const records = { SOURCE597: { bySkill: { 0: { ops: identity, unsupported: [] } }, complete: true, unsupported: [] } };
const ctx = { ...CTX, defs, scripts: new Proxy(rulesFromCompiler(defs), { get: (base, key) => key === "SOURCE597" ? records.SOURCE597 : Reflect.get(base, key) }) } as EngineContext;
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const act = (s: VmState, ...actions: Action[]): VmState => actions.reduce((state, action) => engine.apply(ctx, state, action).state as VmState, s);
const leader = (s: VmState, p: PlayerId) => s.sides[p].zones.leader[0];
const ids = (s: VmState, area: string, cardId: string) => (s.sides.p1.zones[area] ?? []).filter((id) => s.cards[id].cardId === cardId);
const one = (s: VmState, area: string, cardId: string) => { const id = ids(s, area, cardId)[0]; assert.ok(id, `${cardId} missing from ${area}`); return id; };
function put(s: VmState, cardId: string, area: string, p: PlayerId = "p1"): string {
  const id = s.sides[p].zones.deck[0]; assert.ok(id);
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  return id;
}
function fixture(hand: string[], battle: string[] = []): VmState {
  let s = engine.createGame(ctx, { seed: 7, p1: { name: "You", leader: "L-RED", main: Array(50).fill("V1") }, p2: { name: "Them", leader: "L-BLUE", main: Array(50).fill("V-BLUE") } }).state as VmState;
  s = act(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) s = act(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  s.turn = 2; // Fixture starts after the first-turn attack restriction.
  for (const id of [...s.sides.p1.zones.hand]) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  for (const card of hand) put(s, card, "hand");
  for (const card of battle) put(s, card, "battle");
  for (let i = 0; i < 3; i++) put(s, "R597", "energy");
  return s;
}
function frame(s: VmState): ScriptFrame { return { ops: [], ip: 0, vars: {}, card: leader(s, "p1"), master: "p1" }; }
function selected(s: VmState, area: "hand" | "combo" | "life", original = false): string[] {
  return resolveSelector(ctx, game, s, frame(s), { side: "you", area, filter: { ...emptyFilter(), ...(original ? { originalColors: ["Blue"] } : { colors: ["Blue"] }) } });
}
const available = (s: VmState, card: string) => engine.legalActions(ctx, s).some((a) => a.action.type === "activate" && a.action.card === card);
const choice = (s: VmState) => { assert.equal(s.prompt.kind, "chooseCards"); return (s.prompt as { choice: { candidates: string[]; min: number; reason: string } }).choice; };
function defense(s: VmState): VmState {
  s = act(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  // Turn draw belongs to p2; the payment hand remains exactly the staged p1 hand.
  return act(s, { type: "attack", player: "p2", attacker: leader(s, "p2"), target: leader(s, "p1") }, { type: "pass", player: "p2" });
}
function privacy(s: VmState): void {
  const beats = { seq: 1, list: [], art: Object.fromEntries(Object.entries(s.cards).map(([id, c]) => [id, { cardId: c.cardId, name: c.cardId, imageUrl: null }])) };
  for (const viewer of ["p1", "p2"] as const) {
    const them = viewer === "p1" ? "p2" : "p1";
    const snap = buildSnapshot({ id: 1, engine: "rules", mode: "versus", status: "playing", p1Name: "You", p2Name: "Them", ctx, state: s, legal: engine.legalActions(ctx, s), log: [], beats, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
    assert.equal(snap.view.them.hand, null);
    const named = (value: unknown, found = new Set<string>()): Set<string> => {
      if (Array.isArray(value)) for (const x of value) named(x, found);
      else if (value && typeof value === "object") {
        const o = value as Record<string, unknown>;
        if (typeof o.id === "string" && typeof o.cardId === "string" && o.hidden !== true) found.add(o.id);
        for (const x of Object.values(o)) named(x, found);
      }
      return found;
    };
    const publicCards = named(snap.view);
    for (const id of [...s.sides[them].zones.hand, ...s.sides.p1.zones.life, ...s.sides.p2.zones.life, ...s.sides.p1.zones.deck, ...s.sides.p2.zones.deck]) {
      assert.ok(!publicCards.has(id), `${viewer} saw the face of hidden ${id}`);
      assert.ok(!(id in snap.beats!.art), `${viewer} got hidden art for ${id}`);
    }
    assert.ok(!JSON.stringify(snap).includes('"originalColors"'), "original-colour engine attributes became public snapshot fields");
    if (s.prompt.kind === "chooseCards") assert.equal(snap.legal.length > 0, viewer === "p1", "other viewer got hand payment candidates");
  }
}
// The declared language can round-trip and describe the distinction. Omitted
// options retain effective semantics; no default CardFilter shape changes.
{
  const cond = { kind: "covers" as const, sel: { side: "you" as const, area: "hand" as const }, colors: ["Red", "Blue"] as CardDef["colors"], original: true };
  const parsed = parseCond(printCond(cond)); assert.ok(parsed.ok); assert.deepEqual(parsed.value, cond);
  assert.match(describeCond(cond), /original/);
  assert.match(printFilter({ originalColors: ["Blue"] }), /originalColors/);
  assert.match(describeFilter({ originalColors: ["Blue"] }), /original colours blue/);
  assert.equal(validateProgram([{ op: "if", cond, then: [] }]), true);
  const declared = parseDefinitions(FILES["keywords.rules"]); assert.ok(declared.ok);
  const reparsed = parseDefinitions(printDefinitions(declared.value)); assert.ok(reparsed.ok); assert.deepEqual(reparsed.value, declared.value, "parameterized originalColors selector lost its keyword binding");
}
// Arrival requires original coverage in *Combo*, never the hand. Effective
// Blue on a printed Red combo card cannot make the activation available.
{
  let s = fixture(["ARR597", "R597", "B597"], ["SOURCE597"]);
  const arr = one(s, "hand", "ARR597"), red = one(s, "hand", "R597"), blue = one(s, "hand", "B597");
  s = act(s, { type: "attack", player: "p1", attacker: leader(s, "p1"), target: leader(s, "p2") }, { type: "combo", player: "p1", card: red });
  assert.deepEqual(selected(s, "combo"), [red]); assert.deepEqual(selected(s, "combo", true), []);
  assert.equal(condHolds(ctx, game, s, frame(s), { kind: "covers", sel: { side: "you", area: "combo" }, colors: ["Red", "Blue"] }), true, "ordinary coverage keeps effective colours");
  assert.equal(condHolds(ctx, game, s, frame(s), { kind: "covers", sel: { side: "you", area: "combo" }, colors: ["Red", "Blue"], original: true }), false);
  assert.ok(!available(s, arr), "Red gaining Blue supplied Arrival's original Blue");
  assert.throws(() => act(s, { type: "activate", player: "p1", card: arr, skill: 0 }), /condition|Combo|refus|cannot|illegal/i);
  privacy(s);
  s = act(s, { type: "combo", player: "p1", card: blue });
  assert.ok(available(s, arr), "printed Blue gaining Red stopped qualifying for Arrival");
  const source = one(s, "battle", "SOURCE597");
  assert.ok(moveCard(s, game, source, "drop", { owner: "p1" }).ok);
  assert.deepEqual(selected(s, "combo"), [blue]); assert.deepEqual(selected(s, "combo", true), [blue]); assert.ok(available(s, arr));
  s = act(reload(s), { type: "activate", player: "p1", card: arr, skill: 0 });
  assert.ok(s.sides.p1.zones.battle.includes(arr));
  assert.equal(s.sides.p1.zones.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "Arrival paid its printed orb");
  assert.equal(s.prompt.kind, "combo");
}
{
  let s = fixture(["ARR597", "M597"], ["SOURCE597"]);
  const arr = one(s, "hand", "ARR597"), multi = one(s, "hand", "M597");
  s = act(s, { type: "attack", player: "p1", attacker: leader(s, "p1"), target: leader(s, "p2") }, { type: "combo", player: "p1", card: multi });
  assert.ok(available(reload(s), arr), "one printed multicolour combo card covers Arrival");
  s = act(reload(s), { type: "activate", player: "p1", card: arr, skill: 0 }); assert.ok(s.sides.p1.zones.battle.includes(arr));
}
// Aegis stays mandatory and colour-first. A printed Red gaining Blue still
// owes a *different original Blue*, including after a saved-frame reload.
{
  const s = defense(fixture(["R597", "R597"], ["AEG597", "SOURCE597"]));
  const aeg = one(s, "battle", "AEG597");
  assert.equal(selected(s, "hand").length, 2); assert.equal(selected(s, "hand", true).length, 0);
  assert.ok(!available(s, aeg), "effective hand coverage wrongly offered Aegis"); privacy(s);
  put(s, "B597", "combo"); assert.ok(!available(s, aeg), "Aegis paid with the wrong area");
}
{
  let s = defense(fixture(["R597", "R597", "B597", "B597", "G597"], ["AEG597", "SOURCE597"]));
  const aeg = one(s, "battle", "AEG597"), red = ids(s, "hand", "R597"), blue = ids(s, "hand", "B597");
  const energy = s.sides.p1.zones.energy; s.cards[energy[0]].mode = "rest"; s.cards[energy[1]].mode = "rest";
  assert.ok(available(s, aeg));
  s = act(s, { type: "activate", player: "p1", card: aeg, skill: 0 });
  assert.deepEqual(choice(s).candidates, [...red, ...blue], "effective-only Green omitted from Aegis payment");
  s = act(s, { type: "choose", player: "p1", cards: [red[0]] });
  assert.deepEqual(choice(s).candidates, blue, "Red gaining Blue did not complete the payment"); assert.equal(choice(s).min, 1);
  assert.equal(s.cards[energy[2]].mode, "active", "additional orb waits for complete colour payment"); privacy(s);
  s = reload(s); const unchanged = JSON.stringify(s);
  assert.throws(() => act(s, { type: "choose", player: "p1", cards: [red[1]] }), /invalid choice/); assert.equal(JSON.stringify(s), unchanged);
  assert.ok(moveCard(s, game, one(s, "battle", "SOURCE597"), "drop", { owner: "p1" }).ok);
  assert.deepEqual(selected(s, "hand"), blue); assert.deepEqual(selected(s, "hand", true), blue);
  s = act(reload(s), { type: "choose", player: "p1", cards: [blue[0]] });
  assert.ok([red[0], blue[0]].every((id) => s.sides.p1.zones.drop.includes(id)));
  assert.equal(s.cards[energy[2]].mode, "rest", "Aegis paid the additional orb after colour cards");
  assert.match(choice(s).reason, /energy/);
  s = act(reload(s), { type: "choose", player: "p1", cards: [energy[0]] }, { type: "choose", player: "p1", cards: [energy[1]] });
  assert.equal(s.prompt.kind, "combo"); assert.equal(s.cards[energy[0]].mode, "active"); assert.equal(s.cards[energy[1]].mode, "active");
}
{
  let s = defense(fixture(["M597"], ["AEG597", "SOURCE597"])); const multi = one(s, "hand", "M597");
  const result = engine.apply(ctx, reload(s), { type: "activate", player: "p1", card: one(s, "battle", "AEG597"), skill: 0 }); s = result.state as VmState;
  assert.equal(result.events.filter((e) => e.type === "move" && e.card === multi && e.to === "drop").length, 1, "single printed multicolour Aegis payment moved once"); assert.match(choice(s).reason, /energy/);
}
function koRevive(s: VmState, cardId = "REV597"): VmState {
  const rev = one(s, "battle", cardId); s.cards[rev].mode = "rest";
  s = act(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  return act(s, { type: "attack", player: "p2", attacker: leader(s, "p2"), target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
}
// Revive's actual KO payment asks only original-colour hand candidates.
{
  let s = fixture(["R597", "R597"], ["REV597", "SOURCE597"]); const rev = one(s, "battle", "REV597");
  put(s, "B597", "energy"); s = koRevive(s); assert.ok(s.sides.p1.zones.drop.includes(rev)); assert.equal(s.prompt.kind, "main", "no Revive payment offered for effective-only coverage"); privacy(s);
}
{
  let s = fixture(["R597", "R597", "B597", "B597", "G597"], ["REV597", "SOURCE597"]); const rev = one(s, "battle", "REV597");
  const red = one(s, "hand", "R597"), blue = one(s, "hand", "B597"); s = koRevive(s);
  assert.ok(choice(s).candidates.every((id) => ["R597", "B597"].includes(s.cards[id].cardId))); privacy(s);
  s = act(s, { type: "choose", player: "p1", cards: [red] }); s = reload(s);
  assert.ok(moveCard(s, game, one(s, "battle", "SOURCE597"), "drop", { owner: "p1" }).ok);
  s = act(s, { type: "choose", player: "p1", cards: [blue] });
  assert.ok(s.sides.p1.zones.battle.includes(rev)); assert.ok([red, blue].every((id) => s.sides.p1.zones.drop.includes(id))); assert.equal(s.prompt.kind, "main");
  // 22-34-4: a second KO in the turn cannot charge a second hand payment.
  s.cards[rev].mode = "rest"; const before = s.sides.p1.zones.hand.length;
  put(s, "V1", "battle", "p2"); const attacker = s.sides.p2.zones.battle[0];
  s = act(s, { type: "attack", player: "p2", attacker, target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.equal(s.prompt.kind, "main"); assert.equal(s.sides.p1.zones.hand.length, before);
}
{
  let s = fixture(["M597", "G597"], ["REV597", "SOURCE597"]); const multi = one(s, "hand", "M597"), rev = one(s, "battle", "REV597");
  s = koRevive(s); assert.deepEqual(choice(s).candidates, [multi]);
  s = act(reload(s), { type: "choose", player: "p1", cards: [multi] });
  assert.ok(s.sides.p1.zones.battle.includes(rev)); assert.equal(s.sides.p1.zones.drop.filter((id) => id === multi).length, 1);
}
// A declined partial selection cannot pay Revive using effective coverage.
{
  let s = fixture(["R597", "R597", "B597"], ["REV597", "SOURCE597"]); const rev = one(s, "battle", "REV597"), red = ids(s, "hand", "R597");
  s = koRevive(s); s = act(s, { type: "choose", player: "p1", cards: [red[0]] }, { type: "choose", player: "p1", cards: [red[1]] });
  assert.ok(s.sides.p1.zones.drop.includes(rev)); assert.ok(red.every((id) => s.sides.p1.zones.hand.includes(id)), "failed original coverage charged a hand card"); assert.equal(s.prompt.kind, "main");
}
// Separate own-cost boundary, NOT paid-resolution evidence for 22-34-3:
// current #549's shared Auto path charges Revive's additional orb before its
// colour DO. Declining the later colour payment leaves the card KO'd. This
// issue changes colour eligibility only, and does not claim to fix that order.
{
  let s = fixture(["R597", "B597"], ["REVFEE597", "SOURCE597"]); const rev = one(s, "battle", "REVFEE597"), hand = [...s.sides.p1.zones.hand];
  s = koRevive(s, "REVFEE597"); assert.equal(s.prompt.kind, "chooseMode", "priced Revive has a separate Auto own-cost offer");
  assert.equal(s.sides.p1.zones.energy.filter((id) => s.cards[id].mode === "rest").length, 0);
  s = act(reload(s), { type: "chooseMode", player: "p1", index: 0 });
  assert.match(choice(s).reason, /Revive/); assert.equal(s.sides.p1.zones.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "remaining order limitation: orb paid before hand-colour choice");
  assert.deepEqual(s.sides.p1.zones.hand, hand); s = act(s, { type: "choose", player: "p1", cards: [] });
  assert.ok(s.sides.p1.zones.drop.includes(rev)); assert.deepEqual(s.sides.p1.zones.hand, hand); assert.equal(s.prompt.kind, "main");
}
// Timed identity additions survive source removal, then expire, without ever
// rewriting original payment coverage. Check selectors and actual Aegis offers.
{
  let s = defense(fixture(["R597", "R597"], ["AEG597", "SOURCE597"])); const reds = ids(s, "hand", "R597"), source = one(s, "battle", "SOURCE597");
  assert.ok(moveCard(s, game, source, "drop", { owner: "p1" }).ok);
  addEffect(s, [], { source, target: reds[0], kind: "gains", value: { colors: ["Blue"], characters: [], traits: [], names: [] }, until: "turn" });
  s = reload(s); assert.deepEqual(selected(s, "hand"), [reds[0]]); assert.deepEqual(selected(s, "hand", true), []); assert.ok(!available(s, one(s, "battle", "AEG597"))); privacy(s);
  endEffects(s, [], "turn"); assert.deepEqual(selected(s, "hand"), []); assert.deepEqual(selected(s, "hand", true), []); assert.ok(!available(s, one(s, "battle", "AEG597"))); privacy(s);
  const hidden = reds[0]; s.cards[hidden].hidden = true; assert.equal(attrsNow(ctx, game, s, hidden).originalColors, undefined, "Hidden Mode had original face information");
}
console.log("original-colors-597: declared language; Arrival/Aegis/Revive eligibility and payment; reload, identity interaction and both viewers' privacy pass");

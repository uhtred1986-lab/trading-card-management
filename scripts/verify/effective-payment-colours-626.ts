/** #626: fixed rules-engine payment expectations; no legacy oracle or live data. */
import assert from "node:assert/strict";
import { compileCard } from "../../src/lib/arena/compile";
import { playableEngine } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { buildSnapshot, reconcileSnapshot } from "../../src/lib/arena/snapshot";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moved } from "../../src/lib/arena/vm/flow";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";

const engine = playableEngine("rules");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const def = (id: string, patch: Partial<CardDef> = {}): CardDef => ({ id, name: id, type: "BATTLE", colors: ["Red"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: null, characters: [], traits: [], ...patch });
const defs = {
  L626: def("L626", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  F626: def("F626"), R626: def("R626"), B626: def("B626", { colors: ["Blue"] }),
  C626: def("C626", { comboCost: 1 }),
  // Catalog/design facts and official wording from the existing #561 fixture.
  "BT11-053": def("BT11-053", { name: "Senzu Bean", type: "EXTRA", colors: ["Blue"], energyCost: 1, specifiedCost: { Blue: 1 }, power: null, comboCost: null, comboPower: null, skill: "[Activate: Battle] Choose up to 1 of your cards. It gains +5000 power for the duration of the turn. Then, choose up to 2 of your energy and switch them to Active Mode." }),
  SRC626: def("SRC626", { skill: "[Permanent] Your energy gains Blue." }),
  AS626: def("AS626", { skill: "[Permanent] You can use this card as energy." }),
  EXPLICIT626: def("EXPLICIT626", { skill: "[Permanent] You can use this card as Blue energy." }),
  EXPLICITRED626: def("EXPLICITRED626", { skill: "[Permanent] You can use this card as Red energy." }),
  CHEAP626: def("CHEAP626", { skill: "[Activate: Battle] {u}{1}: Draw 1 card." }),
};
const scripts = Object.fromEntries(Object.entries(defs).map(([id, d]) => [id, compileCard(d)]));
// Supported DSL interactions, not invented catalog cards or new grammar claims.
const standing = (id: string, ops: Op[]) => { scripts[id].bySkill[0] = { ...scripts[id].bySkill[0], ops, unsupported: [] }; };
standing("SRC626", [{ op: "gains", target: { sel: { side: "you", area: "energy" } }, colors: ["Blue"] }]);
standing("AS626", [{ op: "payWith", as: "energy" }]);
standing("EXPLICIT626", [{ op: "payWith", as: "Blue" }]);
standing("EXPLICITRED626", [{ op: "payWith", as: "Red" }]);
const ctx: EngineContext = { defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => engine.apply(ctx, reload(s), action) as { state: VmState; events: ReturnType<typeof engine.apply>["events"] };
const act = (s: VmState, ...actions: Action[]) => actions.reduce((next, action) => apply(next, action).state, s);
function put(s: VmState, cardId: string, area: string, player: PlayerId = "p1") {
  const id = s.sides[player].zones.deck[0]; assert.ok(id);
  s.cards[id].cardId = cardId; assert.ok(moveCard(s, game, id, area, { owner: player }).ok);
  return id;
}
function fixture(energy = ["R626"], source?: string) {
  let s = engine.createGame(ctx, { seed: 626, p1: { name: "You", leader: "L626", main: Array(50).fill("F626") }, p2: { name: "Other", leader: "L626", main: Array(50).fill("F626") } }).state as VmState;
  s = act(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let n = 0; n < 20 && s.prompt.kind !== "main"; n++) s = act(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  const card = put(s, "BT11-053", "hand"); const combo = put(s, "C626", "hand");
  const resources = energy.map((d) => put(s, d, "energy"));
  const granting = source ? put(s, source, "battle") : undefined;
  s = act(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = act(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "combo");
  return { s, card, combo, resources, granting };
}
const offered = (s: VmState, card: string) => engine.legalActions(ctx, s).some((r) => r.action.type === "activate" && r.action.card === card);
const activate = (s: VmState, card: string, pay?: string[]) => apply(s, { type: "activate", player: "p1", card, skill: 0, ...(pay ? { pay } : {}) });
function snap(s: VmState, viewer: PlayerId = "p1", revision = 1) {
  return buildSnapshot({ id: 626, revision, engine: "rules", mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state: s, legal: engine.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
const colors = (s: VmState, id: string) => snap(s).view.you.energyColors!.find((r) => r.card === id)!.paymentColors;
function refusal(s: VmState, card: string) {
  assert.ok(!offered(s, card));
  const row = engine.rejectedActions(ctx, s, engine.legalActions(ctx, s)).find((r) => r.action.type === "activate" && r.action.card === card);
  assert.ok(row); assert.ok(row.why.some((r) => r.kind === "energyColour" || r.kind === "energy"));
  const before = JSON.stringify(s); assert.throws(() => activate(s, card), IllegalAction); assert.equal(JSON.stringify(s), before);
}
const grant = (s: VmState, id: string, until: "turn" | "whileSourceInPlay" = "turn", source?: string) => addEffect(s, [], { kind: "gains", target: id, value: { names: [], characters: [], traits: [], colors: ["Blue"] }, until, source, master: "p1" });

// §§1-2-3, 2-2 and 5-3: real Blue Senzu activation and actual rest agree.
for (const mode of ["ordinary", "timed", "standing"] as const) {
  const a = fixture([mode === "ordinary" ? "B626" : "R626"], mode === "standing" ? "SRC626" : undefined);
  if (mode === "timed") { refusal(a.s, a.card); grant(a.s, a.resources[0]); }
  assert.ok(offered(a.s, a.card)); assert.ok(colors(a.s, a.resources[0]).includes("Blue"));
  assert.deepEqual(attrsNow(ctx, game, a.s, a.resources[0]).originalColors, [mode === "ordinary" ? "Blue" : "Red"]);
  const result = activate(a.s, a.card); assert.equal(result.state.cards[a.resources[0]].mode, "rest");
  assert.equal(result.events.filter((e) => e.type === "mode" && e.card === a.resources[0] && e.mode === "rest").length, 1);
  assert.ok(result.state.sides.p1.zones.drop.includes(a.card));
}
// Static and resolved source-bound grants end on real movement, not stale cached layers.
for (const mode of ["standing", "resolved"] as const) {
  const a = fixture(["R626"], "SRC626");
  if (mode === "resolved") { a.s.cards[a.granting!].cardId = "F626"; grant(a.s, a.resources[0], "whileSourceInPlay", a.granting); }
  assert.ok(offered(a.s, a.card));
  moved(ctx, game, a.s, [], a.granting!, "drop", { owner: "p1" });
  assert.deepEqual(colors(a.s, a.resources[0]), ["Red"]); refusal(a.s, a.card);
}
// Timed expiry runs through the turn, without paying the Extra first.
{
  const a = fixture(); grant(a.s, a.resources[0]); assert.ok(offered(a.s, a.card));
  let s = a.s;
  for (let n = 0; n < 20 && s.prompt.kind !== "main"; n++) {
    const row = engine.legalActions(ctx, s).find((r) => r.action.type === "pass" || (r.action.type === "zEnergyFromCombo" && r.action.card === null)); assert.ok(row); s = act(s, row.action);
  }
  assert.equal(s.prompt.kind, "main"); s = act(s, { type: "endMain", player: "p2" });
  assert.deepEqual(colors(s, a.resources[0]), ["Red"]);
  // The next battle is outside the first-turn attack restriction.
  s = act(s, { type: "charge", player: "p1", card: null }, { type: "attack", player: "p1", attacker: s.sides.p1.zones.leader[0], target: s.sides.p2.zones.leader[0] });
  refusal(s, a.card);
}
// Hidden Mode ignores even a public colour grant (§23-5-2-1), but can pay {1}.
{
  const a = fixture(); a.s.cards[a.resources[0]].hidden = true; grant(a.s, a.resources[0]);
  assert.deepEqual(colors(a.s, a.resources[0]), []); refusal(a.s, a.card);
  const paid = apply(a.s, { type: "combo", player: "p1", card: a.combo });
  assert.equal(paid.state.cards[a.resources[0]].mode, "rest"); assert.ok(paid.state.sides.p1.zones.combo.includes(a.combo));
  for (const viewer of ["p1", "p2"] as const) {
    const view = snap(a.s, viewer).view; const side = viewer === "p1" ? view.you : view.them;
    assert.deepEqual(side.energy.find((c) => c.id === a.resources[0])!.colors, []);
    assert.equal(side.energy.find((c) => c.id === a.resources[0])!.name, "Face-down card");
    assert.notEqual(side.energy.find((c) => c.id === a.resources[0])!.cardId, "R626", "Hidden Mode withholds the printed identity from both viewers");
  }
}
// 1-14-2: markers follow the Leader's current colours, not another energy card.
{
  const a = fixture([]); a.s.sides.p1.attrs.energyMarkers = 1; refusal(a.s, a.card);
  grant(a.s, a.s.sides.p1.zones.leader[0]); assert.ok(offered(a.s, a.card));
  const result = activate(a.s, a.card); assert.equal(result.state.sides.p1.attrs.energyMarkers, 0);
  assert.equal(result.events.filter((e) => e.type === "mode").length, 0);
}
// 20-19: AS energy uses current colours; AS Blue stays the explicit rule colour.
for (const payerDef of ["AS626", "EXPLICIT626"] as const) {
  const a = fixture([], payerDef); const payer = a.granting!;
  if (payerDef === "AS626") { refusal(a.s, a.card); grant(a.s, payer); }
  assert.ok(offered(a.s, a.card)); const result = activate(a.s, a.card);
  assert.equal(result.state.cards[payer].mode, "rest"); assert.ok(result.state.sides.p1.zones.battle.includes(payer));
  assert.equal(result.events.filter((e) => e.type === "mode" && e.card === payer && e.mode === "rest").length, 1);
}
{
  const a = fixture([], "EXPLICITRED626"); grant(a.s, a.granting!);
  refusal(a.s, a.card); // Gaining Blue does not broaden an explicit AS Red permission.
}
// A supported resolved AS-energy permission may name a Hidden Mode card;
// neither its printed Red nor a granted Blue pays a specified orb.
{
  const a = fixture([]); const payer = put(a.s, "R626", "battle"); a.s.cards[payer].hidden = true;
  addEffect(a.s, [], { kind: "payer", target: payer, value: 0, payAs: "energy", until: "turn", master: "p1" });
  grant(a.s, payer); refusal(a.s, a.card);
  const paid = apply(a.s, { type: "combo", player: "p1", card: a.combo });
  assert.equal(paid.state.cards[payer].mode, "rest"); assert.ok(paid.state.sides.p1.zones.battle.includes(payer));
}
// 20-21: an existing supported flat reduction leaves the remaining Blue orb payable.
{
  const a = fixture(); const card = put(a.s, "CHEAP626", "battle"); grant(a.s, a.resources[0]);
  refusal(a.s, card);
  addEffect(a.s, [], { kind: "skillCost", target: card, value: 1, colors: ["any"], skillKind: "activate", until: "turn", master: "p1" });
  assert.ok(offered(a.s, card)); const paid = activate(a.s, card); assert.equal(paid.state.cards[a.resources[0]].mode, "rest");
}
// Multiple real Blue payments suspend and reload; stale plans are revalidated.
{
  const a = fixture(["R626", "B626"]); grant(a.s, a.resources[0]);
  const pending = activate(a.s, a.card).state; assert.equal(pending.prompt.kind, "payCost");
  const before = snap(pending); assert.equal(before.view.prompt.payments!.length, 2);
  assert.equal(snap(pending, "p2").view.prompt.payments, undefined);
  assert.equal(snap(pending, "p2").legal.length, 0);
  for (const row of before.legal) {
    assert.equal(row.action.type, "payCost"); if (row.action.type !== "payCost") continue;
    const option = row.action.option;
    const preview = before.view.prompt.payments!.find((p) => p.option === option)!;
    assert.equal(preview.energyRest.length, 1); assert.ok(colors(pending, preview.energyRest[0]).includes("Blue"));
    const paid = apply(pending, row.action); assert.equal(paid.state.cards[preview.energyRest[0]].mode, "rest");
    const untouched = a.resources.find((id) => !preview.energyRest.includes(id))!; assert.equal(paid.state.cards[untouched].mode, "active");
    const serialized = JSON.stringify(paid.state); assert.throws(() => apply(paid.state, row.action), IllegalAction); assert.equal(JSON.stringify(paid.state), serialized);
  }
  const serialized = JSON.stringify(pending); assert.throws(() => apply(pending, { type: "payCost", player: "p1", option: 99 }), IllegalAction); assert.equal(JSON.stringify(pending), serialized);
  const stale = reload(pending); stale.effects = [];
  const oldRed = before.view.prompt.payments!.find((p) => p.energyRest.includes(a.resources[0]))!;
  assert.throws(() => apply(stale, { type: "payCost", player: "p1", option: oldRed.option }), IllegalAction);
  assert.ok(a.resources.every((id) => stale.cards[id].mode === "active"));
  const latest = snap(stale, "p1", 2); assert.equal(reconcileSnapshot(latest, before), latest);
  assert.deepEqual(snap(reload(pending)).view.prompt.payments, before.view.prompt.payments);
}
// Both viewers receive only public payer facts; private hand/life identity changes
// cannot affect energyColours and no interpreter frame is projected to either.
{
  const a = fixture(); grant(a.s, a.resources[0]); const changed = reload(a.s);
  for (const id of [...changed.sides.p1.zones.hand.filter((id) => id !== a.card), ...changed.sides.p2.zones.hand, ...changed.sides.p1.zones.life, ...changed.sides.p2.zones.life]) changed.cards[id].cardId = "B626";
  for (const viewer of ["p1", "p2"] as const) {
    const view = snap(a.s, viewer).view; const after = snap(changed, viewer).view;
    assert.equal(view.them.hand, null); assert.deepEqual(view.you.energyColors, after.you.energyColors); assert.deepEqual(view.them.energyColors, after.them.energyColors);
    const raw = JSON.stringify(view); assert.ok(!raw.includes('"frames"') && !raw.includes('"vars"') && !raw.includes('"originalColors"'));
    const publicFaces = new Set<string>();
    const faces = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(faces);
      else if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        if (typeof row.id === "string" && typeof row.cardId === "string" && row.cardId) publicFaces.add(row.id);
        Object.values(row).forEach(faces);
      }
    };
    faces(view);
    const other = viewer === "p1" ? "p2" : "p1";
    for (const id of [...a.s.sides[other].zones.hand, ...a.s.sides.p1.zones.life, ...a.s.sides.p2.zones.life]) assert.ok(!publicFaces.has(id), `${viewer} saw private card/current-cost information for ${id}`);
  }
}
console.log("Effective payment colours #626: real Senzu offers/rest/refusals, source/expiry, hidden colourless, markers, AS energy/explicit Blue, reduction, selected/reloaded/stale payment and privacy passed; unsupported alternative grammar remains unchanged");

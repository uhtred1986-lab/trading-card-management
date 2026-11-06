/** R510: full actual Cell/Android records; the legal Z-Leader pile is staged.
 * Opponent attack, battle damage, price and parent resolution are native. */
import assert from "node:assert/strict";
import frozen from "./fixtures/auto-play-cost-5.json";
import counters from "./fixtures/auto-play-cost-counters-5.json";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { underOpponentPlayPrice, paidArrivalWasActive } from "../../src/lib/arena/vm/auto-play-cost";
import { arrivalAutoWasActive } from "../../src/lib/arena/vm/skill-play-scope";
import type { ScriptFrame, Op } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { requireAutoPlayProgram } from "../../src/lib/arena/vm/auto-play-cost-runtime";
import { freshAppliedEffectRoot } from "../../src/lib/arena/vm/applied-effect-receipt";
const defs: Record<string, CardDef> = {
  L: card("L", { type: "LEADER", colors: ["Green"], characters: ["Cell"], traits: ["Frieza's Army"], power: 20000 }), F: card("F", {}), E: card("E", { colors: ["Yellow", "Blue"] }),
};
for (const { card: c } of frozen) defs[c.id] = card(c.id, {
  type: c.type as CardDef["type"], colors: c.colors as Color[], energyCost: c.cost === null ? null : Number(c.cost),
  zEnergyCost: Number(c.z ?? 0), power: c.power, name: c.name, characters: c.characters, traits: c.traits, skill: c.skill,
  ...(c.backSkill ? { back: { name: c.backName!, skill: c.backSkill, power: 10000 } } : {}),
});
for (const { card: c } of counters) defs[c.id] = card(c.id, {
  type: c.type as CardDef["type"], colors: c.colors as Color[], energyCost: c.cost === null ? null : Number(c.cost),
  power: c.power, name: c.name, characters: c.characters, traits: c.traits, skill: c.skill,
});
const rows = Object.values(defs).flatMap(skillRecords);
for (const source of frozen) assert.deepEqual(JSON.parse(JSON.stringify(rows.filter(r => r.cardId === source.card.id))), source.records);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((r, id) => ({ ...r, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const sourceRow = rows.find(r => r.cardId === "BT21-071" && r.skillIndex === 30)!;
assert.deepEqual(runtimeSupportOfRow(sourceRow).unsupported, []);
assert.ok(runtimeSupportOfRow(sourceRow).unknown.some(s => s.includes("Auto play-cost")));
function setup(p: PlayerId, foreignOwner: boolean, counter?: string, scenario = "ordinary") {
  const foe: PlayerId = p === "p1" ? "p2" : "p1";
  let state = RULES.createGame(ctx, { seed: 510, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  const events: GameEvent[] = [];
  const take = (a: Action) => {
    const saved = copy(state), before = JSON.stringify(saved);
    for (const seat of ["p1", "p2"] as const) {
      const view = RULES.boardView(ctx, copy(saved), seat, {});
      assert.doesNotMatch(JSON.stringify(view), /"(?:autoPlayCost|paidArrivalWitness|paymentRoot|paidCost)"/);
    }
    const r = RULES.apply(ctx, saved, a); assert.equal(JSON.stringify(saved), before);
    state = r.state as VmState; events.push(...r.events);
    assert.doesNotMatch(JSON.stringify(r.events), /"(?:autoPlayCost|paidArrivalWitness|paymentRoot|paidCost)"/);
    assert.equal(state.outcome, undefined, JSON.stringify(state.outcome));
  };
  for (const a of [{ type: "chooseFirst", player: state.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: foe, redraw: false }, { type: "charge", player: p, card: null }, { type: "endMain", player: p }, { type: "charge", player: foe, card: null }] as Action[]) take(a);
  const cell = state.sides[p].zones.leader[0], attacker = state.sides[foe].zones.leader[0];
  state.cards[cell].cardId = "BT21-071"; state.cards[cell].zCard = true;
  const stage = (id: string, owner: PlayerId) => {
    const c = state.sides[owner].zones.deck.at(-1)!; state.cards[c].cardId = id;
    assert.ok(moveCard(state, game, c, "under", { under: cell }).ok); return c;
  };
  const android = stage("BT21-087", foreignOwner ? foe : p), next = stage("BT21-072", p);
  const extra = scenario === "mixed" ? stage("BT21-087", p) : undefined;
  const counterCard = counter ? state.sides[foe].zones.deck.at(-1)! : undefined;
  if (counterCard) {
    state.cards[counterCard].cardId = counter!;
    assert.ok(moveCard(state, game, counterCard, "hand", { owner: foe }).ok);
    for (let n = 0; n < 3; n++) {
      const e = state.sides[foe].zones.deck.at(-1)!; state.cards[e].cardId = "E";
      assert.ok(moveCard(state, game, e, "energy", { owner: foe }).ok); state.cards[e].mode = "active";
    }
  }
  state.cards[next].zCard = true;
  while (state.sides[p].zones.life.length > 4) assert.ok(moveCard(state, game, state.sides[p].zones.life.at(-1)!, "hand", { owner: p }).ok);
  if (scenario === "mixed" || scenario === "prohibited") vmHost(ctx, game, state, []).addEffect({ target: android, kind: "forbid", value: 0, until: "turn", forbid: { what: "play" } });
  const advance = (stop: () => boolean) => {
    for (let i = 0; i < 80; i++) {
      if (stop()) return;
      const legal = RULES.legalActions(ctx, state).map(x => x.action);
      const a = legal.find(a => a.type === "counter" && a.card === null) ?? legal.find(a => a.type === "block" && a.card === null)
        ?? legal.find(a => a.type === "payCost") ?? legal.find(a => a.type === "pass") ?? legal.find(a => a.type === "orderPending") ?? legal.find(a => a.type === "zEnergyFromCombo" && a.card === null);
      assert.ok(a, JSON.stringify(state.prompt)); take(a);
    }
    throw Error("native progression bound");
  };
  events.length = 0;
  take({ type: "attack", player: foe, attacker, target: cell });
  advance(() => state.prompt.kind === "chooseMode" || state.prompt.kind === "main" && !state.battle);
  return { get state() { return state; }, take, advance, events, cell, android, next, foe, counterCard, extra };
}
let cases = 0;
for (const p of ["p1", "p2"] as const) for (const foreign of [false, true]) {
  const b = setup(p, foreign);
  assert.equal(b.state.sides[p].zones.life.length, 3);
  assert.ok(b.state.cards[b.cell].under.includes(b.android));
  assert.ok(!b.events.some(e => e.type === "skill" && e.card === b.cell && e.skill === 30));
  const pay = RULES.legalActions(ctx, b.state).map(x => x.action).find(a => a.type === "chooseMode" && a.index === 0);
  assert.ok(pay); b.take(pay);
  assert.equal(b.state.cards[b.android].owner, foreign ? b.foe : p);
  assert.ok(b.state.sides[b.foe].zones.battle.includes(b.android));
  assert.equal(b.state.cards[b.android].mode, "active");
  assert.ok(b.state.pending.some(x => x.kind !== "hook" && x.card === b.android && x.paidArrivalWitness));
  const move = b.events.findIndex(e => e.type === "move" && e.card === b.android && e.to === "battle");
  const activation = b.events.findIndex(e => e.type === "skill" && e.card === b.cell && e.skill === 30);
  assert.ok(move >= 0 && activation > move);
  assert.equal(b.state.prompt.kind, "chooseCards");
  b.take({ type: "choose", player: p, cards: [b.next] });
  b.advance(() => b.state.prompt.kind === "main");
  assert.ok(b.state.sides[p].zones.leader.includes(b.next));
  assert.equal(b.events.filter(e => e.type === "draw" && e.player === p).length, 1); // actual Android Auto
  cases++;
}
for (const p of ["p1", "p2"] as const) for (const timing of ["before", "after"] as const) {
  const b = setup(p, true, "BT1-107");
  b.take({ type: "chooseMode", player: p, index: 0 });
  assert.equal(b.state.prompt.kind, "counter");
  assert.equal(b.state.resolving?.landed, true);
  assert.equal(b.state.resolving?.scopeWindow?.boundary, "before");
  if (timing === "before") b.take({ type: "counter", player: b.foe, card: b.counterCard! });
  else b.take({ type: "counter", player: b.foe, card: null });
  b.advance(() => b.state.prompt.kind === "chooseCards");
  b.take({ type: "choose", player: p, cards: [b.next] });
  if (timing === "after") {
    assert.equal(b.state.prompt.kind, "counter");
    assert.equal(b.state.resolving?.landed, true);
    assert.equal(b.state.resolving?.scopeWindow?.boundary, "after");
    b.take({ type: "counter", player: b.foe, card: b.counterCard! });
  }
  b.advance(() => b.state.prompt.kind === "main");
  assert.ok(b.state.effects.some(e => e.target === b.android && e.kind === "negateSkills"));
  assert.equal(b.events.filter(e => e.type === "skill" && e.card === b.android && e.skill === 10).length, 1);
  assert.equal(b.events.filter(e => e.type === "draw" && e.player === p).length, 1);
  cases++;
}
for (const p of ["p1", "p2"] as const) {
  const b = setup(p, false);
  b.take({ type: "chooseMode", player: p, index: 1 });
  b.advance(() => b.state.prompt.kind === "main");
  assert.ok(b.state.cards[b.cell].under.includes(b.android));
  assert.ok(!b.events.some(e => e.type === "skill" && e.card === b.cell && e.skill === 30));
  cases++;

  const rest = setup(p, true, "BT1-110");
  rest.take({ type: "chooseMode", player: p, index: 0 });
  assert.equal(rest.state.resolving?.landed, true);
  rest.take({ type: "counter", player: rest.foe, card: rest.counterCard! });
  rest.advance(() => rest.state.prompt.kind === "chooseCards");
  assert.equal(rest.state.cards[rest.android].mode, "active");
  rest.take({ type: "choose", player: p, cards: [] });
  rest.advance(() => rest.state.prompt.kind === "main");
  assert.equal(rest.state.cards[rest.android].mode, "active");
  assert.ok(rest.state.sides[p].zones.leader.includes(rest.cell));
  cases++;

  const initial = setup(p, true);
  const mutations: Record<string, (s: VmState, f: ScriptFrame) => void> = {
    missingReceipt: (_s, f) => { delete f.autoPlayCost; },
    missingOrigin: (_s, f) => { delete f.skillEffectOrigin; },
    missingRoot: (_s, f) => { delete (f.autoPlayCost as unknown as Record<string, unknown>).paymentRoot; },
    wrongRoot: (_s, f) => { f.autoPlayCost!.paymentRoot.kind = "auto"; },
    wrongAlias: (_s, f) => { f.autoPlayCost!.alias = "unbound"; },
    wrongBody: (_s, f) => { f.autoPlayCost!.body = []; },
    wrongCondition: (_s, f) => { f.autoPlayCost!.declaration.price!.condition = null; },
    wrongResources: (_s, f) => { f.autoPlayCost!.declaration.price!.payment.orbs = { Green: 1 }; },
    wrongKind: (_s, f) => { f.autoPlayCost!.declaration.kind = "activate:main"; },
    wrongTrigger: (_s, f) => { f.autoPlayCost!.declaration.trigger = ["played"]; },
    wrongUsage: (_s, f) => { f.autoPlayCost!.declaration.usage!.oncePerTurn = true; },
    wrongEffect: (_s, f) => { f.autoCost!.effect = []; },
    wrongPrice: (_s, f) => { f.autoPlayCost!.price = [null, {}] as unknown as Op[]; },
    futurePayer: (_s, f) => { f.autoPlayCost!.offered[0].epoch++; },
    emptyHistory: (_s, f) => { f.autoPlayCost!.offered = []; },
    sourceEpoch: s => { s.cards[initial.cell].zoneEpoch = (s.cards[initial.cell].zoneEpoch ?? 0) + 2; },
    sourceFace: s => { s.cards[initial.cell].flipped = true; },
    sourceHolder: s => { s.sides[p].zones.leader = []; s.sides[initial.foe].zones.leader.push(initial.cell); },
    payerEpoch: s => { s.cards[initial.android].zoneEpoch = (s.cards[initial.android].zoneEpoch ?? 0) + 2; },
    duplicateHost: s => { s.cards[s.sides[initial.foe].zones.leader[0]].under.push(initial.android); },
    payerOwner: s => { s.cards[initial.android].owner = p; },
    varsMissing: (_s, f) => { delete (f as unknown as Record<string, unknown>).vars; },
    varsNull: (_s, f) => { f.vars = null as unknown as ScriptFrame["vars"]; },
    varsArray: (_s, f) => { f.vars = [] as unknown as ScriptFrame["vars"]; },
    replacementFrame: (_s, f) => { f.replacing = {} as ScriptFrame["replacing"]; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const saved = copy(initial.state), f = saved.programs.find(f => f.autoCost)!;
    assert.ok(f); mutate(saved, f); const before = JSON.stringify(saved);
    let refused = false;
    try {
      const r = RULES.apply(ctx, saved, { type: "chooseMode", player: p, index: 0 });
      refused = (r.state as VmState).outcome?.kind === "interrupted";
      assert.ok(!r.events.some(e => e.type === "move" && e.card === initial.android), name);
      assert.ok(!r.events.some(e => e.type === "skill" && e.card === initial.cell && e.skill === 30), name);
    } catch (error) { assert.ok(error instanceof Error && !(error instanceof TypeError), name); refused = true; }
    assert.ok(refused, name); assert.equal(JSON.stringify(saved), before, name); cases++;
  }
  const witnessed = setup(p, true, "BT1-107");
  witnessed.take({ type: "chooseMode", player: p, index: 0 });
  const pending = witnessed.state.pending.find(x => x.kind !== "hook" && x.card === witnessed.android)!;
  assert.ok(pending.kind !== "hook");
  const absent = copy(witnessed.state); delete absent.cards[witnessed.android];
  assert.equal(paidArrivalWasActive(pending, absent), true); cases++;
  for (const epoch of [-1, NaN, pending.paidArrivalWitness!.arrival.epoch - 1]) {
    const changed = copy(witnessed.state); changed.cards[witnessed.android].zoneEpoch = epoch;
    assert.throws(() => paidArrivalWasActive(pending, changed), /R510/); cases++;
  }
  const conflicting = copy(pending);
  conflicting.arrivalWitness = { version: 1, scope: 1, skillIndex: pending.skillIndex, source: pending.paidArrivalWitness!.source, arrival: pending.paidArrivalWitness!.arrival };
  assert.throws(() => arrivalAutoWasActive(conflicting, witnessed.state), /conflicting/); cases++;
  const invented = copy(pending); invented.paidArrivalWitness!.payment.paymentRoot.source.area = "invented";
  assert.throws(() => paidArrivalWasActive(invented, witnessed.state), /R510/); cases++;
  const missingPaid = copy(witnessed.state);
  delete missingPaid.skillPlayScopes!.at(-1)!.window!.programs[0].autoPlayCost;
  const missingBefore = JSON.stringify(missingPaid);
  assert.throws(() => RULES.apply(ctx, missingPaid, { type: "counter", player: witnessed.foe, card: null }), /R510/);
  assert.equal(JSON.stringify(missingPaid), missingBefore); cases++;
  const independent = copy(witnessed.state.skillPlayScopes!.at(-1)!.window!.programs[0]);
  assert.ok(independent.autoPlayCost);
  freshAppliedEffectRoot(witnessed.state, independent, "invoke");
  assert.equal(independent.autoPlayCost, undefined); cases++;

  const mixed = setup(p, false, undefined, "mixed");
  mixed.take({ type: "chooseMode", player: p, index: 0 });
  assert.ok(mixed.state.cards[mixed.cell].under.includes(mixed.android));
  assert.ok(mixed.state.sides[mixed.foe].zones.battle.includes(mixed.extra!));
  mixed.take({ type: "choose", player: p, cards: [] });
  mixed.advance(() => mixed.state.prompt.kind === "main"); cases++;
  const prohibited = setup(p, false, undefined, "prohibited");
  assert.equal(prohibited.state.prompt.kind, "main");
  assert.ok(prohibited.state.cards[prohibited.cell].under.includes(prohibited.android));
  assert.ok(!prohibited.events.some(e => e.type === "skill" && e.card === prohibited.cell && e.skill === 30)); cases++;
}
for (const invalid of [null, {}, [null, {}], [{ op: "choose", sel: null }, { op: "play" }], [{ op: "choose", sel: {}, as: undefined }, { op: "play", target: {} }]]) {
  assert.equal(underOpponentPlayPrice(invalid as unknown as Op[]), null); cases++;
}
for (const p of ["p1", "p2"] as const) for (const timing of ["before", "after"] as const) {
  const b = setup(p, true, "DB2-169");
  const savedCounterPayment = () => {
    assert.equal(b.state.prompt.kind, "payCost");
    for (const corrupt of ["landed", "receipt"]) {
      const bad = copy(b.state);
      if (corrupt === "landed") delete bad.resolving!.landed;
      else delete bad.skillPlayScopes!.at(-1)!.paidCost;
      const before = JSON.stringify(bad);
      assert.throws(() => RULES.apply(ctx, bad, { type: "payCost", player: b.foe, option: 0 }), /rebuild/);
      assert.equal(JSON.stringify(bad), before); cases++;
    }
  };
  b.take({ type: "chooseMode", player: p, index: 0 });
  assert.equal(b.state.prompt.kind, "counter");
  if (timing === "before") { b.take({ type: "counter", player: b.foe, card: b.counterCard! }); savedCounterPayment(); }
  else b.take({ type: "counter", player: b.foe, card: null });
  b.advance(() => b.state.prompt.kind === "chooseCards");
  b.take({ type: "choose", player: p, cards: [] });
  if (timing === "after") { b.take({ type: "counter", player: b.foe, card: b.counterCard! }); savedCounterPayment(); }
  b.advance(() => b.state.prompt.kind === "main");
  assert.ok(!b.state.sides[b.foe].zones.battle.includes(b.counterCard!));
  assert.ok(!b.state.effects.some(e => e.target === b.android && e.kind === "negateSkills"));
  assert.ok(b.state.sides[b.foe].zones.battle.includes(b.android));
  assert.equal(b.events.filter(e => e.type === "skill" && e.card === b.android && e.skill === 10).length, 1);
  cases++;
}
for (const p of ["p1", "p2"] as const) for (const timing of ["before", "after"] as const) {
  const b = setup(p, true, "BT1-107");
  b.take({ type: "chooseMode", player: p, index: 0 });
  if (timing === "after") {
    b.take({ type: "counter", player: b.foe, card: null });
    b.take({ type: "choose", player: p, cards: [b.next] });
  }
  assert.equal(b.state.resolving?.scopeWindow?.boundary, timing);
  for (const mutate of [
    (s: VmState) => { delete s.skillPlayScopes!.at(-1)!.arrivalTiming; },
    (s: VmState) => { delete s.skillPlayScopes!.at(-1)!.paidCost; },
    (s: VmState) => { delete s.skillPlayScopes!.at(-1)!.arrivalTiming; delete s.skillPlayScopes!.at(-1)!.paidCost; },
    (s: VmState) => { delete s.resolving!.landed; },
    (s: VmState) => { s.skillPlayScopes!.at(-1)!.paidCost!.arrival!.epoch++; },
    (s: VmState) => { s.resolving!.scopeWindow!.boundary = timing === "before" ? "after" : "before"; },
  ]) for (const answer of [null, b.counterCard!]) {
    const bad = copy(b.state); mutate(bad); const before = JSON.stringify(bad);
    assert.throws(() => RULES.legalActions(ctx, bad), /rebuild/);
    assert.throws(() => RULES.apply(ctx, bad, { type: "counter", player: b.foe, card: answer }), /rebuild/);
    assert.equal(JSON.stringify(bad), before); cases++;
  }
}
const sourceSaved = setup("p1", false);
for (const mutate of [
  (script: NonNullable<EngineContext["scripts"]>[string]["bySkill"][number]) => { script.price!.condition = null; },
  (script: NonNullable<EngineContext["scripts"]>[string]["bySkill"][number]) => { script.price!.payment.orbs = { Green: 1 }; },
  (script: NonNullable<EngineContext["scripts"]>[string]["bySkill"][number]) => { script.kind = "activate:main"; },
  (script: NonNullable<EngineContext["scripts"]>[string]["bySkill"][number]) => { script.trigger = ["played"]; },
]) {
  const changed = copy(ctx), f = copy(sourceSaved.state.programs.find(f => f.autoCost)!);
  mutate(changed.scripts!["BT21-071"].bySkill[30]);
  assert.throws(() => requireAutoPlayProgram(changed, f), /R510/); cases++;
}
for (const change of [
  (r: typeof sourceRow) => { r.cost!.orbs = { Green: 1 }; },
  (r: typeof sourceRow) => { r.cost!.marker = 0; },
  (r: typeof sourceRow) => { r.cost!.burst = 0; },
  (r: typeof sourceRow) => { r.cost!.spiritBoost = 0; },
  (r: typeof sourceRow) => { r.cost!.x = { min: 0, max: 1 }; },
  (r: typeof sourceRow) => { r.ops = [{ op: "play", target: { sel: { special: "self" } } }]; },
  (r: typeof sourceRow) => { (r.cost!.program![0] as Extract<Op, { op: "choose" }>).sel.upTo = true; },
  (r: typeof sourceRow) => { (r.cost!.program![0] as Extract<Op, { op: "choose" }>).sel.filter!.unreadable = true; },
]) {
  const row = copy(sourceRow); change(row);
  assert.ok(runtimeSupportOfRow(row).unsupported.length);
  const loaded = rulesFromRows([{ ...row, id: 510, status: "draft", source: "compiler" } as unknown as RuleRow], defs);
  assert.ok(loaded["BT21-071"].bySkill[30].unsupported.length); cases++;
}
console.log(`Auto play cost: ${cases} cases`);

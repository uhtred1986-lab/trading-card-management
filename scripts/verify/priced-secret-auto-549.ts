import { zeroSkillPrice } from "../../src/lib/arena/vm/skill-payment";
/** 9-6-3-1-1 / 9-6-4: synthetic secret-area priced Auto declaration. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { describeEvents } from "../../src/lib/arena/games";
import { narrate } from "../../src/lib/arena/narration";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmToBeats } from "../../src/lib/arena/vm/beats";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { run } from "../../src/lib/arena/vm/flow";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { battleLink, msFor } from "../../src/components/arena/stage/motion";
import type { Beat, Beats } from "../../src/lib/arena/beats";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
// No printed card or ruling is asserted by this fixture: these records isolate
// the manual's declaration/price boundary and the supported price operations.
const defs = { ...DEFS,
  PRICE549: card("PRICE549", { energyCost: 0, skill: "[Auto] {r}: When you play this card, draw 1 card." }),
  ACTION549: card("ACTION549", { energyCost: 0, skill: "[Auto] Choose 1 card in your hand and place it in its owner's Drop Area: When you play this card, draw 1 card." }),
  OTHER549: card("OTHER549", { energyCost: 0, skill: null }),
  ENERGY549: card("ENERGY549", { colors: ["Red"], energyCost: 0, skill: null }),
};
const scripts = rulesFromCompiler(defs);
for (const id of ["PRICE549", "ACTION549"] as const) {
  const old = scripts[id].bySkill[0];
  assert.ok(old);
  scripts[id].bySkill[0] = { ...old, trigger: ["played"], unsupported: [], ops: [{ op: "draw", n: 1 }],
    price: { ...zeroSkillPrice(), ...old.price, condition: null, ops: id === "ACTION549" ? [
      { op: "choose", sel: { area: "hand", side: "you", count: 1 }, as: "paid" },
      { op: "moveTo", target: { var: "paid" }, to: "drop" },
    ] : null } };
}
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (state: VmState): VmState => JSON.parse(JSON.stringify(state));

function main(): VmState {
  let state = rules.createGame(ctx, { seed: 5493, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = rules.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = rules.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: keyof typeof defs, area: "hand" | "energy" = "hand"): string {
  const source = state.sides.p1.zones.hand.find((candidate) => !["PRICE549", "ACTION549", "OTHER549", "ENERGY549"].includes(state.cards[candidate].cardId));
  assert.ok(source);
  state.cards[source].cardId = id;
  if (area !== "hand") assert.ok(moveCard(state, dbs, source, area, { owner: "p1" }).ok);
  return source;
}
function pending(state: VmState, card: string): void {
  state.pending.push({ card, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, state, []);
  assert.equal(state.prompt.kind, "orderPending");
}
function order(state: VmState, index = 0, decline = false, player: PlayerId = "p1") {
  return rules.apply(ctx, reload(state), { type: "orderPending", player, index, ...(decline ? { decline: true as const } : {}) }) as { state: VmState; events: GameEvent[] };
}
function mode(state: VmState, index: number, player: PlayerId = "p1") {
  return rules.apply(ctx, reload(state), { type: "chooseMode", player, index }) as { state: VmState; events: GameEvent[] };
}
function choose(state: VmState, cards: string[], player: PlayerId = "p1") {
  return rules.apply(ctx, reload(state), { type: "choose", player, cards }) as { state: VmState; events: GameEvent[] };
}
function beats(state: VmState, events: GameEvent[], before: Beats | null = null): Beats {
  const next = vmToBeats(ctx, state, events, before?.seq ?? 0);
  return before ? { seq: next.seq, list: [...before.list, ...next.list], art: { ...before.art, ...next.art } } : next;
}
function snapshot(state: VmState, viewer: PlayerId, history: Beats | null = null) {
  return buildSnapshot({ id: 5493, mode: "versus", status: "playing", p1Name: "First", p2Name: "Second", ctx, state, legal: rules.legalActions(ctx, state), log: [], beats: history, spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
function skillCount(events: GameEvent[], card: string): number { return events.filter((event) => event.type === "skill" && event.card === card).length; }

// A priced secret Auto has the same optional declaration as a cost-free one.
// Neither payment nor activation occurs while the source/skill is being chosen.
{
  const state = main(); const source = stage(state, "PRICE549"); const other = stage(state, "OTHER549"); const energy = stage(state, "ENERGY549", "energy");
  pending(state, source);
  assert.deepEqual(snapshot(state, "p1").legal.filter((entry) => entry.action.type === "orderPending").map((entry) => entry.action), [
    { type: "orderPending", player: "p1", index: 0 }, { type: "orderPending", player: "p1", index: 0, decline: true },
  ]);
  assert.equal(snapshot(state, "p2").view.prompt.kind, "waiting");
  assert.ok(!JSON.stringify(snapshot(state, "p2")).includes("PRICE549"));
  assert.equal(state.cards[energy].mode, "active");
  for (const [index, player] of [[0, "p2"], [-1, "p1"]] as const) {
    const before = JSON.stringify(state);
    assert.throws(() => order(state, index, false, player), IllegalAction);
    assert.equal(JSON.stringify(state), before);
  }
  const stale = reload(state); stale.pending[0].subject = other;
  const beforeStale = JSON.stringify(stale);
  assert.throws(() => order(stale), IllegalAction);
  assert.equal(JSON.stringify(stale), beforeStale);
  const silent = order(state, 0, true);
  assert.equal(silent.state.cards[energy].mode, "active");
  assert.equal(silent.events.some((event) => event.type === "skill" || event.type === "autoDeclared" || event.type === "draw"), false);
  assert.ok(!JSON.stringify(snapshot(silent.state, "p2", beats(silent.state, silent.events))).includes("PRICE549"));

  const declared = order(state);
  assert.equal(declared.state.prompt.kind, "chooseMode");
  assert.equal(declared.state.cards[energy].mode, "active");
  assert.equal(skillCount(declared.events, source), 0, "the probe's fired predicate sees no skill before payment");
  assert.equal(declared.events.filter((event) => event.type === "autoDeclared").length, 1);
  assert.equal(declared.events.filter((event) => event.type === "draw").length, 0);
  const declaration = declared.events.find((event) => event.type === "autoDeclared");
  assert.ok(declaration && declaration.type === "autoDeclared");
  const history = beats(declared.state, declared.events);
  for (const viewer of ["p1", "p2"] as const) {
    const shown = snapshot(reload(declared.state), viewer, history);
    // p1 reads its own hand; p2 is shown the card under an opaque name, never its instance id (`conceal.ts`).
    const as = viewer === "p1" ? source : "?shown:0";
    assert.equal(shown.beats?.art[as]?.cardId, "PRICE549");
    if (viewer === "p2") assert.ok(!JSON.stringify(shown).includes(`"${source}"`), "the declared card's instance id is not on p2's board");
    assert.equal(shown.beats?.art[other], undefined);
    assert.ok(!JSON.stringify(shown).includes("revealEpoch"));
    const said = shown.beats?.list.find((beat) => beat.t === "autoDeclared" && beat.card === as);
    assert.ok(said && said.t === "autoDeclared");
    const publicDeclared: Beat = said;
    assert.equal(Object.hasOwn(publicDeclared, "revealEpoch"), false, "both viewers receive a valid declaration beat without the private epoch");
    const declarationLine = narrate(said, { viewer, them: "Opponent", art: shown.beats?.art ?? {}, ownerOf: () => "p1" }) ?? "";
    assert.match(declarationLine, /declare(?:s)? Auto on PRICE549/i);
    assert.ok(!declarationLine.includes("《") && !declarationLine.includes("》"));
    assert.equal(battleLink(said, true), null, "a declaration does not count as a battle trigger");
    assert.ok(msFor(said) > 0);
  }
  const declined = mode(declared.state, 1);
  assert.equal(skillCount(declined.events, source), 0);
  assert.equal(declined.events.filter((event) => event.type === "draw").length, 0);
  assert.equal(declined.state.cards[energy].mode, "active");
  const later = rules.apply(ctx, reload(declined.state), { type: "pass", player: "p1" });
  const old = snapshot(later.state as VmState, "p2", history);
  assert.equal(old.beats?.art[source], undefined);
  assert.equal(old.beats?.art["?shown:0"], undefined);
  const oldDeclaration = old.beats?.list.find((beat) => beat.t === "autoDeclared");
  assert.equal(oldDeclaration?.t === "autoDeclared" ? oldDeclaration.card : undefined, "?", "a lapsed declaration no longer names its card at all");
  assert.equal(oldDeclaration?.t === "autoDeclared" ? oldDeclaration.text : undefined, "");
  assert.ok(!JSON.stringify(old).includes("PRICE549"));
  assert.ok(!describeEvents(ctx, declined.state, [...declared.events, ...declined.events]).join(" ").includes("PRICE549"));

  const paid = mode(declared.state, 0);
  assert.equal(paid.state.cards[energy].mode, "rest");
  assert.equal(skillCount(paid.events, source), 1);
  assert.equal(paid.events.filter((event) => event.type === "draw").length, 1);
  const activated = paid.events.find((event) => event.type === "skill" && event.card === source);
  assert.ok(activated && activated.type === "skill" && activated.reveal);
  assert.equal(activated.revealEpoch, declaration.revealEpoch);
  const paidHistory = beats(paid.state, paid.events, history);
  assert.equal(snapshot(reload(paid.state), "p2", paidHistory).beats?.art["?shown:0"]?.cardId, "PRICE549");
  assert.ok(!describeEvents(ctx, paid.state, [...declared.events, ...paid.events]).join(" ").includes("PRICE549"), "paid secret activation must not leave a permanent name in the saved log");
  const afterPaid = rules.apply(ctx, reload(paid.state), { type: "pass", player: "p1" });
  const concealed = snapshot(afterPaid.state as VmState, "p2", paidHistory);
  assert.equal(concealed.beats?.art[source], undefined);
  assert.ok(concealed.beats?.list.every((beat) => (beat.t !== "skill" && beat.t !== "autoDeclared") || (beat.card === "?" && beat.text === "")));
}

// A supported action price suspends twice. Its declaration epoch stays bound
// to the same cost frame through the offer and the chosen-card answer.
{
  const state = main(); const source = stage(state, "ACTION549"); const other = stage(state, "OTHER549");
  pending(state, source);
  const declared = order(state);
  assert.equal(declared.state.prompt.kind, "chooseMode");
  const epoch = declared.state.programs[0]?.autoRevealEpoch;
  assert.ok(epoch);
  const history = beats(declared.state, declared.events);
  const paying = mode(declared.state, 0);
  assert.equal(paying.state.prompt.kind, "chooseCards");
  assert.equal(paying.state.programs[0]?.autoRevealEpoch, epoch);
  assert.equal(skillCount(paying.events, source), 0);
  assert.equal(snapshot(reload(paying.state), "p2", history).beats?.art["?shown:0"]?.cardId, "ACTION549");
  const before = JSON.stringify(paying.state);
  assert.throws(() => choose(paying.state, [other], "p2"), IllegalAction);
  assert.equal(JSON.stringify(paying.state), before);
  const paid = choose(paying.state, [other]);
  assert.equal(skillCount(paid.events, source), 1);
  const fired = paid.events.find((event) => event.type === "skill" && event.card === source);
  assert.ok(fired && fired.type === "skill" && fired.revealEpoch === epoch);
  assert.equal(paid.state.sides.p1.zones.drop.includes(other), true);
  assert.equal(snapshot(paid.state, "p2", beats(paid.state, paid.events, history)).beats?.art["?shown:0"]?.cardId, "ACTION549");
}

// An unaffordable declaration and two occurrences on one card remain distinct
// from activation; an old witness cannot lend its epoch to the next one.
{
  const state = main(); const source = stage(state, "PRICE549");
  pending(state, source);
  const unpaid = order(state);
  assert.equal(unpaid.state.prompt.kind, "main");
  assert.equal(skillCount(unpaid.events, source), 0);
  assert.equal(unpaid.events.filter((event) => event.type === "autoDeclared").length, 1);
  assert.ok(unpaid.events.some((event) => event.type === "note" && /unaffordable/.test(event.text)));
  assert.ok(!describeEvents(ctx, unpaid.state, unpaid.events).join(" ").includes("PRICE549"));
}
{
  const state = main(); const source = stage(state, "PRICE549"); stage(state, "ENERGY549", "energy");
  state.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  pending(state, source);
  const first = order(state, 1);
  assert.equal(first.state.prompt.kind, "chooseMode");
  const firstBeat = beats(first.state, first.events);
  const firstEpoch = first.state.programs[0]?.autoRevealEpoch;
  const declined = mode(first.state, 1);
  assert.equal(declined.state.prompt.kind, "orderPending");
  const second = order(declined.state);
  assert.equal(second.state.prompt.kind, "chooseMode");
  assert.notEqual(second.state.programs[0]?.autoRevealEpoch, firstEpoch);
  const history = beats(second.state, second.events, firstBeat);
  const oldBeat = snapshot(second.state, "p2", history).beats?.list.filter((beat) => beat.t === "autoDeclared") ?? [];
  assert.equal(oldBeat.length, 2);
  assert.deepEqual(oldBeat.map((beat) => beat.t === "autoDeclared" && beat.card), ["?", "?shown:0"], "only the live declaration names its card, and not by id");
  assert.equal(oldBeat[0].t === "autoDeclared" && oldBeat[0].text, "");
  assert.ok(oldBeat[1].t === "autoDeclared" && oldBeat[1].text.includes("draw 1"));
}

console.log("#549 priced secret Auto declaration, payment, continuation and masking: ok");

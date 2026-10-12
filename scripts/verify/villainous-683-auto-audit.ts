/** Standalone focused proof of Extra Auto Heroic/Villainous hook timing (#683). */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { run } from "../../src/lib/arena/vm/flow";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const defs = {
  ...DEFS,
  AUDIT_WATCH: card("AUDIT_WATCH", { energyCost: 0, skill: "[Villainous]" }),
  AUDIT_HERO_WATCH: card("AUDIT_HERO_WATCH", { energyCost: 0, skill: "[Heroic]" }),
  AUDIT_HERO_AUTO: card("AUDIT_HERO_AUTO", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Heroic]<br>[Auto] When you play this card, draw 1 card." }),
  AUDIT_AUTO: card("AUDIT_AUTO", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Villainous]<br>[Auto] When you play this card, draw 1 card." }),
  AUDIT_PAID: card("AUDIT_PAID", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Villainous]<br>[Auto] {r}: When you play this card, draw 1 card." }),
  AUDIT_MAIN: card("AUDIT_MAIN", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." }),
  AUDIT_MOVE: card("AUDIT_MOVE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Villainous]<br>[Auto] Place this card in its owner's Drop Area: When you play this card, draw 1 card." }),
};
const scripts = rulesFromCompiler(defs);
// Synthetic supported price op, isolated from whether the compiler reads that
// printed wording; #683 tests the already-supported activation continuation.
const moving = scripts.AUDIT_MOVE.bySkill[10];
assert.ok(moving);
scripts.AUDIT_MOVE.bySkill[10] = { ...moving, unsupported: [], ops: [{ op: "draw", n: 1 }],
  price: { condition: null, ops: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop" }] } };
const ctx: EngineContext = { ...CTX, defs, scripts };
const autoIndex = 10;
assert.equal(ctx.scripts!.AUDIT_AUTO.bySkill[autoIndex]?.ops[0]?.op, "draw", "fixture compiles the Extra Auto effect");

function main(seed: number): VmState {
  let current = rules.createGame(ctx, { seed, p1: { name: "First", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  current = rules.apply(ctx, current, { type: "chooseFirst", player: current.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && current.prompt.kind !== "main"; i++) {
    current = rules.apply(ctx, current, { type: "pass", player: (current.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.equal(current.prompt.kind, "main");
  return current;
}
let state = main(68314);
const reload = (current: VmState): VmState => JSON.parse(JSON.stringify(current));
function stage(id: string, area: "battle" | "energy" = "battle"): string {
  const physical = state.sides.p1.zones.hand.find((candidate) => !state.cards[candidate].cardId.startsWith("AUDIT_"));
  assert.ok(physical);
  state.cards[physical].cardId = id;
  assert.ok(moveCard(state, dbs, physical, area, { owner: "p1" }).ok);
  return physical;
}
const watcher = stage("AUDIT_WATCH");
const source = stage("AUDIT_AUTO");
assert.ok(hasKeyword(ctx, dbs, state, source, "Villainous"));
// This enters the already-pending Auto at the 9-6 checkpoint. It isolates the
// successful skill activation boundary from the unrelated Extra play route.
state.pending.push({ card: source, master: "p1", skillIndex: autoIndex, trigger: "played" });
const events: ReturnType<typeof rules.apply>["events"] = [];
run(ctx, dbs, state, events);
const activated = { state, events };
assert.equal(activated.events.filter((event) => event.type === "skill" && event.card === source).length, 1,
  "the Extra Auto activated successfully");
assert.equal(activated.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1,
  "the Extra Auto effect resolved");
const after = activated.state as VmState;
assert.equal(after.prompt.kind, "chooseCards", "the Auto effect finishes before Villainous asks the opponent");
assert.equal(after.prompt.player, "p2");
assert.ok(after.programs.some((frame) => frame.card === watcher && frame.pendingHookSkill && frame.skillIndex === 0),
  "the identified pending hook survives the opponent choice");
const freeChoice = after.prompt.choice.candidates[0];
assert.ok(freeChoice);
const freeResolved = rules.apply(ctx, reload(after), { type: "choose", player: "p2", cards: [freeChoice] });
assert.ok((freeResolved.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0));
assert.ok((freeResolved.state as VmState).sides.p2.zones.drop.includes(freeChoice));
console.log("#683 free Extra Auto: effect before persisted opponent choice, then one identified Villainous spend");

// A paid Auto reaches the same missing capture only after the accepted price.
state = main(68315);
const paidWatcher = stage("AUDIT_WATCH");
const paidSource = stage("AUDIT_PAID");
const energy = stage("AUDIT_AUTO", "energy");
state.pending.push({ card: paidSource, master: "p1", skillIndex: autoIndex, trigger: "played" });
const offerEvents: typeof events = [];
run(ctx, dbs, state, offerEvents);
assert.equal(state.prompt.kind, "chooseMode", "the priced Extra Auto offers payment");
assert.equal(offerEvents.some((event) => event.type === "skill" && event.card === paidSource), false,
  "offering an optional cost is not activation");
assert.equal(state.cards[energy].mode, "active");
const refused = rules.apply(ctx, reload(state), { type: "chooseMode", player: "p1", index: state.prompt.options.length - 1 });
assert.equal(refused.events.some((event) => event.type === "skill" && event.card === paidSource), false,
  "declining the price cannot activate the Extra Auto");
assert.equal(refused.events.some((event) => event.type === "draw"), false);
assert.equal((refused.state as VmState).cards[energy].mode, "active");
assert.equal((refused.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === paidWatcher), false);
const paid = rules.apply(ctx, JSON.parse(JSON.stringify(state)), { type: "chooseMode", player: "p1", index: 0 });
assert.equal(paid.events.filter((event) => event.type === "skill" && event.card === paidSource).length, 1);
assert.equal(paid.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1);
assert.equal((paid.state as VmState).cards[energy].mode, "rest", "the cost was paid before the effect");
assert.equal(paid.state.prompt.kind, "chooseCards");
assert.equal(paid.state.prompt.player, "p2");
const paidChoice = paid.state.prompt.choice.candidates[0];
assert.ok(paidChoice);
const paidResolved = rules.apply(ctx, reload(paid.state as VmState), { type: "choose", player: "p2", cards: [paidChoice] });
assert.ok((paidResolved.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === paidWatcher && effect.value === 0));
assert.ok((paidResolved.state as VmState).sides.p2.zones.drop.includes(paidChoice));
console.log("#683 paid Extra Auto: no hook on offer, cost before skill/effect, then one saved Villainous spend");

state = main(68317);
const unpaidWatcher = stage("AUDIT_WATCH");
const unpaidSource = stage("AUDIT_PAID");
state.pending.push({ card: unpaidSource, master: "p1", skillIndex: autoIndex, trigger: "played" });
const unpaidEvents: typeof events = [];
run(ctx, dbs, state, unpaidEvents);
assert.equal(state.prompt.kind, "main", "unaffordable Auto is canceled without a payment offer");
assert.equal(unpaidEvents.some((event) => event.type === "skill" && event.card === unpaidSource), false);
assert.equal(unpaidEvents.some((event) => event.type === "draw"), false);
assert.equal(state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === unpaidWatcher), false);
console.log("#683 declined/unaffordable Extra Auto: no activation, effect or keyword payout");

state = main(68318);
const moveWatcher = stage("AUDIT_WATCH");
const movingSource = stage("AUDIT_MOVE");
assert.ok(ctx.scripts!.AUDIT_MOVE.bySkill[autoIndex]?.price?.ops?.length, "source-move price is compiled");
state.pending.push({ card: movingSource, master: "p1", skillIndex: autoIndex, trigger: "played" });
run(ctx, dbs, state, []);
assert.equal(state.prompt.kind, "chooseMode");
const moveOffered = rules.apply(ctx, reload(state), { type: "chooseMode", player: "p1", index: 0 });
assert.ok((moveOffered.state as VmState).sides.p1.zones.drop.includes(movingSource), "the source left before activation's effect");
assert.equal(moveOffered.events.filter((event) => event.type === "skill" && event.card === movingSource).length, 1);
assert.equal(moveOffered.state.prompt.kind, "chooseCards", "captured keyword survives the source's price movement");
assert.equal(moveOffered.state.prompt.player, "p2");
assert.ok((moveOffered.state as VmState).programs.some((frame) => frame.card === moveWatcher && frame.pendingHookSkill));
console.log("#683 source-moving Auto price: saved keyword identity reaches the opponent prompt after movement");

state = main(68319);
const heroicWatcher = stage("AUDIT_HERO_WATCH");
const oppositeWatcher = stage("AUDIT_WATCH");
const heroicSource = stage("AUDIT_HERO_AUTO");
state.pending.push({ card: heroicSource, master: "p1", skillIndex: autoIndex, trigger: "played" });
const heroicEvents: typeof events = [];
run(ctx, dbs, state, heroicEvents);
assert.equal(heroicEvents.filter((event) => event.type === "skill" && event.card === heroicSource).length, 1);
assert.equal(state.prompt.kind, "orderPending", "two different keyword hooks retain owner ordering");
const heroicIndex = state.prompt.candidates.find((index) => state.pending[index]?.card === heroicWatcher);
assert.notEqual(heroicIndex, undefined);
const ordered = rules.apply(ctx, reload(state), { type: "orderPending", player: "p1", index: heroicIndex! });
assert.equal([...heroicEvents, ...ordered.events].filter((event) => event.type === "draw" && event.player === "p1").length, 2,
  "the Extra Auto and the matching Heroic watcher each draw once");
assert.ok((ordered.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === heroicWatcher && effect.value === 0));
assert.equal((ordered.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === oppositeWatcher), false,
  "Heroic does not trigger the opposite Villainous keyword");
console.log("#683 Heroic Extra Auto: effect and matching draw, individual spend, opposite keyword excluded");

// The battle-area Main route is a useful counterexample to calling all
// nonhand Extra skills absent: it already uses resolveActivation's hook frame.
state = main(68316);
const mainWatcher = stage("AUDIT_WATCH");
const mainSource = stage("AUDIT_MAIN");
const mainAction = rules.legalActions(ctx, state).find((entry) => entry.action.type === "activate" && entry.action.card === mainSource)?.action;
assert.ok(mainAction, "the existing action selector offers a battle-area Extra Main skill");
const mainActivated = rules.apply(ctx, state, mainAction);
assert.equal(mainActivated.state.prompt.kind, "chooseCards", "nonhand Main pends Villainous after its effect");
assert.equal((mainActivated.state as VmState).pending.some((item) => item.kind === "hook" && item.card === mainWatcher), false,
  "the pending hook has already begun its opponent choice");
console.log("#683 supported boundary: battle-area Extra Main already reaches Villainous; other nonhand areas need separate eligibility proof");

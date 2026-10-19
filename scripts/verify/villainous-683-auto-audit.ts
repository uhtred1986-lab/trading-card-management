import { zeroSkillPrice } from "../../src/lib/arena/vm/skill-payment";
/** Standalone focused proof of Extra Auto Heroic/Villainous hook timing (#683). */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const rules = RULES;
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
  AUDIT_FIELD: card("AUDIT_FIELD", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Field]<br>[Heroic]<br>[Auto] When this card is placed in a Battle Area, draw 1 card." }),
  AUDIT_REDIRECT: card("AUDIT_REDIRECT", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Villainous]<br>[Auto] {r}: When you play this card, draw 1 card." }),
  AUDIT_MUTATE: card("AUDIT_MUTATE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Villainous]<br>[Auto] When you play this card, draw 1 card." }),
};
const scripts = rulesFromCompiler(defs);
// Synthetic supported price op, isolated from whether the compiler reads that
// printed wording; #683 tests the already-supported activation continuation.
const moving = scripts.AUDIT_MOVE.bySkill[10];
assert.ok(moving);
scripts.AUDIT_MOVE.bySkill[10] = { ...moving, unsupported: [], ops: [{ op: "draw", n: 1 }],
  price: { ...zeroSkillPrice(), condition: null, ops: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "drop" }] } };
const redirecting = scripts.AUDIT_REDIRECT.bySkill[10];
assert.ok(redirecting);
scripts.AUDIT_REDIRECT.bySkill[10] = { ...redirecting, unsupported: [], ops: [{ op: "draw", n: 1 }],
  price: { ...zeroSkillPrice(), condition: null, ops: [{ op: "moveTo", target: { sel: { special: "subject" } }, to: "drop" }] } };
const mutating = scripts.AUDIT_MUTATE.bySkill[10];
assert.ok(mutating);
scripts.AUDIT_MUTATE.bySkill[10] = { ...mutating, unsupported: [],
  ops: [{ op: "negateSkills", target: { sel: { special: "self" } }, until: "turn" }, { op: "draw", n: 1 }] };
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
function stage(id: string, area: "battle" | "energy" | "drop" = "battle"): string {
  const physical = state.sides.p1.zones.hand.find((candidate) => !state.cards[candidate].cardId.startsWith("AUDIT_"));
  assert.ok(physical);
  state.cards[physical].cardId = id;
  assert.ok(moveCard(state, dbs, physical, area, { owner: "p1" }).ok);
  return physical;
}
const watcher = stage("AUDIT_WATCH");
const source = stage("AUDIT_AUTO", "drop");
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
const paidSource = stage("AUDIT_PAID", "drop");
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
const unpaidSource = stage("AUDIT_PAID", "drop");
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

state = main(68321);
const redirectedWatcher = stage("AUDIT_WATCH");
const redirectedSource = stage("AUDIT_REDIRECT", "drop");
const redirectedEnergy = stage("AUDIT_AUTO", "energy");
const redirectedTarget = state.sides.p2.zones.hand[0];
assert.ok(redirectedTarget);
assert.ok(moveCard(state, dbs, redirectedTarget, "battle", { owner: "p2" }).ok);
addEffect(state, [], { master: "p2", source: redirectedTarget, target: redirectedTarget, kind: "replaceLeave",
  value: { to: "warp", optional: true }, until: "turn" });
state.pending.push({ card: redirectedSource, master: "p1", skillIndex: autoIndex, trigger: "played", subject: redirectedTarget });
run(ctx, dbs, state, []);
assert.equal(state.prompt.kind, "chooseMode");
const redirectOffered = rules.apply(ctx, reload(state), { type: "chooseMode", player: "p1", index: 0 });
assert.equal(redirectOffered.state.prompt.kind, "replaceMove", "a legal opponent replacement pauses the Auto price");
assert.equal((redirectOffered.state as VmState).cards[redirectedEnergy].mode, "rest");
const redirected = rules.apply(ctx, reload(redirectOffered.state as VmState), { type: "chooseMode", player: "p2", index: 0 });
assert.ok((redirected.state as VmState).sides.p2.zones.warp.includes(redirectedTarget));
assert.equal(redirected.events.some((event) => event.type === "skill" && event.card === redirectedSource), false,
  "the failed payment does not activate the Extra Auto");
assert.equal(redirected.events.some((event) => event.type === "draw"), false);
assert.equal((redirected.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === redirectedWatcher), false);
assert.equal((redirected.state as VmState).pending.some((item) => item.kind === "hook" && item.card === redirectedWatcher), false);
assert.equal((redirected.state as VmState).cards[redirectedEnergy].mode, "rest", "prior legal payment remains paid under 5-8-4");
console.log("#683 legal replacement redirects Auto price: payment fails with no keyword hook or effect");

state = main(68322);
const mutatedWatcher = stage("AUDIT_WATCH");
const mutatedSource = stage("AUDIT_MUTATE", "drop");
state.pending.push({ card: mutatedSource, master: "p1", skillIndex: autoIndex, trigger: "played" });
const mutatedEvents: typeof events = [];
run(ctx, dbs, state, mutatedEvents);
assert.ok(state.effects.some((effect) => effect.kind === "negateSkills" && effect.target === mutatedSource));
assert.equal(hasKeyword(ctx, dbs, state, mutatedSource, "Villainous"), false, "the Auto effect removed its source keyword");
assert.equal(mutatedEvents.filter((event) => event.type === "draw" && event.player === "p1").length, 1);
assert.equal(state.prompt.kind, "chooseCards", "event-time Villainous qualification survives the source effect");
const mutateChoice = state.prompt.choice.candidates[0];
assert.ok(mutateChoice);
const mutated = rules.apply(ctx, reload(state), { type: "choose", player: "p2", cards: [mutateChoice] });
assert.ok((mutated.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === mutatedWatcher));
console.log("#683 Auto effect removes source keyword after event capture; Villainous still resolves once");

state = main(68319);
const heroicWatcher = stage("AUDIT_HERO_WATCH");
const oppositeWatcher = stage("AUDIT_WATCH");
const heroicSource = stage("AUDIT_HERO_AUTO", "drop");
state.pending.push({ card: heroicSource, master: "p1", skillIndex: autoIndex, trigger: "played" });
const heroicEvents: typeof events = [];
run(ctx, dbs, state, heroicEvents);
assert.equal(heroicEvents.filter((event) => event.type === "skill" && event.card === heroicSource).length, 1);
assert.equal(state.prompt.kind, "orderPending", "two different keyword hooks retain owner ordering");
const heroicIndex = state.prompt.candidates.find((index) => state.pending[index]?.card === heroicWatcher);
assert.notEqual(heroicIndex, undefined);
const ordered = rules.apply(ctx, reload(state), { type: "orderPending", player: "p1", index: heroicIndex! });
assert.equal(heroicEvents.filter((event) => event.type === "draw" && event.player === "p1").length, 1,
  "only the Extra Auto effect draws before the checkpoint choice");
assert.equal(ordered.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1,
  "the Heroic watcher draws only after its checkpoint choice");
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
assert.equal(mainActivated.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1,
  "the Extra Main's own effect precedes the keyword choices");
assert.equal(mainActivated.state.prompt.kind, "orderPending", "self and other Villainous can both answer this nonhand Extra");
const sourceIndex = mainActivated.state.prompt.candidates.find((index) => (mainActivated.state as VmState).pending[index]?.card === mainSource);
assert.notEqual(sourceIndex, undefined);
const mainOrdered = rules.apply(ctx, reload(mainActivated.state as VmState), { type: "orderPending", player: "p1", index: sourceIndex! });
assert.equal(mainOrdered.state.prompt.kind, "chooseCards");
assert.ok((mainOrdered.state as VmState).programs.some((frame) => frame.card === mainSource && frame.pendingHookSkill));
assert.ok((mainOrdered.state as VmState).pending.some((item) => item.card === mainWatcher), "the other watcher keeps its own pending identity");
const mainSelfChoice = mainOrdered.state.prompt.choice.candidates[0];
assert.ok(mainSelfChoice);
const mainSelfResolved = rules.apply(ctx, reload(mainOrdered.state as VmState), { type: "choose", player: "p2", cards: [mainSelfChoice] });
assert.equal(mainSelfResolved.state.prompt.kind, "chooseCards", "the separate watcher now asks its own choice");
const mainOtherChoice = mainSelfResolved.state.prompt.choice.candidates[0];
assert.ok(mainOtherChoice);
const mainAllResolved = rules.apply(ctx, reload(mainSelfResolved.state as VmState), { type: "choose", player: "p2", cards: [mainOtherChoice] });
const mainFinal = mainAllResolved.state as VmState;
assert.equal(mainFinal.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === mainSource && effect.value === 0).length, 1);
assert.equal(mainFinal.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === mainWatcher && effect.value === 0).length, 1);
assert.ok(mainFinal.sides.p2.zones.drop.includes(mainSelfChoice) && mainFinal.sides.p2.zones.drop.includes(mainOtherChoice));
assert.deepEqual(mainFinal.pending, []);
assert.deepEqual(mainFinal.programs, []);
console.log("#683 battle-area Extra Main: source-self and other Villainous each discard/spend once");

// A legal [Field] activation provides a real Extra Auto trigger: its arrival
// in Battle fulfills the compiler-read movement condition (9-6-9-4).
state = main(68320);
const fieldSource = state.sides.p1.zones.hand[0];
assert.ok(fieldSource);
state.cards[fieldSource].cardId = "AUDIT_FIELD";
const fieldAction = rules.legalActions(ctx, state).find((entry) => entry.action.type === "activate" && entry.action.card === fieldSource)?.action;
assert.ok(fieldAction, "[Field] is a legal Extra activation from hand");
const fieldActivated = rules.apply(ctx, state, fieldAction);
const fieldState = fieldActivated.state as VmState;
assert.equal(fieldState.prompt.kind, "main");
assert.ok(fieldState.sides.p1.zones.battle.includes(fieldSource));
assert.deepEqual(fieldActivated.events.filter((event) => event.type === "skill" && event.card === fieldSource).map((event) => event.type === "skill" ? event.skill : -1), [0, 20],
  "the hand [Field] activation is followed by its own compiler-triggered Battle-arrival Auto");
const fieldDraws = fieldActivated.events.flatMap((event, index) => event.type === "draw" && event.player === "p1" ? [index] : []);
assert.equal(fieldDraws.length, 2, "the Extra Auto effect and own Heroic each draw exactly once");
const fieldAutoEvent = fieldActivated.events.findIndex((event) => event.type === "skill" && event.card === fieldSource && event.skill === 20);
const fieldSpentEvent = fieldActivated.events.findIndex((event) => event.type === "effect" && event.effect.kind === "negateSkill" && event.effect.target === fieldSource && event.effect.value === 10);
assert.ok(fieldAutoEvent >= 0 && fieldAutoEvent < fieldDraws[0] && fieldDraws[0] < fieldDraws[1] && fieldDraws[1] < fieldSpentEvent,
  "source Auto effect precedes its own Heroic payout and individual turn-long spend");
assert.equal(fieldState.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === fieldSource && effect.value === 10).length, 1);
assert.deepEqual(fieldState.pending, [], "own Heroic creates no recursive pending activation");
assert.deepEqual(fieldState.programs, []);
console.log("#683 legal Field arrival: compiler Auto effect, source-self Heroic once, no recursive pending hook");

state = main(68323);
const loneBattle = state.sides.p1.zones.hand[0];
assert.ok(loneBattle);
state.cards[loneBattle].cardId = "AUDIT_WATCH";
const battleAction = rules.legalActions(ctx, state).find((entry) => entry.action.type === "play" && entry.action.card === loneBattle)?.action;
assert.ok(battleAction);
const battlePlayed = rules.apply(ctx, state, battleAction);
assert.equal(battlePlayed.state.prompt.kind, "main", "a Battle play never pends its own Villainous");
assert.equal((battlePlayed.state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === loneBattle), false);
assert.deepEqual((battlePlayed.state as VmState).pending, []);
console.log("#683 Battle-play source remains excluded by 'another' while Extra-skill self-watching works");

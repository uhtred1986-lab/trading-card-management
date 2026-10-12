/** #683: finite Heroic/Villainous activation and individual-negation proof. */
import "./villainous-683-auto-audit";
import "./villainous-683-parent-continuation";
import { verifyLegacyExtraAuto } from "./villainous-683-legacy-auto-audit";
import { verifyLegacyTimedGrants } from "./villainous-683-legacy-timed";
import { verifyLegacyStandingGrants } from "./villainous-683-legacy-standing";
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES_ONLY } from "./rules-only";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { hasKeyword, hookBodiesFor } from "../../src/lib/arena/vm/program";
import { addEffect as legacyAddEffect, has as legacyHas, move } from "../../src/lib/arena/engine/state";
import type { Action, PlayerId, GameState } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

if (!RULES_ONLY) verifyLegacyExtraAuto();
if (!RULES_ONLY) verifyLegacyTimedGrants();
if (!RULES_ONLY) verifyLegacyStandingGrants();

const ids = ["V683_WATCH", "V683_SOURCE", "V683_EXTRA", "V683_DESIRE", "V683_WISH", "V683_UNPAID", "V683_PRICE", "V683_COUNTER", "V683_OTHER", "V683_DUAL", "V683_PLAIN", "V683_STANDING", "V683_COPY_SOURCE", "V683_MUTATE", "V683_REMOVE"];
const old = new Map(ids.map((id) => [id, DEFS[id]]));
DEFS.V683_WATCH = card("V683_WATCH", { energyCost: 0, skill: "[Villainous]" });
DEFS.V683_SOURCE = card("V683_SOURCE", { energyCost: 0, skill: "[Villainous]" });
DEFS.V683_EXTRA = card("V683_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." });
DEFS.V683_DESIRE = card("V683_DESIRE", { type: "EXTRA", traits: ["Desire"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." });
DEFS.V683_WISH = card("V683_WISH", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Choose one- ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill." });
DEFS.V683_UNPAID = card("V683_UNPAID", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]{r}: Draw 1 card." });
DEFS.V683_PRICE = card("V683_PRICE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main] Choose 1 card in your hand and place it in its owner's Drop Area: Draw 1 card." });
DEFS.V683_COUNTER = card("V683_COUNTER", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Counter: Attack] Negate the attack." });
DEFS.V683_OTHER = card("V683_OTHER", { energyCost: 0, skill: "[Heroic]" });
DEFS.V683_DUAL = card("V683_DUAL", { energyCost: 0, skill: "[Heroic]<br>[Villainous]" });
DEFS.V683_PLAIN = card("V683_PLAIN", { energyCost: 0, skill: null });
DEFS.V683_STANDING = card("V683_STANDING", { energyCost: 0, skill: "[Permanent] This card gains [Villainous]." });
DEFS.V683_COPY_SOURCE = card("V683_COPY_SOURCE", { energyCost: 0, skill: "[Permanent] This card gains [Villainous]." });
DEFS.V683_MUTATE = card("V683_MUTATE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Choose 1 of your Extra Cards in your Drop Area and negate its skills for the turn." });
DEFS.V683_REMOVE = card("V683_REMOVE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Choose 1 of your Battle Cards and place it in its owner's Drop Area." });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const rules = engineFor("rules");
const legacy = engineFor("legacy");
const engines: readonly (readonly ["rules" | "legacy", typeof rules])[] = RULES_ONLY ? [["rules", rules]] : [["rules", rules], ["legacy", legacy]];

function main(engine: typeof rules, seed: number, leader = "L-RED"): VmState | GameState {
  let s = engine.createGame(CTX, {
    seed,
    p1: { name: "You", leader, main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state;
  s = engine.apply(CTX, s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
    const next = engine.legalActions(CTX, s)[0]?.action;
    assert.ok(next, "setup has a legal continuation");
    s = engine.apply(CTX, s, next).state;
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

// §12-2-4 activation by a parent skill waives the original price, but the
// nested Extra still has a successful skill activation and its own effect
// completes before Villainous asks the opponent to discard.
for (const [name, engine] of engines) {
  const s = main(engine, 68390 + Number(name === "legacy"), "V683_WISH");
  const watcher = name === "rules" ? stageVm(s as VmState, "V683_WATCH", "battle") : stageLegacy(s as GameState, "V683_WATCH", "battle");
  const source = name === "rules" ? stageVm(s as VmState, "V683_DESIRE", "hand") : stageLegacy(s as GameState, "V683_DESIRE", "hand");
  const leader = name === "rules" ? (s as VmState).sides.p1.zones.leader[0]! : (s as GameState).players.p1.leader;
  const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === leader)?.action;
  assert.ok(action, `${name} offers parent invocation`);
  const offered = engine.apply(CTX, s, action);
  assert.equal(offered.state.prompt.kind, "chooseMode");
  const invoked = engine.apply(CTX, JSON.parse(JSON.stringify(offered.state)), { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(invoked.state.prompt.kind, "chooseCards", `${name} invokes ${source} and then Villainous asks`);
  assert.ok(invoked.events.some((event) => event.type === "draw" && event.player === "p1"), `${name} Extra effect drew before keyword payout`);
  const chosen = chooseDiscard(engine, invoked.state);
  assert.ok(chosen.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), `${name} invoked skill pends once`);
  console.log(`  ${name} waived nested Extra: effect before keyword payout`);
}

function stageVm(s: VmState, id: string, zone: "hand" | "battle", player: PlayerId = "p1"): string {
  const physical = s.sides[player].zones.hand.find((id) => !ids.includes(s.cards[id].cardId))!;
  s.cards[physical].cardId = id;
  if (zone !== "hand") assert.ok(moveCard(s, dbs, physical, zone, { owner: player }).ok);
  return physical;
}

function stageLegacy(s: GameState, id: string, zone: "hand" | "battle", player: PlayerId = "p1"): string {
  const physical = s.players[player].hand.find((id) => !ids.includes(s.cards[id].cardId))!;
  s.cards[physical].cardId = id;
  if (zone !== "hand") move(CTX, s, [], physical, zone, player, { reason: "effect" });
  return physical;
}

function chooseDiscard(engine: typeof rules, s: VmState | GameState, player: PlayerId = "p2", preferredWatcher?: string): { state: VmState | GameState; events: ReturnType<typeof rules.apply>["events"] } {
  if (s.prompt.kind === "orderPending") {
    const vm = s as VmState;
    const index = vm.prompt.kind === "orderPending" ? (vm.prompt.candidates.find((i) => vm.pending[i]?.card === preferredWatcher) ?? vm.prompt.candidates[0]) : undefined;
    assert.notEqual(index, undefined);
    const selected = engine.apply(CTX, JSON.parse(JSON.stringify(s)), { type: "orderPending", player: "p1", index: index! });
    const completed = chooseDiscard(engine, selected.state, player, preferredWatcher);
    return { state: completed.state, events: [...selected.events, ...completed.events] };
  }
  assert.equal(s.prompt.kind, "chooseCards", "Villainous offers the opponent a hand choice");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  const candidates = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(candidates.length > 0);
  return engine.apply(CTX, JSON.parse(JSON.stringify(s)), { type: "choose", player, cards: [candidates[0]!] });
}

// A native Counter is itself a successful Extra skill activation, even when
// it negates the attack; its owner's Villainous watcher still answers.
for (const [name, engine] of engines) {
  let s = main(engine, 68330 + Number(name === "legacy"));
  for (const [type, player] of [["endMain", "p1"], ["charge", "p2"], ["endMain", "p2"], ["charge", "p1"]] as const) {
    const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === type && entry.action.player === player && (entry.action.type !== "charge" || entry.action.card == null))?.action;
    assert.ok(action, `${name} advances to the next turn with ${type}`);
    s = engine.apply(CTX, s, action).state;
  }
  assert.equal(s.prompt.kind, "main");
  const watcher = name === "rules" ? stageVm(s as VmState, "V683_WATCH", "battle", "p2") : stageLegacy(s as GameState, "V683_WATCH", "battle", "p2");
  let barredOther: string | undefined;
  if (name === "legacy") {
    barredOther = stageLegacy(s as GameState, "V683_WATCH", "battle", "p1");
    legacyAddEffect(s as GameState, [], { master: "p2", source: (s as GameState).players.p2.leader, target: barredOther, kind: "forbid", value: 0, forbid: { what: "activateSkill" }, until: "turn" });
  }
  const counter = name === "rules" ? stageVm(s as VmState, "V683_COUNTER", "hand", "p2") : stageLegacy(s as GameState, "V683_COUNTER", "hand", "p2");
  const attacker = name === "rules" ? (s as VmState).sides.p1.zones.leader[0]! : (s as GameState).players.p1.leader;
  const target = name === "rules" ? (s as VmState).sides.p2.zones.leader[0]! : (s as GameState).players.p2.leader;
  const attack = engine.apply(CTX, s, { type: "attack", player: "p1", attacker, target });
  assert.equal(attack.state.prompt.kind, "counter", `${name} opened Counter: Attack`);
  const offered = engine.legalActions(CTX, attack.state).find((entry) => entry.action.type === "counter" && entry.action.card === counter)?.action;
  assert.ok(offered, `${name} offers the keyword Extra Counter`);
  const answer = engine.apply(CTX, attack.state, offered);
  const chosen = chooseDiscard(engine, answer.state, "p1");
  assert.ok(chosen.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), `${name} Counter consumes the watcher once`);
  if (barredOther) assert.ok(!chosen.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === barredOther), "an opponent's targeted barrier cannot consume or bar the Counter owner's keyword");
  console.log(`  ${name} Counter: opponent choice and individual negation`);
}

for (const [name, engine] of engines) {
  for (const extra of [false, true]) {
    const s = main(engine, 68300 + (name === "rules" ? 0 : 10) + Number(extra));
    const watcher = name === "rules" ? stageVm(s as VmState, "V683_WATCH", "battle") : stageLegacy(s as GameState, "V683_WATCH", "battle");
    const source = name === "rules" ? stageVm(s as VmState, extra ? "V683_EXTRA" : "V683_SOURCE", "hand") : stageLegacy(s as GameState, extra ? "V683_EXTRA" : "V683_SOURCE", "hand");
    const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === (extra ? "activate" : "play") && entry.action.card === source)?.action;
    assert.ok(action, `${name} offers ${extra ? "Extra activation" : "Battle play"}`);
    const activated = engine.apply(CTX, s, action as Action);
    const chosen = chooseDiscard(engine, activated.state);
    const state = chosen.state;
    assert.ok(name === "rules"
      ? (state as VmState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0)
      : (state as GameState).effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0),
    `${name} ${extra ? "Extra" : "Battle"} negates only the printed Villainous identity`);
    console.log(`  ${name} ${extra ? "Extra" : "Battle"}: opponent choice and individual negation`);
  }
}

for (const [name, engine] of engines) {
  const s = main(engine, 68370 + Number(name === "legacy"));
  const watcher = name === "rules" ? stageVm(s as VmState, "V683_WATCH", "battle") : stageLegacy(s as GameState, "V683_WATCH", "battle");
  const opposite = name === "rules" ? stageVm(s as VmState, "V683_OTHER", "hand") : stageLegacy(s as GameState, "V683_OTHER", "hand");
  const unpaid = name === "rules" ? stageVm(s as VmState, "V683_UNPAID", "hand") : stageLegacy(s as GameState, "V683_UNPAID", "hand");
  const play = engine.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === opposite)?.action;
  assert.ok(play);
  const result = engine.apply(CTX, s, play);
  assert.ok(!result.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), `${name} Heroic source never spends Villainous`);
  assert.ok(!result.events.some((event) => event.type === "move" && event.to === "drop" && event.card !== opposite), `${name} no opponent discard on opposite keyword`);
  const after = result.state;
  if (name === "rules") for (const id of (after as VmState).sides.p1.zones.energy) (after as VmState).cards[id].mode = "rest";
  else for (const id of (after as GameState).players.p1.energy) (after as GameState).cards[id].mode = "rest";
  assert.ok(!engine.legalActions(CTX, after).some((entry) => entry.action.type === "activate" && entry.action.card === unpaid), `${name} refuses an unpaid red orb`);
  console.log(`  ${name} negative: unpaid and opposite keyword`);
}

// A separate action price is still a price. Nothing answers until the owner
// actually makes that payment, and the saved continuation retains the source.
for (const [name, engine] of engines) {
  let s = main(engine, 68350 + Number(name === "legacy"));
  const watcher = name === "rules" ? stageVm(s as VmState, "V683_WATCH", "battle") : stageLegacy(s as GameState, "V683_WATCH", "battle");
  const source = name === "rules" ? stageVm(s as VmState, "V683_PRICE", "hand") : stageLegacy(s as GameState, "V683_PRICE", "hand");
  const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === source)?.action;
  assert.ok(action, `${name} offers the priced Extra`);
  const offered = engine.apply(CTX, s, action);
  s = offered.state;
  assert.equal(s.prompt.kind, "chooseCards", `${name} asks the owner for action payment first`);
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.ok(!s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "the unpaid price cannot spend Villainous");
  if (name === "rules") {
    const continuation = (s as VmState).programs.find((frame) => frame.afterSkillSource === source);
    assert.deepEqual(continuation?.afterSkillKeywords, ["Villainous"], "the frozen source keyword is stored across the price prompt");
    assert.ok(!(s as VmState).pending.some((pending) => pending.card === watcher), "the watcher is not yet pending");
  } else {
    assert.ok((s as GameState).flow.some((step) => step.op === "afterSkill.activate" && step.card === source), "the paid activation continuation is saved");
  }
  s = JSON.parse(JSON.stringify(s));
  const candidates = (s.prompt as { choice: { candidates: string[] } }).choice.candidates.filter((id) => id !== source);
  assert.ok(candidates.length);
  const saved = JSON.stringify(s);
  assert.throws(() => engine.apply(CTX, s, { type: "choose", player: "p1", cards: ["not-an-offered-card"] }), `${name} rejects a bogus price choice`);
  assert.equal(JSON.stringify(s), saved, `${name} rejected payment leaves the saved continuation untouched`);
  const paid = engine.apply(CTX, s, { type: "choose", player: "p1", cards: [candidates[0]!] });
  const priceMove = paid.events.findIndex((event) => event.type === "move" && event.card === candidates[0] && event.to === "drop");
  const effectDraw = paid.events.findIndex((event) => event.type === "draw" && event.player === "p1");
  assert.ok(priceMove >= 0 && effectDraw > priceMove, `${name} completes payment before the Extra's effect`);
  assert.equal(paid.state.prompt.kind, "chooseCards", `${name} offers Villainous only after payment and effect`);
  assert.equal((paid.state.prompt as { player: PlayerId }).player, "p2");
  const chosen = chooseDiscard(engine, paid.state);
  assert.ok(chosen.events.some((event) => event.type === "move" && event.to === "drop"), `${name} resolves the keyword discard after the Extra effect`);
  assert.ok(chosen.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), `${name} pends after successful saved price`);
  console.log(`  ${name} action price: saved continuation pends after payment`);
}

// The optional discard has no candidate, but the keyword's own one-use
// negation is unconditional after it answers the successful event.
for (const [name, engine] of engines) {
  const s = main(engine, 68380 + Number(name === "legacy"));
  const watcher = name === "rules" ? stageVm(s as VmState, "V683_WATCH", "battle") : stageLegacy(s as GameState, "V683_WATCH", "battle");
  const source = name === "rules" ? stageVm(s as VmState, "V683_SOURCE", "hand") : stageLegacy(s as GameState, "V683_SOURCE", "hand");
  if (name === "rules") for (const id of [...(s as VmState).sides.p2.zones.hand]) assert.ok(moveCard(s as VmState, dbs, id, "drop", { owner: "p2" }).ok);
  else for (const id of [...(s as GameState).players.p2.hand]) move(CTX, s as GameState, [], id, "drop", "p2", { reason: "effect" });
  const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
  assert.ok(action);
  const result = engine.apply(CTX, s, action);
  assert.ok(result.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), `${name} still spends Villainous when the opponent has no hand card`);
  console.log(`  ${name} empty opposing hand: self-negation still applies`);
}

// One bearer may have both printed keywords. Each is its own pended skill and
// its own turn-long negation; resolving Villainous cannot consume Heroic.
for (const [name, engine] of engines) {
  let s = main(engine, 68360 + Number(name === "legacy"));
  const watcher = name === "rules" ? stageVm(s as VmState, "V683_DUAL", "battle") : stageLegacy(s as GameState, "V683_DUAL", "battle");
  const source = name === "rules" ? stageVm(s as VmState, "V683_DUAL", "hand") : stageLegacy(s as GameState, "V683_DUAL", "hand");
  const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
  assert.ok(action);
  let result = engine.apply(CTX, s, action);
  const events = [...result.events];
  s = result.state;
  for (let i = 0; i < 8 && s.prompt.kind !== "main"; i++) {
    let next: Action | undefined;
    if (s.prompt.kind === "orderPending") next = engine.legalActions(CTX, s).find((entry) => entry.action.type === "orderPending")?.action;
    if (s.prompt.kind === "chooseCards") {
      assert.equal(s.prompt.player, "p2", "only Villainous asks a hand choice");
      next = { type: "choose", player: "p2", cards: [s.prompt.choice.candidates[0]!] };
    }
    assert.ok(next, `${name} resolves both keyword skills`);
    result = engine.apply(CTX, JSON.parse(JSON.stringify(s)), next);
    events.push(...result.events);
    s = result.state;
  }
  assert.equal(s.prompt.kind, "main");
  const spent = s.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === watcher).map((effect) => effect.value);
  assert.deepEqual(spent.sort((a, b) => Number(a) - Number(b)), [0, 10], `${name} separately negates Heroic and Villainous at their printed offsets`);
  assert.equal(events.filter((event) => event.type === "draw" && event.player === "p1").length, 1, `${name} Heroic draws once`);
  console.log(`  ${name} dual keywords: independent pended identities`);
}

if (!RULES_ONLY) {
  let s = main(legacy, 68399) as GameState;
  const watcher = stageLegacy(s, "V683_OTHER", "battle");
  const first = legacyAddEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" });
  const source = stageLegacy(s, "V683_SOURCE", "hand");
  const action = legacy.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
  assert.ok(action);
  const activated = legacy.apply(CTX, s, action);
  assert.ok(!activated.events.some((event) => event.type === "draw" && event.player === "p1"), "a Villainous grant cannot accidentally resolve the bearer's printed Heroic");
  s = chooseDiscard(legacy, activated.state).state as GameState;
  assert.ok(s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && effect.value === first.id), "only the timed Villainous grant's persistent ID is spent");
  assert.ok(legacyHas(CTX, s, watcher, "Heroic"), "the printed Heroic identity is independent");
  assert.ok(!legacyHas(CTX, s, watcher, "Villainous"), "the spent timed grant supplies no keyword");
  const second = legacyAddEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" });
  assert.notEqual(second.id, first.id);
  assert.ok(legacyHas(CTX, s, watcher, "Villainous"), "same-turn regrant supplies a fresh keyword identity");
  const again = stageLegacy(s, "V683_SOURCE", "hand");
  const playAgain = legacy.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === again)?.action;
  assert.ok(playAgain);
  s = chooseDiscard(legacy, legacy.apply(CTX, s, playAgain).state).state as GameState;
  assert.equal(s.effects.filter((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && effect.value === second.id).length, 1, "new timed grant pays and spends exactly once");
  assert.ok(legacyHas(CTX, s, watcher, "Heroic"));
  console.log("  legacy timed grant: event keyword and distinct regrant ID leave printed Heroic intact");
}

if (!RULES_ONLY) {
  for (const granted of [false, true]) for (const barrierKind of ["forbid", "negateSkills"] as const) {
    const s = main(legacy, 68400 + Number(granted) + 2 * Number(barrierKind === "negateSkills")) as GameState;
    const watcher = stageLegacy(s, granted ? "V683_PLAIN" : "V683_WATCH", "battle");
    if (granted) legacyAddEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" });
    const barrier = s.players.p2.leader;
    legacyAddEffect(s, [], { master: "p2", source: barrier, target: watcher, kind: barrierKind, value: 0, ...(barrierKind === "forbid" ? { forbid: { what: "activateSkill" as const } } : {}), until: "turn" });
    const source = stageLegacy(s, "V683_SOURCE", "hand");
    const opposingHand = s.players.p2.hand.length;
    const action = legacy.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
    assert.ok(action);
    const played = legacy.apply(CTX, s, action);
    assert.equal(played.state.prompt.kind, "main", "a forbidden pended keyword has no discard prompt");
    assert.ok(!played.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "refused activation spends no keyword use");
    assert.ok(!played.events.some((event) => event.type === "draw" && event.player === "p1"), "refused keyword has no Heroic payout");
    assert.equal((played.state as GameState).players.p2.hand.length, opposingHand, "refused Villainous discards no opposing card");
    console.log(`  legacy ${granted ? "old grant" : "indexed"} ${barrierKind} at fulfillment: no payout or spend`);
  }

  for (const granted of [false, true]) {
    const s = main(legacy, 68420 + Number(granted)) as GameState;
    const watcher = stageLegacy(s, granted ? "V683_PLAIN" : "V683_OTHER", "battle");
    if (granted) legacyAddEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Heroic" }, until: "turn" });
    legacyAddEffect(s, [], { master: "p2", source: s.players.p2.leader, target: watcher, kind: "forbid", value: 0, forbid: { what: "activateSkill" }, until: "turn" });
    const source = stageLegacy(s, "V683_OTHER", "hand");
    const handBefore = s.players.p1.hand.length;
    const action = legacy.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
    assert.ok(action);
    const played = legacy.apply(CTX, s, action);
    assert.equal((played.state as GameState).players.p1.hand.length, handBefore - 1, "refused Heroic cannot replenish the played hand card");
    assert.ok(!played.events.some((event) => event.type === "draw" && event.player === "p1"), "refused Heroic emits no draw");
    assert.ok(!played.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "refused Heroic remains unspent");
    console.log(`  legacy ${granted ? "old grant" : "indexed"} Heroic prohibition: no draw or spend`);
  }

  // The successful Extra pends Villainous before its own target prompt. A
  // barrier imposed while that effect is suspended still cancels the
  // later [Auto] activation after JSON reload, without rewinding the Extra.
  for (const granted of [false, true]) for (const barrierKind of ["forbid", "negateSkills"] as const) {
    let s = main(legacy, 68410 + Number(granted) + 2 * Number(barrierKind === "negateSkills")) as GameState;
    const watcher = stageLegacy(s, granted ? "V683_PLAIN" : "V683_WATCH", "battle");
    if (granted) legacyAddEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" });
    const otherCard = stageLegacy(s, "V683_PLAIN", "battle");
    const source = stageLegacy(s, "V683_REMOVE", "hand");
    const action = legacy.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === source)?.action;
    assert.ok(action);
    s = legacy.apply(CTX, s, action).state as GameState;
    assert.equal(s.prompt.kind, "chooseCards", "the Extra effect suspends before the pending keyword resolves");
    assert.equal(s.prompt.player, "p1");
    assert.ok(s.pending.some((pending) => pending.card === watcher && pending.afterSkillKeyword === "Villainous"), "the watcher is pending across the effect prompt");
    const opposingHand = s.players.p2.hand.length;
    legacyAddEffect(s, [], { master: "p2", source: s.players.p2.leader, target: watcher, kind: barrierKind, value: 0, ...(barrierKind === "forbid" ? { forbid: { what: "activateSkill" as const } } : {}), until: "turn" });
    s = JSON.parse(JSON.stringify(s)) as GameState;
    const resumed = legacy.apply(CTX, s, { type: "choose", player: "p1", cards: [otherCard] });
    assert.equal(resumed.state.prompt.kind, "main", "the new barrier cancels the later Villainous hand choice");
    assert.ok(!resumed.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "the refused pending Auto leaves its keyword unspent");
    assert.ok((resumed.state as GameState).players.p1.drop.includes(otherCard), "the Extra's own effect still completed before the refused keyword");
    assert.equal((resumed.state as GameState).players.p2.hand.length, opposingHand, "refused pending Villainous discards no opposing card");
    console.log(`  legacy ${granted ? "old grant" : "indexed"} ${barrierKind} after pending: reload cancels keyword without undoing Extra`);
  }
}

// The rules VM must preserve all three grant identities that #602 established
// for Heroic when the hook body is Villainous's chooser and self-negation.
{
  let s = main(rules, 683100) as VmState;
  const watcher = stageVm(s, "V683_PLAIN", "battle");
  const grant = addEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" });
  const first = stageVm(s, "V683_SOURCE", "hand");
  const play = rules.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === first)?.action;
  assert.ok(play);
  s = chooseDiscard(rules, rules.apply(CTX, s, play).state).state as VmState;
  assert.ok(s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && effect.value === grant.id), "timed Villainous grant negates only its own effect ID");
  assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Villainous"), "spent timed grant supplies no keyword");
  s = JSON.parse(JSON.stringify(s)) as VmState;
  const replacement = addEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" });
  assert.ok(replacement.id > grant.id);
  const second = stageVm(s, "V683_SOURCE", "hand");
  const again = rules.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === second)?.action;
  assert.ok(again);
  s = chooseDiscard(rules, rules.apply(CTX, s, again).state, "p2", watcher).state as VmState;
  assert.ok(s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && effect.value === replacement.id), "new grant has a new usable identity after reload");
  console.log("  rules timed Villainous: persisted spend and independent regrant");
}

for (const copied of [false, true]) {
  let s = main(rules, 683110 + Number(copied)) as VmState;
  const watcher = stageVm(s, copied ? "V683_PLAIN" : "V683_STANDING", "battle");
  if (copied) {
    const copySource = stageVm(s, "V683_COPY_SOURCE", "hand");
    addEffect(s, [], { master: "p1", source: copySource, target: watcher, kind: "copiedSkills", value: 0,
      copied: { cardId: "V683_COPY_SOURCE", side: "front", skills: [0], from: copySource, name: "Copied Villainous grant" }, until: "game" });
  }
  const bodies = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill");
  assert.equal(bodies.length, 1);
  const identity = bodies[0]?.standingGrantId;
  assert.ok(identity, `${copied ? "copied" : "printed"} Permanent carries stable standing provenance`);
  const source = stageVm(s, "V683_SOURCE", "hand");
  const action = rules.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
  assert.ok(action);
  const activated = rules.apply(CTX, s, action);
  assert.equal(activated.state.prompt.kind, "chooseCards");
  const waiting = activated.state as VmState;
  assert.ok(waiting.pending.some((item) => item.kind === "hook" && item.card === watcher && item.frame.standingGrantId === identity)
    || waiting.programs.some((frame) => frame.card === watcher && frame.standingGrantId === identity), "the grant's identity persists in its pending or suspended body");
  s = chooseDiscard(rules, JSON.parse(JSON.stringify(waiting))).state as VmState;
  assert.ok(s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && typeof effect.value === "object" && "standingGrantId" in effect.value && effect.value.standingGrantId === identity), "Villainous spends the exact standing or copied grant");
  for (const viewer of ["p1", "p2"] as const) assert.ok(!JSON.stringify(rules.boardView(CTX, s, viewer, {})).includes(identity), "private grant provenance is absent from both boards");
  console.log(`  rules ${copied ? "copied" : "standing"} Villainous: identified grant and viewer projection`);
}

{
  let s = main(rules, 683120) as VmState;
  const watcher = stageVm(s, "V683_WATCH", "battle");
  const source = stageVm(s, "V683_MUTATE", "hand");
  const action = rules.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === source)?.action;
  assert.ok(action);
  s = rules.apply(CTX, s, action).state as VmState;
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal(s.prompt.player, "p2", "the single legal Drop target resolves automatically before Villainous asks");
  assert.ok(s.effects.some((effect) => effect.kind === "negateSkills" && effect.target === source));
  s = chooseDiscard(rules, s).state as VmState;
  assert.ok(s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), "source mutation after activation cannot unpend the watcher");
  console.log("  rules source effect mutation: event qualification stays captured");
}

{
  let s = main(rules, 683130) as VmState;
  const watcher = stageVm(s, "V683_WATCH", "battle");
  const source = stageVm(s, "V683_SOURCE", "hand");
  const action = rules.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === source)?.action;
  assert.ok(action);
  s = chooseDiscard(rules, rules.apply(CTX, s, action).state).state as VmState;
  assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Villainous"), "watcher cannot answer twice in its spent turn");
  s = JSON.parse(JSON.stringify(s)) as VmState;
  s = rules.apply(CTX, s, { type: "endMain", player: "p1" }).state as VmState;
  for (let i = 0; i < 32 && !(s.prompt.kind === "main" && s.turnPlayer === "p1"); i++) {
    const action = s.prompt.kind === "main" ? { type: "endMain", player: s.prompt.player } as const
      : rules.legalActions(CTX, s).find((entry) => entry.action.type === "charge" && entry.action.card == null)?.action
      ?? rules.legalActions(CTX, s)[0]?.action;
    assert.ok(action);
    s = rules.apply(CTX, s, action).state as VmState;
  }
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p1");
  assert.ok(hasKeyword(CTX, dbs, s, watcher, "Villainous"), "ordinary turn cleanup restores this individual keyword");
  console.log("  rules turn reset: spent skill restores on next owner turn");
}

for (const [id, def] of old) {
  if (def === undefined) delete DEFS[id];
  else DEFS[id] = def;
}

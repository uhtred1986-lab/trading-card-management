/** 22-35: [Heroic] has one real negated-skill use per owner per turn. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "DBS rules failed to load");
const dbs = loaded.definition;
const ids = ["H554_BATTLE", "H554_OTHER", "H554_TARGET", "H554_GRANTED", "H554_EXTRA", "H554_PLAIN_EXTRA", "H554_REMOVE", "H554_NEGATE", "H554_ZERO_EXTRA", "H554_SELF_NEGATE", "H554_ENERGY"];
const old = new Map(ids.map((id) => [id, DEFS[id]]));

DEFS.H554_BATTLE = card("H554_BATTLE", { energyCost: 0, power: 10000, skill: "[Heroic]" });
DEFS.H554_OTHER = card("H554_OTHER", { energyCost: 0, skill: "[Heroic]" });
DEFS.H554_TARGET = card("H554_TARGET", { energyCost: 0, skill: null });
DEFS.H554_GRANTED = card("H554_GRANTED", { energyCost: 0, skill: "[Heroic]" });
DEFS.H554_EXTRA = card("H554_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Draw 1 card." });
DEFS.H554_PLAIN_EXTRA = card("H554_PLAIN_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main]: Draw 1 card." });
DEFS.H554_REMOVE = card("H554_REMOVE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Choose 1 of your Battle Cards and place it in its owner's Drop Area." });
DEFS.H554_NEGATE = card("H554_NEGATE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Choose 1 of your Battle Cards and negate its skills for the turn." });
DEFS.H554_ZERO_EXTRA = card("H554_ZERO_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Choose 1 of your Battle Cards and it gets -10000 power for the turn." });
DEFS.H554_SELF_NEGATE = card("H554_SELF_NEGATE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Choose 1 of your Extra Cards in your Drop Area and negate its skills for the turn." });
DEFS.H554_ENERGY = card("H554_ENERGY", { energyCost: 0, skill: null });

function mainPhase(seed = 554): VmState {
  let s = rules.createGame(CTX, {
    seed,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  s = rules.apply(CTX, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
    const player = (s.prompt as { player: PlayerId }).player;
    s = rules.apply(CTX, s, { type: "pass", player }).state as VmState;
  }
  assert.equal(s.prompt.kind, "main", "fixture did not reach p1's Main Phase");
  return s;
}

function stage(s: VmState, p: PlayerId, id: string, area: "hand" | "battle" | "energy"): string {
  const physical = s.sides[p].zones.hand[0];
  assert.ok(physical, `${p} has no card to stage as ${id}`);
  s.cards[physical].cardId = id;
  if (area !== "hand") assert.ok(moveCard(s, dbs, physical, area, { owner: p }).ok, `could not stage ${id} in ${area}`);
  return physical;
}

function apply(s: VmState, action: Action): { state: VmState; events: ReturnType<typeof rules.apply> extends { events: infer E } ? E : never } {
  return rules.apply(CTX, s, action) as never;
}

function playCard(s: VmState, cardId: string): { state: VmState; events: ReturnType<typeof rules.apply> extends { events: infer E } ? E : never } {
  const legal = rules.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === cardId);
  assert.ok(legal, `${cardId} has no legal play`);
  return apply(s, legal.action);
}

function activate(s: VmState, cardId: string): { state: VmState; events: ReturnType<typeof rules.apply> extends { events: infer E } ? E : never } {
  const legal = rules.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === cardId);
  assert.ok(legal, `${cardId} has no legal activation`);
  return apply(s, legal.action);
}

function handSize(s: VmState, player: PlayerId): number {
  return s.sides[player].zones.hand.length;
}

function cleanup(): void {
  for (const id of ids) {
    const prior = old.get(id);
    if (prior) DEFS[id] = prior;
    else delete DEFS[id];
  }
}

try {
  // A real Battle Card play resolves this card's Heroic once. The move/cost
  // still happens on the later play that the once-per-turn effect suppresses.
  {
    let s = mainPhase();
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const played = stage(s, "p1", "H554_OTHER", "hand");
    const before = handSize(s, "p1");
    let result = playCard(s, played);
    s = result.state;
    assert.equal(handSize(s, "p1"), before, "the first other Heroic play draws once while replacing its hand card");
    assert.ok(result.events.some((event) => event.type === "move" && event.card === played && event.to === "battle"), "the triggering Battle Card entered the Battle Area");
    assert.ok(result.events.some((event) => event.type === "draw" && event.player === "p1"), "the first Heroic event records its draw");
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0 && effect.until === "turn"), "the actual printed Heroic skill is negated through the turn");

    // Reload the persisted turn-long negation; the new play is still legal,
    // still moves, and does not produce another draw.
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const second = stage(s, "p1", "H554_OTHER", "hand");
    const afterReload = handSize(s, "p1");
    result = playCard(s, second);
    assert.equal(handSize(result.state, "p1"), afterReload, "after JSON reload, only the newly played Heroic source draws; the original watcher cannot reuse its skill");
    assert.ok(result.events.some((event) => event.type === "move" && event.card === second && event.to === "battle"), "suppression does not cancel the independently legal play");
    assert.equal(result.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1, "the earlier watcher stays suppressed while the newly played Heroic card resolves once");
    assert.ok(result.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), "the original Heroic's timed negation survives reload and remains distinct from the new source's use");
  }

  // Activating an Extra with [Heroic] is the second 22-35-2 event. Its own
  // effect resolves first, then the board's pending Heroic draws once.
  {
    let s = mainPhase(5541);
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const extra = stage(s, "p1", "H554_EXTRA", "hand");
    const before = handSize(s, "p1");
    const activated = activate(s, extra);
    s = activated.state;
    const draws = activated.events.filter((event) => event.type === "draw" && event.player === "p1");
    assert.equal(draws.length, 2, "the activated skill draws once and [Heroic] draws once");
    assert.ok(activated.events.findIndex((event) => event.type === "draw") < activated.events.findLastIndex((event) => event.type === "draw"), "the Extra's own effect resolves before its triggered [Heroic]");
    assert.equal(handSize(s, "p1"), before + 1, "two draws offset the activated Extra leaving hand");
    assert.equal(s.cards[energy].mode, "rest", "the Heroic Auto is pending only after the Extra skill's cost was paid");
    assert.ok(s.sides.p1.zones.drop.includes(extra), "the Extra moved from hand as part of its successful activation");
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher && effect.value === 0), "the successful Extra activation consumes the board Heroic's one use");
  }

  // The Heroic Extra activation never reaches its trigger boundary without
  // paying the skill cost, so no hook is queued and no draw occurs.
  {
    const s = mainPhase(5542);
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const extra = stage(s, "p1", "H554_EXTRA", "hand");
    assert.ok(!rules.legalActions(CTX, s).some((entry) => entry.action.type === "activate" && entry.action.card === extra), "the Extra's skill is unavailable before its red cost can be paid");
    assert.deepEqual(s.programs, [], "an unpaid activation queued no pending Heroic or effect frame");
    assert.equal(handSize(s, "p1"), 5, "refusing an unaffordable activation does not change hand");
    assert.ok(!s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "the unpaid action consumes no Heroic use");
  }

  // The trigger predicate names the activated Extra's Heroic identity. That
  // qualification is captured before the Extra's own effect can negate it.
  {
    let s = mainPhase(55422);
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const extra = stage(s, "p1", "H554_SELF_NEGATE", "hand");
    s.cards[energy].mode = "active";
    const result = activate(s, extra);
    if (result.state.prompt.kind === "chooseCards") {
      const candidates = (result.state.prompt as { choice: { candidates: string[] } }).choice.candidates;
      assert.deepEqual(candidates, [extra], "the Extra itself is the only Extra in Drop Area to choose");
      const resumed = apply(JSON.parse(JSON.stringify(result.state)) as VmState, { type: "choose", player: "p1", cards: [extra] });
      s = resumed.state;
      assert.ok(resumed.events.some((event) => event.type === "draw" && event.player === "p1"), "the Heroic watcher resolves after the Extra's effect changes its keyword state");
    } else {
      s = result.state;
      assert.ok(result.events.some((event) => event.type === "draw" && event.player === "p1"), "the captured Heroic watcher resolves after the Extra's effect changes its keyword state");
    }
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkills" && effect.target === extra), "the Extra's own effect actually negates its Heroic source qualification");
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "the watcher still resolves its self-negating Heroic hook");
  }

  // Integration ordering regression: the activation's effect reduces its
  // Heroic listener to zero; 21-6 must move that card before the captured
  // Heroic Auto resolves, even though the Auto survives source departure.
  {
    const s = mainPhase(55421);
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const extra = stage(s, "p1", "H554_ZERO_EXTRA", "hand");
    s.cards[energy].mode = "active";
    const result = activate(s, extra);
    const moves = result.events.filter((event) => event.type === "move").map((event) => ({ card: event.card, to: event.to }));
    const order = result.events.filter((event) => event.type === "move" || event.type === "draw").map((event) => event.type === "move" ? `move:${event.card}:${event.to}` : `draw:${event.player}`);
    console.log("  observed  Heroic/21-6 interaction order", JSON.stringify(order));
    assert.ok(result.state.sides.p1.zones.drop.includes(watcher), "the 21-6 checkpoint drops the now-zero-power Heroic source");
    const drop = result.events.findIndex((event) => event.type === "move" && event.card === watcher && event.to === "drop");
    const draw = result.events.findIndex((event) => event.type === "draw" && event.player === "p1");
    assert.ok(drop >= 0 && draw >= 0, `both 21-6 departure and captured Heroic resolve; actual order ${JSON.stringify(order)} (moves ${JSON.stringify(moves)})`);
    assert.ok(draw > drop, `21-6 moves the zero-power Battle Card before the captured Heroic Auto resolves; observed ${JSON.stringify(order)}`);
    assert.equal(result.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1, "the captured Heroic resolves exactly once after its source leaves");
  }

  // A non-Heroic Extra skill activation is not a 22-35-2 event, even if a
  // card with an identity-less granted Heroic is listening.
  {
    let s = mainPhase(5543);
    const granted = stage(s, "p1", "H554_TARGET", "battle");
    addEffect(s, [], { master: "p1", source: granted, target: granted, kind: "keyword", value: { name: "Heroic" }, until: "turn" });
    const extra = stage(s, "p1", "H554_PLAIN_EXTRA", "hand");
    const before = handSize(s, "p1");
    const result = activate(s, extra);
    s = result.state;
    assert.equal(handSize(s, "p1"), before, "the non-Heroic Extra's own draw offsets it leaving hand");
    assert.ok(s.sides.p1.zones.drop.includes(extra), "the activated Extra moved to Drop Area");
    assert.equal(result.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1, "only the non-Heroic Extra's own effect draws");
    assert.ok(!s.overReason, "an unrelated Extra skill does not surface the granted Heroic limitation");
    assert.ok(!s.effects.some((effect) => effect.kind === "negateKeyword" && effect.target === granted), "the nonqualifying event neither negates the grant nor ends the game");
  }

  // The Extra's own draw resolves first. Heroic was captured at the paid
  // activation boundary, so its pending trigger survives the Extra leaving
  // play during its effect; JSON reload preserves the prompt and pending hook.
  {
    let s = mainPhase(555);
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const other = stage(s, "p1", "H554_TARGET", "battle");
    const extra = stage(s, "p1", "H554_REMOVE", "hand");
    s.cards[energy].mode = "active";
    const before = handSize(s, "p1");
    s = activate(s, extra).state;
    assert.equal(s.cards[energy].mode, "rest", "the Extra skill cost was paid before the Heroic trigger was pended");
    assert.equal(s.prompt.kind, "chooseCards", "the activated skill asks for its declared target");
    assert.ok(s.programs.some((frame) => frame.card === extra && frame.afterSkillSource === undefined), "the activated effect has started after recording its pending trigger");
    assert.ok(s.pending.some((pending) => pending.kind === "hook" && pending.frame.card === watcher && pending.frame.pendingHookSkill), "the captured Heroic Auto waits in the checkpoint queue behind the resolving Extra skill");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const choice = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
    assert.deepEqual(new Set(choice), new Set([watcher, other]), "the removal choice has exactly the Heroic watcher and one unrelated Battle Card");
    const resolved = apply(s, { type: "choose", player: "p1", cards: [watcher] });
    s = resolved.state;
    assert.ok(s.sides.p1.zones.drop.includes(watcher), "the Extra's effect removed the triggering Heroic card");
    assert.equal(handSize(s, "p1"), before, "the already-pending Heroic draws once after the watcher leaves play");
    assert.ok(resolved.events.some((event) => event.type === "draw" && event.player === "p1"), "source departure did not erase the pending event");
  }

  // A pending Heroic Auto that becomes negated before its checkpoint is
  // canceled like any other pending skill (9-6-3/9-1-5).
  {
    let s = mainPhase(556);
    const watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    stage(s, "p1", "H554_TARGET", "battle");
    const extra = stage(s, "p1", "H554_NEGATE", "hand");
    const before = handSize(s, "p1");
    s = activate(s, extra).state;
    assert.equal(s.prompt.kind, "chooseCards", "the negating skill asks its choice");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const resolved = apply(s, { type: "choose", player: "p1", cards: [watcher] });
    s = resolved.state;
    assert.equal(handSize(s, "p1"), before - 1, "the negated pending Heroic does not draw");
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkills" && effect.target === watcher), "the real skill-negation effect is present");
    assert.ok(resolved.events.some((event) => event.type === "note" && event.text.includes("skill is negated")), "the pending skill is canceled at resolution, not by a Heroic-specific bypass");
    assert.equal(s.cards[energy].mode, "rest", "the activated Extra's cost remains paid when its Heroic trigger is canceled");
  }

  // A granted Heroic has no individual printed/copy skill index for
  // negateOwnSkill. After JSON reload its pending body must terminate
  // deterministically before drawing, rather than silently repeat or blanket
  // negate every Heroic keyword on the card.
  {
    const s = mainPhase(5560);
    const granted = stage(s, "p1", "H554_GRANTED", "battle");
    addEffect(s, [], { master: "p1", source: granted, target: granted, kind: "keyword", value: { name: "Heroic" }, until: "turn" });
    const unrelated = stage(s, "p1", "H554_TARGET", "hand");
    const unmatched = playCard(s, unrelated);
    assert.ok(!unmatched.state.overReason, "an unrelated non-Heroic play does not surface the granted Heroic limitation");
    assert.ok(!unmatched.events.some((event) => event.type === "draw"), "an unrelated event does not draw from Heroic");
  }
  {
    let s = mainPhase(55605);
    const granted = stage(s, "p1", "H554_GRANTED", "battle");
    const target = stage(s, "p1", "H554_TARGET", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const extra = stage(s, "p1", "H554_NEGATE", "hand");
    s.cards[energy].mode = "active";
    addEffect(s, [], { master: "p1", source: granted, target: granted, kind: "keyword", value: { name: "Heroic" }, until: "turn" });
    const activated = activate(s, extra).state;
    assert.equal(activated.prompt.kind, "chooseCards", "the successful Extra skill waits for its chosen card before checking queued Heroic hooks");
    const result = apply(JSON.parse(JSON.stringify(activated)) as VmState, { type: "choose", player: "p1", cards: [granted] });
    s = result.state;
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkills" && effect.target === granted), "the Extra negates the grant card's whole skill set");
    assert.ok(!s.overReason, "whole-skill negation cancels the identity-less hook before its #602 guard");
    assert.ok(!result.events.some((event) => event.type === "draw" && event.player === "p1"), "neither the printed nor granted Heroic body draws after whole-skill negation");
    assert.ok(s.sides.p1.zones.battle.includes(target), "the unused second target remains untouched");
  }
  {
    let s = mainPhase(55606);
    const granted = stage(s, "p1", "H554_GRANTED", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const extra = stage(s, "p1", "H554_EXTRA", "hand");
    s.cards[energy].mode = "active";
    addEffect(s, [], { master: "p1", source: granted, target: granted, kind: "keyword", value: { name: "Heroic" }, until: "turn" });
    addEffect(s, [], { master: "p1", source: extra, target: granted, kind: "forbid", value: 0, forbid: { what: "activateSkill" }, until: "turn" });
    const before = handSize(s, "p1");
    const result = activate(s, extra);
    s = result.state;
    assert.ok(!s.overReason, "a live cannot-activate prohibition cancels the hook before its identity guard");
    assert.equal(result.events.filter((event) => event.type === "draw" && event.player === "p1").length, 1, "only the activating Extra's own draw resolves; the prohibited Heroic hook does not");
    assert.equal(handSize(s, "p1"), before, "the activating Extra's draw offsets its move with no Heroic bonus");
    assert.ok(result.events.some((event) => event.type === "note" && event.text.includes("can't activate skills")), "the ordinary activation prohibition is visible at hook resolution");
  }
  {
    let s = mainPhase(5561);
    const granted = stage(s, "p1", "H554_GRANTED", "battle");
    const energy = stage(s, "p1", "H554_ENERGY", "energy");
    const sibling = stage(s, "p1", "H554_BATTLE", "battle");
    const other = stage(s, "p1", "H554_TARGET", "battle");
    const extra = stage(s, "p1", "H554_REMOVE", "hand");
    s.cards[energy].mode = "active";
    addEffect(s, [], { master: "p1", source: granted, target: granted, kind: "keyword", value: { name: "Heroic" }, until: "turn" });
    const before = handSize(s, "p1");
    s = activate(s, extra).state;
    assert.equal(s.prompt.kind, "chooseCards", "the successful Heroic Extra activation pends its trigger behind its target prompt");
    const pendingHooks = s.pending.filter((pending) => pending.kind === "hook");
    const guardIndex = pendingHooks.findIndex((pending) => pending.frame.pendingHookIdentityMissing);
    const firstHookIndex = pendingHooks.findIndex((pending) => pending.frame.pendingHookSkill && !pending.frame.pendingHookIdentityMissing);
    assert.ok(guardIndex >= 0 && firstHookIndex > guardIndex, "the unsupported grant guard is ahead of every queued afterSkill body, while the Extra effect remains the active program");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const candidate = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
    assert.deepEqual(new Set(candidate), new Set([granted, sibling, other]), "the prompt remains resumable with the mixed printed/granted source and an independent printed sibling");
    const saved = JSON.stringify(s);
    const resolve = (source: string) => apply(JSON.parse(source) as VmState, { type: "choose", player: "p1", cards: [granted] });
    const first = resolve(saved);
    const repeated = resolve(saved);
    assert.equal(JSON.stringify(first), JSON.stringify(repeated), "the same reloaded prompt produces the same terminal outcome and events");
    s = first.state;
    const terminal = s as VmState & { outcome?: { kind: string; privateContext?: { issue?: string; detail?: string } } };
    const diagnostic = terminal.outcome?.privateContext?.detail ?? s.overReason;
    assert.ok(diagnostic?.includes("negate a granted keyword hook that has no individual skill identity"), "the unsupported identity is retained in its terminal diagnostic");
    if (terminal.outcome) {
      assert.equal(terminal.outcome.kind, "interrupted", "the typed terminal state is an interruption");
      assert.equal(terminal.outcome.privateContext?.issue, "#602", "the private diagnostic retains the live implementation owner");
      assert.ok(!s.overReason?.includes("#602"), "the public reason does not reveal private interpreter diagnostics");
    } else {
      assert.ok(s.overReason?.includes("#602"), "the legacy terminal representation retains the #602 owner");
    }
    assert.deepEqual(s.programs, [], "the terminal limitation discards sibling pending skills so they cannot deliver afterward");
    assert.ok(!first.events.some((event) => event.type === "draw"), `no Heroic draw occurs before the identity guard: ${first.events.filter((event) => event.type === "draw").map((event) => JSON.stringify(event))}`);
    assert.equal(handSize(s, "p1"), before - 1, "all Heroic bodies fail before drawing; only the activated Extra leaving hand changes hand size");
    assert.ok(!s.effects.some((effect) => effect.kind === "negateKeyword" && effect.target === granted), "the engine does not blanket-negate the granted Heroic keyword");
    assert.equal(s.cards[energy].mode, "rest", "the already-paid activation cost remains applied");
  }

  // A new turn expires the negation; separate owners have separate source
  // cards and one side's use cannot consume the other's allowance.
  {
    let s = mainPhase(557);
    const p1Watcher = stage(s, "p1", "H554_BATTLE", "battle");
    const p1Play = stage(s, "p1", "H554_OTHER", "hand");
    const p2Watcher = stage(s, "p2", "H554_BATTLE", "battle");
    const p2Play = stage(s, "p2", "H554_OTHER", "hand");
    s = playCard(s, p1Play).state;
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === p1Watcher), "p1's Heroic was used by p1's play");
    assert.ok(!s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === p2Watcher), "p1's play did not consume p2's allowance");

    s = rules.apply(CTX, s, { type: "endMain", player: "p1" }).state as VmState;
    for (let i = 0; i < 24 && !(s.prompt.kind === "main" && (s.prompt as { player: PlayerId }).player === "p2"); i++) {
      const player = (s.prompt as { player: PlayerId }).player;
      s = rules.apply(CTX, s, { type: "pass", player }).state as VmState;
    }
    assert.equal(s.prompt.kind, "main", "p2's Main Phase follows p1's first turn");
    const p2Before = handSize(s, "p2");
    const p2Result = playCard(s, p2Play);
    s = p2Result.state;
    assert.equal(handSize(s, "p2"), p2Before, "p2's independent Heroic resolves on p2's own play");
    assert.ok(p2Result.events.some((event) => event.type === "draw" && event.player === "p2"), "p2's draw is attributed to p2");

    s = rules.apply(CTX, s, { type: "endMain", player: "p2" }).state as VmState;
    for (let i = 0; i < 24 && !(s.prompt.kind === "main" && (s.prompt as { player: PlayerId }).player === "p1"); i++) {
      const player = (s.prompt as { player: PlayerId }).player;
      s = rules.apply(CTX, s, { type: "pass", player }).state as VmState;
    }
    assert.equal(s.prompt.kind, "main", "p1's next legal turn reaches its Main Phase");
    assert.ok(!s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === p1Watcher), "the turn-duration Heroic negation expires at the turn change");
    const nextPlay = stage(s, "p1", "H554_OTHER", "hand");
    const p1Before = handSize(s, "p1");
    const next = playCard(s, nextPlay);
    assert.equal(handSize(next.state, "p1"), p1Before + 1, "the two unused Heroic sources resolve once each on p1's next turn");
    assert.equal(next.events.filter((event) => event.type === "draw" && event.player === "p1").length, 2, "the reset creates two real draws, one from each pending Heroic source");
    assert.ok(next.state.effects.some((effect) => effect.kind === "negateSkill" && effect.target === p1Watcher && effect.value === 0), "p1's original Heroic is negated again for the new turn");
  }
} finally {
  cleanup();
}

console.log("  ok       heroic-554 (22-35 once-per-turn, activation and reload)");

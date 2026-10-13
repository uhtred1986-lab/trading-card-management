/** #602: effect and [Permanent] Heroic grants retain individual, reloadable skill identities. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { hasKeyword, hookBodiesFor } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const defs = ["H602_GRANT", "H602_PRINT", "H602_EXTRA", "H602_REMOVE", "H602_NEGATE", "H602_ENERGY", "H602_PLAIN", "H602_STANDING", "H602_SOURCE", "H602_COPY_SOURCE"];
const old = new Map(defs.map((id) => [id, DEFS[id]]));
DEFS.H602_GRANT = card("H602_GRANT", { energyCost: 0, skill: null });
DEFS.H602_PRINT = card("H602_PRINT", { energyCost: 0, skill: "[Heroic]" });
DEFS.H602_EXTRA = card("H602_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Draw 1 card." });
DEFS.H602_REMOVE = card("H602_REMOVE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Choose 1 of your Battle Cards and place it in its owner's Drop Area." });
DEFS.H602_NEGATE = card("H602_NEGATE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]{r}: Choose 1 of your Battle Cards and negate its skills for the turn." });
DEFS.H602_ENERGY = card("H602_ENERGY", { energyCost: 0, skill: null });
DEFS.H602_PLAIN = card("H602_PLAIN", { energyCost: 0, skill: null });
DEFS.H602_STANDING = card("H602_STANDING", { energyCost: 0, skill: "[Permanent] If this card has 15000 power or more, it gains [Heroic].<br>[Permanent] If this card has 15000 power or more, it gains [Heroic].", power: 15000 });
DEFS.H602_SOURCE = card("H602_SOURCE", { energyCost: 0, skill: "[Permanent] Your Battle Cards gain [Heroic]." });
DEFS.H602_COPY_SOURCE = card("H602_COPY_SOURCE", { energyCost: 0, skill: "[Permanent] This card gains [Heroic]." });

function main(seed: number): VmState {
  let s = rules.createGame(CTX, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(CTX, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(CTX, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, player: PlayerId, id: string, area: "hand" | "battle" | "energy"): string {
  const physical = s.sides[player].zones.hand[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  if (area !== "hand") assert.ok(moveCard(s, dbs, physical, area, { owner: player }).ok);
  return physical;
}
function apply(s: VmState, action: Action) { return rules.apply(CTX, s, action); }
function selectPending(result: ReturnType<typeof apply>, label: string, matches: (pending: VmState["pending"][number]) => boolean): ReturnType<typeof apply> {
  const s = result.state as VmState;
  assert.equal(s.prompt.kind, "orderPending", `${label} awaits an explicit 9-6-3 selection`);
  const candidates = s.prompt.kind === "orderPending" ? s.prompt.candidates.filter((index) => matches(s.pending[index])) : [];
  assert.equal(candidates.length, 1, `${label} has one bound pending record`);
  const action = rules.legalActions(CTX, s).find((entry) => entry.action.type === "orderPending" && entry.action.index === candidates[0])?.action;
  assert.ok(action, `${label} is a legal selection`);
  const selected = apply(JSON.parse(JSON.stringify(s)) as VmState, action);
  return { state: selected.state, events: [...result.events, ...selected.events] };
}
function play(s: VmState, id: string) {
  const action = rules.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === id)?.action;
  assert.ok(action, `${id} has no legal play`);
  return apply(s, action);
}
function activate(s: VmState, id: string) {
  const action = rules.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === id)?.action;
  assert.ok(action, `${id} has no legal activation`);
  return apply(s, action);
}
function draws(events: ReturnType<typeof apply>["events"], player: PlayerId = "p1") { return events.filter((event) => event.type === "draw" && event.player === player).length; }
function spent(s: VmState, cardId: string, grantId: number) { return s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === cardId && effect.value === grantId && effect.until === "turn"); }
function grant(s: VmState, target: string, source = target, until: "turn" | "game" | "whileSourceInPlay" = "turn") {
  return addEffect(s, [], { master: "p1", source, target, kind: "keyword", value: { name: "Heroic" }, until });
}
function nextMain(s: VmState, player: PlayerId): VmState {
  s = apply(s, { type: "endMain", player }).state as VmState;
  const next = player === "p1" ? "p2" : "p1";
  for (let i = 0; i < 24 && !(s.prompt.kind === "main" && s.turnPlayer === next); i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}

try {
  // Two independently printed Permanent lines grant the same keyword to one
  // card. Their source entry + skill path survives reads and JSON reload.
  {
    let s = main(60200);
    const watcher = stage(s, "p1", "H602_STANDING", "battle");
    const bodies = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill");
    assert.equal(bodies.length, 2, "both standing grants are in force");
    const ids = bodies.map((body) => body.standingGrantId);
    assert.ok(ids.every((id) => id !== undefined) && ids[0] !== ids[1], "each [Permanent] line has separate stable provenance");
    const trigger = stage(s, "p1", "H602_PRINT", "hand");
    const played = play(s, trigger);
    const waiting = played.state as VmState;
    assert.equal(waiting.prompt.kind, "orderPending", "two standing grants ask their master which Heroic resolves first");
    const firstIndex = waiting.prompt.kind === "orderPending" ? waiting.prompt.candidates.find((index) => {
      const pending = waiting.pending[index];
      return pending.kind === "hook" && pending.frame.standingGrantId === ids[0];
    }) : undefined;
    assert.notEqual(firstIndex, undefined, "the first standing grant has a distinct pending choice");
    const chosen = apply(JSON.parse(JSON.stringify(waiting)) as VmState, { type: "orderPending", player: "p1", index: firstIndex! });
    s = chosen.state as VmState;
    assert.equal(draws([...played.events, ...chosen.events]), 2);
    assert.ok(ids.every((id) => s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && typeof effect.value === "object" && "standingGrantId" in effect.value && effect.value.standingGrantId === id)));
    assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Heroic"), "both spent standing grants are absent from effective skills");
    for (const viewer of ["p1", "p2"] as const) {
      const publicBoard = JSON.stringify(rules.boardView(CTX, s, viewer, {}));
      assert.ok(!publicBoard.includes("standingGrantId") && !publicBoard.includes(ids[0]!), `grant provenance stays out of ${viewer}'s public board projection`);
    }
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const next = stage(s, "p1", "H602_PRINT", "hand");
    const second = play(s, next);
    assert.equal(draws(second.events), 1, "the used standing skills cannot answer another play this turn");
    assert.ok(!second.state.overReason);
  }

  // Copied [Permanent] lines use the existing copy-effect-derived skill
  // indexes. Replacing one copy with another cannot inherit a spent grant.
  {
    let s = main(60211);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const source = stage(s, "p1", "H602_COPY_SOURCE", "hand");
    const copied = { cardId: "H602_COPY_SOURCE", side: "front" as const, skills: [0], from: source, name: "Copy source" };
    const first = addEffect(s, [], { master: "p1", source, target: watcher, kind: "copiedSkills", value: 0, copied, until: "game" });
    const firstId = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill")[0]?.standingGrantId;
    assert.ok(firstId);
    const trigger = stage(s, "p1", "H602_PRINT", "hand");
    s = play(s, trigger).state as VmState;
    assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Heroic"));
    s.effects = s.effects.filter((effect) => effect.id !== first.id);
    const replacement = addEffect(s, [], { master: "p1", source, target: watcher, kind: "copiedSkills", value: 0, copied, until: "game" });
    assert.ok(replacement.id > first.id);
    const freshId = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill")[0]?.standingGrantId;
    assert.ok(freshId && freshId !== firstId, "the new copy-effect ID changes its derived skill index");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const again = stage(s, "p1", "H602_PRINT", "hand");
    const result = selectPending(play(s, again), "replacement copy grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.standingGrantId === freshId);
    assert.equal(draws(result.events), 2, "the replacement copy and newly played card answer");
    assert.ok(!result.state.overReason);
  }

  // A standing aura's grant is captured before a paid Extra removes its
  // source. Its pending hook resolves; returning that source creates a new
  // area entry and therefore a fresh grant identity on the same target.
  {
    let s = main(60207);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const source = stage(s, "p1", "H602_SOURCE", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_REMOVE", "hand");
    const firstId = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill")[0]?.standingGrantId;
    assert.ok(firstId);
    s = activate(s, extra).state as VmState;
    assert.equal(s.prompt.kind, "chooseCards");
    assert.ok(s.pending.some((pending) => pending.kind === "hook" && pending.card === watcher && pending.frame.standingGrantId === firstId));
    const result = selectPending(apply(JSON.parse(JSON.stringify(s)) as VmState, { type: "choose", player: "p1", cards: [source] }), "captured standing grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.standingGrantId === firstId);
    s = result.state as VmState;
    assert.ok(s.sides.p1.zones.drop.includes(source));
    assert.equal(draws(result.events), 2, "both captured standing-grant hooks resolve after the aura source departs");
    assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Heroic"), "the absent aura supplies no new keyword");
    assert.ok(s.effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && typeof effect.value === "object" && "standingGrantId" in effect.value && effect.value.standingGrantId === firstId));
    assert.ok(moveCard(s, dbs, source, "battle", { owner: "p1" }).ok);
    const freshId = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill")[0]?.standingGrantId;
    assert.ok(freshId && freshId !== firstId, "the source's next area entry cannot reuse its earlier grant ID");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const trigger = stage(s, "p1", "H602_PRINT", "hand");
    const again = selectPending(play(s, trigger), "regranted listener", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.standingGrantId === freshId);
    assert.equal(draws(again.events), 2, "the regranted listener and source each answer once");
    assert.ok(!again.state.overReason);
  }

  // The bearer is also a new card under 3-1-4 after leaving its area. The
  // aura's earlier negation cannot follow it into that later entry.
  {
    let s = main(60209);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    stage(s, "p1", "H602_SOURCE", "battle");
    const firstId = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill")[0]?.standingGrantId;
    assert.ok(firstId);
    const firstTrigger = stage(s, "p1", "H602_PRINT", "hand");
    s = selectPending(play(s, firstTrigger), "bearer's first grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.standingGrantId === firstId).state as VmState;
    assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Heroic"));
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_REMOVE", "hand");
    s = activate(s, extra).state as VmState;
    assert.equal(s.prompt.kind, "chooseCards");
    s = selectPending(apply(s, { type: "choose", player: "p1", cards: [watcher] }), "played card's captured aura grant after bearer leaves", (pending) => pending.card === firstTrigger && pending.kind === "hook" && pending.frame.standingGrantId !== undefined).state as VmState;
    assert.ok(s.sides.p1.zones.drop.includes(watcher));
    assert.ok(moveCard(s, dbs, watcher, "battle", { owner: "p1" }).ok);
    const freshId = hookBodiesFor(CTX, dbs, s, watcher, "afterSkill")[0]?.standingGrantId;
    assert.ok(freshId && freshId !== firstId);
    const trigger = stage(s, "p1", "H602_PRINT", "hand");
    const result = play(s, trigger);
    assert.ok(result.events.some((event) => event.type === "draw" && event.player === "p1"));
    assert.ok((result.state as VmState).effects.some((effect) => effect.kind === "negateGrantedSkill" && effect.target === watcher && typeof effect.value === "object" && "standingGrantId" in effect.value && effect.value.standingGrantId === freshId));
  }

  // Negating an aura source while its grants are pending cancels the source's
  // own hook, but does not retroactively erase another card's captured Auto.
  {
    let s = main(60210);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const source = stage(s, "p1", "H602_SOURCE", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_NEGATE", "hand");
    s = activate(s, extra).state as VmState;
    assert.equal(s.prompt.kind, "chooseCards");
    const result = selectPending(apply(JSON.parse(JSON.stringify(s)) as VmState, { type: "choose", player: "p1", cards: [source] }), "captured listener after aura negation", (pending) => pending.card === watcher);
    s = result.state as VmState;
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkills" && effect.target === source));
    assert.equal(draws(result.events), 1, "the other card's already-pending Heroic resolves after aura source negation");
    assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Heroic"), "negated [Permanent] contributes no new keyword");
    assert.ok(!s.overReason);
  }

  // Printed and two effect grants on one listener are three skills, with
  // independent uses. JSON round-tripping preserves both effect identities.
  {
    let s = main(60201);
    const watcher = stage(s, "p1", "H602_PRINT", "battle");
    const another = stage(s, "p1", "H602_GRANT", "battle");
    const first = grant(s, watcher, watcher, "game");
    const second = grant(s, watcher, watcher, "game");
    const third = grant(s, another, another, "game");
    const trigger = stage(s, "p1", "H602_PRINT", "hand");
    const firstGrantChoice = selectPending(play(s, trigger), "first effect grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === first.id);
    const secondGrantChoice = selectPending(firstGrantChoice, "second effect grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === second.id);
    const firstPlay = selectPending(secondGrantChoice, "watcher's printed Heroic", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === undefined);
    s = firstPlay.state as VmState;
    assert.equal(draws(firstPlay.events), 4, "two grants, a printed copy, and another card each draw");
    assert.ok(spent(s, watcher, first.id) && spent(s, watcher, second.id) && spent(s, another, third.id));
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkill" && effect.target === watcher), "the printed copy uses its own identity");
    assert.ok(!s.effects.some((effect) => effect.kind === "negateKeyword"), "no blanket keyword negation is introduced");
    assert.equal(hasKeyword(CTX, dbs, s, another, "Heroic"), false, "a spent grant's keyword text is deleted for the turn");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const secondTrigger = stage(s, "p1", "H602_PRINT", "hand");
    const secondPlay = play(s, secondTrigger);
    s = secondPlay.state as VmState;
    assert.equal(draws(secondPlay.events), 1, "only the newly played card's own existing Heroic can answer; spent listeners cannot");
    assert.ok(!s.overReason);
    s = nextMain(s, "p1");
    s = nextMain(s, "p2");
    assert.ok(!spent(s, watcher, first.id) && !spent(s, watcher, second.id), "the turn's negations expire");
    const laterTrigger = stage(s, "p1", "H602_PRINT", "hand");
    const laterFirst = selectPending(play(s, laterTrigger), "next-turn first grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === first.id);
    const laterSecond = selectPending(laterFirst, "next-turn second grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === second.id);
    const laterPrinted = selectPending(laterSecond, "next-turn printed watcher", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === undefined);
    const laterAnother = selectPending(laterPrinted, "next-turn other grant", (pending) => pending.card === another && pending.kind === "hook" && pending.frame.grantEffectId === third.id);
    const later = selectPending(laterAnother, "next-turn earlier Battle Card", (pending) => pending.card === trigger);
    assert.equal(draws(later.events), 6, "the persistent grants and earlier printed cards can answer next turn");
  }

  // A grant belongs to its own player. The opponent's qualifying Heroic play
  // cannot consume it; its master's later play draws exactly once.
  {
    let s = main(60212);
    const p2Watcher = stage(s, "p2", "H602_GRANT", "battle");
    const p2Grant = addEffect(s, [], { master: "p2", source: p2Watcher, target: p2Watcher, kind: "keyword", value: { name: "Heroic" }, until: "game" });
    const p1Trigger = stage(s, "p1", "H602_PRINT", "hand");
    const p1Before = s.sides.p1.zones.hand.length;
    const p1Play = play(s, p1Trigger);
    s = p1Play.state as VmState;
    assert.equal(draws(p1Play.events, "p2"), 0, "the opponent's event does not trigger p2's grant");
    assert.equal(s.sides.p1.zones.hand.length, p1Before - 1, "p1 pays its real Battle Card play from hand");
    assert.ok(!spent(s, p2Watcher, p2Grant.id));
    s = nextMain(s, "p1");
    const p2Trigger = stage(s, "p2", "H602_PRINT", "hand");
    const p2Before = s.sides.p2.zones.hand.length;
    const p2Play = play(s, p2Trigger);
    s = p2Play.state as VmState;
    assert.equal(draws(p2Play.events, "p2"), 1, "p2's own legal play activates its grant");
    assert.equal(s.sides.p2.zones.hand.length, p2Before, "one Heroic draw offsets p2's card leaving hand");
    assert.ok(spent(s, p2Watcher, p2Grant.id));
    assert.ok(!s.effects.some((effect) => effect.kind === "negateKeyword" && effect.target === p2Watcher));
    assert.ok(!s.overReason);
  }

  // Ending a grant and granting the same keyword again creates a fresh ID.
  {
    let s = main(60202);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const oldGrant = grant(s, watcher, watcher, "turn");
    const trigger = stage(s, "p1", "H602_PRINT", "hand");
    s = play(s, trigger).state as VmState;
    assert.ok(spent(s, watcher, oldGrant.id));
    endEffects(s, [], "turn");
    assert.ok(!hasKeyword(CTX, dbs, s, watcher, "Heroic"));
    const fresh = grant(s, watcher, watcher, "turn");
    assert.ok(fresh.id > oldGrant.id && !spent(s, watcher, fresh.id), "effect IDs are monotonic, not reused after expiry");
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const again = stage(s, "p1", "H602_PRINT", "hand");
    const result = selectPending(play(s, again), "fresh effect grant", (pending) => pending.card === watcher && pending.kind === "hook" && pending.frame.grantEffectId === fresh.id);
    assert.equal(draws(result.events), 2, "the fresh grant and the new card's own printed Heroic answer");
    assert.ok(spent(result.state as VmState, watcher, fresh.id));
  }

  // An activated Extra pays first, captures the qualifying event before its
  // body, then the captured grant resolves after the body removes its source.
  {
    let s = main(60203);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const source = stage(s, "p1", "H602_PLAIN", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_REMOVE", "hand");
    const g = grant(s, watcher, source, "whileSourceInPlay");
    const begun = activate(s, extra);
    s = begun.state as VmState;
    assert.equal(s.cards[energy].mode, "rest", "the red cost is paid at activation");
    assert.equal(s.prompt.kind, "chooseCards", "the Extra's effect waits before captured Heroic bodies");
    assert.ok(s.pending.some((pending) => pending.kind === "hook" && pending.frame.grantEffectId === g.id));
    s = JSON.parse(JSON.stringify(s)) as VmState;
    const resumed = apply(s, { type: "choose", player: "p1", cards: [source] });
    s = resumed.state as VmState;
    assert.ok(s.sides.p1.zones.drop.includes(source), "the source was removed by the Extra effect");
    assert.ok(!s.effects.some((effect) => effect.id === g.id), "the source-bound grant has ended");
    assert.equal(draws(resumed.events), 1, "the already-pending Auto still resolves once after source departure");
    assert.ok(spent(s, watcher, g.id), "its captured identity receives turn negation");
    assert.ok(!s.overReason);
  }

  // Ordinary whole-skill negation cancels a pending grant before its body;
  // the paid Extra's cost remains paid and no Heroic draw slips through.
  {
    let s = main(60204);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    stage(s, "p1", "H602_PLAIN", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_NEGATE", "hand");
    const g = grant(s, watcher);
    const started = activate(s, extra);
    s = started.state as VmState;
    assert.equal(s.prompt.kind, "chooseCards");
    const result = apply(JSON.parse(JSON.stringify(s)) as VmState, { type: "choose", player: "p1", cards: [watcher] });
    s = result.state as VmState;
    assert.ok(s.effects.some((effect) => effect.kind === "negateSkills" && effect.target === watcher));
    assert.equal(draws(result.events), 0);
    assert.ok(!spent(s, watcher, g.id), "the canceled skill never pays out or self-negates");
    assert.equal(s.cards[energy].mode, "rest");
    assert.ok(result.events.some((event) => event.type === "note" && event.text.includes("skill is negated")));
  }

  // An unaffordable Extra is never activated, so its qualifying event and
  // the listener's once-per-turn use are both absent.
  {
    const s = main(60205);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const extra = stage(s, "p1", "H602_EXTRA", "hand");
    const g = grant(s, watcher);
    assert.ok(!rules.legalActions(CTX, s).some((entry) => entry.action.type === "activate" && entry.action.card === extra));
    assert.ok(s.sides.p1.zones.hand.includes(extra));
    assert.deepEqual(s.pending, []);
    assert.ok(!spent(s, watcher, g.id));
  }

  // Declining an available activation at the Main Phase boundary also never
  // pays its cost or announces the Heroic Extra event.
  {
    let s = main(60213);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_EXTRA", "hand");
    const g = grant(s, watcher);
    assert.ok(rules.legalActions(CTX, s).some((entry) => entry.action.type === "activate" && entry.action.card === extra), "the player can choose this paid activation");
    const declined = apply(s, { type: "endMain", player: "p1" });
    s = declined.state as VmState;
    assert.equal(draws(declined.events), 0);
    assert.ok(s.sides.p1.zones.hand.includes(extra));
    assert.equal(s.cards[energy].mode, "active", "declining never pays the red energy");
    assert.ok(!spent(s, watcher, g.id));
  }

  // An invalid target answer is refused without mutating the paid activation;
  // a later valid answer resumes the same captured Heroic exactly once.
  {
    let s = main(60206);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    stage(s, "p1", "H602_PLAIN", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_REMOVE", "hand");
    const g = grant(s, watcher);
    s = activate(s, extra).state as VmState;
    assert.equal(s.prompt.kind, "chooseCards");
    const saved = JSON.stringify(s);
    assert.throws(() => apply(s, { type: "choose", player: "p1", cards: [] }), /choose at least 1/);
    assert.equal(JSON.stringify(s), saved, "invalid answer leaves the persisted prompt and captured grant intact");
    const result = apply(JSON.parse(saved) as VmState, { type: "choose", player: "p1", cards: [watcher] });
    s = result.state as VmState;
    assert.equal(s.cards[energy].mode, "rest");
    assert.ok(s.sides.p1.zones.drop.includes(watcher), "the accepted answer applies the Extra effect");
    assert.equal(draws(result.events), 1, "the paid Extra still set off its captured Heroic");
    assert.ok(spent(s, watcher, g.id));
  }

  // A pre-#602 saved hook without any identity still fails before its draw.
  // The new optional frame fields cannot silently turn old JSON into a
  // repeatable payout after a deployment.
  {
    let s = main(60208);
    const watcher = stage(s, "p1", "H602_GRANT", "battle");
    const other = stage(s, "p1", "H602_PLAIN", "battle");
    const energy = stage(s, "p1", "H602_ENERGY", "energy");
    s.cards[energy].mode = "active";
    const extra = stage(s, "p1", "H602_REMOVE", "hand");
    grant(s, watcher);
    s = activate(s, extra).state as VmState;
    assert.equal(s.prompt.kind, "chooseCards");
    const saved = JSON.parse(JSON.stringify(s)) as VmState;
    const pending = saved.pending.find((entry) => entry.kind === "hook" && entry.card === watcher);
    assert.ok(pending && pending.kind === "hook");
    delete pending.frame.grantEffectId;
    const result = apply(saved, { type: "choose", player: "p1", cards: [other] });
    const terminal = result.state as VmState & { outcome?: { privateContext?: { issue?: string } } };
    assert.ok(terminal.outcome?.privateContext?.issue === "#602" || terminal.overReason?.includes("#602"));
    assert.equal(draws(result.events), 0, "an old unidentified frame cannot draw before failing closed");
  }
} finally {
  for (const id of defs) { const previous = old.get(id); if (previous) DEFS[id] = previous; else delete DEFS[id]; }
}
console.log("  ok       granted-heroic-602 (individual grants, timing, reload, expiry)");

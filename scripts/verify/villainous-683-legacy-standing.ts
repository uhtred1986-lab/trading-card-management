/** #683: legacy standing Villainous grants have persistent individual provenance. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { addEffect, has, move, staticEffects } from "../../src/lib/arena/engine/state";
import type { GameState, PlayerId } from "../../src/lib/arena/types";

const engine = engineFor("legacy");
const IDS = ["V683S_WATCH", "V683S_DUAL", "V683S_MIX", "V683S_COND", "V683S_AURA", "V683S_EXTRA", "V683S_REMOVE", "V683S_COPY", "V683S_LEADER"];
const old = new Map(IDS.map((id) => [id, DEFS[id]]));
DEFS.V683S_WATCH = card("V683S_WATCH", { energyCost: 0, skill: null });
DEFS.V683S_DUAL = card("V683S_DUAL", { energyCost: 0, skill: "[Permanent] This card gains [Villainous].<br>[Permanent] This card gains [Villainous]." });
DEFS.V683S_MIX = card("V683S_MIX", { energyCost: 0, skill: "[Villainous]<br>[Permanent] This card gains [Villainous]." });
DEFS.V683S_COND = card("V683S_COND", { energyCost: 0, power: 15000, skill: "[Permanent] If this card has 15000 power or more, it gains [Villainous]." });
DEFS.V683S_AURA = card("V683S_AURA", { energyCost: 0, skill: "[Permanent] Your Battle Cards gain [Villainous]." });
DEFS.V683S_EXTRA = card("V683S_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." });
DEFS.V683S_REMOVE = card("V683S_REMOVE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Choose 1 of your Battle Cards and place it in its owner's Drop Area." });
DEFS.V683S_COPY = card("V683S_COPY", { energyCost: 0, skill: "[Permanent] This card gains [Villainous]." });
DEFS.V683S_LEADER = card("V683S_LEADER", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null,
  skill: "[Permanent] Your Battle Cards gain [Villainous].<br>[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over.",
  back: { name: "V683S_LEADER back", power: 15000, skill: "[Permanent] Your Battle Cards gain [Villainous]." } });

function main(seed: number, leader = "L-RED"): GameState {
  let s = engine.createGame(CTX, { seed, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as GameState;
  s = engine.apply(CTX, s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state as GameState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
    const action = engine.legalActions(CTX, s)[0]?.action;
    assert.ok(action);
    s = engine.apply(CTX, s, action).state as GameState;
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

function stage(s: GameState, cardId: string, zone: "hand" | "battle"): string {
  const id = s.players.p1.hand.find((c) => !IDS.includes(s.cards[c].cardId))!;
  assert.ok(id);
  s.cards[id].cardId = cardId;
  if (zone === "battle") move(CTX, s, [], id, zone, "p1", { reason: "effect" });
  return id;
}

function activate(s: GameState, cardId = "V683S_EXTRA") {
  const source = stage(s, cardId, "hand");
  const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === source)?.action;
  assert.ok(action, "a real Extra activation is offered");
  return engine.apply(CTX, s, action);
}

function standingIds(s: GameState, target: string): string[] {
  return staticEffects(CTX, s).filter((e) => e.kind === "keyword" && e.target === target && typeof e.value === "object" && "name" in e.value && e.value.name === "Villainous").map((e) => e.standingGrantId!).filter(Boolean);
}

function payPending(state: GameState, count: number): GameState {
  let s = JSON.parse(JSON.stringify(state)) as GameState;
  for (let i = 0; i < count; i++) {
    assert.equal(s.prompt.kind, "chooseCards", `Villainous choice ${i + 1}/${count}`);
    assert.equal(s.prompt.player, "p2");
    const choice = s.prompt.choice.candidates[0]!;
    assert.ok(choice);
    s = engine.apply(CTX, JSON.parse(JSON.stringify(s)), { type: "choose", player: "p2", cards: [choice] }).state as GameState;
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}

function spent(s: GameState, target: string, id: string): boolean {
  return s.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === target && typeof e.value === "object" && "standingGrantId" in e.value && e.value.standingGrantId === id);
}

// An old persisted card has no entry epoch. Its already-pending -1 hook must
// not be relabeled with a new standing ID across the saved target prompt.
{
  const s = main(683300);
  const watcher = stage(s, "V683S_DUAL", "battle");
  const sacrifice = stage(s, "V683S_WATCH", "battle");
  delete s.cards[watcher].zoneEpoch;
  const started = activate(s, "V683S_REMOVE");
  assert.equal(started.state.prompt.kind, "chooseCards");
  assert.equal(started.state.prompt.player, "p1");
  const pending = (started.state as GameState).pending.filter((p) => p.card === watcher);
  assert.equal(pending.length, 1, "old grant-only behavior collapsed its standing lines");
  assert.equal(pending[0]?.skillIndex, -1);
  assert.equal(pending[0]?.standingGrantId, undefined, "old saved pending frame stays unidentified");
  const finished = engine.apply(CTX, JSON.parse(JSON.stringify(started.state)), { type: "choose", player: "p1", cards: [sacrifice] });
  const done = payPending(finished.state as GameState, 1);
  assert.ok(done.effects.some((e) => e.kind === "negateSkill" && e.target === watcher && e.value === -1));
  assert.ok(!done.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher));
  console.log("  legacy saved -1 pending grant retains old identity across target prompt");
}

// Two printed [Permanent] lines grant separate keyword skills. A further
// event that turn cannot spend either again; JSON reload preserves both IDs.
{
  const s = main(683301);
  const watcher = stage(s, "V683S_DUAL", "battle");
  const ids = standingIds(s, watcher);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  const before = s.players.p2.hand.length;
  let done = payPending(activate(s).state as GameState, 2);
  assert.equal(done.players.p2.hand.length, before - 2);
  for (const id of ids) assert.ok(spent(done, watcher, id));
  assert.ok(!has(CTX, done, watcher, "Villainous"));
  const repeated = activate(done);
  assert.equal(repeated.state.prompt.kind, "main");
  assert.equal((repeated.state as GameState).players.p2.hand.length, before - 2);
  done = repeated.state as GameState;
  for (const viewer of ["p1", "p2"] as const) {
    const view = engine.boardView(CTX, JSON.parse(JSON.stringify(done)), viewer, {});
    assert.equal(view.them.hand, null);
    const publicJson = JSON.stringify(view);
    assert.ok(!publicJson.includes("standingGrantId") && !publicJson.includes("zoneEpoch") && ids.every((id) => !publicJson.includes(id)), "standing provenance stays private");
  }
  console.log("  legacy two standing Villainous lines: two exact spends, saved repeat and private views");
}

// A condition turning off and back on is not a new source or recipient entry.
{
  const s = main(683302);
  const watcher = stage(s, "V683S_COND", "battle");
  const id = standingIds(s, watcher)[0];
  assert.ok(id);
  const debuff = addEffect(s, [], { master: "p2", source: s.players.p2.leader, target: watcher, kind: "power", value: -5000, until: "turn" });
  assert.deepEqual(standingIds(s, watcher), []);
  s.effects = s.effects.filter((e) => e.id !== debuff.id);
  assert.deepEqual(standingIds(s, watcher), [id], "the same area-entry condition retains its grant identity");
  const done = payPending(activate(s).state as GameState, 1);
  assert.ok(spent(done, watcher, id));
  const secondDebuff = addEffect(done, [], { master: "p2", source: done.players.p2.leader, target: watcher, kind: "power", value: -5000, until: "turn" });
  done.effects = done.effects.filter((e) => e.id !== secondDebuff.id);
  assert.deepEqual(standingIds(done, watcher), [id]);
  assert.ok(!has(CTX, done, watcher, "Villainous"), "condition return cannot refresh a spent skill");
  console.log("  legacy standing condition toggle: unchanged source/op/recipient identity cannot repay");
}

// Existing saves have no entry epoch. Their old -1 spend remains compatible,
// but a subsequent real source reentry must supply a newly identified grant.
{
  const s = main(683308);
  const watcher = stage(s, "V683S_WATCH", "battle");
  const source = stage(s, "V683S_AURA", "battle");
  delete s.cards[watcher].zoneEpoch;
  delete s.cards[source].zoneEpoch;
  assert.deepEqual(standingIds(s, watcher), []);
  const oldDone = payPending(activate(s).state as GameState, 2);
  assert.ok(oldDone.effects.some((e) => e.kind === "negateSkill" && e.target === watcher && e.value === -1));
  move(CTX, oldDone, [], source, "drop", "p1", { reason: "effect" });
  move(CTX, oldDone, [], source, "battle", "p1", { reason: "effect" });
  const fresh = standingIds(oldDone, watcher)[0]!;
  assert.ok(fresh && has(CTX, oldDone, watcher, "Villainous"), "fresh source entry bypasses old -1 spend");
  const again = payPending(activate(oldDone).state as GameState, 2);
  assert.ok(spent(again, watcher, fresh));
  console.log("  legacy old save: source reentry refreshes grant while old -1 marker remains");
}

// The supported token-playing Auto creates cards directly in the Battle Area.
// A later aura must assign a stable grant to the token and spend it once.
{
  let s = main(683309);
  const spawner = stage(s, "SPAWN", "hand");
  const play = engine.legalActions(CTX, s).find((entry) => entry.action.type === "play" && entry.action.card === spawner)?.action;
  assert.ok(play, "the token spawner is legally playable");
  s = engine.apply(CTX, s, play).state as GameState;
  assert.equal(s.prompt.kind, "main");
  const tokens = s.players.p1.battle.filter((id) => s.cards[id].isToken);
  assert.equal(tokens.length, 2);
  const source = stage(s, "V683S_AURA", "battle");
  const ids = tokens.map((token) => {
    assert.equal(s.cards[token].zoneEpoch, 0, "direct token entry initializes its epoch");
    const id = standingIds(s, token)[0]!;
    assert.ok(id);
    return id;
  });
  assert.notEqual(ids[0], ids[1], "each token is a distinct recipient");
  assert.equal(standingIds(s, source).length, 1);
  const before = s.players.p2.hand.length;
  const done = payPending(activate(s).state as GameState, 4);
  assert.equal(done.players.p2.hand.length, before - 4);
  for (let i = 0; i < tokens.length; i++) assert.ok(spent(done, tokens[i], ids[i]));
  const repeated = activate(done);
  assert.equal((repeated.state as GameState).players.p2.hand.length, before - 4);
  console.log("  legacy legal token Auto: two token aura grants retain private, individual identity");
}

// A printed line, one standing line and a timed grant coexist on the same
// bearer; each has an independent saved pending record and spend marker.
{
  const s = main(683303);
  const watcher = stage(s, "V683S_MIX", "battle");
  const standing = standingIds(s, watcher)[0]!;
  const timed = addEffect(s, [], { master: "p1", source: watcher, target: watcher, kind: "keyword", value: { name: "Villainous" }, until: "turn" }).id;
  const before = s.players.p2.hand.length;
  const done = payPending(activate(s).state as GameState, 3);
  assert.equal(done.players.p2.hand.length, before - 3);
  assert.ok(done.effects.some((e) => e.kind === "negateSkill" && e.target === watcher && e.value === 0));
  assert.ok(spent(done, watcher, standing));
  assert.ok(done.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === timed));
  assert.ok(!has(CTX, done, watcher, "Villainous"));
  console.log("  legacy printed + standing + timed Villainous: three independent payouts");
}

// Captured standing hooks resolve after their source leaves. Returning it
// supplies a new area entry and fresh grant identity on the same recipient.
{
  const s = main(683304);
  const watcher = stage(s, "V683S_WATCH", "battle");
  const source = stage(s, "V683S_AURA", "battle");
  const id = standingIds(s, watcher)[0]!;
  const started = activate(s, "V683S_REMOVE");
  assert.equal(started.state.prompt.kind, "chooseCards");
  assert.equal(started.state.prompt.player, "p1");
  assert.ok((started.state as GameState).pending.some((p) => p.card === watcher && p.standingGrantId === id));
  for (const viewer of ["p1", "p2"] as const) {
    const view = engine.boardView(CTX, JSON.parse(JSON.stringify(started.state)), viewer, {});
    assert.equal(view.them.hand, null);
    const publicJson = JSON.stringify(view);
    assert.ok(!publicJson.includes("standingGrantId") && !publicJson.includes("zoneEpoch") && !publicJson.includes(id), "saved pending provenance stays private to the engine");
  }
  const removed = engine.apply(CTX, JSON.parse(JSON.stringify(started.state)), { type: "choose", player: "p1", cards: [source] });
  assert.ok((removed.state as GameState).players.p1.drop.includes(source));
  assert.deepEqual(standingIds(removed.state as GameState, watcher), []);
  const done = payPending(removed.state as GameState, 2);
  assert.ok(spent(done, watcher, id));
  move(CTX, done, [], source, "battle", "p1", { reason: "effect" });
  const fresh = standingIds(done, watcher)[0]!;
  assert.ok(fresh && fresh !== id);
  const again = payPending(activate(done).state as GameState, 2);
  assert.ok(spent(again, watcher, fresh));
  console.log("  legacy standing source departure/reentry: captured payout then fresh grant");
}

// Bearer departure resets its entry and spends; its returned copy receives a
// fresh standing identity without any source change.
{
  const s = main(683305);
  const watcher = stage(s, "V683S_DUAL", "battle");
  const oldIds = standingIds(s, watcher);
  const done = payPending(activate(s).state as GameState, 2);
  move(CTX, done, [], watcher, "drop", "p1", { reason: "effect" });
  move(CTX, done, [], watcher, "battle", "p1", { reason: "effect" });
  const fresh = standingIds(done, watcher);
  assert.equal(fresh.length, 2);
  assert.ok(fresh.every((id) => !oldIds.includes(id)));
  const again = payPending(activate(done).state as GameState, 2);
  assert.ok(fresh.every((id) => spent(again, watcher, id)));
  console.log("  legacy standing bearer departure/reentry: new area generation pays twice");
}

// A legal Awaken flips the source face without changing its area. The back
// line is a different standing grant even when it has the same op and target.
{
  let s = main(683307, "V683S_LEADER");
  const watcher = stage(s, "V683S_WATCH", "battle");
  const leader = s.players.p1.leader;
  const front = standingIds(s, watcher)[0]!;
  assert.ok(front);
  s = payPending(activate(s).state as GameState, 1);
  assert.ok(spent(s, watcher, front));
  s.players.p1.life.splice(4); // legal Awaken condition, as in the battle suite
  const awaken = engine.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === leader)?.action;
  assert.ok(awaken, "the engine offers legal Awaken at four life");
  s = engine.apply(CTX, s, awaken).state as GameState;
  assert.ok(s.cards[leader].flipped);
  const back = standingIds(s, watcher)[0]!;
  assert.ok(back && back !== front, "face identity changes while area epoch is stable");
  s = payPending(activate(s).state as GameState, 1);
  assert.ok(spent(s, watcher, back));
  console.log("  legacy legal Awaken: source face changes standing grant provenance");
}

// A copied [Permanent] has the copy effect's derived skill index. Replacing
// that copy changes provenance even on the same source and recipient entries.
{
  const s = main(683306);
  const watcher = stage(s, "V683S_WATCH", "battle");
  const source = stage(s, "V683S_COPY", "hand");
  const copied = { cardId: "V683S_COPY", side: "front" as const, skills: [0], from: source, name: "Copied Villainous" };
  const first = addEffect(s, [], { master: "p1", source, target: watcher, kind: "copiedSkills", value: 0, copied, until: "game" });
  const id = standingIds(s, watcher)[0]!;
  assert.ok(id);
  const done = payPending(activate(s).state as GameState, 1);
  assert.ok(spent(done, watcher, id));
  done.effects = done.effects.filter((e) => e.id !== first.id);
  addEffect(done, [], { master: "p1", source, target: watcher, kind: "copiedSkills", value: 0, copied, until: "game" });
  const fresh = standingIds(done, watcher)[0]!;
  assert.ok(fresh && fresh !== id);
  const again = payPending(activate(done).state as GameState, 1);
  assert.ok(spent(again, watcher, fresh));
  console.log("  legacy copied Permanent: replacement copy derives a fresh standing grant ID");
}

for (const id of IDS) {
  const prior = old.get(id);
  if (prior) DEFS[id] = prior;
  else delete DEFS[id];
}

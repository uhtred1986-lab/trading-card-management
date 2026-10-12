import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { interruptedOutcome, NOT_YET_REASON_PREFIX, resolveOutcome } from "../../src/lib/arena/outcome";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import type { VmState } from "../../src/lib/arena/vm/state";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { archivedSnapshotFor, buildSnapshot, type Snapshot } from "../../src/lib/arena/snapshot";
import { vmToBeats } from "../../src/lib/arena/vm/beats";
import type { Beats } from "../../src/lib/arena/beats";

const interrupt = interruptedOutcome({
  sourceCard: "opponent#17",
  skillIndex: 3,
  trigger: "attacks",
  issue: "#544",
  detail: "private card text",
});
const publicInterrupt = resolveOutcome({ winner: null, overReason: interrupt.reason, outcome: interrupt });
assert.equal(publicInterrupt?.kind, "interrupted");
assert.equal(publicInterrupt?.winner, null);
assert.doesNotMatch(publicInterrupt?.reason ?? "", /opponent#17|private card text/);
assert.equal("privateContext" in (publicInterrupt ?? {}), false, "private interrupt context must not enter the client projection");

const archivedInterrupt = resolveOutcome({
  winner: null,
  overReason: `${NOT_YET_REASON_PREFIX} — BT99-999: private effect name — #149`,
});
assert.equal(archivedInterrupt?.kind, "interrupted", "old prefixed states keep their meaning");
assert.doesNotMatch(archivedInterrupt?.reason ?? "", /BT99-999|private effect name/);

assert.equal(resolveOutcome({ winner: null, overReason: null }), null);
assert.equal(resolveOutcome({ winner: null, overReason: "both players lost" })?.kind, "draw");
assert.equal(resolveOutcome({ winner: "p1", overReason: "life ended" })?.kind, "win");
assert.equal(resolveOutcome({ winner: "p2", overReason: "You conceded", outcome: {
  kind: "concession",
  winner: "p2",
  concededBy: "p1",
  reason: "A player conceded.",
} })?.kind, "concession");
const abandoned = resolveOutcome({ winner: "p1", overReason: "life ended" }, "abandoned");
assert.equal(abandoned?.kind, "abandoned", "abandoned row status overrides a stale winner");
assert.equal(abandoned?.winner, null);

// Run an actual VM checkpoint with an unread automatic effect. This exercises
// the boundary that previously logged a note and let the turn continue.
const testDefs = { ...DEFS, "OUTCOME-UNREAD": card("OUTCOME-UNREAD", {
  skill: "[Auto] When you play this card, bend the fabric of reality to your will.",
}), "OUTCOME-FALSE": card("OUTCOME-FALSE", {
  skill: "[Auto] if your Leader Card is blue: When you play this card, bend the fabric of reality to your will.",
}), "OUTCOME-REVIVE-PRICE": card("OUTCOME-REVIVE-PRICE", {
  skill: "[Revive red/blue] {r}",
}) };
const testCtx = { ...CTX, defs: testDefs, scripts: rulesFromCompiler(testDefs) };
const rules = rulesetFor("dbs");
assert.ok(rules.ok, "the test ruleset should load");
const created = RULES.createGame(testCtx, {
  seed: 544,
  p1: { name: "You", leader: "L-RED", main: fifty("V1") },
  p2: { name: "Opponent", leader: "L-BLUE", main: fifty("V-BLUE") },
});
const live = created.state as VmState;
const source = live.sides.p1.zones.deck[0]!;
live.sides.p1.zones.deck.shift();
live.sides.p1.zones.battle.push(source);
live.cards[source]!.cardId = "OUTCOME-UNREAD";
live.pending.push({ card: source, skillIndex: 0, master: "p1", trigger: "played" });
const chooser = (live.prompt as { player: "p1" | "p2" }).player;
const ended = RULES.apply(testCtx, live, { type: "chooseFirst", player: chooser, first: "p1" });
const saved = ended.state as VmState;
assert.equal(saved.phase, "over", "unread automatic resolution must stop the game");
assert.equal(saved.outcome?.kind, "interrupted");
assert.equal(saved.outcome?.privateContext?.sourceCard, source, "the VM state keeps private diagnostic context");
assert.ok(ended.events.some((event) => event.type === "gameOver" && event.reason === saved.outcome?.reason));
assert.ok(ended.events.every((event) => event.type !== "note" || !event.text.includes(source)), "public interruption events must not name the hidden instance");

// A false condition means an unread effect is not due to resolve. The red
// Leader fails this deliberately blue-only condition, so the game continues.
const falseCreated = RULES.createGame(testCtx, {
  seed: 545,
  p1: { name: "You", leader: "L-RED", main: fifty("V1") },
  p2: { name: "Opponent", leader: "L-BLUE", main: fifty("V-BLUE") },
});
const falseState = falseCreated.state as VmState;
const falseSource = falseState.sides.p1.zones.deck[0]!;
falseState.sides.p1.zones.deck.shift();
falseState.sides.p1.zones.battle.push(falseSource);
falseState.cards[falseSource]!.cardId = "OUTCOME-FALSE";
falseState.pending.push({ card: falseSource, skillIndex: 0, master: "p1", trigger: "played" });
const falseChooser = (falseState.prompt as { player: "p1" | "p2" }).player;
const falseResult = RULES.apply(testCtx, falseState, { type: "chooseFirst", player: falseChooser, first: "p1" });
assert.notEqual((falseResult.state as VmState).outcome?.kind, "interrupted", "a false Auto condition stays an ordinary no-op");
assert.notEqual((falseResult.state as VmState).phase, "over");

// Revive is a real at-trigger keyword (`onLeave`) with a supported bare move.
// An unaffordable printed orb cost cancels it before returning the card from
// the Drop; the legacy keyword suite separately proves the bare form resolves.
const pricedCreated = RULES.createGame(testCtx, {
  seed: 546,
  p1: { name: "You", leader: "L-RED", main: fifty("V1") },
  p2: { name: "Opponent", leader: "L-BLUE", main: fifty("V-BLUE") },
});
const pricedState = pricedCreated.state as VmState;
const pricedSource = pricedState.sides.p1.zones.deck[0]!;
pricedState.sides.p1.zones.deck.shift();
pricedState.sides.p1.zones.drop.push(pricedSource);
pricedState.cards[pricedSource]!.cardId = "OUTCOME-REVIVE-PRICE";
pricedState.pending.push({ card: pricedSource, skillIndex: 0, master: "p1", trigger: "onLeave" });
const pricedChooser = (pricedState.prompt as { player: "p1" | "p2" }).player;
const pricedResult = RULES.apply(testCtx, pricedState, { type: "chooseFirst", player: pricedChooser, first: "p1" });
const pricedEnded = pricedResult.state as VmState;
assert.equal(pricedEnded.outcome, undefined, "an unaffordable known keyword cost cancels instead of interrupting");
assert.ok(pricedResult.events.some((event) => event.type === "note" && event.text.includes("unaffordable")), "failed affordability has its own outcome");
assert.ok(pricedEnded.sides.p1.zones.drop.includes(pricedSource), "Revive does not execute its move when its additional cost is unpayable");
assert.notEqual(pricedEnded.prompt.kind, "chooseCards", "Revive's effect prompt never opens after canceled payment");

const archiveBase = JSON.parse(readFileSync("contract/fixtures/versus.json", "utf8")) as Snapshot;
const archive = (over: Snapshot["over"], status = "over") => {
  const base = { ...archiveBase, game: { ...archiveBase.game, status }, over, view: { ...archiveBase.view, over: over ? { winner: over.winner, reason: over.reason } : null } };
  return { p1: base, p2: { ...base, game: { ...base.game, you: "p2" as const } } };
};
const newInterrupt = interruptedOutcome({ sourceCard: "opponent#17", detail: "hidden identity detail" });
const newInterruptArchive = archive(newInterrupt);
for (const seat of ["p1", "p2"] as const) {
  const projected = archivedSnapshotFor(newInterruptArchive, seat);
  assert.equal(projected?.over?.kind, "interrupted", "typed interruption survives archive projection for each viewer");
  assert.ok(!JSON.stringify(projected).includes("opponent#17"));
}
const restoredConcession = archivedSnapshotFor(archive({
  kind: "concession",
  winner: "p2",
  concededBy: "p1",
  reason: "A player conceded.",
}), "p1");
assert.equal(restoredConcession?.over?.kind, "concession", "typed concession survives archive projection");
assert.equal(restoredConcession?.over?.concededBy, "p1");
const archivedLegacyInterrupt = archivedSnapshotFor(archive({
  winner: null,
  reason: `${NOT_YET_REASON_PREFIX} — BT99-999 private detail`,
} as Snapshot["over"]), "p2");
assert.equal(archivedLegacyInterrupt?.over?.kind, "interrupted", "old prefixed archived interruptions are normalized");
assert.doesNotMatch(JSON.stringify(archivedLegacyInterrupt), /BT99-999|private detail/);

const archivedDraw = archivedSnapshotFor(archive({ kind: "draw", winner: null, reason: "Both players lost." }), "p1");
assert.equal(archivedDraw?.over?.kind, "draw", "a real draw stays a draw when archived");
const archivedAbandoned = archivedSnapshotFor(archive({ kind: "win", winner: "p1", reason: "life ended" }, "abandoned"), "p2");
assert.equal(archivedAbandoned?.over?.kind, "abandoned", "abandonment status overrides a stale archived winner");
assert.equal(archivedAbandoned?.over?.winner, null);

// Exercise live projection for both 1 v 1 seats, including the log and beat
// paths. The VM state keeps the source instance for diagnostics, while neither
// viewer receives it in the snapshot.
const liveBeats = vmToBeats(testCtx, saved, ended.events);
saved.outcome!.privateContext = { sourceCard: "SECRET-HIDDEN#17", detail: "unrevealed opponent card text" };
const liveSnapshot = (viewer: "p1" | "p2", state = saved, beats: Beats = liveBeats, log = [saved.outcome!.reason]) => buildSnapshot({
  id: 544,
  revision: 1,
  mode: "versus",
  engine: "rules",
  status: "over",
  p1Name: "You",
  p2Name: "Opponent",
  ctx: testCtx,
  state,
  legal: [],
  log,
  beats,
  spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
  ai: null,
  viewer,
  images: {},
});
for (const viewer of ["p1", "p2"] as const) {
  const projected = liveSnapshot(viewer);
  assert.equal(projected.game.you, viewer);
  assert.equal(projected.over?.kind, "interrupted");
  assert.ok(!JSON.stringify(projected).includes("SECRET-HIDDEN#17"), "neither live viewer sees the hidden source instance");
  assert.ok(!JSON.stringify(projected).includes("unrevealed opponent card text"));
}

const legacyState = structuredClone(saved);
legacyState.outcome = null;
legacyState.overReason = `${NOT_YET_REASON_PREFIX} — ${source}: private card text`;
const legacyBeat: Beats = { seq: 1, art: {}, list: [{ n: 1, t: "over", winner: null, reason: legacyState.overReason }] };
for (const viewer of ["p1", "p2"] as const) {
  const projected = liveSnapshot(viewer, legacyState, legacyBeat, [legacyState.overReason]);
  assert.equal(projected.over?.kind, "interrupted");
  assert.doesNotMatch(JSON.stringify(projected), /private card text/);
}

console.log("  ok  typed, legacy, private, and abandoned game outcomes");

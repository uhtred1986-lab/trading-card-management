import assert from "node:assert/strict";
import { createPracticeSession } from "../../src/lib/arena/tutorial/session";
import { currentLesson, affordabilityPrompt, handoffReady, initialProgress, lessonReducer, type LearningProgress } from "../../src/lib/arena/tutorial/lessons";
import type { Action } from "../../src/lib/arena/types";

let progress: LearningProgress = initialProgress();
const session = createPracticeSession();
let last: Parameters<typeof lessonReducer>[1] | null = null;
session.subscribe(t => { last = { type: "transition", ...t }; progress = lessonReducer(progress, last); });
const snapshot = session.getSnapshot();
assert.equal(currentLesson(progress, snapshot).id, "t1.charge");
assert.match(affordabilityPrompt(snapshot).question, /cost 1, Green/);
assert.doesNotMatch(affordabilityPrompt(snapshot).feedback, /red/);
const predicted = lessonReducer(progress, { type: "prediction", id: "t1.affordability", answer: "No" });
assert.deepEqual(session.getSnapshot(), snapshot, "prediction cannot spend energy or an action");
assert.equal(predicted.revision, -1);
assert.equal(lessonReducer(progress, { type: "acknowledge", id: "t2.resolve" }), progress, "a teaching acknowledgement cannot claim gameplay evidence");
assert.equal(handoffReady(progress), false);
for (let n = 0; n < 160; n++) {
  const before = session.getSnapshot();
  if (before.over || handoffReady(progress)) break;
  if (before.waiting === "opponent") { assert.equal((await session.advance()).error, null); continue; }
  if (before.view.prompt.kind === "combo") {
    const id = currentLesson({ ...progress, predictions: { "opp.attack-predict": "answered" } }, before).id;
    assert.equal(id, before.view.turnPlayer === before.view.you.player ? "t2.offense-combo" : "opp.defend", "combo guidance follows the current attacking/defending role");
  }
  if (["counter", "blocker"].includes(before.view.prompt.kind)) assert.equal(currentLesson(progress, before).id, "classic.response");
  const actions = before.legal.map(x => x.action);
  const action: Action | undefined = actions.find(a => a.type === "charge" && a.card !== null)
    ?? actions.find(a => a.type === "play") ?? actions.find(a => a.type === "attack")
    ?? actions.find(a => a.type === "endMain") ?? actions.find(a => a.type === "pass")
    ?? actions.find(a => a.type === "zEnergyFromCombo" && a.card === null) ?? actions[0];
  assert.ok(action);
  assert.equal((await session.act(action, before.game.revision, `lesson:${n}`)).error, null);
  const afterAccepted = progress;
  assert.ok(last);
  assert.equal(lessonReducer(progress, last!), progress, "duplicate semantic transitions cannot advance progress");
  assert.ok((await session.act(action, before.game.revision, `invalid:${n}`)).error, "stale action is rejected");
  assert.equal(progress, afterAccepted, "failed actions emit no lesson progress");
}
assert.ok(progress.completed.includes("t1.charge"));
assert.ok(progress.completed.includes("t1.play"));
assert.ok(progress.completed.includes("t1.end"));
assert.ok(progress.completed.includes("opp.observe"));
assert.ok(progress.defended, "declining combo through the real defense step counts as defense");
assert.ok(progress.payment?.includes("energy rested"));
assert.ok(progress.ownTurns >= 2);
const active = session.getSnapshot();
const withOldOpponentQuestion = { ...progress, predictions: {}, completed: progress.completed.filter(id => id !== "opp.attack-predict") };
assert.ok(!currentLesson(withOldOpponentQuestion, active).id.startsWith("opp."), "old opponent predictions cannot block the active own turn");
const skipped = lessonReducer(initialProgress(), { type: "skip", id: "opp.defend" });
assert.equal(skipped.defended, false, "skipping an explanation must not claim demonstrated defense");
assert.equal(handoffReady(skipped), false, "skipping alone cannot claim battle completion");
assert.deepEqual(session.getSnapshot(), active, "lesson skipping leaves the entire match unchanged");
assert.ok(progress.ownBattleResolved, "handoff requires confirmed own battle outcome");
assert.equal(handoffReady(progress), true);
console.log("tutorial lessons: real controls, payment, defense, battle outcome, duplicate/failed action guards and prediction isolation pass");

// Alternate legal card and declined charge follow the same semantic evidence path.
const alternate = createPracticeSession();
let alternateProgress = initialProgress();
alternate.subscribe(t => { alternateProgress = lessonReducer(alternateProgress, { type: "transition", ...t }); });
const noCharge = alternate.getSnapshot().legal.find(l => l.action.type === "charge" && l.action.card === null)!.action;
assert.equal((await alternate.act(noCharge, 0, "decline-charge")).error, null);
assert.ok(alternateProgress.completed.includes("t1.charge"));
assert.equal(alternate.getSnapshot().view.you.energy.length, 0);
assert.equal(alternateProgress.payment, null);
let ended = false;
for (let n = 0; n < 250; n++) {
  const snap = alternate.getSnapshot();
  if (snap.over) { ended = true; break; }
  if (snap.waiting === "opponent") { assert.equal((await alternate.advance()).error, null); continue; }
  const legal = snap.legal.map(l => l.action);
  const plays = legal.filter(a => a.type === "play");
  const action = legal.find(a => a.type === "charge" && a.card !== null) ?? plays[plays.length - 1] ?? legal.find(a => a.type === "attack") ?? legal.find(a => a.type === "endMain") ?? legal.find(a => a.type === "pass") ?? legal.find(a => a.type === "zEnergyFromCombo" && a.card === null) ?? legal[0];
  assert.ok(action);
  assert.equal((await alternate.act(action, snap.game.revision, `alternate:${n}`)).error, null);
}
assert.equal(ended, true, "guidance choices cannot trap a complete game after declining first charge");

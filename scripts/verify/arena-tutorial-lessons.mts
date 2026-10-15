import assert from "node:assert/strict";
import { createPracticeSession } from "../../src/lib/arena/tutorial/session";
import { compactCoach, BADGE_GLOSSARY, currentLesson, affordabilityPrompt, handoffReady, initialProgress, lessonReducer, type LearningProgress } from "../../src/lib/arena/tutorial/lessons";
import type { Action } from "../../src/lib/arena/types";

let progress: LearningProgress = initialProgress();
const session = createPracticeSession();
let last: Parameters<typeof lessonReducer>[1] | null = null;
session.subscribe(t => { last = { type: "transition", ...t }; progress = lessonReducer(progress, last); });
const snapshot = session.getSnapshot();
assert.match(compactCoach("t1.charge", snapshot).instruction, /Tap a hand card, then Charge it/);
assert.match(compactCoach("t1.charge", snapshot).instruction, /Pass means no charge/);
assert.match(compactCoach("t1.charge", snapshot).concept, /stays in Energy/);
assert.match(BADGE_GLOSSARY, /BLK = Blocker/);
assert.match(BADGE_GLOSSARY, /not colors/);
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
    const coach = compactCoach("t1.play", before);
    assert.match(coach.instruction, before.view.turnPlayer === before.view.you.player ? /attacker/ : /defender/);
    assert.match(coach.concept, /Playing a card does not add combo power/);
    assert.match(coach.concept, /eligible Battle Card/);
    assert.match(coach.concept, /zero energy cost still spends/);
    assert.match(coach.concept, /attacker wins ties/);
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
const declined = alternate.getSnapshot();
assert.equal(currentLesson(alternateProgress, declined).id, "t1.end");
assert.doesNotMatch(compactCoach("classic.awaken", declined).instruction, /Awaken|flip/);
assert.ok(lessonReducer(initialProgress(), { type: "acknowledge", id: "classic.evolve" }).completed.includes("classic.evolve"));
assert.match(compactCoach("t1.play", declined).instruction, /End turn/);
assert.match(compactCoach("t1.play", declined).concept, /no energy/);
assert.match(compactCoach("t1.play", declined).concept, /cannot attack on their first turn/);
assert.doesNotMatch(compactCoach("t1.play", declined).instruction, /choose Play|playable/);
let checkedSecondDecline = false;
let ended = false;
for (let n = 0; n < 250; n++) {
  const snap = alternate.getSnapshot();
  if (snap.over) { ended = true; break; }
  if (snap.waiting === "opponent") { assert.equal((await alternate.advance()).error, null); continue; }
  const legal = snap.legal.map(l => l.action);
  if (!checkedSecondDecline && snap.view.prompt.kind === "charge" && snap.view.turn > 1) {
    const declineAgain = legal.find(a => a.type === "charge" && a.card === null)!;
    assert.equal((await alternate.act(declineAgain, snap.game.revision, "decline-again")).error, null);
    const main = alternate.getSnapshot();
    assert.equal(main.view.you.energy.length, 0);
    assert.ok(main.legal.some(l => l.action.type === "attack" && l.action.attacker === main.view.you.leader?.id));
    const coach = compactCoach("t1.play", main);
    assert.match(coach.instruction, /Leader.*attack target/);
    assert.match(coach.instruction, /costs no energy/);
    assert.match(coach.concept, /no energy after declining charge/);
    assert.doesNotMatch(coach.instruction, /choose Play|playable/);
    checkedSecondDecline = true;
    continue;
  }
  const awakening = snap.legal.find(l => l.action.type === "activate" && l.action.card === snap.view.you.leader?.id && /awaken/i.test(l.label));
  if (awakening && snap.view.prompt.kind === "main") {
    const coach = compactCoach("classic.awaken", snap);
    assert.match(coach.concept, /four Life or less/);
    assert.match(coach.concept, /draw two/);
    assert.match(coach.concept, /Evolve is a separate Battle Card ability/);
  }
  const plays = legal.filter(a => a.type === "play");
  const action = legal.find(a => a.type === "charge" && a.card !== null) ?? plays[plays.length - 1] ?? legal.find(a => a.type === "attack") ?? legal.find(a => a.type === "endMain") ?? legal.find(a => a.type === "pass") ?? legal.find(a => a.type === "zEnergyFromCombo" && a.card === null) ?? legal[0];
  assert.ok(action);
  assert.equal((await alternate.act(action, snap.game.revision, `alternate:${n}`)).error, null);
}
assert.equal(ended, true, "guidance choices cannot trap a complete game after declining first charge");

assert.ok(checkedSecondDecline, "real second-turn no-energy snapshot teaches the legal free Leader attack");

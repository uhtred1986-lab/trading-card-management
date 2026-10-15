import assert from "node:assert/strict";
import { createPracticeSession, restorePracticeSession, type PracticeSession } from "../../src/lib/arena/tutorial/session";
import { createPracticeState } from "../../src/lib/arena/tutorial/fixture";
import type { Action } from "../../src/lib/arena/types";

const fresh = createPracticeSession();
assert.deepEqual(fresh.getSnapshot(), createPracticeSession().getSnapshot());
const state = createPracticeState();
for (const p of ["p1", "p2"] as const) {
  assert.equal(state.sides[p].zones.life.length, 3);
  assert.equal(Object.values(state.sides[p].zones).flat().length, 51);
}
const initial = fresh.getSnapshot();
assert.equal(initial.view.you.handCount, 6, "first player has no opening-turn draw");
assert.equal(initial.view.them.hand, null, "opponent hand is concealed");
let notifications = 0;
const unsubscribe = fresh.subscribe(t => {
  notifications++;
  assert.equal(t.after.game.revision, t.before.game.revision + 1);
  assert.equal(t.after.view.them.hand, null);
});
const first = initial.legal.find(x => x.action.type === "charge" && x.action.card !== null)!.action;
assert.equal((await fresh.act(first, 0, "first")).error, null);
assert.equal((await fresh.act(first, 0, "first")).error, null);
assert.equal(fresh.getSnapshot().game.revision, 1);
assert.equal(notifications, 1, "receipt replay is not another semantic action");
assert.ok(!fresh.getSnapshot().legal.some(x => x.action.type === "attack"), "first player cannot attack on turn one");
unsubscribe();
assert.ok((await fresh.act(first, 0, "stale")).error);
assert.ok((await fresh.act({ type: "concede", player: "p2" }, 1, "foreign")).error);
assert.ok((await fresh.act({ type: "endMain", player: "p1" }, 1, "first")).error);
assert.deepEqual(restorePracticeSession(fresh.serialize()).getSnapshot(), fresh.getSnapshot());
assert.throws(() => restorePracticeSession({ ...fresh.serialize(), fixture: 999 }));
assert.throws(() => restorePracticeSession({ version: 1, fixture: 1, journal: [{ action: first, basedOn: 7, requestId: "bad" }] }));

// Explicit selected-energy declarations use the real engine payment validator.
{
  const session = restorePracticeSession(fresh.serialize());
  const snapshot = session.getSnapshot();
  const play = snapshot.legal.find(x => x.action.type === "play")!.action;
  assert.equal(play.type, "play");
  if (play.type !== "play") throw new Error("expected training play");
  assert.ok((await session.act({ ...play, pay: ["not-energy"] }, snapshot.game.revision, "bad-pay")).error);
  assert.equal(session.getSnapshot().game.revision, snapshot.game.revision);
  assert.equal((await session.act({ ...play, pay: [snapshot.view.you.energy[0].id] }, snapshot.game.revision, "selected-pay")).error, null);
  assert.equal(session.getSnapshot().view.you.activeEnergy, 0);
  assert.equal(session.getSnapshot().view.you.battle.length, 1);
  assert.deepEqual(restorePracticeSession(session.serialize()).getSnapshot(), session.getSnapshot());
}
// Human request names cannot collide with deterministic opponent receipt names.
{
  const session = createPracticeSession();
  let snapshot = session.getSnapshot();
  const skip = snapshot.legal.find(x => x.action.type === "charge" && x.action.card === null)!.action;
  assert.equal((await session.act(skip, 0, "opponent:2")).error, null);
  snapshot = session.getSnapshot();
  assert.equal((await session.act(snapshot.legal.find(x => x.action.type === "endMain")!.action, 1, "end-collision")).error, null);
  assert.equal((await session.advance()).error, null);
  assert.ok(session.getSnapshot().game.revision > 2);
  assert.equal(session.getSnapshot().waiting, "you");
  assert.deepEqual(restorePracticeSession(session.serialize()).getSnapshot(), session.getSnapshot());
}
// A batched advance retains every numbered public beat even if React renders only its last snapshot.
{
  const session = createPracticeSession();
  let before = session.getSnapshot();
  const skip = before.legal.find(x => x.action.type === "charge" && x.action.card === null)!.action;
  await session.act(skip, before.game.revision, "skip");
  before = session.getSnapshot();
  await session.act(before.legal.find(x => x.action.type === "endMain")!.action, before.game.revision, "end");
  const priorSeq = session.getSnapshot().beats?.seq ?? 0;
  await session.advance();
  const beats = session.getSnapshot().beats!.list.filter(b => b.n > priorSeq);
  assert.ok(beats.some(b => b.t === "move" && b.owner === "p2" && b.to === "energy"), "opponent charge retained");
  assert.ok(beats.some(b => b.t === "move" && b.owner === "p2" && b.to === "battle"), "opponent play retained");
  assert.ok(beats.some(b => b.t === "attack"), "opponent attack retained");
  assert.equal(new Set(beats.map(b => b.n)).size, beats.length, "beat numbers remain unique");
}

async function drive(options: { combos: number; skipCharge?: boolean; passive?: boolean; alternate?: boolean }) {
  let session: PracticeSession = createPracticeSession();
  const battles: { attack: number; guard: number; lifeBefore: number; lifeAfter: number }[] = [];
  let defensiveCombos = 0;
  let defenseBefore: ReturnType<PracticeSession["getSnapshot"]> | null = null;
  let opponentAttacks = 0;
  const attach = () => session.subscribe(t => {
    if (t.actor === "p2" && t.action.type === "attack") opponentAttacks++;
    if (t.before.view.battle && !t.after.view.battle && defenseBefore) {
      const battle = defenseBefore.view.battle!;
      battles.push({ attack: battle.attackPower, guard: battle.guardPower, lifeBefore: defenseBefore.view.you.life, lifeAfter: t.after.view.you.life });
      defenseBefore = null;
    }
  });
  let detach = attach();
  for (let n = 0; n < 500; n++) {
    const snapshot = session.getSnapshot();
    if (snapshot.over) return { snapshot, battles, opponentAttacks };
    if (snapshot.waiting === "opponent") { assert.equal((await session.advance()).error, null); continue; }
    const actions = snapshot.legal.map(x => x.action);
    const defense = snapshot.view.battle && snapshot.decision?.battleStep === "defense";
    let action: Action | undefined;
    if (defense && defensiveCombos < options.combos) {
      action = actions.find(a => a.type === "combo");
      if (action) defensiveCombos++;
    }
    if (defense) defenseBefore = snapshot;
    action ??= actions.find(a => a.type === "charge" && (options.skipCharge ? a.card === null : a.card !== null));
    if (!options.passive) {
      const plays = actions.filter(a => a.type === "play");
      action ??= plays[options.alternate ? plays.length - 1 : 0];
      action ??= actions.find(a => a.type === "attack");
    }
    action ??= actions.find(a => a.type === "endMain") ?? actions.find(a => a.type === "pass")
      ?? actions.find(a => a.type === "zEnergyFromCombo" && a.card === null) ?? actions[0];
    assert.ok(action, "a finishable human decision");
    assert.equal((await session.act(action, snapshot.game.revision, `human:${n}`)).error, null);
    // Restore in the middle of real prompts and battles, including their payment/response cursor.
    if (n % 7 === 0) {
      const restored = restorePracticeSession(JSON.parse(JSON.stringify(session.serialize())));
      assert.deepEqual(restored.getSnapshot(), session.getSnapshot());
      detach(); session = restored; detach = attach();
    }
  }
  assert.fail("scenario did not finish within the deterministic bound");
}
for (const combos of [0, 1, 2]) {
  const result = await drive({ combos, passive: true });
  assert.equal(result.snapshot.over?.winner, "p2");
  assert.equal(result.battles[0].attack, 10000);
  assert.equal(result.battles[0].guard, 10000 + 5000 * combos);
  assert.equal(result.battles[0].lifeAfter, combos === 0 ? 2 : 3);
  assert.ok(result.opponentAttacks > 0);
}
assert.ok((await drive({ combos: 0, skipCharge: true })).snapshot.over);
assert.equal((await drive({ combos: 0, alternate: true })).snapshot.over?.winner, "p1");
console.log("arena tutorial session: deterministic setup, receipts, restore, legal deviations and complete match paths pass");

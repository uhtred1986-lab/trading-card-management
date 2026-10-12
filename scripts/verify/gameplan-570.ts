/** #570: a plan is a disposable engine run; hidden branches never produce projected resources. */
import assert from "node:assert/strict";
import { previewGameplan } from "../../src/lib/arena/gameplan-preview";
import { zoneOf } from "../../src/lib/arena/engine-state";
import { engineFor } from "../../src/lib/arena/engines";
import { CTX, ENGINE, arenaG, findG } from "./harness";
import { planActions, planCtx, planState } from "./gameplan-fixture-570";
import type { Action } from "../../src/lib/arena/types";

const ctx = planCtx;
const game = planState(ENGINE);
const moves = planActions(game);
assert.equal(moves.length, 2);
const original = JSON.stringify(game);
const two = previewGameplan({ engine: ENGINE, ctx, state: game, art: {}, player: "p1", actions: moves });
assert.equal(two.stopped, null, JSON.stringify(two));
const one = previewGameplan({ engine: ENGINE, ctx, state: game, art: {}, player: "p1", actions: moves.slice(0, 1) });
assert(one.next.some((move) => JSON.stringify(move.action) === JSON.stringify(moves[1])), "the follow-up menu offers the second safe legal move");
assert(one.next.every((move) => move.action.type === "activate"), "uncertain plays never enter the follow-up menu");
for (const move of one.next) {
  const follow = previewGameplan({ engine: ENGINE, ctx, state: game, art: {}, player: "p1", actions: [moves[0], move.action] });
  assert.equal(follow.stopped, null, "every offered follow-up remains legal on the actual simulated board");
}
assert.deepEqual(two.steps.map((step) => step.budget.ready), [2, 1, 0]);
assert.deepEqual(two.steps.map((step) => step.budget.colors.map((color) => `${color.color}:${color.ready}/${color.total}`)), [["Red:2/2"], ["Red:1/2"], ["Red:0/2"]]);
assert.equal(JSON.stringify(game), original, "live state, RNG, action history remain untouched");
let actual = structuredClone(game);
for (const [index, move] of moves.entries()) {
  assert("card" in move);
  const selectedCard = move.card;
  const energy = new Set(zoneOf(actual, "p1", "energy"));
  const applied = engineFor(ENGINE).apply(ctx, actual, move);
  assert.equal(applied.events.filter((event) => event.type === "mode" && event.mode === "rest" && energy.has(event.card)).length, 1,
    "the printed Red price rests exactly one energy");
  assert(applied.events.some((event) => event.type === "mode" && event.card === selectedCard && event.mode === "rest"),
    "the selected card's safe effect rests itself");
  actual = applied.state;
  assert.equal(engineFor(ENGINE).boardView(ctx, actual, "p1", {}).you.activeEnergy, two.steps[index + 1].budget.ready,
    "preview agrees with applied engine cost without changing the original");
}

const illegal = previewGameplan({ engine: ENGINE, ctx, state: game, art: {}, player: "p1", actions: [{ ...moves[0], card: "forged" } as Action] });
assert.equal(illegal.steps.length, 0);
assert.match(illegal.stopped!, /not available/);

// A selected price with a hidden-hand condition must be rejected before
// legality or payment is evaluated, even if the opponent changes identities.
const secretRule = { ...ctx.scripts!["PLAN-READY"], bySkill: { ...ctx.scripts!["PLAN-READY"].bySkill,
  0: { ...ctx.scripts!["PLAN-READY"].bySkill[0], price: { ...ctx.scripts!["PLAN-READY"].bySkill[0].price,
    condition: { kind: "count", area: "opponentHand" } } } } };
const secretCtx = { ...ctx, scripts: new Proxy({} as NonNullable<typeof ctx.scripts>, { get: (_, key) => key === "PLAN-READY" ? secretRule : ctx.scripts?.[key as string] }) };
const secretA = structuredClone(game);
const secretB = structuredClone(game);
const concealed = engineFor(ENGINE).boardView(ctx, secretB, "p2", {}).you.hand?.[0];
if (concealed) secretB.cards[concealed.id].cardId = "BIG";
const a = previewGameplan({ engine: ENGINE, ctx: secretCtx, state: secretA, art: {}, player: "p1", actions: moves });
const b = previewGameplan({ engine: ENGINE, ctx: secretCtx, state: secretB, art: {}, player: "p1", actions: moves });
assert.deepEqual(a, b, "opponent secret identity cannot change the stop or budget");
assert.equal(a.steps.length, 0, "unsafe public rule is rejected before even the current budget is projected");
assert.match(a.stopped!, /cannot be projected safely/);

assert(ctx.scripts!["L-RED"].bySkill[0]?.ops.some((op) => op.op === "draw"), "normal Leader retains its unrelated draw skill");
const watcherRule = { ...ctx.scripts!["PLAN-READY"], bySkill: { ...ctx.scripts!["PLAN-READY"].bySkill,
  10: { ops: [{ op: "draw", n: 1 }], unsupported: [], trigger: ["restedBySkill"] } } };
const watcherCtx = { ...ctx,
  defs: { ...ctx.defs, "PLAN-READY": { ...ctx.defs["PLAN-READY"], skill: `${ctx.defs["PLAN-READY"].skill}\n[Auto] When this card is switched to Rest Mode by one of your skills, draw 1 card.` } },
  scripts: new Proxy({} as NonNullable<typeof ctx.scripts>, { get: (_, key) => key === "PLAN-READY" ? watcherRule : ctx.scripts?.[key as string] }),
};
const watched = previewGameplan({ engine: ENGINE, ctx: watcherCtx, state: game, art: {}, player: "p1", actions: moves });
assert.equal(watched.steps.length, 0, "reachable rest watcher refuses projection before hidden draw");
assert.match(watched.stopped!, /cannot be projected safely/);

// Native marker removal has its own trigger moments, even when the script's
// body is an otherwise safe switch to Rest Mode.
const markerCtx = { ...ctx, defs: { ...ctx.defs, "PLAN-READY": { ...ctx.defs["PLAN-READY"],
  skill: "[Activate: Main][Spirit Boost 1]{r}: Switch this card to Rest Mode." } } };
const markerWatcher = previewGameplan({ engine: ENGINE, ctx: markerCtx, state: game, art: {}, player: "p1", actions: moves });
assert.equal(markerWatcher.steps.length, 0, "marker-paid skill stops before marker watchers can fire");

const copied = structuredClone(game);
assert("card" in moves[0] && typeof moves[0].card === "string");
copied.effects.push({ id: 570, kind: "copiedSkills", target: moves[0].card, value: 0,
  copied: { cardId: "PLAN-READY", side: "front", skills: [0] }, until: "game",
  ownerTurn: "p1", master: "p1", createdTurn: copied.turn });
const copiedPlan = previewGameplan({ engine: ENGINE, ctx, state: copied, art: {}, player: "p1", actions: moves });
assert.equal(copiedPlan.steps.length, 0, "effective copied skills stop before legality or payment");

const facedownA = structuredClone(game);
const secretField = zoneOf(facedownA, "p2", "deck").pop()!;
zoneOf(facedownA, "p2", "battle").push(secretField);
facedownA.cards[secretField].hidden = true;
const facedownB = structuredClone(facedownA);
facedownB.cards[secretField].cardId = "BIG";
const fieldA = previewGameplan({ engine: ENGINE, ctx, state: facedownA, art: {}, player: "p1", actions: moves });
const fieldB = previewGameplan({ engine: ENGINE, ctx, state: facedownB, art: {}, player: "p1", actions: moves });
assert.deepEqual(fieldA, fieldB, "opponent Hidden Mode identities cannot change the budget or refusal");
assert.deepEqual(fieldA.steps.map((step) => step.budget.ready), [2, 1, 0]);

// An activated draw is legal, but its hidden card cannot influence a budget.
const drawing = arenaG({ hand: ["E-DRAW"], energy: ["V1"] });
const drawCard = findG(drawing, "p1", "hand", "E-DRAW");
const drawAction = engineFor(ENGINE).legalActions(ctx, drawing).find((entry) => entry.action.type === "activate" && entry.action.card === drawCard)?.action;
assert.ok(drawAction, "draw skill is available in Main Phase");
const drawPlan = previewGameplan({ engine: ENGINE, ctx, state: drawing, art: {}, player: "p1", actions: [drawAction] });
assert.equal(drawPlan.steps.length, 0, "draw effect is rejected before a budget is projected");
assert.ok(drawPlan.stopped);

// A play is a possible Counter: Play window even when the opponent's actual
// concealed hand has no counter. Never simulate it to learn which case holds.
const plainOpponent = arenaG({ hand: ["V1"], energy: ["V1"], oppHand: ["BIG"] });
const counterOpponent = structuredClone(plainOpponent);
const hidden = zoneOf(counterOpponent, "p2", "hand").find((id) => counterOpponent.cards[id].cardId === "BIG")!;
counterOpponent.cards[hidden].cardId = "PLAN-COUNTER";
const playCard = findG(plainOpponent, "p1", "hand", "V1");
const play: Action = { type: "play", player: "p1", card: playCard };
const withoutCounter = previewGameplan({ engine: ENGINE, ctx, state: plainOpponent, art: {}, player: "p1", actions: [play] });
const withCounter = previewGameplan({ engine: ENGINE, ctx, state: counterOpponent, art: {}, player: "p1", actions: [play] });
assert.deepEqual(withCounter, withoutCounter, "Counter possession cannot change the plan response");
assert.equal(withCounter.steps.length, 1, "no post-play resources cross a possible response window");
assert.match(withCounter.stopped!, /opponent response/);
console.log(`#570 ${ENGINE}: two coloured payments, forged action, immutable state, hidden-condition and Counter stops`);
delete CTX.defs["PLAN-READY"];
delete CTX.defs["PLAN-COUNTER"];

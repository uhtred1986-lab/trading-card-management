/**
 * VM-era adapter compatibility checks owned by #118. The rules-only #459 lane
 * never calls this module's runner. Keep these assertions until #118 retires
 * saved legacy games and their interpreter explicitly.
 */
import assert from "node:assert/strict";
import { toBeats } from "../../src/lib/arena/beats";
import { apply, createGame, legalActions, rejectedActions } from "../../src/lib/arena/engine";
import { boardView } from "../../src/lib/arena/view";
import { AVAILABLE_ENGINES, EngineMismatch, engineFor, isVmState, legacyState, playableEngine, type Engine } from "../../src/lib/arena/engines";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm";
import { CTX, cardNow, fifty, matches } from "./harness";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { RULES_ONLY } from "./rules-only";

const CALLS: (keyof Engine & string)[] = ["createGame", "apply", "legalActions", "rejectedActions", "boardView", "toBeats"];

export function verifyLegacyVmCompatibility(rulesState: VmState): void {
  if (RULES_ONLY) return;

  // §1: the legacy adapter is the old public implementation, call for call.
  const legacy = engineFor("legacy");
  assert.equal(legacy.id, "legacy", "engineFor(legacy) handed back another engine");
  for (const call of CALLS) assert.equal(typeof legacy[call], "function", `the legacy engine has no ${call}`);
  assert.equal(legacy.createGame, createGame, "the legacy adapter's createGame is not the engine's own");
  assert.equal(legacy.apply, apply, "the legacy adapter's apply is not the engine's own");
  assert.equal(legacy.legalActions, legalActions, "the legacy adapter's legalActions is not the engine's own");
  assert.equal(legacy.rejectedActions, rejectedActions, "the legacy adapter's rejectedActions is not the engine's own");
  assert.equal(legacy.boardView, boardView, "the legacy adapter's boardView is not view.ts's own");
  assert.equal(legacy.toBeats, toBeats, "the legacy adapter's toBeats is not beats.ts's own");

  // §§2–3/5: legacy remains available, legacy states stay legacy-shaped, and
  // the saved-state seam accepts them while rejecting a rules state.
  assert.deepEqual(AVAILABLE_ENGINES, ["legacy", "rules"], "the engines a new game may be made on have changed");
  assert.equal(playableEngine("legacy").id, "legacy", "the legacy engine is refused for a new game");
  const decks = { seed: 11, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };
  const saved = createGame(CTX, decks).state;
  assert.equal(isVmState(saved), false, "a legacy state was read as the rules engine's");
  assert.throws(() => legacyState(rulesState), EngineMismatch, "a rules state was read as the legacy engine's");
  assert.equal(legacyState(saved), saved, "a legacy state did not pass the seam untouched");

  // §21: a plain Battle Card that is both forbidden and short of energy is
  // answered price-first by legacy. The rules engine's ban-first answer stays
  // in vm.ts. This ordering is an intentional #118 compatibility divergence.
  const banDecks = { seed: 14, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };
  let board = createGame(CTX, banDecks).state;
  for (let i = 0; i < 30; i++) {
    const prompt = board.prompt as { kind: string; player: PlayerId };
    const action: Action | null =
      prompt.kind === "chooseFirst"
        ? { type: "chooseFirst", player: prompt.player, first: "p1" }
        : prompt.kind === "mulligan"
          ? { type: "mulligan", player: prompt.player, redraw: false }
          : prompt.kind === "charge"
            ? { type: "charge", player: prompt.player, card: null }
            : null;
    if (!action) break;
    board = apply(CTX, board, action).state;
  }
  assert.equal(board.prompt.kind, "main", "the legacy compatibility board did not reach Main Phase");
  for (const id of board.players.p1.hand) board.cards[id].cardId = "V1";
  const card = board.players.p1.hand[0];
  const source = board.players.p1.deck.shift()!;
  board.cards[source].cardId = "F-NO-PLAY";
  board.cards[source].mode = "active";
  board.players.p1.battle = [source];
  board.players.p1.energy = [];
  const legal = legalActions(CTX, board);
  const first = rejectedActions(CTX, board, legal).find((x) => x.action.type === "play" && x.action.card === card)?.why[0];
  assert.deepEqual(first, { kind: "energy", need: 1, have: 0 }, "legacy no longer answers the price before the permanent ban");

  // §26: legacy cardNow/matches face semantics, including its Hidden Mode
  // placeholder. These public legacy shape details belong to #118; vm.ts
  // separately fixes the rules engine's printed/front/back/hidden attributes.
  {
    // The same board on the legacy engine, held to the same claims —
    // `cardNow`, which every `matches` call reads a card through, was still
    // returning the raw catalog row's `name`/`skill` regardless of the face
    // showing until this issue.
    const faceDecks = { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };
    let l = createGame(CTX, faceDecks).state;
    l = apply(CTX, l, { type: "chooseFirst", player: (l.prompt as { player: PlayerId }).player, first: "p1" }).state;
    l = apply(CTX, l, { type: "mulligan", player: "p1", redraw: false }).state;
    l = apply(CTX, l, { type: "mulligan", player: "p2", redraw: false }).state;
    const legacyLeader = l.players.p1.leader;
    const legacyFront = cardNow(CTX, l, legacyLeader);
    assert.equal(legacyFront.name, "L-RED", "the legacy engine is not read at its front side's name (1-9)");
    assert.deepEqual(legacyFront.colors, ["Red"], "the legacy engine's unflipped colours moved for no reason");

    l.cards[legacyLeader].flipped = true;
    const legacyBack = cardNow(CTX, l, legacyLeader);
    assert.equal(legacyBack.name, "L-RED awakened", "1-9: the legacy engine (matches/cardNow) is not read at a flipped Leader's back side's name (issue #327)");
    assert.equal(legacyBack.skill, null, "1-9: the legacy engine is not read at a flipped Leader's back side's skill");
    assert.deepEqual(legacyBack.colors, ["Red"], "10-1-3: the legacy engine's colours have no back-side value of their own either");
    assert.ok(matches(legacyBack, { ...emptyFilter(), names: ["L-RED awakened"] }), "matches does not find a flipped Leader by its awakened name");
    assert.ok(!matches(legacyBack, { ...emptyFilter(), names: ["L-RED"] }), "matches still finds a flipped Leader by its front name, which 10-1-3 says is no longer relevant");

    l.cards[legacyLeader].flipped = false;
    l.cards[legacyLeader].hidden = true;
    const legacyHidden = cardNow(CTX, l, legacyLeader);
    assert.equal(legacyHidden.name, "Hidden card", "23-5-2: the legacy engine's Hidden Mode reading lost its own placeholder name");
    assert.equal(legacyHidden.skill, null, "23-5-2: the legacy engine was read at a Hidden Mode card's printed skill");
    assert.deepEqual(legacyHidden.colors, [], "23-5-2: the legacy engine was read at a Hidden Mode card's printed colours");
    assert.deepEqual(legacyHidden.traits, [], "23-5-2: the legacy engine was read at a Hidden Mode card's printed traits");
  }
}

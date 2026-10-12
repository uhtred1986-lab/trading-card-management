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
import { CTX, fifty } from "./harness";
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
}

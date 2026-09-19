/**
 * `ai/opponent.ts`'s `chooseMove` on the rules engine (#162).
 *
 * `chooseMove`'s "cannot go wrong" shortcuts (one legal move, the coin flip,
 * mulligan, charge) now read the board through the `zoneOf`/`catalogDefOf`/
 * `leaderOf` seam (`engine-state.ts`) instead of `GameState`'s own shape, so
 * they run on a rules-engine game exactly as they do on a legacy one — this
 * proves it against a real `VmState`, without an API key (`hasAnthropic()`
 * is false in this sandbox, the same as CI, so nothing here makes a network
 * call). A real Main Phase decision is not ported (`stateText` is not), and
 * `chooseMove` refuses it by name rather than reading `undefined` off
 * `.players` — proven with a fake `ANTHROPIC_API_KEY` (never used: the throw
 * happens before anything would reach the network) and a minimal object
 * `isVmState` reads as a rules-engine state.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { defsFrom, seedFrom, type CardDef, type EngineContext } from "../../src/lib/arena/engine";
import { engineFor } from "../../src/lib/arena/engines";
import type { VmState } from "../../src/lib/arena/vm/state";
import { chooseMove } from "../../src/lib/arena/ai/opponent";

const card = (id: string, o: Partial<CardDef> = {}): CardDef => ({
  id,
  name: id,
  type: "BATTLE",
  colors: ["Red"],
  energyCost: 1,
  zEnergyCost: null,
  power: 10000,
  comboCost: 1,
  comboPower: 5000,
  skill: null,
  characters: [],
  traits: [],
  ...o,
});

const DEFS = defsFrom([
  card("L-RED", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("V1", {}),
  card("V-BLUE", { colors: ["Blue"] }),
]);
const CTX: EngineContext = { defs: DEFS, scripts: {} };
const fifty = (id: string) => Array.from({ length: 50 }, () => id);
const rules = engineFor("rules");
const fakeDb = {} as Parameters<typeof chooseMove>[0];

function newGame(): VmState {
  return rules.createGame(CTX, { seed: seedFrom("ai-vm"), p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
}

/**
 * `chooseMove` is async, and a plain `.ts` suite runs as CJS under `tsx`
 * (`verify-arena.ts`'s own header comment), which does not allow top-level
 * `await` — so the checks run inside this function, and the default export
 * is the promise `verify-arena.ts` awaits before reporting the suite's
 * outcome, the same way it already waits for the process to exit rather
 * than a literal top-level `await import(...)`.
 */
async function main(): Promise<void> {
// The coin flip and the mulligan: free, no API key needed, and the same
// shape as the legacy engine's own `chooseFirst`/`mulligan` prompts.
{
  const s = newGame();
  assert.equal(s.prompt.kind, "chooseFirst");
  const legal = rules.legalActions(CTX, s);
  const choice = await chooseMove(fakeDb, CTX, s, legal, (s.prompt as { player: "p1" | "p2" }).player, "sparring");
  assert.equal(choice.spend, null, "the coin flip should cost nothing");
  assert.ok(choice.how.includes("first turn"), `expected the coin-flip reason, got: ${choice.how}`);
}

{
  let s = newGame();
  const first = (s.prompt as { player: "p1" | "p2" }).player;
  s = rules.apply(CTX, s, { type: "chooseFirst", player: first, first: "p1" }).state as VmState;
  assert.equal(s.prompt.kind, "mulligan");
  const legal = rules.legalActions(CTX, s);
  const choice = await chooseMove(fakeDb, CTX, s, legal, (s.prompt as { player: "p1" | "p2" }).player, "sparring");
  assert.equal(choice.spend, null, "a mulligan decision should cost nothing");
  assert.ok(choice.how.includes("opening hand"), `expected the mulligan rule's reason, got: ${choice.how}`);
}

// The charge: also free, and reads a card's printed colours/cost through
// `catalogDefOf`/`leaderOf` rather than the legacy `def()`.
{
  let s = newGame();
  const first = (s.prompt as { player: "p1" | "p2" }).player;
  s = rules.apply(CTX, s, { type: "chooseFirst", player: first, first: "p1" }).state as VmState;
  s = rules.apply(CTX, s, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  s = rules.apply(CTX, s, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  assert.equal(s.prompt.kind, "charge");
  const legal = rules.legalActions(CTX, s);
  const choice = await chooseMove(fakeDb, CTX, s, legal, (s.prompt as { player: "p1" | "p2" }).player, "sparring");
  assert.equal(choice.spend, null, "a charge decision should cost nothing");
  assert.ok(choice.how.includes("charge rule") || choice.how.includes("only one legal move"), `expected the charge rule's reason, got: ${choice.how}`);
}

// A real Main Phase decision — past every shortcut — is refused by name
// rather than attempted, once there is a key to try one with. `isVmState`
// reads a plain object with `engine: "rules"`, so this needs no real game.
{
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
  try {
    const fakeState = { engine: "rules", prompt: { kind: "main", player: "p1" } } as unknown as VmState;
    const legal = [
      { label: "a", action: { type: "endMain", player: "p1" } },
      { label: "b", action: { type: "charge", player: "p1", card: null } },
    ] as Parameters<typeof chooseMove>[3];
    await assert.rejects(() => chooseMove(fakeDb, CTX, fakeState, legal, "p1", "sparring"), /not built on the rules engine yet \(#162\)/, "chooseMove should refuse a real decision on the rules engine by name, not crash reading .players");
  } finally {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
  }
}

console.log("  ai-vm: chooseMove's free-choice shortcuts run on the rules engine; a real decision there is refused by name");
}

export default main();

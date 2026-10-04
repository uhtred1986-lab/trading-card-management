/**
 * `ai/opponent.ts`'s `chooseMove` and `ai/view.ts`'s text on the rules engine
 * (#162, #457).
 *
 * `chooseMove`'s "cannot go wrong" shortcuts (one legal move, the coin flip,
 * mulligan, charge) read the board through the `zoneOf`/`catalogDefOf`/
 * `leaderOf` seam (`engine-state.ts`), and everything Claude is sent reads it
 * through `tableOf` (`ai/table.ts`). The checks below prove both against a
 * real `VmState`:
 *
 *  - the shortcuts run without an API key;
 *  - the same staged position renders the same `stateText` and
 *    `decklistText` on both engines, at the Main Phase and mid-battle;
 *  - a real decision is put to Claude on the rules engine — no refusal — and
 *    the request carries the same words as the legacy engine's for the same
 *    position. The model is a stub: a fake key, a base URL nothing listens on,
 *    and `messages.parse` replaced before the first call, so no request can
 *    leave the process.
 *
 * The one documented difference is the numbered menu itself (`movesText`):
 * it is each engine's own `legalActions`, in that engine's order and with that
 * engine's labels (the rules engine lists `End turn` first, and says `Combo V1`
 * where the legacy engine says `Combo V1 from hand (+5000, cost 1)`). So the
 * text before the menu is compared byte for byte and the menu by the moves it
 * offers.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { defsFrom } from "../../src/lib/arena/vm/common";
import { seedFrom } from "../../src/lib/arena/vm/rng";
import { type Action, type CardDef, type EngineContext, type PlayerId } from "../../src/lib/arena/types";
import { engineFor, type EngineId, type EngineState } from "../../src/lib/arena/engines";
import { zoneOf, type ZoneArea } from "../../src/lib/arena/engine-state";
import type { VmState } from "../../src/lib/arena/vm/state";
import { chooseMove } from "../../src/lib/arena/ai/opponent";
import { decklistText, stateText } from "../../src/lib/arena/ai/view";
import { createFakeProvider } from "../../src/lib/ai/providers/fake";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";

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
  card("BLOCKER", { colors: ["Blue"], energyCost: 2, skill: "[Blocker]", comboPower: 10000 }),
  card("CRIT", { energyCost: 3, power: 15000, skill: "[Critical]" }),
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

// ── #457: the same position, the same words, on both engines ───────────────

// p1's second Main Phase (turn 3), reached by the same actions on both
// engines, then the same cards staged into the same instance ids. Both
// engines create the cards in the same order and shuffle with the same RNG
// calls, so the decks match id for id — asserted rather than assumed.
const both = ["legacy", "rules"] as const satisfies readonly EngineId[];
type Staged = Record<EngineId, EngineState>;

function atMain(eid: EngineId): EngineState {
  const e = engineFor(eid);
  let s = e.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state;
  const ap = (a: Action) => (s = e.apply(CTX, s, a).state);
  ap({ type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" });
  ap({ type: "mulligan", player: "p1", redraw: false });
  ap({ type: "mulligan", player: "p2", redraw: false });
  ap({ type: "charge", player: "p1", card: null });
  ap({ type: "endMain", player: "p1" });
  ap({ type: "charge", player: "p2", card: null });
  ap({ type: "endMain", player: "p2" });
  ap({ type: "charge", player: "p1", card: null });
  assert.equal(s.prompt.kind, "main", `${eid}: the fixture did not reach p1's second Main Phase`);
  return s;
}

/** A raw fixture splice, the same on both shapes: the first filler card in the deck relabelled and moved, active outside the hand. */
function stage(s: EngineState, p: PlayerId, cardId: string, area: ZoneArea): string {
  const filler = p === "p1" ? "V1" : "V-BLUE";
  const deck = zoneOf(s, p, "deck");
  const i = deck.findIndex((id) => s.cards[id].cardId === filler);
  assert.ok(i >= 0, `${p}'s deck has no ${filler} left to stage`);
  const [id] = deck.splice(i, 1);
  s.cards[id].cardId = cardId;
  zoneOf(s, p, area).push(id);
  if (area === "battle" || area === "energy") (s.cards[id] as { mode: string }).mode = "active";
  return id;
}

function staged(): Staged {
  const out = {} as Staged;
  for (const eid of both) {
    const s = atMain(eid);
    stage(s, "p1", "CRIT", "battle");
    stage(s, "p1", "V1", "energy");
    stage(s, "p1", "V1", "energy");
    stage(s, "p2", "BLOCKER", "battle");
    stage(s, "p2", "BLOCKER", "hand");
    stage(s, "p2", "V-BLUE", "energy");
    stage(s, "p2", "V-BLUE", "drop");
    // 3-9-2-1: a life card turned face up is public, on both sides.
    s.cards[zoneOf(s, "p1", "life")[0]].faceUp = true;
    out[eid] = s;
  }
  for (const p of ["p1", "p2"] as const)
    for (const area of ["deck", "hand", "life", "battle", "energy", "drop"] as const)
      assert.deepEqual(zoneOf(out.rules, p, area), zoneOf(out.legacy, p, area), `${p}'s ${area} differs between the engines, so the parity below compares two positions`);
  return out;
}

const textOf = (s: Staged, viewer: PlayerId) => ({ legacy: stateText(CTX, s.legacy, viewer), rules: stateText(CTX, s.rules, viewer) });

{
  const s = staged();
  for (const viewer of ["p1", "p2"] as const) {
    const t = textOf(s, viewer);
    assert.equal(t.rules, t.legacy, `stateText for ${viewer} at the Main Phase differs between the engines`);
    assert.equal(decklistText(CTX, s.rules, viewer), decklistText(CTX, s.legacy, viewer), `decklistText for ${viewer} differs between the engines`);
  }
  // The checks above would pass on two empty strings: the text says what was staged.
  const t = textOf(s, "p2").rules;
  for (const line of ["phase main", "BLOCKER (BLOCKER), 10,000 power, active", "[Blocker]", "CRIT (CRIT), 15,000 power, active", "[Critical]", "1 energy marker(s)", "top of drop: V-BLUE", "face-up in life: V1"])
    assert.ok(t.includes(line), `the rules engine's stateText does not say "${line}":\n${t}`);
  assert.ok(!t.includes("undefined") && !t.includes("NaN"), `the rules engine's stateText reads a field it does not have:\n${t}`);
}

// Mid-battle: p1 attacks Claude's leader, Claude declines to block, and both
// engines stop at p1's Offense Step combo question. The text Claude would get
// has the battle line, the combo totals and the phase the battle is in.
function toCombo(s: EngineState, eid: EngineId): EngineState {
  const e = engineFor(eid);
  const attack = e.legalActions(CTX, s).find((l) => l.action.type === "attack" && l.label.startsWith("Attack L-BLUE with L-RED"));
  assert.ok(attack, `${eid}: no attack on Claude's leader on the menu`);
  s = e.apply(CTX, s, attack!.action).state;
  assert.equal(s.prompt.kind, "blocker", `${eid}: the attack should offer Claude its [Blocker]`);
  const decline = e.legalActions(CTX, s).find((l) => l.label === "Don't block");
  s = e.apply(CTX, s, decline!.action).state;
  assert.deepEqual(s.prompt, { kind: "combo", player: "p1", side: "offense" }, `${eid}: expected p1's offense combo question`);
  return s;
}

{
  const s0 = staged();
  const s: Staged = { legacy: toCombo(s0.legacy, "legacy"), rules: toCombo(s0.rules, "rules") };
  for (const viewer of ["p1", "p2"] as const) {
    const t = textOf(s, viewer);
    assert.equal(t.rules, t.legacy, `stateText for ${viewer} mid-battle differs between the engines`);
  }
  const t = textOf(s, "p1").rules;
  assert.ok(t.includes("phase main.") && t.includes("BATTLE (offense): L-RED [10,000] attacks L-BLUE [10,000]"), `the battle line is missing or wrong on the rules engine:\n${t}`);
}

// Acceptance and real decisions: capture env before tests, restore after
{
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
  const env = { key: process.env.ANTHROPIC_API_KEY, app: process.env.APP_ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

  try {
    // Acceptance: out-of-range and non-numeric answers are handled exactly as today.
    // Use a Main Phase position where multiple moves are legal.
    {
      const s0 = staged();
      const legal = rules.legalActions(CTX, s0.rules);
      assert.ok(legal.length > 1, "need multiple legal moves for bad answer tests");

      // Out-of-range answer: move = legal.length
      {
        const fakeProvider = createFakeProvider({
          id: "anthropic-api",
          script: () => ({
            json: { move: legal.length, say: "Out of range." },
            usage: { input: 100, output: 5, cacheRead: 0 },
          }),
        });
        registerProvider(fakeProvider);
        const runs: unknown[] = [];
        const db = { insert: () => ({ values: (v: unknown) => ({ returning: async () => (runs.push(v), [{ id: runs.length }]) }) }) } as unknown as Parameters<typeof chooseMove>[0];
        const choice = await chooseMove(db, CTX, s0.rules, legal, "p1", "sparring");
        assert.equal(choice.index, 0, "out-of-range answer should fallback to index 0");
        assert.equal(choice.how, "Claude answered " + legal.length + ", which is not on the list — took the first move", "out-of-range fallback message");
      }

      // Non-integer answer: validateSchema rejects, generateJson throws after retries
      {
        const fakeProvider = createFakeProvider({
          id: "anthropic-api",
          script: () => ({
            json: { move: 1.5, say: "Fractional." },
            usage: { input: 100, output: 5, cacheRead: 0 },
          }),
        });
        registerProvider(fakeProvider);
        const runs: unknown[] = [];
        const db = { insert: () => ({ values: (v: unknown) => ({ returning: async () => (runs.push(v), [{ id: runs.length }]) }) }) } as unknown as Parameters<typeof chooseMove>[0];
        try {
          await chooseMove(db, CTX, s0.rules, legal, "p1", "sparring");
          assert.fail("non-integer answer should throw AiError");
        } catch (err: unknown) {
          assert.ok(err instanceof Error && err.message.includes("did not match the expected format"), `expected format error, got: ${(err as Error).message}`);
        }
      }
    }

    // A real decision on the rules engine is put to Claude, not refused — and the
    // request carries the same words as the legacy engine's for the same position.
    // The model call is a stub; nothing here can reach the network.
    {
      const fakeProvider = createFakeProvider({
        id: "anthropic-api",
        script: () => ({
          json: { move: 1, say: "Your move." },
          usage: { input: 100, output: 5, cacheRead: 0 },
        }),
      });
      registerProvider(fakeProvider);

      const runs: unknown[] = [];
      const db = { insert: () => ({ values: (v: unknown) => ({ returning: async () => (runs.push(v), [{ id: runs.length }]) }) }) } as unknown as Parameters<typeof chooseMove>[0];
      const s0 = staged();
      const s: Staged = { legacy: toCombo(s0.legacy, "legacy"), rules: toCombo(s0.rules, "rules") };
      const asked: Record<EngineId, { question: string; system: string; moves: string[] }> = {} as never;
      for (const eid of both) {
        const legal = engineFor(eid).legalActions(CTX, s[eid]);
        assert.ok(legal.length > 1, `${eid}: the combo question has only one answer, so nothing would be asked`);
        const before = fakeProvider.requests.length;
        const choice = await chooseMove(db, CTX, s[eid], legal, "p1", "tournament");
        assert.equal(fakeProvider.requests.length, before + 1, `${eid}: chooseMove did not ask the (stubbed) model`);
        assert.equal(choice.how, "chosen by Claude", `${eid}: ${choice.how}`);
        assert.equal(choice.index, 1);
        assert.equal(choice.say, "Your move.");
        assert.ok(choice.spend && choice.spend.input === 100, `${eid}: the spend was not read off the answer`);
        const req = fakeProvider.requests[fakeProvider.requests.length - 1];
        const userMessage = req.messages[0];
        assert.ok(userMessage.role === "user", `${eid}: expected user message`);
        const textPart = userMessage.parts.find((p) => p.type === "text");
        assert.ok(textPart && textPart.type === "text", `${eid}: no text part in user message`);
        const [question, menu] = textPart.text.split("\n\nLEGAL MOVES:\n");
        assert.equal(menu.split("\n\n")[0].split("\n").length, legal.length, `${eid}: the menu sent is not the legal list`);
        const moves = legal.map((l) => (l.action.type === "combo" ? `combo ${l.action.card ? s[eid].cards[l.action.card].cardId : "pass"}` : l.action.type));
        const systemText = req.system.map((b) => b.text).join("\n");
        asked[eid] = { question, system: systemText, moves };
      }
      assert.equal(asked.rules.question, asked.legacy.question, "the question put to Claude differs between the engines");
      assert.equal(asked.rules.system, asked.legacy.system, "the system prompt (primer and decklist) differs between the engines");
      assert.deepEqual([...asked.rules.moves].sort(), [...asked.legacy.moves].sort(), "the menu offers different moves on the two engines");
      assert.ok(asked.rules.question.includes("whether to add combo power in the Offense Step") && asked.rules.question.includes("L-RED attacks L-BLUE: 10,000 against 10,000"), `the combo question was not worked out on the rules engine:\n${asked.rules.question}`);
      assert.ok(asked.rules.system.includes("YOUR DECK (You)"), "the decklist block does not name the seat");
    }
  } finally {
    resetProviders();
    // Restore env vars to their original state
    if (env.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = env.key;
    if (env.app === undefined) delete process.env.APP_ANTHROPIC_API_KEY;
    else process.env.APP_ANTHROPIC_API_KEY = env.app;
    if (env.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = env.base;
  }
}

console.log("  ai-vm: chooseMove's shortcuts run on the rules engine; stateText/decklistText match the legacy engine's for the same position; a real decision is put to (a stub of) Claude on both");
}

export default main();

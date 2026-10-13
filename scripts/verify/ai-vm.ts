/**
 * `ai/opponent.ts`'s `chooseMove` and `ai/view.ts`'s text on the rules engine
 * (#162, #457).
 *
 * `chooseMove`'s "cannot go wrong" shortcuts (one legal move, the coin flip,
 * mulligan, charge) read the board through the `zoneOf`/`catalogDefOf`/
 * `leaderOf` seam (`engine-state.ts`), and everything Claude is sent reads it
 * through `tableOf` (`ai/table.ts`). The checks below pin the rules engine
 * against reviewed facts and exact presentation fixtures for a real `VmState`:
 *
 *  - the shortcuts run without an API key;
 *  - the same staged position renders fixed `stateText` and `decklistText`
 *    fixtures at the Main Phase and mid-battle;
 *  - a real decision is put to Claude on the rules engine — no refusal — and
 *    the request carries the fixture-pinned question, system text and legal menu. The model is a stub: a fake key, a base URL nothing listens on,
 *    and `messages.parse` replaced before the first call, so no request can
 *    leave the process.
 *
 * The fixture records the rules engine's exact legal actions, including the
 * seven individually staged V1 plays and the Offense Step combo choices.
 * The expected card and zone facts are checked separately from presentation.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defsFrom } from "../../src/lib/arena/vm/common";
import { seedFrom } from "../../src/lib/arena/vm/rng";
import { type Action, type CardDef, type EngineContext, type PlayerId } from "../../src/lib/arena/types";
import { RULES } from "../../src/lib/arena/vm";
import { zoneOf, type ZoneArea } from "../../src/lib/arena/engine-state";
import type { VmState } from "../../src/lib/arena/vm/state";
import { chooseMove } from "../../src/lib/arena/ai/opponent";
import { decklistText, stateText } from "../../src/lib/arena/ai/view";
import { createFakeProvider } from "../../src/lib/ai/providers/fake";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { createAnthropicApiProvider } from "../../src/lib/ai/providers/anthropic-api";
import type { AiProvider, AiRequest } from "../../src/lib/ai/types";
import { NO_SETTINGS, setSettingsLoader } from "../../src/lib/ai/settings";
import { EFFECT_LANGUAGE, ruleOnCard } from "../../src/lib/arena/ai/opponent";
import { clarifyRule, type RuleToClarify } from "../../src/lib/arena/ai/clarify";
import { claudeTeacher } from "../../src/lib/arena/ai/teach";
import { InterruptedGameReviewError, reviewGame } from "../../src/lib/arena/ai/review";
import { interruptedOutcome } from "../../src/lib/arena/outcome";
import { cards as cardsTable } from "../../src/db/schema";

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
const rules = RULES;
const fakeDb = {} as Parameters<typeof chooseMove>[0];
const FIXTURE_DIR = path.join(__dirname, "fixtures", "ai-vm");
const readFixture = (name: string): string => readFileSync(path.join(FIXTURE_DIR, name), "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");

type ZoneFact = { id: string; card: string; mode: string | null; faceUp: boolean };
type PlayerZones = Record<"leader" | "deck" | "hand" | "life" | "battle" | "energy" | "drop", ZoneFact[]>;
type FixedFacts = {
  turn: number;
  prompt: unknown;
  zones: Record<PlayerId, PlayerZones>;
  mainLegalMoves: Array<{ action: Action; label: string }>;
  blockerPrompt: unknown;
  blockerLegalMoves: Array<{ action: Action; label: string }>;
  comboTurn: number;
  comboPrompt: unknown;
  comboLegalMoves: string[];
};
const FIXED = JSON.parse(readFixture("main-facts.json")) as FixedFacts;
const fixedText = {
  main: { p1: readFixture("main-p1.txt"), p2: readFixture("main-p2.txt") },
  decklist: { p1: readFixture("deck-p1.txt"), p2: readFixture("deck-p2.txt") },
  combo: { p1: readFixture("combo-p1.txt"), p2: readFixture("combo-p2.txt") },
  question: readFixture("combo-question.txt"),
  comboMenu: readFixture("combo-menu.txt"),
  systemPrimer: readFixture("system-primer.txt"),
};
function assertFixedText(actual: string, expected: string, label: string): void {
  assert.equal(actual, expected, label);
}

/** The request body as the checks read it: only the fields they pin. */
type Body = {
  model?: string;
  max_tokens?: number;
  thinking?: unknown;
  output_config: { effort?: string; format?: { type?: string } };
  system?: string | Array<{ type: string; text: string; cache_control?: unknown }>;
  messages: Array<{ role: string }>;
};
type Wire = { url: string; body: Body };

/**
 * The Anthropic adapter on a recorded transport (after `ai-contract.ts`'s
 * `anthropicHarness`): a `fetch` that answers in Anthropic's wire format and
 * writes down the body it was sent, so the checks can pin the request each
 * feature puts on the wire. Registered under the id the router picks.
 */
function wireProvider(answer: unknown): { provider: AiProvider; wire: Wire[] } {
  const wire: Wire[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    wire.push({ url: String(url), body: body as unknown as Body });
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: String(body.model),
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const provider = createAnthropicApiProvider({ fetch: fetchImpl });
  return { provider: { ...provider, id: "anthropic-api" }, wire };
}

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

// ── #601: fixed facts and presentation for the rules engine ────────────────

// p1's second Main Phase (turn 3), reached from seed 7. The checked-in
// fixture pins the card instance order, zone contents, prompt, exact legal
// actions, text and model request; it is reviewed against the synthetic
// 50-card decks and the steps below, not computed by a second engine.
function atMain(): VmState {
  let s = rules.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const ap = (a: Action) => (s = rules.apply(CTX, s, a).state as VmState);
  ap({ type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" });
  ap({ type: "mulligan", player: "p1", redraw: false });
  ap({ type: "mulligan", player: "p2", redraw: false });
  ap({ type: "charge", player: "p1", card: null });
  ap({ type: "endMain", player: "p1" });
  ap({ type: "charge", player: "p2", card: null });
  ap({ type: "endMain", player: "p2" });
  ap({ type: "charge", player: "p1", card: null });
  assert.equal(s.prompt.kind, "main", "the fixture did not reach p1's second Main Phase");
  return s;
}

/** A raw fixture splice: the first filler card in the deck is relabelled and moved, active outside the hand. */
function stage(s: VmState, p: PlayerId, cardId: string, area: ZoneArea): string {
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

function zoneFacts(s: VmState, p: PlayerId, area: keyof PlayerZones): ZoneFact[] {
  const ids = area === "leader" ? s.sides[p].zones.leader : zoneOf(s, p, area);
  return ids.map((id) => ({
    id,
    card: s.cards[id].cardId,
    mode: s.cards[id].mode ?? null,
    faceUp: s.cards[id].faceUp ?? false,
  }));
}

function assertStagedFacts(s: VmState, facts: FixedFacts): void {
  assert.equal(s.turn, facts.turn, "the staged position reached the wrong turn");
  assert.deepEqual(s.prompt, facts.prompt, "the staged position is not p1's Main Phase question");
  for (const p of ["p1", "p2"] as const)
    for (const area of ["leader", "deck", "hand", "life", "battle", "energy", "drop"] as const)
      assert.deepEqual(zoneFacts(s, p, area), facts.zones[p][area], `${p}'s ${area} does not match the reviewed seed-7 fixture`);
}

function staged(): VmState {
  const s = atMain();
  stage(s, "p1", "CRIT", "battle");
  stage(s, "p1", "V1", "energy");
  stage(s, "p1", "V1", "energy");
  stage(s, "p2", "BLOCKER", "battle");
  stage(s, "p2", "BLOCKER", "hand");
  stage(s, "p2", "V-BLUE", "energy");
  stage(s, "p2", "V-BLUE", "drop");
  // Rule 3-9-2-1: a face-up life card is public to either viewer.
  s.cards[zoneOf(s, "p1", "life")[0]].faceUp = true;
  assertStagedFacts(s, FIXED);
  return s;
}

{
  const s = staged();
  const legal = rules.legalActions(CTX, s).map((l) => ({ action: l.action, label: l.label }));
  assert.deepEqual(legal, FIXED.mainLegalMoves, "the Main Phase legal move set changed");
  const alteredFacts = structuredClone(FIXED);
  alteredFacts.zones.p1.battle[0].card = "V1";
  assert.throws(() => assertStagedFacts(s, alteredFacts), assert.AssertionError, "changing a pinned card expectation must fail the fixture check");
  for (const viewer of ["p1", "p2"] as const) {
    const t = stateText(CTX, s, viewer);
    assertFixedText(t, fixedText.main[viewer], `stateText for ${viewer} at the Main Phase differs from its fixed fixture`);
    assertFixedText(decklistText(CTX, s, viewer), fixedText.decklist[viewer], `decklistText for ${viewer} differs from its fixed fixture`);
  }
  const alteredText = fixedText.main.p1.replace("Turn 3", "Turn 4");
  assert.notEqual(alteredText, fixedText.main.p1, "the negative control must change the expected turn text");
  assert.throws(() => assertFixedText(stateText(CTX, s, "p1"), alteredText, "altered Main Phase fixture"), assert.AssertionError, "an altered expected text fixture must fail the same comparison");
  // The fixed strings are also checked against the fixture's card and zone facts.
  const t = stateText(CTX, s, "p2");
  for (const line of ["phase main", "BLOCKER (BLOCKER), 10,000 power, active", "[Blocker]", "CRIT (CRIT), 15,000 power, active", "[Critical]", "1 energy marker(s)", "top of drop: V-BLUE", "face-up in life: V1"])
    assert.ok(t.includes(line), `the rules engine's stateText does not say "${line}":\n${t}`);
  assert.ok(!t.includes("undefined") && !t.includes("NaN"), `the rules engine's stateText reads a field it does not have:\n${t}`);
}

// Mid-battle: p1 attacks Claude's Leader, Claude declines to block, and the
// rules engine reaches p1's Offense Step combo question. The fixed text pins
// the battle line, combo totals and phase shown to either viewer.
function toCombo(s: VmState): VmState {
  const leader = s.sides.p1.zones.leader[0];
  const target = s.sides.p2.zones.leader[0];
  const attack = rules.legalActions(CTX, s).find((l) => l.action.type === "attack" && l.action.attacker === leader && l.action.target === target);
  assert.ok(attack, "the reviewed Main Phase menu did not offer the Leader attack");
  s = rules.apply(CTX, s, attack!.action).state as VmState;
  assert.deepEqual(s.prompt, FIXED.blockerPrompt, "the Leader attack should open p2's Blocker question");
  assert.deepEqual(rules.legalActions(CTX, s).map((l) => ({ action: l.action, label: l.label })), FIXED.blockerLegalMoves, "the Blocker question's exact legal move set changed");
  const decline = rules.legalActions(CTX, s).find((l) => l.label === "Don't block");
  assert.ok(decline, "the Blocker question did not offer its optional decline");
  s = rules.apply(CTX, s, decline!.action).state as VmState;
  assert.deepEqual(s.prompt, FIXED.comboPrompt, "the Leader attack should reach p1's Offense Step combo question");
  return s;
}

{
  const s = toCombo(staged());
  assert.equal(s.turn, FIXED.comboTurn, "the Offense Step is not on the expected turn");
  for (const viewer of ["p1", "p2"] as const) {
    const t = stateText(CTX, s, viewer);
    assertFixedText(t, fixedText.combo[viewer], `stateText for ${viewer} mid-battle differs from its fixed fixture`);
  }
  const t = stateText(CTX, s, "p1");
  assert.ok(t.includes("phase main.") && t.includes("BATTLE (offense): L-RED [10,000] attacks L-BLUE [10,000]"), `the battle line is missing or wrong on the rules engine:\n${t}`);
}

// Acceptance and real decisions: capture env before tests, restore after
{
  // Capture the caller's values BEFORE overwriting them, so the `finally` restores the originals.
  const env = { key: process.env.ANTHROPIC_API_KEY, app: process.env.APP_ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";

  try {
    // Acceptance: out-of-range and non-numeric answers are handled exactly as today.
    // Use a Main Phase position where multiple moves are legal.
    {
      const s0 = staged();
      const legal = rules.legalActions(CTX, s0);
      assert.ok(legal.length > 1, "need multiple legal moves for bad answer tests");

      const stubDb = () => ({ insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }) }) as unknown as Parameters<typeof chooseMove>[0];
      const FORMAT_ERROR = "The model's answer did not match the expected format — try again.";

      // Out of range (either end of the list): not an error — the first move is taken, with the same words as before.
      for (const bad of [legal.length, -1]) {
        const fake = createFakeProvider({ id: "anthropic-api", script: () => ({ json: { move: bad, say: "Out of range." }, usage: { input: 100, output: 5, cacheRead: 0 } }) });
        registerProvider(fake);
        const choice = await chooseMove(stubDb(), CTX, s0, legal, "p1", "sparring");
        assert.equal(choice.index, 0, `move ${bad} should fall back to index 0`);
        assert.equal(choice.how, `Claude answered ${bad}, which is not on the list — took the first move`, `move ${bad} fallback message`);
        assert.equal(fake.requests.length, 1, `move ${bad} is a valid answer to the schema: one request, no retry`);
      }

      // Not an integer, not a number, not JSON: the one retry the core makes, then the message today's code throws.
      for (const [name, answer] of [
        ["1.5", { json: { move: 1.5, say: "Fractional." } }],
        ['"two"', { json: { move: "two", say: "x" } }],
        ["plain text", { text: "two" }],
      ] as const) {
        const fake = createFakeProvider({ id: "anthropic-api", script: () => ({ ...answer, usage: { input: 100, output: 5, cacheRead: 0 } }) });
        registerProvider(fake);
        await assert.rejects(
          chooseMove(stubDb(), CTX, s0, legal, "p1", "sparring"),
          (err: unknown) => err instanceof Error && err.message === FORMAT_ERROR,
          `${name}: expected exactly "${FORMAT_ERROR}"`,
        );
        assert.equal(fake.requests.length, 2, `${name}: the core retries once, no more (got ${fake.requests.length} requests)`);
      }

      // One legal move: decided without a model request.
      {
        const fake = createFakeProvider({ id: "anthropic-api", script: () => ({ json: { move: 0, say: "no" }, usage: { input: 1, output: 1, cacheRead: 0 } }) });
        registerProvider(fake);
        const choice = await chooseMove(stubDb(), CTX, s0, [legal[0]], "p1", "tournament");
        assert.equal(choice.how, "only one legal move");
        assert.equal(choice.spend, null);
        assert.equal(fake.requests.length, 0, "a single legal move must not reach the model");
      }
    }

    // A real decision on the rules engine is put to Claude, not refused. The
    // fixed fixture pins the question, system text and exact legal menu; the
    // model call is a stub, so nothing here can reach the network.
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
      const s = toCombo(staged());
      const legal = rules.legalActions(CTX, s);
      assert.ok(legal.length > 1, "the combo question has only one answer, so nothing would be asked");
      const choice = await chooseMove(db, CTX, s, legal, "p1", "tournament");
      assert.equal(fakeProvider.requests.length, 1, "chooseMove did not ask the (stubbed) model exactly once");
      assert.equal(choice.how, "chosen by Claude");
      assert.equal(choice.index, 1);
      assert.equal(choice.say, "Your move.");
      assert.ok(choice.spend && choice.spend.input === 100, "the spend was not read off the answer");
      const req = fakeProvider.requests[0];
      const userMessage = req.messages[0];
      assert.ok(userMessage.role === "user", "expected user message");
      const textPart = userMessage.parts.find((p) => p.type === "text");
      assert.ok(textPart && textPart.type === "text", "no text part in user message");
      const [question, menu] = textPart.text.split("\n\nLEGAL MOVES:\n");
      assert.ok(menu, "the request has no legal-move menu");
      const menuText = menu.split("\n\n")[0];
      const menuLines = menuText.split("\n");
      assert.equal(menuLines.length, legal.length, "the menu sent is not the legal list");
      assertFixedText(question, fixedText.question, "the question sent to Claude differs from its fixed fixture");
      assertFixedText(menuText, fixedText.comboMenu, "the numbered menu sent to Claude differs from its fixed fixture");
      assert.throws(
        () => assertFixedText(menuText, fixedText.comboMenu.replace("7. Combo CRIT", "7. Combo OTHER"), "altered combo-menu fixture"),
        assert.AssertionError,
        "an altered expected combo-menu line must fail the same comparison used for the checked-in fixture",
      );
      assert.deepEqual(req.system.map((b) => b.text), [fixedText.systemPrimer, `YOUR DECK (You):\n${fixedText.decklist.p1}`], "the exact system prompt and decklist differ from their fixed fixtures");
      const moves = legal.map((l) => (l.action.type === "combo" ? `combo ${l.action.card ? s.cards[l.action.card].cardId : "pass"}` : l.action.type));
      assert.deepEqual([...moves].sort(), [...FIXED.comboLegalMoves].sort(), "the exact moves offered to the model differ from the fixed legal set");
      assert.ok(question.includes("whether to add combo power in the Offense Step") && question.includes("L-RED attacks L-BLUE: 10,000 against 10,000"), `the combo question was not worked out on the rules engine:\n${question}`);
      assert.ok(req.system.map((b) => b.text).join("\n").includes("YOUR DECK (You)"), "the decklist block does not name the seat");
    }
    // ── Request shapes unchanged: the wire body each feature sends, on a recorded transport ──
    // Expected values are written out from `git show origin/main:src/lib/arena/ai/<file>.ts`
    // (the pre-contract `messages.parse` calls), not derived from the code under test.
    {
      const LONG = { type: "ephemeral", ttl: "1h" };
      const wired = (answer: unknown) => {
        const w = wireProvider(answer);
        registerProvider(w.provider);
        return w.wire;
      };
      const stubDb = () => ({ insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }) }) as unknown as Parameters<typeof chooseMove>[0];
      const sysBlocks = (b: Body) => b.system as Array<{ type: string; text: string; cache_control?: unknown }>;
      const s0 = staged();
      const mainLegal = rules.legalActions(CTX, s0);
      const ANSWER = { move: 1, say: "ok" };

      // chooseMove, Sparring: Haiku, 1500 tokens, no thinking, no effort, the schema as the output format.
      {
        const wire = wired(ANSWER);
        await chooseMove(stubDb(), CTX, s0, mainLegal, "p1", "sparring");
        assert.equal(wire.length, 1);
        const b = wire[0].body;
        assert.equal(b.model, "claude-haiku-4-5");
        assert.equal(b.max_tokens, 1500);
        assert.equal(b.thinking, undefined, "Sparring sends no thinking");
        assert.equal(b.output_config?.effort, undefined, "Sparring sends no effort");
        assert.ok(b.output_config?.format, "the answer schema goes out as output_config.format");
        assert.equal(b.output_config.format.type, "json_schema");
        // System: the rules primer with no cache hint, then the decklist cached for an hour.
        const sys = sysBlocks(b);
        assert.equal(sys.length, 2);
        assert.equal(sys[0].type, "text");
        assert.ok(sys[0].text.includes("The engine enforces every rule. You will be given a numbered list"), "block 0 is the rules primer (ends in the doctrine)");
        assert.equal(sys[0].cache_control, undefined, "the primer carries no cache_control");
        assert.ok(sys[1].text.startsWith("YOUR DECK ("), "block 1 is the decklist");
        assert.deepEqual(sys[1].cache_control, LONG, "the decklist is cached for an hour");
        // And the user message is the question as one text block.
        assert.equal(b.messages.length, 1);
        assert.equal(b.messages[0].role, "user");
      }

      // chooseMove, Tournament: the four key prompts go to Opus with adaptive thinking and medium effort.
      {
        const combo = toCombo(s0);
        assert.equal(combo.prompt.kind, "combo");
        const wire = wired(ANSWER);
        await chooseMove(stubDb(), CTX, combo, rules.legalActions(CTX, combo), "p1", "tournament");
        const b = wire[0].body;
        assert.equal(b.model, "claude-opus-5");
        assert.equal(b.max_tokens, 1500);
        assert.deepEqual(b.thinking, { type: "adaptive" });
        assert.equal(b.output_config.effort, "medium");
        assert.ok(b.output_config.format);
        assert.equal(sysBlocks(b)[0].cache_control, undefined);
        assert.deepEqual(sysBlocks(b)[1].cache_control, LONG);

        // The main prompt too (the position `staged()` stops at).
        assert.equal(s0.prompt.kind, "main");
        const wire2 = wired(ANSWER);
        await chooseMove(stubDb(), CTX, s0, mainLegal, "p1", "tournament");
        assert.equal(wire2[0].body.model, "claude-opus-5");
        assert.equal(wire2[0].body.output_config.effort, "medium");
      }

      // chooseMove, Tournament, any other prompt kind: Haiku, no thinking, no effort. The prompt is swapped on a copy of the
      // Main Phase position (the menu is left alone, so no free shortcut applies and the model is asked).
      {
        const other = { ...s0, prompt: { kind: "offering", player: "p1" } } as unknown as VmState;
        const wire = wired(ANSWER);
        await chooseMove(stubDb(), CTX, other, mainLegal, "p1", "tournament");
        assert.equal(wire.length, 1, "the offering prompt reaches the model");
        const b = wire[0].body;
        assert.equal(b.model, "claude-haiku-4-5");
        assert.equal(b.thinking, undefined);
        assert.equal(b.output_config.effort, undefined);
      }

      // #516: the arena model slots, through chooseMove, on fake providers — every prompt kind, with nothing configured and with slots set.
      {
        const ids = ["main", "counter", "blocker", "combo", "attack", "offering", "chooseTarget", "payCost", "anythingElse"];
        const heavy = new Set(["main", "counter", "blocker", "combo"]);
        const asKind = (kind: string) => ({ ...s0, prompt: { kind, player: "p1" } }) as unknown as VmState;
        // Whichever provider answers writes the request it got here.
        const seen: AiRequest[] = [];
        const answer = (req: AiRequest) => (seen.push(req), { json: ANSWER, usage: { input: 1, output: 1, cacheRead: 0 } });
        const run = async (tier: "sparring" | "tournament", kind: string) => {
          seen.length = 0;
          registerProvider(createFakeProvider({ id: "anthropic-api", script: answer }));
          const choice = await chooseMove(stubDb(), CTX, asKind(kind), mainLegal, "p1", tier);
          assert.equal(seen.length, 1, `${tier} ${kind}: the model is asked once`);
          return { req: seen[0], choice };
        };

        // Nothing configured: today's split on every kind.
        setSettingsLoader(null);
        for (const kind of ids) {
          const sp = await run("sparring", kind);
          assert.deepEqual([sp.req.provider, sp.req.model, sp.req.thinking, sp.req.effort], ["anthropic-api", "claude-haiku-4-5", undefined, undefined], `sparring ${kind} runs on Haiku`);
          const t = await run("tournament", kind);
          assert.equal(t.req.provider, "anthropic-api");
          assert.equal(t.req.model, heavy.has(kind) ? "claude-opus-5" : "claude-haiku-4-5", `tournament ${kind}`);
          assert.equal(t.req.thinking, heavy.has(kind) ? "adaptive" : undefined, `tournament ${kind} thinking`);
          assert.equal(t.req.effort, heavy.has(kind) ? "medium" : undefined, `tournament ${kind} effort`);
          assert.equal(t.choice.spend?.provider, "anthropic-api");
        }

        // Slots set: Sparring and Tournament's key prompts go to another provider's models; the unset slot keeps its default.
        setSettingsLoader(async () => ({
          ...NO_SETTINGS,
          arena: { sparring: { provider: "alt", model: "alt/spar" }, "tournament.key": { provider: "alt", model: "alt/key" } },
        }));
        const alt = createFakeProvider({ id: "alt", script: answer });
        registerProvider(alt);
        for (const kind of ["main", "offering"]) {
          const sp = await run("sparring", kind);
          assert.equal(sp.req.provider, "alt", `sparring ${kind} follows the slot`);
          assert.equal(sp.req.model, "alt/spar");
          assert.equal(sp.req.thinking, undefined);
          assert.equal(sp.choice.spend?.provider, "alt", "the provider is reported with the spend");
        }
        const key = await run("tournament", "combo");
        assert.deepEqual([key.req.provider, key.req.model, key.req.thinking, key.req.effort], ["alt", "alt/key", "adaptive", "medium"]);
        const other = await run("tournament", "offering");
        assert.deepEqual([other.req.provider, other.req.model], ["anthropic-api", "claude-haiku-4-5"], "an unset slot keeps its default");
        assert.equal(alt.requests.length, 3, "the slot's provider answered exactly the three slotted decisions");
        setSettingsLoader(null);
      }

      // ruleOnCard (the referee).
      {
        const wire = wired({ program: "[]", why: "nothing happens" });
        const r = await ruleOnCard(stubDb(), { cardId: "V1", cardName: "V1", text: "[Auto] x", unsupported: ["x"] }, "situation");
        assert.equal(r.valid, true);
        const b = wire[0].body;
        assert.equal(b.model, "claude-opus-5");
        assert.equal(b.max_tokens, 4000);
        assert.deepEqual(b.thinking, { type: "adaptive" });
        assert.equal(b.output_config.effort, "medium");
        assert.ok(b.output_config.format);
        assert.deepEqual(b.system, [{ type: "text", text: EFFECT_LANGUAGE, cache_control: LONG }]);
      }

      // clarifyRule: the stub db answers the card read; the `[]` program saves no rule, so only the brief update runs.
      {
        const wire = wired({ meaning: "m", program: "[]", confident: true, question: "", brief: "# b" });
        const cardRow = { id: "V1", name: "V1", cardType: "BATTLE", colors: ["Red"], energyCost: "1", power: 10000, skill: "[Auto] Draw 1 card.", backSkill: null };
        const db = {
          query: { cards: { findFirst: async () => cardRow } },
          select: () => ({ from: () => ({ where: async () => [] }) }),
          insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
          update: () => ({ set: () => ({ where: async () => undefined }) }),
        } as unknown as Parameters<typeof clarifyRule>[0];
        const rule: RuleToClarify = { id: 1, cardId: "V1", side: "front", skillIndex: 0, printed: "[Auto] Draw 1 card.", unread: ["Draw 1 card."], pattern: null, kind: "auto" };
        const out = await clarifyRule(db, rule, null);
        assert.equal(out.saved, false);
        const b = wire[0].body;
        assert.equal(b.model, "claude-opus-5");
        assert.equal(b.max_tokens, 8000);
        assert.deepEqual(b.thinking, { type: "adaptive" });
        assert.equal(b.output_config.effort, "high");
        assert.ok(b.output_config.format);
        const sys = sysBlocks(b);
        assert.equal(sys.length, 2);
        assert.deepEqual(sys[0], { type: "text", text: EFFECT_LANGUAGE, cache_control: LONG });
        assert.equal(sys[1].type, "text");
        assert.ok(sys[1].text.startsWith("The brief is a work item handed to Claude Code"), "block 1 is BRIEF_SPEC");
        assert.equal(sys[1].cache_control, undefined, "BRIEF_SPEC carries no cache_control");
      }

      // claudeTeacher.
      {
        const wire = wired({ reply: "question", rule: "", meaning: "", question: "q?", options: ["a", "b"] });
        const ask = claudeTeacher(stubDb(), { ruleId: 1, cardId: "V1", clause: "c" });
        // A well-formed reply, so the call completes; only the request is under test.
        await ask({ system: "SYSTEM TEXT", user: "USER TEXT" });
        assert.ok(wire.length >= 1, "claudeTeacher sent a request");
        const b = wire[0].body;
        assert.equal(b.model, "claude-opus-5");
        assert.equal(b.max_tokens, 8000);
        assert.deepEqual(b.thinking, { type: "adaptive" });
        assert.equal(b.output_config.effort, "medium");
        assert.ok(b.output_config.format);
        assert.deepEqual(b.system, [{ type: "text", text: "SYSTEM TEXT", cache_control: LONG }]);
      }

      // reviewGame, on a finished rules-engine game read through a stub db (card rows built from DEFS, no rules rows).
      {
        const wire = wired({ verdict: "v", turningPoint: "t", wellPlayed: [], toWorkOn: [], deckAdvice: [] });
        const done = { ...s0, winner: "p1", overReason: "test" } as unknown as VmState;
        const cardRows = Object.values(DEFS).map((d) => ({
          id: d.id, name: d.name, cardType: d.type, colors: d.colors, energyCost: d.energyCost == null ? null : String(d.energyCost), zEnergyCost: null,
          power: d.power, comboCost: d.comboCost, comboPower: d.comboPower, skill: d.skill, characters: d.characters, traits: d.traits,
          backName: null, backPower: null, backSkill: null, specifiedCost: null, imageUrl: null, backImageUrl: null,
        }));
        const arenaRow = {
          id: 1, mode: "sparring", engine: "rules", game: "dbs", status: "over", p1Name: "You", p2Name: "Claude", p1User: null, p2User: null,
          p1DeckId: null, p2DeckId: null, version: 1, state: done, actions: [], log: ["turn 1"], spotlight: null, beats: null, snapshot: null,
          aiCalls: 0, aiInputTokens: 0, aiOutputTokens: 0, aiCachedTokens: 0, aiCostMicros: 0, review: null, debug: null,
        };
        const db = {
          query: { arenaGames: { findFirst: async () => arenaRow } },
          select: () => ({ from: (table: unknown) => ({ where: async () => (table === cardsTable ? cardRows : []) }) }),
          insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
          update: () => ({ set: () => ({ where: async () => undefined }) }),
        } as unknown as Parameters<typeof reviewGame>[0];
        const review = await reviewGame(db, 1);
        assert.ok(review, "the finished game was reviewed");
        const b = wire[0].body;
        assert.equal(b.model, "claude-sonnet-5-5");
        assert.equal(b.max_tokens, 6000);
        assert.deepEqual(b.thinking, { type: "adaptive" });
        assert.equal(b.output_config.effort, "medium");
        assert.ok(b.output_config.format);
        assert.equal(typeof b.system, "string", "a single uncached system prompt goes out as a plain string");
        assert.ok((b.system as string).startsWith("You are coaching a Dragon Ball Super Card Game player"));

        // An interrupted row must be rejected before the provider is called,
        // even when review generation is configured and a fake provider is
        // ready to answer. The private diagnostic remains in saved state only.
        arenaRow.state = {
          ...done,
          winner: null,
          overReason: interruptedOutcome().reason,
          outcome: interruptedOutcome({ sourceCard: "SECRET-HIDDEN#17", detail: "unrevealed card text" }),
        };
        wire.length = 0;
        await assert.rejects(reviewGame(db, 1), InterruptedGameReviewError);
        assert.equal(wire.length, 0, "interrupted-game coaching never reaches the paid provider");
      }
    }
  } finally {
    resetProviders();
    setSettingsLoader(null);
    // Restore env vars to their original state
    if (env.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = env.key;
    if (env.app === undefined) delete process.env.APP_ANTHROPIC_API_KEY;
    else process.env.APP_ANTHROPIC_API_KEY = env.app;
    if (env.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = env.base;
  }
}

console.log("  ai-vm: shortcuts run on the rules engine; fixed zone/text/decklist/question/system/menu fixtures pass; fake-provider request shapes remain pinned");
}

export default main();

/**
 * Stage 8's primer/prompts/view issue (#160): the mechanical half of
 * `RULES_PRIMER` is generated from the definition, and the prompt bar's
 * fixed questions are one table both engines read (`prompt-words.ts`),
 * closing the "…" gap `vm/view.ts`'s `promptView` used to show for a combo,
 * a blocker or a counter on a rules-engine game.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { DBS_FILES, loadDbs, loadRuleset } from "../../src/lib/arena/rulesets";
import { areasLine, generatedPrimer, turnStructure, winCondition, zoneNames } from "../../src/lib/arena/ai/primer";
import { FIXED_PROMPT_KINDS, fixedPrompt, promptHint } from "../../src/lib/arena/prompt-words";
import { questionFor } from "../../src/lib/arena/view";
import { promptView } from "../../src/lib/arena/vm/view";
import type { GameState } from "../../src/lib/arena/engine";
import type { VmState } from "../../src/lib/arena/vm/state";

const dbs = loadDbs();
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
if (!dbs.ok) throw new Error("unreachable");
const def = dbs.definition;

// Build item 1: the primer is generated, not hand-copied — this is the
// reviewed fixture (see the module doc comment); a future change to
// game.rules/zones.rules that moves it is exactly what this test is for.
assert.equal(
  generatedPrimer(def),
  `You are playing Dragon Ball Super Card Game against a human, through a rules engine.

How a turn goes: Charge Phase (the rules processing at the start of a turn, with a checkpoint after each step) → Main Phase (the phase the turn player takes their moves in, returning to a checkpoint after each one) → End Phase (the end of the turn: what answers to it is made pending, what lasted for the turn ends, and the other player becomes the turn player).

The areas of the game: deck, hand, drop, leader, battle, combo, energy, life, warp, unison, zDeck, zEnergy, removed.

Winning: you lose when there are no cards in your Life Area, or when there are no cards in your Deck Area. The same is true for your opponent.`,
  "generatedPrimer(dbs) moved — review the new text, then update this fixture",
);

// The acceptance bullet itself: every zone the definition declares is named.
for (const zone of Object.keys(def.zones)) {
  if (def.zones[zone].place === false) continue; // `under`/`play` are words for other zones, not places of their own (#139)
  assert.ok(zoneNames(def).includes(zone), `generatedPrimer's areas line does not name zone "${zone}"`);
  assert.ok(areasLine(def).includes(zone), `areasLine() does not mention "${zone}"`);
}

// turnStructure/winCondition read live off the declarations rather than being copied once — a
// phase or a WIN removed from game.rules disappears from the primer in the same breath.
assert.ok(turnStructure(def).startsWith("How a turn goes: "));
assert.ok(winCondition(def).startsWith("Winning: "));

// Build item 2: `questionFor` (legacy) and `promptView` (rules) answer a
// fixed-question prompt kind with the same words, and those words are the
// definition's (`prompts.rules`). The literals below are the hand-written
// table `prompt-words.ts` used to hold, kept as the byte-for-byte fixture: a
// change to a question now has to be made here on purpose.
const FIXTURE: Record<string, [string, string | null]> = {
  chooseFirst: ["You won the flip. Who goes first?", "The second player starts with one energy marker."],
  mulligan: ["Keep this hand?", "You may redraw six cards once (6-2-1-9)."],
  charge: ["Charge one card as energy?", "Tap a card in hand, or skip."],
  main: ["Your Main Phase.", "Play cards, attack, or end the turn."],
  combo: ["Combo? Tap a glowing card.", "Each adds its combo power and costs its combo cost."],
  blocker: ["Block with one of these?", "[Blocker] rests the card and makes it the guard instead."],
  counter: ["Play a counter?", "Counter cards are activated from hand and go to the Drop."],
  zEnergyFromCombo: ["Send one combo card to Z-Energy?", "At the end of a battle, one card may go there instead of the Drop."],
  offering: ["[Offering]: drop one life, or let them draw two?", null],
  orderPending: ["Which skill resolves first?", "Several of your skills triggered at once."],
  gameOver: ["The game is over.", null],
};
assert.deepEqual([...FIXED_PROMPT_KINDS].sort(), Object.keys(FIXTURE).sort());
const fakeCtx = {} as Parameters<typeof questionFor>[0];
for (const kind of FIXED_PROMPT_KINDS) {
  const [question, hint] = FIXTURE[kind];
  const words = fixedPrompt(kind);
  assert.deepEqual(words, { question, hint }, `prompts.rules' "${kind}" moved`);

  const legacyState = { prompt: { kind, player: "p1" }, flow: [] } as unknown as GameState;
  const legacy = questionFor(fakeCtx, legacyState);
  assert.equal(legacy.question, question, `view.ts's questionFor("${kind}") question`);
  assert.equal(legacy.hint, hint, `view.ts's questionFor("${kind}") hint`);

  const rulesState = { prompt: { kind, player: "p1" } } as unknown as VmState;
  const rules = promptView(rulesState);
  assert.equal(rules.question, question, `vm/view.ts's promptView("${kind}") question`);
  assert.equal(rules.hint, hint, `vm/view.ts's promptView("${kind}") hint`);
}

// The fixed hints of the kinds whose question is built at the table, byte for byte as they were hard-coded.
assert.equal(promptHint("chooseMode"), "The card offers these; exactly one happens (20-2).");
assert.equal(promptHint("replaceMove"), "Choose one replacement, or let the original move happen.");
assert.equal(promptHint("empowerCarry"), "You may carry fewer than the maximum, or none at all (22-45-3).");
assert.equal(promptHint("optionalCost"), "An [Auto] skill's cost may be declined; then it does not resolve.");
assert.equal(promptHint("payCost"), "The colours you keep active decide what you can still do this turn.");
assert.equal(promptHint("offering"), null);

// The definition is the source: a question edited in `prompts.rules` is the question asked.
const edited = loadRuleset({ ...DBS_FILES, "prompts.rules": DBS_FILES["prompts.rules"].replace('"Keep this hand?"', '"Keep these seven?"') }, "dbs");
assert.ok(edited.ok, "the edited ruleset did not load");
if (edited.ok) {
  assert.equal(fixedPrompt("mulligan", edited.definition)?.question, "Keep these seven?");
  assert.equal(fixedPrompt("mulligan")?.question, "Keep this hand?");
}

// The one prompt kind reachable on the rules engine whose text is not fixed:
// a counter/combo's own price, the same interpolation the legacy engine does.
const payCostState = { prompt: { kind: "payCost", player: "p1", describe: "activate «Kamehameha»" } } as unknown as VmState;
assert.equal(promptView(payCostState).question, "Which energy do you rest to activate «Kamehameha»?");
assert.equal(promptView(payCostState).cost, "activate «Kamehameha»");

// A program's own question (#152): the choice's reason, its count, and where it
// sits in the chain — the legacy `questionFor`'s words, field for field.
const chooseState = { prompt: { kind: "chooseCards", player: "p1", choice: { reason: "Choose up to 1 card", candidates: [], min: 0, max: 1, continuation: "" } }, programs: [] } as unknown as VmState;
assert.deepEqual(promptView(chooseState), {
  kind: "chooseCards",
  player: "p1",
  question: "Choose up to 1 card",
  hint: "Choose 0 to 1.",
  min: 0,
  max: 1,
  step: { index: 1, count: 0, label: "Choose up to 1 card" },
});

// A prompt kind this engine cannot yet reach still shows something honest, not a crash.
const unknownState = { prompt: { kind: "empowerCarry", player: "p1" } } as unknown as VmState;
assert.equal(promptView(unknownState).question, "…");

console.log("  primer: generatedPrimer names every declared zone; prompt questions come from prompts.rules");

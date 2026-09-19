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
import { loadDbs } from "../../src/lib/arena/rulesets";
import { areasLine, generatedPrimer, turnStructure, winCondition, zoneNames } from "../../src/lib/arena/ai/primer";
import { PROMPT_QUESTIONS } from "../../src/lib/arena/prompt-words";
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
// fixed-question prompt kind with the same words, from the one table.
const fakeCtx = {} as Parameters<typeof questionFor>[0];
for (const [kind, words] of Object.entries(PROMPT_QUESTIONS)) {
  const legacyState = { prompt: { kind, player: "p1" }, flow: [] } as unknown as GameState;
  const legacy = questionFor(fakeCtx, legacyState);
  assert.equal(legacy.question, words!.question, `view.ts's questionFor("${kind}") does not read prompt-words.ts`);
  assert.equal(legacy.hint, words!.hint, `view.ts's questionFor("${kind}") hint does not read prompt-words.ts`);

  const rulesState = { prompt: { kind, player: "p1" } } as unknown as VmState;
  const rules = promptView(rulesState);
  assert.equal(rules.question, words!.question, `vm/view.ts's promptView("${kind}") does not read prompt-words.ts`);
  assert.equal(rules.hint, words!.hint, `vm/view.ts's promptView("${kind}") hint does not read prompt-words.ts`);
}

// The one prompt kind reachable on the rules engine whose text is not fixed:
// a counter/combo's own price, the same interpolation the legacy engine does.
const payCostState = { prompt: { kind: "payCost", player: "p1", describe: "activate «Kamehameha»" } } as unknown as VmState;
assert.equal(promptView(payCostState).question, "Which energy do you rest to activate «Kamehameha»?");
assert.equal(promptView(payCostState).cost, "activate «Kamehameha»");

// A prompt kind this engine cannot yet reach still shows something honest, not a crash.
const unknownState = { prompt: { kind: "chooseCards", player: "p1" } } as unknown as VmState;
assert.equal(promptView(unknownState).question, "…");

console.log("  primer: generatedPrimer names every declared zone; questionFor/promptView share one word table");

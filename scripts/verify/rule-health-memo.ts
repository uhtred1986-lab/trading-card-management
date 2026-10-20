/**
 * The memoised paths the catalog queue fill leans on equal their un-memoised definitions, on synthetic
 * text (no production data): `skillLines`, `expectedSkills` and `printedFacts`. Each is a pure function of
 * a card's text, kept per text; callers get copies they may edit. Pure; part of `npm test`.
 */
import assert from "node:assert/strict";
import { expectedSkills, expectedSkillsUncached, printedFacts, printedFactsUncached } from "../../src/lib/arena/rules-store";
import { skillLines, skillLinesUncached } from "../../src/lib/arena/text/cards";

const TEXTS: (string | null | undefined)[] = [
  null,
  undefined,
  "",
  "[Blocker]",
  "[Auto] When this card attacks, draw 1 card.",
  "[Permanent] (Cards in your Drop Area are not hidden.)",
  "[Activate: Main] [Once per turn] Draw 1 card.[br][Auto] When this card is played, draw 1 card.",
  "［Ｐｅｒｍａｎｅｎｔ］ Ｌｅａｄｅｒ Ｃard\r\n[Auto] When this card attacks, it gains [Critical] for the turn.",
  "【Evolve】 {g}{g}{2}: <Broly>\n[Auto] During your turn, when your 《Saiyan》 card is played, draw 1 card.",
  "[Auto] When this card is used as a combo card, give +5000 power to your Battle Card.",
  "[Auto] At the end of a battle in which this card was used as a combo card, draw 1 card.",
  "[Fusion: Gogeta] {r}{r}{3}: Fuse two Battle Cards.[br][Permanent] Your opponent can't play Battle Cards.",
  "[Absorb] Absorb a card from your Warp.",
  "[Potara] Place a Battle Card and merge.",
  "[Auto] Choose one― ・Draw 1 card ・Add 1 card from your Drop Area to your hand.",
  "[Auto] Your opponent chooses two cards from their hand and discards them.",
  "[Permanent] Reduce the cost of ｛Power Pole｝ by 1.<br>[Counter] Draw 1 card.",
];

// skillLines: same lines, and a caller editing the answer does not change the next one.
for (const t of TEXTS) {
  assert.deepEqual(skillLines(t), skillLinesUncached(t), `skillLines: ${JSON.stringify(t)}`);
  const first = skillLines(t);
  first.push("edited");
  first.length = 0;
  assert.deepEqual(skillLines(t), skillLinesUncached(t), "skillLines hands out copies");
}

// expectedSkills: every front/back pair, twice (the second read is the memo's), with the answer edited in between.
for (const front of TEXTS) {
  for (const back of TEXTS) {
    const want = expectedSkillsUncached(front, back);
    assert.deepEqual(expectedSkills(front, back), want, `expectedSkills cold: ${JSON.stringify([front, back])}`);
    const mine = expectedSkills(front, back);
    for (const e of mine) e.printed = "edited";
    mine.length = 0;
    assert.deepEqual(expectedSkills(front, back), want, `expectedSkills warm: ${JSON.stringify([front, back])}`);
  }
}

// printedFacts: the memo and the definition agree, cold and warm.
for (const t of TEXTS) {
  const text = t ?? "";
  const want = printedFactsUncached(text);
  assert.deepEqual(printedFacts(text), want, `printedFacts cold: ${JSON.stringify(t)}`);
  assert.deepEqual(printedFacts(text), want, `printedFacts warm: ${JSON.stringify(t)}`);
}

console.log("rule-health-memo: all checks passed");

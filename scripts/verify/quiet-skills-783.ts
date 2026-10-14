/**
 * #783: which resolved skills the board reports as having done nothing (`quietSkills`), read only from
 * the beats a snapshot already carries. Pure; part of `npm test`. The browser half (the notice shows,
 * holds the computer's advance and is released by OK) is `scripts/arena-no-target-783.mts`.
 */
import assert from "node:assert/strict";
import type { NumberedBeat } from "../../src/lib/arena/beats";
import { quietSentence, quietSkills, quietTitle } from "../../src/components/arena/stage/quiet-skills";

const KO = "When this card attacks, choose up to 1 of your opponent's Battle Cards with cost 2 or less and KO it.";
const art = { L: { cardId: "BT1-001", name: "Vegeta", imageUrl: null }, B: { cardId: "BT6-011", name: "Bulma, from the Sidelines", imageUrl: null } };
const skill = (n: number, extra: Record<string, unknown> = {}): NumberedBeat => ({ t: "skill", card: "L", label: "Auto", text: KO, unread: false, owner: "p1", inBattle: false, n, ...extra }) as NumberedBeat;
const clash = (n: number): NumberedBeat => ({ t: "clash", attacker: "L", guard: "G", attackPower: 15000, guardPower: 10000, hit: true, n }) as NumberedBeat;
const ko = (n: number): NumberedBeat => ({ t: "ko", card: "X", owner: "p2", n }) as NumberedBeat;

// The engine's own word.
assert.deepEqual(quietSkills([skill(1, { noEffect: true })], art, "main").map((q) => [q.n, q.engine]), [[1, true]], "a `noEffect` skill is reported");

// In a battle: followed straight by the clash, it did nothing; followed by a KO, it did something.
assert.deepEqual(quietSkills([skill(1, { inBattle: true }), clash(2)], art, "combo").map((q) => [q.n, q.engine]), [[1, false]], "a targeting skill followed by the clash is reported");
assert.equal(quietSkills([skill(1, { inBattle: true }), ko(2), clash(3)], art, "combo").length, 0, "a skill whose KO happened is not");

// The batch's last beat in a battle: done when the prompt is a battle window, still asking when it is a choice.
assert.equal(quietSkills([skill(1, { inBattle: true })], art, "combo").length, 1, "the last beat, in a battle, at a combo prompt");
assert.equal(quietSkills([skill(1, { inBattle: true })], art, "chooseCards").length, 0, "a skill still asking for its target is not reported");
assert.equal(quietSkills([skill(1)], art, "main").length, 0, "outside a battle only the engine's `noEffect` counts");

// Skills that leave no beat even when they work, and skills that target nothing, are never inferred.
assert.equal(quietSkills([skill(1, { inBattle: true, text: "Look at the top 3 cards of your deck and choose 1." }), clash(2)], art, "combo").length, 0, "a look is never called empty");
assert.equal(quietSkills([skill(1, { inBattle: true, text: "This card gains +5000 power." }), clash(2)], art, "combo").length, 0, "no targeting words, no inference");

// A skill the viewer may not see (masked: no art, no label) is never reported.
assert.equal(quietSkills([skill(1, { noEffect: true, card: "hidden", label: "" })], art, "main").length, 0, "a masked skill stays masked");

// The words, from both chairs, and the honest heading for a conditional skill.
const [mine] = quietSkills([skill(1, { noEffect: true })], art, "main");
assert.equal(quietTitle(mine), "No valid target");
assert.equal(quietSentence(mine, "p1", "Claude"), "Your Vegeta — Auto: no valid target, so nothing happened.");
assert.equal(quietSentence(mine, "p2", "Claude"), "Claude's Vegeta — Auto: no valid target, so nothing happened.");
const [bulma] = quietSkills([skill(1, { noEffect: true, card: "B", text: "When you play this card, if there is a ≪Saiyan≫ card in play in your Battle Area, draw 2 cards, then choose 2 cards from your hand and place them in your Drop Area." })], art, "main");
assert.equal(quietTitle(bulma), "Nothing happened", "a condition the beats cannot tell from a missing target is named as either");
assert.match(quietSentence(bulma, "p1", "Claude"), /its condition was not met or it had no valid target/);
assert.ok(bulma.effect.endsWith("…") && !bulma.effect.endsWith(".…"), "a long effect is cut once, cleanly");

console.log("quiet-skills (#783): no-target skills read from the beats: ok");

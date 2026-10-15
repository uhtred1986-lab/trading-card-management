import assert from "node:assert/strict";
import { skillMoment } from "../../src/lib/arena/immersion/skills";
import type { CardView } from "../../src/lib/arena/view";
import type { NumberedBeat } from "../../src/lib/arena/beats";

const card = { cardId: "public", name: "Public face", imageUrl: "/public.png", hidden: false } as CardView;
const art = { x: { cardId: "public", name: "Public face", imageUrl: "/public.png" } };
const move: NumberedBeat = { n: 1, t: "move", card: "x", from: "hand", to: "battle", owner: "p1" };
const context = { cardOf: () => card, art, viewer: "p1" as const };
assert.equal(skillMoment(1, move, context)?.face?.name, "Public face");
assert.equal(skillMoment(1, move, context)?.side, "You");
assert.equal(skillMoment(1, { ...move, owner: "p2" }, context)?.side, "Opponent");
// A hidden current card overrides even an accidentally retained old capture.
assert.equal(skillMoment(1, move, { ...context, cardOf: () => ({ ...card, hidden: true }) })?.face, undefined);
assert.equal(skillMoment(1, move, { ...context, cardOf: () => ({ ...card, name: "Changed face" }) })?.face, undefined);
// A departed public card may use viewer-masked captured art; hidden destinations cannot.
assert.equal(skillMoment(1, move, { ...context, cardOf: () => null })?.face?.name, "Public face");
assert.equal(skillMoment(1, { ...move, from: "battle", to: "hand" }, { ...context, cardOf: () => null })?.face, undefined);
assert.equal(skillMoment(1, { ...move, from: "deck", to: "hand" }, context), null);
assert.equal(skillMoment(1, { ...move, from: "hand", to: "energy" }, context), null);
for (const [label, style] of [["Swap", "swap"], ["Union-Potara", "union"], ["EX-Evolve", "evolve"], ["Awaken", "awaken"], ["Auto", "skill"]]) {
  const moment = skillMoment(1, { n: 2, t: "skill", card: "x", label, text: "[Swap] unrelated mention", owner: "p1", unread: false, inBattle: false }, context);
  assert.equal(moment?.style, style);
  assert.equal(moment?.from, undefined);
  assert.equal(moment?.to, undefined);
  assert.equal(moment?.detail, "Skill resolution");
}
const warp = skillMoment(1, { ...move, from: "battle", to: "warp" }, context);
assert.equal(warp?.detail, "Battle Area → Warp");
assert.equal(warp?.style, "warp");
assert.equal(skillMoment(1, { n: 3, t: "negated" }, context), null);
console.log("Arena skill motion: visible faces, hidden identities, actual movement and no speculative skill outcomes pass");

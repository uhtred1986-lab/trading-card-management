import assert from "node:assert/strict";
import { compileSkill } from "../../../../src/lib/arena/compile/index.ts";
import { parseSkills } from "../../../../src/lib/arena/text/cards.ts";

const cases = [
  ["BT3-109#20", "[Auto] When a card evolves into this card, if your Leader Card is black, you may choose 5 cards from your Warp and place them in the Drop Area. If you do so, send all of your opponent's Battle Cards to their Warp.", 5],
  ["BT6-062#10", "[Auto] When this card is removed from a Battle Area by a skill or KO'd, and if your Leader Card is a green ≪Frieza's Army≫ card, you may choose 2 cards from your hand and place them in your Drop Area. If you do, choose up to 1 green <Broly: Br> card with an energy cost of 6 from your hand and play it.", 2],
  ["SD8-03#10", "[Auto] When this card is removed from a Battle Area by a skill or KO'd, you may choose 2 cards from your hand and place them in your Drop Area. If you do, choose up to 1 green <Broly: Br> card with an energy cost of 7 from your hand and play it.", 2],
] as const;

type Op = {
  op: string;
  sel?: { count?: number; upTo?: boolean };
  reason?: string;
  then?: Op[];
  else?: Op[];
  to?: string;
  cond?: { kind?: string; var?: string; atLeast?: number };
  as?: string;
};
function allOps(ops: Op[]): Op[] {
  return ops.flatMap((op) => [op, ...((op.then ? allOps(op.then) : [])), ...((op.else ? allOps(op.else) : []))]);
}
for (const [id, printed, exactCount] of cases) {
  const result = compileSkill(parseSkills(printed)[0]!);
  const ops = result.ops as Op[];
  const nodes = allOps(ops);
  const choose = nodes.find((op) => op.op === "choose" && op.sel?.count === exactCount && op.reason?.includes(`choose ${exactCount} cards`));
  assert.ok(choose, `${id}: no count-${exactCount} choice`);
  assert.equal(choose.sel.upTo, true, `${id}: fresh selector still permits fewer than N`);
  const list = [ops, ...nodes.map((op) => op.then ?? [])].find((siblings) => {
    const index = siblings.indexOf(choose!);
    return index >= 0 && siblings[index + 1]?.op === "moveTo" && siblings[index + 1]?.to === "drop";
  });
  assert.ok(list, `${id}: choice does not immediately move selected cards to Drop`);
  const gated = nodes.find((op) => op.op === "if" && op.cond?.kind === "chose" && op.cond?.var === choose.as);
  assert.ok(gated && gated.cond.atLeast === exactCount, `${id}: no later full-count follow-up gate`);
  console.log(`${id}: choose up to ${exactCount}; selected cards move to Drop before the later atLeast ${exactCount} check. Control-flow inference for a 1-card selection: the move precedes and is independent of the full-count follow-up gate.`);
}
console.log("PASS: current compiled op order retains the documented partial-choice approximation in all three candidate readings.");

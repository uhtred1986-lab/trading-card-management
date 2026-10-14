/** Reproducible UI states from the real VM; synthetic combat cards, no transport or DB. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyMove, legalMoves, projectSnapshot, type PinnedMatch } from "../src/lib/arena/browser";
import { battleAt, combatFixtureBundle, combatMainPhase, p2MainPhase } from "./verify/arena-policy-combat-fixture";
import { stage } from "./verify/arena-policy-main-fixture";

const out = "contract/fixtures";
mkdirSync(out, { recursive: true });
const bundle = await combatFixtureBundle();
const main = await combatMainPhase(bundle);
const save = (name: string, match: PinnedMatch) => {
  writeFileSync(join(out, `phone-ux-${name}.json`), JSON.stringify(projectSnapshot(match, "p1", { id: 23001 }), null, 2) + "\n");
  console.log(`phone-ux-${name}: ${match.state.prompt.kind}`);
};
for (const count of [6, 10]) {
  save(`hand-${count}`, stage(main, { p1: { hand: Array.from({ length: count }, (_, i) => i % 3 === 0 ? "C-NEG" : i % 2 === 0 ? "C-BIG" : "C-V5"), energy: ["C-V5", "C-V5"], battle: [] } }));
}
save("attack-pick", stage(main, { p1: { battle: [{ cardId: "C-BIG", mode: "active" }] }, p2: { battle: [{ cardId: "C-V5", mode: "rest" }, { cardId: "C-V10", mode: "active" }] } }));
const theirs = p2MainPhase(main);
let defend = battleAt(theirs, {
  p1: { hand: ["C-NEG", "C-V5", "C-V10"], energy: ["C-V5", "C-V5"], battle: [{ cardId: "C-CHUMP", mode: "active" }] },
  p2: { hand: ["C-V5"], battle: [{ cardId: "C-BIG", mode: "active" }] },
}, "C-BIG", "leader", { p2: "C-L-RED" });
assert.equal(defend.state.prompt.kind, "counter");
save("counter", defend);
const noCounter = legalMoves(defend).find((row) => row.action.type === "counter" && row.action.card === null);
assert.ok(noCounter);
defend = applyMove(defend, noCounter.action).match;
assert.equal(defend.state.prompt.kind, "blocker");
save("blocker", defend);
const noBlock = legalMoves(defend).find((row) => row.action.type === "block" && row.action.card === null);
assert.ok(noBlock);
defend = applyMove(defend, noBlock.action).match;
for (let n = 0; n < 10 && (!("player" in defend.state.prompt) || defend.state.prompt.player !== "p1"); n++) {
  const pass = legalMoves(defend).find((row) => row.action.type === "pass");
  assert.ok(pass, "opponent combo can be passed to stage the human response");
  defend = applyMove(defend, pass.action).match;
}
assert.equal(defend.state.prompt.kind, "combo");
save("combo", defend);

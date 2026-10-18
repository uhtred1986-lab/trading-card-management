/**
 * #990: "If your Leader Card is a red ≪Earthling≫-only card with 10000 power or
 * less" (BT12-003, BT12-011, BT12-013, EX19-01, P-274) was cut at the "or" of
 * "power or less": the bound became an alternative of its own, a Leader filter
 * that names nothing, and "your leader is X-only, or your leader is a match" is
 * true for every Leader.
 *
 *   1. The condition is one `leaderMatches` with colour + trait-only + power
 *      bound together, and never an `any` with a blank alternative.
 *   2. An empty alternative is refused (unread) instead of read as always true.
 *   3. Printed text -> compile -> stored row -> the real VM: a Leader that is
 *      Earthling-only and red but over the bound is refused; at or under, offered.
 *   4. The other bound spellings ("or more", "N or less" with no noun) and the
 *      other Leader shapes ("opponent's", "back side") read the same way.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { compileSkill, parseConditionClause, splitDisjunction } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript } from "../../src/lib/arena/vm/script-schema";
import { RULES } from "../../src/lib/arena/vm";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 1. The parse: one filter, bound included ────────────────────────────────
{
  const got = parseConditionClause("if your leader card is a red ≪earthling≫-only card with 10000 power or less");
  assert.ok(got, "reads");
  assert.equal(got.cond.kind, "leaderMatches", "one condition, not an 'any' of two");
  if (got.cond.kind !== "leaderMatches") throw new Error("unreachable");
  assert.deepEqual(got.cond.filter.colors, ["Red"]);
  assert.equal(got.cond.filter.traits.length, 1);
  assert.equal(got.cond.filter.onlyTraits, true);
  assert.equal(got.cond.filter.powerMax, 10000, "the bound is on the same filter");
  const more = parseConditionClause("if your leader card is a red ≪Earthling≫-only card with 10000 power or more");
  assert.equal(more?.cond.kind, "leaderMatches");
  if (more?.cond.kind === "leaderMatches") assert.equal(more.cond.filter.powerMin, 10000);
  // The cut is made by the splitter: "N <noun> or less" is one bound for the Leader readers.
  assert.deepEqual(splitDisjunction("a red card with 10000 power or less", { measured: true }), ["a red card with 10000 power or less"]);
  // A real disjunction still splits (and the default, unmeasured splitter is untouched).
  assert.equal(splitDisjunction("a red card or a blue card", { measured: true }).length, 2);
  assert.equal(splitDisjunction("a red card with 10000 power or less").length, 2, "other callers keep their old reading");
}

// ── 2. No blank alternative ─────────────────────────────────────────────────
{
  // "or" followed by something that names nothing is a part not read: refused, not always true.
  for (const t of [
    "if your leader card is a red card or a",
    "if your opponent's leader card is a red card or the",
    "if your leader card's back side is a red card or whatever",
  ]) assert.equal(parseConditionClause(t), null, `${t}: refused`);
  // A colour pair and a two-name list are real alternatives, untouched.
  assert.equal(parseConditionClause("if your leader card is red or blue")?.cond.kind, "leaderMatches", "one filter with two colours");
  assert.equal(parseConditionClause("if your leader is <Raditz> or <Nappa>")?.cond.kind, "any");
}

// ── 3. Printed text -> stored row -> the VM ─────────────────────────────────
const PRINTED = "[Activate: Main] If your Leader Card is a red ≪Earthling≫-only card with 10000 power or less: Draw 1 card.";
{
  const sk = compileSkill(parseSkills(PRINTED)[0]!);
  assert.deepEqual(sk.unsupported, [], "the whole wording reads");
  const reads = describeScript(sk.ops);
  assert.doesNotMatch(reads, /is a match|, or your leader/, reads);
  assert.match(reads, /≪earthling≫-only/i, reads);
  assert.match(reads, /10000/, `the bound is in the reading: ${reads}`);
}
const leader = (id: string, colors: CardDef["colors"], traits: string[], power: number) => card(id, { type: "LEADER", colors, traits, power, skill: null });
const SHAPES: [CardDef, boolean][] = [
  [leader("L-EARTH-10", ["Red"], ["Earthling"], 10000), true],
  [leader("L-EARTH-5", ["Red"], ["Earthling"], 5000), true],
  [leader("L-EARTH-15", ["Red"], ["Earthling"], 15000), false], // trait-only and red, over the bound
  [leader("L-EARTH-SAIYAN-5", ["Red"], ["Earthling", "Saiyan"], 5000), false], // not -only
  [leader("L-BLUE-EARTH-5", ["Blue"], ["Earthling"], 5000), false],
  [leader("L-SAIYAN-5", ["Red"], ["Saiyan"], 5000), false],
];
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const defs: Record<string, CardDef> = { ...DEFS, GATED990: card("GATED990", { type: "BATTLE", colors: ["Red"], energyCost: 1, power: 5000, skill: PRINTED }) };
for (const [d] of SHAPES) defs[d.id] = d;
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const game = loaded.definition;
const apply = (s: VmState, a: Action): VmState => RULES.apply(ctx, roundtrip(s), a).state as VmState;
function board(): VmState {
  let s = RULES.createGame(ctx, { seed: 990, p1: { name: "Other", leader: "L-RED", main: fifty("GATED990") }, p2: { name: "You", leader: "L-EARTH-5", main: fifty("GATED990") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  return s;
}
const base = board();
const physical = base.sides.p2.zones.deck[0]; base.cards[physical].cardId = "GATED990";
assert.ok(moveCard(base, game, physical, "battle", { owner: "p2" }).ok);
for (const [d, want] of SHAPES) {
  const s = roundtrip(base);
  s.cards[s.sides.p2.zones.leader[0]].cardId = d.id;
  const offered = RULES.legalActions(ctx, s).some((l) => l.action.type === "activate" && l.action.card === physical);
  assert.equal(offered, want, `${d.id}: ${want ? "offered" : "refused"}`);
}

// ── 4. Neighbours ───────────────────────────────────────────────────────────
{
  const opp = parseConditionClause("if your opponent's leader card is a red ≪Earthling≫-only card with 10000 power or less");
  assert.equal(opp?.cond.kind, "leaderMatches");
  if (opp?.cond.kind === "leaderMatches") assert.equal(opp.cond.filter.powerMax, 10000);
  const back = parseConditionClause("if your leader card's back side is a red ≪Earthling≫-only card with 10000 power or less");
  assert.equal(back?.cond.kind, "leaderMatches");
  if (back?.cond.kind === "leaderMatches") assert.equal(back.cond.filter.powerMax, 10000);
}
console.log("leader-only-power-990 ok");

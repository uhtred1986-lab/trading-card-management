/**
 * #932: "if your Leader Card is a black ≪Saiyan≫-only card" is a Leader whose
 * traits are Saiyan and nothing else. The character twin ("<Son Goku>-only",
 * BT29-108) was read; the trait form kept "has the Saiyan trait" and dropped
 * "only", so a black [Saiyan, Earthling] Leader satisfied BT12-136/137/P-286's
 * [Union-Fusion] price (and thirty more skills).
 *
 *   1. Printed text -> parseFilter: the flag is written for ≪X≫-only, and only
 *      then. Mono-colour, bare traits, <X>-only and "non-" stay as they were.
 *   2. The legacy `matches` and the VM predicate agree, on every Leader shape.
 *   3. The reading says "-only", and the said form parses back to the same filter.
 *   4. Printed text -> compile -> stored-row JSON -> the real VM: an
 *      [Activate: Main] gated by the wording is offered to a Saiyan-only Leader
 *      and refused to a Saiyan+Earthling one, the wrong colour, and no Saiyan.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { emptyFilter, matches, parseFilter } from "../../src/lib/arena/text/filters";
import { describeFilter, describeScript } from "../../src/lib/arena/vm/script-schema";
import { RULES } from "../../src/lib/arena/vm";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── 1. The parse ─────────────────────────────────────────────────────────────
{
  const f = parseFilter("a black ≪Saiyan≫-only card");
  assert.equal(f.onlyTraits, true);
  assert.deepEqual(f.traits, ["Saiyan"]);
  assert.deepEqual(f.colors, ["Black"]);
  assert.equal(parseFilter("a red ≪Earthling≫-only Battle Card with an energy cost of 4 or less").onlyTraits, true, "a target says it too");
  // Not the flag: the wordings that are about something else.
  for (const t of ["a black ≪Saiyan≫ card", "a mono-black ≪Saiyan≫ card", "a black <Son Goku>-only card", "a black non-≪Saiyan≫ card", "a black ≪Saiyan≫ card or ≪God≫ card"]) {
    assert.equal(parseFilter(t).onlyTraits, undefined, `${t}: no trait-only flag`);
  }
  assert.equal(parseFilter("a black <Son Goku>-only card").onlyCharacters, true, "the character twin is unchanged");
  assert.equal(parseFilter("a black ≪Saiyan≫-only card").onlyCharacters, false, "and is not set by the trait form");
  // An empty filter and a stored program from before carry no field at all.
  assert.ok(!("onlyTraits" in emptyFilter()), "older stored programs and every unrelated filter stay byte-identical");
}

// ── 2. Matching: the legacy matcher and the VM predicate ────────────────────
const leader = (id: string, colors: CardDef["colors"], traits: string[]) => card(id, { type: "LEADER", colors, traits, power: 10000, skill: null });
const SHAPES: [CardDef, boolean][] = [
  [leader("L-SAIYAN", ["Black"], ["Saiyan"]), true],
  [leader("L-SAIYAN-MULTI", ["Black", "Red"], ["Saiyan"]), true],
  [leader("L-SAIYAN-EARTH", ["Black"], ["Saiyan", "Earthling"]), false],
  [leader("L-EARTH", ["Black"], ["Earthling"]), false],
  [leader("L-RED-SAIYAN", ["Red"], ["Saiyan"]), false],
  [leader("L-NONE", ["Black"], []), false],
];
{
  const f = parseFilter("a black ≪Saiyan≫-only card");
  for (const [d, want] of SHAPES) assert.equal(matches(d, f), want, `matches ${d.id}`);
  // Without "only" the same Leaders that carry Saiyan all answer: the flag is the whole difference.
  const bare = parseFilter("a black ≪Saiyan≫ card");
  assert.equal(matches(SHAPES[2][0], bare), true, "a bare ≪Saiyan≫ still means has the trait");
  // Several traits named: every trait the card has must be one of them.
  const two = parseFilter("a ≪Saiyan≫ ≪God≫-only card");
  assert.equal(matches(leader("L-SG", ["Black"], ["Saiyan", "God"]), two), true);
  assert.equal(matches(leader("L-SGE", ["Black"], ["Saiyan", "God", "Earthling"]), two), false);
  // "≪Saiyan≫-only or ≪God≫-only" (BT13-123): each half is its own description.
  const half = parseFilter("≪God≫-only card");
  assert.equal(matches(leader("L-GOD", ["Black"], ["God"]), half), true);
  assert.equal(matches(leader("L-GOD-SAIYAN", ["Black"], ["God", "Saiyan"]), half), false);
}

// ── 3. The reading ──────────────────────────────────────────────────────────
{
  const said = describeFilter(parseFilter("a black ≪Saiyan≫-only card"));
  assert.match(said, /≪Saiyan≫-only/, said);
  assert.deepEqual(roundtrip(parseFilter(said)), roundtrip(parseFilter("a black ≪Saiyan≫-only card")), "the said form parses back to the same filter");
  assert.doesNotMatch(describeFilter(parseFilter("a black ≪Saiyan≫ card")), /-only/);
  const reads = describeScript(compileSkill(parseSkills("[Activate: Main] If your Leader Card is a black ≪Saiyan≫-only card: Draw 1 card.")[0]!).ops);
  assert.match(reads, /your leader is Black ≪Saiyan≫-only/i, reads);
}

// ── 4. Printed text -> stored row -> the VM ─────────────────────────────────
const PRINTED = "[Activate: Main] If your Leader Card is a black ≪Saiyan≫-only card: Draw 1 card.";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const defs: Record<string, CardDef> = { ...DEFS, GATED932: card("GATED932", { type: "BATTLE", colors: ["Black"], energyCost: 1, power: 5000, skill: PRINTED }) };
for (const [d] of SHAPES) defs[d.id] = d;
assert.deepEqual(compileSkill(parseSkills(PRINTED)[0]!).unsupported, [], "the whole wording reads");
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const game = loaded.definition;
const apply = (s: VmState, a: Action): VmState => RULES.apply(ctx, roundtrip(s), a).state as VmState;
function board(): VmState {
  let s = RULES.createGame(ctx, { seed: 932, p1: { name: "Other", leader: "L-RED", main: fifty("GATED932") }, p2: { name: "You", leader: "L-SAIYAN", main: fifty("GATED932") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  return s;
}
const base = board();
const physical = base.sides.p2.zones.deck[0]; base.cards[physical].cardId = "GATED932";
assert.ok(moveCard(base, game, physical, "battle", { owner: "p2" }).ok);
for (const [d, want] of SHAPES) {
  const s = roundtrip(base);
  s.cards[s.sides.p2.zones.leader[0]].cardId = d.id;
  const offered = RULES.legalActions(ctx, s).some((l) => l.action.type === "activate" && l.action.card === physical);
  assert.equal(offered, want, `${d.id}: ${want ? "offered" : "refused"}`);
}
console.log("leader-trait-only-932 ok");

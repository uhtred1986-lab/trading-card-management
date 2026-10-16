/**
 * #941: a numeric keyword parameter in a card filter ("Saiyan … with [Over Realm 2]")
 * is kept — printed text → compile → stored-row JSON round trip → language
 * round trip → the real selector and a played activation. Family-only filters
 * ("with [Blocker]", "with [Over Realm]") read and select exactly as before.
 *
 * The Chronoa text below is a faithful reconstruction of the shape the issue
 * describes (printed Leader condition, hand-to-Warp cost, Saiyan with
 * [Over Realm 2] from the Warp, played in Rest Mode); no card id is special.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES as engine } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { emptyFilter, parseFilter, matches as matchesFilter, type CardFilter } from "../../src/lib/arena/text/filters";
import { describeFilter, filterProblem, validateProgram } from "../../src/lib/arena/vm/script";
import { deepEqual, parseRule, printRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const TEXT = "[Activate: Main][Once per turn] If your Leader Card is a red ≪Saiyan≫ card, you place 1 card from your hand into your Warp: Play up to 1 ≪Saiyan≫ Battle Card with [Over Realm 2] from your Warp in Rest Mode.";
const sai = ["Saiyan"];
const defs: Record<string, CardDef> = { ...DEFS,
  LEAD941: card("LEAD941", { type: "LEADER", colors: ["Red"], traits: sai, power: 10000, skill: null }),
  CHR941: card("CHR941", { traits: sai, skill: TEXT }),
  OR2: card("OR2", { traits: sai, skill: "[Over Realm 2]" }),
  OR2B: card("OR2B", { traits: sai, skill: "[Over Realm 2]{1}" }),
  OR4: card("OR4", { traits: sai, skill: "[Over Realm 4]" }),
  OR6: card("OR6", { traits: sai, skill: "[Over Realm 6]" }),
  DARK2: card("DARK2", { traits: sai, skill: "[Dark Over Realm 2]" }),
  NONSAI: card("NONSAI", { traits: ["Namekian"], skill: "[Over Realm 2]" }),
  PLAIN: card("PLAIN", { traits: sai, skill: null }),
  EXTRA941: card("EXTRA941", { type: "EXTRA", traits: sai, skill: "[Over Realm 2]" }),
  FILL941: card("FILL941", { skill: null }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// 1. Reading: the number survives, the family stays, other forms are unchanged.
const rec = skillRecords(defs.CHR941);
assert.equal(rec.length, 1); assert.deepEqual(rec[0].unread, []);
const rows = rec.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow));
type StoredRow = { kind: string; trigger: string[]; reads: string; ops: Array<{ op: string; mode?: string }>; cost: { program: unknown; condition: { kind: string } | null }; cond: { kind: string } | null };
const storedRows = roundtrip(rows);
const stored = storedRows as unknown as StoredRow[];
const choose = stored[0].ops.find((o: { op: string }) => o.op === "choose") as unknown as { sel: { area: string; side: string; filter: CardFilter } };
assert.equal(choose.sel.area, "warp"); assert.equal(choose.sel.side, "you");
assert.deepEqual(choose.sel.filter.keywordsExact, ["Over Realm 2"]);
assert.deepEqual(choose.sel.filter.keywords, ["Over Realm"], "the family is still recorded");
assert.deepEqual(choose.sel.filter.traits, ["saiyan"]);
assert.equal(stored[0].ops.find((o: { op: string }) => o.op === "play")?.mode, "rest");
assert.equal(filterProblem(choose.sel.filter), null);
assert.ok(validateProgram(stored[0].ops));
assert.match(stored[0].reads, /\[Over Realm 2\]/);
const once = stored[0].cost.program; assert.ok(JSON.stringify(once).includes("discard"), "hand-to-Warp cost kept");
assert.equal(stored[0].cond?.kind ?? stored[0].cost.condition?.kind, "leaderMatches", "printed Leader condition kept");

const fam = (t: string) => parseFilter(t);
assert.equal(fam("Battle Cards with [Over Realm]").keywordsExact, undefined, "family-only stays family-only");
assert.deepEqual(fam("Battle Cards with [Over Realm]").keywords, ["Over Realm"]);
assert.equal(fam("Battle Cards with [Double Strike]").keywordsExact, undefined, "[Double Strike] prints no number");
assert.deepEqual(fam("Battle Cards with [Blocker]").keywords, ["Blocker"]);
assert.deepEqual(fam("Battle Cards with [Dark Over Realm 2]").keywordsExact, ["Dark Over Realm 2"], "Dark is its own name");
assert.deepEqual(fam("Battle Cards with [Swap 1]").keywordsExact, ["Swap 1"]);
const neg = fam("Battle Cards without [Over Realm 2]");
assert.deepEqual(neg.notKeywordsExact, ["Over Realm 2"]); assert.deepEqual(neg.notKeywords, [], "negated exact does not forbid the whole family");
assert.deepEqual(fam("non-[Over Realm 4] Battle Cards").notKeywordsExact, ["Over Realm 4"]);
// An old stored filter (no exact fields) is valid and unchanged.
const old: CardFilter = { ...emptyFilter(), keywords: ["Over Realm"] };
assert.equal(filterProblem(old), null); assert.equal(JSON.stringify(old).includes("Exact"), false);
assert.equal(filterProblem({ ...old, keywordsExact: [1] }) === null, false, "a malformed exact value is refused");

// 2. Matching (card level, both matchers).
const f = choose.sel.filter;
for (const [id, want] of [["OR2", true], ["OR2B", true], ["OR4", false], ["OR6", false], ["DARK2", false], ["NONSAI", false], ["PLAIN", false], ["V1", false]] as const)
  assert.equal(matchesFilter(defs[id], f), want, `${id} text matcher`);
assert.equal(matchesFilter(defs.OR4, old), true, "family-only still takes Over Realm 4");
assert.equal(matchesFilter(defs.DARK2, old), true, "family-only still takes Dark Over Realm");
assert.equal(matchesFilter(defs.OR2, neg), false); assert.equal(matchesFilter(defs.OR4, neg), true);

// 3. Language round trip.
const printed = describeFilter(f);
assert.match(printed, /\[Over Realm 2\]/); assert.doesNotMatch(printed, /\[Over Realm\]/);
assert.deepEqual(parseFilter(printed).keywordsExact, ["Over Realm 2"]);
const rule: Rule = { kind: stored[0].kind, trigger: stored[0].trigger, cost: stored[0].cost, cond: stored[0].cond, ops: stored[0].ops } as Rule;
const text = printRule(rule); assert.match(text, /with \[Over Realm 2\]/);
const back = parseRule(text); assert.ok(back.ok, back.ok ? "" : back.error.message);
if (back.ok) { assert.ok(deepEqual(back.value, rule), "language round trip is exact"); assert.equal(printRule(back.value), text); }
// An old family-only rule prints without the new field.
assert.doesNotMatch(printRule({ kind: "auto", trigger: [], cost: null, cond: null, ops: [{ op: "choose", sel: { side: "you", area: "warp", filter: old, count: 1 }, as: "p0" }] } as Rule), /Exact/);

// 4. The real engine: stored rows → activation.
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const ctx = { ...CTX, defs, scripts: rulesFromRows(storedRows, defs) };
const apply = (s: VmState, a: Action): VmState => engine.apply(ctx, roundtrip(s), a).state as VmState;
function stage(s: VmState, p: PlayerId, id: string, area: "hand" | "battle" | "energy" | "warp" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical); s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok); return physical;
}
function board(leader: string): VmState {
  let s = engine.createGame(ctx, { seed: 941, p1: { name: "Other", leader: "L-RED", main: fifty("FILL941") }, p2: { name: "You", leader, main: fifty("FILL941") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy", "warp", "drop"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
const offer = (s: VmState, id: string) => engine.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
const candidates = (s: VmState) => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
function run(s: VmState, id: string): VmState {
  const o = offer(s, id); assert.ok(o, "Chronoa's activation is offered");
  let d = apply(s, o.action);
  for (let i = 0; i < 6 && d.prompt.kind !== "chooseCards"; i++) {
    if (d.prompt.kind === "payCost") d = apply(d, { type: "payCost", player: "p2", option: 0 });
    else break;
  }
  return d;
}
function scene(leader = "LEAD941") {
  const s = board(leader);
  const chr = stage(s, "p2", "CHR941", "battle");
  const hand = stage(s, "p2", "FILL941", "hand");
  const ids = Object.fromEntries(["OR2", "OR2B", "OR4", "OR6", "DARK2", "NONSAI", "PLAIN"].map((k) => [k, stage(s, "p2", k, "warp")]));
  const extra = stage(s, "p2", "EXTRA941", "warp");
  const enemy = stage(s, "p1", "OR2", "warp");
  const inDrop = stage(s, "p2", "OR2", "drop"), inHand = stage(s, "p2", "OR2", "hand");
  const inBattle = stage(s, "p2", "OR2", "battle");
  return { s, chr, hand, ids, extra, enemy, inDrop, inHand, inBattle };
}
{
  const { s, chr, ids, enemy, inDrop, inHand, inBattle, extra } = scene();
  let d = run(s, chr);
  // The hand-to-Warp cost may be a prompt of its own.
  if (d.prompt.kind === "chooseCards" && !candidates(d).includes(ids.OR2)) d = apply(d, { type: "choose", player: "p2", cards: [candidates(d)[0]] });
  assert.equal(d.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(d).sort(), [ids.OR2, ids.OR2B].sort(), "only own-Warp Saiyan [Over Realm 2] Battle Cards");
  for (const bad of [ids.OR4, ids.OR6, ids.DARK2, ids.NONSAI, ids.PLAIN, enemy, inDrop, inHand, inBattle, extra, chr])
    assert.throws(() => apply(d, { type: "choose", player: "p2", cards: [bad] }), IllegalAction);
  const done = apply(d, { type: "choose", player: "p2", cards: [ids.OR2] });
  assert.equal(done.cards[ids.OR2].mode, "rest", "played in Rest Mode");
  assert.ok(done.sides.p2.zones.battle.includes(ids.OR2));
  assert.ok(done.sides.p2.zones.warp.length >= 1, "the hand card paid the cost into the Warp");
  assert.equal(done.sides.p2.zones.hand.length, 1, "exactly one hand card was spent (the other staged copy stays)");
  // Optional choice: declining plays nothing.
  const decline = apply(d, { type: "choose", player: "p2", cards: [] });
  assert.ok(!decline.sides.p2.zones.battle.includes(ids.OR2));
}
// Wrong Leader: the printed condition still gates the whole skill.
{
  const { s, chr } = scene("L-BLUE");
  const o = offer(s, chr);
  assert.equal(o, undefined, "not offered without the printed Leader");
}
// No hand card to pay: the cost is refused.
{
  const { s, chr, hand, inHand } = scene();
  for (const id of [hand, inHand]) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
  const o = offer(s, chr);
  assert.equal(o, undefined, "not offered when the hand-to-Warp cost cannot be paid");
}
// Wrong seat: the opponent's Over Realm 2 in its own Warp is never offered to us (covered above), and
// our Chronoa on the other seat sees its own Warp only.
{
  const s = board("LEAD941");
  const mine = stage(s, "p2", "OR2", "warp");
  const theirs = stage(s, "p1", "OR2", "warp");
  const chr = stage(s, "p2", "CHR941", "battle"); stage(s, "p2", "FILL941", "hand");
  let d = run(s, chr);
  if (d.prompt.kind === "chooseCards" && !candidates(d).includes(mine)) d = apply(d, { type: "choose", player: "p2", cards: [candidates(d)[0]] });
  assert.deepEqual(candidates(d), [mine]); assert.ok(!candidates(d).includes(theirs));
}
console.log("#941 numeric keyword parameters: reading, stored round trip, language, matching and Chronoa activation passed");

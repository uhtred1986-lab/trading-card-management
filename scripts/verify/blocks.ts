/**
 * The block builder (#469), proved without a browser.
 *
 * `Blocks.tsx` is a rendering of `lib/arena/lang/blocks.ts`: every control is
 * picked by a blank's field type, every "add" list comes off the schema, and
 * every edit is one of the path functions below. So the builder's logic is
 * checked here, by doing what a tap does — the same calls the components make
 * — and reading what comes out:
 *
 * - every op and condition a card can say gets a block from a minimal
 *   instance, built the way `lang/reference.ts` builds its examples, with no
 *   code per op;
 * - every rule the harness's cards compile to, and every worked example in
 *   the language doc, goes blocks → `printRule` → `parseRule` → blocks and
 *   comes back the same rule;
 * - the issue's three acceptance rules can be built from empty clauses with
 *   taps alone, and read as their cards print;
 * - an invalid rule shows each problem at its block, and a valid one shows
 *   none;
 * - the four rule-writing server actions refuse a non-admin.
 *
 * Part of `npm test`. No database, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import {
  COST_ITEM_SPECS,
  COST_SYNTAXES,
  SELECTOR_FLAG_WORDS,
  addCostItem,
  blankCond,
  blankOp,
  blocksOf,
  boundBefore,
  choicesFor,
  condReading,
  controlFor,
  costItems,
  editCostItem,
  filterFieldsSet,
  flagOn,
  howMany,
  ifChoices,
  insertAt,
  moveAt,
  openingFocus,
  opReading,
  problemsOf,
  removeAt,
  ruleFromBlocks,
  ruleReading,
  searchChoices,
  sentenceParts,
  setAt,
  setFilterField,
  setFlag,
  setHowMany,
  templateFields,
  thenChoices,
  whenChoices,
  type Block,
} from "../../src/lib/arena/lang/blocks";
import { minimalInstance } from "../../src/lib/arena/lang/reference";
import { COND_SCHEMA, CONDITIONS_OFF_A_CARD, OP_SCHEMA, type Cond, type Op, type Selector } from "../../src/lib/arena/vm/script";
import { whenMoments } from "../../src/lib/arena/rulesets/words";
import { DEFS, skillRecords } from "./harness";
import type { Trigger } from "../../src/lib/arena/types";

const ruleOf = (patch: Partial<Rule> = {}): Rule => ({ kind: "auto", trigger: [], cost: null, cond: null, ops: [], ...patch });

/** blocks → print → parse → blocks: the same rule at every step. */
function trip(rule: Rule, what: string): void {
  const blocks = blocksOf(rule);
  const fromBlocks = ruleFromBlocks(blocks);
  assert.ok(deepEqual(fromBlocks, rule), `${what}: the blocks do not give back the rule\n  was: ${JSON.stringify(rule)}\n  now: ${JSON.stringify(fromBlocks)}`);
  const text = printRule(fromBlocks);
  const parsed = parseRule(text);
  assert.ok(parsed.ok, `${what}: the blocks' text does not parse: ${parsed.ok ? "" : parsed.error.message}\n${text}`);
  const again = ruleFromBlocks(blocksOf(parsed.value));
  assert.ok(deepEqual(again, fromBlocks), `${what}: blocks → text → blocks changed the rule\n${text}`);
}

/** Every block in a tree, nested ones included. */
function allBlocks(bs: readonly Block[]): Block[] {
  return bs.flatMap((b) => [b, ...allBlocks(b.slots.flatMap((s) => [...(s.blocks ?? []), ...(s.modes ?? []).flatMap((m) => m.blocks)]))]);
}

// ── every row a card can use gets a block, with no code per row ─────────────
{
  const cardOps = (Object.keys(OP_SCHEMA) as Op["op"][]).filter((k) => !OP_SCHEMA[k].offCard);
  const cardConds = (Object.keys(COND_SCHEMA) as Cond["kind"][]).filter((k) => !CONDITIONS_OFF_A_CARD.includes(k));
  assert.deepEqual(thenChoices().map((c) => c.key), cardOps, "THEN lists every op a card can say, and no other");
  assert.deepEqual(ifChoices().map((c) => c.key), cardConds, "IF lists every condition a card can say, and no other");
  assert.deepEqual(whenChoices().map((c) => c.key), whenMoments(), "WHEN lists the game's own moments");
  assert.deepEqual(choicesFor("cost").map((c) => c.key), COST_SYNTAXES, "COST lists the price's items");
  assert.ok(thenChoices().every((c) => c.label && c.group), "every THEN choice has words and a heading");
  assert.ok(new Set(thenChoices().map((c) => c.group)).size > 3, "THEN is grouped by OP_CLASS");

  for (const op of cardOps) {
    const minimal = minimalInstance(op, "op", OP_SCHEMA[op]) as unknown as Op;
    const rule = ruleOf({ ops: [minimal] });
    const [block] = blocksOf(rule).ops;
    assert.equal(block.key, op);
    assert.equal(block.path, "ops[0]");
    // A blank per field, each with the control its field type names.
    assert.deepEqual(block.slots.map((s) => s.name), OP_SCHEMA[op].fields.map((f) => f.name), `${op}: a slot per field`);
    block.slots.forEach((s, i) => assert.equal(s.control, controlFor(OP_SCHEMA[op].fields[i].type), `${op}.${s.name}: control by field type`));
    trip(rule, `minimal ${op}`);
    assert.ok(opReading(minimal), `${op} reads as something`);
    // …and a block picked from the list starts as blanks: the required ones are "fill this" until filled.
    const picked = ruleOf({ ops: [blankOp(op)] });
    const blanks = problemsOf(picked, "auto").filter((p) => p.blank).map((p) => p.path);
    for (const f of OP_SCHEMA[op].fields.filter((f) => f.required && !["ops", "conds", "modes", "filter"].includes(f.type as string) && f.name !== "as"))
      assert.ok(blanks.includes(`ops[0].${f.name}`), `${op}: an empty required ${f.name} shows "fill this"`);
  }
  for (const kind of cardConds) {
    const minimal = minimalInstance(kind, "kind", COND_SCHEMA[kind]) as unknown as Cond;
    const rule = ruleOf({ cond: minimal });
    const block = blocksOf(rule).cond!;
    assert.equal(block.key, kind);
    assert.deepEqual(block.slots.map((s) => s.name), COND_SCHEMA[kind].fields.map((f) => f.name), `${kind}: a slot per field`);
    trip(rule, `minimal ${kind}`);
    assert.ok(condReading(minimal), `${kind} reads as something`);
  }
  // A template's blanks are fields of its own row.
  for (const op of cardOps) for (const f of templateFields(sentenceParts(OP_SCHEMA[op].sentence))) assert.ok(OP_SCHEMA[op].fields.some((x) => x.name === f), `${op}'s sentence names a field it does not have: ${f}`);
  assert.deepEqual(sentenceParts("KO {target}"), [{ text: "KO " }, { field: "target" }]);
  assert.deepEqual(sentenceParts("draw {n}{sumTo? whose {sumAttr} adds up}"), [{ text: "draw " }, { field: "n" }, { when: "sumTo", parts: [{ text: "whose " }, { field: "sumAttr" }, { text: " adds up" }] }]);
  assert.equal(sentenceParts(COND_SCHEMA.count.sentence), null, "a function sentence has no template");

  // Each price item has a spec, and a new one of each is a price that reads back as itself.
  for (const key of COST_SYNTAXES) {
    const cost = addCostItem(null, key);
    assert.deepEqual(costItems(cost).map((i) => i.key), [key], `${key}: one item`);
    trip(ruleOf({ cost }), `price item ${key}`);
    assert.ok(COST_ITEM_SPECS[key].fields.length >= 0);
  }
  // The search narrows by words, key or heading.
  assert.ok(searchChoices(thenChoices(), "draw").some((c) => c.key === "draw"));
  assert.ok(searchChoices(ifChoices(), "life").every((c) => `${c.key} ${c.label} ${c.group}`.toLowerCase().includes("life")));
}

// ── every rule the harness compiles, and every worked example, round-trips ──
let records = 0;
{
  const all: { rule: Rule; what: string }[] = [];
  for (const id of Object.keys(DEFS))
    for (const rec of skillRecords(DEFS[id])) all.push({ rule: { kind: rec.kind, trigger: rec.trigger as Trigger[], cost: rec.cost, cond: rec.cond, ops: rec.ops }, what: `record ${rec.cardId} [${rec.skillIndex}]` });
  const doc = fs.readFileSync(path.join(__dirname, "../../docs/arena-rules-language.md"), "utf8").replace(/\r\n/g, "\n");
  for (const m of doc.matchAll(/```\n(WHEN[\s\S]*?)```/g)) {
    const parsed = parseRule(m[1].replace(/\s+$/, ""));
    assert.ok(parsed.ok);
    all.push({ rule: parsed.value, what: `doc example ${m[1].split("\n")[0]}` });
  }
  for (const { rule, what } of all) {
    trip(rule, what);
    // No false alarm: a rule the validator accepts shows no problem at any block.
    if (!validateRule(rule, rule.kind)) assert.deepEqual(problemsOf(rule, rule.kind), [], `${what}: valid, yet the blocks show a problem`);
    // …and every block in it is addressable by its path.
    const b = blocksOf(rule);
    for (const blk of allBlocks([...b.trigger, ...(b.cost ?? []), ...(b.cond ? [b.cond] : []), ...b.ops])) assert.ok(blk.path, `${what}: a block with no path`);
    records++;
  }
  assert.ok(records > 50, `only ${records} rules were round-tripped through blocks`);
}

// ── the acceptance rules, built with taps ───────────────────────────────────
//
// Each step below is what a control does: pick from a list (`blankOp`,
// `blankCond`, `addCostItem`), set a blank (`setAt`), the selector's own parts
// (`setHowMany`, `setFilterField`). Nothing is typed but numbers on a stepper.

/** Tidecaller Oracle: "[Auto] When this card attacks, if there are 3 or more blue cards in your drop area, draw 1 card." — its IF, from the empty IF block. */
{
  let r = ruleOf({ trigger: ["attacks"] as Trigger[], ops: [{ op: "draw", n: 1 }] });
  assert.equal(blocksOf(r).cond, null, "the IF starts empty");
  r = { ...r, cond: blankCond("count") }; // IF: + add a condition → "count"
  assert.ok(problemsOf(r, "auto").some((p) => p.path === "cond.sel" && p.blank), "the empty selector is a 'fill this'");
  r = setAt(r, "cond.sel", setHowMany({}, "any")); // the selector blank, touched
  r = setAt(r, "cond.sel.side", "you"); // IN [you]
  r = setAt(r, "cond.sel.area", "drop"); // .[drop]
  r = setAt(r, "cond.sel.filter", setFilterField(undefined, "colors", ["Blue"])); // + narrow… → colors → Blue
  r = setAt(r, "cond.atLeast", 3); // at least [3]
  assert.deepEqual(problemsOf(r, "auto"), []);
  const reads = condReading(r.cond!);
  // `describeFilter` says an adjective-only filter without its noun ("3 or more blue in your drop"): the describer's own wording, reported on the PR rather than changed here (a language change is out of scope).
  assert.match(reads, /3 or more blue (cards )?in your drop/, `Tidecaller's IF reads "${reads}"`);
  assert.match(ruleReading(r), /attacks.*3 or more blue (cards )?in your drop.*draw 1/);
  trip(r, "Tidecaller Oracle");
}

/** Frost Sigil: "choose 1 of your opponent's Battle Cards with an energy cost of 4 or less, and switch its position" — `choose` + `switchMode` on `$t`, from the empty THEN block. */
{
  let r = ruleOf({ kind: "activate:main" });
  r = insertAt(r, "ops", 0, blankOp("choose", [])); // + add a step → choose
  assert.equal((r.ops[0] as { as: string }).as, "t", "a binding step gets a fresh name");
  r = setAt(r, "ops[0].sel", setHowMany({}, "count")); // [choose] [1]
  r = setAt(r, "ops[0].sel.side", "opponent");
  r = setAt(r, "ops[0].sel.area", "battle");
  let f = setFilterField(undefined, "type", "BATTLE");
  f = setFilterField(f, "costMax", 4);
  r = setAt(r, "ops[0].sel.filter", f);
  r = insertAt(r, "ops", 1, blankOp("switchMode", ["t"])); // + add a step → switchMode
  assert.ok(problemsOf(r, "activate:main").some((p) => p.path === "ops[1].target" && p.blank), "the target is a 'fill this'");
  assert.deepEqual(boundBefore(r, "ops[1].target"), ["t"], "the target blank offers $t, bound by the step before");
  assert.deepEqual(boundBefore(r, "ops[0].sel"), [], "a step does not offer its own binding to itself");
  r = setAt(r, "ops[1].target", { var: "t" });
  r = setAt(r, "ops[1].mode", "rest");
  assert.deepEqual(problemsOf(r, "activate:main"), []);
  const reads = ruleReading(r);
  assert.match(reads, /choose 1 .*battle card.*energy cost of 4 or less/i, reads);
  assert.match(reads, /switch .* to rest mode/i, reads);
  trip(r, "Frost Sigil");
}

/** `docs/arena-rules-language.md` §4: a price, a condition and a choice — built entirely from blocks, printed exactly as the doc prints it. */
{
  const want = `WHEN [activate:main]
COST {Red}{any}, IF leaderColor(color: Red)
IF life(you) <= 4
THEN
  choose(sel: 1 "battle card with an energy cost of 3 or less" IN opponent.battle, as: "t")
  ko(target: $t)`;
  const doc = fs.readFileSync(path.join(__dirname, "../../docs/arena-rules-language.md"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(doc.includes(want), "§4's worked example is still the one this builds");

  let r = ruleOf({ kind: "activate:main" });
  r = { ...r, cost: addCostItem(r.cost, "{Red}") }; // + add to the price → {Red}: arrives as one {any}
  r = { ...r, cost: editCostItem(r.cost, 0, { color: "Red", n: 1 }) }; // colour [Red]
  r = { ...r, cost: addCostItem(r.cost, "{Red}") }; // a second orb: {any}
  r = { ...r, cost: addCostItem(r.cost, "IF", { condition: blankCond("leaderColor") }) }; // + IF → leaderColor
  assert.ok(problemsOf(r, "activate:main").some((p) => p.path === "cost.condition.color" && p.blank), "the price's condition is a 'fill this' at its blank");
  r = setAt(r, "cost.condition.color", "Red");
  r = { ...r, cond: blankCond("life") }; // IF → life
  r = setAt(r, "cond.side", "you");
  r = setAt(r, "cond.atMost", 4);
  r = insertAt(r, "ops", 0, blankOp("choose", []));
  r = setAt(r, "ops[0].sel", setHowMany({}, "count"));
  r = setAt(r, "ops[0].sel.side", "opponent");
  r = setAt(r, "ops[0].sel.area", "battle");
  r = setAt(r, "ops[0].sel.filter", setFilterField(setFilterField(undefined, "type", "BATTLE"), "costMax", 3));
  r = insertAt(r, "ops", 1, blankOp("ko", ["t"]));
  r = setAt(r, "ops[1].target", { var: boundBefore(r, "ops[1].target")[0] });
  assert.deepEqual(problemsOf(r, "activate:main"), []);
  assert.equal(printRule(r), want, "the text view prints exactly §4's text");
  const parsed = parseRule(want);
  assert.ok(parsed.ok && deepEqual(parsed.value, r), "…and the text is the same rule");
  trip(r, "§4 worked example");
}

// ── problems sit at their blocks, and an invalid rule is never clean ────────
{
  const bad = ruleOf({
    trigger: ["noSuchMoment" as Trigger],
    cond: { kind: "count" } as unknown as Cond,
    ops: [{ op: "draw", n: 1 }, { op: "ko" } as unknown as Op, { op: "draw", n: { x: true } }],
  });
  const at = problemsOf(bad, "auto").map((p) => p.path);
  assert.ok(at.includes("trigger[0]"), "an unknown moment is the trigger's problem");
  assert.ok(at.includes("cond.sel"), "a condition missing its selector shows at the selector");
  assert.ok(at.includes("ops[1].target"), "a step missing its target shows at the target");
  assert.ok(at.includes("ops[2]") || at.includes("ops[2].n"), "X with nothing binding it shows at that step");
  assert.ok(!at.includes("ops[0]"), "a good step shows nothing");
  // Whatever the validator refuses, the blocks show somewhere: SAVE is disabled on `problems.length`.
  const refusedOnly = ruleOf({ kind: "auto", ops: [{ op: "draw", n: 1 }] });
  assert.ok(problemsOf(refusedOnly, "counter:play").length > 0, "a rule the validator refuses is never clean");
  // A price: an orb charged zero times.
  const zero = ruleOf({ cost: editCostItem(addCostItem(null, "{Red}"), 0, { color: "Red", n: 0 }) });
  assert.ok(problemsOf(zero, "auto").some((p) => p.path === "cost.orbs.Red"), "a bad orb shows at its item");
  // Nested: a step inside a `may`.
  const nested = ruleOf({ ops: [{ op: "may", ops: [{ op: "ko" } as unknown as Op] }] });
  assert.ok(problemsOf(nested, "auto").some((p) => p.path === "ops[0].ops[0].target"), "a nested blank shows at its own path");
}

// ── the selector's parts, the filter, the paths ─────────────────────────────
{
  for (const w of SELECTOR_FLAG_WORDS) {
    const on = setFlag({ side: "you", area: "battle" }, w, true);
    assert.ok(flagOn(on, w), `${w} toggles on`);
    assert.ok(!flagOn(setFlag(on, w, false), w), `${w} toggles off`);
    trip(ruleOf({ ops: [{ op: "choose", sel: on, as: "t" }] }), `flag ${w}`);
  }
  const sel: Selector = { side: "you", area: "deck" };
  for (const how of ["count", "upTo", "take", "all", "any"] as const) assert.equal(howMany(setHowMany(sel, how)), how, `how many: ${how}`);
  const f = setFilterField(undefined, "colors", ["Red"]);
  assert.deepEqual(filterFieldsSet(f), ["colors"]);
  assert.deepEqual(filterFieldsSet(setFilterField(f, "colors", undefined)), [], "a dropped field is back at rest");

  const r = ruleOf({ ops: [{ op: "draw", n: 1 }, { op: "draw", n: 2 }] });
  assert.deepEqual(moveAt(r, "ops[1]", -1).ops.map((o) => (o as { n: number }).n), [2, 1]);
  assert.deepEqual(removeAt(r, "ops[0]").ops, [{ op: "draw", n: 2 }]);
  assert.equal(r.ops.length, 2, "edits never touch the rule they started from");
  assert.equal(openingFocus(r, "ops[1]", []), "ops[1]");
  assert.equal(openingFocus(r, "nonsense[", []), null, "a bad path is never trusted");
  assert.equal(openingFocus(r, null, ["if there are 3 or more blue cards in your drop area"]), "cond", "an unread condition opens IF");
  assert.equal(openingFocus(r, null, ["draw 1 card"]), "ops");
}

// ── the four rule-writing actions refuse a non-admin ────────────────────────
{
  // `isAdminUser` (the decision) is proved in `arena-admin.ts`; what is proved
  // here is that each of the four actions asks it before it touches a row.
  const src = fs.readFileSync(path.join(__dirname, "../../src/app/arena/actions.ts"), "utf8");
  for (const name of ["saveRuleAction", "confirmRuleAction", "blankRuleAction", "confirmAllAction"]) {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${name} is gone`);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    const guard = body.indexOf("if (!(await isArenaAdmin())) return { error: RULES_ADMINS_ONLY");
    assert.ok(guard > 0, `${name} does not refuse a non-admin`);
    for (const touch of ["ruleById(", "confirmMatching(", "readFilter("]) {
      const at = body.indexOf(touch);
      if (at >= 0) assert.ok(guard < at, `${name} reads the database before it checks the login`);
    }
  }
}

console.log(`blocks: ok — ${thenChoices().length} steps, ${ifChoices().length} conditions, ${COST_SYNTAXES.length} price items; ${records} rules round-tripped through blocks`);

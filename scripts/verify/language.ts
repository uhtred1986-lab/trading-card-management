/**
 * The effect language as one table, the drafter's records, and the engine
 * reading rows and nothing else.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stateText } from "../../src/lib/arena/ai/view";
import { TRIGGERS } from "../../src/lib/arena/gaps";
import { COST_ITEMS, FILTER_FIELDS, SELECTOR_FIELDS } from "../../src/lib/arena/lang/ast";
import { languageReference } from "../../src/lib/arena/lang/reference";
import { SELECTOR_FLAGS } from "../../src/lib/arena/lang/parse";
import {
  COND_CLASS,
  COND_SCHEMA,
  CTX,
  DEFS,
  EFFECT_LANGUAGE,
  OP_CLASS,
  OP_SCHEMA,
  apply,
  arena,
  canonical,
  card,
  cardNow,
  clauseShape,
  compileSkill,
  condSignature,
  describeCond,
  describeScript,
  describeTrigger,
  find,
  hoist,
  keywordPlays,
  matches,
  mechanismOf,
  opSignature,
  parseFilter,
  parseSkills,
  patternKey,
  powerOf,
  programShape,
  skillRecords,
  triggersOf,
  validate,
} from "./harness";
import type { CardFilter, SchemaOp } from "./harness";

// ── OP_SCHEMA: one definition of the effect language, read by everyone ──────
{
  // The type `Record<Op["op"], OpSpec>` already forces a row per op; this is
  // the runtime half: every row's sentence renders for a minimal op built from
  // its own required fields, so a row cannot be a placeholder.
  const sample = (t: unknown): unknown => {
    if (typeof t === "object" && t !== null) return "enum" in (t as object) ? (t as { enum: readonly string[] }).enum[0] : [];
    return {
      amount: 1,
      ref: { sel: { special: "self" } },
      selector: { side: "you", area: "battle", count: 1 },
      side: "you",
      area: "drop",
      duration: "turn",
      cond: { kind: "isTurnPlayer" },
      ops: [{ op: "draw", n: 1 }],
      string: "x",
      number: 1,
      boolean: true,
      keyword: { name: "Blocker" },
      filter: undefined,
      modes: [{ label: "a", ops: [{ op: "draw", n: 1 }] }],
    }[t as string];
  };
  for (const [name, spec] of Object.entries(OP_SCHEMA)) {
    const op: Record<string, unknown> = { op: name };
    for (const f of spec.fields) if (f.required) op[f.name] = sample(f.type);
    assert.equal(validate([op]), true, `a minimal ${name} validates`);
    if (name !== "note") assert.ok(describeScript([op as unknown as SchemaOp]).length > 0, `${name} has a sentence`);
    assert.match(opSignature(name as SchemaOp["op"]), new RegExp(`^\\{"op":"${name}"`), `${name} has a signature for the referee`);
  }
  // The validator reads the rows: a missing required field, a value outside an
  // enum and an unknown op are all refused; optional fields may be left out.
  assert.equal(validate([{ op: "ko" }]), false, "ko needs a target");
  assert.equal(validate([{ op: "delay", at: "never", ops: [] }]), false, "a delay timing the engine never drains is refused");
  assert.equal(validate([{ op: "delay", at: "turnEnd", scope: "someday", ops: [] }]), false);
  assert.equal(validate([{ op: "delay", at: "turnEnd", ops: [{ op: "ko", target: { var: "t" } }] }]), true);
  assert.equal(validate([{ op: "forbid", what: "fly", until: "turn" }]), false, "an unknown prohibition is refused");
  assert.equal(validate([{ op: "forbid", what: "attack", until: "turn", target: { var: "t" } }]), true);
  assert.equal(validate([{ op: "forbid", what: "attack", until: "turn", uses: 1, unless: { kind: "isTurnPlayer", who: "opponent" } }]), true);
  assert.equal(validate([{ op: "token", name: "Saibaman", power: 10000, comboCost: null, comboPower: null, colors: [], n: 1 }]), true, "null is a value where the schema says so");
  assert.equal(validate([{ op: "token", name: "Saibaman", power: 10000, colors: [], n: 1 }]), false, "…but leaving it out is not");
  assert.equal(validate([{ op: "chooseMode", modes: [] }]), false, "a modal choice with no options");
  assert.equal(validate([{ op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "nope" }] }]), false, "nested programs are checked too");
  assert.equal(validate([{ op: "draw", n: 1, side: "them" }]), false, "a side the engine does not know");
  // The shapes the referee gets wrong most: a bare selector where a ref belongs, an empty ref, a special the engine does not know, a condition without a kind.
  assert.equal(validate([{ op: "ko", target: { special: "self" } }]), false, "a selector is not a ref — two of three BT18 reviews died describing this");
  assert.equal(validate([{ op: "ko", target: {} }]), false);
  assert.equal(validate([{ op: "ko", target: { sel: { special: "self" } } }]), true);
  assert.equal(validate([{ op: "ko", target: { sel: { special: "myself" } } }]), false);
  assert.equal(validate([{ op: "if", cond: { atLeast: 2 }, then: [] }]), false, "a condition needs a kind");
  // The renderer reads the same rows: templates, hints and conditional segments.
  assert.equal(describeScript([{ op: "draw", n: 1, side: "opponent" }]), "opponent draws 1");
  assert.equal(describeScript([{ op: "discard", n: 1, to: "warp" }]), "discard 1 to the Warp");
  assert.equal(describeScript([{ op: "hidden", target: { var: "t" }, hidden: false }]), "switch the chosen cards to Revealed Mode");
  assert.equal(describeScript([{ op: "faceUp", target: { var: "t" } }]), "turn the chosen cards face up", "a default fills an absent field");
  assert.equal(describeScript([{ op: "negateSkillsOfKind", target: { var: "t" }, kind: "auto", until: "turn" }]), "negate the [Auto] skills of the chosen cards for the turn");
  assert.equal(describeScript([{ op: "power", target: { var: "t" }, amount: { count: { side: "you", area: "battle", count: 99 }, times: 5000 }, until: "battle" }]), "the chosen cards +5000 power for each of your Battle Cards for the battle");
  assert.equal(describeScript([{ op: "if", cond: { kind: "isTurnPlayer" }, then: [], else: [{ op: "draw", n: 1 }] }]), "if it is your turn: nothing, otherwise draw 1");
  assert.equal(describeScript([{ op: "may", ops: [{ op: "draw", n: 1 }], chooser: "opponent" }]), "your opponent may: draw 1");
  assert.equal(describeScript([{ op: "forbid", what: "attack", until: "turn", side: "opponent", uses: 1 }]), "your opponent can't attack once more for the turn");
  assert.equal(describeScript([{ op: "forbid", what: "play", until: "turn", side: "opponent", unless: { kind: "count", sel: { side: "opponent", area: "energy", count: 99 }, atLeast: 3 } }]), "your opponent can't play cards unless there are 3 or more cards in opponent's energy for the turn");
  assert.equal(describeScript([{ op: "note", text: "x" }, { op: "shuffle" }]), "shuffle", "a note says nothing");
  assert.equal(opSignature("ko"), '{"op":"ko","target":TARGET}');
  assert.equal(opSignature("negateAttack"), '{"op":"negateAttack"}');
  assert.match(opSignature("draw"), /"side"\?:"you"\|"opponent"/, "an optional field is marked");
}

// ── primitive or macro: the spec's table is the code's table ───────────────
//
// The decision for every row of the language is written twice on purpose:
// `docs/arena-ruleset-spec.md` §2 carries the reason a person reads, and
// `OP_CLASS`/`COND_CLASS` carry the decision the code reads. The `Record`
// types already force a row per op and per condition; this is the other half.
// A row added to the schema and not to the document — or classified one way
// in the table and another in the code — fails here rather than being found
// a stage later, when Stage 3 is writing the macro that was never decided.
{
  const doc = fs.readFileSync(path.join(__dirname, "../../docs/arena-ruleset-spec.md"), "utf8").replace(/\r\n/g, "\n");
  const section = (from: string, to: string) => {
    const start = doc.indexOf(from);
    const end = doc.indexOf(to, start + 1);
    assert.ok(start >= 0 && end > start, `${from} is missing from the ruleset spec`);
    return doc.slice(start, end);
  };
  /** The rows of one table, as name → the class column, exactly as written. */
  const table = (text: string): Record<string, string> =>
    Object.fromEntries([...text.matchAll(/^\| `([A-Za-z]+)` \| (primitive|macro over [^|]+?) \| [^|]+ \|$/gm)].map((m) => [m[1], m[2]]));

  for (const [what, written, decided] of [
    ["OP_CLASS", table(section("### 2.3 The operations", "### 2.4")), OP_CLASS as Record<string, string>],
    ["COND_CLASS", table(section("### 2.4 The conditions", "### 2.5")), COND_CLASS as Record<string, string>],
  ] as const) {
    assert.deepEqual(Object.keys(written).sort(), Object.keys(decided).sort(), `${what}: the spec §2 and the code classify the same rows`);
    for (const [name, cls] of Object.entries(written)) assert.equal(decided[name], cls, `${what}: the spec and the code disagree about ${name}`);
  }
  // …and every primitive a row lowers to is one §2.2 names, so "macro over
  // `move`" cannot point at a word the document never explains.
  const vocabulary = section("### 2.2 The primitive vocabulary", "### 2.3");
  for (const cls of [...Object.values(OP_CLASS), ...Object.values(COND_CLASS)])
    for (const [, target] of cls.matchAll(/`([A-Za-z]+)`/g)) assert.ok(vocabulary.includes(`| \`${target}\``), `§2.2 does not list the primitive \`${target}\``);
}

// ── COND_SCHEMA: the other half of the language, in the same one table ──────
{
  const sample = (t: unknown): unknown => {
    if (typeof t === "object" && t && "enum" in t) return (t as { enum: readonly string[] }).enum[0];
    return { selector: { side: "you", area: "battle", count: 1 }, side: "you", number: 1, boolean: true, string: "t", filter: parseFilter("red card"), cond: { kind: "isTurnPlayer" }, conds: [{ kind: "isTurnPlayer" }] }[t as string];
  };
  for (const [kind, spec] of Object.entries(COND_SCHEMA)) {
    const cond: Record<string, unknown> = { kind };
    for (const f of spec.fields) if (f.required) cond[f.name] = sample(f.type);
    assert.equal(validate([{ op: "if", cond, then: [] }]), true, `a minimal ${kind} validates`);
    assert.ok(describeCond(cond as unknown as Parameters<typeof describeCond>[0]).length > 0, `${kind} has a sentence`);
  }
  // The validator reads the rows here too — before this it asked only for a
  // `kind`, so a count with nothing to count was stored and threw in a game.
  assert.equal(validate([{ op: "if", cond: { kind: "count", atLeast: 2 }, then: [] }]), false, "a count needs the selector it counts");
  assert.equal(validate([{ op: "if", cond: { kind: "count", sel: { side: "you", area: "drop", count: 99 }, atLeast: 2 }, then: [] }]), true);
  assert.equal(validate([{ op: "if", cond: { kind: "life", side: "them", atMost: 4 }, then: [] }]), false, "a side the engine does not know");
  assert.equal(validate([{ op: "if", cond: { kind: "did", what: "shuffle" }, then: [] }]), false, "…and a question it never asks");
  assert.equal(validate([{ op: "if", cond: { kind: "any", conds: [] }, then: [] }]), false, "one of nothing is nothing");
  assert.equal(validate([{ op: "if", cond: { kind: "any", conds: [{ kind: "isTurnPlayer" }, { kind: "nope" }] }, then: [] }]), false, "nested conditions are checked too");
  assert.equal(validate([{ op: "if", cond: { kind: "not", cond: { kind: "isTurnPlayer" } }, then: [] }]), true);
  // …and the sentences are the ones the workbench and the log printed before.
  assert.equal(describeCond({ kind: "count", sel: { side: "you", area: "drop", count: 99, filter: parseFilter("{Angel Halo}") }, atLeast: 2 }), "there are 2 or more {Angel Halo} in your drop");
  assert.equal(describeCond({ kind: "count", sel: { side: "opponent", area: "battle", count: 99 }, atMost: 0 }), "there are no cards in opponent's battle", "the noun the selector had nothing to say about is put back");
  assert.equal(describeCond({ kind: "isTurnPlayer", who: "opponent" }), "it is your opponent's turn");
  assert.equal(describeCond({ kind: "did", what: "may" }), "the offer was taken");
  assert.equal(describeCond({ kind: "all", conds: [{ kind: "isTurnPlayer" }, { kind: "life", side: "you", atMost: 4 }] }), "it is your turn and your life is 4 or less");

  // The referee is told the language off the same rows, so a kind the
  // interpreter learns reaches Claude the moment it has one.
  for (const kind of Object.keys(COND_SCHEMA)) {
    assert.match(condSignature(kind as Parameters<typeof condSignature>[0]), new RegExp(`^\\{"kind":"${kind}"`), `${kind} has a signature for the referee`);
    assert.ok(EFFECT_LANGUAGE.includes(`"kind":"${kind}"`), `${kind} is in the language Claude is given`);
  }
  assert.equal(condSignature("isTurnPlayer"), '{"kind":"isTurnPlayer","who"?:"you"|"opponent"}');
  assert.equal(condSignature("battled"), '{"kind":"battled","sel":SELECTOR}');
  // The two mistakes the BT18 reviews made, answered in the legend rather
  // than left for the validator to catch afterwards.
  assert.ok(EFFECT_LANGUAGE.includes('a card *name* — "names", never "characters"'), "{Angel Halo} is a name, not a character");
  assert.ok(EFFECT_LANGUAGE.includes("is a CONDITION"), "and your opponent's turn is a condition, not a duration");
}

// ── the drafter: card text → one record per skill, ready for a person ────────
{
  const d = card("DRAFTED", {
    type: "LEADER",
    skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it.<br>[Blocker]<br>[Permanent] If your Leader is red, this card gets +5000 power.<br>[Activate: Main] {r}{r}, Once per turn: Draw 1 card.",
    back: { name: "DRAFTED (awakened)", power: 20000, skill: "[Auto] When this card attacks, draw 1 card." },
  });
  const recs = skillRecords(d);
  // [Blocker] alone is a rule the engine plays natively, so there is nothing to confirm about it.
  assert.deepEqual(
    recs.map((r) => `${r.side}#${r.skillIndex}:${r.kind}`),
    ["front#0:auto", "front#20:permanent", "front#30:activate:main", "back#0:auto"],
  );
  const play = recs[0];
  assert.deepEqual(play.trigger, ["played"], "the WHEN line comes from the same matcher the engine pends with");
  assert.equal(describeTrigger(play.trigger), "when this card is played");
  assert.equal(play.unread.length, 0);
  assert.equal(play.pattern, "choose→ko", "drafts group by the shape of what the compiler produced");
  assert.equal(play.reads, "choose up to 1 in opponent's battle, KO the chosen cards");
  // What the selector picks is part of the reading: two cards phrased alike
  // are told apart by their filter, and the worklist used to hide it.
  assert.equal(
    describeScript(compileSkill(parseSkills("[Auto] When you play this card, choose up to 1 blue ≪Another World Budokai≫ card in your Warp and place it in your Drop Area.")[0]).ops),
    "choose up to 1 blue ≪Another World Budokai≫ in your warp, move the chosen cards to drop",
  );
  assert.equal(describeScript([{ op: "choose", sel: { side: "opponent", area: "battle", count: 1, mode: "rest" }, as: "t" }]), "choose 1 in opponent's battle in rest mode");
  assert.equal(play.cost, null);
  // A program that is one wrapping `if` is shown as IF + DO; the reading still covers the whole thing.
  const perm = recs[1];
  assert.equal(perm.cond?.kind, "leaderMatches", "the wrapping if is hoisted into IF");
  assert.equal(perm.ops.length, 1);
  assert.equal(perm.reads, "if your leader is Red: this card +5000 power", "…and the reading still covers the whole program");
  assert.equal(perm.trigger.length, 0, "a [Permanent] has no trigger");
  // The price before the colon is read into the record without a game state.
  const act = recs[2];
  assert.deepEqual(act.cost?.orbs, { Red: 2 });
  assert.equal(act.cost?.text, "Once per turn", "the orbs come off the price text; the limit stays in it");
  assert.equal(act.printed.startsWith("[Activate: Main]"), true, "the printed line is the whole line, tags included");
  assert.deepEqual(recs[3].trigger, ["attacks"]);
  assert.deepEqual(hoist([{ op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "draw", n: 1 }], else: [] }]).cond, { kind: "isTurnPlayer" }, "an empty else is still no else");
  assert.equal(hoist([{ op: "if", cond: { kind: "isTurnPlayer" }, then: [], else: [{ op: "draw", n: 1 }] }]).cond, null, "an if with an else keeps its shape");
  assert.equal(programShape([{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "t" }, { op: "delay", at: "turnEnd", ops: [{ op: "ko", target: { var: "t" } }] }]), "choose→delay:turnEnd[ko]");
  assert.equal(programShape([{ op: "forbid", what: "attack", until: "turn", target: { var: "t" } }, { op: "grant", target: { var: "t" }, keyword: { name: "Blocker" }, until: "turn" }]), "forbid:attack→grant:Blocker");
  // Open rows group by the shape of the first unread clause; the mechanism says what it would take.
  const unread = card("UNREAD", { skill: "[Auto] When you play this card, your opponent skips their next Charge Phase." });
  const [u] = skillRecords(unread);
  assert.equal(u.unread.length > 0, true);
  assert.equal(u.pattern, clauseShape(u.unread[0]));
  assert.equal(mechanismOf("skip your next charge phase"), "turn structure");
  assert.equal(mechanismOf("your opponent skips their next Charge Phase"), "turn structure", "the way cards actually phrase it");
  assert.equal(mechanismOf("choose 1 <Frieza> card in your hand"), "phrasing only");
  assert.equal(clauseShape("Choose up to 2 of your opponent's <Son Goku> cards with 15000 power"), "choose up to N of your opponent's … cards with N power");
  // Keyword skills that carry a trigger of their own are pended by it.
  const revenge = parseSkills("[Revenge] When this card is attacked, draw 1 card.")[0];
  assert.equal(triggersOf(revenge).includes("attacked"), true);
  // What the drafter compares: jsonb's key order and its dropped `undefined`s
  // are not changes — the first full draft run rewrote 8,341 rows because they were.
  assert.equal(JSON.stringify(canonical({ b: 1, a: { mode: undefined, side: "you" } })), JSON.stringify(canonical({ a: { side: "you" }, b: 1 })));
  assert.notEqual(JSON.stringify(canonical({ a: null })), JSON.stringify(canonical({})), "an explicit null is a value");

  // A skill with no unread text and no program is not "nothing": the keyword
  // is the rule the engine plays, and the record has to say which one.
  const stack = card("STACKED", { type: "LEADER", skill: "[Z-Stack 1] Yellow <Son Goku> with an energy cost of 2." });
  const [z] = skillRecords(stack);
  assert.deepEqual([z.ops.length, z.unread.length], [0, 0], "the specification text compiles to no steps");
  assert.equal(z.pattern, "keyword:Z-Stack", "…so it groups by the keyword that plays it");
  assert.equal(keywordPlays("Z-Stack")?.tag, "[Z-Stack X]", "and the record can say what the engine does with it");
  assert.equal(keywordPlays("Not A Keyword"), null);
  assert.equal(patternKey({ keyword: null }, [], []), "nothing", "and a skill that really is empty groups with the others that are");
}

// A filter written by hand or by Claude carries only the fields it means; the
// engine fills it up rather than crashing on the first `.some` — the fuzzer's
// two crashes in the first row-backed run were one such row (BT31-132).
{
  const sparse = { colors: ["Red"], traits: ["Saiyan"] } as unknown as CardFilter;
  assert.equal(matches(DEFS.V1, sparse), false, "V1 is red but not a Saiyan");
  assert.equal(matches({ ...DEFS.V1, traits: ["Saiyan"] }, sparse), true);
  const ctx = { defs: DEFS, scripts: { KILLER: { bySkill: { 0: { ops: [{ op: "choose", sel: { side: "opponent", area: "battle", count: 1, filter: sparse }, as: "t" }, { op: "ko", target: { var: "t" } }], unsupported: [] } }, complete: true, unsupported: [] } } };
  const s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE", "V1"] });
  const r = apply(ctx as never, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "KILLER") });
  assert.notEqual(r.state.prompt.kind, "gameOver");
  void r;
}

// ── modifyAttr: the primitive plays as the spellings it stands under ────────
//
// `docs/arena-ruleset-spec.md` §2.3 says `power`, `comboPower` and `gains`
// are one mechanism. That is only true if a rule written either way lands in
// the same place, so it is asserted here rather than argued in the document:
// the same board, the same skill, two programs, one answer. Three paths,
// because the mechanism has three — a skill that resolves, and the static
// layer's two halves (a number while the card is in play, a list in every
// area).
{
  const rule = (name: string, ops: unknown) => ({ defs: DEFS, scripts: { [name]: { bySkill: { 0: { ops, unsupported: [] } }, complete: true, unsupported: [] } } }) as never;
  const yourBattle = { sel: { side: "you", area: "battle", count: 99 } };

  // Resolving: an [Auto] that pumps your Battle Cards when it is played.
  const played = (ops: unknown) => {
    const ctx = rule("DRAWER", ops);
    const s = arena({ hand: ["DRAWER"], energy: ["V1"], battle: ["V1"] });
    const target = find(s, "p1", "battle", "V1");
    const r = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DRAWER") });
    return powerOf(ctx, r.state, target);
  };
  const spelled = played([{ op: "power", target: yourBattle, amount: 5000, until: "turn" }]);
  assert.equal(spelled, 15000, "the `power` op still pumps");
  assert.equal(played([{ op: "modifyAttr", target: yourBattle, attr: "power", amount: 5000, until: "turn" }]), spelled, "modifyAttr(power) is the same continuous effect");

  // The static layer, for a [Permanent] that never resolves.
  const aura = (ops: unknown) => {
    const ctx = rule("AURA", ops);
    const s = arena({ battle: ["AURA", "V1"] });
    return { ctx, s, v1: find(s, "p1", "battle", "V1") };
  };
  const power = aura([{ op: "modifyAttr", target: yourBattle, attr: "power", amount: 5000, until: "game" }]);
  assert.equal(powerOf(power.ctx, power.s, power.v1), 15000, "…and the same aura from the static layer");

  // A list attribute is read wherever the card is, which is what `gains` says.
  const gained = aura([{ op: "gains", target: yourBattle, traits: ["Saiyan"] }]);
  const counts = aura([{ op: "modifyAttr", target: yourBattle, attr: "traits", values: ["Saiyan"] }]);
  assert.deepEqual(cardNow(counts.ctx, counts.s, counts.v1).traits, cardNow(gained.ctx, gained.s, gained.v1).traits, "modifyAttr(traits) is `gains`");
  assert.ok(cardNow(counts.ctx, counts.s, counts.v1).traits.includes("Saiyan"), "…and both of them gained it");
}

// ── the engine reads rows and nothing else ───────────────────────────────────
{
  // The same card, the same play, two contexts: with rules it draws, without
  // any it is played as blank — and the log says so rather than staying quiet.
  const bare = { defs: DEFS };
  let s = arena({ hand: ["DRAWER"], energy: ["V1"] });
  const hand = s.players.p1.hand.length;
  const r = apply(bare, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DRAWER") });
  assert.equal(r.state.players.p1.hand.length, hand - 1, "nothing was drawn: the card has no rule");
  assert.ok(r.events.some((e) => e.type === "note" && /no rule stored — played as blank/.test(e.text)), "and the log names the gap");
  s = arena({ hand: ["DRAWER"], energy: ["V1"] });
  assert.equal(apply(CTX, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DRAWER") }).state.players.p1.hand.length, hand, "with its rule it draws");
  // A [Permanent] is read from the same rows — the static layer compiles nothing.
  const t = arena({ battle: ["AURA", "V1"] });
  assert.equal(powerOf(bare, t, find(t, "p1", "battle", "V1")), 10000, "no rules, no aura");
  assert.equal(powerOf(CTX, t, find(t, "p1", "battle", "V1")), 15000, "the aura holds from its row");
}

// ── the generated language reference: exactly the schemas, nothing hand-kept ─
//
// `/arena/rules/language` (`src/app/arena/rules/language/page.tsx`) reads
// `languageReference()` and nothing else, so this checks that the function's
// own promise holds: every row is the schema's row, not a copy of it that
// could drift.
{
  const ref = languageReference();
  assert.deepEqual(ref.ops.map((o) => o.name).sort(), Object.keys(OP_SCHEMA).sort(), "every op in OP_SCHEMA has a row, and no other");
  assert.deepEqual(ref.conds.map((c) => c.kind).sort(), Object.keys(COND_SCHEMA).sort(), "every condition in COND_SCHEMA has a row, and no other");
  for (const op of ref.ops) if (op.name !== "note") assert.ok(op.sentence.length > 0, `${op.name}'s reference row has a worked sentence`);
  for (const cond of ref.conds) assert.ok(cond.sentence.length > 0, `${cond.kind}'s reference row has a worked sentence`);
  assert.deepEqual(ref.selectorFields.map((f) => f.field).sort(), Object.keys(SELECTOR_FIELDS).sort());
  assert.deepEqual(ref.selectorFlags.map((f) => f.word).sort(), Object.keys(SELECTOR_FLAGS).sort());
  assert.deepEqual(ref.filterFields.map((f) => f.field).sort(), Object.keys(FILTER_FIELDS).sort());
  assert.deepEqual(
    ref.triggers.map((t) => t.name),
    TRIGGERS,
    "the trigger vocabulary is validateRule's own list, in its own order",
  );
  assert.equal(ref.costItems.length, COST_ITEMS.length);
  // Every op's and condition's referee shape still opens with its own name —
  // the same promise `opSignature`/`condSignature` already assert on their own.
  for (const op of ref.ops) assert.match(op.signature, new RegExp(`^\\{"op":"${op.name}"`));
  for (const cond of ref.conds) assert.match(cond.signature, new RegExp(`^\\{"kind":"${cond.kind}"`));
}

// ── what Claude is told, kept ───────────────────────────────────────────────
//
// The referee's language and the board as the opponent reads it are prose
// built in code. While that prose moves out of code and into the game's
// definition (`docs/arena-ruleset-spec.md`), byte-equality with these
// fixtures is what proves the move changed nothing Claude sees — and, for
// `language-reference.txt`, nothing the text view's player-facing reference
// says either. Run `npm run contract:emit` to accept a deliberate change.
{
  const s = arena({ hand: ["V1", "BIG"], battle: ["BLOCKER"], energy: ["V1", "V-BLUE"], oppBattle: ["V-BLUE"], oppHand: ["KILLER"] });
  const fixtures: Record<string, string> = {
    "effect-language.txt": EFFECT_LANGUAGE,
    "state-text.txt": stateText(CTX, s, "p1"),
    "language-reference.txt": `${JSON.stringify(languageReference(), null, 2)}\n`,
  };
  const dir = path.join(process.cwd(), "contract", "fixtures");
  const emit = process.argv.includes("--emit");
  for (const [name, text] of Object.entries(fixtures)) {
    const file = path.join(dir, name);
    if (emit) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text);
      continue;
    }
    assert.ok(fs.existsSync(file), `contract/fixtures/${name} is missing — run \`npm run contract:emit\``);
    assert.equal(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), text.replace(/\r\n/g, "\n"), `what Claude is told has changed (contract/fixtures/${name}). If that is deliberate, run \`npm run contract:emit\` and review the diff.`);
  }
}

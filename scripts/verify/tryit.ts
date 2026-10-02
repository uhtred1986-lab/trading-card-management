/**
 * Try it → fix it (#470): the rule being built, tried on boards made from its
 * condition, judged, and every wrong row pointing at its block.
 *
 * Pure: the probe on the two engines and nothing else — no database (the
 * stored half, `card_rules.expectations` and `arena:reprobe`'s "expected X,
 * now Y", is in `verify-db.mts`). Part of `npm test`, run on its own.
 *
 * The rules are written the way the block builder hands them over: a `Rule`
 * in the language (`parseRule`), not yet saved anywhere.
 */
import assert from "node:assert/strict";
import { DEFAULT_ENGINE, FALLBACK_ENGINE } from "../../src/lib/arena/engines";
import { parseRule, type Rule } from "../../src/lib/arena/lang";
import { resolvePath } from "../../src/lib/arena/lang/path";
import { skillRecords } from "../../src/lib/arena/draft";
import { probe, scenariosFor, type ProbeRule } from "../../src/lib/arena/probe";
import { edgeScenarios, keyOf, ruleViewOf, splitKey } from "../../src/lib/arena/probe-edges";
import { expectationMismatches, fixPath, judge, ownLines, probeRuleOf, tryRule, type Expectation, type TryResult, type TryRow } from "../../src/lib/arena/tryit";
import type { CardDef } from "../../src/lib/arena/types";

const def = (id: string, name: string, skill: string, o: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  type: "BATTLE",
  colors: ["Blue"],
  energyCost: 2,
  zEnergyCost: null,
  power: 15000,
  comboCost: 1,
  comboPower: 5000,
  skill,
  characters: [name],
  traits: [],
  ...o,
});

function rule(src: string): Rule {
  const p = parseRule(src);
  if (!p.ok) throw new Error(`${p.error.message}\n${src}`);
  return p.value;
}

const row = (r: TryResult, title: string): TryRow => {
  const found = r.rows.find((x) => x.title === title);
  assert.ok(found, `a board titled "${title}" — got ${r.rows.map((x) => `"${x.title}"`).join(", ")}`);
  return found;
};

/** What the panel stores on ✓: the run as it is, as what should happen. */
const right = (x: TryRow): Expectation => ({
  key: x.key,
  title: x.title,
  expected: x.rules.fires ? "fired" : "didNotFire",
  verdict: "right",
  headline: x.rules.headline,
  applied: ownLines(x.rules).map((b) => b.line),
  engine: DEFAULT_ENGINE,
  at: "2026-10-02",
});

// ── Tidecaller Oracle: the IF built in the builder, not saved ──────────────

const TIDECALLER = def("T-TIDE", "Tidecaller Oracle", "[Auto] When this card attacks, if there are 3 or more blue cards in your drop area, draw 1 card.");
const tide = (cmp: string) => probeRuleOf(rule(`WHEN [auto] attacks\nIF count("blue card" IN you.drop) ${cmp}\nTHEN\n  draw(n: 1)`), TIDECALLER, "front", 0);
const THREE = "Attacks · 3 blue cards in your drop area";
const TWO = "Attacks · 2 blue cards in your drop area";

{
  const tried = tryRule(tide(">= 3"));
  assert.equal(tried.engines.main, "rules", "Try it plays on the engine games use");
  const three = row(tried, THREE);
  const two = row(tried, TWO);
  assert.equal(three.rules.headline, "draws 1", `3 blue cards → draws 1: ${three.rules.result.join(" | ")}`);
  assert.equal(three.rules.outcome, "fired");
  assert.equal(two.rules.headline, "nothing", `2 blue cards → nothing: ${two.rules.result.join(" | ")}`);
  assert.equal(two.rules.outcome, "didNotFire", "an [Auto] whose IF is false did not fire, though it announced itself");
  // The default attack board stages no blue card at all, and says so in the
  // same words; the edge pair comes after it, so a stored probe's board 0 is
  // still the one it always was.
  assert.equal(tried.rows[0].key, "attack");
  assert.ok(three.rules.input.includes("3 blue cards in your drop area"), three.rules.input.join(" | "));

  // ✓ on both, then the IF turned round: both rows go red on their own, and
  // Fix on either opens the IF.
  const judged = [right(three), right(two)];
  const keys = judged.map((e) => e.key);
  const statusOf = (r: TryResult, e: Expectation) => {
    const x = r.rows.find((y) => y.key === e.key);
    assert.ok(x, `the judged board ${e.key} is still tried`);
    return { x, status: judge(x.rules, e) };
  };
  const fewer = tryRule(tide("<= 2"), keys);
  for (const e of judged) {
    const { x, status } = statusOf(fewer, e);
    assert.equal(status, "mismatch", `"${e.title}" goes red with the IF reading "2 or fewer"`);
    assert.equal(fixPath(x, e), "cond", `Fix on "${e.title}" opens the IF block`);
  }
  // "3 or fewer" — the comparison turned and the number kept — still draws
  // on 3, which is right; it is the 2-card board that catches it.
  const flipped = tryRule(tide("<= 3"), keys);
  assert.equal(statusOf(flipped, judged[1]).status, "mismatch", "3 or fewer fires on 2 blue cards, which was judged a no");
  assert.equal(fixPath(statusOf(flipped, judged[1]).x, judged[1]), "cond");
  // Set back, no save in between: both green.
  const back = tryRule(tide(">= 3"), keys);
  for (const e of judged) assert.equal(statusOf(back, e).status, "match", `"${e.title}" is green again`);

  // ✗ "should not fire" on a row that fired, and "should fire" on one that
  // did not: the first opens the block behind the announcement, the second
  // the gate that stopped it.
  assert.equal(fixPath(three, { ...right(three), expected: "didNotFire", verdict: "wrong" }), "cond");
  assert.equal(fixPath(two, { ...right(two), expected: "fired", verdict: "wrong" }), "cond");
  assert.equal(two.gate?.clause, "IF");
  assert.match(two.gate?.reasons[0] ?? "", /IF did not hold/);
}

// ── A changed board is one more row ─────────────────────────────────────────

{
  const r = tide(">= 3");
  const five = keyOf("attack", { cond: 5 });
  const none = keyOf("attack", { cond: 0 });
  const tried = tryRule(r, [five, none]);
  const at5 = tried.rows.find((x) => x.key === five);
  const at0 = tried.rows.find((x) => x.key === none);
  assert.ok(at5 && at0, "both changed boards are rows");
  assert.equal(at5.title, "Attacks · 5 blue cards in your drop area");
  assert.equal(at5.generated, false);
  assert.ok(at5.rules.fires, `5 blue cards fires: ${at5.rules.result.join(" | ")}`);
  assert.equal(at0.title, "Attacks · 0 blue cards in your drop area");
  assert.ok(!at0.rules.fires, "0 blue cards does not");
  // The generated pair stays.
  assert.ok(tried.rows.some((x) => x.title === THREE) && tried.rows.some((x) => x.title === TWO));
  assert.deepEqual(tried.knobs.map((k) => [k.path, k.kind, k.label]), [["cond", "count", "blue cards in your drop area"]]);
}

// ── A WHEN written wrong: the attack board says it never fired, and why ────

{
  const right0 = tryRule(probeRuleOf(rule(`WHEN [auto] attacks\nTHEN\n  draw(n: 1)`), TIDECALLER, "front", 0));
  const judged = right(right0.rows.find((x) => x.key === "attack") as TryRow);
  assert.equal(judged.expected, "fired");
  const wrong = tryRule(probeRuleOf(rule(`WHEN [auto] played\nTHEN\n  draw(n: 1)`), TIDECALLER, "front", 0), [judged.key]);
  const attack = wrong.rows.find((x) => x.key === "attack");
  assert.ok(attack, "the judged attack board is still tried after the WHEN changed");
  assert.equal(attack.generated, false);
  assert.equal(attack.rules.outcome, "didNotFire", `the attack board says did not fire: ${attack.rules.result.join(" | ")}`);
  assert.equal(attack.gate?.clause, "WHEN");
  assert.ok(attack.gate?.reasons.some((w) => /answers to "played"/.test(w) && /never came/.test(w)), attack.gate?.reasons.join(" | "));
  assert.equal(judge(attack.rules, judged), "mismatch");
  assert.equal(fixPath(attack, judged), "trigger", "Fix opens the WHEN block");
  // And the board the WHEN now names is tried too, and fires there.
  assert.ok(wrong.rows.find((x) => x.key === "play")?.rules.fires, "the play board fires on the WHEN as built");
}

// ── Engines disagreeing is shown as both ────────────────────────────────────

{
  // An [Auto] with an action price: the legacy engine charges it and draws;
  // the rules engine does not charge action prices on an [Auto] yet (#149)
  // and says so. An engine bug, not the owner's — the row shows both.
  const priced = probeRuleOf(rule(`WHEN [auto] attacks\nCOST DO {\n  mill(n: 1)\n}\nTHEN\n  draw(n: 1)`), def("T-PRICE", "Priced Seer", "[Auto] When this card attacks, put the top card of your deck in your Drop Area: draw 1 card."), "front", 0);
  const tried = tryRule(priced);
  const attack = tried.rows.find((x) => x.key === "attack") as TryRow;
  assert.ok(attack.disagree, `the engines disagree: rules ${attack.rules.outcome}, legacy ${attack.legacy.outcome}`);
  assert.equal(attack.legacy.headline, "draws 1");
  assert.equal(attack.rules.headline, "nothing");
  assert.equal(attack.gate?.clause, "COST", "on the engine games use, the price is what stopped it");
  assert.ok(attack.gate?.reasons.some((w) => /#149/.test(w)), "with the engine's own sentence");
}

// ── Met / not-met pairs, both engines, opposite outcomes ────────────────────

{
  const cases: { what: string; card: CardDef; src: string; pairs: number }[] = [
    { what: "count", card: TIDECALLER, src: `WHEN [auto] attacks\nIF count("blue card" IN you.drop) >= 3\nTHEN\n  draw(n: 1)`, pairs: 1 },
    { what: "count (at most)", card: TIDECALLER, src: `WHEN [auto] attacks\nIF count(IN you.battle) <= 1\nTHEN\n  draw(n: 1)`, pairs: 1 },
    { what: "life", card: def("T-LIFE", "Last Stand", "[Auto] When this card attacks, if your life is 4 or less, draw 1 card."), src: `WHEN [auto] attacks\nIF life(you) <= 4\nTHEN\n  draw(n: 1)`, pairs: 1 },
    { what: "isTurnPlayer", card: def("T-TURN", "Night Watch", "[Auto] At the end of the turn, if it's your turn, draw 1 card."), src: `WHEN [auto] turnEnd\nIF isTurnPlayer()\nTHEN\n  draw(n: 1)`, pairs: 1 },
    { what: "all of count and life", card: TIDECALLER, src: `WHEN [auto] attacks\nIF count("blue card" IN you.drop) >= 3 AND life(you) <= 4\nTHEN\n  draw(n: 1)`, pairs: 2 },
    { what: "not", card: TIDECALLER, src: `WHEN [auto] attacks\nIF NOT life(you) <= 4\nTHEN\n  draw(n: 1)`, pairs: 1 },
  ];
  for (const c of cases) {
    const r = probeRuleOf(rule(c.src), c.card, "front", 0);
    const base = scenariosFor(r)[0];
    const edges = scenariosFor(r).filter((s) => s.knobs);
    assert.deepEqual(edgeScenarios(r, base, "x").map((s) => s.key), edges.map((s) => s.key), `${c.what}: scenariosFor carries the edge boards`);
    // A pair is met then not met; an `all` of two shares its met board.
    assert.equal(edges.length, c.pairs + 1, `${c.what}: ${edges.map((s) => s.title).join(" / ")}`);
    for (const engine of [DEFAULT_ENGINE, FALLBACK_ENGINE]) {
      const [met, ...unmet] = edges.map((s) => tryRule(r, [], { main: engine, other: engine }).rows.find((x) => x.key === s.key) as TryRow);
      assert.ok(met.rules.fires, `${c.what} on ${engine}: "${met.title}" fires — ${met.rules.result.join(" | ")} / ${met.rules.input.join(" | ")}`);
      for (const u of unmet) assert.ok(!u.rules.fires, `${c.what} on ${engine}: "${u.title}" does not — ${u.rules.result.join(" | ")}`);
    }
  }
  // A condition the probe cannot stage gets the default board and a line saying so.
  const leader = tryRule(probeRuleOf(rule(`WHEN [auto] attacks\nIF leaderColor(color: Red)\nTHEN\n  draw(n: 1)`), TIDECALLER, "front", 0));
  assert.deepEqual(leader.notes, ["no edge board for leaderColor yet"]);
  assert.ok(leader.rows.every((x) => !x.knobs || !Object.keys(x.knobs).length));
}

// ── Board keys round-trip ───────────────────────────────────────────────────

{
  const key = keyOf("attack:negated", { "cond.conds[1]": 4, "cond.conds[0]": 3, "cost.condition": "opponent" });
  assert.equal(key, "attack:negated|cond.conds[0]=3,cond.conds[1]=4,cost.condition=opponent");
  assert.deepEqual(splitKey(key), { base: "attack:negated", knobs: { "cond.conds[0]": 3, "cond.conds[1]": 4, "cost.condition": "opponent" } });
  assert.deepEqual(splitKey("attack"), { base: "attack", knobs: {} });
}

// ── Every beat of the probe fixtures names the block that made it ───────────
//
// The fixtures `verify/probe.ts` tries, and a few with choices, conditions and
// options in them, compiled the way the workbench drafts a row. On both
// engines: a traced run concludes exactly what an untraced one does (the
// markers change nothing), and every line between the skill's announcement and
// its last step carries a path that resolves to an op or a condition of the
// rule.

const FIXTURES: [string, string][] = [
  ["P-PLAY", "[Auto] When you play this card, draw 1 card."],
  ["P-PLAY2", "[Auto] When you play this card, draw 2 cards."],
  ["P-KO", "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it."],
  ["P-ATK", "[Auto] When this card attacks, draw 1 card."],
  ["P-COMBO", "[Auto] When you use this card in a combo, draw 1 card."],
  ["P-END", "[Auto] At the end of your turn, draw 1 card."],
  ["P-MAIN", "[Activate: Main] Draw 1 card."],
  ["P-BATTLE", "[Activate: Battle] Draw 1 card."],
  ["P-PRICE", "[Activate: Main] {r}{r}{r}{r}{r}{r}{r}: Draw 1 card."],
  ["P-CTR", "[Counter: Attack] Draw 1 card."],
  ["P-WATCH", "[Auto] When you play a Battle Card, draw 1 card."],
  ["P-PERM", "[Permanent] This card gets +5000 power."],
  ["P-HOLD", "[Permanent] This card can't be KO'd by your opponent's skills."],
  ["P-BLOCK", "[Blocker]"],
  ["P-OPEN", "[Auto] When you play this card, do something nobody has taught the compiler."],
  ["P-IFLIFE", "[Auto] When you play this card, if your life is 4 or less, draw 1 card."],
  ["P-MAY", "[Auto] When this card attacks, you may draw 1 card."],
  ["P-REST", "[Activate: Main] Choose 1 of your opponent's Battle Cards and switch it to Rest Mode."],
  ["P-TWO", "[Auto] When you play this card, draw 1 card. Then, choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it."],
];

{
  let beats = 0;
  let traced = 0;
  for (const [id, skill] of FIXTURES) {
    const d = def(id, id, skill, { colors: ["Red"] });
    // A bare keyword line drafts no record: its rules are the keyword's own.
    const rec = skillRecords(d).find((x) => x.skillIndex === 0);
    if (!rec) continue;
    const r: ProbeRule = {
      def: d,
      side: rec.side,
      skillIndex: rec.skillIndex,
      kind: rec.kind,
      trigger: rec.trigger,
      ops: rec.cond ? [{ op: "if", cond: rec.cond, then: rec.ops }] : rec.ops,
      open: rec.unread.length > 0,
      unread: rec.unread,
      price: { condition: rec.cost?.condition ?? null, ops: rec.cost?.program ?? null, ...(rec.cost?.x ? { x: rec.cost.x } : {}) },
      hoisted: rec.cond != null,
    };
    const view = ruleViewOf(r);
    for (const scenario of scenariosFor(r)) {
      for (const engine of [FALLBACK_ENGINE, DEFAULT_ENGINE]) {
        const plain = probe(r, scenario, engine);
        const run = probe(r, scenario, engine, { trace: true });
        const at = `${id} ${scenario.key} on ${engine}`;
        assert.equal(run.digest, plain.digest, `${at}: the markers change nothing (${plain.outcome} → ${run.outcome})`);
        assert.deepEqual(run.applied, plain.applied, `${at}: the same lines`);
        assert.deepEqual(run.prompts, plain.prompts, `${at}: the same questions`);
        assert.deepEqual(run.assumptions, plain.assumptions, `${at}: no marker leaks into the assumptions`);
        const trace = run.trace;
        assert.ok(trace, `${at}: a traced run carries its trace`);
        assert.equal(trace.appliedPaths.length, run.applied.length, `${at}: one path per line`);
        const paths = trace.appliedPaths;
        const first = paths.findIndex((p) => p === "trigger" || p === "cond");
        const last = paths.reduce((n, p, i) => (p && p !== "trigger" && p !== "cond" ? i : n), -1);
        if (first >= 0) traced++;
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          if (p === null) {
            assert.ok(first < 0 || i < first || i > last, `${at}: "${run.applied[i]}" sits inside the rule's own lines and names no block`);
            continue;
          }
          beats++;
          if (p === "trigger") continue; // the announcement of a rule with no IF: the WHEN
          const target = resolvePath(view, p) as { op?: unknown; kind?: unknown } | undefined;
          assert.ok(target && (typeof target.op === "string" || typeof target.kind === "string"), `${at}: "${run.applied[i]}" is tagged ${p}, which is not an op or a condition of the rule`);
        }
        if (run.outcome === "fired" && run.result.some((x) => /draw|KO'd|Rest Mode/.test(x)) && first >= 0) {
          assert.ok(paths.some((p) => p?.startsWith("ops[")), `${at}: a rule that changed the board has a line from one of its steps — ${run.applied.join(" | ")}`);
        }
      }
    }
  }
  assert.ok(traced >= 20 && beats >= 40, `the fixtures exercised the tracing (${traced} runs announced, ${beats} lines tagged)`);
}

// ── probe() itself is unchanged ─────────────────────────────────────────────

{
  const r = tide(">= 3");
  for (const s of scenariosFor(r)) assert.equal(probe(r, s).digest, probe(r, s, FALLBACK_ENGINE).digest, `${s.key}: probe() with no engine is the legacy engine`);
  assert.equal(FALLBACK_ENGINE, "legacy");
  assert.equal(probe(r, scenariosFor(r)[0]).trace, undefined, "and is untraced unless asked");
}

// ── The reprobe check: "expected X, now Y" ──────────────────────────────────

{
  const firing = right(row(tryRule(tide(">= 3")), THREE));
  assert.deepEqual(expectationMismatches(tide(">= 3"), [firing]), []);
  const moved = expectationMismatches(tide(">= 4"), [firing]);
  assert.deepEqual(moved.map((m) => m.line), ["expected fired, now didNotFire"]);
}

console.log("tryit: OK");

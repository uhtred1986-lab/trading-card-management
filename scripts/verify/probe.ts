/**
 * The probe: a rule tried on a board built for it (`src/lib/arena/probe.ts`).
 *
 * The rules here are made the way the workbench makes them — `skillRecords`
 * off a card's own text — so a test says the same thing a row says.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFS, ENGINE, card } from "./harness";
import type { CardDef } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { familyOf, probe, scenariosFor, type ProbeRule, type ProbeRun } from "../../src/lib/arena/probe";

/** One skill of one card, as the row the workbench would show. */
function ruleFor(def: CardDef, index = 0): ProbeRule {
  const rec = skillRecords(def).find((r) => r.skillIndex === index);
  assert.ok(rec, `${def.id} has a skill ${index} to probe`);
  return {
    def,
    side: rec.side,
    skillIndex: rec.skillIndex,
    kind: rec.kind,
    trigger: rec.trigger,
    ops: rec.cond ? [{ op: "if", cond: rec.cond, then: rec.ops }] : rec.ops,
    open: rec.unread.length > 0,
    unread: rec.unread,
    // The price rides on the row, as it does in the database: the engine reads
    // it rather than compiling it, so a rule built without one has no price.
    price: { condition: rec.cost?.condition ?? null, ops: rec.cost?.program ?? null, ...(rec.cost?.x ? { x: rec.cost.x } : {}) },
  };
}

/** The default board for a rule: the first scenario, which is what a stored probe re-runs. */
function run(def: CardDef, index = 0): ProbeRun {
  const rule = ruleFor(def, index);
  return probe(rule, scenariosFor(rule)[0]);
}

function variant(def: CardDef, key: string, index = 0): ProbeRun {
  const rule = ruleFor(def, index);
  const scenario = scenariosFor(rule).find((s) => s.key === key);
  assert.ok(scenario, `${def.id} has a ${key} scenario`);
  return probe(rule, scenario);
}

const said = (r: ProbeRun) => [...r.result, ...r.applied, ...r.log].join(" | ");

// ── which board a rule is tried on ─────────────────────────────────────────

{
  const play = ruleFor(card("P-PLAY", { skill: "[Auto] When you play this card, draw 1 card." }));
  assert.equal(familyOf(play), "play");
  assert.equal(familyOf(ruleFor(card("P-ATK", { skill: "[Auto] When this card attacks, draw 1 card." }))), "attack");
  assert.equal(familyOf(ruleFor(card("P-COMBO", { skill: "[Auto] When you use this card in a combo, draw 1 card." }))), "combo");
  assert.equal(familyOf(ruleFor(card("P-END", { skill: "[Auto] At the end of your turn, draw 1 card." }))), "moment");
  assert.equal(familyOf(ruleFor(card("P-MAIN", { skill: "[Activate: Main] Draw 1 card." }))), "activateMain");
  assert.equal(familyOf(ruleFor(card("P-BATTLE", { skill: "[Activate: Battle] Draw 1 card." }))), "activateBattle");
  assert.equal(familyOf(ruleFor(card("P-CTR", { skill: "[Counter: Attack] Draw 1 card." }))), "counter");
  assert.equal(familyOf(ruleFor(card("P-PERM", { skill: "[Permanent] This card gets +5000 power." }))), "permanent");
  // A moment the engine does not know is not an error and not a blank probe:
  // it is the one true sentence about 802 rules of the catalog.
  const orphan: ProbeRule = { def: card("P-ORPHAN", {}), side: "front", skillIndex: 0, kind: "auto", trigger: [], ops: [], open: false, unread: [], price: { condition: null, ops: null } };
  assert.equal(familyOf(orphan), "none");
  const none = probe(orphan, scenariosFor(orphan)[0]);
  assert.equal(none.outcome, "noScenario");
  assert.match(none.result[0], /names a moment the engine does not know/);

  // "Skills negated" is not offered for a card staged in hand: an effect on it
  // ends when it is played (3-1-4), so the variant would be the default board
  // under another name.
  assert.deepEqual(
    scenariosFor(play).map((s) => s.key),
    ["play", "play:noTarget"],
  );
  const main = ruleFor(card("P-MAIN2", { skill: "[Activate: Main] Draw 1 card." }));
  assert.deepEqual(
    scenariosFor(main).map((s) => s.key),
    ["activateMain", "activateMain:noTarget", "activateMain:negated", "activateMain:opponentTurn"],
  );
}

// ── a rule that fires ──────────────────────────────────────────────────────

{
  const ko = run(card("P-KO", { skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it." }));
  assert.equal(ko.outcome, "fired");
  assert.ok(
    ko.result.some((r) => /Rival Fighter is KO'd/.test(r)),
    `the KO is in the result: ${ko.result.join(" | ")}`,
  );
  // 22-16: the [Barrier] card is on the board and is not offered as a target,
  // which is the whole reason the default board has one.
  const choice = ko.prompts.find((p) => /choose/i.test(p.ask));
  assert.ok(choice, "the probe was asked to choose");
  assert.match(choice.chose, /Rival Fighter/);
  assert.ok(!said(ko).includes("Barrier Fighter is KO'd"), "the [Barrier] card was never a candidate");

  const draw = run(card("P-DRAW", { skill: "[Activate: Main] Draw 1 card." }));
  assert.equal(draw.outcome, "fired");
  assert.deepEqual(draw.result, ["you draw 1 card"]);
  assert.ok(draw.prompts.length > 0 && draw.prompts[0].chose.startsWith("Activate"), "the move it made is the one under test");

  for (const [id, skill] of [
    ["P-ON-ATTACK", "[Auto] When this card attacks, draw 1 card."],
    ["P-ON-COMBO", "[Auto] When you use this card in a combo, draw 1 card."],
    ["P-ON-END", "[Auto] At the end of your turn, draw 1 card."],
    ["P-ON-COUNTER", "[Counter: Attack] Draw 1 card."],
  ] as const) {
    const r = run(card(id, { skill }));
    assert.equal(r.outcome, "fired", `${id}: ${r.result.join(" | ")}`);
    assert.ok(
      r.result.includes("you draw 1 card"),
      `${id} draws: ${r.result.join(" | ")}`,
    );
  }

  // A Leader watching somebody else's card being played: the probe plays one.
  const leader = run(card("P-LEADER", { type: "LEADER", energyCost: null, power: 20000, comboCost: null, comboPower: null, skill: "[Auto] When you play a Battle Card, draw 1 card." }));
  assert.equal(leader.outcome, "fired");
  assert.ok(leader.result.includes("you draw 1 card"), `the Leader's skill fired: ${leader.result.join(" | ")}`);
}

// ── a rule with no program, and a rule with a clause nobody could read ─────

{
  const open: ProbeRule = {
    def: card("P-OPEN", { skill: "[Auto] When you play this card, do something nobody has taught the compiler." }),
    side: "front",
    skillIndex: 0,
    kind: "auto",
    trigger: ["played"],
    ops: [],
    open: true,
    unread: ["do something nobody has taught the compiler"],
    price: { condition: null, ops: null },
  };
  const r = probe(open, scenariosFor(open)[0]);
  // It fires and does nothing: that is the answer, not a failure.
  assert.equal(r.outcome, "blank");
  assert.ok(
    r.assumptions.some((a) => /could not read/.test(a)),
    `the unread clause is an assumption: ${r.assumptions.join(" | ")}`,
  );
}

// ── a rule the engine will not offer ───────────────────────────────────────

{
  const pricey = run(card("P-PRICEY", { skill: "[Activate: Main] {r}{r}{r}{r}{r}{r}{r}: Draw 1 card." }));
  assert.equal(pricey.outcome, "notOffered");
  assert.ok(
    pricey.result.some((x) => /energy/.test(x)),
    `the refusal names the price: ${pricey.result.join(" | ")}`,
  );
  assert.deepEqual(pricey.applied, [], "nothing was applied, so nothing is claimed to have been");

  // An [Activate: Main] skill is not a move on the opponent's turn — and the
  // probe must not quietly wait for your next turn to make it one.
  const wrongTurn = variant(card("P-MAIN3", { skill: "[Activate: Main] Draw 1 card." }), "activateMain:opponentTurn");
  assert.equal(wrongTurn.outcome, "notOffered");
  assert.ok(!wrongTurn.result.includes("you draw 1 card"), "the skill did not happen on their turn");
}

// ── what is in force rather than what happens ──────────────────────────────

{
  const aura = run(card("P-AURA", { skill: "[Permanent] This card gets +5000 power." }));
  assert.equal(aura.outcome, "inForce");
  assert.ok(
    aura.result.some((r) => /power on the board: 15000 — 10000 without this rule/.test(r)),
    `the static is read with and without its rule: ${aura.result.join(" | ")}`,
  );

  // A prohibition is measured by what the opponent cannot do (20-14).
  const safe = run(card("P-SAFE", { skill: "[Permanent] This card can't be KO'd by your opponent's skills." }));
  assert.equal(safe.outcome, "inForce");
  assert.ok(
    safe.result.some((r) => /could not take this card/.test(r)),
    `the KO skill was refused it: ${safe.result.join(" | ")}`,
  );
  assert.ok(!said(safe).includes("P-SAFE is KO'd"), "and it was not KO'd");

  // The same card in hand, where the skill is not valid at all (9-1-3).
  const inHand = variant(card("P-SAFE2", { skill: "[Permanent] This card can't be KO'd by your opponent's skills." }), "permanent:inHand");
  assert.ok(
    inHand.result.some((r) => /in hand/.test(r)),
    `the hand is not where a [Permanent] holds: ${inHand.result.join(" | ")}`,
  );

  // A [Permanent] that relaxes its *own* specified cost from hand (issue
  // #255, BT19-039's shape) gets the one board the KO board cannot give it:
  // the card in hand, its condition met, and one energy of each colour it
  // still demands. With the baseline entered the play is legal on one blue
  // energy *because of* the rule — the same board without it is refused, and
  // the refusal names the colour. The seven cards phrased like this are the
  // reason the variant exists; a [Permanent] about power does not get it.
  {
    const goten = (specifiedCost?: CardDef["specifiedCost"]) =>
      card("P-GOTEN", {
        type: "UNISON",
        colors: ["Blue"],
        energyCost: "X",
        ...(specifiedCost ? { specifiedCost } : {}),
        skill: "[Permanent] If you have a card with <Trunks> in its character name in play, reduce the specified cost of this card in your hand by {u}.",
      });
    const entered = ruleFor(goten({ Blue: 2 }));
    assert.deepEqual(
      scenariosFor(entered).map((s) => s.key),
      ["permanent", "permanent:inHand", "permanent:reduced"],
      "the reduced board is offered beside the KO board, not instead of it",
    );
    assert.ok(!scenariosFor(ruleFor(card("P-PERM2", { skill: "[Permanent] This card gets +5000 power." }))).some((s) => s.key === "permanent:reduced"), "and only to a rule that relaxes its own specified cost");

    const legal = variant(goten({ Blue: 2 }), "permanent:reduced");
    assert.ok(legal.input.some((l) => /one blue energy/.test(l) && /2 blue/.test(l) && /to 1 blue/.test(l)), `the board says what it staged and why: ${legal.input.join(" | ")}`);
    assert.ok(legal.input.some((l) => /condition asks for \(trunks\)/i.test(l)), `the condition's card is on the board: ${legal.input.join(" | ")}`);
    assert.ok(legal.result.some((r) => /^with this rule: the play is legal with X = 1 \(1 blue\)/.test(r)), `legal on one blue energy: ${legal.result.join(" | ")}`);
    assert.ok(legal.result.some((r) => /^without it: the play would be refused — .*needs 2 Blue energy — 1 active/.test(r)), `and refused without the rule, naming the colour: ${legal.result.join(" | ")}`);
    assert.ok(legal.log.some((l) => /You play Unison/.test(l)), `the probe then makes the play: ${legal.log.join(" | ")}`);
    assert.ok(!legal.assumptions.some((a) => /specified cost is unknown/.test(a)), "nothing is assumed about a baseline that is entered");

    // Unknown baseline: the same board proves nothing, and says so twice —
    // in the reading and in the assumptions — rather than reporting a legal
    // play as if the reducer had earned it.
    const unknown = variant(goten(), "permanent:reduced");
    assert.ok(unknown.input.some((l) => /specified cost is unknown/.test(l)), `the input says the orbs are not known: ${unknown.input.join(" | ")}`);
    assert.ok(unknown.result.some((r) => /cannot show the reducer working/.test(r)), `the reading says the board proves nothing: ${unknown.result.join(" | ")}`);
    assert.ok(unknown.result.some((r) => /^without it: the play would be legal too/.test(r)), `…because the engine demands no colour either way: ${unknown.result.join(" | ")}`);
    assert.ok(unknown.assumptions.some((a) => /specified cost is unknown/.test(a)), `and the assumption is on the run: ${unknown.assumptions.join(" | ")}`);
    // The assumption is driven by `specifiedCostUnknown`, so every board of
    // such a card carries it — the KO board included.
    assert.ok(run(goten()).assumptions.some((a) => /specified cost is unknown/.test(a)), "the default board says it too");
    assert.ok(!run(goten({ Blue: 2 })).assumptions.some((a) => /specified cost is unknown/.test(a)));
  }

  // 1,089 keyword rules have an empty program and are played all the same. The
  // probe must say what the engine does with the keyword, not "nothing".
  const kw: ProbeRule = {
    def: card("P-BLOCK", { skill: "[Blocker]" }),
    side: "front",
    skillIndex: 0,
    kind: "keyword",
    trigger: [],
    ops: [],
    open: false,
    unread: [],
    price: { condition: null, ops: null },
  };
  const blocker = probe(kw, scenariosFor(kw)[0]);
  assert.equal(blocker.outcome, "fired");
  assert.ok(
    blocker.result.some((r) => /\[Blocker\]/.test(r)) || said(blocker).includes("Blocker"),
    `the keyword's own rule answers for it: ${blocker.result.join(" | ")}`,
  );
  assert.ok(
    blocker.prompts.some((p) => /Block/i.test(p.chose)),
    `and the engine offered the block: ${blocker.prompts.map((p) => p.chose).join(" | ")}`,
  );
}

// ── the same rule, twice, is the same run ──────────────────────────────────

{
  const def = card("P-SAME", { skill: "[Auto] When you play this card, draw 1 card." });
  assert.equal(run(def).digest, run(def).digest, "a probe is deterministic");
  const other = card("P-OTHER", { skill: "[Auto] When you play this card, draw 2 cards." });
  assert.notEqual(run(def).digest, run(other).digest, "and a different program is a different run");

  // Nothing a card can be shaped like makes the probe throw: every odd one
  // comes back as a run with an outcome, which is what the sweep counts on.
  const odd: CardDef[] = [
    card("P-NOSKILL", { skill: null }),
    card("P-EXTRA", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." }),
    card("P-UNISON", { type: "UNISON", power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." }),
    card("P-Z", { type: "Z-BATTLE", zEnergyCost: 2, skill: "[Auto] When you play this card, draw 1 card." }),
    card("P-XCOST", { energyCost: "X", skill: "[Auto] When you play this card, draw 1 card." }),
  ];
  for (const def of odd) {
    for (const rec of skillRecords(def)) {
      const rule = ruleFor(def, rec.skillIndex);
      for (const scenario of scenariosFor(rule)) {
        const r = probe(rule, scenario);
        assert.notEqual(r.outcome, "error", `${def.id} ${scenario.key}: ${r.result.join(" | ")}`);
        assert.ok(r.digest.length === 8, "every run has a digest to compare");
      }
    }
  }
}

// ── the digests, kept: what every harness card's rule does today ───────────
//
// `arena:reprobe` is the regression suite over the rules the owner confirmed,
// and it needs the database. This is the same idea with no database: every
// synthetic card in `DEFS` with a skill, probed on its first scenario, and
// the digest written down. An engine change that moves one shows up here as
// a readable diff — which is what lets the rules engine be built beside the
// legacy one and checked against it (`docs/arena-ruleset-spec.md`). Run
// `npm run contract:emit` to accept a change on purpose.
//
// It lives beside `contract/fixtures/`, not in it: the Kotlin round-trip
// decodes every JSON file in that folder as a `Snapshot`, and this is not one.
//
// Meaningful only once every suite before this one has actually run: `DEFS`
// is built up by each suite's own top-level cards, and on `--engine rules`
// today several of them are skipped before they add theirs (`EngineMismatch`),
// which would compare a partial catalog against a fixture built from the
// whole one and fail for a reason that has nothing to do with a probe. This
// fixture is legacy's alone until #143's later stages give the rules engine
// something to probe.

if (ENGINE !== "legacy") {
  console.log(`verify/probe: skipped the fixture digest — only meaningful once every suite before it has run (engine: ${ENGINE})`);
} else {
  const digests: Record<string, { outcome: string; digest: string }> = {};
  for (const def of Object.values(DEFS).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const rec of skillRecords(def)) {
      const rule = ruleFor(def, rec.skillIndex);
      const r = probe(rule, scenariosFor(rule)[0]);
      digests[`${def.id}#${rec.skillIndex}`] = { outcome: r.outcome, digest: r.digest };
    }
  }
  const file = path.join(process.cwd(), "contract", "probe-digests.json");
  const text = JSON.stringify(digests, null, 2) + "\n";
  if (process.argv.includes("--emit")) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`verify-arena: wrote ${Object.keys(digests).length} probe digests`);
  } else {
    assert.ok(fs.existsSync(file), "contract/probe-digests.json is missing — run `npm run contract:emit`");
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as typeof digests;
    const moved = Object.keys(digests).filter((k) => stored[k]?.digest !== digests[k].digest);
    assert.deepEqual(
      moved.map((k) => `${k}: ${stored[k]?.outcome ?? "new"} → ${digests[k].outcome}`),
      [],
      "a rule's probe answers differently from the fixture. If the engine change is deliberate, run `npm run contract:emit` and review the diff.",
    );
    assert.deepEqual(Object.keys(stored).filter((k) => !(k in digests)), [], "a fixture rule no longer exists — run `npm run contract:emit`");
  }

  // #161: the same sweep, on the rules engine — the same staged boards, built
  // from the ruleset definition (`probe.ts`'s `opening`/`put`), the same fixed
  // answering policy, the same digest over what was concluded.
  //
  // One row per rule: what each engine concluded, and whether the two digests
  // agree. A row that differs must be **explained** — it carries a `cause`, and
  // a difference no cause covers fails this suite — so "the moved list is empty
  // or explained" is an assertion rather than a sentence. Every cause below is
  // a thing the rules engine does not build yet (or, once, a legacy habit it
  // does not share), named with the issue that builds it; when one is built the
  // rows it covered stop differing and this fails until `npm run contract:emit`
  // records the new, smaller list. `--explain` prints both engines' reading of
  // every differing rule.
  // The ops a rule's program carries, through its `if`s — what a cause about
  // one kind of [Permanent] reads, so it names the rule rather than guessing
  // from the log.
  const opsIn = (ops: ProbeRule["ops"]): ProbeRule["ops"] => ops.flatMap((o) => (o.op === "if" ? [o, ...opsIn(o.then), ...opsIn(o.else ?? [])] : [o]));
  const hasOp = (rule: ProbeRule, test: (o: ProbeRule["ops"][number]) => boolean) => opsIn(rule.ops).some(test);
  const CAUSES: { id: string; says: string; holds: (f: string, old: ProbeRun, rules: ProbeRun, rule: ProbeRule) => boolean }[] = [
    {
      id: "rule-processing",
      says: "Rule processing (21) does not run on the rules engine: a Battle Card at 0 power or less (21-6) and a Unison with no markers left (21-9) stay where they are, where legacy puts them in the Drop with no KO. A skill's KO itself is real since #146; this state-based half is not built on that branch.",
      holds: (_f, old, rules) =>
        old.result.some((line) => {
          const m = /^(.*) goes from the (?:Battle|Unison) Area to the Drop$/.exec(line);
          return !!m && !old.applied.some((a) => a.endsWith(`${m[1]} is KO'd.`)) && !rules.result.includes(line);
        }),
    },
    {
      id: "skip",
      says: "'Skip a turn/step' (20-13) is NotYet on the rules engine — the flow's skip list is #145's.",
      holds: (_f, _old, rules) => /cannot skip/.test(rules.applied.join("|")),
    },
    {
      id: "leave-replacement",
      says: "A [Permanent] replacement for leaving play or a KO (9-10 — `replaceLeave`, or `replace` of `leave`/`ko`) is not collected on the rules engine: `vm/host.ts`'s `replacementsFor` answers [] (`DEFERRED_STATICS.replaceLeave`, #146's replacement half, not on the KO branch), so a KO'd card goes to the Drop where legacy sends it to the Warp, out of the game, or replaces the move altogether.",
      holds: (_f, old, rules, rule) =>
        hasOp(rule, (o) => o.op === "replaceLeave" || (o.op === "replace" && (o.event === "leave" || o.event === "ko"))) &&
        rules.result.some((l) => / goes from the Battle Area to the Drop$/.test(l) && !old.result.includes(l)),
    },
    {
      id: "immunity-static",
      says: "9-1-4 immunity granted by a [Permanent]'s `immune` op is not collected on the rules engine (`DEFERRED_STATICS.immune`, #154), so the opponent's KO skill is offered the card and takes it; legacy never offers it as a target.",
      holds: (_f, old, rules, rule) =>
        hasOp(rule, (o) => o.op === "immune") && old.result.some((l) => /never among the targets/.test(l)) && rules.result.some((l) => / is KO'd$/.test(l)),
    },
    {
      id: "keyword-negation-static",
      says: "A [Permanent] that negates a keyword (`negateKeyword`) is not collected on the rules engine (`DEFERRED_STATICS.negateKeyword`, #153), so the card still reads the keyword in force where legacy reads none.",
      holds: (_f, old, rules, rule) =>
        hasOp(rule, (o) => o.op === "negateKeyword") && rules.result.some((l) => /^keywords in force: /.test(l) && !old.result.includes(l)),
    },
    {
      id: "keyword-moves",
      says: "A keyword's own move ([Evolve], [Union], [Awaken], [Z-Stack]) is not built on the rules engine (Stage 7, #153), so it is never offered and `rejectedActions` names no reason; legacy names the board it was missing.",
      holds: (_f, _old, rules) => /never offered, and the engine gives no reason/.test(rules.result.join("|")),
    },
    {
      id: "unreadable-price",
      says: "An [Activate] with a price the rules engine's activation cannot read yet (a cost program, an X, [Spirit Boost]) is refused as 'cannot read this text yet'; legacy offers it, or names what it could not pay. [Burst X] is a declared price since #148 and is no longer one of them.",
      holds: (_f, _old, rules) => /cannot read .* text yet/.test(rules.result.join("|")),
    },
    {
      id: "auto-price",
      says: "An [Auto]'s own price ('{r}:' before the trigger) is not charged on the rules engine: legacy rests the energy a second time, the rules engine does not.",
      holds: (_f, old, rules) => old.applied.filter((l) => /Rest Mode/.test(l)).length > rules.applied.filter((l) => /Rest Mode/.test(l)).length,
    },
    {
      id: "hoisted-if-announced",
      says: "A skill whose hoisted 'if' is false: legacy announces the skill and then does nothing; the rules engine never pends it. Same board, outcome fired vs didNotFire.",
      holds: (_f, old, rules) => old.outcome === "fired" && rules.outcome === "didNotFire",
    },
    {
      id: "legacy-habits",
      says: "Wording only: legacy narrates the End Phase twice around an [Auto] at the end of the turn, and notes 'Claude ruled on this' for a clause no compiler read; the rules engine does neither. A rules-engine game logs the 'negated for the rest of the game' effect legacy keeps silent.",
      holds: (_f, old, rules) => new Set(old.applied).size < old.applied.length || /Claude ruled/.test(old.applied.join("|")) || /negated for the rest of the game/.test(rules.applied.join("|")),
    },
  ];
  type Row = { legacy: { outcome: string; digest: string }; rules: { outcome: string; digest: string }; same: boolean; cause?: string };
  const parity: Record<string, Row> = {};
  const unexplained: string[] = [];
  for (const def of Object.values(DEFS).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const rec of skillRecords(def)) {
      const rule = ruleFor(def, rec.skillIndex);
      const scenario = scenariosFor(rule)[0];
      const key = `${def.id}#${rec.skillIndex}`;
      const legacy = digests[key];
      const rules = probe(rule, scenario, "rules");
      const same = legacy.digest === rules.digest;
      let cause: string | undefined;
      if (!same) {
        const old = probe(rule, scenario);
        cause = CAUSES.find((c) => c.holds(scenario.family, old, rules, rule))?.id;
        if (!cause) unexplained.push(key);
        // `--explain` prints what each engine concluded for every rule that differs.
        if (process.argv.includes("--explain")) {
          console.log(`\n${key} [${scenario.key}] ${old.outcome} / ${rules.outcome} (${cause ?? "UNEXPLAINED"})`);
          console.log(`  legacy applied: ${JSON.stringify(old.applied)}\n  rules  applied: ${JSON.stringify(rules.applied)}`);
          console.log(`  legacy result:  ${JSON.stringify(old.result)}\n  rules  result:  ${JSON.stringify(rules.result)}`);
        }
      }
      parity[key] = { legacy, rules: { outcome: rules.outcome, digest: rules.digest }, same, ...(cause ? { cause } : {}) };
    }
  }
  assert.deepEqual(unexplained, [], "a rule's probe differs between the engines for a reason no CAUSES entry names — a new divergence: explain it (or fix it) before recording it");
  assert.ok(
    Object.values(parity).every((r) => r.same || r.rules.outcome !== "error"),
    "the rules engine's probe never errors on a fixture card: the staging is built from the definition",
  );
  const summaryFile = path.join(process.cwd(), "contract", "probe-rules-parity.json");
  const summaryText = JSON.stringify(parity, null, 2) + "\n";
  const total = Object.keys(parity).length;
  const moved = Object.values(parity).filter((r) => !r.same).length;
  if (process.argv.includes("--emit")) {
    fs.writeFileSync(summaryFile, summaryText);
    console.log(`verify-arena: wrote probe-rules-parity.json (${total} rules, ${moved} differ from legacy, all explained)`);
  } else {
    assert.ok(fs.existsSync(summaryFile), "contract/probe-rules-parity.json is missing — run `npm run contract:emit`");
    assert.equal(summaryText, fs.readFileSync(summaryFile, "utf8"), "the rules-engine probe sweep no longer matches contract/probe-rules-parity.json — review the diff and run `npm run contract:emit` if the change is deliberate (a rules-engine gap closing, most likely)");
    console.log(`verify/probe: ${total - moved}/${total} fixture digests are the same on the rules engine; ${moved} differ, each explained`);
  }
}

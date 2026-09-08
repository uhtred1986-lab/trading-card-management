/**
 * The probe: a rule tried on a board built for it (`src/lib/arena/probe.ts`).
 *
 * The rules here are made the way the workbench makes them — `skillRecords`
 * off a card's own text — so a test says the same thing a row says.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { card } from "./harness";
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
    price: { condition: rec.cost?.condition ?? null, ops: rec.cost?.program ?? null },
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

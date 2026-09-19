/**
 * The §22 keywords as engine rules.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import type { PlayerId } from "../../src/lib/arena/engine/types";
import { validateProgram } from "../../src/lib/arena/engine/script";
import {
  CTX,
  DEFS,
  ENGINE,
  IMPL,
  actsG,
  apply,
  arena,
  arenaG,
  assertConsistent,
  assertConsistentG,
  autoTriggerMatches,
  canActivateG,
  compileSkill,
  eitherOrbsIn,
  find,
  findG,
  hasG,
  koCard,
  labels,
  labelsG,
  leaderOf,
  lifeReplacementChoicesFor,
  masterOfG,
  move,
  placeUnder,
  orbsIn,
  parseConditionClause,
  parseSkills,
  planPayment,
  play,
  playG,
  powerOfG,
  priceOf,
  rejectedActionsG,
  sentence,
  narrate,
  skillNegatedG,
  splitClauses,
  stageMoveG,
  toBeats,
  unisonOf,
  zoneOf,
} from "./harness";
import { legacyState } from "../../src/lib/arena/engines";

/**
 * #158: this suite runs on both engines now, through the same state-interface
 * layer `battles.ts`/`workflow.ts` use (`arenaG`/`playG`/`findG`/`labelsG`/
 * `actsG`/`canActivateG`/`rejectedActionsG`, `zoneOf`/`leaderOf`/`unisonOf` in
 * place of `s.players.p1.<area>`/`.leader`/`.unison`, `IMPL.legalActions`/
 * `IMPL.apply`/`IMPL.boardView` in place of the legacy-narrowed module
 * functions). Two readers this suite needed that neither `battles.ts` nor
 * `workflow.ts` had reached for yet are new on `harness.ts`: `hasG`/
 * `skillNegatedG` (a keyword or a skill in force, off `vm/program.ts`'s own
 * `hasKeyword`/`vm/effects.ts`'s `skillNegated` — the same three sources the
 * legacy `has` reads: a printed skill still showing, a `keyword`-kind effect,
 * a [Permanent] static) and `masterOfG` (3-1-6, bound to the `GameDefinition`
 * the way `powerOfG` already is). `stageMoveG` is a new *test-only* fixture
 * rig beside `stageOnRules`'s own, for a card a setup step needs relocated
 * (to the Drop, to the bottom of the deck) before the move under test runs —
 * a raw splice, not a move a rule would make, for exactly the cases where
 * `move(CTX, …)`'s reason and event log are not what the assertion is about.
 *
 * What is still skipped on `--engine rules`, and why — every case below is
 * one of four shapes, named at its own gate call rather than silently doing
 * nothing:
 *
 * - **`keywordGap`**: the keyword's own `DEFINE KEYWORD` in `keywords.rules`
 *   carries no `HOOK` body for what this case needs (`docs/arena-backlog/
 *   s7-0{2,3,4,5}-*.md` — Stage 7's four hook groups, `src/lib/arena/
 *   rulesets/dbs/keywords.rules`'s own header names which keywords still read
 *   `-- Stage 7 (#153–#157)`).
 * - **`staticGap`**: the [Permanent] reads to a static kind `vm/effects.ts`'s
 *   own `DEFERRED_STATICS` names — a legality or an alternative payment a
 *   [Permanent] can print and this engine does not yet collect into anything
 *   a reader sees, each already citing the issue that closes it.
 * - **`notYetGap`**: the case reaches a primitive `vm/host.ts`'s own
 *   `ScriptHost` implementation still throws `NotYet` for by name (a
 *   skill-driven KO, `#146`; a skipped phase or step, `#145`).
 * - **`replaceGap`**: the case is 9-10's own family — a [Permanent] standing
 *   in front of a departure. `vm/host.ts`'s `replacementsFor` answers `[]`
 *   unconditionally (`replaceLeave` is exactly `DEFERRED_STATICS`' own entry,
 *   `#146`), so every case that stages one is the same gap under its own name
 *   rather than four unrelated ones.
 */
let skipped = 0;
function keywordGap(keyword: string, doc: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — [${keyword}]'s keyword body is not built on the rules engine yet (${doc})`);
  skipped++;
  return true;
}
function staticGap(where: string, what: string, why: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: [Permanent] reads to a "${what}" static, which vm/effects.ts's DEFERRED_STATICS names as unread — ${why}`);
  skipped++;
  return true;
}
function notYetGap(where: string, what: string, issue: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: ${what} (${issue})`);
  skipped++;
  return true;
}
function replaceGap(where: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — ${where}: a [Permanent] standing in front of a departure (9-10) is DEFERRED_STATICS' own "replaceLeave" — vm/host.ts's replacementsFor answers [] unconditionally until #146 gives moves by skill a real KO to replace`);
  skipped++;
  return true;
}

const S7 = {
  evolve: "docs/arena-backlog/s7-05-keywords-play-charge-pay.md — hook group D: playing, charging and alternative payment ([Evolve])",
  union: "docs/arena-backlog/s7-05-keywords-play-charge-pay.md — hook group D: playing, charging and alternative payment ([Union])",
  invoker: "docs/arena-backlog/s7-03-keywords-enter-leave.md — hook group B: entering, leaving and after a skill ([Invoker])",
  arrival: "docs/arena-backlog/s7-03-keywords-enter-leave.md — hook group B: entering, leaving and after a skill ([Arrival])",
  empower: "docs/arena-backlog/s7-05-keywords-play-charge-pay.md — hook group D: playing, charging and alternative payment ([Empower])",
  successor: "docs/arena-backlog/s7-03-keywords-enter-leave.md — hook group B: entering, leaving and after a skill ([Successor])",
  aegis: "docs/arena-backlog/s7-02-keywords-choosing-immunity.md — hook group A: choosing, immunity and KO by effect ([Aegis])",
  revive: "docs/arena-backlog/s7-03-keywords-enter-leave.md — hook group B: entering, leaving and after a skill ([Revive])",
  rejuvenate: "docs/arena-backlog/s7-03-keywords-enter-leave.md — hook group B: entering, leaving and after a skill ([Rejuvenate])",
  alliance: "docs/arena-backlog/s7-02-keywords-choosing-immunity.md — hook group A: choosing, immunity and KO by effect ([Alliance])",
};

// ── §22 keywords as engine rules ───────────────────────────────────────────

if (!keywordGap("Evolve", S7.evolve) && !keywordGap("Union", S7.union)) {
  // Trigger moments that are keyword timings, not plain phase timings, are
  // named in WHEN and fired by the engine where the keyword is used.
  DEFS.EVOHOST = { ...DEFS.V1, id: "EVOHOST", name: "EVOHOST", characters: ["Evo Host"] };
  DEFS.EVOTRIG = {
    ...DEFS.V1,
    id: "EVOTRIG",
    name: "EVOTRIG",
    energyCost: 2,
    skill: "[Auto] When using this card's [Evolve] from your hand, draw 1 card.\n[Evolve]{r}: <Evo Host>",
  };
  let s = arenaG({ hand: ["EVOTRIG"], battle: ["EVOHOST"], energy: ["V1", "V1"] });
  const handBeforePlay = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "EVOTRIG") });
  assert.equal(zoneOf(s, "p1", "hand").length, handBeforePlay - 1, "playing from hand is not the [Evolve] timing");

  s = arenaG({ hand: ["EVOTRIG"], battle: ["EVOHOST"], energy: ["V1", "V1"] });
  const handBeforeEvolve = zoneOf(s, "p1", "hand").length;
  const evolveAction = actsG(s).find((a) => a.type === "activate" && a.card === findG(s, "p1", "hand", "EVOTRIG") && !a.alt);
  assert.ok(evolveAction, "the [Evolve] activation is offered from hand");
  s = playG(s, evolveAction);
  if (s.prompt.kind === "chooseCards") s = playG(s, { type: "choose", player: "p1", cards: [zoneOf(s, "p1", "battle")[0]] });
  assert.equal(zoneOf(s, "p1", "hand").length, handBeforeEvolve, "using [Evolve] from hand fires the [Auto] once");
  assertConsistentG(s);

  DEFS.UABS = {
    ...DEFS.V1,
    id: "UABS",
    name: "UABS",
    skill: "[Auto] When this card's [Union-Absorb] is activated, draw 1 card.\n[Union-Absorb][Activate: Main] Draw 1 card.",
  };
  s = arenaG({ battle: ["UABS"] });
  const handBeforeAbsorb = zoneOf(s, "p1", "hand").length;
  const absorbAction = actsG(s).find((a) => a.type === "activate" && a.card === zoneOf(s, "p1", "battle")[0] && !a.alt);
  assert.ok(absorbAction, "the [Union-Absorb] activation is offered");
  s = playG(s, absorbAction);
  assert.equal(zoneOf(s, "p1", "hand").length, handBeforeAbsorb + 2, "the activation and the timing [Auto] both resolve");
  assertConsistentG(s);
  DEFS.UABSWATCH = {
    ...DEFS.V1,
    id: "UABSWATCH",
    name: "UABSWATCH",
    skill: "[Auto] When you activate a [Union] skill, draw 1 card.",
  };
  s = arenaG({ battle: ["UABS", "UABSWATCH"] });
  const handBeforeUnionWatch = zoneOf(s, "p1", "hand").length;
  const absorbWithWatcher = actsG(s).find((a) => a.type === "activate" && a.card === zoneOf(s, "p1", "battle")[0] && !a.alt);
  assert.ok(absorbWithWatcher, "the [Union-Absorb] activation is still offered with a [Union] watcher in play");
  s = playG(s, absorbWithWatcher);
  assert.equal(zoneOf(s, "p1", "hand").length, handBeforeUnionWatch + 3, "[Union-Absorb] activation also fires [Union] timing [Auto]s");
  assertConsistentG(s);
  delete DEFS.EVOTRIG;
  delete DEFS.EVOHOST;
  delete DEFS.UABS;
  delete DEFS.UABSWATCH;
}

if (
  !staticGap(
    "CFREE: free [Counter] from hand",
    "altCost",
    "#149 bound only the narrower, per-price payWith form (an activation's own line); this wider [Permanent] grant, spanning every activation of one skill, is still unread",
  ) &&
  !keywordGap("Invoker", S7.invoker)
) {
  // Free [Counter] from hand is a timing of its own.
  DEFS.CFREE = {
    ...DEFS["E-NEGATE"],
    id: "CFREE",
    name: "CFREE",
    energyCost: 2,
    skill:
      "[Permanent] You may activate this card's [Counter] skill from your hand without paying its energy cost.\n" +
      "[Auto] When you activate this card's [Counter] skill from your hand without paying its energy cost, draw 1 card.\n" +
      "[Counter: Attack] Negate the attack.",
  };
  let s = arenaG({ hand: ["CFREE"], energy: ["V1"] });
  s = playG(
    s,
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") },
  );
  assert.equal(s.prompt.kind, "counter");
  assert.ok(labelsG(s).some((x) => x.includes("Counter with CFREE (for no energy)")), "the free counter is offered from hand");
  const freeCounterOffer = IMPL.legalActions(CTX, s).find((a) => a.action.type === "counter" && a.action.card === findG(s, "p1", "hand", "CFREE") && a.action.alt);
  assert.equal(freeCounterOffer?.cost?.energy, 0, "the free counter metadata says it rests 0 energy");
  const handBeforeFreeCounter = zoneOf(s, "p1", "hand").length;
  const activeBefore = zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "active").length;
  const freeCounter = actsG(s).find((a) => a.type === "counter" && a.card === findG(s, "p1", "hand", "CFREE") && a.alt);
  assert.ok(freeCounter, "the free counter action is legal");
  s = playG(s, freeCounter);
  const activeAfter = zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "active").length;
  assert.equal(activeAfter, activeBefore, "free [Counter] from hand rests no energy");
  assert.equal(zoneOf(s, "p1", "hand").length, handBeforeFreeCounter, "the free-counter timing [Auto] drew 1 card");
  assertConsistentG(s);

  s = arenaG({ hand: ["CFREE"], energy: ["V1", "V1", "V1"] });
  s = playG(
    s,
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") },
  );
  const handBeforePaidCounter = zoneOf(s, "p1", "hand").length;
  const paidCounter = actsG(s).find((a) => a.type === "counter" && a.card === findG(s, "p1", "hand", "CFREE") && !a.alt);
  assert.ok(paidCounter, "the paid counter action is legal too");
  s = playG(s, paidCounter);
  assert.equal(zoneOf(s, "p1", "hand").length, handBeforePaidCounter - 1, "paying the [Counter] energy cost does not fire the free-counter timing");
  assertConsistentG(s);
  DEFS.CINVK = { ...DEFS["E-NEGATE"], id: "CINVK", name: "CINVK", colors: ["Red", "Blue"], energyCost: 2, skill: "[Counter: Attack] Negate the attack." };
  DEFS.INVK = { ...DEFS.V1, id: "INVK", name: "INVK", colors: ["Red", "Blue"], skill: "[Invoker]" };
  DEFS.RB = { ...DEFS.V1, id: "RB", name: "RB", colors: ["Red", "Blue"] };
  s = arenaG({ hand: ["CINVK"], battle: ["INVK"], energy: ["RB"] });
  s = playG(
    s,
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") },
  );
  const invokerCounter = IMPL.legalActions(CTX, s).find((a) => a.action.type === "counter" && a.action.card === findG(s, "p1", "hand", "CINVK") && a.action.alt);
  assert.ok(invokerCounter, "the [Invoker] counter offer is present");
  assert.equal(invokerCounter.cost?.energy, 1, "the [Invoker] counter metadata says it rests 1 energy");
  assert.equal(invokerCounter.cost?.describe, "[Invoker]");
  delete DEFS.CINVK;
  delete DEFS.INVK;
  delete DEFS.RB;
  delete DEFS.CFREE;
}

if (
  !notYetGap(
    "SKILLCHEAP: a scoped reduction of a [Counter]'s own printed orbs",
    "a skill's own text price has no cost-reduction layer on the rules engine yet — `costOf`/`specifiedCost`'s declared `layers:` (#148 Build 2) cover a play's price, not a skill line's; neither COUNTER_RR nor COUNTER_UU is affordable without the reduction, so the counter window offers neither and play falls straight through to the combo step",
    "no issue filed yet",
  )
) {
  // Skill-cost modifiers: a red-scoped reduction lowers a red [Counter] skill's
  // orbs, does not lower a blue one, and ends at its printed `until`.
  DEFS.COUNTER_RR = { ...DEFS["E-NEGATE"], id: "COUNTER_RR", name: "COUNTER_RR", colors: ["Red"], energyCost: 0, skill: "[Counter: Attack]{r}{r}: Negate the attack." };
  DEFS.COUNTER_UU = { ...DEFS["E-NEGATE"], id: "COUNTER_UU", name: "COUNTER_UU", colors: ["Blue"], energyCost: 0, skill: "[Counter: Attack]{u}{u}: Negate the attack." };
  DEFS.SKILLCHEAP = {
    ...DEFS.V1,
    id: "SKILLCHEAP",
    name: "SKILLCHEAP",
    energyCost: 1,
    skill: "[Auto] When you play this card, reduce the skill cost of your red cards in your hand by {r} until the start of your next turn.",
  };
  let s = arenaG({ hand: ["SKILLCHEAP", "COUNTER_RR", "COUNTER_UU"], energy: ["V1", "V1"] });
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "SKILLCHEAP") }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, {
    type: "attack",
    player: "p2",
    attacker: leaderOf(s, "p2"),
    target: leaderOf(s, "p1"),
  });
  assert.equal(s.prompt.kind, "counter");
  assert.ok(labelsG(s).some((x) => x.startsWith("Counter with COUNTER_RR")), "the red [Counter] is reduced to {r}");
  assert.ok(!labelsG(s).some((x) => x.startsWith("Counter with COUNTER_UU")), "the blue card still costs {r}{r}");
  s = playG(s, { type: "counter", player: "p1", card: null }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }, {
    type: "endMain",
    player: "p1",
  }, { type: "charge", player: "p2", card: null });
  s.cards[zoneOf(s, "p1", "energy")[0]].mode = "rest";
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") });
  assert.equal(s.prompt.kind, "combo", "once `until` passes, 1 energy no longer offers the {r}{r} counter");
  assertConsistentG(s);
}

if (!notYetGap("[Burst X] (22-27)", "no `DEFINE COST` in dbs/costs.rules consumes cards from the top of the deck yet — the seven declared kinds are energy, zEnergy, marker, life, rest, payWith and text, so the activation's price is unread and the skill is refused rather than offered", "no issue filed yet")) {
  // [Burst X] (22-27): X cards from the top of the deck to the Drop as a cost;
  // with fewer than X cards in the deck the cost cannot be paid.
  DEFS.BURSTER = { ...DEFS.V1, id: "BURSTER", name: "BURSTER", skill: "[Burst 2][Activate: Main] Draw 1 card." };
  let s = arenaG({ battle: ["BURSTER"] });
  const b = zoneOf(s, "p1", "battle")[0];
  assert.ok(canActivateG(s, b), "22-27: offered with a deck to burn");
  const deck = zoneOf(s, "p1", "deck").length;
  const hand = zoneOf(s, "p1", "hand").length;
  const drop = zoneOf(s, "p1", "drop").length;
  s = playG(s, { type: "activate", player: "p1", card: b, skill: 0 });
  assert.equal(zoneOf(s, "p1", "drop").length, drop + 2, "22-27-2: two cards to the Drop as the cost");
  assert.equal(zoneOf(s, "p1", "hand").length, hand + 1, "then the skill resolves");
  assert.equal(zoneOf(s, "p1", "deck").length, deck - 3);
  assertConsistentG(s);

  const d = arenaG({ battle: ["BURSTER"] });
  zoneOf(d, "p1", "deck").splice(1).forEach((id) => zoneOf(d, "p1", "drop").push(id));
  assert.ok(!canActivateG(d, zoneOf(d, "p1", "battle")[0]), "22-27-3: one card in the deck is not enough for [Burst 2]");
}

if (
  !notYetGap(
    "SPIRIT: [Spirit Boost 2] over a Unison's own markers",
    "the marker cost's own `n: amount` (dbs/costs.rules' `DEFINE COST marker`) is bound from an activation's line the same way a skill-line marker cost is (#147) — checked directly rather than trusted: with 3 markers on the Unison the skill is still not offered, so the bound amount for a keyword-shaped [Spirit Boost N] price is not reaching the planner the way explicit price text does",
    "no issue filed yet",
  )
) {
  // [Spirit Boost X] (22-43): X markers off your Unison as a cost.
  DEFS.SPIRIT = { ...DEFS.V1, id: "SPIRIT", name: "SPIRIT", skill: "[Spirit Boost 2][Activate: Main] Draw 1 card." };
  let s = arenaG({ battle: ["SPIRIT"], hand: ["U1"], energy: ["V1", "V1", "V1"] });
  const sp = zoneOf(s, "p1", "battle")[0];
  assert.ok(!canActivateG(s, sp), "22-43-3: no Unison, no Spirit Boost");
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "U1"), x: 3 });
  const u = unisonOf(s, "p1")!;
  assert.ok(canActivateG(s, sp));
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "activate", player: "p1", card: sp, skill: 0 });
  assert.equal(s.cards[u].markers, 1, "22-43-2: two markers removed as the cost");
  assert.equal(zoneOf(s, "p1", "hand").length, hand + 1);
  assert.ok(!canActivateG(s, sp), "one marker left is not enough for a second use");
  assertConsistentG(s);
}

if (!notYetGap("SPIRIT2/BOOSTWATCH/UWATCH: watching a [Spirit Boost] payment", "the same [Spirit Boost] activation gap as SPIRIT above — the skill is never offered, so the payment it would watch never happens", "no issue filed yet")) {
  // 22-43-3: sixteen cards watch the [Spirit Boost] *payment* rather than the
  // marker, from both ends — the Unison the markers came off and the Battle
  // Cards watching it. An attack knocking markers off is not their moment.
  DEFS.SPIRIT2 = { ...DEFS.V1, id: "SPIRIT2", name: "SPIRIT2", skill: "[Spirit Boost 1][Activate: Main] Draw 1 card." };
  DEFS.BOOSTWATCH = { ...DEFS.V1, id: "BOOSTWATCH", name: "BOOSTWATCH", skill: "[Auto] When you remove a marker from one of your Unison Cards using a [Spirit Boost] skill, draw 1 card." };
  DEFS.UWATCH = { ...DEFS.U1, id: "UWATCH", name: "UWATCH", skill: "[Auto] When you remove a marker from this card using a [Spirit Boost] skill, draw 1 card." };
  let s = arenaG({ battle: ["SPIRIT2", "BOOSTWATCH"], hand: ["UWATCH"], energy: ["V1", "V1", "V1"] });
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "UWATCH"), x: 3 });
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "activate", player: "p1", card: zoneOf(s, "p1", "battle")[0], skill: 0 });
  // The skill itself draws one, the Unison's own [Auto] one, the watcher one.
  assert.equal(zoneOf(s, "p1", "hand").length, hand + 3, "22-43-3: both ends of the payment fire");
  assertConsistentG(s);
}

if (
  !notYetGap(
    "RESTWATCH/RESTER: \"switched to Rest Mode by one of your skills\" (1-10)",
    "checked directly rather than trusted: the watcher's [Auto] does not pend on the rules engine when a skill program switches another card to Rest Mode — the trigger-moment pattern this wording compiles to is not yet one `dbs/triggers.rules` matches the same way `moveTo`'s own moments are",
    "no issue filed yet",
  )
) {
  // 1-10: "when this card is switched to Rest Mode by one of your skills" —
  // your skill and your card, so an opponent resting it is a different moment
  // and this does not fire.
  DEFS.RESTWATCH = { ...DEFS.V1, id: "RESTWATCH", name: "RESTWATCH", skill: "[Auto] When this card is switched to Rest Mode by one of your skills, draw 1 card." };
  DEFS.RESTER = { ...DEFS.V1, id: "RESTER", name: "RESTER", energyCost: 1, skill: "[Auto] When you play this card, switch up to 1 of your Battle Cards to Rest Mode." };
  let s = arenaG({ hand: ["RESTER"], battle: ["RESTWATCH"], energy: ["V1"] });
  const watcher = zoneOf(s, "p1", "battle")[0];
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "RESTER") });
  s = playG(s, { type: "choose", player: "p1", cards: [watcher] });
  assert.equal(s.cards[watcher].mode, "rest");
  assert.equal(zoneOf(s, "p1", "hand").length, hand - 1 + 1, "one played, one drawn by the rested card");
  assertConsistentG(s);
}

if (
  !notYetGap(
    "COMBOWATCH: \"when you use a card in a combo\" (5-7)",
    "checked directly rather than trusted: the watcher's [Auto] does not pend on the rules engine when a card is combo'd — the trigger moment this wording compiles to is not yet one `dbs/triggers.rules` matches the way the `combo` native move's own `moved()` beat does",
    "no issue filed yet",
  )
) {
  // 5-7: "when you use a card in a combo" is the board's moment, watched by
  // your own cards in play — not the combo card's own skill, which is
  // `comboed` and fires when it leaves the Combo Area (8-5-8).
  DEFS.COMBOWATCH = { ...DEFS.V1, id: "COMBOWATCH", name: "COMBOWATCH", skill: "[Auto] When you use a card in a combo, draw 1 card." };
  let s = arenaG({ hand: ["V1"], battle: ["COMBOWATCH"] });
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "combo", player: "p1", card: findG(s, "p1", "hand", "V1") });
  assert.equal(zoneOf(s, "p1", "hand").length, hand - 1 + 1, "one combo'd, one drawn");
  assertConsistentG(s);
}

if (!keywordGap("Arrival", S7.arrival)) {
  // [Arrival X/Y] (22-29): from hand during a battle, once cards of both
  // colours are in the Combo Area; the effect is playing the card.
  DEFS.ARRIVER = { ...DEFS.V1, id: "ARRIVER", name: "ARRIVER", energyCost: 4, power: 20000, skill: "[Arrival red/blue] {r}" };
  let s = arenaG({ hand: ["ARRIVER", "V1", "V-BLUE"], energy: ["V1", "V1"] });
  const arr = findG(s, "p1", "hand", "ARRIVER");
  assert.ok(!canActivateG(s, arr), "22-29-4: not in the Main Phase");
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  assert.ok(!canActivateG(s, arr), "no combo cards yet");
  s = playG(s, { type: "combo", player: "p1", card: findG(s, "p1", "hand", "V1") });
  assert.ok(!canActivateG(s, arr), "red alone is not red and blue");
  s = playG(s, { type: "combo", player: "p1", card: findG(s, "p1", "hand", "V-BLUE") });
  assert.ok(canActivateG(s, arr), "22-29-3: both colours are in the Combo Area");
  s = playG(s, { type: "activate", player: "p1", card: arr, skill: 0 });
  assert.ok(zoneOf(s, "p1", "battle").includes(arr), "22-29-5: the card is played");
  assert.equal(zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest").length, 1, "for {r}, not its printed cost");
  assert.equal(s.prompt.kind, "combo", "and the battle goes on");
  assert.equal((s.prompt as { side: string }).side, "offense");
  assertConsistentG(s);
}

if (!keywordGap("Empower", S7.empower)) {
  // [Empower X Y] (22-45-3, owner's ruling 9 Sep 2026): a Unison replacing one
  // of colour X *may* carry up to Y of its markers over — a choice the master
  // makes, not an automatic maximum, so playing it asks rather than deciding
  // for them. This used to assert the maximum was applied with no question
  // asked; that was the bug 22-45-3's "may" describes, not a description of it.
  DEFS.EMP = { ...DEFS.U1, id: "EMP", name: "EMP", skill: "[Empower Red 2]" };
  let s = arenaG({ hand: ["U1", "EMP"], energy: ["V1", "V1", "V1", "V1", "V1"] });
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "U1"), x: 3 });
  const old = unisonOf(s, "p1")!;
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "EMP"), x: 1 });
  assert.equal(s.prompt.kind, "empowerCarry", "22-45-3: carrying is asked, not assumed");
  assert.equal((s.prompt as { from: string }).from, old);
  assert.equal((s.prompt as { max: number }).max, 2, "capped by the printed Y of 2, though the old Unison had 3 markers");
  s = playG(s, { type: "empowerCarry", player: "p1", amount: 2 });
  const emp = unisonOf(s, "p1")!;
  assert.equal(s.cards[emp].cardId, "EMP");
  assert.ok(zoneOf(s, "p1", "drop").includes(old), "13-2-3: the old Unison went to the Drop");
  assert.equal(s.cards[emp].markers, 3, "22-45-2: 1 paid plus 2 carried over (of the 3 it had)");
  assertConsistentG(s);
}

if (!keywordGap("Empower", S7.empower)) {
  // Choosing fewer than the maximum — including none at all — is just as
  // legal an answer, and is the whole point of the choice existing.
  DEFS.EMP2 = { ...DEFS.U1, id: "EMP2", name: "EMP2", skill: "[Empower Red 2]" };
  let s = arenaG({ hand: ["U1", "EMP2"], energy: ["V1", "V1", "V1", "V1", "V1"] });
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "U1"), x: 3 });
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "EMP2"), x: 1 });
  assert.equal(s.prompt.kind, "empowerCarry");
  s = playG(s, { type: "empowerCarry", player: "p1", amount: 0 });
  const emp2 = unisonOf(s, "p1")!;
  assert.equal(s.cards[emp2].markers, 1, "22-45-3: declining the carry leaves only the marker paid for");
  assertConsistentG(s);
}

{
  // Issue #96 — the **specified** cost, and the reducer that relaxes it.
  //
  // The owner's ruling of 9 Sep 2026 on BT19-039, read off 13-2-1-3 and
  // 20-21-2: "reduce the specified cost of this card in your hand by {u}"
  // moves the *colour* requirement (2 blue down to 1 blue) and nothing else.
  // The total stays X, the master still picks it, and the Unison arrives with
  // markers equal to the total paid — so paying less means arriving with
  // fewer, which is the interaction the ruling is really about.
  //
  // GOTEN is BT19-039's shape: a blue Unison with an X cost whose print
  // demands 2 blue. The catalog carries no cost orbs for any card, so no real
  // card can say that yet (`specifiedCostOf` refuses to guess, and
  // `npm run arena:specified` lists what is waiting) — the def says it here,
  // which is the mechanism under test either way.
  DEFS.TRUNKS = { ...DEFS.V1, id: "TRUNKS", name: "TRUNKS", colors: ["Blue"], characters: ["Trunks"] };
  DEFS.GOTEN = {
    ...DEFS.U1,
    id: "GOTEN",
    name: "GOTEN",
    colors: ["Blue"],
    specifiedCost: { Blue: 2 },
    skill: "[Permanent] If you have a card with <Trunks> in its character name in play, reduce the specified cost of this card in your hand by {u}.",
  };

  // No <Trunks>, no reduction: one blue among three energy cannot answer two
  // blue orbs, so no value of X is on the menu — and the refusal names the
  // colour rather than leaving a dead card with no answer.
  let s = arenaG({ hand: ["GOTEN"], energy: ["V-BLUE", "V1", "V1"] });
  const cold = findG(s, "p1", "hand", "GOTEN");
  assert.ok(
    !actsG(s).some((a) => a.type === "playUnison" && a.card === cold),
    "2 blue is not met by 1 blue, whatever the player picks for X",
  );
  // `rejections.ts` words a card in hand as one "play" refusal whatever its
  // type, so that is where a Unison's answer arrives.
  if (
    !notYetGap(
      "GOTEN: a Unison priced entirely out of reach carries a \"play\" rejection",
      "checked directly rather than trusted: `rejectedActionsG` finds no rejection at all for the card here, where the legacy engine's own `rejections.ts` words a Unison's shortfall as a \"play\" refusal — a real gap in the rules engine's rejection reasoning for `playUnison`, not this issue's to fix",
      "no issue filed yet",
    )
  ) {
    const refused = rejectedActionsG(s).find((r) => r.action.type === "play" && r.action.card === cold);
    assert.ok(refused, "and the move is refused rather than silently absent");
    const colour = refused.why.find((r) => r.kind === "energyColour");
    assert.ok(colour, `the reason is the colour it is short of, not the total (got ${JSON.stringify(refused.why)})`);
    assert.equal(sentence(colour, { name: "GOTEN", reaching: "playUnison" }), "GOTEN needs 2 Blue energy — 1 active. Charge a Blue card.");
  }

  // With a <Trunks> in play the requirement is one blue, which the board can
  // answer — and every X from 1 to the energy available is offered, because
  // the reduction never touched the total.
  s = arenaG({ hand: ["GOTEN"], battle: ["TRUNKS"], energy: ["V-BLUE", "V1", "V1"] });
  const warm = findG(s, "p1", "hand", "GOTEN");
  const offers = IMPL.legalActions(CTX, s).filter((a) => a.action.type === "playUnison" && a.action.card === warm);
  assert.deepEqual(
    offers.map((a) => (a.action as { x: number }).x),
    [1, 2, 3],
    "20-21-2: the colour requirement moved, the total did not",
  );
  assert.deepEqual(offers[0].cost?.orbs, { Blue: 1 }, "one blue off two leaves one, and the row carries it");
  const view = IMPL.boardView(CTX, s, "p1", {}).you.hand!.find((c) => c.name === "GOTEN")!;
  assert.equal(priceOf(offers[2].action, view, offers[2].label, offers[2].cost), "3 markers (1 blue)", "the price sentence shows the relaxed requirement");

  // 20-5: the same promise for an X *skill* price. The number on the row and
  // the sentence beside it are one figure: patched on after the fact, the
  // energy moved and the words stayed, and "Activate XDRAW with X = 3" read
  // "free" on the action sheet while three energy was charged. Driven through
  // `legalActions` rather than `priceOf` alone, because the defect was in what
  // the engine handed over, not in how the sentence was assembled.
  if (
    !notYetGap(
      "XDRAW: an X *skill* price (20-5)",
      "`actions.rules`'s own header names this gap: an X price on a skill line is refused `unread` for the same reason a play's X cost is, so no X = 3 offer reaches the menu",
      "no issue filed yet",
    )
  ) {
    let xs = arenaG({ hand: ["XDRAW"], energy: ["V1", "V1", "V1", "V1"] });
    xs = playG(xs, { type: "play", player: "p1", card: findG(xs, "p1", "hand", "XDRAW") });
    while (xs.prompt.kind !== "main") xs = playG(xs, IMPL.legalActions(CTX, xs)[0].action);
    const body = findG(xs, "p1", "battle", "XDRAW");
    const paid = IMPL.legalActions(CTX, xs).filter((a) => a.action.type === "activate" && a.action.card === body);
    const three = paid.find((a) => (a.action as { x?: number }).x === 3)!;
    assert.ok(three, "X = 3 is on the menu");
    assert.equal(three.cost?.energy, 3, "the row carries the X that will be charged");
    const xView = IMPL.boardView(CTX, xs, "p1", {}).you.battle!.find((c) => c.name === "XDRAW")!;
    assert.equal(priceOf(three.action, xView, three.label, three.cost), "3 energy", "…and the sentence names the same number");
    // X = 0 is a real offer and really is free, so the wording is not simply
    // "always name a number".
    const none = paid.find((a) => (a.action as { x?: number }).x === 0)!;
    assert.equal(priceOf(none.action, xView, none.label, none.cost), "free");
  }

  // 13-2-1-3: the markers are the **total** paid, not the coloured part — pay
  // three and it arrives with three, of which only one had to be blue.
  s = playG(s, offers[2].action);
  const unison = unisonOf(s, "p1")!;
  assert.equal(s.cards[unison].cardId, "GOTEN");
  assert.equal(s.cards[unison].markers, 3, "13-2-1-3: markers equal the energy rested, X and not the specified part");
  assert.equal(zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest").length, 3, "and all three were actually paid");
  assertConsistentG(s);

  // Paying less means arriving with fewer, which is the consequence the
  // ruling spells out: X = 1 buys one marker, and one blue is all it needs.
  s = arenaG({ hand: ["GOTEN"], battle: ["TRUNKS"], energy: ["V-BLUE", "V1", "V1"] });
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "GOTEN"), x: 1 });
  const small = unisonOf(s, "p1")!;
  assert.equal(s.cards[small].markers, 1, "paying less arrives with fewer markers");
  assert.equal(zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest" && s.cards[id].cardId === "V-BLUE").length, 1, "and the one orb paid was the blue one");
  assertConsistentG(s);
}

{
  // The floor under X, found by the review bot on the PR that added the rest
  // of this. `planPayment` fills the specified colours first and then tops up
  // to `total`, so a requirement *larger* than the total skipped the top-up
  // and handed back a payment bigger than the price asked for: GOTEN's two
  // blue orbs against a chosen X of 1 rested two energy and put two markers on
  // a card whose own offer said "1 marker". 1-2-2-2-1 lets the master pick X,
  // not pick it below what the card demands, so the menu now starts at the orb
  // count — and `planPayment` refuses such a pair outright, so no other caller
  // can overpay through it either.
  let s = arenaG({ hand: ["GOTEN"], battle: ["TRUNKS"], energy: ["V-BLUE", "V-BLUE", "V1"] });
  const floored = IMPL.legalActions(CTX, s).filter((a) => a.action.type === "playUnison");
  assert.deepEqual(
    floored.map((a) => (a.action as { x: number }).x),
    [1, 2, 3],
    "with <Trunks> the requirement is one blue, so X = 1 is genuinely payable",
  );

  s = arenaG({ hand: ["GOTEN"], energy: ["V-BLUE", "V-BLUE", "V1"] });
  const unreduced = IMPL.legalActions(CTX, s).filter((a) => a.action.type === "playUnison");
  assert.deepEqual(
    unreduced.map((a) => (a.action as { x: number }).x),
    [2, 3],
    "without it the two blue orbs are the floor: X = 1 would rest two energy for a one-marker offer",
  );
  // The offer and what it costs are the same number, which is the whole point.
  s = playG(s, unreduced[0].action);
  const paid = unisonOf(s, "p1")!;
  assert.equal(s.cards[paid].markers, 2, "the 2-marker offer arrives with 2 markers");
  assert.equal(zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest").length, 2, "and rested exactly the two it named");
  assertConsistentG(s);

  // The planner's own guard, asked directly: no caller can be handed a payment
  // larger than the price it asked for. `planPayment` itself is legacy-only —
  // `vm/costs.ts`'s own planner carries the same guard (`verify/vm.ts` §17
  // asserts it board for board against this one), so this direct call stays
  // on the engine it names rather than gaining a `G` twin for one assertion.
  if (ENGINE === "legacy") assert.equal(planPayment(CTX, legacyState(s), "p1", 1, { Blue: 2 }), null, "a price demanding more orbs than it charges is unpayable, not cheap");
}

if (!keywordGap("Successor", S7.successor)) {
  // [Successor] (22-38): from hand by dropping green/yellow Battle Cards
  // whose costs add up exactly to this card's cost; picked one at a time,
  // and only cards that still leave a way to the exact sum are offered.
  DEFS.SUCC = { ...DEFS.V1, id: "SUCC", name: "SUCC", colors: ["Green", "Yellow"], energyCost: 5, power: 25000, skill: "[Successor]{g}{y}" };
  DEFS.G2 = { ...DEFS.V1, id: "G2", name: "G2", colors: ["Green"], energyCost: 2 };
  DEFS.Y3 = { ...DEFS.V1, id: "Y3", name: "Y3", colors: ["Yellow"], energyCost: 3 };
  DEFS.G4 = { ...DEFS.V1, id: "G4", name: "G4", colors: ["Green"], energyCost: 4 };
  let s = arenaG({ hand: ["SUCC"], battle: ["G2", "Y3", "G4"], energy: ["G2", "Y3"] });
  const succ = findG(s, "p1", "hand", "SUCC");
  const [g2, y3, g4] = zoneOf(s, "p1", "battle");
  assert.ok(
    labelsG(s).some((x) => x.startsWith("Successor: play SUCC")),
    "22-38-2: a sum of 5 exists (2 + 3)",
  );
  s = playG(s, { type: "activate", player: "p1", card: succ, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [g2, y3], "4 alone can never reach 5, so it is not offered");
  s = playG(s, { type: "choose", player: "p1", cards: [g2] });
  assert.equal(s.prompt.kind, "chooseCards", "3 more to find");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [y3]);
  s = playG(s, { type: "choose", player: "p1", cards: [y3] });
  assert.ok(zoneOf(s, "p1", "battle").includes(succ), "22-38-4: played");
  assert.ok(zoneOf(s, "p1", "drop").includes(g2) && zoneOf(s, "p1", "drop").includes(y3), "22-38-3: the chosen cards were dropped");
  assert.ok(zoneOf(s, "p1", "battle").includes(g4), "the rest stay");
  assert.ok(
    zoneOf(s, "p1", "energy").every((id) => s.cards[id].mode === "rest"),
    "{g}{y} was paid",
  );
  assertConsistentG(s);

  const n = arenaG({ hand: ["SUCC"], battle: ["G4", "G4"], energy: ["G2", "Y3"] });
  assert.ok(!labelsG(n).some((x) => x.startsWith("Successor")), "4 + 4 is not 5");
}

if (!keywordGap("Aegis", S7.aegis)) {
  // [Aegis X/Y] (22-30): in the Defense Step of the opponent's turn only; drop
  // one card of each colour from hand, then up to two energy go active.
  DEFS.AEG = { ...DEFS.V1, id: "AEG", name: "AEG", skill: "[Aegis red/blue] {r}" };
  let s = arenaG({ battle: ["AEG"], hand: ["V1", "V-BLUE"], energy: ["V1", "V1", "V1"] });
  const aeg = zoneOf(s, "p1", "battle")[0];
  assert.ok(!canActivateG(s, aeg), "22-30-4: not in your own Main Phase");
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const [e1, e2, e3] = zoneOf(s, "p1", "energy");
  s.cards[e1].mode = "rest";
  s.cards[e2].mode = "rest";
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") });
  assert.ok(!canActivateG(s, aeg), "22-30-4: not in the Offense Step");
  s = playG(s, { type: "pass", player: "p2" });
  assert.equal((s.prompt as { side: string }).side, "defense");
  assert.ok(
    labelsG(s).some((x) => x.startsWith("Aegis Red/Blue")),
    "22-30-4: the Defense Step of the opponent's turn",
  );
  s = playG(s, { type: "activate", player: "p1", card: aeg, skill: 0 });
  assert.equal(s.cards[e3].mode, "rest", "the {r} was paid");
  assert.equal(s.prompt.kind, "chooseCards");
  const v1 = findG(s, "p1", "hand", "V1");
  const vb = findG(s, "p1", "hand", "V-BLUE");
  s = playG(s, { type: "choose", player: "p1", cards: [v1] });
  assert.equal(s.prompt.kind, "chooseCards", "one colour down, one to go");
  const rest = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(rest.includes(vb) && !rest.includes(v1), "the picked card is off the menu");
  s = playG(s, { type: "choose", player: "p1", cards: [vb] });
  assert.ok(zoneOf(s, "p1", "drop").includes(v1) && zoneOf(s, "p1", "drop").includes(vb), "22-30-3: both dropped as the cost");
  assert.equal(s.prompt.kind, "chooseCards", "22-30-5: which energy to stand");
  s = playG(s, { type: "choose", player: "p1", cards: [e1] }, { type: "choose", player: "p1", cards: [e2] });
  assert.equal(s.cards[e1].mode, "active");
  assert.equal(s.cards[e2].mode, "active");
  assert.equal(s.cards[e3].mode, "rest", "up to two, not all");
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { side: string }).side, "defense", "back to the Defense Step");
  assertConsistentG(s);
}

if (!keywordGap("Revive", S7.revive)) {
  // [Revive X/Y] (22-34): KO'd, its owner may drop cards from hand covering
  // both colours to play it back from the Drop — once per card per turn.
  DEFS.REV = { ...DEFS.V1, id: "REV", name: "REV", skill: "[Revive red/blue]" };
  let s = arenaG({ battle: ["REV"], hand: ["V1", "V-BLUE", "V1", "V-BLUE"], oppBattle: ["DOUBLE"] });
  const rev = zoneOf(s, "p1", "battle")[0];
  s.cards[rev].mode = "rest";
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const dbl = zoneOf(s, "p2", "battle")[0];
  s = playG(s, { type: "attack", player: "p2", attacker: dbl, target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(zoneOf(s, "p1", "drop").includes(rev), "20000 into 10000: KO'd");
  assert.equal(s.prompt.kind, "chooseCards", "22-34-3: the owner is asked");
  assert.equal((s.prompt as { player: string }).player, "p1");
  const v1 = findG(s, "p1", "hand", "V1");
  const vb = findG(s, "p1", "hand", "V-BLUE");
  s = playG(s, { type: "choose", player: "p1", cards: [v1] }, { type: "choose", player: "p1", cards: [vb] });
  assert.ok(zoneOf(s, "p1", "battle").includes(rev), "22-34-4: played from the Drop");
  assert.ok(zoneOf(s, "p1", "drop").includes(v1) && zoneOf(s, "p1", "drop").includes(vb), "the cost was dropped");
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p2");
  // KO'd again the same turn: [Revive] is negated on it (22-34-4), no question asked.
  s.cards[rev].mode = "rest";
  const handBefore = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(zoneOf(s, "p1", "drop").includes(rev), "KO'd by the 10000 leader on a tie");
  assert.equal(s.prompt.kind, "main", "no second Revive this turn");
  assert.equal(zoneOf(s, "p1", "hand").length, handBefore, "and nothing was dropped");
  assertConsistentG(s);

  // Declining keeps the card in the Drop and the hand whole.
  let d = arenaG({ battle: ["REV"], hand: ["V1", "V-BLUE"], oppBattle: ["DOUBLE"] });
  const r2 = zoneOf(d, "p1", "battle")[0];
  d.cards[r2].mode = "rest";
  d = playG(d, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  d = playG(d, { type: "attack", player: "p2", attacker: zoneOf(d, "p2", "battle")[0], target: r2 }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.equal(d.prompt.kind, "chooseCards");
  const kept = zoneOf(d, "p1", "hand").length;
  d = playG(d, { type: "choose", player: "p1", cards: [] });
  assert.ok(zoneOf(d, "p1", "drop").includes(r2));
  assert.equal(zoneOf(d, "p1", "hand").length, kept);
}

if (!keywordGap("Rejuvenate", S7.rejuvenate)) {
  // [Rejuvenate] (22-42): a Unison drops a card from beneath itself and pays
  // the printed marker cost; the top card of the deck becomes life.
  DEFS.REJ = { ...DEFS.U1, id: "REJ", name: "REJ", skill: "[Rejuvenate] Remove 2 markers from this card." };
  let s = arenaG({ hand: ["REJ", "REJ"], energy: ["V1", "V1", "V1"] });
  s = playG(s, { type: "playUnison", player: "p1", card: findG(s, "p1", "hand", "REJ"), x: 3 });
  const u = unisonOf(s, "p1")!;
  assert.ok(!canActivateG(s, u), "22-42-3: nothing beneath it yet");
  const copy = findG(s, "p1", "hand", "REJ");
  s = playG(s, { type: "growUnison", player: "p1", card: copy });
  assert.equal(s.cards[u].markers, 4);
  assert.ok(labelsG(s).some((x) => x.startsWith("Rejuvenate: 2 markers")));
  const life = zoneOf(s, "p1", "life").length;
  const top = zoneOf(s, "p1", "deck")[0];
  s = playG(s, { type: "activate", player: "p1", card: u, skill: 0 });
  assert.equal(s.cards[u].markers, 2, "22-42-3: the marker cost");
  assert.deepEqual(s.cards[u].under, [], "and the card beneath");
  assert.ok(zoneOf(s, "p1", "drop").includes(copy));
  assert.equal(zoneOf(s, "p1", "life").length, life + 1, "22-42-4: the top card of the deck to life");
  assert.ok(zoneOf(s, "p1", "life").includes(top));
  assert.ok(!canActivateG(s, u), "13-4-2: one marker skill per card per turn");
  assertConsistentG(s);
}

if (!notYetGap("a prompt for more than one card, answered one at a time", "`continuations` is a legacy-only field of `GameState` — the rules engine's own multi-card choice has no continuation slot to stage this fixture onto", "no issue filed yet")) {
  // A prompt for more than one card is answered one card at a time, with
  // "Done choosing" once the minimum is met.
  let s = arena({ hand: ["V1", "V1", "V1"] });
  const [a, b, c] = s.players.p1.hand;
  s.prompt = { kind: "chooseCards", player: "p1", choice: { reason: "test", candidates: [a, b, c], min: 1, max: 2, continuation: "swap" } };
  s.continuations.swap = { card: a };
  assert.ok(!labels(s).includes("Choose none"), "one is required");
  s = play(s, { type: "choose", player: "p1", cards: [a] });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[]; min: number; max: number } }).choice.candidates, [b, c]);
  assert.ok(labels(s).includes("Done choosing"), "the minimum is met");
  assert.throws(() => play(s, { type: "choose", player: "p1", cards: [a] }), /invalid choice/, "a card cannot be picked twice");
}

if (!keywordGap("Alliance", S7.alliance)) {
  // [Alliance X/Y] (22-32): as it attacks, its owner may rest other Battle
  // Cards of the named colours; the printed effect then reads "the total
  // power of the cards switched to Rest Mode by this skill" off those cards.
  DEFS.ALLY = {
    ...DEFS.V1,
    id: "ALLY",
    name: "ALLY",
    colors: ["Red", "Green"],
    energyCost: 3,
    skill: "[Alliance Red/Green] This card gains power equal to the total power of the cards switched to Rest Mode by this skill and [Double Strike] for the battle, then draw 1 card.",
  };
  DEFS.GRN = { ...DEFS.V1, id: "GRN", name: "GRN", colors: ["Green"], power: 15000 };
  let s = arenaG({ battle: ["ALLY", "V1", "GRN", "V-BLUE"], oppBattle: ["BIG"] });
  const [ally, v1, grn] = zoneOf(s, "p1", "battle");
  const big = zoneOf(s, "p2", "battle")[0];
  s.cards[big].mode = "rest";
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "attack", player: "p1", attacker: ally, target: big });
  assert.equal(s.prompt.kind, "chooseCards", "22-32-3: asked which cards to rest");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [v1, grn], "red or green, active, and not the attacker");
  s = playG(s, { type: "choose", player: "p1", cards: [v1] }, { type: "choose", player: "p1", cards: [grn] });
  assert.equal(s.cards[v1].mode, "rest");
  assert.equal(s.cards[grn].mode, "rest");
  assert.equal(zoneOf(s, "p1", "hand").length, hand + 1, "then draw 1 card");
  assert.equal(s.prompt.kind, "combo");
  s = playG(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(s, "p2", "drop").includes(big), "10000 + (10000 + 15000) beats 25000");
  assertConsistentG(s);

  // Declining rests nothing and the attack is what it was.
  let d = arenaG({ battle: ["ALLY", "V1"], oppBattle: ["BIG"] });
  const b2 = zoneOf(d, "p2", "battle")[0];
  d.cards[b2].mode = "rest";
  d = playG(d, { type: "attack", player: "p1", attacker: zoneOf(d, "p1", "battle")[0], target: b2 }, { type: "choose", player: "p1", cards: [] });
  assert.equal(d.cards[zoneOf(d, "p1", "battle")[1]].mode, "active");
  d = playG(d, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(d, "p2", "battle").includes(b2), "10000 into 25000 does nothing");

  // Nothing of the right colours to rest: no question.
  let n = arenaG({ battle: ["ALLY", "V-BLUE"], oppBattle: ["BIG"] });
  n.cards[zoneOf(n, "p2", "battle")[0]].mode = "rest";
  n = playG(n, { type: "attack", player: "p1", attacker: zoneOf(n, "p1", "battle")[0], target: zoneOf(n, "p2", "battle")[0] });
  assert.equal(n.prompt.kind, "combo");

  // A printed condition on the keyword ("If your Leader Card is blue:") is
  // read before asking.
  DEFS.ALLYC = {
    ...DEFS.ALLY,
    id: "ALLYC",
    name: "ALLYC",
    skill: "[Alliance Red/Green] If your Leader Card is blue: This card gains power equal to the total power of the cards switched to Rest Mode by this skill for the battle.",
  };
  let c = arenaG({ battle: ["ALLYC", "V1"], oppBattle: ["BIG"] });
  c.cards[zoneOf(c, "p2", "battle")[0]].mode = "rest";
  c = playG(c, { type: "attack", player: "p1", attacker: zoneOf(c, "p1", "battle")[0], target: zoneOf(c, "p2", "battle")[0] });
  assert.equal(c.prompt.kind, "combo", "a red Leader: the skill does not apply");
}

if (!keywordGap("Invoker", S7.invoker)) {
  // [Invoker] (22-37): a Red/Blue multicolour Extra can be paid for by resting
  // one active Red/Blue multicolour energy instead of its energy cost.
  DEFS.INVK = { ...DEFS.V1, id: "INVK", name: "INVK", colors: ["Red", "Blue"], skill: "[Invoker]" };
  DEFS["E-RB"] = { ...DEFS["E-DRAW"], id: "E-RB", name: "E-RB", colors: ["Red", "Blue"], energyCost: 2 };
  DEFS.RB = { ...DEFS.V1, id: "RB", name: "RB", colors: ["Red", "Blue"] };
  let s = arenaG({ hand: ["E-RB"], battle: ["INVK"], energy: ["RB"] });
  const e = findG(s, "p1", "hand", "E-RB");
  const l = labelsG(s);
  assert.ok(!l.includes("Activate E-RB (2)"), "one energy cannot pay 2");
  assert.ok(
    l.some((x) => x.startsWith("Activate E-RB by resting a Red/Blue energy")),
    "22-37: [Invoker] in play and a Red/Blue energy active",
  );
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "activate", player: "p1", card: e, skill: 0, alt: true });
  assert.equal(s.cards[zoneOf(s, "p1", "energy")[0]].mode, "rest", "the Red/Blue energy was rested");
  assert.equal(zoneOf(s, "p1", "hand").length, hand - 1 + 2, "and the Extra resolved");
  assert.ok(zoneOf(s, "p1", "drop").includes(e));
  assertConsistentG(s);

  assert.ok(!labelsG(arenaG({ hand: ["E-RB"], energy: ["RB"] })).some((x) => x.includes("Invoker")), "no [Invoker] in play, no offer");
  assert.ok(!labelsG(arenaG({ hand: ["E-RB"], battle: ["INVK"], energy: ["V1"] })).some((x) => x.includes("Invoker")), "a mono-red energy will not do");
  assert.ok(!labelsG(arenaG({ hand: ["E-DRAW"], battle: ["INVK"], energy: ["RB"] })).some((x) => x.includes("Invoker")), "nor a mono-red Extra");
}

{
  // A condition written before the colon ("[Auto] If your Leader Card is
  // red: …") is part of the skill's validity (9-1-3). It used to land in
  // `cost` and be dropped, so the skill ran whatever the Leader was.
  const cond = compileSkill(parseSkills("[Auto] If your Leader Card is blue: When you play this card, draw 1 card.")[0]);
  assert.deepEqual(cond.unsupported, []);
  assert.equal(cond.ops.length, 1);
  assert.equal(cond.ops[0].op, "if");
  assert.deepEqual((cond.ops[0] as { then: unknown[] }).then, [{ op: "draw", n: 1 }]);
  // One the compiler cannot read fails the skill rather than running it anyway.
  const odd = compileSkill(parseSkills("[Auto] If the moon is full: When you play this card, draw 1 card.")[0]);
  assert.deepEqual(odd.ops, []);
  assert.ok(odd.unsupported.length > 0);

  DEFS.CONDDRAW = { ...DEFS.V1, id: "CONDDRAW", name: "CONDDRAW", energyCost: 1, skill: "[Auto] If your Leader Card is blue: When you play this card, draw 2 cards." };
  let s = arenaG({ hand: ["CONDDRAW"], energy: ["V1"] });
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "CONDDRAW") });
  assert.equal(zoneOf(s, "p1", "hand").length, hand - 1, "a red Leader: no draw");

  DEFS.CONDACT = { ...DEFS.V1, id: "CONDACT", name: "CONDACT", skill: "[Activate: Main] If your Leader Card is red: Draw 1 card." };
  DEFS.CONDACTB = { ...DEFS.V1, id: "CONDACTB", name: "CONDACTB", skill: "[Activate: Main] If your Leader Card is blue: Draw 1 card." };
  const a = arenaG({ battle: ["CONDACT", "CONDACTB"] });
  assert.ok(canActivateG(a, zoneOf(a, "p1", "battle")[0]), "the condition holds: offered");
  assert.ok(!canActivateG(a, zoneOf(a, "p1", "battle")[1]), "the condition fails: not offered");

  // The shapes the catalog prints most that used to be gaps.
  const read = (t: string) => parseConditionClause(t)?.cond;
  assert.deepEqual(read("if this card has 3 or more markers on it"), { kind: "markers", sel: { special: "self" }, atLeast: 3 });
  assert.deepEqual(read("if this card is in a battle"), { kind: "inBattle", sel: { special: "self" } });
  assert.deepEqual(read("if this card isn't in a battle"), { kind: "inBattle", sel: { special: "self" }, not: true });
  assert.equal(read("if your Leader's back side is a black <Goku> card")?.kind, "leaderMatches");
  assert.ok((read("if your Leader's back side is a black <Goku> card") as { back?: boolean }).back);
  const either = read("when your life is at 4 or less, or you have 5 or more energy");
  assert.equal(either?.kind, "any");
  assert.deepEqual(
    (either as { conds: { kind: string }[] }).conds.map((x) => x.kind),
    ["life", "count"],
  );
  const bothOf = read("if your life is at 4 or less and you have 3 or more energy");
  assert.equal(bothOf?.kind, "all");
  assert.equal(read("if your life is at 4 or less, or the moon is full"), undefined, "one unreadable part fails the whole condition");
  assert.deepEqual(read("if your opponent's Leader Card's back is facing up"), { kind: "leaderFlipped", side: "opponent" });
  assert.deepEqual(read("if this card's power is 30000 or more"), { kind: "power", sel: { special: "self" }, atLeast: 30000 });
  const trait = read("if your Leader Card has ≪Saiyan≫ in its special trait");
  assert.equal(trait?.kind, "leaderMatches");
  assert.deepEqual(
    (trait as { filter: { traits: string[] } }).filter.traits.map((x) => x.toLowerCase()),
    ["saiyan"],
  );
  assert.equal(read("when your life is at 4 or less or your opponent's Leader Card's back is facing up")?.kind, "any");
  // "red or blue" and "4 or less" are not alternatives.
  assert.equal(read("if your Leader Card is red or blue")?.kind, "leaderMatches");

  DEFS.CONDOR = { ...DEFS.V1, id: "CONDOR", name: "CONDOR", skill: "[Activate: Main] If your life is at 4 or less or you have 1 or more energy: Draw 1 card." };
  const o = arenaG({ battle: ["CONDOR"], energy: ["V1"] });
  assert.ok(canActivateG(o, zoneOf(o, "p1", "battle")[0]), "8 life, but one energy: the other half holds");
  const o2 = arenaG({ battle: ["CONDOR"] });
  assert.ok(!canActivateG(o2, zoneOf(o2, "p1", "battle")[0]), "neither holds");
}

{
  // "Choose up to 1 of your opponent's Battle Cards with power less than or
  // equal to this card's power" used to read "this card" as the target and
  // pick the card itself. The bound is measured where the skill runs.
  const sc = compileSkill(
    parseSkills("[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with power less than or equal to this card's power, ignoring [Barrier], and KO it.")[0],
  );
  assert.deepEqual(sc.unsupported, []);
  const sel = (sc.ops[0] as { sel: { side?: string; area?: string; ignoreBarrier?: boolean; filter?: { powerRel: unknown } } }).sel;
  assert.equal(sel.side, "opponent");
  assert.equal(sel.area, "battle");
  assert.deepEqual(sel.filter?.powerRel, { of: "self", cmp: "<=" });
  assert.ok(sel.ignoreBarrier);
}

if (!notYetGap("RELKO: choose and KO a Battle Card", "a KO is a move a rule makes, and moves by skill (`h.ko`) are declared in #146", "#146")) {
  DEFS.RELKO = {
    ...DEFS.V1,
    id: "RELKO",
    name: "RELKO",
    power: 15000,
    skill: "[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with power less than or equal to this card's power and KO it.",
  };
  let s = arenaG({ battle: ["RELKO"], oppBattle: ["V-BLUE", "BIG"] });
  const [small, big] = zoneOf(s, "p2", "battle");
  s.cards[big].mode = "rest";
  s = playG(s, { type: "attack", player: "p1", attacker: zoneOf(s, "p1", "battle")[0], target: big });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [small], "10000 ≤ 15000; 25000 is not");
  s = playG(s, { type: "choose", player: "p1", cards: [small] });
  assert.ok(zoneOf(s, "p2", "drop").includes(small));
  assertConsistentG(s);
}

{
  // Wordings from the top of the "one clause away" list.
  const one = (text: string) => compileSkill(parseSkills(`[Auto] When you play this card, ${text}`)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // Several cards to several owners' areas.
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and return them to their owners' hands."), ["choose", "moveTo"]);
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and place them at the bottom of their owners' decks in any order."), ["choose", "moveTo"]);
  assert.equal((one("choose 2 of your opponent's Battle Cards and place them at the bottom of their owners' decks in any order.").ops[1] as { position?: string }).position, "bottom");
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and send them to their owners' Warps."), ["choose", "moveTo"]);

  // The top of the deck to the Drop, either side. The cards go face up, so the
  // mill names them for a clause that asks about them afterwards.
  assert.deepEqual(one("your opponent places the top card of their deck in their Drop Area.").ops, [{ op: "mill", n: 1, side: "opponent", as: "m0" }]);
  assert.deepEqual(one("place the top 2 cards of your deck in your Drop Area.").ops, [{ op: "mill", n: 2, as: "m0" }]);

  // BT2-001: "If that card is red" is a condition on the rest of the sentence,
  // and "that card" is the one the mill just put in the Drop. Before the mill
  // named it there was nothing for the phrase to point at, so the clause was
  // unread — and the ops it did produce gained the power every time.
  const vegito = one("place up to 1 card from the top of your deck in the Drop Area. If that card is red, this card gains +5000 power for the duration of the turn.");
  assert.deepEqual(vegito.unsupported, [], "the whole skill reads");
  assert.deepEqual(
    vegito.ops.map((o) => o.op),
    ["mill", "if"],
  );
  const milled = (vegito.ops[0] as { as: string }).as;
  const gate = vegito.ops[1] as { cond: { kind: string; var: string; filter: { colors: string[] } }; then: { op: string }[] };
  assert.equal(gate.cond.kind, "varMatches");
  assert.equal(gate.cond.var, milled, "the condition asks about the card the mill named");
  assert.deepEqual(gate.cond.filter.colors, ["Red"]);
  assert.deepEqual(
    gate.then.map((o) => o.op),
    ["power"],
    "and the power is inside the condition, not beside it",
  );

  // The comma was never the problem: the same sentence with a condition the
  // parser already knew read correctly all along.
  assert.deepEqual(one("if your Leader Card is red, draw 1 card.").unsupported, []);

  // The other wording for the same move reads the back-reference too.
  assert.deepEqual(one("place the top card of your deck in your Drop Area. If that card is red, draw 1 card.").unsupported, []);

  // "If that card is **not** a <Broly>": `parseFilter` drops the negation, so
  // reading it would hold for exactly the card the sentence excludes. It goes
  // to the referee instead — and, since 9 Sep 2026, so does the clause it
  // governs. Refusing the condition alone left the draw happening every time,
  // which is a wider skill than the card prints; the move before it is kept,
  // because nothing about it hangs on the condition that follows.
  assert.deepEqual(
    one("place the top card of your deck in your Drop Area. If that card is not a <Broly>, draw 1 card.").unsupported,
    ["If that card is not a <Broly>", "draw 1 card"],
    "a refused condition takes the clause it governs with it",
  );

  // A delay the table did not have.
  const later = one("at the start of your opponent's next Main Phase, draw 1 card.").ops[0] as { op: string; at?: string; scope?: string };
  assert.equal(later.op, "delay");
  assert.equal(later.at, "mainStart");
  assert.equal(later.scope, "opponentNextTurn");

  // Hidden Mode (23-5).
  assert.deepEqual(ops("choose 1 of your opponent's Battle Cards and switch it to Hidden Mode."), ["choose", "hidden"]);
  DEFS.HIDER = { ...DEFS.V1, id: "HIDER", name: "HIDER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and switch it to Hidden Mode." };
  let s = arenaG({ hand: ["HIDER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
  const vb = zoneOf(s, "p2", "battle")[0];
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "HIDER") });
  if (s.prompt.kind === "chooseCards") s = playG(s, { type: "choose", player: "p1", cards: [vb] });
  assert.equal(s.cards[vb].hidden, true, "23-5-1: face down in the Battle Area");
  assert.ok(zoneOf(s, "p2", "battle").includes(vb), "and still there");

  // "If you added a card to your hand" remembers what this skill did (20-16).
  const did = one("choose up to 1 card in your Drop Area and add it to your hand. If you added a card to your hand, draw 1 card.");
  assert.deepEqual(did.unsupported, []);
  const tail = did.ops[did.ops.length - 1] as { op: string; cond?: { kind: string; what?: string } };
  assert.equal(tail.op, "if");
  assert.deepEqual(tail.cond, { kind: "did", what: "addToHand" });
  DEFS.DIDDRAW = {
    ...DEFS.V1,
    id: "DIDDRAW",
    name: "DIDDRAW",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose up to 1 card in your Drop Area and add it to your hand. If you added a card to your hand, draw 1 card.",
  };
  let d = arenaG({ hand: ["DIDDRAW", "DIDDRAW"], energy: ["V1", "V1"] });
  let hand = zoneOf(d, "p1", "hand").length;
  d = playG(d, { type: "play", player: "p1", card: findG(d, "p1", "hand", "DIDDRAW") });
  if (d.prompt.kind === "chooseCards") d = playG(d, { type: "choose", player: "p1", cards: [] });
  assert.equal(zoneOf(d, "p1", "hand").length, hand - 1, "an empty Drop: nothing added, nothing drawn");
  const dropped = zoneOf(d, "p1", "deck")[0];
  stageMoveG(d, dropped, "drop", "p1");
  hand = zoneOf(d, "p1", "hand").length;
  d = playG(d, { type: "play", player: "p1", card: findG(d, "p1", "hand", "DIDDRAW") });
  assert.equal(d.prompt.kind, "chooseCards");
  d = playG(d, { type: "choose", player: "p1", cards: [dropped] });
  assert.equal(zoneOf(d, "p1", "hand").length, hand - 1 + 2, "the card from the Drop, then the draw it earned");
  assertConsistentG(d);
}

if (
  !notYetGap(
    "MUTER: \"negate its skills for the turn\" on another card (9-1-5)",
    "checked directly rather than trusted: `hasKeyword` (`vm/program.ts`) still reads [Blocker] after the `negateSkills` op runs — a `keyword`-kind effect's own negation is not among the sources `hasKeyword` reads yet (it checks a printed skill still showing, a `keyword`-kind grant, and a [Permanent] static, but not a `negateSkills`/`negateSkill` continuous effect the way legacy `has` does)",
    "no issue filed yet",
  )
) {
  // Negation for a duration (9-1-5) is a continuous effect: it was being
  // written into the state and never read, so "negate its skills for the
  // turn" did nothing — and the card was marked negated for the game as well.
  DEFS.MUTER = { ...DEFS.V1, id: "MUTER", name: "MUTER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate its skills for the turn." };
  assert.deepEqual(compileSkill(parseSkills(DEFS.MUTER.skill!)[0]).unsupported, []);
  let s = arenaG({ hand: ["MUTER"], energy: ["V1"], oppBattle: ["BLOCKER"] });
  const blocker = zoneOf(s, "p2", "battle")[0];
  assert.ok(hasG(s, blocker, "Blocker"));
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "MUTER") });
  if (s.prompt.kind === "chooseCards") s = playG(s, { type: "choose", player: "p1", cards: [blocker] });
  assert.ok(!hasG(s, blocker, "Blocker"), "negated for the turn");
  if (ENGINE === "legacy") assert.deepEqual(legacyState(s).cards[blocker].negated, [], "but not marked for the game");
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  assert.equal(s.prompt.kind, "combo", "no [Blocker] to offer");
  s = playG(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(hasG(s, blocker, "Blocker"), "back when the turn ends");
}

{
  // "Negate this skill for the turn" is the same idea for one skill.
  DEFS.SELFMUTET = { ...DEFS.V1, id: "SELFMUTET", name: "SELFMUTET", skill: "[Auto] When this card attacks, draw 1 card, then negate this skill for the turn." };
  const sc = compileSkill(parseSkills(DEFS.SELFMUTET.skill!)[0]);
  assert.deepEqual(sc.ops, [
    { op: "draw", n: 1 },
    { op: "negateOwnSkill", until: "turn" },
  ]);
  let t = arenaG({ battle: ["SELFMUTET"] });
  const sm = zoneOf(t, "p1", "battle")[0];
  const hand = zoneOf(t, "p1", "hand").length;
  t = playG(t, { type: "attack", player: "p1", attacker: sm, target: leaderOf(t, "p2") }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(zoneOf(t, "p1", "hand").length, hand + 1);
  assert.ok(skillNegatedG(t, sm, 0), "off for the rest of the turn");
  if (ENGINE === "legacy") assert.deepEqual(legacyState(t).cards[sm].negated, []);
  t = playG(t, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(!skillNegatedG(t, sm, 0), "and back next turn");
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const auto = (text: string) => one(`[Auto] When you play this card, ${text}`);

  // "{r}/{u}" is one orb payable with either colour — which is not the same as
  // one of *any* colour, and used to be folded into that.
  assert.deepEqual(orbsIn("{r}/{u}"), {});
  assert.deepEqual(eitherOrbsIn("{r}/{u}"), [["Red", "Blue"]]);
  assert.deepEqual(orbsIn("{r}/{u}{g}"), { Green: 1 });
  const either = parseSkills("[Activate: Main]{r}/{u}: Draw 1 card.")[0];
  assert.deepEqual(either.energyCost, {});
  assert.deepEqual(either.energyEither, [["Red", "Blue"]]);
  assert.equal(either.effect, "Draw 1 card.");

  // A discard that ends in the Warp.
  assert.deepEqual(auto("your opponent sends 1 card from their hand to their Warp.").ops, [{ op: "discard", n: 1, side: "opponent", to: "warp" }]);
  // The opponent's deck, to their Drop.
  assert.deepEqual(auto("place the top card of your opponent's deck into its owner's Drop.").ops, [{ op: "mill", n: 1, side: "opponent", as: "m0" }]);
  // Placed, not played.
  const placed = auto("place up to 2 {Dragon Ball} from your Drop into the Battle Area.").ops;
  assert.deepEqual(
    placed.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((placed[0] as { sel: { area?: string } }).sel.area, "drop");
  assert.equal((placed[1] as { to: string }).to, "battle");
  // Shuffled in.
  assert.deepEqual(
    auto("choose 1 card in your Drop Area and shuffle it into your deck.").ops.map((o) => o.op),
    ["choose", "moveTo", "shuffle"],
  );
  // "isn't in play".
  const absent = auto("if {Demonic Invasion Majin Buu} isn't in play in your Battle Area, draw 1 card.").ops[0] as { op: string; cond: { kind: string; atMost?: number } };
  assert.equal(absent.op, "if");
  assert.equal(absent.cond.kind, "count");
  assert.equal(absent.cond.atMost, 0);
  // A duration on its own belongs to the clause after it.
  const lock = auto("choose 1 of your opponent's Battle Cards. Until the end of your opponent's turn, it can't attack.");
  assert.deepEqual(lock.unsupported, []);
  assert.equal((lock.ops[1] as { until?: string }).until, "nextTurn");
  // "If you don't" is the opposite of "if you do".
  const either2 = auto("you may choose 1 card in your hand and discard it. If you don't, your opponent draws 1 card.");
  assert.deepEqual(either2.unsupported, []);
  assert.equal(either2.ops[either2.ops.length - 1].op, "if");
  assert.equal((either2.ops[either2.ops.length - 1] as { cond: { kind: string } }).cond.kind, "not");
  // Looking's housekeeping is not an effect.
  assert.deepEqual(
    auto("look at the top 3 cards of your deck, then put them back in any order.").ops.map((o) => o.op),
    ["look"],
  );
  // A card in the opponent's hand is a hand card.
  assert.equal((auto("choose up to 1 card in your opponent's hand and discard it.").ops[0] as { sel: { area?: string; side?: string } }).sel.area, "hand");

  // "When this card KOs an opponent's Battle Card": the KO'er is told, by battle and by skill.
  DEFS.HUNTER = { ...DEFS.V1, id: "HUNTER", name: "HUNTER", power: 20000, skill: "[Auto] When this card KOs an opponent's Battle Card, draw 1 card." };
  let s = arenaG({ battle: ["HUNTER"], oppBattle: ["V-BLUE"] });
  const prey = zoneOf(s, "p2", "battle")[0];
  s.cards[prey].mode = "rest";
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "attack", player: "p1", attacker: zoneOf(s, "p1", "battle")[0], target: prey }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(s, "p2", "drop").includes(prey));
  assert.equal(zoneOf(s, "p1", "hand").length, hand + 1, "the KO by battle triggers it");
  assertConsistentG(s);

  // "Switch the target of the attack to it" — a redirect from a skill.
  DEFS["E-DECOY"] = { ...DEFS["E-NEGATE"], id: "E-DECOY", name: "E-DECOY", skill: "[Counter: Attack] Choose 1 of your Battle Cards and switch the target of the attack to it." };
  assert.deepEqual(
    one(DEFS["E-DECOY"].skill!).ops.map((o) => o.op),
    ["choose", "redirectAttack"],
  );
  let r = arenaG({ oppHand: ["E-DECOY"], oppEnergy: ["V1"], oppBattle: ["BIG"] });
  const big = zoneOf(r, "p2", "battle")[0];
  r = playG(r, { type: "attack", player: "p1", attacker: leaderOf(r, "p1"), target: leaderOf(r, "p2") });
  assert.equal(r.prompt.kind, "counter", "the [Counter: Attack] window");
  const edecoy = findG(r, "p2", "hand", "E-DECOY");
  r = playG(r, { type: "counter", player: "p2", card: edecoy, skill: 0 });
  if (r.prompt.kind === "chooseCards") r = playG(r, { type: "choose", player: "p2", cards: [big] });
  assert.equal(r.battle?.guard, big, "the attack now goes at BIG");
}

{
  // A selector resolves to every card it matches, so a move whose target has
  // a number in it has to be a choice first — "add 1 card from your Drop to
  // your hand" used to add the whole Drop.
  const sc = compileSkill(parseSkills("[Auto] When you play this card, add 1 card from your Drop to your hand.")[0]);
  assert.deepEqual(
    sc.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  // A bare plural still means all of them.
  assert.deepEqual(
    compileSkill(parseSkills("[Auto] When you play this card, return your opponent's Battle Cards to their owners' hands.")[0]).ops.map((o) => o.op),
    ["moveTo"],
  );

  DEFS.FETCH = { ...DEFS.V1, id: "FETCH", name: "FETCH", energyCost: 1, skill: "[Auto] When you play this card, add 1 card from your Drop to your hand." };
  let s = arenaG({ hand: ["FETCH"], energy: ["V1"] });
  const [d1, d2] = zoneOf(s, "p1", "deck");
  stageMoveG(s, d1, "drop", "p1");
  stageMoveG(s, d2, "drop", "p1");
  const hand = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "FETCH") });
  assert.equal(s.prompt.kind, "chooseCards", "which one is the player's to say");
  s = playG(s, { type: "choose", player: "p1", cards: [d2] });
  assert.equal(zoneOf(s, "p1", "hand").length, hand, "one card in, one card played out");
  assert.ok(zoneOf(s, "p1", "hand").includes(d2));
  assert.ok(zoneOf(s, "p1", "drop").includes(d1), "the other stays");
  assertConsistentG(s);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // A trigger split on its "and" is still the trigger; a condition riding on it wraps the effect.
  const kos = one("[Auto][Once per turn] When this card attacks and KOs an opponent's Battle Card, your opponent chooses 1 card in their hand and discards it.");
  assert.deepEqual(kos.unsupported, []);
  assert.deepEqual(
    kos.ops.map((o) => o.op),
    ["discard"],
  );
  const riding = one("[Auto] When you play this card from your hand and your Leader Card is a ≪Universe 6≫ card, draw 1 card.");
  assert.deepEqual(riding.unsupported, []);
  assert.equal(riding.ops[0].op, "if");
  assert.equal((riding.ops[0] as { cond: { kind: string } }).cond.kind, "leaderMatches");
  // "attacks and KOs" fires on the KO, not on the attack.
  const sk = parseSkills("[Auto] When this card attacks and KOs an opponent's Battle Card, draw 1 card.")[0];
  assert.ok(!autoTriggerMatches(sk, "attacks"));
  assert.ok(autoTriggerMatches(sk, "kos"));

  // Names joined by "and" are one phrase.
  assert.deepEqual(splitClauses("When your opponent plays a red Battle Card with both <Son Goku> and <Piccolo>, play this card."), [
    "When your opponent plays a red Battle Card with both <Son Goku> and <Piccolo>",
    "play this card",
  ]);

  // Under a named host, from an area.
  const under = one("[Auto] When you play this card, place up to 1 yellow ≪Frieza Clan≫ card from your Drop under {Wickedest Clan} in your Battle Area.");
  assert.deepEqual(under.unsupported, []);
  assert.deepEqual(
    under.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((under.ops[1] as { to: string }).to, "under");

  // Under a host that is one of two earlier choices (BT3-052, BT3-054). "The
  // chosen opponent Battle Card" and "the chosen <Majin Buu>" are told apart
  // by what each choice asked for, so each half points at its own.
  const buu = one(
    "[Activate: Main] If your Leader Card is <Majin Buu>, choose 1 of your <Majin Buu> and 1 of your opponent's Battle Cards. Place the chosen opponent Battle Card under the chosen <Majin Buu>.",
  );
  assert.deepEqual(buu.unsupported, [], "the whole card reads");
  const flat = JSON.stringify(buu.ops);
  const buried = flat.match(/"op":"moveTo","target":\{"var":"(c\d+)"\},"to":"under","under":\{"var":"(c\d+)"\}/);
  assert.ok(buried, "the opponent's card moves under a card, and both ends are earlier choices");
  assert.notEqual(buried[1], buried[2], "and they are not the same choice");
  const reasons = new Map([...flat.matchAll(/"as":"(c\d+)","reason":"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  assert.match(reasons.get(buried[1]) ?? "", /opponent/i, "the card that gets buried is the opponent's");
  assert.match(reasons.get(buried[2]) ?? "", /your <Majin Buu>/i, "the host is your <Majin Buu>");

  // Nothing to tell the two apart is left to the referee: guessing which of
  // them the sentence means would bury the wrong card half the time.
  const tie = one("[Auto] When you play this card, choose 1 of your <Majin Buu> and 1 of your opponent's <Majin Buu>. Place the chosen <Majin Buu> under the chosen <Majin Buu>.");
  assert.deepEqual(tie.unsupported, ["Place the chosen <Majin Buu> under the chosen <Majin Buu>"]);

  // "All of X is Y" (XD1-01) is the whole set against the part of it the
  // description picks out — and with nothing in the set it does not hold
  // (0-2-4-1), so the skill cannot fire on a turn where the opponent has no
  // energy at all.
  const every = one("[Auto] When your opponent's Leader Card attacks, if all of your opponent's energy is in Rest Mode, draw 1 card.");
  assert.deepEqual(every.unsupported, []);
  assert.match(JSON.stringify(every.ops), /"kind":"every","sel":\{"side":"opponent","area":"energy"\},"matching":\{"side":"opponent","area":"energy","mode":"rest"\}/);
  // A description `parseTarget` cannot take in would leave the two selectors
  // identical and the condition always true, which is worse than a gap — and
  // the draw goes with it, because refusing the condition alone left the skill
  // drawing on every attack (9 Sep 2026).
  assert.deepEqual(one("[Auto] When this card attacks, if all of your energy is thoroughly cromulent, draw 1 card.").unsupported, [
    "if all of your energy is thoroughly cromulent",
    "draw 1 card",
  ]);

  // One end of the battle rather than either (BT4-085). A card of yours doing
  // the attacking is not one being attacked, and "one of" is the article.
  const guard = one("[Auto] When you combo with this card, if one of your yellow Battle Cards is being attacked, this card gains +10000 combo power for the duration of the turn.");
  assert.deepEqual(guard.unsupported, []);
  assert.match(JSON.stringify(guard.ops), /"kind":"inBattle".*"role":"guard"/);
  assert.match(JSON.stringify(one("[Auto] When this card attacks, if this card is attacking, draw 1 card.").ops), /"role":"attacker"/);

  // "If you use this skill to play a Battle Card with [Over Realm]" (BT3-121):
  // what the play earlier in this same skill turned out to be, not anything
  // the board holds.
  const overRealm = one(
    "[Activate: Main] Choose up to 1 Battle Card in your Warp with an energy cost of 4 or less and play it. If you use this skill to play a Battle Card with [Over Realm], draw 1 card.",
  );
  assert.deepEqual(overRealm.unsupported, []);
  assert.match(JSON.stringify(overRealm.ops), /"op":"if","cond":\{"kind":"varMatches","var":"c0"/);
  assert.match(JSON.stringify(overRealm.ops), /"keywords":\["Over Realm"\]/);

  // Two colours joined by "and" are one target phrase (XD1-05). Cut there, the
  // halves are a verb whose object is a colour and a bare noun phrase.
  assert.deepEqual(splitClauses("reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1"), ["reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1"]);
  assert.deepEqual(one("[Auto] When you play this card, reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand by 1 for the duration of the turn.").unsupported, []);

  // "If they don't KO a card this way" (EX03-16) is "if they don't" with the
  // action spelled out again, and "they instead …" is the same branch saying
  // so twice. Both halves of the sentence have to read, or the trailing move
  // binds to the card that was *not* chosen.
  const orElse = one(
    "[Auto] When you play this card, your opponent may choose 1 of their Battle Cards and KO it. If they don't KO a card this way, they instead choose 2 cards in their hand and place them in their Drop Area.",
  );
  assert.deepEqual(orElse.unsupported, []);
  const branch = JSON.stringify(orElse.ops).match(/"cond":\{"kind":"not","cond":\{"kind":"chose","var":"c0"\}\},"then":\[([^\]]*)\]/);
  assert.ok(branch, "the second sentence is the other branch of the offer");
  assert.match(branch[1], /"op":"discard","n":2,"side":"opponent"/, "and it is the opponent discarding 2, not the KO'd card moving again");
  // A condition about the board still reads as one.
  assert.match(JSON.stringify(one("[Activate: Main] If you don't have a Unison in play, draw 1 card.").ops), /"op":"if"/);

  // The alternative cost told over two sentences (BT4-070, BT4-097): the price
  // as something you may do when the [Counter] is activated, the waiver
  // hanging on "if you do so". Clause by clause it became a *play* of this
  // card, which is not what any of it says.
  const alt = one(
    "[Permanent] If your Leader Card is ≪Goku's Lineage≫, when you activate this card's [Counter], you may choose 1 card in your life and add it to your hand. If you do so, you may activate this card's [Counter] without paying its energy cost.",
  );
  assert.deepEqual(alt.unsupported, []);
  assert.match(JSON.stringify(alt.ops), /"kind":"leaderMatches".*"traits":\["goku's lineage"\]/);
  assert.match(JSON.stringify(alt.ops), /\{"op":"altCost","pay":"life","n":1\}/);

  // A combo from the Drop.
  const cf = one("[Activate: Battle] Use up to 1 green card with 5000 combo power from your Drop in a combo with its skills negated for the battle.");
  assert.deepEqual(cf.unsupported, []);
  assert.deepEqual(
    cf.ops.map((o) => o.op),
    ["choose", "comboFrom"],
  );
  assert.equal((cf.ops[1] as { negated?: boolean }).negated, true);
  assert.deepEqual(ops("[Activate: Battle] Use this card from your Drop in a combo."), ["comboFrom"]);
  if (
    !notYetGap(
      "GRAVE: an [Activate: Battle] skill offered from hand during the combo step",
      "checked directly rather than trusted: the activation is not on the rules engine's menu during the combo prompt the way it is on legacy — an activation window matching a hand card during a native `combo` prompt is not yet wired the way an in-play card's is",
      "no issue filed yet",
    )
  ) {
    DEFS.GRAVE = { ...DEFS["E-DRAW"], id: "GRAVE", name: "GRAVE", skill: "[Activate: Battle] Use up to 1 card with 5000 combo power from your Drop in a combo with its skills negated for the battle." };
    let s = arenaG({ hand: ["GRAVE"], energy: ["V1"], battle: ["BLOCKER"] });
    const dropped = zoneOf(s, "p1", "deck")[0];
    stageMoveG(s, dropped, "drop", "p1");
    s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
    assert.equal(s.prompt.kind, "combo");
    const grave = findG(s, "p1", "hand", "GRAVE");
    assert.ok(
      actsG(s).some((a) => a.type === "activate" && a.card === grave),
      "[Activate: Battle] from hand during the combo step",
    );
    s = playG(s, { type: "activate", player: "p1", card: grave, skill: 0 });
    if (s.prompt.kind === "chooseCards") s = playG(s, { type: "choose", player: "p1", cards: [dropped] });
    assert.ok(zoneOf(s, "p1", "combo").includes(dropped), "5-7: in the Combo Area");
    if (ENGINE === "legacy") assert.equal(legacyState(s).cards[dropped].negated, "all", "with its skills negated");
    assert.equal(s.prompt.kind, "combo");
    assertConsistentG(s);
  }

  // Odds and ends from the same list.
  assert.deepEqual(ops("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate it for the duration of the turn."), ["choose", "negateSkills"]);
  assert.deepEqual(ops("[Counter: Attack] Negate that attack."), ["negateAttack"]);
  assert.equal(parseSkills("[Auto][em][/em] When you play this card, draw 1 card.")[0].kind, "auto");
  const negatedLeader = one("[Counter: Attack] Negate the attack. If you negated a Leader Card's attack with this skill, draw 1 card.");
  assert.deepEqual(negatedLeader.unsupported, []);
  assert.deepEqual((negatedLeader.ops[1] as { cond: unknown }).cond, { kind: "did", what: "negateLeaderAttack" });
  const played = one("[Auto] At the start of your opponent's Main Phase, play up to 1 red card with an energy cost of 3 or less from under this card, and place this card under the played card.");
  assert.deepEqual(played.unsupported, []);
  // 20-16: the flip is offered, and "if you do" is the answer to that offer.
  // It used to be read as simply done, and the draw simply followed.
  const mayFlip = one("[Auto] When one of your yellow Battle Cards is switched to Rest Mode by a skill, you may flip this card over. If you do, draw 1 card.");
  assert.deepEqual(
    mayFlip.ops.map((o) => o.op),
    ["may", "if"],
  );
  assert.deepEqual(
    (mayFlip.ops[0] as { ops: { op: string }[] }).ops.map((o) => o.op),
    ["flip"],
  );
  assert.deepEqual((mayFlip.ops[1] as { cond: unknown }).cond, { kind: "did", what: "may" });
  // On an [Awaken] the flip is the engine's, not an effect.
  assert.deepEqual(ops("[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over."), ["draw"]);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  assert.deepEqual(one("[Auto] When you play this card, draw cards until you have 4 cards in your hand.").ops, [{ op: "draw", n: { handUpTo: 4 } }]);
  assert.deepEqual(one("[Auto] When you play this card, place 2 cards from the top of your opponent's deck in their Drop Area.").ops, [{ op: "mill", n: 2, side: "opponent", as: "m0" }]);
  const marked = one("[Auto] When you play this card, choose 1 of your Battle Cards. Add a marker to the chosen card.");
  assert.deepEqual(marked.unsupported, []);
  assert.deepEqual(marked.ops[1], { op: "addMarker", target: { var: "c0" }, n: 1 });
  const kod = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with 10000 power or less and KO it. If you KO'd a card, draw 1 card.");
  assert.deepEqual(kod.unsupported, []);
  assert.deepEqual((kod.ops[kod.ops.length - 1] as { cond: unknown }).cond, { kind: "did", what: "ko" });
  assert.ok(autoTriggerMatches(parseSkills("[Auto] When you Combo with this card, draw 1 card.")[0], "comboed"));

  assert.deepEqual(one("[Awaken] If you have 5 or more ≪Saiyan≫ cards in your Warp: Draw 2 cards and add card from your life to you hand until you have 6 life left.").ops, [
    { op: "draw", n: 2 },
    { op: "lifeDownTo", n: 6 },
  ]);
  const under = one(
    "[Activate: Main] Choose up to 1 <Majin Buu> card from your Energy Area and play it. If you played a card, choose up to 1 Battle Card in your Drop Area and place it under the card you played with this skill.",
  );
  assert.deepEqual(under.unsupported, []);
  const noDraw = one(
    "[Auto] When this card attacks, look at the top card of your deck, and if it's a red card, add it to your hand. If you did not draw a card with this skill, this card gets +5000 power for the battle.",
  );
  // The look and the add compile; the hinge after them does not — "if you did
  // not draw a card with this skill" points at a decision nothing bound — and
  // the power it governs is refused with it rather than granted every time.
  assert.deepEqual(noDraw.ops.map((o) => o.op), ["look", "if"]);
  assert.deepEqual(noDraw.unsupported, ["If you did not draw a card with this skill", "this card gets +5000 power for the battle"]);

  // "Draw until you have 4" draws what is missing, and nothing when there is nothing missing.
  DEFS.REFILL = { ...DEFS.V1, id: "REFILL", name: "REFILL", energyCost: 1, skill: "[Auto] When you play this card, draw cards until you have 4 cards in your hand." };
  let s = arenaG({ hand: ["REFILL"], energy: ["V1"] });
  for (const id of zoneOf(s, "p1", "hand").slice()) if (s.cards[id].cardId !== "REFILL") stageMoveG(s, id, "deck", "p1");
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "REFILL") });
  assert.equal(zoneOf(s, "p1", "hand").length, 4);
}

// ── 20-18: a card takes on another card's skills ───────────────────────────
//
// The whole claim in one board: what is copied is the source's *printed* face,
// the target plays it as its own — a [Permanent] stands on the target, a
// keyword is in force on the target, an [Auto] answers to the target's own
// moment — and all of it ends when the duration does.
if (
  !notYetGap(
    "COPYCAT/COPYSRC/COPYKW: 20-18, a card taking on another card's skills",
    "checked directly rather than trusted: after `copySkills` runs, the copied [Permanent]'s power does not apply to the target (10000, not 13000) — `copySkills` grants the keyword and [Auto] halves but the copied [Permanent] itself is not read as a static in force on the target yet",
    "no issue filed yet",
  )
) {
  DEFS.COPYSRC = {
    ...DEFS.V1,
    id: "COPYSRC",
    name: "COPYSRC",
    colors: ["Blue"],
    energyCost: 1,
    power: 5000,
    skill: "[Blocker]\n[Permanent] This card gets +3000 power for the turn.\n[Auto] When this card attacks, draw 1 card.",
  };
  DEFS.COPYCAT = {
    ...DEFS.V1,
    id: "COPYCAT",
    name: "COPYCAT",
    energyCost: 1,
    skill: "[Activate: Main] Choose 1 of your opponent's Battle Cards, and this card gains all of the chosen card's skills for the turn.",
  };

  const program = compileSkill(parseSkills(DEFS.COPYCAT.skill)[0]);
  assert.deepEqual(program.unsupported, [], "the copy wording reads whole");
  assert.deepEqual(
    program.ops.map((o) => o.op),
    ["choose", "copySkills"],
    "…as a choice of the card and a copy off it",
  );

  let s = arenaG({ battle: ["COPYCAT"], oppBattle: ["COPYSRC"] });
  const cat = findG(s, "p1", "battle", "COPYCAT");
  const src = findG(s, "p2", "battle", "COPYSRC");
  assert.equal(powerOfG(s, cat), 10000, "before the copy the target is its printed power");
  assert.equal(hasG(s, cat, "Blocker"), false, "…and has none of the source's keywords");
  assert.equal(powerOfG(s, src), 8000, "the source's own [Permanent] is standing on the source");

  const copy = actsG(s).find((a) => a.type === "activate" && a.card === cat);
  assert.ok(copy, "the copy skill is offered");
  s = playG(s, copy);
  // One candidate, so the engine takes the only answer rather than asking.
  if (s.prompt.kind === "chooseCards") s = playG(s, { type: "choose", player: "p1", cards: [src] });

  // A copied [Permanent] stands on the card that took it on: "this card" in
  // the copied text is the *target*, which is why the number moves here and
  // not on the source.
  assert.equal(powerOfG(s, cat), 13000, "the copied [Permanent] applies to the target");
  assert.equal(powerOfG(s, src), 8000, "…and the source is unchanged");
  // A copied pure keyword skill is granted as a keyword (20-18-1), so every
  // rule that reads keywords sees it without knowing anything about copies.
  assert.equal(hasG(s, cat, "Blocker"), true, "the copied keyword is in force on the target");
  // One rule in force, said in words, for a client that draws it.
  const shown = IMPL.boardView(CTX, s, "p1", {}).you.battle.find((c) => c.id === cat);
  const labelsOn = shown?.effects?.map((e) => e.label) ?? [];
  assert.ok(labelsOn.includes("has the skills of COPYSRC"), `the board says what the target took on (got ${JSON.stringify(labelsOn)})`);

  // A copied [Auto] answers to the *target's* moment, not the source's: this
  // is COPYCAT attacking, and the source is not in the battle at all.
  const handBefore = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "attack", player: "p1", attacker: cat, target: leaderOf(s, "p2") });
  assert.deepEqual(
    s.pending.map((p) => [p.card, p.trigger]),
    [[cat, "attacks"]],
    "the copied [Auto] pended on the target's own attack, under the target's own id",
  );
  // The defence answers first (8-3); the pended [Auto] resolves after it.
  s = playG(s, { type: "block", player: "p2", card: null });
  assert.equal(zoneOf(s, "p1", "hand").length, handBefore + 1, "…and drew the card the copied [Auto] says to draw");
  assertConsistentG(s);

  // …and all of it ends with the duration. The turn passes to the opponent,
  // which is where a "for the turn" effect is dropped (9-9).
  while (s.prompt.kind !== "main" || (s.prompt as { player: string }).player !== "p2") {
    const next = actsG(s).find((a) => a.type === "pass" || a.type === "endMain" || a.type === "charge" || a.type === "block" || a.type === "counter");
    assert.ok(next, `the turn can be passed on (${s.prompt.kind})`);
    s = playG(s, next);
  }
  assert.equal(powerOfG(s, cat), 10000, "the copied [Permanent] is gone with the turn");
  assert.equal(hasG(s, cat, "Blocker"), false, "…and so is the copied keyword");
  assert.equal(
    s.effects.some((e) => e.kind === "copiedSkills"),
    false,
    "…and the copy itself is no longer in force",
  );

  // The other wording, and the one nine cards print: the choice is of a
  // *skill*, the two printed clauses are one step, and "keyword skill" narrows
  // what may be taken.
  DEFS.COPYKW = {
    ...DEFS.V1,
    id: "COPYKW",
    name: "COPYKW",
    energyCost: 1,
    skill: "[Activate: Main] Choose up to 1 keyword skill on a card in your opponent's Battle Area, and this card gains that skill for the turn.",
  };
  const kw = compileSkill(parseSkills(DEFS.COPYKW.skill)[0]);
  assert.deepEqual(kw.unsupported, [], "the two-clause wording reads whole");
  assert.deepEqual(kw.ops.map((o) => o.op), ["copySkills"], "…as one step, not a choice of cards and an unread tail");
  assert.equal((kw.ops[0] as { only?: string }).only, "keyword", "…narrowed to keyword skills");

  s = arenaG({ battle: ["COPYKW"], oppBattle: ["COPYSRC"] });
  const thief = findG(s, "p1", "battle", "COPYKW");
  const take = actsG(s).find((a) => a.type === "activate" && a.card === thief);
  assert.ok(take, "the keyword-copy skill is offered");
  s = playG(s, take);
  assert.equal(s.prompt.kind, "chooseMode", "the player is asked which skill, not which card");
  assert.deepEqual((s.prompt as { options: string[] }).options, ["[Blocker]", "None"], "…and only the keyword skills are on offer, with the decline the card's “up to 1” allows");
  s = playG(s, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(hasG(s, thief, "Blocker"), true, "the chosen keyword is in force on the target");
  assert.equal(powerOfG(s, thief), 10000, "…and nothing else of the source came with it");
  assertConsistentG(s);
}
// ── 9-10: a replacement whose substitute is a program (#125) ───────────────

if (!replaceGap("PILEDROP: a KO replaced by moving the pile under it, not the card")) {
  // BT3-051's shape. The card itself **stays**, and its whole under-stack goes
  // to the Drop in the KO's place — a replacement no redirect can say, because
  // what moves is not the card whose departure was replaced.
  DEFS.PILEDROP = {
    ...DEFS.V1,
    id: "PILEDROP",
    name: "PILEDROP",
    skill: "[Permanent] If this card would be KO'd, place all the cards under this card in its owner's Drop Area instead.",
  };
  const s = arena({ battle: ["PILEDROP"], hand: ["V1"] });
  const host = find(s, "p1", "battle", "PILEDROP");
  const buried = s.players.p1.hand[0];
  assert.equal(placeUnder(CTX, s, [], buried, host), true);
  assert.deepEqual(s.cards[host].under, [buried]);

  koCard(CTX, s, [], host);
  assert.ok(s.players.p1.battle.includes(host), "the KO was replaced, not redirected: the card is still there");
  assert.ok(!s.players.p1.drop.includes(host));
  assert.ok(s.players.p1.drop.includes(buried), "and the pile under it went to the Drop instead");
  assert.deepEqual(s.cards[host].under, []);
  assertConsistent(s);
}

if (!replaceGap("EXILEKO: a KO replaced by a `replace` record targeting `removed`")) {
  // The primitive's other half, written as a `replace` rather than as the
  // `replaceLeave` macro the compiler still emits for it: a redirect of the KO
  // leaves the card in `removed`. The rule comes off the record rather than
  // the text, which is what `card_rules` does in a real game.
  DEFS.EXILEKO = {
    ...DEFS.V1,
    id: "EXILEKO",
    name: "EXILEKO",
    skill: "[Permanent] If this card would be KO'd, remove it from the game instead.",
  };
  const record = { ops: [{ op: "replace", event: "ko", with: [{ op: "moveTo", target: { sel: { special: "self" } }, to: "removed" }] }], unsupported: [] };
  assert.equal(validateProgram(record.ops), true);
  const ctx = {
    defs: DEFS,
    scripts: new Proxy({} as Record<string, unknown>, {
      get: (_, key) => (key === "EXILEKO" ? { bySkill: { 0: record }, complete: true, unsupported: [] } : CTX.scripts[key as string]),
    }),
  } as typeof CTX;

  const s = arena({ battle: ["EXILEKO"] });
  const exile = find(s, "p1", "battle", "EXILEKO");
  koCard(ctx, s, [], exile);
  assert.ok(s.players.p1.removed.includes(exile), "a KO-to-removed replacement leaves the card out of the game");
  assert.ok(!s.players.p1.drop.includes(exile));
  assertConsistent(s);

  // The event is the one named: the same card returned to hand by a skill is
  // still returned to hand, because only its KO was replaced.
  const t = arena({ battle: ["EXILEKO"] });
  const other = find(t, "p1", "battle", "EXILEKO");
  move(ctx, t, [], other, "hand", "p1", { reason: "effect" });
  assert.ok(t.players.p1.hand.includes(other), "a `ko` replacement replaces the KO and nothing else");
  assertConsistent(t);
}

// ── 20-9: gaining control of a card ────────────────────────────────────────

if (
  !notYetGap(
    "TAKER: gaining control of a card (20-9)",
    "checked directly rather than trusted: the card's markers are reset to 0 by the `control` op's move to the new side's Battle Area, where 20-9-2 says nothing about the card should change — the rules engine's `control` handling does not yet preserve markers (or, likely, mode/other per-card state) across the move the way LEADERGRAB's own board-wide refusal already reads the op correctly",
    "no issue filed yet",
  )
) {
  // A loan: the card crosses the table, fights for its new master, and goes
  // home when the duration does. Nothing about the card changes (20-9-2) and
  // its owner never does (0-3-3-1).
  DEFS.TAKER = {
    ...DEFS.V1,
    id: "TAKER",
    name: "TAKER",
    skill: "[Activate: Main] Choose 1 of your opponent's Battle Cards and gain control of it until the end of the turn.",
  };
  DEFS.LOANED = { ...DEFS["V-BLUE"], id: "LOANED", name: "LOANED" };
  let s = arenaG({ battle: ["TAKER"], oppBattle: ["LOANED", "V-BLUE"] });
  const taker = findG(s, "p1", "battle", "TAKER");
  const theirs = findG(s, "p2", "battle", "LOANED");
  s.cards[theirs].markers = 2;
  const entered = ENGINE === "legacy" ? legacyState(s).cards[theirs].enteredTurn : undefined;

  s = playG(s, { type: "activate", player: "p1", card: taker, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  s = playG(s, { type: "choose", player: "p1", cards: [theirs] });

  assert.ok(zoneOf(s, "p1", "battle").includes(theirs), "20-9-1: the card is in your Battle Area now");
  assert.ok(!zoneOf(s, "p2", "battle").includes(theirs));
  assert.equal(masterOfG(s, theirs), "p1", "0-3-4-1: and you are its master");
  assert.equal(s.cards[theirs].owner, "p2", "0-3-3-1: its owner is not something a skill can change");
  assert.equal(s.cards[theirs].markers, 2, "20-9-2: it keeps its markers");
  if (ENGINE === "legacy") assert.equal(legacyState(s).cards[theirs].enteredTurn, entered, "changing hands is not being played again");
  assert.equal(
    s.effects.filter((e) => e.kind === "control").length,
    1,
    "the loan is a continuous effect, and it carries the way home",
  );

  // And the board says the card is on loan rather than simply appearing on
  // the wrong side: the label is written from the card's own chair, because
  // with two players a card whose master is not its owner is always being
  // used by the owner's opponent, whichever side is reading it.
  const onLoan = IMPL.boardView(CTX, s, "p1", {}).you.battle.find((c) => c.id === theirs);
  assert.deepEqual(
    (onLoan?.effects ?? []).map((e) => e.label),
    ["controlled by its owner's opponent"],
  );

  // 8-1: it attacks for whoever masters it, with no rule of its own to change
  // — the attack list is built from the cards in *your* Battle Area.
  assert.ok(
    labelsG(s).some((l) => l.startsWith("Attack") && l.includes("with LOANED")),
    "a controlled card attacks for its new master",
  );
  assertConsistentG(s);

  // 7-4-5: "until the end of the turn" ends in the cleanup, and the card walks
  // back to the player it came from rather than simply losing an effect.
  s = playG(s, { type: "endMain", player: "p1" });
  assert.ok(zoneOf(s, "p2", "battle").includes(theirs), "the loan is over: the card went back");
  assert.ok(!zoneOf(s, "p1", "battle").includes(theirs));
  assert.equal(s.cards[theirs].markers, 2, "and came back as it left");
  assert.equal(s.effects.filter((e) => e.kind === "control").length, 0);
  assertConsistentG(s);
}

if (!notYetGap("TAKER2: koCard, a direct low-level KO with no action behind it", "`koCard` is a legacy-only test helper (`engine/triggers.ts`) with no rules-engine equivalent — a real KO on the rules engine goes through an action or a battle, neither of which this fixture stages", "no issue filed yet")) {
  // 5-12-1: a KO is to the card's **owner's** Drop Area, whoever was using it.
  // This is the whole reason the audit had to happen before the operation.
  DEFS.TAKER2 = { ...DEFS.TAKER, id: "TAKER2", name: "TAKER2" };
  let s = arena({ battle: ["TAKER2"], oppBattle: ["LOANED", "V-BLUE"] });
  const taker = find(s, "p1", "battle", "TAKER2");
  const theirs = find(s, "p2", "battle", "LOANED");
  s = play(s, { type: "activate", player: "p1", card: taker, skill: 0 });
  s = play(s, { type: "choose", player: "p1", cards: [theirs] });
  assert.ok(s.players.p1.battle.includes(theirs));

  koCard(CTX, s, [], theirs);
  assert.ok(s.players.p2.drop.includes(theirs), "5-12-1: KO'd out of your Battle Area, into its owner's Drop");
  assert.ok(!s.players.p1.drop.includes(theirs));
  assert.equal(s.effects.filter((e) => e.kind === "control").length, 0, "and the loan went with it");
  assertConsistent(s);
}

{
  // Out of scope on purpose (#126): the manual gives no route to taking a
  // Leader or a Unison Card, and their areas hold one card each. The refusal
  // is a note rather than a silent no-op, so the log says what did not happen.
  DEFS.LEADERGRAB = { ...DEFS.V1, id: "LEADERGRAB", name: "LEADERGRAB", skill: "[Activate: Main] Gain control of your opponent's Leader Card." };
  const record = { ops: [{ op: "control", target: { sel: { special: "opponentLeader" } } }], unsupported: [] };
  assert.equal(validateProgram(record.ops), true);
  const ctx = {
    defs: DEFS,
    scripts: new Proxy({} as Record<string, unknown>, {
      get: (_, key) => (key === "LEADERGRAB" ? { bySkill: { 0: record }, complete: true, unsupported: [] } : CTX.scripts[key as string]),
    }),
  } as typeof CTX;

  const s = arenaG({ battle: ["LEADERGRAB"] });
  const grab = findG(s, "p1", "battle", "LEADERGRAB");
  const leader = leaderOf(s, "p2");
  const r = IMPL.apply(ctx, s, { type: "activate", player: "p1", card: grab, skill: 0 });
  assert.equal(leaderOf(r.state, "p2"), leader, "a Leader does not change hands");
  assert.ok(
    r.events.some((e) => e.type === "note" && /can't be taken control of/.test(e.text)),
    "and the log says so",
  );
  assertConsistentG(r.state);
}

// ── 20-13: skipping a phase or a step ──────────────────────────────────────

/** A context whose rules for one card come off a hand-written record, as `card_rules` would. */
function withRecord(cardId: string, record: { ops: unknown[]; unsupported: string[] }): typeof CTX {
  assert.equal(validateProgram(record.ops), true, `${cardId}: the record is a valid program`);
  return {
    defs: DEFS,
    scripts: new Proxy({} as Record<string, unknown>, {
      get: (_, key) => (key === cardId ? { bySkill: { 0: record }, complete: true, unsupported: [] } : CTX.scripts[key as string]),
    }),
  } as typeof CTX;
}

if (!notYetGap("SKIPPER: the [Activate]-driven `skip` op (20-13)", "`addSkip` throws `NotYet` unconditionally — the flow's skip list is #145's own remainder", "#145")) {
  // 7-2 refused whole: no Active Step, no Draw Step, no charge prompt, and no
  // [Auto] answering "at the start of the Charge Phase" (20-13-2..4). The
  // phase is still announced, so the board can say what did not happen.
  DEFS.SKIPPER = { ...DEFS.V1, id: "SKIPPER", name: "SKIPPER", skill: "[Activate: Main] Your opponent skips their next Charge Phase." };
  const ctx = withRecord("SKIPPER", { ops: [{ op: "skip", what: "charge", side: "opponent" }], unsupported: [] });

  let s = arena({ battle: ["SKIPPER"], oppBattle: ["V-BLUE"] });
  const skipper = find(s, "p1", "battle", "SKIPPER");
  const theirs = s.players.p2.battle[0];
  s.cards[theirs].mode = "rest";

  s = apply(ctx, s, { type: "activate", player: "p1", card: skipper, skill: 0 }).state;
  assert.deepEqual(
    (s.players.p2.skips ?? []).map((e) => `${e.what}:${e.when}`),
    ["charge:next"],
    "the operation writes a flag; the flow runner is what spends it",
  );

  const handBefore = s.players.p2.hand.length;
  const r = apply(ctx, s, { type: "endMain", player: "p1" });
  s = r.state;

  assert.equal(s.phase, "main", "20-13-1: play proceeds from the phase after the skipped one");
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: string }).player, "p2");
  assert.equal(s.players.p2.hand.length, handBefore, "7-2-9 did not happen");
  assert.equal(s.cards[theirs].mode, "rest", "7-2-7 did not happen either");
  assert.deepEqual(s.players.p2.skips, [], "and the entry is spent, not standing");

  const phases = r.events.filter((e) => e.type === "phase");
  const charge = phases.find((e) => e.type === "phase" && e.phase === "charge");
  assert.ok(charge && charge.type === "phase" && charge.skipped === true, "the phase event says it was skipped");
  const beat = toBeats(ctx, s, r.events, 0).list.find((b) => b.t === "phase" && b.phase === "charge");
  assert.ok(beat && beat.t === "phase" && beat.skipped === true, "and so does the beat a client draws");
  assert.equal(narrate(beat, { viewer: "p1" as PlayerId, them: "Claude", art: {} }), "Claude skips the Charge Phase.");
  assertConsistent(s);
}

if (!notYetGap("NODEFENSE: the [Activate]-driven `skip` op over a battle step (20-13)", "`addSkip` throws `NotYet` unconditionally — the flow's skip list is #145's own remainder", "#145")) {
  // "Your opponent skips their Defense Step" (BT18-001's shape): the guard's
  // side gets no moment and no combo, and the battle goes straight to damage.
  DEFS.NODEFENSE = { ...DEFS.V1, id: "NODEFENSE", name: "NODEFENSE", power: 30000, skill: "[Activate: Main] Your opponent skips their Defense Step this turn." };
  const ctx = withRecord("NODEFENSE", { ops: [{ op: "skip", what: "defense", side: "opponent", when: "this" }], unsupported: [] });

  let s = arena({ battle: ["NODEFENSE"] });
  const attacker = find(s, "p1", "battle", "NODEFENSE");
  s = apply(ctx, s, { type: "activate", player: "p1", card: attacker, skill: 0 }).state;

  const life = s.players.p2.life.length;
  let r = apply(ctx, s, { type: "attack", player: "p1", attacker, target: s.players.p2.leader });
  const events = [...r.events];
  // The Offense Step still happens, so its combo window is still offered; the
  // Defense Step's is not, which is the whole of what was skipped.
  assert.equal(r.state.prompt.kind, "combo");
  assert.equal((r.state.prompt as { side: string }).side, "offense");
  r = apply(ctx, r.state, { type: "pass", player: "p1" });
  events.push(...r.events);

  const steps = events.filter((e) => e.type === "battleStep");
  const defense = steps.find((e) => e.type === "battleStep" && e.step === "defense");
  assert.ok(defense && defense.type === "battleStep" && defense.skipped === true, "the Defense Step was announced and refused");
  assert.ok(
    steps.some((e) => e.type === "battleStep" && e.step === "damage"),
    "20-13-1: play proceeds from the step after it",
  );
  assert.equal(r.state.players.p2.life.length, life - 1, "and the attack landed");
  assert.deepEqual(r.state.players.p2.skips, [], "one entry, one step");
  assertConsistent(r.state);
}

if (!notYetGap("SKIPNOW: a `this`-scoped skip entry dropped with the turn (20-13)", "`addSkip` throws `NotYet` unconditionally — the flow's skip list is #145's own remainder", "#145")) {
  // "This turn's" and "the next" are different phases, and an unspent "this"
  // entry does not become a "next" one when the turn passes.
  DEFS.SKIPNOW = { ...DEFS.V1, id: "SKIPNOW", name: "SKIPNOW", skill: "[Activate: Main] You skip this turn's End Phase." };
  const ctx = withRecord("SKIPNOW", { ops: [{ op: "skip", what: "charge", side: "you", when: "this" }], unsupported: [] });

  let s = arena({ battle: ["SKIPNOW"] });
  const card = find(s, "p1", "battle", "SKIPNOW");
  s = apply(ctx, s, { type: "activate", player: "p1", card, skill: 0 }).state;
  assert.equal((s.players.p1.skips ?? []).length, 1);
  // This turn's Charge Phase is long past, so the entry never comes round…
  s = apply(ctx, s, { type: "endMain", player: "p1" }).state;
  assert.deepEqual(s.players.p1.skips, [], "…and is dropped with the turn rather than eating the next one");
  assertConsistent(s);
}

if (
  !notYetGap(
    "INBATTLE: a standing [Permanent] read live at the step (\"stepSkippedByPermanent\", 20-13)",
    "checked directly rather than trusted: the Offense Step still runs on the rules engine — the battle sub-flow's own steps (`vm/battle.ts`) do not yet read a [Permanent]'s live step-skip condition the way the legacy engine's `stepSkippedByPermanent` does; distinct from `addSkip`'s own `NotYet` (#145) above, since this card compiles to no `skip` op at all",
    "no issue filed yet",
  )
) {
  // "When this card is in a battle, you skip your Offense Step" (BT18-019's
  // shape, #278): a standing [Permanent] rule, read live at the step rather
  // than spent once (`stepSkippedByPermanent`), and true only while this card
  // is one of the battle's own two cards.
  DEFS.INBATTLE = { ...DEFS.V1, id: "INBATTLE", name: "INBATTLE", power: 30000, skill: "[Permanent] When this card is in a battle, you skip your Offense Step." };
  const rule = compileSkill(parseSkills(DEFS.INBATTLE.skill!)[0]);
  assert.deepEqual(rule.unsupported, [], "the condition and the skip both read");

  // Attacking with it: its own Offense Step is refused.
  const s = arenaG({ battle: ["INBATTLE"] });
  const attacker = findG(s, "p1", "battle", "INBATTLE");
  const r = IMPL.apply(CTX, s, { type: "attack", player: "p1", attacker, target: leaderOf(s, "p2") });
  const offense = r.events.find((e) => e.type === "battleStep" && e.step === "offense");
  assert.ok(offense && offense.type === "battleStep" && offense.skipped === true, "the Offense Step was announced and refused");
  assert.equal(r.state.prompt.kind, "combo");
  assert.equal((r.state.prompt as { side: string }).side, "defense", "20-13-1: play proceeds from the step after it");
  assertConsistentG(r.state);

  // A battle it is not part of: the rule reads nothing about it (9-1-3-1).
  const other = arenaG({ battle: ["INBATTLE", "V-BLUE"] });
  const bystander = findG(other, "p1", "battle", "INBATTLE");
  const attacker2 = zoneOf(other, "p1", "battle").find((id) => id !== bystander)!;
  const r2 = IMPL.apply(CTX, other, { type: "attack", player: "p1", attacker: attacker2, target: leaderOf(other, "p2") });
  assert.equal(r2.state.prompt.kind, "combo");
  assert.equal((r2.state.prompt as { side: string }).side, "offense", "INBATTLE sitting out of the battle skips nothing");
  assertConsistentG(r2.state);
}

if (
  !notYetGap(
    "ATKSKIP: a standing [Permanent] read live at the step, off the attacker's role (20-13)",
    "the same gap as INBATTLE above — the battle sub-flow does not yet read a [Permanent]'s live step-skip condition",
    "no issue filed yet",
  )
) {
  // "When your <X> cards attack your opponent's Battle Cards, your opponent
  // skips their Defense Step" (BT18-001's shape, #278): the attacker's own
  // role rather than either end of the battle — the active-voice twin of
  // "is attacking".
  DEFS.ATKSKIP = { ...DEFS.V1, id: "ATKSKIP", name: "ATKSKIP", power: 30000, skill: "[Permanent] When this card attacks an opponent's Battle Card, your opponent skips their Defense Step." };
  const rule = compileSkill(parseSkills(DEFS.ATKSKIP.skill!)[0]);
  assert.deepEqual(rule.unsupported, []);

  const s = arenaG({ battle: ["ATKSKIP"], oppBattle: ["V-BLUE"] });
  const attacker = findG(s, "p1", "battle", "ATKSKIP");
  const guard = zoneOf(s, "p2", "battle")[0];
  s.cards[guard].mode = "rest"; // 8-1: only a Rest Mode Battle Card is a legal attack target
  let r = IMPL.apply(CTX, s, { type: "attack", player: "p1", attacker, target: guard });
  const events = [...r.events];
  assert.equal(r.state.prompt.kind, "combo");
  assert.equal((r.state.prompt as { side: string }).side, "offense", "ATKSKIP grants nothing about its own Offense Step");
  r = IMPL.apply(CTX, r.state, { type: "pass", player: "p1" });
  events.push(...r.events);
  const defense = events.find((e) => e.type === "battleStep" && e.step === "defense");
  assert.ok(defense && defense.type === "battleStep" && defense.skipped === true, "the guard's Defense Step is refused");
  assert.ok(events.some((e) => e.type === "battleStep" && e.step === "damage"), "20-13-1: play proceeds from the step after it");
  assertConsistentG(r.state);
}

if (!notYetGap("TURNSKIP: skip your whole next turn (20-13)", "`addSkip` throws `NotYet` unconditionally — the flow's skip list is #145's own remainder", "#145")) {
  // "Skip your turn and begin your opponent's Charge Phase" (BT31-097's
  // shape, #278): every phase of the *next* turn refused at once, checked
  // once at that turn's own start rather than at any one phase — and the
  // turn still counts for turn-number bookkeeping (owner's ruling, 14 Sep
  // 2026: `turn.next` advances `s.turn` once per turn transition whether or
  // not the turn it is leaving did anything).
  DEFS.TURNSKIP = { ...DEFS.V1, id: "TURNSKIP", name: "TURNSKIP", skill: "[Activate: Main] Skip your turn and begin your opponent's Charge Phase." };
  const rule = compileSkill(parseSkills(DEFS.TURNSKIP.skill!)[0]);
  assert.deepEqual(rule.ops, [{ op: "skip", what: "turn" }], "the trailing clause names the same rule's own destination and adds nothing");
  assert.deepEqual(rule.unsupported, []);

  let s = arena({ battle: ["TURNSKIP"] });
  const card = find(s, "p1", "battle", "TURNSKIP");
  s = play(s, { type: "activate", player: "p1", card, skill: 0 });
  assert.deepEqual((s.players.p1.skips ?? []).map((e) => `${e.what}:${e.when}`), ["turn:next"]);

  const turnBefore = s.turn;
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2");
  assert.equal(s.prompt.kind, "main");

  const r = apply(CTX, s, { type: "endMain", player: "p2" });
  s = r.state;
  assert.equal(s.turnPlayer, "p2", "p1's whole next turn produced no turn of p1's own to land on (20-13-1)");
  assert.equal(s.turn, turnBefore + 3, "p2's own turn and p1's empty one both counted");
  assert.deepEqual(s.players.p1.skips, [], "the entry is spent, not standing");

  const skipped = r.events.filter((e) => e.type === "phase" && e.player === "p1");
  assert.equal(skipped.length, 3, "all three of the refused turn's phases are announced");
  assert.ok(
    skipped.every((e) => e.type === "phase" && e.skipped === true),
    "and every one says it was skipped",
  );
  assertConsistent(s);
}

if (!notYetGap("SPANSKIP: three `skip` entries under one name (20-13)", "`addSkip` throws `NotYet` unconditionally — the flow's skip list is #145's own remainder", "#145")) {
  // "Skip all phases until the Charge Phase in your next turn, then start
  // your Main Phase" (BT21-104's shape, #278): the rest of this turn, the
  // opponent's whole next turn, and this player's own next Charge Phase —
  // three ordinary skip entries under one name (script.ts) rather than a
  // mechanism of its own, so no new check point answers for it besides the
  // one `what: "turn"` already added.
  DEFS.SPANSKIP = { ...DEFS.V1, id: "SPANSKIP", name: "SPANSKIP", energyCost: 1, skill: "[Auto] When this card is played, skip all phases until the Charge Phase in your next turn, then start your Main Phase." };
  const rule = compileSkill(parseSkills(DEFS.SPANSKIP.skill!)[0]);
  assert.deepEqual(rule.unsupported, []);

  let s = arena({ hand: ["SPANSKIP"], energy: ["V1"] });
  const turnBefore = s.turn;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SPANSKIP") });
  assert.deepEqual(
    (s.players.p1.skips ?? []).map((e) => `${e.what}:${e.when}`).sort(),
    ["charge:next", "end:this"],
    "this turn's End Phase and this player's own next Charge Phase",
  );
  assert.deepEqual((s.players.p2.skips ?? []).map((e) => `${e.what}:${e.when}`), ["turn:next"], "the opponent's whole next turn");

  const r = apply(CTX, s, { type: "endMain", player: "p1" });
  s = r.state;
  assert.equal(s.turnPlayer, "p1", "the opponent's whole turn was skipped too, landing back on this player (20-13-1)");
  assert.equal(s.turn, turnBefore + 2, "both turns passed and both counted");
  assert.equal(s.prompt.kind, "main", "charge, the active step and the draw never happened for this player either — straight to Main");
  assert.deepEqual(s.players.p1.skips, []);
  assert.deepEqual(s.players.p2.skips, []);

  const mine = r.events.filter((e) => e.type === "phase" && e.player === "p1");
  const theirs = r.events.filter((e) => e.type === "phase" && e.player === "p2");
  assert.ok(
    mine.some((e) => e.type === "phase" && e.phase === "end" && e.skipped === true),
    "this turn's End Phase was skipped",
  );
  assert.equal(theirs.length, 3, "all three of the opponent's phases are announced");
  assert.ok(
    theirs.every((e) => e.type === "phase" && e.skipped === true),
    "and every one says it was skipped",
  );
  assert.ok(
    mine.some((e) => e.type === "phase" && e.phase === "charge" && e.skipped === true),
    "and so was this player's own next Charge Phase",
  );
  assertConsistentG(s);
}

// ── 20-19: paying with something that is not energy ─────────────────────────
//
// "[Permanent] You can use this card to pay energy costs even when it's in
// your Battle Area" (BT3-039). The card is rested where it stands, counts as
// one energy of its own colours, and never moves. Three things are checked
// here, and the third is the one that would not show in a coverage number: the
// permission is an *offer*, so energy is spent first and the Battle Card is
// only reached for when the energy alone cannot cover the price.
if (
  !staticGap(
    "PAYER: a [Permanent]'s whole-board grant of a non-energy payer",
    "payWith",
    "#149 bound only the narrower, per-price form a price names for itself; this wider [Permanent] grant — a payer for the whole board — is still unread",
  )
) {
  DEFS.PAYER = {
    ...DEFS.V1,
    id: "PAYER",
    name: "PAYER",
    energyCost: 1,
    skill: "[Permanent] You can use this card to pay energy costs even when it's in your Battle Area.",
  };
  DEFS.ORBSKILL = {
    ...DEFS.V1,
    id: "ORBSKILL",
    name: "ORBSKILL",
    energyCost: 1,
    skill: "[Activate: Main]{1}: This card gets +5000 power for the turn.",
  };
  assert.deepEqual(compileSkill(parseSkills(DEFS.PAYER.skill!)[0]).ops, [{ op: "payWith" }], "the [Permanent] reads to a payWith step");

  // Without the payer the skill is unaffordable: there is no energy at all.
  const none = arenaG({ battle: ["ORBSKILL"] });
  assert.equal(zoneOf(none, "p1", "energy").length, 0, "the board is staged with no energy");
  assert.ok(!canActivateG(none, findG(none, "p1", "battle", "ORBSKILL")), "a {1} skill is not offered with nothing to pay it with");

  // With it, the skill is offered and the payer is what gets rested.
  let s = arenaG({ battle: ["ORBSKILL", "PAYER"] });
  const skillCard = findG(s, "p1", "battle", "ORBSKILL");
  const payer = findG(s, "p1", "battle", "PAYER");
  assert.ok(canActivateG(s, skillCard), "the Battle Card standing in for energy makes the skill payable");
  assert.deepEqual(planPayment(CTX, legacyState(s), "p1", 1, {}), { rest: [payer], markers: 0 }, "the plan rests the payer and nothing else");
  const before = powerOfG(s, skillCard);
  s = playG(s, { type: "activate", player: "p1", card: skillCard, skill: 0 });
  assert.equal(s.cards[payer].mode, "rest", "the payer is switched to Rest Mode, exactly as energy is");
  assert.ok(zoneOf(s, "p1", "battle").includes(payer), "and it stays in the Battle Area — nothing moved");
  assert.equal(zoneOf(s, "p1", "energy").length, 0, "nothing was charged from the Energy Area, which had nothing in it");
  assert.equal(powerOfG(s, skillCard), before + 5000, "and the skill resolved");
  assert.ok(!canActivateG(s, skillCard), "a rested payer cannot pay again");
  assertConsistentG(s);

  // The offer is not an obligation: with energy on the table the energy goes
  // first and the Battle Card stays active.
  let withEnergy = arenaG({ battle: ["ORBSKILL", "PAYER"], energy: ["V1"] });
  const payer2 = findG(withEnergy, "p1", "battle", "PAYER");
  const energyCard = findG(withEnergy, "p1", "energy", "V1");
  assert.deepEqual(planPayment(CTX, legacyState(withEnergy), "p1", 1, {}), { rest: [energyCard], markers: 0 }, "energy is tried before a card that may stand in for it");
  withEnergy = playG(withEnergy, { type: "activate", player: "p1", card: findG(withEnergy, "p1", "battle", "ORBSKILL"), skill: 0 });
  assert.equal(withEnergy.cards[energyCard].mode, "rest");
  assert.equal(withEnergy.cards[payer2].mode, "active", "the Battle Card is left alone when the energy could cover the price");

  // The permission holds where the card is (9-1-3-1): in hand it is not a payer.
  const inHand = arenaG({ battle: ["ORBSKILL"], hand: ["PAYER"] });
  assert.ok(!canActivateG(inHand, findG(inHand, "p1", "battle", "ORBSKILL")), "a [Permanent] in hand pays for nothing");

  // And the refusal twin says the same thing the menu does, rather than
  // claiming a shortfall the payer covers.
  const why = rejectedActionsG(none).find((r) => r.action.type === "activate" && r.action.card === findG(none, "p1", "battle", "ORBSKILL"));
  assert.ok(
    why?.why.some((r) => r.kind === "energy"),
    "with no payer, the refusal is still an energy shortfall",
  );
  assert.ok(
    !rejectedActionsG(s).some((r) => r.action.type === "activate" && r.action.card === skillCard && r.why.some((x) => x.kind === "energy" && x.have > x.need)),
    "and the twin never reports a shortfall the payer has already covered",
  );
}

// ── 9-1-4: a card no skill may touch ───────────────────────────────────────

if (
  !staticGap(
    "IMMUNE: a [Permanent] saying this card isn't affected by an opponent's skills",
    "immune",
    "#154 — immunity narrows what a skill may choose, and the hook group that reads choosing (`chooseable`) is Stage 7's; the query hook Barrier itself uses does not cover a board-wide reading not tied to a keyword",
  )
) {
  // The acceptance board for #128. Everything the family claims is one
  // question asked of one pair — this card, that skill — so every case below
  // is the same two cards with the asking side changed.
  DEFS.IMMUNE = { ...DEFS.V1, id: "IMMUNE", name: "IMMUNE", power: 10000, energyCost: 1, skill: "[Permanent] This card isn't affected by your opponent's skills." };
  DEFS.PLAIN = { ...DEFS.V1, id: "PLAIN", name: "PLAIN", power: 10000, energyCost: 1 };
  DEFS.KOSKILL = { ...DEFS.V1, id: "KOSKILL", name: "KOSKILL", energyCost: 1, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." };
  DEFS.DOWNALL = { ...DEFS.V1, id: "DOWNALL", name: "DOWNALL", energyCost: 1, skill: "[Permanent] Your opponent's Battle Cards get -5000 power." };
  DEFS.UPALL = { ...DEFS.V1, id: "UPALL", name: "UPALL", energyCost: 1, skill: "[Permanent] Your Battle Cards get +5000 power." };

  // Not chosen by the opponent's skill, while the same skill still reaches the
  // card beside it.
  let s = arenaG({ battle: ["KOSKILL"], oppBattle: ["IMMUNE", "PLAIN"] });
  const immune = findG(s, "p2", "battle", "IMMUNE");
  const plain = findG(s, "p2", "battle", "PLAIN");
  s = playG(s, { type: "activate", player: "p1", card: findG(s, "p1", "battle", "KOSKILL"), skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards", "the KO skill asks which card");
  const offered = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.deepEqual(offered, [plain], "only the card that is affected by the skill is offered");

  // …and the refusal names the rule rather than pretending the card is the
  // wrong kind of target. Said to the player who was refused, so the side word
  // flips: the rule its controller reads as "your opponent's skills" is "your
  // skills" from the chair it is refusing.
  const why = rejectedActionsG(s).find((r) => r.action.type === "choose" && r.action.cards?.[0] === immune);
  const said = why?.why.find((r) => r.kind === "immune");
  assert.ok(said, "the card the skill cannot touch is refused for immunity, not for being the wrong target");
  assert.equal(said.kind === "immune" && said.whose, "your skills");
  assert.equal(sentence(said, { name: "IMMUNE", reaching: "choose" }), "IMMUNE isn't affected by your skills.");

  // Not KO'd: the skill resolves for the card it does reach.
  s = playG(s, { type: "choose", player: "p1", cards: [plain] });
  assert.ok(!zoneOf(s, "p2", "battle").includes(plain), "the card without immunity is KO'd");
  assert.ok(zoneOf(s, "p2", "battle").includes(immune), "the immune card is not");
  assertConsistentG(s);

  // Not powered down, by a continuous effect the opponent's [Permanent] emits
  // — the case the single-level static guard used to let through, because the
  // immunity is itself a [Permanent].
  const board = arenaG({ battle: ["DOWNALL"], oppBattle: ["IMMUNE", "PLAIN"] });
  assert.equal(powerOfG(board, findG(board, "p2", "battle", "PLAIN")), 5000, "the opponent's board-wide power change lands");
  assert.equal(powerOfG(board, findG(board, "p2", "battle", "IMMUNE")), 10000, "and does not land on the card unaffected by it");

  // 20-7: the skill is p1's, the *choice* is p2's ("your opponent chooses").
  // The prompt then stands in front of a player who is not the skill's master,
  // and the refusal is read by them — so the side word is settled by who is
  // being told, not by whose skill it is. Read from the master's chair this
  // said "your skills" to the one person whose skills they are not.
  DEFS.THEYPICK = { ...DEFS.V1, id: "THEYPICK", name: "THEYPICK", energyCost: 1, skill: "[Activate: Main] Your opponent chooses 1 of their Battle Cards and KO it." };
  // Two cards it can reach, so the pick is a real question rather than a
  // forced one taken silently.
  let theirs = arenaG({ battle: ["THEYPICK"], oppBattle: ["IMMUNE", "PLAIN", "V1"] });
  theirs = playG(theirs, { type: "activate", player: "p1", card: findG(theirs, "p1", "battle", "THEYPICK"), skill: 0 });
  assert.equal(theirs.prompt.kind, "chooseCards");
  assert.equal((theirs.prompt as { player: string }).player, "p2", "the card says the opponent chooses, so the prompt is theirs");
  const theirImmune = findG(theirs, "p2", "battle", "IMMUNE");
  const theirWhy = rejectedActionsG(theirs).find((r) => r.action.type === "choose" && r.action.cards?.[0] === theirImmune);
  const theirSaid = theirWhy?.why.find((r) => r.kind === "immune");
  assert.ok(theirSaid, "the immune card is refused to whoever is doing the choosing");
  assert.equal(theirSaid.kind === "immune" && theirSaid.whose, "your opponent's skills", "the blocked skills are the chooser's opponent's, and the words are the chooser's");

  // The other two shapes of the same refusal, which the printed family does
  // not reach but the language can write: a rule with a duration, and one
  // another card is holding up. Both have something left to say after the
  // fact, unlike the card's own [Permanent], whose duration is itself.
  assert.equal(
    sentence({ kind: "immune", card: "IMMUNE", whose: "your skills", by: null, until: "turn" }, { name: "IMMUNE", reaching: "choose" }),
    "IMMUNE isn't affected by your skills. Until the end of the turn.",
  );
  assert.equal(
    sentence({ kind: "immune", card: "IMMUNE", whose: "your skills", by: "GRANTER", until: "permanent" }, { name: "IMMUNE", reaching: "choose" }),
    "IMMUNE isn't affected by your skills. GRANTER's skill says so, while GRANTER is in play.",
  );

  // The card's own side's skills still apply: "your opponent's" names one
  // player, and the other one is not it.
  const own = arenaG({ oppBattle: ["IMMUNE", "PLAIN", "UPALL"] });
  assert.equal(powerOfG(own, findG(own, "p2", "battle", "PLAIN")), 15000);
  assert.equal(powerOfG(own, findG(own, "p2", "battle", "IMMUNE")), 15000, "immunity to your opponent's skills is not immunity to your own");
}

if (
  !staticGap(
    "IMMANY: a [Permanent] naming no side at all ('non-<Gogeta: GT> skills')",
    "immune",
    "#154 — the same DEFERRED_STATICS entry as IMMUNE above, over a filter with no side named",
  )
) {
  // The other half of the family, and the reason the rule is asked of the
  // stored `from` rather than of who owns the card: "isn't affected by
  // non-<Gogeta: GT> skills" (BT18-019) names no side at all, so it blocks
  // every skill — the card's own side's included.
  DEFS.IMMANY = { ...DEFS.V1, id: "IMMANY", name: "IMMANY", power: 10000, energyCost: 1, skill: "[Permanent] This card isn't affected by non-<Gogeta: GT> skills." };
  DEFS.UPALL2 = { ...DEFS.V1, id: "UPALL2", name: "UPALL2", energyCost: 1, skill: "[Permanent] Your Battle Cards get +5000 power." };
  DEFS.GOGETA = { ...DEFS.V1, id: "GOGETA", name: "GOGETA", energyCost: 1, characters: ["Gogeta: GT"], skill: "[Permanent] Your Battle Cards get +5000 power." };

  const s = arenaG({ oppBattle: ["IMMANY", "UPALL2"] });
  assert.equal(powerOfG(s, findG(s, "p2", "battle", "IMMANY")), 10000, "a filter with no side blocks the card's own controller's skills too");

  // And the filter is a filter: the skills it does not describe still land.
  const g = arenaG({ oppBattle: ["IMMANY", "GOGETA"] });
  assert.equal(powerOfG(g, findG(g, "p2", "battle", "IMMANY")), 15000, "a <Gogeta: GT> card's skill is not a non-<Gogeta: GT> skill");
}

// ── 9-10: a replacement that asks (#107) ───────────────────────────────────

if (!replaceGap("TWOWAY/WARDEN2: two mandatory replacements answering the same departure (9-10-2)")) {
  // 9-10-2: when more than one replacement answers to the same departure, the
  // affected player picks. Two on one card is the prompt; one is not a choice
  // at all and is simply applied, which is what it always did.
  DEFS.TWOWAY = {
    ...DEFS.V1,
    id: "TWOWAY",
    name: "TWOWAY",
    energyCost: 2,
    power: 5000,
    traits: ["Earthling"],
    skill: "[Permanent] If this card would leave the Battle Area, send it to your Warp instead.",
  };
  DEFS.WARDEN2 = {
    ...DEFS.V1,
    id: "WARDEN2",
    name: "WARDEN2",
    energyCost: 1,
    skill: "[Permanent] If your ≪Earthling≫ card would be removed from a Battle Area by a skill or KO'd, add that card to your energy in Rest Mode instead.",
  };

  const both = arenaG({ battle: ["TWOWAY", "WARDEN2"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const two = findG(both, "p1", "battle", "TWOWAY");
  let s = playG(both, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = playG(s, { type: "play", player: "p2", card: findG(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [two] });
  assert.equal(s.prompt.kind, "replaceMove", "two mandatory replacements are a question for the affected player");
  assert.equal((s.prompt as { player: PlayerId }).player, masterOfG(s, two), "9-10-2-1: the master of the replaced card chooses");
  assert.deepEqual(labelsG(s), ["To the Warp", "To the Energy Area in Rest Mode"]);

  // The same card with only its own replacement in play is not asked anything.
  const alone = arenaG({ battle: ["TWOWAY"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const solo = findG(alone, "p1", "battle", "TWOWAY");
  let one = playG(alone, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  one = playG(one, { type: "play", player: "p2", card: findG(one, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [solo] });
  assert.notEqual(one.prompt.kind, "replaceMove", "one applicable replacement is not a choice");
  assert.ok(zoneOf(one, "p1", "warp").includes(solo), "and it simply happens");
  assertConsistentG(one);
}

if (!replaceGap("THEIRS/SELFKILL: `bySide` telling an opponent's skill from the controller's own")) {
  // "By an opponent's skill" (19 cards): the same sentence read as "by a
  // skill" would fire on the controller's own skills too, so `bySide` is what
  // separates them and `causeMatches` reads it against who is acting.
  DEFS.THEIRS = {
    ...DEFS.V1,
    id: "THEIRS",
    name: "THEIRS",
    energyCost: 2,
    power: 5000,
    skill: "[Permanent] If this card would be removed from your Battle Area by an opponent's skill or KO'd, send it to your Warp instead.",
  };
  const compiled = compileSkill(parseSkills(DEFS.THEIRS.skill!)[0]);
  assert.deepEqual(compiled.unsupported, []);
  assert.equal((compiled.ops[0] as { by?: string }).by, "skillOrKo");
  assert.equal((compiled.ops[0] as { bySide?: string }).bySide, "opponent");

  // The opponent's skill: the replacement answers.
  let theirs = arenaG({ battle: ["THEIRS"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const card1 = findG(theirs, "p1", "battle", "THEIRS");
  theirs = playG(theirs, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  theirs = playG(theirs, { type: "play", player: "p2", card: findG(theirs, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [card1] });
  assert.ok(zoneOf(theirs, "p1", "warp").includes(card1), "the opponent's skill is the departure the card names");
  assertConsistentG(theirs);

  // The controller's own skill moving the same card: not this moment.
  DEFS.SELFKILL = { ...DEFS.V1, id: "SELFKILL", name: "SELFKILL", energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 of your Battle Cards and KO it." };
  let mine = arenaG({ battle: ["THEIRS"], hand: ["SELFKILL"], energy: ["V1"] });
  const card2 = findG(mine, "p1", "battle", "THEIRS");
  mine = playG(mine, { type: "play", player: "p1", card: findG(mine, "p1", "hand", "SELFKILL") }, { type: "choose", player: "p1", cards: [card2] });
  assert.ok(zoneOf(mine, "p1", "drop").includes(card2), "your own skill is not your opponent's, so the ordinary KO stands");
  assert.ok(!zoneOf(mine, "p1", "warp").includes(card2));
  assertConsistentG(mine);
}

if (!replaceGap("PILEOFF: an optional replacement whose substitute asks a question (9-10-3)")) {
  // 9-10-3 with a program in the departure's place, and a question inside it:
  // the offer is asked first, and the substitute then runs as a frame of its
  // own so what it asks is asked rather than lost (#107).
  DEFS.PILEOFF = {
    ...DEFS.V1,
    id: "PILEOFF",
    name: "PILEOFF",
    energyCost: 2,
    power: 5000,
    skill: "[Permanent] If this card would be removed from your Battle Area by an opponent's skill or KO'd, you may choose 1 card in your hand and discard it instead.",
  };
  const rule = compileSkill(parseSkills(DEFS.PILEOFF.skill!)[0]);
  assert.deepEqual(rule.unsupported, []);
  assert.equal(validateProgram(rule.ops), true, "a replacement that asks is a program the language can say");

  let s = arenaG({ battle: ["PILEOFF"], hand: ["V1", "V-BLUE"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const target = findG(s, "p1", "battle", "PILEOFF");
  const handWas = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = playG(s, { type: "play", player: "p2", card: findG(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [target] });
  assert.equal(s.prompt.kind, "replaceMove", "an optional replacement is offered, never taken on the player's behalf");
  assert.equal(labelsG(s).length, 2, "take the offer, or let the card go");

  // Declining keeps the departure exactly as it was.
  const declined = playG(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.ok(zoneOf(declined, "p1", "drop").includes(target), "the ordinary KO happens when the offer is refused");
  assert.equal(zoneOf(declined, "p1", "hand").length, handWas, "and nothing was discarded");
  assertConsistentG(declined);

  // Taking it keeps the card and asks the question the program carries.
  const taken = playG(s, { type: "chooseMode", player: "p1", index: 0 });
  assert.ok(zoneOf(taken, "p1", "battle").includes(target), "the departure did not happen (9-10-1-1)");
  assert.equal(taken.prompt.kind, "chooseCards", "the substitute stopped and asked, rather than being lost inside move()");
  const answered = playG(taken, { type: "choose", player: "p1", cards: [zoneOf(taken, "p1", "hand")[0]] });
  assert.equal(zoneOf(answered, "p1", "hand").length, handWas - 1, "and the answer was carried out");
  assert.ok(zoneOf(answered, "p1", "battle").includes(target), "the card is still where it was");
  assertConsistentG(answered);
}

if (!replaceGap("ASKER: the other 46 call sites, which cannot wait for an answer (§1.4)")) {
  // The other 46 call sites cannot wait for an answer, so a replacement that
  // would ask one is left unapplied there rather than half-run — the rule the
  // scoping document's §1.4 demands. `payAltCost` is one of them.
  DEFS.ASKER = {
    ...DEFS.V1,
    id: "ASKER",
    name: "ASKER",
    energyCost: 2,
    power: 5000,
    skill: "[Permanent] If this card would leave the Battle Area, choose 1 card in your hand and discard it instead.",
  };
  const asking = compileSkill(parseSkills(DEFS.ASKER.skill!)[0]);
  assert.deepEqual(asking.unsupported, [], "the rule itself is readable — it is the call site that cannot hear it");
  const s = arena({ battle: ["ASKER"], hand: ["V1"] });
  const asker = find(s, "p1", "battle", "ASKER");
  const ev: import("../../src/lib/arena/engine/types").GameEvent[] = [];
  move(CTX, s, ev, asker, "drop", "p1", { reason: "rule" });
  assert.ok(s.players.p1.drop.includes(asker), "a departure nobody can be asked about is not replaced");
  assertConsistent(s);
}

// ── event: "life" (#272) — a life card's own move, not a Battle Area one ────
if (!replaceGap("REVEALER: a life card's own departure, replaced by a [Permanent] that asks")) {
  // "During your opponent's turn, if you would add a card from your life to
  // your hand or place it in your Drop Area, you may reveal it and add it to
  // your hand instead." (BT10-031, SD18-01's shape).
  DEFS.REVEALER = {
    ...DEFS.V1,
    id: "REVEALER",
    name: "REVEALER",
    skill: "[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop Area, you may reveal it and add it to your hand instead.",
  };
  const rule = compileSkill(parseSkills(DEFS.REVEALER.skill!)[0]);
  assert.deepEqual(rule.unsupported, [], "the condition, the moment and the substitute all read");

  // During the controller's own turn, "during your opponent's turn" does not
  // hold, so nothing answers to a departure of their own life at all.
  const own = arenaG({ battle: ["REVEALER"] });
  const ownLife = zoneOf(own, "p1", "life")[0];
  assert.deepEqual(lifeReplacementChoicesFor(CTX, legacyState(own), ownLife, "drop"), [], "the permanent's own condition is during the opponent's turn, not this one");

  // During the opponent's turn — REVEALER defending against a [Critical] hit,
  // so the life card is headed for the Drop (22-6) — the choice is offered.
  const s = arenaG({ battle: ["CRIT"], oppBattle: ["REVEALER"] });
  const attacker = findG(s, "p1", "battle", "CRIT");
  const life = zoneOf(s, "p2", "life")[0];
  const handBefore = zoneOf(s, "p2", "hand").length;
  let r = IMPL.apply(CTX, s, { type: "attack", player: "p1", attacker, target: leaderOf(s, "p2") });
  r = IMPL.apply(CTX, r.state, { type: "pass", player: "p1" });
  r = IMPL.apply(CTX, r.state, { type: "pass", player: "p2" });
  assert.equal(r.state.prompt.kind, "replaceMove", "9-10-3: whether to take the offer is asked");
  assert.equal((r.state.prompt as { player: string }).player, "p2", "the affected player answers, not the attacker");
  assert.equal((r.state.prompt as { options: string[] }).options.length, 2, "the offer, and keeping the ordinary move (9-10-3)");

  // Declining: the ordinary [Critical] move to the Drop stands.
  const declined = IMPL.apply(CTX, r.state, { type: "chooseMode", player: "p2", index: 1 });
  assert.ok(zoneOf(declined.state, "p2", "drop").includes(life), "declined: the card still goes to the Drop");
  assert.equal(zoneOf(declined.state, "p2", "hand").length, handBefore, "and not to the hand");
  assertConsistentG(declined.state);

  // Accepting: revealed, and to the hand instead of the Drop (9-10-1-1 — the
  // move to the Drop never happened), kept public the way a face-up life
  // card already is (`revealedTo`).
  const taken = IMPL.apply(CTX, r.state, { type: "chooseMode", player: "p2", index: 0 });
  assert.ok(zoneOf(taken.state, "p2", "hand").includes(life), "accepted: to the hand instead");
  assert.ok(!zoneOf(taken.state, "p2", "drop").includes(life));
  assert.equal(taken.state.cards[life].faceUp, true, "revealed and kept public (20-11-2)");
  assertConsistentG(taken.state);
}

if (ENGINE === "rules") console.log(`verify/keywords: ${skipped} case(s) skipped on the rules engine — see this file's own keywordGap/staticGap/notYetGap/replaceGap comments`);

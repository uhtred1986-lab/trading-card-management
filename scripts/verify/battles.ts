/**
 * Combos, blockers, counters and the keywords that decide a battle.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 *
 * **#152: this suite runs on both engines now**, through the state-interface
 * layer `harness.ts` grew for it — `arenaG`/`playG`/`findG`/`labelsG` in place
 * of `arena`/`play`/`find`/`labels`, `zoneOf`/`leaderOf`/`unisonOf` in place of
 * `s.players.p1.<area>`/`s.players.p1.leader`. What is the same field on both
 * engines (`s.prompt`, `s.battle`, `s.cards[id].mode`/`.under`/`.markers`/
 * `.flipped`/`.battledThisTurn`, `s.winner`, `s.effects`) is read directly —
 * `harness.ts`'s own header comment for the state-interface section says which
 * fields those are and why. Every case below runs, unchanged in intent, on
 * whichever engine `--engine` names; `npm test` never passes the flag, so
 * `--engine legacy` (the default) is byte-for-byte the suite this always was —
 * `arenaG`'s own legacy branch is `arena()`, untouched.
 *
 * **What is still skipped on `--engine rules`, and why.** A keyword body is
 * Stage 7's (`docs/arena-backlog/s7-*.md`; the milestone is Arena M10):
 * `battle.ts`'s own header names the three battle-math keywords 8-4-6 reads
 * with none of them in force today — [Critical], [Double Strike] (and its
 * general "extra attack" mechanic, [Dual Attack]), [Indestructible],
 * [Revenge], [Unique] and [Evolve] each wait on their own hook group the
 * same way, and [Z-Stack] — the Z-card test's whole second half — has no
 * `vm/` handling at all yet (`vm/host.ts`'s `placeUnder` is real since #152,
 * but the keyword that would call for it here is not). Each is named at its
 * own `keywordGap` call below, which prints the skip and the doc that builds
 * it rather than silently doing nothing. Everything else in this file is a
 * real assertion on both engines, not a keyword gap dressed as one — #152's
 * own acceptance bullet ("the skipped cases are all keyword cases") is what
 * that split is for.
 */
import assert from "node:assert/strict";
import {
  CTX,
  DEFS,
  ENGINE,
  IMPL,
  actsG,
  arenaG,
  assertConsistentAfterDropG,
  assertConsistentG,
  findG,
  gameG,
  labelsG,
  leaderOf,
  placeUnderG,
  playG,
  powerOfG,
  zoneOf,
} from "./harness";
import type { EngineState, PlayerId } from "./harness";

// ── keyword gaps: Stage 7, named rather than silently skipped ───────────────

const S7 = {
  battle: "docs/arena-backlog/s7-04-keywords-battle.md — hook group C: blocking, counters, attack, damage, battle end ([Revenge], [Double/Triple Strike], [Awaken])",
  immunity: "docs/arena-backlog/s7-02-keywords-choosing-immunity.md — hook group A: choosing and immunity ([Critical], [Indestructible], [Unique])",
  playCharge: "docs/arena-backlog/s7-05-keywords-play-charge-pay.md — hook group D: play, charge and paying ([Evolve])",
  enterLeave: "docs/arena-backlog/s7-03-keywords-enter-leave.md — hook group B: entering and leaving ([Z-Stack])",
};

let skipped = 0;

/** True (and the case printed as skipped, naming its Stage 7 doc) only on the rules engine — the legacy engine always runs every case below. */
function keywordGap(keyword: string, doc: string): boolean {
  if (ENGINE !== "rules") return false;
  console.log(`  skipped case — [${keyword}]'s keyword body is not built on the rules engine yet (${doc})`);
  skipped++;
  return true;
}

// ── combos, blockers, counters, keywords ───────────────────────────────────

// Combo power decides the battle (8-4-4/5); combo cards go to the Drop (8-5-8).
{
  let s = arenaG({ hand: ["V1", "V1"], energy: ["V1", "V1"], oppBattle: ["V-BLUE"] });
  const opp = zoneOf(s, "p2", "battle")[0];
  s.cards[opp].mode = "rest";
  const l = labelsG(s);
  assert.ok(
    l.some((x) => x.startsWith("Attack V-BLUE with L-RED")),
    "8-1-1: a rested battle card is a legal target",
  );
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: opp });
  // Offense: combo from hand costs 0 and adds 5000.
  const c1 = findG(s, "p1", "hand", "V1");
  s = playG(s, { type: "combo", player: "p1", card: c1 });
  assert.deepEqual(zoneOf(s, "p1", "combo"), [c1]);
  assert.equal(s.prompt.kind, "combo");
  s = playG(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  const cmp = s.battle;
  assert.equal(cmp, null);
  assert.ok(zoneOf(s, "p2", "drop").includes(opp), "8-4-6-2: the guard is KO'd");
  assert.ok(zoneOf(s, "p1", "drop").includes(c1), "8-5-8: combo cards go to the Drop");
  assertConsistentG(s);
}

// Guard wins on a tie? No: attacker wins ties (8-4-6, ≥). A weaker attacker bounces.
{
  let s = arenaG({ battle: ["REVENGE"], oppBattle: ["BIG"] });
  const big = zoneOf(s, "p2", "battle")[0];
  s.cards[big].mode = "rest";
  const rev = zoneOf(s, "p1", "battle")[0];
  s = playG(s, { type: "attack", player: "p1", attacker: rev, target: big }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(s, "p2", "battle").includes(big), "a 5000 attack into 25000 does nothing");
  assert.ok(zoneOf(s, "p1", "battle").includes(rev), "the attacker is not KO'd by losing");
}

// [Blocker] (22-4): the opponent redirects the attack to an active Blocker, which rests.
{
  let s = arenaG({ oppBattle: ["BLOCKER"] });
  const blocker = zoneOf(s, "p2", "battle")[0];
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  assert.equal(s.prompt.kind, "blocker");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [blocker]);
  s = playG(s, { type: "block", player: "p2", card: blocker });
  assert.equal(s.battle?.guard, blocker);
  assert.equal(s.cards[blocker].mode, "rest", "22-4-2: blocking rests the card");
  s = playG(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(s, "p2", "drop").includes(blocker), "10000 vs 10000: the blocker is KO'd");
  assert.equal(zoneOf(s, "p2", "life").length, 8, "the leader took no damage");
  // A rested Blocker is not offered.
  s = arenaG({ oppBattle: ["BLOCKER"] });
  s.cards[zoneOf(s, "p2", "battle")[0]].mode = "rest";
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  assert.equal(s.prompt.kind, "combo", "no active Blocker → straight to the Offense Step");
}

// 8-1-2-1: the attack card and the guard card have been in a battle, and the
// card remembers it after the battle has ended — which is when BT3-103 asks.
// The turn forgets it, so the memory is always about the turn in progress.
{
  let s = arenaG({ battle: ["V1"], oppBattle: ["BLOCKER", "V-BLUE"] });
  const bystander = findG(s, "p1", "battle", "V1");
  const blocker = findG(s, "p2", "battle", "BLOCKER");
  const other = findG(s, "p2", "battle", "V-BLUE");
  const leader = leaderOf(s, "p1");
  for (const id of [leader, bystander, blocker, other]) assert.equal(s.cards[id].battledThisTurn, false, `${id} has been in no battle yet`);
  s = playG(s, { type: "attack", player: "p1", attacker: leader, target: leaderOf(s, "p2") });
  assert.equal(s.cards[leader].battledThisTurn, true, "8-1-2: the attacker is in the battle");
  assert.equal(s.cards[leaderOf(s, "p2")].battledThisTurn, true, "…and so is the card it attacked");
  assert.equal(s.prompt.kind, "blocker");
  s = playG(s, { type: "block", player: "p2", card: blocker });
  assert.equal(s.cards[blocker].battledThisTurn, true, "22-4: a Blocker taking the attack is the guard card");
  assert.equal(s.cards[bystander].battledThisTurn, false, "a card that stayed out of it was in no battle");
  assert.equal(s.cards[other].battledThisTurn, false);
  s = playG(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.battle, null, "8-5-13: the battle is over");
  assert.equal(s.cards[leader].battledThisTurn, true, "8-1-2-2: the roles end with the battle, the memory does not");
  // …and the turn does end it.
  s = playG(s, { type: "endMain", player: "p1" });
  while (s.prompt.kind !== "charge") s = playG(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.turnPlayer, "p2");
  for (const id of Object.keys(s.cards)) assert.equal(s.cards[id].battledThisTurn, false, `${id} starts the turn having been in no battle`);
}

// BT3-103 end to end: a trigger printed at the end of the sentence, a memory of
// the battle just fought, and an optional price. None of the three is any use
// without the other two, so the card is played rather than inspected.
if (!keywordGap("Awaken", S7.battle) && !keywordGap("Blocker's triggered follow-up", S7.battle)) {
  let s = arenaG({ battle: ["BERGAMO"], hand: ["V1"] });
  const berg = findG(s, "p1", "battle", "BERGAMO");
  // Hand it over to p2, so that the block happens on the opponent's turn.
  s = playG(s, { type: "endMain", player: "p1" });
  while (s.prompt.kind !== "charge") s = playG(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.turnPlayer, "p2");
  s = playG(s, { type: "charge", player: "p2", card: null });
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") });
  assert.equal(s.prompt.kind, "blocker");
  s = playG(s, { type: "block", player: "p1", card: berg });
  assert.equal(s.cards[berg].mode, "rest", "22-4-2: blocking rests it");
  assert.equal(s.cards[berg].battledThisTurn, true);
  s = playG(s, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  // The battle is over, and the skill it triggered is asking for its price.
  assert.equal(s.prompt.kind, "chooseCards", "the [Auto] fired at the end of the battle");
  const ask = s.prompt as { player: PlayerId; choice: { candidates: string[]; min: number } };
  assert.equal(ask.player, "p1");
  assert.equal(ask.choice.min, 0, "5-2-4: the price may be declined");
  const paid = findG(s, "p1", "hand", "V1");
  assert.ok(ask.choice.candidates.includes(paid));
  s = playG(s, { type: "choose", player: "p1", cards: [paid] });
  assert.ok(zoneOf(s, "p1", "drop").includes(paid), "the card leaves the hand once the price is met");
  assert.equal(s.cards[berg].mode, "active", "…and it is ready to block again");
  assert.equal(powerOfG(s, berg), 20000, "+5000 for the turn");
}

// [Counter: Attack] "Negate the attack" (22-10-3-2, 8-1-6-1).
{
  let s = arenaG({ oppHand: ["E-NEGATE"], oppEnergy: ["V1"] });
  const neg = findG(s, "p2", "hand", "E-NEGATE");
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  assert.equal(s.prompt.kind, "counter");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [neg]);
  s = playG(s, { type: "counter", player: "p2", card: neg });
  assert.equal(s.battle, null, "the battle ended without an Offense Step");
  assert.equal(s.prompt.kind, "main");
  assert.equal(zoneOf(s, "p2", "life").length, 8);
  assert.ok(zoneOf(s, "p2", "drop").includes(neg), "22-10-7: the counter card goes to the Drop");
  assert.equal(s.cards[leaderOf(s, "p1")].mode, "rest", "the attacker stays rested");
  assertConsistentG(s);
  // Without energy the counter isn't offered.
  s = arenaG({ oppHand: ["E-NEGATE"] });
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  assert.equal(s.prompt.kind, "combo");
}

// What a battle contains (`docs/arena-battle-staging-spec.md` §3.1): the
// counters played into it, and what every card in it is contributing.
//
// A counter is only a card reaching the Drop, so the battle has to write it
// down as it is played or nothing downstream can ever say one happened. The
// figures are the same arithmetic the two totals are made of, kept rather
// than thrown away — which is what lets a board attribute a total changing to
// the card that changed it instead of diffing numbers between renders.
{
  DEFS["E-PUMP"] = { ...DEFS["E-NEGATE"], id: "E-PUMP", name: "E-PUMP", skill: "[Counter: Attack] Your Leader Card gets +10000 power for the duration of the turn." };
  let s = arenaG({ battle: ["V1"], oppHand: ["E-PUMP"], oppEnergy: ["V1", "BIG"] });
  const attacker = leaderOf(s, "p1");
  const guard = leaderOf(s, "p2");
  const pump = findG(s, "p2", "hand", "E-PUMP");

  assert.equal(IMPL.boardView(CTX, s, "p1", {}).battle, null, "no battle, nothing to say about one");

  s = playG(s, { type: "attack", player: "p1", attacker, target: guard });
  const declared = IMPL.boardView(CTX, s, "p1", {}).battle!;
  assert.equal(declared.counters, undefined, "a battle nobody has answered names no counters");
  assert.equal(declared.contributions![attacker], declared.attackPower, "the attacker alone is the whole attack figure");
  assert.equal(declared.contributions![guard], declared.guardPower);

  assert.equal(s.prompt.kind, "counter");
  const { state, events } = IMPL.apply(CTX, s, { type: "counter", player: "p2", card: pump });
  s = state as EngineState;

  // The skill said for itself that it belongs to this battle (§3.2). Nothing
  // may read that off a power figure moving.
  const fired = IMPL.toBeats(CTX, s, events, 0).list.find((b) => b.t === "skill");
  assert.ok(fired && fired.t === "skill" && fired.inBattle, "a counter's skill fires inside the battle");

  const b = IMPL.boardView(CTX, s, "p1", {}).battle!;
  assert.equal(b.counters?.length, 1, "the battle remembers the card played into it");
  assert.equal(b.counters![0].card.id, pump);
  assert.equal(b.counters![0].by, "p2", "…and who played it");
  assert.equal(b.counters![0].after, 0, "…and where in that side's chain it belongs");
  assert.ok(zoneOf(s, "p2", "drop").includes(pump), "22-10-7: which is in the Drop by now, indistinguishable there");
  assert.equal(b.contributions![pump], 10000, "the counter's share of the guard's figure");
  assert.equal(b.contributions![guard], b.guardPower, "…which is already inside it, never a term beside it");
  assert.equal(b.guardPower, declared.guardPower + 10000);
  assertConsistentG(s);

  // A combo card's contribution is its combo power, and the side's cards add
  // up to that side's total exactly.
  if (s.prompt.kind === "combo" && (s.prompt as { player: PlayerId }).player === "p1") {
    const v1 = findG(s, "p1", "battle", "V1");
    s = playG(s, { type: "combo", player: "p1", card: v1 });
    const c = IMPL.boardView(CTX, s, "p1", {}).battle!;
    assert.equal(c.contributions![attacker] + c.contributions![v1], c.attackPower, "attacker + combo is the attack figure");
    assert.ok(c.contributions![v1] > 0, "a combo card is worth what it added");
  }
}

// [Critical] sends life to the Drop (22-6); [Double Strike] deals 2 (22-7).
if (!keywordGap("Critical", S7.immunity) && !keywordGap("Double Strike", S7.battle)) {
  let s = arenaG({ battle: ["CRIT", "DOUBLE"] });
  const crit = findG(s, "p1", "battle", "CRIT");
  const dbl = findG(s, "p1", "battle", "DOUBLE");
  const hand = zoneOf(s, "p2", "hand").length;
  s = playG(s, { type: "attack", player: "p1", attacker: crit, target: leaderOf(s, "p2") }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(zoneOf(s, "p2", "life").length, 7);
  assert.equal(zoneOf(s, "p2", "drop").length, 1, "22-6: the life card went to the Drop");
  assert.equal(zoneOf(s, "p2", "hand").length, hand, "not to the hand");
  s = playG(s, { type: "attack", player: "p1", attacker: dbl, target: leaderOf(s, "p2") }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(zoneOf(s, "p2", "life").length, 5, "22-7: two damage");
  assert.equal(zoneOf(s, "p2", "hand").length, hand + 2, "both life cards went to the hand");
}

// [Dual Attack] (22-8): the attacker is active again after the battle, once per turn.
if (!keywordGap("Dual Attack", S7.battle)) {
  let s = arenaG({ battle: ["DUAL"] });
  const dual = zoneOf(s, "p1", "battle")[0];
  s = playG(s, { type: "attack", player: "p1", attacker: dual, target: leaderOf(s, "p2") }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.cards[dual].mode, "active", "22-8-3: switched back to Active Mode at the end of the battle");
  s = playG(s, { type: "attack", player: "p1", attacker: dual, target: leaderOf(s, "p2") }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.cards[dual].mode, "rest", "only X-1 = 1 extra attack per turn");
  assert.equal(zoneOf(s, "p2", "life").length, 6);
}

// [Indestructible] survives a losing battle (22-12); [Revenge] KOs the attacker (22-9).
if (!keywordGap("Indestructible", S7.immunity) && !keywordGap("Revenge", S7.battle)) {
  let s = arenaG({ battle: ["BIG"], oppBattle: ["INDESTRUCT", "REVENGE"] });
  const big = zoneOf(s, "p1", "battle")[0];
  const ind = findG(s, "p2", "battle", "INDESTRUCT");
  const rev = findG(s, "p2", "battle", "REVENGE");
  s.cards[ind].mode = "rest";
  s.cards[rev].mode = "rest";
  s = playG(s, { type: "attack", player: "p1", attacker: big, target: ind }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(s, "p2", "battle").includes(ind), "22-12: not KO'd by battle");
  // Wake BIG up for a second attack.
  s.cards[big].mode = "active";
  s = playG(s, { type: "attack", player: "p1", attacker: big, target: rev }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(zoneOf(s, "p2", "drop").includes(rev), "the Revenge card is KO'd");
  assert.ok(zoneOf(s, "p1", "drop").includes(big), "22-9-4: and it KOs the attacker at the end of the battle");
}

// [Unique] (22-39): a second copy can't be played while one is in play.
if (!keywordGap("Unique", S7.immunity)) {
  const s = arenaG({ hand: ["UNIQ"], battle: ["UNIQ"], energy: ["V1"] });
  assert.ok(!labelsG(s).some((x) => x.startsWith("Play UNIQ")));
}

// Extras: [Activate: Main] with a native effect from hand (12-2-2).
{
  let s = arenaG({ hand: ["E-DRAW"], energy: ["V1"] });
  const e = findG(s, "p1", "hand", "E-DRAW");
  assert.ok(labelsG(s).some((x) => x.startsWith("Activate E-DRAW")));
  const before = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "activate", player: "p1", card: e, skill: 0 });
  assert.equal(zoneOf(s, "p1", "hand").length, before - 1 + 2, "card left the hand, two drawn");
  assert.ok(zoneOf(s, "p1", "drop").includes(e), "12-2-2-2: the Extra goes to the Drop");
  assert.equal(s.prompt.kind, "main");
}

// [Awaken] (22-2): offered only when the printed condition holds, flips the leader.
if (!keywordGap("Awaken", S7.battle)) {
  let s = arenaG({ battle: [] });
  assert.ok(!labelsG(s).some((x) => x.startsWith("Awaken")), "life 8 > 4");
  zoneOf(s, "p1", "life").splice(4); // drop to 4 life for the test
  assertConsistentAfterDropG(s);
  assert.ok(
    labelsG(s).some((x) => x.startsWith("Awaken")),
    "life ≤ 4",
  );
  const before = zoneOf(s, "p1", "hand").length;
  s = playG(s, { type: "activate", player: "p1", card: leaderOf(s, "p1"), skill: 0 });
  assert.equal(s.cards[leaderOf(s, "p1")].flipped, true, "22-2-4: flipped after the effect");
  assert.equal(zoneOf(s, "p1", "hand").length, before + 1, "the Draw 1 in the text ran");
  assert.equal(powerOfG(s, leaderOf(s, "p1")), 15000, "the back side's power counts");
  assert.ok(!labelsG(s).some((x) => x.startsWith("Awaken")), "can't awaken twice");
}

// BT2-001: the card the mill just put in the Drop is what "that card" means,
// and the power only follows when it is red. Played out both ways, because the
// program this replaced gained the power either way.
{
  for (const [top, power, why] of [
    ["V1", 15000, "the milled card is red, so the skill applies"],
    ["V-BLUE", 10000, "a blue one leaves the power alone"],
  ] as const) {
    let s = arenaG({ hand: ["MILLGATE"], energy: ["V1"] });
    s.cards[zoneOf(s, "p1", "deck")[0]].cardId = top;
    const dropBefore = zoneOf(s, "p1", "drop").length;
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "MILLGATE") });
    assert.equal(zoneOf(s, "p1", "drop").length, dropBefore + 1, "the mill happens either way");
    assert.equal(s.cards[zoneOf(s, "p1", "drop")[zoneOf(s, "p1", "drop").length - 1]].cardId, top, "and it is the card that was on top");
    assert.equal(powerOfG(s, findG(s, "p1", "battle", "MILLGATE")), power, why);
    assertConsistentG(s);
  }
}

// Two choices, then a clause saying which is which (BT3-052, BT3-054): the
// card that gets buried is the opponent's, and it goes under the <Majin Buu>
// that was chosen — not under the card whose skill this is, which is what "the
// chosen cards" alone would have meant.
{
  let s = arenaG({ hand: ["BUUEAT"], energy: ["V1", "V1"], battle: ["BUUHOST"], oppBattle: ["V-BLUE", "BLOCKER"] });
  const host = findG(s, "p1", "battle", "BUUHOST");
  const prey = findG(s, "p2", "battle", "V-BLUE");
  const spared = findG(s, "p2", "battle", "BLOCKER");
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "BUUEAT") });
  assert.equal(s.prompt.kind, "chooseCards", "two <Majin Buu> are on the table, so it asks which");
  s = playG(s, { type: "choose", player: "p1", cards: [host] });
  assert.equal(s.prompt.kind, "chooseCards", "then which of the opponent's Battle Cards");
  s = playG(s, { type: "choose", player: "p1", cards: [prey] });
  assert.ok(!zoneOf(s, "p2", "battle").includes(prey), "it is no longer a Battle Card of its own");
  assert.ok(!zoneOf(s, "p2", "drop").includes(prey), "and it did not go to the Drop");
  assert.deepEqual(s.cards[host].under, [prey], "23-2: under the <Majin Buu> that was chosen");
  assert.deepEqual(s.cards[findG(s, "p1", "battle", "BUUEAT")].under, [], "not under the card that played the skill");
  assert.ok(zoneOf(s, "p2", "battle").includes(spared), "the opponent's other card is untouched");
  assertConsistentG(s);
}

// 23-2-6: a card that already has a pile of its own takes the pile with it
// when it is buried under a card in an area of the same name. The fuzzer found
// this as "BT31-132 found 0 times" — BT3-052 buried an evolved Cell under a
// <Majin Buu>, the cards under it stayed hanging off a card that was itself in
// a pile, and nothing in the engine reads a nested pile, so they vanished.
{
  let s = arenaG({ hand: ["BUUEAT"], energy: ["V1", "V1"], battle: ["BUUHOST"], oppBattle: ["V-BLUE", "BLOCKER"] });
  const host = findG(s, "p1", "battle", "BUUHOST");
  const prey = findG(s, "p2", "battle", "V-BLUE");
  // Give the opponent's card a stack of two, oldest first, as an [Evolve] would.
  const buried = zoneOf(s, "p2", "deck").splice(0, 2);
  s.cards[prey].under.push(...buried);
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "BUUEAT") });
  s = playG(s, { type: "choose", player: "p1", cards: [host] });
  s = playG(s, { type: "choose", player: "p1", cards: [prey] });
  assert.deepEqual(s.cards[prey].under, [], "the pile is not nested under a card in a pile");
  assert.deepEqual(s.cards[host].under, [prey, ...buried], "23-2-3/23-2-4: in the order they were, on the very bottom");
  assertConsistentG(s);
}

// 23-2-5: the same card buried under a Leader instead — the Battle Area's name
// changes, so what was under it goes to its owner's Drop rather than along.
{
  const s = arenaG({ battle: ["V1"], oppBattle: ["V-BLUE"] });
  const prey = findG(s, "p2", "battle", "V-BLUE");
  const buried = zoneOf(s, "p2", "deck").splice(0, 1);
  s.cards[prey].under.push(...buried);
  assert.ok(placeUnderG(s, prey, leaderOf(s, "p1")));
  assert.deepEqual(s.cards[leaderOf(s, "p1")].under, [prey], "only the card itself follows");
  assert.deepEqual(zoneOf(s, "p2", "drop").slice(0, 1), buried, "23-2-5: to its owner's Drop");
  assertConsistentG(s);
}

// Unison (13-2, 13-3, 13-5): X markers, growth, guard loses a marker instead of KO.
//
// The button's own wording ("Play Unison U1 with 3 markers" vs the rules
// engine's generic "Play Unison U1 with X = 3") is `wordings.ts`'s promise,
// not this suite's — checked here through the action offered, which is the
// same shape and the same legality on both engines, per §3.2.
{
  let s = arenaG({ hand: ["U1", "U1"], energy: ["V1", "V1", "V1"] });
  const u = findG(s, "p1", "hand", "U1");
  assert.ok(actsG(s).some((a) => a.type === "playUnison" && (a as { card: string; x: number }).card === u && (a as { x: number }).x === 3), "playing U1 with the full 3 markers is not offered");
  s = playG(s, { type: "playUnison", player: "p1", card: u, x: 2 });
  assert.equal(s.cards[u].markers, 2, "13-2-1-3: markers equal the energy paid");
  assert.ok(
    actsG(s).some((a) => a.type === "growUnison"),
    "13-3-2: a copy in hand can grow it",
  );
  const copy = findG(s, "p1", "hand", "U1");
  s = playG(s, { type: "growUnison", player: "p1", card: copy });
  assert.equal(s.cards[u].markers, 3);
  assert.deepEqual(s.cards[u].under, [copy]);
  assert.ok(!actsG(s).some((a) => a.type === "growUnison"), "once per turn");
  // Opponent attacks the Unison next turn: no Defense Step, one marker off.
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: u }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "main", "8-2-4-3-1-1: no Defense Step against a Unison");
  assert.equal(s.cards[u].markers, 2, "13-5-2-3: one marker removed");
  assertConsistentG(s);
}

// Z-cards (16-2, 22-47): Z-Energy is paid from the Z-Energy Area; Z-Stack asks which card to tuck.
if (!keywordGap("Z-Stack", S7.enterLeave)) {
  let s = arenaG({ hand: ["V1"], energy: ["V1", "V1"], z: ["ZB", "V1"] });
  // Nothing in Z-Energy yet → not playable.
  assert.ok(!labelsG(s).some((x) => x.includes("Z-Battle")));
  // Combo a card and send it to Z-Energy at the end of a battle (8-5-2).
  s = playG(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") });
  const c = findG(s, "p1", "hand", "V1");
  s = playG(s, { type: "combo", player: "p1", card: c }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "zEnergyFromCombo");
  s = playG(s, { type: "zEnergyFromCombo", player: "p1", card: c });
  assert.deepEqual(zoneOf(s, "p1", "zEnergy"), [c]);
  assert.ok(
    labelsG(s).some((x) => x.startsWith("Play Z-Battle ZB")),
    "now affordable",
  );
  const zb = findG(s, "p1", "zDeck", "ZB");
  s = playG(s, { type: "playZ", player: "p1", card: zb });
  assert.equal(zoneOf(s, "p1", "zEnergy").length, 0, "5-4-1: Z-Energy paid to the Drop");
  assert.equal(s.prompt.kind, "chooseCards", "22-47: Z-Stack asks for the card to place under");
  const tuck = (s.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  s = playG(s, { type: "choose", player: "p1", cards: [tuck] });
  assert.ok(zoneOf(s, "p1", "battle").includes(zb));
  assert.deepEqual(s.cards[zb].under, [tuck]);
  assert.equal(zoneOf(s, "p1", "zDeck").length, 0);
  assertConsistentG(s);
  // A Z-card leaving play is removed from the game (14-1-4), and the tucked card goes to the Drop.
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s.cards[zb].mode = "rest";
  // Give p2 something strong enough: bump the leader's power for the test.
  s.effects.push({ id: 99, target: leaderOf(s, "p2"), kind: "power", value: 20000, until: "turn", ownerTurn: "p2", master: "p2", createdTurn: s.turn });
  s = playG(s, { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: zb }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(zoneOf(s, "p1", "removed").includes(zb), "14-1-4: removed instead of Drop");
  assert.ok(zoneOf(s, "p1", "drop").includes(tuck), "23-2-5: the card under it went to the Drop");
  assertConsistentG(s);
}

// [Evolve] (22-5): pay, choose the base, the stack keeps the slot.
if (!keywordGap("Evolve", S7.playCharge)) {
  let s = arenaG({ hand: ["EVO"], battle: ["V1"], energy: ["V1"] });
  const evo = findG(s, "p1", "hand", "EVO");
  const base = zoneOf(s, "p1", "battle")[0];
  assert.ok(labelsG(s).some((x) => x.startsWith("Evolve EVO")));
  s = playG(s, { type: "activate", player: "p1", card: evo, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  s = playG(s, { type: "choose", player: "p1", cards: [base] });
  assert.deepEqual(zoneOf(s, "p1", "battle"), [evo]);
  assert.deepEqual(s.cards[evo].under, [base]);
  assert.equal(s.cards[zoneOf(s, "p1", "energy")[0]].mode, "rest", "the {1} was paid");
  assertConsistentG(s);
}

// Loss: no life (21-2-2-1) ends the game immediately; no deck too.
{
  let s = arenaG({ battle: ["DOUBLE"] });
  zoneOf(s, "p2", "life")
    .splice(1)
    .forEach((id) => zoneOf(s, "p2", "drop").push(id));
  const dbl = zoneOf(s, "p1", "battle")[0];
  s = playG(s, { type: "attack", player: "p1", attacker: dbl, target: leaderOf(s, "p2") }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.phase, "over");
  assert.equal(s.winner, "p1");
  assert.equal(s.prompt.kind, "gameOver");
  assert.throws(() => playG(s, { type: "endMain", player: "p1" }));

  let d = arenaG();
  zoneOf(d, "p1", "deck")
    .splice(0)
    .forEach((id) => zoneOf(d, "p1", "drop").push(id));
  d = playG(d, { type: "endMain", player: "p1" });
  assert.equal(d.phase, "over", "21-2-2-2: an empty deck loses at the next rule processing, not only when drawing");
  assert.equal(d.winner, "p2");
}

// Concede (0-1-3-4) works at any prompt.
{
  const s = playG(arenaG(), { type: "concede", player: "p1" });
  assert.equal(s.winner, "p2");
}

// Determinism: the same seed and actions reproduce the same state.
{
  const run = () => {
    let s = gameG(42);
    const chooser = (s.prompt as { player: PlayerId }).player;
    s = playG(s, { type: "chooseFirst", player: chooser, first: "p2" }, { type: "mulligan", player: "p2", redraw: true }, { type: "mulligan", player: "p1", redraw: false });
    s = playG(s, { type: "charge", player: "p2", card: zoneOf(s, "p2", "hand")[2] }, { type: "endMain", player: "p2" });
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
}

if (ENGINE === "rules") console.log(`verify/battles: ${skipped} case(s) skipped on the rules engine, all named keyword gaps`);

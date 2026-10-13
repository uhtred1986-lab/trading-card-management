/**
 * #757 U1-c, rows "Conditional (if ...)" and "Conditions: Leader match, life, counts, did/chose, battle, turn" of the
 * #649 deck audit: each printed condition is played on both sides (holds / does not hold) on the rules engine, with the
 * cards' own wording (see `u1c-757-lib.ts`). The last block is the coverage proof: every deck skill the audit counts
 * in the four U1-c rows is either registered as played by these suites or named with the issue that owns the gap.
 */
import assert from "node:assert/strict";
import moves from "./u1c-moves-757";
import { apply, atMain, attack, drive, energy, had, kw, legal, mainPhase, mark, played, power, setLife, stage, zone } from "./u1c-757-lib";
import type { VmState } from "../../src/lib/arena/vm/state";

/** Skills a played scenario would have to assert something the engine does not do yet: the issue that owns each. */
export const OPEN_GAPS: Record<string, number> = {};

const ROWS = ["op-effects", "op-moves", "op-if", "cond"];

async function main(): Promise<void> {
  await moves;

  // ── "Your Leader Card is ..." conditions, the side the effect suite did not play: the Leader does not match. ──
  const offered = (s: VmState, card: string, skill = 0) => legal(s).some((l) => (l.action.type === "activate" || l.action.type === "counter") && l.action.card === card && (l.action.type === "counter" || l.action.skill === skill));

  // BT6-025 #0 "If your Leader Card is red:" — a yellow Leader: the [Activate: Main] is not offered (9-2, 5-8).
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const me = stage(s, "p1", "BT6-025", "hand");
    energy(s, "p1", 1);
    stage(s, "p2", "BLUE757", "battle");
    assert.equal(offered(s, me), false, "yellow Leader: not offered");
    const red = mainPhase({ turn: 3 });
    const mine = stage(red, "p1", "BT6-025", "hand");
    energy(red, "p1", 1);
    stage(red, "p2", "BLUE757", "battle");
    assert.equal(offered(red, mine), true, "red Leader: offered");
  }

  // BT5-023 / BT6-026 (counters): the same condition is the price of the [Counter] (#716).
  for (const id of ["BT5-023", "BT6-026"]) {
    for (const [leader, expected] of [["SD15-01", true], ["SD5-01", false]] as const) {
      const s = mainPhase({ turn: 2, leader1: leader });
      const ctr = stage(s, "p1", id, "hand");
      energy(s, "p1", 1);
      const atk = stage(s, "p2", "BLUE757", "battle");
      const first = apply(s, { type: "attack", player: "p2", attacker: atk, target: s.sides.p1.zones.leader[0] });
      const open = drive(first.state, (st) => st.prompt.kind === "counter" || st.prompt.kind === "main");
      assert.equal(open.s.prompt.kind === "counter" && offered(open.s, ctr), expected, `${id} with ${leader}: ${expected ? "offered" : "not offered"}`);
    }
  }

  // BT14-010 #10 "If your Leader Card is red and your life is at 4 or less:" — both halves of the AND (cond all).
  for (const [leader, life, draws] of [["SD15-01", 4, true], ["SD5-01", 4, false], ["SD15-01", 5, false]] as const) {
    const s = mainPhase({ turn: 3, leader1: leader });
    setLife(s, "p1", life);
    const atk = stage(s, "p1", "RED757", "battle");
    const combo = stage(s, "p1", "BT14-010", "hand");
    const hand = zone(s, "p1", "hand").length;
    let used = false;
    const r = attack(s, atk, { pick: (st, o) => { const c = st.prompt.kind === "combo" ? o.find((a) => a.type === "combo" && a.card === combo) : undefined; if (c && !used) { used = true; return c; } return undefined; } });
    assert.equal(zone(r.s, "p1", "hand").length, hand - 1 + (draws ? 1 : 0), `${leader}, life ${life}: ${draws ? "draws" : "no draw"}`);
  }

  // DB3-001 #0 "If your Leader Card is red and your opponent's life is at 5 or more:" — a yellow Leader.
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const u = stage(s, "p1", "DB3-001", "hand");
    energy(s, "p1", 4);
    const first = apply(s, { type: "playUnison", player: "p1", card: u, x: 2 });
    const r = drive(first.state, atMain, undefined, [...first.events]);
    assert.ok(!had(r.events, (e) => e.type === "damage" && e.player === "p2"), "yellow Leader: no damage");
  }

  // SD5-03 #30 "if your Leader Card is <<Goku's Lineage>>" — a Leader without the trait: nothing is KO'd.
  {
    const s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "SD5-03", "hand");
    energy(s, "p1", 6, "YEL757");
    const foe = stage(s, "p2", "BLUE757", "battle");
    const first = apply(s, { type: "play", player: "p1", card: me });
    const r = drive(first.state, atMain, undefined, [...first.events]);
    assert.ok(zone(r.s, "p2", "battle").includes(foe), "SD15-01 is not a <<Goku's Lineage>> Leader: no KO");
  }

  // BT4-086 #20 — a red Leader (not a yellow <<Goku's Lineage>>) at 4 life: no draw, no combo power.
  {
    const s = mainPhase({ turn: 3 });
    setLife(s, "p1", 4);
    const atk = stage(s, "p1", "YEL757", "battle");
    const combo = stage(s, "p1", "BT4-086", "hand");
    energy(s, "p1", 1, "YEL757");
    const hand = zone(s, "p1", "hand").length;
    const r = attack(s, atk, { pick: (st, o) => (st.prompt.kind === "combo" ? o.find((a) => a.type === "combo" && a.card === combo) : undefined) });
    assert.equal(zone(r.s, "p1", "hand").length, hand - 1, "red Leader: no draw");
    assert.equal(r.events.find((e) => e.type === "powerCompare")?.type === "powerCompare" && (r.events.find((e) => e.type === "powerCompare") as { attackPower: number }).attackPower, 10000);
  }

  // BT4-096 #0 "If your Leader Card is <<Goku's Lineage>> with <Son Goku> in its character name, it gains +15000 power and
  //    [Double Strike] ..." — printed without a colon, so the condition is part of the effect (not a price): with a Vegeta
  //    Leader the [Activate: Battle] can be declared and does nothing.
  {
    const s = mainPhase({ turn: 3 });
    const leader = s.sides.p1.zones.leader[0];
    const ex = stage(s, "p1", "BT4-096", "hand");
    energy(s, "p1", 1, "YEL757");
    const r = attack(s, leader, { pick: (st, o) => (st.prompt.kind === "combo" ? o.find((a) => a.type === "activate" && a.card === ex) : undefined) });
    assert.ok(had(r.events, (e) => e.type === "skill" && e.card === ex), "the skill was activated");
    assert.equal((r.events.find((e) => e.type === "powerCompare") as { attackPower: number }).attackPower, 15000, "10000 + SD15-01's own +5000 Auto, and none of BT4-096's +15000");
    assert.ok(had(r.events, (e) => e.type === "damage" && e.amount === 1), "1 damage, no [Double Strike]");
  }

  // DB1-019 #0 "If your Leader Card is a red <<Saiyan>> card:" — SD5-01 is a yellow Saiyan: not offered.
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const ex = stage(s, "p1", "DB1-019", "hand");
    energy(s, "p1", 2);
    let everOffered = false;
    attack(s, s.sides.p1.zones.leader[0], { pick: (_st, o) => { if (o.some((a) => a.type === "activate" && a.card === ex)) everOffered = true; return undefined; } });
    assert.equal(everOffered, false, "a yellow Leader: never offered during the battle");
  }

  // ── [Permanent] and [Awaken] conditions ──

  // SD15-03 #10 "[Permanent] If this card is in Rest Mode and you have a red Unison Card with a specified cost of 2 in play,
  //    this card and your red Leader Card get +1000 power." (cond count; two conditions, 9-5)
  for (const [mode, unison, bonus] of [["rest", true, 1000], ["active", true, 0], ["rest", false, 0]] as const) {
    const s = mainPhase({ turn: 3 });
    const goku = stage(s, "p1", "SD15-03", "battle", mode);
    if (unison) stage(s, "p1", "SD15-02", "unison");
    assert.equal(power(s, goku), 20000 + bonus, `${mode}, Unison ${unison}: this card`);
    assert.equal(power(s, s.sides.p1.zones.leader[0]), 10000 + bonus, `${mode}, Unison ${unison}: the red Leader`);
  }
  mark("SD15-03#10");

  // SD5-01 #10 "[Awaken] When your life is at 4 or less: You may choose up to 2 of your energy, switch them to Active Mode,
  //    and flip this card over." (cond life, switchMode; 22-2)
  for (const [life, flips] of [[4, true], [5, false]] as const) {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const leader = s.sides.p1.zones.leader[0];
    setLife(s, "p1", life);
    const e1 = stage(s, "p1", "RED757", "energy", "rest");
    const e2 = stage(s, "p1", "RED757", "energy", "rest");
    const act = legal(s).map((l) => l.action).find((a) => a.type === "activate" && a.card === leader);
    assert.equal(!!act, flips, flips ? "life 4: offered" : "life 5: not offered");
    if (act) {
      const r = drive(apply(s, act).state, atMain);
      assert.equal(r.s.cards[leader].flipped, true, "flipped");
      assert.equal([e1, e2].filter((id) => r.s.cards[id].mode === "active").length, 2, "both energy switched to Active Mode");
    }
  }
  mark("SD5-01#10");

  // BT10-008 #10 "[Permanent] If you have a red Unison Card with 2 or more markers in play, you can activate this card's
  //    [Counter] skill from your hand without paying its energy cost." (cond count)
  for (const [markers, free] of [[2, true], [1, false]] as const) {
    const s = mainPhase({ turn: 2 });
    const yamcha = stage(s, "p1", "BT10-008", "hand");
    const uni = stage(s, "p1", "SD15-02", "unison");
    s.cards[uni].markers = markers;
    stage(s, "p2", "BLUE757", "battle");
    const played2 = stage(s, "p2", "BLUE757", "hand");
    energy(s, "p2", 2, "BLUE757");
    const first = apply(s, { type: "play", player: "p2", card: played2 });
    const open = drive(first.state, (st) => st.prompt.kind === "counter" || st.prompt.kind === "main");
    assert.equal(open.s.prompt.kind === "counter" && offered(open.s, yamcha), free, free ? "2 markers: offered with no energy at all" : "1 marker: 3 energy needed, none: not offered");
  }
  mark("BT10-008#10");

  // BT4-097 #10 "[Permanent] If your Leader Card is <<Goku's Lineage>>, when you activate this card's [Counter], you may choose
  //    1 card in your life and add it to your hand. If you do so, you may activate this card's [Counter] without paying its
  //    energy cost." (cond leaderMatches, did)
  for (const [leader, free] of [["SD5-01", true], ["SD15-01", false]] as const) {
    const s = mainPhase({ turn: 2, leader1: leader });
    const ctr = stage(s, "p1", "BT4-097", "hand");
    const atk = stage(s, "p2", "BLUEBIG757", "battle");
    const life = zone(s, "p1", "life").length;
    const first = apply(s, { type: "attack", player: "p2", attacker: atk, target: s.sides.p1.zones.leader[0] });
    const open = drive(first.state, (st) => st.prompt.kind === "counter" || st.prompt.kind === "main");
    assert.equal(open.s.prompt.kind === "counter" && offered(open.s, ctr), free, free ? "Goku's Lineage Leader: offered without energy" : "other Leader and no energy: not offered");
    if (free) {
      const r = drive(open.s, atMain, (st, o) => (st.prompt.kind === "counter" ? o.find((a) => a.type === "counter" && a.card === ctr) : undefined), [...first.events]);
      assert.ok(had(r.events, (e) => e.type === "attackNegated"), "the attack was negated");
      assert.equal(zone(r.s, "p1", "life").length, life - 1, "the price: a life card was added to the hand");
    }
  }
  mark("BT4-097#10");

  // SD5-01b #10 "during your turn": the bonus is for the controller's own turn only (cond isTurnPlayer).
  {
    const s = mainPhase({ turn: 2, leader1: "SD5-01" });
    const leader = s.sides.p1.zones.leader[0];
    s.cards[leader].flipped = true;
    setLife(s, "p1", 4);
    setLife(s, "p2", 5);
    assert.equal(power(s, leader), 15000, "p2's turn: no +5000");
    assert.equal(kw(s, leader, "Critical"), false, "p2's turn: no [Critical]");
  }

  // ── coverage: every face the four rows count was played ──
  // The audit script is an ES module with top-level await: loaded dynamically, it does nothing unless run as a script.
  const { auditDecks, familyOf, loadSnapshot } = await import("../arena-deck-audit.mts");
  const audits = auditDecks(loadSnapshot().cards as never);
  const counted = new Map<string, Set<string>>();
  for (const a of audits) {
    for (const s of a.skills) {
      const key = `${s.cardId}${s.face === "back" ? "b" : ""}#${s.index}`;
      for (const m of s.mechanics) {
        const fam = familyOf(m);
        if (fam && ROWS.includes(fam.key)) (counted.get(fam.key) ?? counted.set(fam.key, new Set()).get(fam.key)!).add(key);
      }
    }
  }
  const missing = [...new Set([...counted.values()].flatMap((set) => [...set]))].filter((k) => !played.has(k) && !(k in OPEN_GAPS)).sort();
  assert.deepEqual(missing, [], `skills counted by the U1-c rows but not played: ${missing.join(", ")}`);
  console.log(`  #757 U1-c coverage: ${ROWS.map((r) => `${r} ${counted.get(r)?.size}`).join(", ")} skills, all played or owned`);
}

export default main();

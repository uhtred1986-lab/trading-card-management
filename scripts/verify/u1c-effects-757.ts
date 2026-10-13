/**
 * #757 U1-c, row "Draw, power, combo power, damage, KO, negate attack, grant, forbid" of the #649 deck
 * audit: the printed wording of every deck face that carries one of these ops is played on the rules
 * engine. Cards are the catalog's own text (see `u1c-757-lib.ts`); expectations cite the Rule Manual
 * (`docs/rules/rulemanual.txt`) and are never derived from engine output.
 */
import assert from "node:assert/strict";
import { activate, apply, attack, atMain, cardOf, drive, energy, had, kw, legal, mainPhase, mark, power, setLife, stage, zone } from "./u1c-757-lib";
import type { VmState } from "../../src/lib/arena/vm/state";

async function main(): Promise<void> {
  // ── SD15-01 #0: "When this card attacks, draw 1 card, then it gets +5000 power for the turn." (draw, power) ──
  {
    const s = mainPhase({ turn: 3 });
    const leader = s.sides.p1.zones.leader[0];
    const handBefore = zone(s, "p1", "hand").length;
    const r = attack(s, leader);
    assert.equal(zone(r.s, "p1", "hand").length, handBefore + 1, "draws 1 card (8-... Auto resolves in order: draw)");
    assert.ok(had(r.events, (e) => e.type === "draw" && e.player === "p1"), "a draw event for p1");
    assert.equal(power(r.s, leader), 15000, "Leader 10000 + 5000 for the turn");
    mark("SD15-01#0");
  }

  // ── SD15-01 back #0: "draw 1 card, then choose up to 1 of your red Unison Cards with a specified cost of 2
  //    and no keyword skills, and it gains [Double Strike] for the turn." (draw, grant) ──
  {
    const s = mainPhase({ turn: 3 });
    const leader = s.sides.p1.zones.leader[0];
    s.cards[leader].flipped = true;
    const cabba = stage(s, "p1", "SD15-02", "unison");
    const hand = zone(s, "p1", "hand").length;
    assert.equal(kw(s, cabba, "Strike"), false, "SD15-02 has no [Strike] before");
    const r = attack(s, leader);
    assert.equal(zone(r.s, "p1", "hand").length, hand + 1, "draws 1 card (5-1)");
    assert.equal(kw(r.s, cabba, "Strike"), true, "the red {r}{r} Unison without keyword skills gained [Double Strike] for the turn");
    mark("SD15-01b#0");
  }

  // ── SD15-01 back #10: "When your opponent attacks your red Unison Card with a specified cost of 2, negate the
  //    attack, then choose up to 1 of your Unison Cards and it gets +6000 power for the turn." [Spirit Boost 1] ──
  {
    const s = mainPhase({ turn: 2 });
    const leader = s.sides.p1.zones.leader[0];
    s.cards[leader].flipped = true;
    const cabba = stage(s, "p1", "SD15-02", "unison");
    s.cards[cabba].markers = 2;
    const attacker = stage(s, "p2", "BLUE757", "battle");
    const r = attack(s, attacker, { player: "p2", target: cabba });
    assert.ok(had(r.events, (e) => e.type === "attackNegated"), "the attack is negated (8-1-6-1)");
    assert.ok(!had(r.events, (e) => e.type === "powerCompare"), "no Damage Step comparison happened");
    assert.equal(power(r.s, cabba), 15000 + 6000, "the Unison got +6000 power for the turn");
    assert.equal(r.s.cards[cabba].markers, 1, "[Spirit Boost 1] removed one marker (22-43)");
    mark("SD15-01b#10");
  }

  // ── SD15-02 #0: "When this card is placed in your Drop Area from your Unison Area, choose up to 1 of your
  //    mono-red Leader Cards and it gets +5000 power for the turn." (power). The cause is the opponent's synthetic
  //    remover; a Unison running out of markers (21-7-3, 21-9) is a separate gap, filed as an issue (suite end). ──
  {
    const s = mainPhase({ turn: 2 });
    const leader = s.sides.p1.zones.leader[0];
    const cabba = stage(s, "p1", "SD15-02", "unison");
    const remover = stage(s, "p2", "REMOVER757", "battle");
    const r = activate(s, remover, 0, { player: "p2" });
    assert.ok(zone(r.s, "p1", "drop").includes(cabba), "the Unison is placed in its owner's Drop Area");
    assert.equal(power(r.s, leader), 15000, "the mono-red Leader got +5000 power for the turn");
    mark("SD15-02#0");
  }

  // ── SD15-02 #10: "[+1][Activate: Main] Choose up to 1 of your opponent's Battle Cards or Unison Cards and it
  //    gets -10000 power for the turn." (power) ──
  {
    const s = mainPhase({ turn: 3 });
    const cabba = stage(s, "p1", "SD15-02", "unison");
    const foe = stage(s, "p2", "BLUEBIG757", "battle");
    const r = activate(s, cabba, 10);
    assert.equal(power(r.s, foe), 20000, "30000 - 10000 for the turn");
    assert.equal(r.s.cards[cabba].markers, 1, "[+1] adds a marker (13-4)");
    mark("SD15-02#10");
  }

  // ── SD15-02 #20: "[-6][Auto] If your opponent's life is at 3 or more: When your mono-red <<Saiyan>> Leader
  //    Card is attacked, deal 1 damage to your opponent." (damage) ──
  for (const [oppLife, damaged] of [[5, true], [2, false]] as const) {
    const s = mainPhase({ turn: 2 });
    const cabba = stage(s, "p1", "SD15-02", "unison");
    s.cards[cabba].markers = 7;
    setLife(s, "p2", oppLife);
    const attacker = stage(s, "p2", "BLUE757", "battle");
    const r = attack(s, attacker, { player: "p2" });
    assert.equal(zone(r.s, "p2", "life").length, damaged ? oppLife - 1 : oppLife, damaged ? "1 damage to the opponent (5-10)" : "opponent's life is below 3: no damage");
    assert.equal(r.s.cards[cabba].markers, damaged ? 1 : 7, damaged ? "[-6] removed six markers" : "no marker paid when the condition fails");
  }
  mark("SD15-02#20");

  // ── BT1-014 #0 / BT4-012 #0: "When this card attacks, you may choose 1 card from your life and add it to your
  //    hand. If you do so, this card gains +10000 power and [Double Strike] / [Critical] for the duration of the
  //    turn." (moveTo, "if you do" 20-16, power, grant) ──
  for (const [id, key, keyword] of [["BT1-014", "BT1-014#0", "Strike"], ["BT4-012", "BT4-012#0", "Critical"]] as const) {
    const s = mainPhase({ turn: 3 });
    const atk = stage(s, "p1", id, "battle");
    const life = zone(s, "p1", "life").length;
    const hand = zone(s, "p1", "hand").length;
    const r = attack(s, atk);
    assert.equal(zone(r.s, "p1", "life").length, life - 1, `${id}: one life card was added to the hand`);
    assert.equal(zone(r.s, "p1", "hand").length, hand + 1);
    assert.equal(power(r.s, atk), 5000 + 10000, `${id}: +10000 power because the card was added (20-16)`);
    assert.equal(kw(r.s, atk, keyword), true, `${id}: gained [${keyword}]`);
    // Declined: "if you do so" is not met, so nothing is gained (20-16-1).
    const declined = attack(s, atk, { pick: (st, o) => (st.prompt.kind === "chooseCards" || st.prompt.kind === "chooseMode" || st.prompt.kind === "optionalCost" ? o.find((a) => (a.type === "choose" && a.cards.length === 0) || (a.type === "optionalCost" && !a.pay) || (a.type === "chooseMode" && a.index === 1)) : undefined) });
    assert.equal(power(declined.s, atk), 5000, `${id}: declined, no power`);
    assert.equal(kw(declined.s, atk, keyword), false, `${id}: declined, no keyword`);
    mark(key);
  }

  // ── SD15-04 #0: "{r}, if you have 2 or more mono-red Battle Cards in your Combo Area: Play this card from your
  //    hand, then choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn."
  //    ([Activate: Battle] 8-2-4-2; play 5-5; power) ──
  {
    const s = mainPhase({ turn: 3 });
    const atk = stage(s, "p1", "RED757", "battle");
    const c1 = stage(s, "p1", "RED757", "hand");
    const c2 = stage(s, "p1", "RED757", "hand");
    const gohan = stage(s, "p1", "SD15-04", "hand");
    energy(s, "p1", 1);
    const foe = stage(s, "p2", "BLUEBIG757", "battle");
    let combos = 0;
    const r = attack(s, atk, {
      target: s.sides.p2.zones.leader[0],
      stop: (st) => st.battle == null && st.prompt.kind === "main",
      pick: (st, o) => {
        if (st.prompt.kind !== "combo") return undefined;
        const act = o.find((a) => a.type === "activate" && a.card === gohan);
        if (combos === 2 && act) { combos++; return act; }
        const c = o.find((a) => a.type === "combo" && a.card === (combos === 0 ? c1 : c2));
        if (c && combos < 2) { combos++; return c; }
        return combos >= 3 ? o.find((a) => a.type === "pass") : "stop";
      },
    });
    void r;
    assert.equal(combos, 3, "two combos, then the [Activate: Battle] was declared");
    assert.ok(zone(r.s, "p1", "battle").includes(gohan), "SD15-04 was played from the hand to the Battle Area");
    assert.equal(power(r.s, foe), 20000, "30000 - 10000 for the turn");
    mark("SD15-04#0");
  }

  // ── BT1-027 #0: "[Activate: Battle] Choose up to 1 of your red cards. It gains +6000 power for the duration of
  //    the battle." (power; effects "for the battle" end at 8-5-11) ──
  {
    const s = mainPhase({ turn: 3 });
    const atk = stage(s, "p1", "RED757", "battle");
    const extra = stage(s, "p1", "BT1-027", "hand");
    const r = attack(s, atk, {
      pick: (st, o) => {
        if (st.prompt.kind === "combo") return o.find((a) => a.type === "activate" && a.card === extra);
        if (st.prompt.kind === "chooseCards") return o.find((a) => a.type === "choose" && a.cards[0] === atk);
        return undefined;
      },
    });
    const compare = r.events.find((e) => e.type === "powerCompare");
    assert.ok(compare && compare.type === "powerCompare" && compare.attackPower === 16000, "+6000 counted in the Damage Step comparison (8-4-6)");
    assert.equal(power(r.s, atk), 10000, "the effect ended with the battle (8-5-11)");
    mark("BT1-027#0");
  }

  // ── Counters: p2 attacks p1's Leader and p1 answers from the hand. ──
  const defend = (s: VmState, attacker: string, counterCard: string, extra: Parameters<typeof attack>[2] = {}) =>
    attack(s, attacker, { player: "p2", ...extra, pick: (st, o) => (st.prompt.kind === "counter" ? o.find((a) => a.type === "counter" && a.card === counterCard) : extra.pick?.(st, o)) });

  // BT3-027 #0: "Negate the attack. Then, choose up to 1 of your red <<Saiyan>> Leader Cards. It gains +5000 power
  //    for the duration of the turn." (negateAttack 8-1-6-1, power)
  {
    const s = mainPhase({ turn: 2 });
    const leader = s.sides.p1.zones.leader[0];
    const ctr = stage(s, "p1", "BT3-027", "hand");
    energy(s, "p1", 1);
    const atk = stage(s, "p2", "BLUEBIG757", "battle");
    const life = zone(s, "p1", "life").length;
    const r = defend(s, atk, ctr);
    assert.ok(had(r.events, (e) => e.type === "attackNegated"), "the attack was negated");
    assert.equal(zone(r.s, "p1", "life").length, life, "no damage: the battle ended at 8-1-6-1");
    assert.equal(power(r.s, leader), 15000, "red Saiyan Leader +5000 for the turn");
    mark("BT3-027#0");
  }

  // BT5-023 #0: "Your Leader Card is red: Choose up to 1 of your cards and it gets +40000 power for the duration of
  //    the battle, then choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the duration of
  //    the turn." (power)
  {
    const s = mainPhase({ turn: 2 });
    const leader = s.sides.p1.zones.leader[0];
    const ctr = stage(s, "p1", "BT5-023", "hand");
    energy(s, "p1", 1);
    const atk = stage(s, "p2", "BLUEBIG757", "battle");
    const life = zone(s, "p1", "life").length;
    const r = defend(s, atk, ctr, { stop: (st) => st.prompt.kind === "main" });
    assert.equal(power(r.s, atk), 20000, "the attacker got -10000 for the turn");
    assert.equal(zone(r.s, "p1", "life").length, life, "the Leader (10000 + 40000 in battle) took no damage: 20000 < 50000 (8-4-6)");
    mark("BT5-023#0");
  }

  // BT6-026 #0: "If your Leader Card is red: Negate the attack, then you may choose 1 red card from your hand and
  //    place it in your Drop Area. If you do, choose up to 2 of your opponent's Battle Cards, and they get -15000
  //    power for the duration of the turn." (negateAttack, moveTo, 20-16, power)
  {
    const s = mainPhase({ turn: 2 });
    const ctr = stage(s, "p1", "BT6-026", "hand");
    const fodder = stage(s, "p1", "RED757", "hand");
    energy(s, "p1", 1);
    const atk = stage(s, "p2", "BLUEBIG757", "battle");
    const other = stage(s, "p2", "BLUEBIG757", "battle");
    const r = defend(s, atk, ctr);
    assert.ok(had(r.events, (e) => e.type === "attackNegated"));
    assert.ok(zone(r.s, "p1", "drop").includes(fodder), "the red card from the hand was placed in the Drop Area");
    assert.equal(power(r.s, atk), 15000, "30000 - 15000");
    assert.equal(power(r.s, other), 15000, "up to 2 of the opponent's Battle Cards");
    // Declined: the negate stands, the penalty (\"if you do\") does not (20-16-1).
    const d = defend(s, atk, ctr, { pick: (st, o) => (st.prompt.kind === "chooseCards" || st.prompt.kind === "chooseMode" ? o.find((a) => (a.type === "choose" && a.cards.length === 0) || (a.type === "chooseMode" && a.index === 1)) : undefined) });
    assert.ok(had(d.events, (e) => e.type === "attackNegated"));
    assert.equal(power(d.s, atk), 30000, "declined: no -15000");
    mark("BT6-026#0");
  }

  console.log("  #757 U1-c effects: ok");
}

export default main();

/**
 * #757 U1-c, row "Draw, power, combo power, damage, KO, negate attack, grant, forbid" of the #649 deck
 * audit: the printed wording of every deck face that carries one of these ops is played on the rules
 * engine. Cards are the catalog's own text (see `u1c-757-lib.ts`); expectations cite the Rule Manual
 * (`docs/rules/rulemanual.txt`) and are never derived from engine output.
 */
import assert from "node:assert/strict";
import { activate, apply, attack, atMain, drive, energy, had, kw, legal, mainPhase, mark, power, setLife, stage, strikeX, zone } from "./u1c-757-lib";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { GameEvent } from "../../src/lib/arena/types";

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
  //    remover (a Unison running out of markers drops by 21-9-2, #759, covered in unison-zero-markers-759). ──
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
    assert.equal(r.s.cards[cabba].markers, 2, "[+1] adds a marker (13-4): staged with 1, now 2");
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

  // ── "When you play this card" Autos: p1 plays the card from the hand in the Main Phase (5-5). ──
  const playIt = (s: VmState, card: string, pick?: Parameters<typeof drive>[2]) => {
    const first = apply(s, { type: "play", player: "p1", card });
    return drive(first.state, atMain, pick, [...first.events]);
  };
  const withEnergy = (s: VmState, n = 6) => energy(s, "p1", n);

  // BT6-010 #10: "When you play this card, choose up to 1 of your opponent's Battle Cards and it gets -5000 power
  //    for the duration of the turn." (power)
  {
    const s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "BT6-010", "hand");
    withEnergy(s);
    const foe = stage(s, "p2", "BLUEBIG757", "battle");
    const r = playIt(s, me);
    assert.equal(power(r.s, foe), 25000, "30000 - 5000");
    mark("BT6-010#10");
  }

  // BT6-011 #0: "When you play this card, if there is a <<Saiyan>> card in play in your Battle Area, draw 2 cards,
  //    then choose 2 cards from your hand and place them in your Drop Area." (draw 5-1, moveTo, if)
  for (const saiyan of [true, false]) {
    const s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "BT6-011", "hand");
    withEnergy(s);
    if (saiyan) stage(s, "p1", "RED757", "battle");
    const hand = zone(s, "p1", "hand").length;
    const drop = zone(s, "p1", "drop").length;
    const r = playIt(s, me);
    if (saiyan) {
      assert.equal(zone(r.s, "p1", "hand").length, hand - 1 + 2 - 2, "played 1, drew 2, dropped 2");
      assert.equal(zone(r.s, "p1", "drop").length, drop + 2, "two cards placed in the Drop Area");
    } else {
      assert.equal(zone(r.s, "p1", "hand").length, hand - 1, "no Saiyan in play: nothing happens");
      assert.equal(zone(r.s, "p1", "drop").length, drop);
    }
  }
  mark("BT6-011#0");

  // BT11-008 #10: "If you have a red Unison Card in play: When this card is played, draw 1 card." (draw, if)
  for (const unison of [true, false]) {
    const s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "BT11-008", "hand");
    withEnergy(s);
    if (unison) stage(s, "p1", "SD15-02", "unison");
    const hand = zone(s, "p1", "hand").length;
    const r = playIt(s, me);
    assert.equal(zone(r.s, "p1", "hand").length, hand - 1 + (unison ? 1 : 0), unison ? "drew 1" : "no red Unison: no draw");
  }
  mark("BT11-008#10");

  // BT11-011 #0: "If your Leader Card is red: When this card is played from your hand, choose up to 1 of your red
  //    Unison Cards and add a marker to it." (addMarker, if)
  for (const leader of ["SD15-01", "SD5-01"]) {
    const s = mainPhase({ turn: 3, leader1: leader });
    const me = stage(s, "p1", "BT11-011", "hand");
    withEnergy(s);
    const uni = stage(s, "p1", "SD15-02", "unison");
    s.cards[uni].markers = 2;
    const r = playIt(s, me);
    assert.equal(r.s.cards[uni].markers, leader === "SD15-01" ? 3 : 2, leader === "SD15-01" ? "a marker was added" : "yellow Leader: condition not met");
  }
  mark("BT11-011#0");

  // SD5-03 #30: "When you play this card, if your Leader Card is <<Goku's Lineage>>, choose up to 1 of your opponent's
  //    Battle Cards and KO it." (KO 5-12, if); SD5-05 #10: "When you play this card, choose up to 1 of your
  //    opponent's Rest Mode Battle Cards and KO it."
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const me = stage(s, "p1", "SD5-03", "hand");
    energy(s, "p1", 6, "YEL757");
    const foe = stage(s, "p2", "BLUE757", "battle");
    const r = playIt(s, me);
    assert.ok(zone(r.s, "p2", "drop").includes(foe), "the opponent's Battle Card was KO'd (5-12-1)");
    assert.ok(had(r.events, (e) => e.type === "ko" && e.card === foe));
    mark("SD5-03#30");
  }
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const me = stage(s, "p1", "SD5-05", "hand");
    energy(s, "p1", 4, "YEL757");
    const rested = stage(s, "p2", "BLUE757", "battle", "rest");
    const active = stage(s, "p2", "BLUE757", "battle", "active");
    const r = playIt(s, me);
    assert.ok(zone(r.s, "p2", "drop").includes(rested), "the Rest Mode Battle Card was KO'd");
    assert.ok(zone(r.s, "p2", "battle").includes(active), "the Active Mode one was not a candidate");
    mark("SD5-05#10");
  }

  // ── Combos (5-7, 8-2-4-1, 8-4-4): p1 attacks and combos `comboCard` from the hand. ──
  const compare = (ev: GameEvent[]) => ev.find((e): e is Extract<GameEvent, { type: "powerCompare" }> => e.type === "powerCompare");
  const comboAttack = (s: VmState, atk: string, comboCard: string, pick?: Parameters<typeof drive>[2], target?: string) => {
    let done = false;
    return attack(s, atk, {
      target,
      pick: (st, o) => {
        if (st.prompt.kind === "combo" && !done) {
          const c = o.find((a) => a.type === "combo" && a.card === comboCard);
          if (c) { done = true; return c; }
        }
        return pick?.(st, o);
      },
    });
  };

  // BT9-031 #0: "Choose 1 Extra Card in your hand and place it in your Drop Area: When you combo with this card, it
  //    gets +6000 combo power for the duration of the turn." (comboPower; price paid from the hand)
  for (const pay of [true, false]) {
    const s = mainPhase({ turn: 3 });
    const atk = stage(s, "p1", "RED757", "battle");
    const combo = stage(s, "p1", "BT9-031", "hand");
    const extra = stage(s, "p1", "EXTRA757", "hand");
    const r = comboAttack(s, atk, combo, (st, o) => (st.prompt.kind === "chooseMode" || st.prompt.kind === "optionalCost" ? o.find((a) => (a.type === "optionalCost" && a.pay === pay) || (a.type === "chooseMode" && a.index === (pay ? 0 : 1))) : undefined));
    assert.equal(compare(r.events)?.attackPower, pay ? 10000 + 5000 + 6000 : 10000 + 5000, pay ? "attack 10000 + combo 5000 + 6000" : "price declined: printed combo power only");
    assert.equal(zone(r.s, "p1", "drop").includes(extra), pay, pay ? "the Extra Card was placed in the Drop Area as the price" : "nothing paid");
  }
  mark("BT9-031#0");

  // BT14-010 #10: "If your Leader Card is red and your life is at 4 or less: When this card is used in a combo, draw 1 card."
  for (const life of [4, 5]) {
    const s = mainPhase({ turn: 3 });
    setLife(s, "p1", life);
    const atk = stage(s, "p1", "RED757", "battle");
    const combo = stage(s, "p1", "BT14-010", "hand");
    const hand = zone(s, "p1", "hand").length;
    const r = comboAttack(s, atk, combo);
    assert.equal(zone(r.s, "p1", "hand").length, hand - 1 + (life === 4 ? 1 : 0), life === 4 ? "drew 1 (life 4)" : "life 5: no draw");
  }
  mark("BT14-010#10");

  // BT4-085 #10: "When you combo with this card, if one of your yellow Battle Cards is being attacked, this card gains
  //    +10000 combo power for the duration of the turn." (comboPower, if, battle) — p2 attacks p1's Rest Mode card.
  for (const yellow of [true, false]) {
    const s = mainPhase({ turn: 2, leader1: "SD5-01" });
    const guard = stage(s, "p1", yellow ? "YEL757" : "RED757", "battle", "rest");
    const combo = stage(s, "p1", "BT4-085", "hand");
    energy(s, "p1", 1, "YEL757");
    const atk = stage(s, "p2", "BLUEBIG757", "battle");
    let done = false;
    const r = attack(s, atk, { player: "p2", target: guard, pick: (st, o) => {
      const c = st.prompt.kind === "combo" ? o.find((a) => a.type === "combo" && a.card === combo) : undefined;
      if (c && !done) { done = true; return c; }
      return undefined;
    } });
    assert.ok(done, "BT4-085 was used in a combo");
    assert.equal(compare(r.events)?.guardPower, 10000 + 5000 + (yellow ? 10000 : 0), yellow ? "yellow card attacked: +10000 combo power" : "red card attacked: printed 5000 only");
  }
  mark("BT4-085#10");

  // BT4-086 #20: "When you combo with this card, if your Leader Card is a yellow <<Goku's Lineage>> and your life is at 4
  //    or less, draw 1 card and this card gains +10000 combo power for the duration of the turn." (draw, comboPower)
  for (const life of [4, 6]) {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    setLife(s, "p1", life);
    const atk = stage(s, "p1", "YEL757", "battle");
    const combo = stage(s, "p1", "BT4-086", "hand");
    energy(s, "p1", 1, "YEL757");
    const hand = zone(s, "p1", "hand").length;
    const r = comboAttack(s, atk, combo);
    assert.equal(compare(r.events)?.attackPower, 10000 + 0 + (life === 4 ? 10000 : 0), life === 4 ? "BT4-086 prints combo power 0, +10000" : "life 6: no bonus");
    assert.equal(zone(r.s, "p1", "hand").length, hand - 1 + (life === 4 ? 1 : 0));
  }
  mark("BT4-086#20");

  // BT6-025 #0: "If your Leader Card is red: Choose up to 1 of your opponent's Battle Cards with 20000 power or less
  //    and KO it." (KO 5-12, if)
  {
    const s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "BT6-025", "hand");
    energy(s, "p1", 1);
    const small = stage(s, "p2", "BLUE757", "battle");
    const big = stage(s, "p2", "BLUEBIG757", "battle");
    let candidates: string[] = [];
    const r = activate(s, me, 0, { pick: (st, o) => { if (st.prompt.kind === "chooseCards") candidates = o.flatMap((a) => (a.type === "choose" ? a.cards : [])); return undefined; } });
    assert.ok(candidates.includes(small) && !candidates.includes(big), "only the 10000-power card is a candidate (30000 > 20000)");
    assert.ok(zone(r.s, "p2", "drop").includes(small), "the small card was KO'd");
    assert.ok(zone(r.s, "p2", "battle").includes(big));
    mark("BT6-025#0");
  }

  // TB1-023 #0: "Choose all red <<Saiyan>> cards in your Battle Area. They gain [Barrier] until the end of your
  //    opponent's next turn." (grant, 22-16)
  {
    let s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "TB1-023", "hand");
    const red = stage(s, "p1", "RED757", "battle");
    const blue = stage(s, "p1", "BLUE757", "battle");
    const r = activate(s, me, 0);
    s = r.s;
    assert.equal(kw(s, red, "Barrier"), true, "the red Saiyan gained [Barrier]");
    assert.equal(kw(s, blue, "Barrier"), false, "the blue card was not chosen");
    s = apply(s, { type: "endMain", player: "p1" }).state;
    s = apply(s, { type: "charge", player: "p2", card: null }).state;
    assert.equal(kw(s, red, "Barrier"), true, "still in force during the opponent's next turn");
    s = apply(s, { type: "endMain", player: "p2" }).state;
    assert.equal(kw(s, red, "Barrier"), false, "gone after the end of the opponent's next turn (7-4-6)");
    mark("TB1-023#0");
  }

  // DB2-004 #0: "Choose 1 card in your life and add it to your hand: When this card attacks, switch this card to Active
  //    Mode, then it gets +10000 power and can't attack for the turn." (switchMode, power, forbid)
  {
    const s = mainPhase({ turn: 3 });
    const me = stage(s, "p1", "DB2-004", "battle");
    const life = zone(s, "p1", "life").length;
    const r = attack(s, me);
    assert.equal(zone(r.s, "p1", "life").length, life - 1, "the price: one life card went to the hand");
    assert.equal(r.s.cards[me].mode, "active", "switched back to Active Mode");
    assert.equal(power(r.s, me), 15000, "5000 + 10000");
    assert.ok(!legal(r.s).some((l) => l.action.type === "attack" && l.action.attacker === me), "can't attack for the turn although Active");
    mark("DB2-004#0");
  }

  // DB3-001: a Unison (13-2), played with X = 2. #0 "If your Leader Card is red and your opponent's life is at 5 or more:
  //    When this card is played, deal 1 damage to your opponent." (damage 5-10); #10 "[Activate: Main] This card gets
  //    +5000 power for the turn."; #20 "[Activate: Main] This card gets +15000 power and [Double Strike] for the turn."
  {
    for (const oppLife of [5, 4]) {
      const s = mainPhase({ turn: 3 });
      const u = stage(s, "p1", "DB3-001", "hand");
      energy(s, "p1", 4);
      setLife(s, "p2", oppLife);
      const first = apply(s, { type: "playUnison", player: "p1", card: u, x: 2 });
      const r = drive(first.state, atMain, undefined, [...first.events]);
      assert.ok(zone(r.s, "p1", "unison").includes(u), "the Unison was played");
      assert.equal(zone(r.s, "p2", "life").length, oppLife === 5 ? 4 : 4, "life after");
      assert.equal(had(r.events, (e) => e.type === "damage" && e.player === "p2" && e.amount === 1), oppLife === 5, oppLife === 5 ? "1 damage to the opponent" : "opponent's life below 5: no damage");
      if (oppLife === 5) {
        const a10 = activate(r.s, u, 10);
        assert.equal(power(a10.s, u), 15000 + 5000, "#10: +5000 for the turn");
        mark("DB3-001#10");
        const rich = JSON.parse(JSON.stringify(r.s)) as VmState;
        rich.cards[u].markers = 5;
        const a20 = activate(rich, u, 20);
        assert.equal(rich.cards[u].markers - a20.s.cards[u].markers, 4, "#20: [-4] removes four markers (13-4)");
        assert.equal(power(a20.s, u), 15000 + 15000, "#20: +15000 for the turn");
        assert.equal(kw(a20.s, u, "Strike"), true, "#20: [Double Strike]");
        mark("DB3-001#20");
      }
    }
    mark("DB3-001#0");
  }

  // BT4-097 #0: "[Counter: Attack] Negate the attack." (negateAttack)
  {
    const s = mainPhase({ turn: 2, leader1: "SD5-01" });
    const ctr = stage(s, "p1", "BT4-097", "hand");
    energy(s, "p1", 1, "YEL757");
    const atk = stage(s, "p2", "BLUEBIG757", "battle");
    const life = zone(s, "p1", "life").length;
    const r = defend(s, atk, ctr);
    assert.ok(had(r.events, (e) => e.type === "attackNegated"), "negated");
    assert.equal(zone(r.s, "p1", "life").length, life, "no damage");
    mark("BT4-097#0");
  }

  // BT10-008 #0: "You can't activate the [Counter: Play] skills of other cards for the turn: Choose up to 2 of your
  //    opponent's Battle Cards, they get -15000 power for the turn, then play this card." ([Counter: Play], 9-7;
  //    forbid, power, play) — p2 plays a card and p1 answers from the hand.
  {
    const s = mainPhase({ turn: 2 });
    const yamcha = stage(s, "p1", "BT10-008", "hand");
    energy(s, "p1", 3);
    const f1 = stage(s, "p2", "BLUEBIG757", "battle");
    const f2 = stage(s, "p2", "BLUEBIG757", "battle");
    const played = stage(s, "p2", "BLUE757", "hand");
    energy(s, "p2", 2, "BLUE757");
    const first = apply(s, { type: "play", player: "p2", card: played });
    const open = drive(first.state, (st) => st.prompt.kind === "counter", undefined, [...first.events]);
    assert.equal(open.s.prompt.kind, "counter", "a [Counter: Play] timing opens (9-7)");
    const r = drive(open.s, atMain, (st, o) => (st.prompt.kind === "counter" ? o.find((a) => a.type === "counter" && a.card === yamcha) : undefined), open.events);
    assert.equal(power(r.s, f1), 15000, "-15000");
    assert.equal(power(r.s, f2), 15000, "up to 2 cards");
    assert.ok(zone(r.s, "p1", "battle").includes(yamcha), "BT10-008 was played");
    mark("BT10-008#0");
  }

  // DB1-019 #0: "If your Leader Card is a red <<Saiyan>> card: Choose 1 of your Leader Cards or Battle Cards, and for the
  //    duration of the turn, that card gets +5000 power, then if your life is at 3 or less and it's your opponent's turn,
  //    choose up to 1 of your red energy, switch it to Active Mode, and draw 1 card." ([Activate: Battle] 8-3-4-2;
  //    power, switchMode, draw, if)
  for (const [turn, life, expectBonus] of [[2, 3, true], [2, 4, false], [3, 3, false]] as const) {
    const s = mainPhase({ turn });
    const mine = turn === 2 ? "p1" : "p1";
    setLife(s, mine, life);
    const extra = stage(s, "p1", "DB1-019", "hand");
    energy(s, "p1", 2);
    const [rested] = [stage(s, "p1", "RED757", "energy", "rest")];
    const hand = zone(s, "p1", "hand").length;
    const leader = s.sides.p1.zones.leader[0];
    const pickLeader: Parameters<typeof drive>[2] = (st, o) => {
      if (st.prompt.kind === "combo") return o.find((a) => a.type === "activate" && a.card === extra);
      if (st.prompt.kind === "chooseCards") return o.find((a) => a.type === "choose" && (a.cards[0] === leader || a.cards[0] === rested));
      return undefined;
    };
    const r = turn === 2
      ? attack(s, stage(s, "p2", "BLUE757", "battle"), { player: "p2", pick: pickLeader })
      : attack(s, stage(s, "p1", "RED757", "battle"), { pick: pickLeader });
    assert.equal(power(r.s, leader), 15000, "the chosen Leader got +5000 for the turn");
    assert.equal(r.s.cards[rested].mode, expectBonus ? "active" : "rest", expectBonus ? "the rested red energy was switched to Active Mode" : "no energy switch");
    assert.equal(zone(r.s, "p1", "hand").length, hand - 1 + (expectBonus ? 1 : 0), expectBonus ? "drew 1 (card left the hand, 1 drawn)" : "no draw");
  }
  mark("DB1-019#0");

  // SD5-01 #0: "When this card attacks a Leader Card, draw 1 card." (draw, battle condition)
  {
    for (const target of ["leader", "battle"] as const) {
      const s = mainPhase({ turn: 3, leader1: "SD5-01" });
      const leader = s.sides.p1.zones.leader[0];
      const guard = target === "leader" ? s.sides.p2.zones.leader[0] : stage(s, "p2", "BLUE757", "battle", "rest");
      const hand = zone(s, "p1", "hand").length;
      const r = attack(s, leader, { target: guard });
      assert.equal(zone(r.s, "p1", "hand").length, hand + (target === "leader" ? 1 : 0), target === "leader" ? "attacks a Leader Card: drew 1" : "attacks a Battle Card: no draw");
    }
    mark("SD5-01#0");
  }

  // SD5-01 back #0: "When this card attacks, draw 1 card." and #10: "[Permanent] When your life is less than or equal to your
  //    opponent's life, this card gains +5000 power and [Critical] during your turn." (draw; power, grant)
  {
    for (const [mine, theirs] of [[4, 5], [5, 4]] as const) {
      const s = mainPhase({ turn: 3, leader1: "SD5-01" });
      const leader = s.sides.p1.zones.leader[0];
      s.cards[leader].flipped = true;
      setLife(s, "p1", mine);
      setLife(s, "p2", theirs);
      const holds = mine <= theirs;
      assert.equal(power(s, leader), holds ? 20000 : 15000, `life ${mine} vs ${theirs}: ${holds ? "the back face prints 15000, +5000" : "15000 printed, no bonus"}`);
      assert.equal(kw(s, leader, "Critical"), holds, "[Critical] iff the life condition holds");
      if (holds) {
        const hand = zone(s, "p1", "hand").length;
        const r = attack(s, leader);
        assert.equal(zone(r.s, "p1", "hand").length, hand + 1, "back #0: drew 1 when it attacked");
        assert.ok(had(r.events, (e) => e.type === "damage" && e.player === "p2" && e.critical), "[Critical] on the damage: the life went to the Drop Area (22-6)");
      }
    }
    mark("SD5-01b#0", "SD5-01b#10");
  }

  // SD5-02 #0: "When this card attacks, you may draw 1 card. If you did not draw a card with this skill, this card gains
  //    [Double Strike] for the duration of the turn." (draw 5-1, grant, "if you don't" 20-17)
  for (const draw of [true, false]) {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const me = stage(s, "p1", "SD5-02", "battle");
    const hand = zone(s, "p1", "hand").length;
    const r = attack(s, me, { pick: (st, o) => (st.prompt.kind === "chooseMode" || st.prompt.kind === "optionalCost" ? o.find((a) => (a.type === "optionalCost" && a.pay === draw) || (a.type === "chooseMode" && a.index === (draw ? 0 : 1))) : undefined) });
    assert.equal(zone(r.s, "p1", "hand").length, hand + (draw ? 1 : 0), draw ? "drew 1" : "declined: no draw");
    assert.equal(kw(r.s, me, "Strike"), !draw, draw ? "drew: no [Double Strike]" : "did not draw: gained [Double Strike]");
  }
  mark("SD5-02#0");

  // SD5-04 #10: "Choose 1 card from your life and add it to your hand: Switch this card to Active Mode, and if you have 2 or
  //    less life, this card gains [triple strike] for the duration of the turn." ([Activate: Main]; switchMode, grant)
  for (const [life, triple] of [[3, true], [4, false]] as const) {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    setLife(s, "p1", life);
    const me = stage(s, "p1", "SD5-04", "battle", "rest");
    const r = activate(s, me, 10);
    assert.equal(zone(r.s, "p1", "life").length, life - 1, "the price: one life card to the hand");
    assert.equal(r.s.cards[me].mode, "active", "switched to Active Mode");
    const strike = strikeX(r.s, me);
    assert.equal(strike, triple ? 3 : 1, triple ? "life is 2 after the price: triple strike (3 damage)" : "life is 3 after the price: no keyword");
  }
  mark("SD5-04#10");

  // BT4-096 #0: "If your Leader Card is <<Goku's Lineage>> with <Son Goku> in its character name, it gains +15000 power and
  //    [Double Strike] for the duration of the battle." ([Activate: Battle]; grant, power, if)
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const leader = s.sides.p1.zones.leader[0];
    const ex = stage(s, "p1", "BT4-096", "hand");
    energy(s, "p1", 1, "YEL757");
    const r = attack(s, leader, { pick: (st, o) => (st.prompt.kind === "combo" ? o.find((a) => a.type === "activate" && a.card === ex) : undefined) });
    assert.equal(compare(r.events)?.attackPower, 25000, "10000 + 15000 for the battle");
    assert.ok(had(r.events, (e) => e.type === "damage" && e.player === "p2" && e.amount === 2), "[Double Strike]: 2 damage");
    assert.equal(power(r.s, leader), 10000, "ended with the battle");
    mark("BT4-096#0");
  }

  console.log("  #757 U1-c effects: ok");
}

export default main();

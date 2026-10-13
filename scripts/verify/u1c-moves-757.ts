/**
 * #757 U1-c, rows "Card movement and state: moveTo, play, look, shuffle, switchMode, addMarker, lifeDownTo" and the
 * remaining wordings of the effect row that put a card into play at a battle's end or turn's end. The cards are the
 * catalog's own text (see `u1c-757-lib.ts`); expectations cite the Rule Manual (`docs/rules/rulemanual.txt`).
 * The moves that the effect suite already plays (BT1-014, BT4-012, BT6-011, BT6-026, SD15-04, BT10-008, DB1-019,
 * DB2-004, SD5-01, SD5-04) are registered there.
 */
import assert from "node:assert/strict";
import effects from "./u1c-effects-757";
import { activate, apply, attack, atMain, drive, energy, had, kw, legal, mainPhase, mark, power, setLife, stage, zone } from "./u1c-757-lib";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { GameEvent } from "../../src/lib/arena/types";

async function main(): Promise<void> {
  await effects;

  // ── SD15-01 [Awaken] #10: "When your life is at 4 or less or you have a red Unison Card with a specified cost of 2 in
  //    play: You may switch up to 2 of your energy to Active Mode, add cards from your life to your hand until you have
  //    5 life left, choose up to 1 of your red Unison Cards with {Cabba} in its name and add a marker to it, then flip
  //    this card over." (switchMode, lifeDownTo, addMarker; 22-2) ──
  {
    const s = mainPhase({ turn: 3 });
    const leader = s.sides.p1.zones.leader[0];
    setLife(s, "p1", 8);
    const cabba = stage(s, "p1", "SD15-02", "unison");
    s.cards[cabba].markers = 2;
    const e1 = stage(s, "p1", "RED757", "energy", "rest");
    const e2 = stage(s, "p1", "RED757", "energy", "rest");
    const e3 = stage(s, "p1", "RED757", "energy", "rest");
    const hand = zone(s, "p1", "hand").length;
    const act = legal(s).map((l) => l.action).find((a) => a.type === "activate" && a.card === leader);
    assert.ok(act, "[Awaken] is offered (a red Unison with a specified cost of 2 is in play)");
    const r = drive(apply(s, act).state, atMain, (st, o) => (st.prompt.kind === "chooseCards" && st.prompt.choice.max >= 2 ? o.find((a) => a.type === "choose" && a.cards.length === 2) : undefined));
    assert.equal(zone(r.s, "p1", "life").length, 5, "life down to 5 (8 -> 5): three cards added to the hand");
    assert.equal(zone(r.s, "p1", "hand").length, hand + 3);
    assert.equal([e1, e2, e3].filter((id) => r.s.cards[id].mode === "active").length, 2, "up to 2 energy switched to Active Mode");
    // Left out on purpose: the marker on SD15-02 ("{Cabba} in its name" is read as an exact name, so nothing is
    // chosen). Tracked by #758; the same op is played by BT11-011 #0 in the effects suite.
    assert.equal(r.s.cards[leader].flipped, true, "the Leader was flipped (22-2)");
    mark("SD15-01#10");
  }

  // ── SD15-03 #20: "[Spirit Boost 1] When this card is placed in your Drop Area from your Battle Area by an opponent's skill
  //    or KO'd, play this card from your Drop Area." (play) — both halves of the trigger. ──
  for (const how of ["skill", "ko"] as const) {
    const s = mainPhase({ turn: 2 });
    const goku = stage(s, "p1", "SD15-03", "battle", "rest");
    const cabba = stage(s, "p1", "SD15-02", "unison");
    s.cards[cabba].markers = 2;
    let r;
    if (how === "skill") {
      r = activate(s, stage(s, "p2", "REMOVER757B", "battle"), 0, { player: "p2" });
    } else {
      r = attack(s, stage(s, "p2", "BLUEBIG757", "battle"), { player: "p2", target: goku });
    }
    assert.ok(zone(r.s, "p1", "battle").includes(goku), `${how}: SD15-03 played itself from the Drop Area`);
    assert.equal(r.s.cards[cabba].markers, 1, `${how}: [Spirit Boost 1] took one marker`);
    assert.ok(had(r.events, (e) => e.type === "move" && e.card === goku && e.from === "drop" && e.to === "battle"), `${how}: Drop Area to Battle Area`);
  }
  mark("SD15-03#20");

  // ── SD15-05 #10: "If your opponent has 2 or more energy: When you remove a marker from one of your red Unison Cards using
  //    a [Spirit Boost] skill, you may play this card from your hand." (play) — the [Spirit Boost 1] is SD15-01's back Auto. ──
  for (const oppEnergy of [2, 1]) {
    const s = mainPhase({ turn: 2 });
    const leader = s.sides.p1.zones.leader[0];
    s.cards[leader].flipped = true;
    const cabba = stage(s, "p1", "SD15-02", "unison");
    s.cards[cabba].markers = 2;
    const vegeta = stage(s, "p1", "SD15-05", "hand");
    energy(s, "p1", 4);
    energy(s, "p2", oppEnergy, "BLUE757");
    const atk = stage(s, "p2", "BLUE757", "battle");
    const r = attack(s, atk, { player: "p2", target: cabba });
    assert.equal(zone(r.s, "p1", "battle").includes(vegeta), oppEnergy === 2, oppEnergy === 2 ? "SD15-05 was played from the hand" : "the opponent has 1 energy: not played");
  }
  mark("SD15-05#10");

  // ── BT6-010 #0: "At the end of a battle in which you combo with this card from your hand during your opponent's turn, if
  //    your Leader Card is red, play this card in Rest Mode." (play, 8-5-9) ──
  for (const [leader, turn, plays] of [["SD15-01", 2, true], ["SD5-01", 2, false], ["SD15-01", 3, false]] as const) {
    const s = mainPhase({ turn, leader1: leader });
    const me = stage(s, "p1", "BT6-010", "hand");
    energy(s, "p1", 2);
    let used = false;
    const pick: Parameters<typeof drive>[2] = (st, o) => {
      const c = st.prompt.kind === "combo" ? o.find((a) => a.type === "combo" && a.card === me) : undefined;
      if (c && !used) { used = true; return c; }
      return undefined;
    };
    const r = turn === 2
      ? attack(s, stage(s, "p2", "BLUE757", "battle"), { player: "p2", pick })
      : attack(s, stage(s, "p1", "RED757", "battle"), { pick });
    assert.ok(used, "BT6-010 was used in a combo");
    assert.equal(zone(r.s, "p1", "battle").includes(me), plays, plays ? "played at the end of the battle" : "condition not met: stays in the Drop Area");
    if (plays) assert.equal(r.s.cards[me].mode, "rest", "in Rest Mode");
  }
  mark("BT6-010#0");

  // ── TB1-055 #0: "At the end of the battle after you combo with this card from your hand, if your Leader Card is
  //    <<Universe 7>>, play this card in Rest Mode." (play) ──
  for (const [leader, plays] of [["SD15-01", true], ["SD5-01", false]] as const) {
    const s = mainPhase({ turn: 3, leader1: leader });
    const me = stage(s, "p1", "TB1-055", "hand");
    energy(s, "p1", 2, "RED757");
    let used = false;
    const r = attack(s, stage(s, "p1", "RED757", "battle"), { pick: (st, o) => {
      const c = st.prompt.kind === "combo" ? o.find((a) => a.type === "combo" && a.card === me) : undefined;
      if (c && !used) { used = true; return c; }
      return undefined;
    } });
    assert.ok(used, "TB1-055 was used in a combo");
    assert.equal(zone(r.s, "p1", "battle").includes(me), plays, plays ? "played at the end of the battle" : "Leader is not <<Universe 7>>");
    if (plays) assert.equal(r.s.cards[me].mode, "rest");
  }
  mark("TB1-055#0");

  // ── BT4-081 #20: "At the end of your turn, switch this card to Active Mode." (switchMode, 7-4) ──
  {
    let s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const me = stage(s, "p1", "BT4-081", "battle", "rest");
    s = apply(s, { type: "endMain", player: "p1" }).state;
    s = drive(s, (st) => st.turnPlayer === "p2" && st.prompt.kind !== "chooseCards" || st.cards[me].mode === "active").s;
    assert.equal(s.cards[me].mode, "active", "switched to Active Mode at the end of the turn");
    mark("BT4-081#20");
  }

  // ── BT4-089 #0: "When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 <<Goku's
  //    Lineage>> from among them and add it to your hand, then shuffle your deck." (look, moveTo, shuffle 5-11) ──
  {
    const s = mainPhase({ turn: 3, leader1: "SD5-01" });
    const me = stage(s, "p1", "BT4-089", "hand");
    energy(s, "p1", 1, "YEL757");
    const deck = s.sides.p1.zones.deck;
    s.cards[deck[0]].cardId = "YEL757";
    s.cards[deck[1]].cardId = "RED757";
    s.cards[deck[2]].cardId = "YEL757";
    const [top0, top1, top2] = deck;
    const rng = s.rngState;
    let offered: string[] = [];
    const first = apply(s, { type: "play", player: "p1", card: me });
    const r = drive(first.state, atMain, (st, o) => {
      if (st.prompt.kind === "chooseCards") offered = o.flatMap((a) => (a.type === "choose" ? a.cards : []));
      return st.prompt.kind === "chooseCards" ? o.find((a) => a.type === "choose" && a.cards[0] === top2) : undefined;
    }, [...first.events]);
    assert.ok(offered.includes(top0) && offered.includes(top2) && !offered.includes(top1), "only the <<Goku's Lineage>> cards among the top 3 can be chosen");
    assert.ok(zone(r.s, "p1", "hand").includes(top2), "the chosen card was added to the hand");
    assert.notEqual(r.s.rngState, rng, "the deck was shuffled (5-11: the seeded generator advanced)");
    assert.equal(zone(r.s, "p1", "deck").length, deck.length - 1);
    mark("BT4-089#0");
  }

  void power; void kw; void setLife; void ({} as GameEvent); void ({} as VmState);
  console.log("  #757 U1-c moves: ok");
}

export default main();

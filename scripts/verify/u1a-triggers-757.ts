/**
 * Issue #757, batch U1-a: played scenarios for the trigger and keyword rows of
 * the offline deck audit (docs/arena-offline-deck-audit.md §8) — the cards of
 * decks A/B (SD15 Vegeta, SD5 Goku's Lineage) with their *printed* wording from
 * the #649 snapshot (`docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`),
 * and the owner's specified costs (`docs/arena-backlog/evidence/655/`), played
 * on the rules engine (`RULES`). Nothing here is a synthetic stand-in for a
 * row's wording; the only invented cards are the plain fillers of the harness.
 *
 * Rule Manual (docs/rules/rulemanual.txt) readings used below:
 *   5-12-1/5-12-2  KO moves a Battle Card to the Drop; only a KO effect or rule is a KO
 *   5-13           removing markers
 *   7-4-2          "at the end of the turn" skills enter pending in the End Phase
 *   8-1-3          "when this card attacks / is attacked" skills enter pending on the declaration
 *   9-6-2          an [Auto] whose trigger condition is fulfilled is made pending
 *   22-8-3         [Dual Attack]: switch to Active Mode at the end of battle, X-1 times per turn
 *   22-11-2/3      [Once per turn], counted for each skill
 *   22-43-3        [Spirit Boost X]: remove X markers from your Unison Card as the cost
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardDefFrom } from "../../src/lib/arena/load";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { RULES } from "../../src/lib/arena/vm";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { CTX, DEFS, arenaG, card, hasG, leaderOf, powerOfG, unisonOf, zoneOf } from "./harness";

const SNAPSHOT = "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json";
const OWNER_COSTS = (JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json", "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;
const SNAP = (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { cards: Record<string, unknown>[] }).cards;

const PREFIX = "R757-";
const REAL = ["SD15-01", "SD15-02", "SD15-03", "SD15-05", "BT1-014", "BT4-012", "BT6-010", "BT6-011", "BT11-008", "BT11-011", "DB2-004", "DB3-001", "SD5-01", "SD5-02", "SD5-03", "SD5-04", "SD5-05", "BT4-081", "BT4-089"];
// A filler already in the harness (V1, BIG, …) stays itself; everything else is the real card.
const real = (id: string): string => (id.startsWith(PREFIX) || (DEFS[id] && !REAL.includes(id)) ? id : `${PREFIX}${id}`);
for (const id of REAL) {
  const row = SNAP.find((c) => c.id === id);
  assert.ok(row, `${id} is in the #649 snapshot`);
  const spec = OWNER_COSTS[id];
  const def: CardDef = cardDefFrom({ ...(row as never as Parameters<typeof cardDefFrom>[0]), specifiedCost: spec ?? null } as never);
  DEFS[real(id)] = { ...def, id: real(id) };
}

// Plain stand-ins that carry no wording under test: a yellow Leader without ≪Goku's Lineage≫ and yellow energy.
DEFS[`${PREFIX}YLEADER`] = card(`${PREFIX}YLEADER`, { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null, power: 10000 });
DEFS[`${PREFIX}YENERGY`] = card(`${PREFIX}YENERGY`, { colors: ["Yellow"] });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset should load");
const DBS = loaded.definition;
const rules = RULES;
type S = VmState;

const apply = (s: S, a: Action): S => rules.apply(CTX, s, a).state as S;
const menu = (s: S) => rules.legalActions(CTX, s);
const ENERGY = ["V1", "V1", "V1", "V1", "V1", "V1", "V1", "V1", "V1", "V1"];

/** p1's Main Phase (turn 3) with `battle`/`hand` staged by real card ids, plenty of energy, and p2's cards. */
function board(opts: { hand?: string[]; battle?: string[]; oppBattle?: string[]; oppHand?: string[]; yellow?: boolean } = {}): S {
  const map = (ids?: string[]) => ids?.map(real);
  return arenaG({ hand: map(opts.hand), battle: map(opts.battle), oppBattle: map(opts.oppBattle), oppHand: map(opts.oppHand), energy: opts.yellow ? ENERGY.map(() => `${PREFIX}YENERGY`) : ENERGY, oppEnergy: ENERGY }) as S;
}
/** Take a deck card of `player` into `area` as `cardId` (a raw fixture; no moment fires). */
function stage(s: S, player: PlayerId, cardId: string, area: "battle" | "unison" | "hand" | "drop"): string {
  const id = s.sides[player].zones.deck[0];
  s.cards[id].cardId = real(cardId);
  const moved = moveCard(s, DBS, id, area, { owner: player });
  assert.ok(moved.ok, `could not stage ${cardId}`);
  s.pending = [];
  if (area === "battle") s.cards[id].mode = "active";
  // 21-9-2: a Unison with no markers goes to the Drop Area, so a staged Unison starts with one, as a played one does.
  if (area === "unison") s.cards[id].markers = 1;
  return id;
}
function setLeader(s: S, player: PlayerId, cardId: string, flipped = false): string {
  const id = leaderOf(s, player);
  s.cards[id].cardId = real(cardId);
  s.cards[id].flipped = flipped;
  return id;
}
const handOf = (s: S, p: PlayerId): number => zoneOf(s, p, "hand").length;
const lifeOf = (s: S, p: PlayerId): number => zoneOf(s, p, "life").length;

/**
 * Answer prompts until `stop(s)` or a Main Phase: `prefer` picks the action
 * first, then optional prices are paid (unless `decline`), then the first
 * choice, then a pass.
 */
function drive(s: S, o: { prefer?: (a: Action, s: S) => boolean; decline?: boolean; stop?: (s: S) => boolean } = {}): S {
  for (let i = 0; i < 60; i++) {
    if (o.stop?.(s)) return s;
    if (s.prompt.kind === "main" && !s.battle && s.pending.length === 0) return s;
    const options = menu(s).filter(({ action }) => action.type !== "concede");
    if (process.env.U1A_TRACE === "2") console.log("   menu", s.prompt.kind, JSON.stringify(options.map((x) => x.action)));
    const pick =
      (o.prefer && options.find(({ action }) => o.prefer!(action, s))) ??
      options.find(({ action }) => action.type === "optionalCost") ??
      (o.decline
        ? options.filter(({ action }) => action.type === "chooseMode").pop()
        : options.find(({ action }) => action.type === "chooseMode")) ??
      (o.decline ? options.find(({ action }) => action.type === "choose" && action.cards.length === 0) : undefined) ??
      options.find(({ action }) => action.type === "choose") ??
      options.find(({ action }) => action.type === "pass") ??
      options[0];
    assert.ok(pick, `stopped at ${s.prompt.kind} with nothing to answer`);
    const a = pick.action;
    if (process.env.U1A_TRACE) console.log("  >", s.prompt.kind, JSON.stringify(a));
    s = apply(s, a.type === "optionalCost" ? { ...a, pay: !o.decline } : a);
  }
  throw new Error(`still at ${s.prompt.kind} after 60 answers`);
}
const attackAction = (s: S, attacker: string, target: string): Action => ({ type: "attack", player: s.turnPlayer, attacker, target } as Action);
/** Pass to p2's Main Phase (the End Phase runs on the way). */
function toP2Main(s: S): S {
  s = apply(s, { type: "endMain", player: "p1" });
  for (let i = 0; i < 20 && s.prompt.kind !== "charge"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player } as Action);
  s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p2");
  return s;
}

async function main(): Promise<void> {
  try {
    // ── Auto when a card attacks / a Leader or Unison is attacked ────────────
    {
      // SD5-01: "When this card attacks a Leader Card, draw 1 card." (8-1-3, 9-6-2)
      let s = board();
      const leader = setLeader(s, "p1", "SD5-01");
      const before = handOf(s, "p1");
      s = drive(apply(s, attackAction(s, leader, leaderOf(s, "p2"))));
      assert.equal(handOf(s, "p1"), before + 1, "SD5-01 attacking a Leader draws 1");

      // …and not when it attacks a Battle Card (the wording names a Leader Card).
      s = board({ oppBattle: ["SD15-03"] });
      const l2 = setLeader(s, "p1", "SD5-01");
      const target = zoneOf(s, "p2", "battle").find((id) => s.cards[id].cardId === real("SD15-03"))!;
      s.cards[target].mode = "rest";
      const before2 = handOf(s, "p1");
      s = drive(apply(s, attackAction(s, l2, target)));
      assert.equal(handOf(s, "p1"), before2, "SD5-01 attacking a Battle Card draws nothing");
    }

    const choosing = (card: string) => (a: Action) => a.type === "choose" && a.cards.includes(card);
    const oppLeader = (s: S): string => leaderOf(s, "p2");
    const modeOf = (s: S, id: string): string | null => s.cards[id].mode;

    // SD15-01 front: "When this card attacks, draw 1 card, then it gets +5000 power for the turn."
    {
      let s = board();
      const leader = setLeader(s, "p1", "SD15-01");
      assert.equal(powerOfG(s, leader), 10000);
      const before = handOf(s, "p1");
      s = drive(apply(s, attackAction(s, leader, oppLeader(s))));
      assert.equal(handOf(s, "p1"), before + 1, "draws 1");
      assert.equal(powerOfG(s, leader), 15000, "+5000 power for the turn");
    }
    // SD15-01 back #0: "…draw 1 card, then choose up to 1 of your red Unison Cards with a specified cost of 2 and no keyword skills, and it gains [Double Strike]".
    {
      let s = board();
      const leader = setLeader(s, "p1", "SD15-01", true);
      const cabba = stage(s, "p1", "SD15-02", "unison");
      assert.equal(hasG(s, cabba, "Strike"), false);
      const before = handOf(s, "p1");
      s = drive(apply(s, attackAction(s, leader, oppLeader(s))), { prefer: choosing(cabba) });
      if (process.env.U1A_TRACE) console.log("  cabba", cabba, JSON.stringify((s as unknown as { effects: unknown }).effects));
      assert.equal(handOf(s, "p1"), before + 1, "back face draws 1");
      assert.equal(hasG(s, cabba, "Strike"), true, "SD15-02 ({r}{r}, no keyword skills) gains [Double Strike]");
    }
    // SD15-01 back #10 ([Once per turn][Spirit Boost 1]) and [Dual Attack] (22-8-3): the opponent attacks the red Unison with a specified cost of 2 twice.
    {
      const run = (withSkill: boolean): { markers: number; power: number; again: boolean; second: number; asked: boolean } => {
        let s = board();
        setLeader(s, "p1", withSkill ? "SD15-01" : "SD15-02", withSkill);
        if (!withSkill) s.cards[leaderOf(s, "p1")].cardId = "L-RED";
        const cabba = stage(s, "p1", "SD15-02", "unison");
        s.cards[cabba].markers = 5;
        s = toP2Main(s);
        const goku = stage(s, "p2", "SD15-03", "battle");
        s = drive(apply(s, attackAction(s, goku, cabba)), { prefer: choosing(cabba) });
        const after1 = s.cards[cabba].markers;
        const power = powerOfG(s, cabba);
        // [Dual Attack] (22-8-3): switched to Active Mode at the end of battle, so it attacks again this turn.
        if (process.env.U1A_TRACE) console.log("  goku", s.cards[goku].mode, s.prompt.kind, JSON.stringify(s.pending), s.battle ? "battle" : "nobattle", JSON.stringify(menu(s).map((m) => m.label)));
        const again = menu(s).some(({ action }) => action.type === "attack" && action.attacker === goku);
        let second = after1;
        let asked = false;
        if (again) {
          s = apply(s, attackAction(s, goku, cabba));
          asked = s.prompt.kind === "chooseMode" || s.prompt.kind === "orderPending";
          s = drive(s, { prefer: choosing(cabba) });
          second = s.cards[cabba].markers;
        }
        const third = menu(s).some(({ action }) => action.type === "attack" && action.attacker === goku);
        assert.equal(third, false, "22-8-3: [Dual Attack] activates X-1 = 1 time per turn; no third attack");
        return { markers: after1, power, again, second, asked };
      };
      const plain = run(false);
      assert.equal(plain.markers, 3, "without the Leader skill [Double Strike] takes 2 markers off the Unison");
      assert.equal(plain.again, true, "SD15-03's [Dual Attack] makes it Active again at the end of battle");
      assert.equal(plain.second, 1, "second attack: 2 more markers");
      assert.equal(plain.asked, false);
      const withSkill = run(true);
      assert.equal(withSkill.markers, 4, "SD15-01 back #10: [Spirit Boost 1] takes 1 marker and the attack is negated (no damage)");
      assert.equal(withSkill.power, 21000, "…and the Unison gets +6000 power for the turn");
      assert.equal(withSkill.asked, false, "[Once per turn] (22-11-2): the second attack on the Unison is not answered again");
      assert.equal(withSkill.second, 4, "…and the Unison (15000 + 6000 power) beats the 20000 attacker, so no marker falls");
    }


    // SD15-02 #20: "[-6][Auto] If your opponent's life is at 3 or more: When your mono-red ≪Saiyan≫ Leader Card is attacked, deal 1 damage to your opponent."
    // Paying [-6] from 6 markers leaves the Unison with none, so it goes to its owner's Drop Area (21-9-2, #759).
    {
      const run = (oppLife: number): number => {
        let s = board();
        const leader = setLeader(s, "p1", "SD15-01");
        const cabba = stage(s, "p1", "SD15-02", "unison");
        s.cards[cabba].markers = 6;
        s = toP2Main(s);
        s.sides.p2.zones.life.splice(oppLife);
        const attacker = stage(s, "p2", "BIG", "battle");
        s = drive(apply(s, attackAction(s, attacker, leader)));
        const paid = oppLife >= 3;
        assert.equal(zoneOf(s, "p1", "drop").includes(cabba), paid, paid ? "[-6] took the last markers: the Unison is placed in its owner's Drop Area (21-9-2)" : "[-6] not paid: the Unison keeps its markers and stays");
        assert.equal(s.sides.p1.zones.unison.includes(cabba), !paid);
        return lifeOf(s, "p2");
      };
      assert.equal(run(8), 7, "8-1-3: the attack on the Leader pends [-6]; paid, it deals 1 damage to the opponent");
      assert.equal(run(2), 2, "opponent's life at 2: the condition is not met, nothing is dealt");
    }

    // SD15-02 #0 "[Auto][Limit 1] When this card is placed in your Drop Area from your Unison Area, choose up to 1 of your mono-red Leader Cards and it gets +5000 power
    // for the turn", with DB3-001 "If your Leader Card is red and your opponent's life is at 5 or more : When this card is played, deal 1 damage to your opponent."
    // Playing a Unison over the one in the Unison Area sends that one to the Drop Area (3-11-5).
    for (const oppLife of [8, 4]) {
      let s = board({ hand: ["DB3-001"] });
      const leader = setLeader(s, "p1", "SD15-01");
      const cabba = stage(s, "p1", "SD15-02", "unison");
      s.cards[cabba].markers = 3;
      s.sides.p2.zones.life.splice(oppLife);
      const roshi = zoneOf(s, "p1", "hand").find((id) => s.cards[id].cardId === real("DB3-001"))!;
      s = drive(apply(s, { type: "playUnison", player: "p1", card: roshi, x: 2 }), { prefer: choosing(leader) });
      assert.deepEqual(unisonOf(s, "p1"), roshi, "DB3-001 is the Unison now");
      assert.ok(zoneOf(s, "p1", "drop").includes(cabba), "3-11-5: SD15-02 went to the Drop Area");
      assert.equal(powerOfG(s, leader), 15000, "SD15-02's 'from your Unison Area to your Drop Area' Auto: the mono-red Leader gets +5000");
      assert.equal(lifeOf(s, "p2"), oppLife === 8 ? 7 : 4, oppLife === 8 ? "DB3-001: red Leader, opponent's life 8 (5 or more): 1 damage" : "opponent's life 4: DB3-001 deals nothing");
    }

    // SD5-01 back: "[Auto] When this card attacks, draw 1 card." (the flipped face, any target)
    {
      let s = board({ oppBattle: ["SD15-03"] });
      const leader = setLeader(s, "p1", "SD5-01", true);
      const target = zoneOf(s, "p2", "battle").find((id) => s.cards[id].cardId === real("SD15-03"))!;
      s.cards[target].mode = "rest";
      const before = handOf(s, "p1");
      s = drive(apply(s, attackAction(s, leader, target)));
      assert.equal(handOf(s, "p1"), before + 1, "the back face draws 1 attacking a Battle Card");
    }

    // SD5-02: "When this card attacks, you may draw 1 card. If you did not draw a card with this skill, this card gains [Double Strike]".
    for (const draw of [true, false]) {
      let s = board({ battle: ["SD5-02"] });
      const bardock = zoneOf(s, "p1", "battle").find((id) => s.cards[id].cardId === real("SD5-02"))!;
      const before = handOf(s, "p1");
      s = drive(apply(s, attackAction(s, bardock, oppLeader(s))), { decline: !draw });
      assert.equal(handOf(s, "p1"), before + (draw ? 1 : 0), draw ? "chose to draw: draws 1" : "declined: no draw");
      assert.equal(hasG(s, bardock, "Strike"), !draw, draw ? "drew: no [Double Strike]" : "did not draw: gains [Double Strike]");
    }

    // BT1-014 / BT4-012: "When this card attacks, you may choose 1 card from your life and add it to your hand. If you do so, this card gains +10000 power and [Double Strike] / [Critical]".
    for (const [id, kw] of [["BT1-014", "Strike"], ["BT4-012", "Critical"]] as const) {
      for (const pay of [true, false]) {
        let s = board({ battle: [id] });
        const unit = zoneOf(s, "p1", "battle").find((x) => s.cards[x].cardId === real(id))!;
        const [hand, life, power] = [handOf(s, "p1"), lifeOf(s, "p1"), powerOfG(s, unit)];
        s = drive(apply(s, attackAction(s, unit, oppLeader(s))), { decline: !pay });
        assert.equal(lifeOf(s, "p1"), life - (pay ? 1 : 0), `${id}: life card ${pay ? "taken" : "kept"}`);
        assert.equal(handOf(s, "p1"), hand + (pay ? 1 : 0), `${id}: hand`);
        assert.equal(powerOfG(s, unit), power + (pay ? 10000 : 0), `${id}: +10000 only if you did so`);
        assert.equal(hasG(s, unit, kw), pay, `${id}: ${kw} only if you did so`);
      }
    }

    // DB2-004: "[Auto] Choose 1 card in your life and add it to your hand: When this card attacks, switch this card to Active Mode, then it gets +10000 power and can't attack for the turn."
    {
      let s = board({ battle: ["DB2-004"] });
      const unit = zoneOf(s, "p1", "battle").find((x) => s.cards[x].cardId === real("DB2-004"))!;
      const [hand, life] = [handOf(s, "p1"), lifeOf(s, "p1")];
      s = drive(apply(s, attackAction(s, unit, oppLeader(s))));
      assert.equal(lifeOf(s, "p1"), life - 1, "the price: 1 life card to the hand");
      assert.equal(handOf(s, "p1"), hand + 1);
      assert.equal(modeOf(s, unit), "active", "switched to Active Mode");
      assert.equal(powerOfG(s, unit), 15000, "+10000 power");
      assert.equal(menu(s).some(({ action }) => action.type === "attack" && action.attacker === unit), false, "can't attack for the turn");
    }


    // ── Auto when a card is played (5-5, 9-6-2) ──────────────────────────────
    const inHand = (s: S, id: string, p: PlayerId = "p1"): string => zoneOf(s, p, "hand").find((x) => s.cards[x].cardId === real(id))!;
    const playIt = (s: S, id: string, o: Parameters<typeof drive>[1] = {}): S => drive(apply(s, { type: "play", player: "p1", card: inHand(s, id) }), o);

    // BT6-010: "When you play this card, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the duration of the turn."
    {
      let s = board({ hand: ["BT6-010"], oppBattle: ["BIG"] });
      const big = zoneOf(s, "p2", "battle")[0];
      s = playIt(s, "BT6-010", { prefer: choosing(big) });
      assert.equal(powerOfG(s, big), 20000, "25000 - 5000");
    }
    // BT6-011: "When you play this card, if there is a ≪Saiyan≫ card in play in your Battle Area, draw 2 cards, then choose 2 cards from your hand and place them in your Drop Area."
    for (const saiyan of [true, false]) {
      let s = board({ hand: ["BT6-011"], battle: saiyan ? ["SD15-03"] : [] });
      const [hand, drop] = [handOf(s, "p1"), zoneOf(s, "p1", "drop").length];
      s = playIt(s, "BT6-011");
      assert.equal(handOf(s, "p1"), saiyan ? hand - 1 + 2 - 2 : hand - 1, saiyan ? "played, drew 2, dropped 2" : "no ≪Saiyan≫ card in play: only the play");
      assert.equal(zoneOf(s, "p1", "drop").length, drop + (saiyan ? 2 : 0));
    }
    // BT11-008: "If you have a red Unison Card in play : When this card is played, draw 1 card."
    for (const unison of [true, false]) {
      let s = board({ hand: ["BT11-008"] });
      if (unison) stage(s, "p1", "SD15-02", "unison");
      const hand = handOf(s, "p1");
      s = playIt(s, "BT11-008");
      assert.equal(handOf(s, "p1"), hand - 1 + (unison ? 1 : 0), unison ? "red Unison in play: draws 1" : "no Unison: nothing");
    }
    // BT11-011: "If your Leader Card is red : When this card is played from your hand, choose up to 1 of your red Unison Cards and add a marker to it."
    for (const red of [true, false]) {
      let s = board({ hand: ["BT11-011"] });
      if (!red) setLeader(s, "p1", "SD5-01");
      const cabba = stage(s, "p1", "SD15-02", "unison");
      s.cards[cabba].markers = 2;
      s = playIt(s, "BT11-011", { prefer: choosing(cabba) });
      assert.equal(s.cards[cabba].markers, red ? 3 : 2, red ? "red Leader: a marker is added" : "yellow Leader: condition not met");
    }
    // SD5-03: "When you play this card, if your Leader Card is ≪Goku's Lineage≫, choose up to 1 of your opponent's Battle Cards and KO it."
    for (const lineage of [true, false]) {
      let s = board({ hand: ["SD5-03"], oppBattle: ["BIG"], yellow: true });
      setLeader(s, "p1", lineage ? "SD5-01" : `${PREFIX}YLEADER`);
      const big = zoneOf(s, "p2", "battle")[0];
      s = playIt(s, "SD5-03", { prefer: choosing(big) });
      assert.equal(zoneOf(s, "p2", "drop").includes(big), lineage, lineage ? "≪Goku's Lineage≫ Leader: KO (5-12-1)" : "Leader is not ≪Goku's Lineage≫: no KO");
    }
    // SD5-05: "When you play this card, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it."
    {
      let s = board({ hand: ["SD5-05"], oppBattle: ["BIG", "BIG"], yellow: true });
      const [rested, active] = zoneOf(s, "p2", "battle");
      s.cards[rested].mode = "rest";
      s = playIt(s, "SD5-05", { prefer: choosing(rested) });
      assert.ok(zoneOf(s, "p2", "drop").includes(rested), "the Rest Mode Battle Card is KO'd");
      assert.ok(zoneOf(s, "p2", "battle").includes(active), "the Active one stays");
    }
    // BT4-089: "When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 ≪Goku's Lineage≫ from among them and add it to your hand, then shuffle your deck."
    {
      let s = board({ hand: ["BT4-089"], yellow: true });
      const top = s.sides.p1.zones.deck.slice(0, 3);
      s.cards[top[1]].cardId = real("SD5-03");
      const hand = handOf(s, "p1");
      s = playIt(s, "BT4-089", { prefer: choosing(top[1]) });
      assert.ok(zoneOf(s, "p1", "hand").includes(top[1]), "the ≪Goku's Lineage≫ card from the top 3 is in the hand");
      assert.equal(handOf(s, "p1"), hand, "played 1, took 1");
    }

    // ── Auto when this card is KO'd; [Spirit Boost X] marker price; Auto on a [Spirit Boost] payment ──
    // SD15-03: "[Auto][Limit 1] [Spirit Boost 1] When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area."
    // SD15-05: "[Auto] If your opponent has 2 or more energy : When you remove a marker from one of your red Unison Cards using a [Spirit Boost] skill, you may play this card from your hand."
    {
      const run = (o: { markers: number; oppEnergy?: boolean; playFive?: boolean }) => {
        let s = board({ hand: ["SD15-05"], battle: ["SD15-03"] });
        setLeader(s, "p1", "SD15-01");
        const goku = zoneOf(s, "p1", "battle").find((id) => s.cards[id].cardId === real("SD15-03"))!;
        const five = inHand(s, "SD15-05");
        let cabba: string | null = null;
        if (o.markers > 0) {
          cabba = stage(s, "p1", "SD15-02", "unison");
          s.cards[cabba].markers = o.markers;
        }
        s.cards[goku].mode = "rest";
        s = toP2Main(s);
        const bigId = stage(s, "p2", "BIG", "battle");
        // p2's energy count is what SD15-05's condition reads ("your opponent" is p2).
        if (o.oppEnergy === false) s.sides.p2.zones.energy.splice(1);
        s = drive(apply(s, attackAction(s, bigId, goku)), { decline: o.playFive === false, prefer: (a) => a.type === "choose" && a.cards.includes(five) && o.playFive !== false });
        return { s, goku, five, cabba };
      };
      // 5-12-1: the rested SD15-03 (21000 with the Unison) loses to BIG (25000) and is KO'd; [Spirit Boost 1] (22-43-3) takes a marker off SD15-02; it plays itself from the Drop Area.
      const a = run({ markers: 3 });
      assert.ok(zoneOf(a.s, "p1", "battle").includes(a.goku), "KO'd: SD15-03 is played back from the Drop Area");
      assert.equal(a.s.cards[a.cabba!].markers, 2, "…the price: [Spirit Boost 1] takes exactly 1 marker (3 → 2); SD15-05 has no price of its own");
      assert.ok(zoneOf(a.s, "p1", "battle").includes(a.five), "SD15-05: [Spirit Boost] removed a marker from a red Unison and the opponent has 2+ energy, so it is played from the hand");
      // No marker on a Unison (22-43-3): the price cannot be paid, SD15-03 stays in the Drop Area and SD15-05 has no payment to answer.
      const b = run({ markers: 0 });
      assert.ok(zoneOf(b.s, "p1", "drop").includes(b.goku), "no Unison, no marker to remove: SD15-03 stays in the Drop Area");
      assert.ok(zoneOf(b.s, "p1", "hand").includes(b.five), "SD15-05 stays in the hand");
      // "If your opponent has 2 or more energy" (SD15-05): with fewer the Auto is not made pending.
      const c = run({ markers: 3, oppEnergy: false });
      assert.ok(zoneOf(c.s, "p1", "hand").includes(c.five), "opponent with fewer than 2 energy: SD15-05 is not offered");
      // "you may": declining keeps it in the hand.
      const d = run({ markers: 3, playFive: false });
      assert.ok(zoneOf(d.s, "p1", "hand").includes(d.five), "SD15-05 declined: still in the hand");
    }

    // BT4-081: "[auto] At the end of your turn, switch this card to Active Mode." (7-4-2)
    {
      let s = board({ battle: ["BT4-081"], yellow: true });
      const goku = zoneOf(s, "p1", "battle").find((id) => s.cards[id].cardId === real("BT4-081"))!;
      s.cards[goku].mode = "rest";
      s = apply(s, { type: "endMain", player: "p1" });
      s = drive(s, { stop: (x) => x.prompt.kind === "charge" });
      assert.equal(s.turnPlayer, "p2");
      assert.equal(modeOf(s, goku), "active", "switched to Active Mode in the End Phase");
      // Control: a plain rested Battle Card is still rested there, so the switch is the card's Auto.
      let c = board({ battle: ["V1"] });
      const plain = zoneOf(c, "p1", "battle").find((id) => c.cards[id].cardId === "V1")!;
      c.cards[plain].mode = "rest";
      c = drive(apply(c, { type: "endMain", player: "p1" }), { stop: (x) => x.prompt.kind === "charge" });
      assert.equal(modeOf(c, plain), "rest", "control: nothing else switches it");
    }

    // SD5-04: "[activate: main] [once per turn] Choose 1 card from your life and add it to your hand: Switch this card to Active Mode, and if you have 2 or less life, this card gains [triple strike]".
    {
      let s = board({ battle: ["SD5-04"], yellow: true });
      const unit = zoneOf(s, "p1", "battle").find((id) => s.cards[id].cardId === real("SD5-04"))!;
      s.cards[unit].mode = "rest";
      const offered = (x: S): boolean => menu(x).some(({ action }) => action.type === "activate" && action.card === unit);
      assert.equal(offered(s), true, "offered");
      const life = lifeOf(s, "p1");
      const act = menu(s).find(({ action }) => action.type === "activate" && action.card === unit)!;
      s = drive(apply(s, act.action));
      assert.equal(lifeOf(s, "p1"), life - 1, "the price: 1 life card to the hand");
      assert.equal(modeOf(s, unit), "active", "switched to Active Mode");
      assert.equal(hasG(s, unit, "Strike"), false, "more than 2 life: no [triple strike]");
      s.cards[unit].mode = "rest";
      assert.equal(offered(s), false, "22-11-2: [Once per turn] used up this turn");
      s = toP2Main(s);
      s = apply(s, { type: "endMain", player: "p2" });
      s = drive(s, { stop: (x) => x.prompt.kind === "main" && x.turnPlayer === "p1" });
      s.cards[unit].mode = "rest";
      assert.equal(offered(s), true, "…and offered again on the next turn");
      s.sides.p1.zones.life.splice(2);
      s = drive(apply(s, menu(s).find(({ action }) => action.type === "activate" && action.card === unit)!.action));
      assert.equal(hasG(s, unit, "Strike"), true, "with 2 or less life left after the price: gains [triple strike]");
    }

    console.log("  #757 U1-a: trigger and keyword scenarios passed");
  } finally {
    for (const id of Object.keys(DEFS).filter((k) => k.startsWith(PREFIX))) delete DEFS[id];
  }
}

export default main();

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
import { CTX, DEFS, arenaG, hasG, leaderOf, powerOfG, unisonOf, zoneOf } from "./harness";

const SNAPSHOT = "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json";
const OWNER_COSTS = (JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json", "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;
const SNAP = (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { cards: Record<string, unknown>[] }).cards;

const PREFIX = "R757-";
const REAL = ["SD15-01", "SD15-02", "SD15-03", "SD15-05", "BT1-014", "BT4-012", "BT6-010", "BT6-011", "BT11-008", "BT11-011", "DB2-004", "DB3-001", "SD5-01", "SD5-02", "SD5-03", "SD5-04", "SD5-05", "BT4-081", "BT4-089"];
// A filler already in the harness (V1, BIG, …) stays itself; everything else is the real card.
const real = (id: string): string => (DEFS[id] && !id.startsWith(PREFIX) ? id : `${PREFIX}${id}`);
for (const id of REAL) {
  const row = SNAP.find((c) => c.id === id);
  assert.ok(row, `${id} is in the #649 snapshot`);
  const spec = OWNER_COSTS[id];
  const def: CardDef = cardDefFrom({ ...(row as never as Parameters<typeof cardDefFrom>[0]), specifiedCost: spec ?? null } as never);
  DEFS[real(id)] = { ...def, id: real(id) };
}

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset should load");
const DBS = loaded.definition;
const rules = RULES;
type S = VmState;

const apply = (s: S, a: Action): S => rules.apply(CTX, s, a).state as S;
const menu = (s: S) => rules.legalActions(CTX, s);
const ENERGY = ["V1", "V1", "V1", "V1", "V1", "V1", "V1", "V1", "V1", "V1"];

/** p1's Main Phase (turn 3) with `battle`/`hand` staged by real card ids, plenty of energy, and p2's cards. */
function board(opts: { hand?: string[]; battle?: string[]; oppBattle?: string[]; oppHand?: string[] } = {}): S {
  const map = (ids?: string[]) => ids?.map(real);
  return arenaG({ hand: map(opts.hand), battle: map(opts.battle), oppBattle: map(opts.oppBattle), oppHand: map(opts.oppHand), energy: ENERGY, oppEnergy: ENERGY }) as S;
}
/** Take a deck card of `player` into `area` as `cardId` (a raw fixture; no moment fires). */
function stage(s: S, player: PlayerId, cardId: string, area: "battle" | "unison" | "hand" | "drop"): string {
  const id = s.sides[player].zones.deck[0];
  s.cards[id].cardId = real(cardId);
  const moved = moveCard(s, DBS, id, area, { owner: player });
  assert.ok(moved.ok, `could not stage ${cardId}`);
  s.pending = [];
  if (area === "battle") s.cards[id].mode = "active";
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
    const modeOf = (s: S, id: string): string => s.cards[id].mode;

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
    // (The Unison at zero markers should then go to the Drop Area, 21-9-2; the engine does not do that yet: issue #759, so it is not asserted here.)
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

    console.log("  #757 U1-a: trigger and keyword scenarios passed");
  } finally {
    for (const id of Object.keys(DEFS).filter((k) => k.startsWith(PREFIX))) delete DEFS[id];
  }
}

export default main();
void unisonOf;
void hasG;
void powerOfG;
void lifeOf;
void toP2Main;
void stage;

/**
 * Issue #741: [Limit X] is counted across every copy of the card, per master,
 * per turn — and [Once per turn] stays per copy.
 *
 *   22-44-3 "A skill with [Limit X] can only be activated and resolved by its
 *   master X times during the same turn, across all copies of the same skill
 *   on cards with the same card number."
 *   22-44-4 an [Auto] made pending several times resolves X times; "the
 *   remaining fail to activate".
 *   22-11-3 "The 'once per turn' limitation is set individually for each
 *   skill. If there are multiple cards with the same 'once per turn' skill,
 *   they can each be activated once per turn."
 *
 * The neighbours are the catalog's [Limit X] wordings as the #728 readings
 * diff printed them (`docs/arena-backlog/evidence/728/readings-diff-2026-10-13.txt`,
 * deckplanet text of 13 Oct 2026 — some cut short there, which leaves their
 * tags whole). The scenarios run on the rules engine only; nothing reads the
 * database.
 */
import assert from "node:assert/strict";
import type { VmState } from "../../src/lib/arena/vm/state";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { compileSkill } from "../../src/lib/arena/compile";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty } from "./harness";

// Catalog text, verbatim (deckplanet's `skill`, 13 Oct 2026).
const SD15_03 =
  "[Deflect][Double Strike][Dual Attack]<br>[Permanent] If this card is in Rest Mode and you have a red Unison Card with a specified cost of 2 in play, this card and your red Leader Card get +1000 power.<br>[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) [Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area.";
const SD15_02 =
  "[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) When this card is placed in your Drop Area from your Unison Area, choose up to 1 of your mono-red Leader Cards and it gets +5000 power for the turn.<br>[+1][Activate: Main] Choose up to 1 of your opponent's Battle Cards or Unison Cards and it gets -10000 power for the turn.<br>[-6][Auto] If your opponent's life is at 3 or more: When your mono-red ≪Saiyan≫ Leader Card is attacked, deal 1 damage to your opponent.";
const BT28_037 = "[Auto][Limit 1] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 blue ≪Demon Realm≫ card or up to 1 blue Unison with a specified cost of 2 to your hand, then shuffle your deck.";

/** The [Limit X] lines of the #728 readings diff, as printed there (some cut short). */
const NEIGHBOURS: [string, string][] = [
  ["BT14-059#10", "[Activate: Battle][Limit 1] (You can only activate this skill once per turn across all copies of this card.) [Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) If your Leader Card is a mono-blue <Trunks: Youth> card: Draw 1 card, then choose up to 1 of your Leader Cards or Unison Cards and"],
  ["BT14-130#10", "[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) If your opponent has 3 or less energy and you place this card in its owner's Drop Area from your hand or Battle Area: When your opponent activates the [Activate] skill on an Extra Card with an original energy cost of 1 or 2 that does"],
  ["BT17-078#0", "[Activate: Main][Limit 1] If your Leader Card is a <Cooler> card: Look at up to 7 cards from the top of your deck, then choose one— ・Play up to 1 green Unison Card with a specified cost of 1 and [Empower] among them with a marker on it, then shuffle your deck."],
  ["BT17-107#0", "[Activate: Main][Limit 1] If your Leader Card is a yellow <Son Goku> card: Look at up to 7 cards from the top of your deck, then choose one— ・Add up to 1 yellow ≪Saiyan≫ card with an energy cost of 4 or less among them to your hand, then shuffle your deck."],
  ["BT18-101#10", "[Activate: Main][Limit 1] If your Leader is a yellow ≪Bardock's Crew≫ card and you discard this card from your hand: Look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Bardock's Crew≫ card with an energy cost of 4 or less or 1 yellow Unison with a specified cost of 2 among them to your hand, then shuffle your deck."],
  ["BT21-138#20", "[Activate: Main][Limit 1] If your Leader is a black ≪Demon Realm Race≫, you have a black Unison with a specified cost of 3 in play, and you place 1 card from your hand at the bottom of your deck: Play this card from your Warp."],
  ["BT25-129#30", "[Activate: Battle][Limit 1] If you have 1 or more red cards and 1 or more green cards in your Combo Area: Switch this card to Active Mode."],
  ["BT28-037#10", BT28_037],
  ["EX21-30#10", "[Activate: Main][Limit 1] If your Leader's back side is {Frieza, Resurrected} and you place 1 card from your hand at the bottom of your deck: Look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Frieza's Army≫ card with an energy cost of 4 or less or 1 yellow Unison with a specified cost of 2 among them to your hand"],
  ["P-448#10", "[Auto][Limit 1] If your Leader is a yellow <Super 17> card and it's your turn: When this card is discarded from your hand by a skill, look at up to 7 cards from the top of your deck, add up to 1 yellow Unison with a specified cost of 2 among them to your hand, and shuffle your deck."],
  ["SD15-03#20", "[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) [Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area."],
];

function add(id: string, def: Partial<CardDef>): void {
  DEFS[id] = card(id, def);
}

add("R741-CABBA", { type: "UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 15000, characters: [], skill: SD15_02, specifiedCost: { Red: 2 } });
add("R741-REMOVER", { type: "BATTLE", colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." });
add("R741-GOKU", { type: "BATTLE", colors: ["Red"], energyCost: 4, power: 20000, comboCost: 0, comboPower: 5000, characters: ["Son Goku"], skill: SD15_03 });
// Synthetic neighbours, one per path: a declared [Activate: Main], an [Auto]
// with nothing to pay, a [Counter], each in a [Limit 1] and a [Once per turn]
// shape; and [Limit 2].
add("R741-ACT-LIMIT", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Activate: Main][Limit 1] Draw 1 card." });
add("R741-ACT-LIMIT2", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Activate: Main][Limit 2] Draw 1 card." });
add("R741-ACT-ONCE", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Activate: Main][Once per turn] Draw 1 card." });
add("R741-AUTO-LIMIT", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Auto][Limit 1] When this card is played, draw 1 card." });
add("R741-AUTO-ONCE", { type: "BATTLE", colors: ["Red"], energyCost: 0, skill: "[Auto][Once per turn] When this card is played, draw 1 card." });
add("R741-COUNTER", { type: "EXTRA", colors: ["Red"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack][Limit 1] Negate the attack." });
add("R741-ATTACKER", { type: "BATTLE", colors: ["Blue"], energyCost: 0, power: 10000, skill: null });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset should load");
const DBS = loaded.definition;
const rules = RULES;
const deck = { seed: 741, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } };

async function main(): Promise<void> {
  try {
    const { moveCard } = await import("../../src/lib/arena/vm/zones");

    // ── readings: every catalog wording carries its ceiling as [Limit X] ──
    for (const [name, text] of NEIGHBOURS) {
      const sk = parseSkills(text).find((line) => line.tags.includes("Limit 1"));
      assert.ok(sk, `${name}: the [Limit 1] line is found`);
      assert.equal(sk.limit, 1, `${name}: [Limit 1] is the line's limit`);
      assert.equal(sk.oncePerTurn, false, `${name}: the reminder's "once per turn across all copies" is not [Once per turn]`);
      if (text.includes("[Spirit Boost 1]")) assert.equal(sk.spiritBoost, 1, `${name}: the [Spirit Boost 1] after the note is still a tag`);
    }
    for (const [text, limit, once] of [
      ["[Auto] [Limit 1] If your Leader is a black <Vegito> card: When this card is played, draw 1 card.", 1, false],
      ["[Activate: Main][Limit 2] Draw 1 card.", 2, false],
      ["[Counter: Play][Limit 1] Play this card.", 1, false],
      ["[Auto][Once per turn] When this card is played, draw 1 card.", null, true],
    ] as const) {
      const sk = parseSkills(text)[0];
      assert.deepEqual([sk.limit, sk.oncePerTurn], [limit, once], text);
    }
    assert.deepEqual(compileSkill(parseSkills(BT28_037)[0]).unsupported, [], "BT28-037's [Limit 1] Auto reads whole");

    // ── the rules engine ──────────────────────────────────────────────────
    type Game = { get: () => VmState; set: (s: VmState) => void; apply: (a: Action) => void };
    function game(): Game {
      let state = rules.createGame(CTX, deck).state as VmState;
      const g: Game = { get: () => state, set: (s) => { state = s; }, apply: (a) => { state = rules.apply(CTX, state, a).state as VmState; } };
      g.apply({ type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" });
      g.apply({ type: "mulligan", player: "p1", redraw: false });
      g.apply({ type: "mulligan", player: "p2", redraw: false });
      g.apply({ type: "charge", player: "p1", card: null });
      assert.equal(state.prompt.kind, "main");
      return g;
    }
    function stage(state: VmState, player: PlayerId, cardId: string, area: "battle" | "unison" | "hand"): string {
      const id = state.sides[player].zones.deck[0];
      state.cards[id].cardId = cardId;
      const moved = moveCard(state, DBS, id, area, { owner: player });
      assert.ok(moved.ok, `could not stage ${cardId}`);
      state.pending = [];
      return id;
    }
    const mainOf = (s: VmState): PlayerId | null => (s.prompt.kind === "main" ? (s.prompt as { player: PlayerId }).player : null);
    /** Answer whatever is asked (paying an optional price, taking the first card) until `player`'s Main Phase. */
    function settle(g: Game, player: PlayerId, prefer?: (a: Action) => boolean): void {
      for (let i = 0; i < 30 && mainOf(g.get()) !== player; i++) {
        const options = rules.legalActions(CTX, g.get());
        const pick = (prefer && options.find(({ action }) => prefer(action))) ?? options.find(({ action }) => action.type === "optionalCost") ?? options.find(({ action }) => action.type !== "concede");
        assert.ok(pick, `stopped at ${g.get().prompt.kind}`);
        g.apply(pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
      }
      assert.equal(mainOf(g.get()), player, `back at ${player}'s Main Phase`);
    }
    /** Pass turns until `player`'s next Main Phase. */
    function nextTurnOf(g: Game, player: PlayerId): void {
      const from = g.get().turn;
      for (let i = 0; i < 40 && !(mainOf(g.get()) === player && g.get().turn > from); i++) {
        const options = rules.legalActions(CTX, g.get());
        const pick = options.find(({ action }) => action.type === "endMain") ?? options.find(({ action }) => action.type === "charge") ?? options.find(({ action }) => action.type !== "concede");
        assert.ok(pick, `stopped at ${g.get().prompt.kind}`);
        g.apply(pick.action);
      }
      assert.ok(mainOf(g.get()) === player && g.get().turn > from, `reached ${player}'s next Main Phase`);
    }
    const offered = (s: VmState, id: string) => rules.legalActions(CTX, s).find(({ action }) => action.type === "activate" && action.card === id);
    const refused = (s: VmState, id: string) => rules.rejectedActions(CTX, s, rules.legalActions(CTX, s)).find((r) => r.action.type === "activate" && (r.action as { card: string }).card === id)?.why[0];
    const limitRow = (s: VmState, viewer: PlayerId, id: string, skillIndex: number) => {
      const snap = buildSnapshot({ id: 741, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx: CTX, state: s, legal: rules.legalActions(CTX, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
      const side = viewer === "p1" ? snap.view.you : snap.view.them;
      return side.battle.find((v) => v.id === id)?.abilities?.find((a) => a.skillIndex === skillIndex)?.limit;
    };

    // 1. SD15-03 #20: two copies and a third, an opponent's skill drops them
    //    one at a time. The first comes back ([Spirit Boost 1]: a marker off
    //    SD15-02); the same copy dropped again, after it left and re-entered
    //    play, does not; nor does the second copy. Saved and reloaded between.
    //    The next turn the count is over and a copy answers again.
    {
      const g = game();
      g.apply({ type: "endMain", player: "p1" });
      settle(g, "p2", (a) => a.type === "charge");
      const s = g.get();
      const gokuA = stage(s, "p1", "R741-GOKU", "battle");
      const gokuB = stage(s, "p1", "R741-GOKU", "battle");
      const gokuC = stage(s, "p1", "R741-GOKU", "battle");
      const cabba = stage(s, "p1", "R741-CABBA", "unison");
      s.cards[cabba].markers = 3;
      const remover = stage(s, "p2", "R741-REMOVER", "battle");
      const notes: string[] = [];
      const remove = (target: string): void => {
        const act = offered(g.get(), remover);
        assert.ok(act, "the remover's [Activate: Main] is offered");
        const r = rules.apply(CTX, g.get(), act.action);
        g.set(r.state as VmState);
        for (let i = 0; i < 16 && mainOf(g.get()) !== "p2"; i++) {
          const options = rules.legalActions(CTX, g.get());
          const pick = options.find(({ action }) => action.type === "choose" && action.player === "p2" && action.cards.includes(target)) ?? options.find(({ action }) => action.type === "optionalCost") ?? options.find(({ action }) => action.type !== "concede");
          assert.ok(pick, `stopped at ${g.get().prompt.kind}`);
          const step = rules.apply(CTX, g.get(), pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
          for (const e of step.events) if (e.type === "note") notes.push(e.text);
          g.set(step.state as VmState);
        }
        assert.equal(mainOf(g.get()), "p2", "back at p2's Main Phase");
      };
      remove(gokuA);
      assert.ok(g.get().sides.p1.zones.battle.includes(gokuA), "SD15-03 played itself back from the Drop");
      assert.equal(g.get().cards[cabba].markers, 2, "[Spirit Boost 1]: one marker off SD15-02");
      assert.deepEqual(g.get().sides.p1.limitUses, { "R741-GOKU#20": 1 }, "one use of SD15-03 #20 counted on p1");
      // Public on both sides: the copy that did not answer shows the line spent.
      for (const viewer of ["p1", "p2"] as const) {
        assert.deepEqual(limitRow(g.get(), viewer, gokuC, 20), { max: 1, used: 1, remaining: 0 }, `${viewer} sees the other copy's [Limit 1] spent`);
      }
      // A save and a reload in between keep the count.
      g.set(JSON.parse(JSON.stringify(g.get())) as VmState);
      remove(gokuA);
      assert.ok(g.get().sides.p1.zones.drop.includes(gokuA), "the copy that left and came back does not answer a second time");
      assert.equal(g.get().cards[cabba].markers, 2, "and no marker is paid for it");
      remove(gokuB);
      assert.ok(g.get().sides.p1.zones.drop.includes(gokuB), "the second copy does not answer either");
      assert.equal(g.get().cards[cabba].markers, 2, "nor pays a marker");
      assert.ok(notes.some((n) => n.includes("[Limit 1]")), "the failed activation is noted");
      // The next turn (p1's, then p2's again): the count is over.
      nextTurnOf(g, "p1");
      assert.equal(g.get().sides.p1.limitUses, undefined, "the count ends with the turn");
      assert.deepEqual(limitRow(g.get(), "p1", gokuC, 20), { max: 1, used: 0, remaining: 1 });
      nextTurnOf(g, "p2");
      remove(gokuC);
      assert.ok(g.get().sides.p1.zones.battle.includes(gokuC), "next turn a copy answers again");
      assert.equal(g.get().cards[cabba].markers, 1);
    }

    // 2. [Activate: Main][Limit 1] on two copies: the second is refused with
    //    the [Limit 1] named; [Limit 2] gives two uses across copies; and two
    //    [Once per turn] copies are used once each (22-11-3).
    {
      const g = game();
      const s = g.get();
      const a = stage(s, "p1", "R741-ACT-LIMIT", "battle");
      const b = stage(s, "p1", "R741-ACT-LIMIT", "battle");
      const two = [stage(s, "p1", "R741-ACT-LIMIT2", "battle"), stage(s, "p1", "R741-ACT-LIMIT2", "battle"), stage(s, "p1", "R741-ACT-LIMIT2", "battle")];
      const once = [stage(s, "p1", "R741-ACT-ONCE", "battle"), stage(s, "p1", "R741-ACT-ONCE", "battle")];
      const activateLine = (id: string) => { g.apply(offered(g.get(), id)!.action); settle(g, "p1"); };
      assert.ok(offered(g.get(), a) && offered(g.get(), b), "both copies offered before any use");
      activateLine(a);
      assert.equal(offered(g.get(), b), undefined, "[Limit 1]: the other copy is not offered");
      assert.deepEqual(refused(g.get(), b), { kind: "oncePerTurn", what: "skill", limit: 1 }, "and its refusal names the [Limit 1]");
      activateLine(two[0]);
      activateLine(two[1]);
      assert.equal(offered(g.get(), two[2]), undefined, "[Limit 2]: two uses across three copies");
      activateLine(once[0]);
      assert.ok(offered(g.get(), once[1]), "[Once per turn]: the other copy keeps its own use");
      assert.equal(offered(g.get(), once[0]), undefined, "and the used copy is spent");
      activateLine(once[1]);
      // Reloaded, then the next turn: all of it is back.
      g.set(JSON.parse(JSON.stringify(g.get())) as VmState);
      assert.equal(offered(g.get(), b), undefined, "still refused after a reload");
      nextTurnOf(g, "p2");
      nextTurnOf(g, "p1");
      for (const id of [a, b, ...two, ...once]) assert.ok(offered(g.get(), id), "every line is offered again next turn");
    }

    // 3. [Auto] with nothing to pay: two [Limit 1] copies played in one turn
    //    draw once; two [Once per turn] copies draw once each.
    {
      const handDelta = (cardId: string): number => {
        const g = game();
        const s = g.get();
        const x = stage(s, "p1", cardId, "hand");
        const y = stage(s, "p1", cardId, "hand");
        const before = g.get().sides.p1.zones.hand.length;
        for (const id of [x, y]) {
          const play = rules.legalActions(CTX, g.get()).find(({ action }) => action.type === "play" && action.card === id);
          assert.ok(play, `${cardId} can be played`);
          g.apply(play.action);
          settle(g, "p1");
        }
        return g.get().sides.p1.zones.hand.length - before;
      };
      assert.equal(handDelta("R741-AUTO-LIMIT"), -2 + 1, "[Limit 1] Auto: two copies played, one draw");
      assert.equal(handDelta("R741-AUTO-ONCE"), -2 + 2, "[Once per turn] Auto: two copies played, a draw each");
    }

    // 4. [Counter: Attack][Limit 1]: the second copy in the hand is no
    //    candidate in the same turn once the first has been used.
    {
      const g = game();
      g.apply({ type: "endMain", player: "p1" });
      settle(g, "p2", (a) => a.type === "charge");
      const s = g.get();
      const c1 = stage(s, "p1", "R741-COUNTER", "hand");
      const c2 = stage(s, "p1", "R741-COUNTER", "hand");
      const attackers = [stage(s, "p2", "R741-ATTACKER", "battle"), stage(s, "p2", "R741-ATTACKER", "battle")];
      const leader = s.sides.p1.zones.leader[0];
      const counterOffers: string[][] = [];
      for (const attacker of attackers) {
        g.apply({ type: "attack", player: "p2", attacker, target: leader });
        let countered = false;
        for (let i = 0; i < 30 && mainOf(g.get()) !== "p2"; i++) {
          const options = rules.legalActions(CTX, g.get());
          if (g.get().prompt.kind === "counter" && (g.get().prompt as { player: PlayerId }).player === "p1") {
            const cards = options.flatMap(({ action }) => (action.type === "counter" && action.card ? [action.card] : []));
            counterOffers.push(cards);
            const answer = options.find(({ action }) => action.type === "counter" && action.card && !countered);
            if (answer) {
              countered = true;
              g.apply(answer.action);
              continue;
            }
          }
          const pick = options.find(({ action }) => (action.type === "counter" || action.type === "block") && !(action as { card?: string | null }).card) ?? options.find(({ action }) => action.type === "pass") ?? options.find(({ action }) => action.type !== "concede");
          assert.ok(pick, `stopped at ${g.get().prompt.kind}`);
          g.apply(pick.action);
        }
      }
      const first = counterOffers.find((cards) => cards.length);
      assert.ok(first && first.includes(c1) && first.includes(c2), "both copies are candidates at the first attack");
      const used = [c1, c2].find((id) => g.get().sides.p1.zones.drop.includes(id));
      assert.ok(used, "one copy was used");
      const other = used === c1 ? c2 : c1;
      assert.ok(g.get().sides.p1.zones.hand.includes(other), "the other copy is still in the hand");
      assert.ok(counterOffers.slice(counterOffers.indexOf(first) + 1).every((cards) => !cards.includes(other)), "[Limit 1]: the other copy is not offered at the second attack");
    }
    console.log("  #741: [Limit X] counted across copies on every path; [Once per turn] per copy; catalog neighbours read");
  } finally {
    for (const id of Object.keys(DEFS).filter((candidate) => candidate.startsWith("R741-"))) delete DEFS[id];
  }
}

export default main();

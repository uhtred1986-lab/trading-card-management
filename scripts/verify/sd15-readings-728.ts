/**
 * Issue #728: the SD15 lines the #649 deck audit found unread (blockers U2/U3)
 * — the specified-cost Unison filter (1-2-3), the [Awaken] OR condition, the
 * "no keyword skills" choice and the [Spirit Boost] tag printed after a
 * reminder note. Readings are fixed expectations against the catalog text
 * (deckplanet, 13 Oct 2026, `docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`);
 * the scenarios run on the rules engine only. Specified costs are the owner's
 * ruling of 13 Oct 2026 (`{r}{r}` for SD15-02, migration 0049) or synthetic
 * rows; nothing reads the database.
 */
import assert from "node:assert/strict";
import { compileCard, compileSkill } from "../../src/lib/arena/compile";
import type { VmState } from "../../src/lib/arena/vm/state";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { matches, parseFilter, emptyFilter, specifiedOrbsKnown } from "../../src/lib/arena/text/filters";
import { parseSkills, skillsOf } from "../../src/lib/arena/text/cards";
import { triggersOf } from "../../src/lib/arena/gaps";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { describeScript } from "../../src/lib/arena/vm/script";
import type { CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty } from "./harness";

// Catalog text, verbatim (deckplanet's `skill`/`backSkill`).
const SD15_01_FRONT =
  "[Auto] When this card attacks, draw 1 card, then it gets +5000 power for the turn.<br>[Awaken] When your life is at 4 or less or you have a red Unison Card with a specified cost of 2 in play: You may switch up to 2 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, choose up to 1 of your red Unison Cards with {Cabba} in its name and add a marker to it, then flip this card over.";
const SD15_01_BACK =
  "[Auto] When this card attacks, draw 1 card, then choose up to 1 of your red Unison Cards with a specified cost of 2 and no keyword skills, and it gains [Double Strike] for the turn.<br>[Auto][Once per turn][Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When your opponent attacks your red Unison Card with a specified cost of 2, negate the attack, then choose up to 1 of your Unison Cards and it gets +6000 power for the turn.";
const SD15_02 =
  "[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) When this card is placed in your Drop Area from your Unison Area, choose up to 1 of your mono-red Leader Cards and it gets +5000 power for the turn.<br>[+1][Activate: Main] Choose up to 1 of your opponent's Battle Cards or Unison Cards and it gets -10000 power for the turn.<br>[-6][Auto] If your opponent's life is at 3 or more: When your mono-red ≪Saiyan≫ Leader Card is attacked, deal 1 damage to your opponent.";
const SD15_03 =
  "[Deflect][Double Strike][Dual Attack]<br>[Permanent] If this card is in Rest Mode and you have a red Unison Card with a specified cost of 2 in play, this card and your red Leader Card get +1000 power.<br>[Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) [Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area.";

const OWNER_RR = parseSpecifiedCost("{r}{r}")!;

function add(id: string, def: Partial<CardDef>): void {
  DEFS[id] = card(id, def);
}

add("R728-VEGETA", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Vegeta"], skill: SD15_01_FRONT, back: { name: "SSB Vegeta, Spirit Boost Elite", power: 15000, skill: SD15_01_BACK } });
// SD15-02 as the feed has it (no cost at all) plus the owner's stored `{r}{r}`.
add("R728-CABBA", { type: "UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 15000, characters: [], skill: SD15_02, specifiedCost: OWNER_RR });
add("R728-CABBA-UNKNOWN", { type: "UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 15000, characters: [], skill: SD15_02 });
add("R728-BLUE-UU", { type: "UNISON", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 15000, skill: null, specifiedCost: { Blue: 2 } });
add("R728-RED-R", { type: "UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 15000, skill: null, specifiedCost: { Red: 1 } });
add("R728-RED-RR-BLOCKER", { type: "UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 15000, skill: "[Blocker]", specifiedCost: OWNER_RR });
add("R728-REMOVER", { type: "BATTLE", colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." });
add("R728-GOKU", { type: "BATTLE", colors: ["Red"], energyCost: 4, power: 20000, comboCost: 0, comboPower: 5000, characters: ["Son Goku"], skill: SD15_03 });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset should load");
const DBS = loaded.definition;
const rules = engineFor("rules");
const deck = { seed: 728, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } };

async function main(): Promise<void> {
  try {
    const [{ moveCard }, { attrsNow }, { withTokens }] = await Promise.all([import("../../src/lib/arena/vm/zones"), import("../../src/lib/arena/vm/program"), import("../../src/lib/arena/vm/cards")]);

    // ── readings ──────────────────────────────────────────────────────────
    {
      // The filter: "with a specified cost of N" is a bound on the orbs of the
      // known specified cost; unknown never matches, not even "N or less".
      const f = parseFilter("red Unison Card with a specified cost of 2");
      assert.equal(f.unreadable, false);
      assert.deepEqual([f.type, f.colors, f.specifiedCostMin, f.specifiedCostMax], ["UNISON", ["Red"], 2, 2]);
      assert.equal(matches(DEFS["R728-CABBA"], f), true, "SD15-02 with the owner's {r}{r} qualifies");
      assert.equal(matches(DEFS["R728-CABBA-UNKNOWN"], f), false, "SD15-02 off the feed (unknown cost) does not qualify by guess");
      assert.equal(matches(DEFS["R728-BLUE-UU"], f), false, "a blue Unison with two orbs is not red");
      assert.equal(matches(DEFS["R728-RED-R"], f), false, "a red Unison with one orb is not cost 2");
      const atMost = parseFilter("Unisons with specified costs of 2 or less");
      assert.deepEqual([atMost.specifiedCostMin, atMost.specifiedCostMax], [null, 2]);
      assert.equal(matches(DEFS["R728-RED-R"], { ...emptyFilter(), ...atMost }), true);
      assert.equal(matches(DEFS["R728-CABBA-UNKNOWN"], { ...emptyFilter(), ...atMost }), false, "unknown is not \"0 orbs\"");
      assert.equal(specifiedOrbsKnown(DEFS["R728-CABBA-UNKNOWN"]), null);
      assert.equal(parseFilter("yellow Unison with a specified cost of 3 or more").specifiedCostMin, 3);
      assert.equal(parseFilter("green Z-Unisons with a specified costof 1").specifiedCostMin, 1, "BT25-127's typo reads as the measure");
      // An "or" the either-split could not take refuses the description (BT14-040).
      assert.ok(parseFilter("blue ≪Saiyan≫ or ≪Earthling≫ card with an energy cost of 3 or less or 1 blue Unison Card with a specified cost of 3").anyOf?.length || parseFilter("blue ≪Saiyan≫ or ≪Earthling≫ card with an energy cost of 3 or less or 1 blue Unison Card with a specified cost of 3").unreadable);
      assert.ok(parseFilter("<Son Goku: Childhood> or <Bulma> card?both yellow?or 1 yellow Unison with a specified cost of 1").unreadable, "an unsplit or beside the measure is refused");
      // Any other sentence about a specified cost is still no measure.
      assert.ok(parseFilter("card whose specified cost is reduced").unreadable);
    }

    // SD15-01 [Awaken]: the OR condition is the record's price condition.
    const vegeta = DEFS["R728-VEGETA"];
    const front = compileCard(vegeta, "front");
    const back = compileCard(vegeta, "back");
    {
      const awaken = skillsOf(vegeta, "front").find((sk) => sk.keyword?.name === "Awaken")!;
      const s = front.bySkill[awaken.index];
      assert.deepEqual(s.unsupported, []);
      const cond = s.price?.condition as { kind: string; conds: { kind: string; atMost?: number; side?: string; sel?: { side?: string; area?: string; filter?: { colors?: string[]; type?: string; specifiedCostMin?: number; specifiedCostMax?: number } }; atLeast?: number }[] };
      assert.equal(cond?.kind, "any", "SD15-01 [Awaken]: life or a Unison, either one");
      assert.deepEqual([cond.conds[0].kind, cond.conds[0].side, cond.conds[0].atMost], ["life", "you", 4]);
      const unison = cond.conds[1];
      assert.deepEqual([unison.kind, unison.sel?.side, unison.sel?.area, unison.atLeast], ["count", "you", "unison", 1]);
      assert.deepEqual([unison.sel?.filter?.colors, unison.sel?.filter?.type, unison.sel?.filter?.specifiedCostMin, unison.sel?.filter?.specifiedCostMax], [["Red"], "UNISON", 2, 2]);
    }
    // SD15-01 back #0: the choice is a red cost-2 Unison with no keyword skills.
    {
      const s = back.bySkill[0];
      assert.deepEqual(s.unsupported, [], "SD15-01 back #0 reads whole");
      assert.equal(describeScript(s.ops), "draw 1, choose up to 1 red Unison Card with a specified cost of 2 and no keyword skills in your Unison Area, the chosen cards gains [Double Strike] for the turn");
      const choose = s.ops.find((o) => o.op === "choose") as { sel: { filter: Parameters<typeof matches>[1] } };
      assert.equal(matches(DEFS["R728-CABBA"], choose.sel.filter), true, "SD15-02 ({r}{r}; [Limit 1], [+1] and [-6] are no keyword skills) qualifies");
      assert.equal(matches(DEFS["R728-RED-RR-BLOCKER"], choose.sel.filter), false, "a {r}{r} Unison with [Blocker] does not");
      assert.equal(matches(DEFS["R728-CABBA-UNKNOWN"], choose.sel.filter), false, "nor one whose cost nobody entered");
      assert.deepEqual(back.bySkill[10].unsupported, [], "back #10 (the #571 trigger) is unchanged");
    }
    // SD15-03 #10 and #20.
    const goku = DEFS["R728-GOKU"];
    const gokuScripts = compileCard(goku, "front");
    {
      assert.deepEqual(gokuScripts.bySkill[10].unsupported, []);
      assert.equal(describeScript(gokuScripts.bySkill[10].ops, { permanent: true }), "if this card is in rest mode: if there are 1 or more red Unison Cards with a specified cost of 2 in your Unison Area: this card +1000 power, 1 red card in your Leader Area +1000 power");
      const auto = parseSkills(SD15_03).find((sk) => sk.index === 20)!;
      assert.deepEqual(auto.tags, ["Auto", "Limit 1", "Spirit Boost 1"], "the [Spirit Boost 1] after the [Limit 1] note is a tag of the line");
      assert.deepEqual([auto.kind, auto.limit, auto.spiritBoost], ["auto", 1, 1]);
      assert.ok(triggersOf(auto).length > 0, "SD15-03 #20 has a moment to answer to");
      assert.deepEqual(compileSkill(auto).unsupported, []);
      assert.equal(describeScript(compileSkill(auto).ops), "choose this card, play the chosen cards");
      // A note followed by a tag that is not a price stays where it was (BT1-081's [Field]).
      const field = parseSkills("[Field] (Place and activate this card in the Battle Area.)[Permanent] Your hand is not affected.")[0];
      assert.deepEqual(field.tags, ["Field"]);
    }

    // ── the rules engine ──────────────────────────────────────────────────
    function mainPhase(): { state: VmState; apply: (a: Parameters<typeof rules.apply>[2]) => void; get: () => VmState } {
      let state = rules.createGame(CTX, deck).state as VmState;
      const chooser = (state.prompt as { player: PlayerId }).player;
      const apply = (action: Parameters<typeof rules.apply>[2]): void => {
        state = rules.apply(CTX, state, action).state as VmState;
      };
      apply({ type: "chooseFirst", player: chooser, first: "p1" });
      apply({ type: "mulligan", player: "p1", redraw: false });
      apply({ type: "mulligan", player: "p2", redraw: false });
      apply({ type: "charge", player: "p1", card: null });
      assert.equal(state.prompt.kind, "main");
      return { state, apply, get: () => state };
    }
    function stage(state: VmState, player: PlayerId, cardId: string, area: "battle" | "unison"): string {
      const id = state.sides[player].zones.hand[0] ?? state.sides[player].zones.deck[0];
      state.cards[id].cardId = cardId;
      const moved = moveCard(state, DBS, id, area, { owner: player });
      assert.ok(moved.ok, `could not stage ${cardId}`);
      state.pending = [];
      return id;
    }

    // SD15-01 [Awaken] is offered at 4 life, or at 5+ with a red {r}{r}
    // Unison in play — and not with an unknown-cost, blue or one-orb one.
    function awakenOffered(unison: string | null, life: number): { offered: boolean; game: ReturnType<typeof mainPhase>; leader: string } {
      const game = mainPhase();
      const state = game.get();
      const leader = state.sides.p1.zones.leader[0];
      state.cards[leader].cardId = "R728-VEGETA";
      state.sides.p1.zones.life.splice(life);
      if (unison) stage(state, "p1", unison, "unison");
      const offered = rules.legalActions(CTX, state).some(({ action }) => action.type === "activate" && action.card === leader);
      return { offered, game, leader };
    }
    assert.equal(awakenOffered(null, 4).offered, true, "4 life: offered");
    assert.equal(awakenOffered(null, 5).offered, false, "5 life, no Unison: not offered");
    assert.equal(awakenOffered("R728-CABBA", 8).offered, true, "8 life and SD15-02 {r}{r}: offered");
    assert.equal(awakenOffered("R728-CABBA-UNKNOWN", 8).offered, false, "8 life and SD15-02 with no stored cost: not offered");
    assert.equal(awakenOffered("R728-BLUE-UU", 8).offered, false, "8 life and a blue {u}{u} Unison: not offered");
    assert.equal(awakenOffered("R728-RED-R", 8).offered, false, "8 life and a red {r} Unison: not offered");
    {
      // …and taking it flips the Leader.
      const { game, leader } = awakenOffered("R728-CABBA", 8);
      const act = rules.legalActions(CTX, game.get()).find(({ action }) => action.type === "activate" && action.card === leader)!;
      game.apply(act.action);
      for (let i = 0; i < 12 && game.get().prompt.kind !== "main"; i++) {
        const options = rules.legalActions(CTX, game.get()).filter(({ action }) => "player" in action && action.player === "p1");
        const pick = options.find(({ action }) => action.type === "optionalCost" || action.type === "chooseMode") ?? options.find(({ action }) => action.type === "choose") ?? options[0];
        assert.ok(pick, `the [Awaken] stopped at ${game.get().prompt.kind} with nothing to answer`);
        game.apply(pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
      }
      assert.equal(game.get().cards[leader].flipped, true, "SD15-01 flips to SSB Vegeta, Spirit Boost Elite");
      assert.equal(game.get().sides.p1.zones.life.length, 5, "life down to 5 (8 → 5)");
    }

    // SD15-03 #10 holds only in Rest Mode, and only with the {r}{r} Unison.
    {
      const power = (mode: "rest" | "active", unison: string | null): number => {
        const state = mainPhase().get();
        const id = stage(state, "p1", "R728-GOKU", "battle");
        state.cards[id].mode = mode;
        if (unison) stage(state, "p1", unison, "unison");
        return Number(attrsNow(withTokens(CTX), DBS, state, id).power);
      };
      assert.equal(power("rest", "R728-CABBA"), 21000, "Rest Mode with SD15-02 {r}{r}: +1000");
      assert.equal(power("active", "R728-CABBA"), 20000, "Active Mode: no bonus");
      assert.equal(power("rest", "R728-CABBA-UNKNOWN"), 20000, "unknown-cost Unison: no bonus");
      assert.equal(power("rest", null), 20000, "no Unison: no bonus");
    }
    // SD15-03 #20: an opponent's skill sends it to the Drop; [Spirit Boost 1]
    // takes a marker off the Unison and the card comes back — once per turn
    // across both copies ([Limit 1]).
    {
      let state = rules.createGame(CTX, deck).state as VmState;
      const apply = (action: Parameters<typeof rules.apply>[2]): void => {
        state = rules.apply(CTX, state, action).state as VmState;
      };
      apply({ type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" });
      apply({ type: "mulligan", player: "p1", redraw: false });
      apply({ type: "mulligan", player: "p2", redraw: false });
      apply({ type: "charge", player: "p1", card: null });
      apply({ type: "endMain", player: "p1" });
      apply({ type: "charge", player: "p2", card: null });
      assert.equal(state.prompt.kind, "main");
      const gokuA = stage(state, "p1", "R728-GOKU", "battle");
      const gokuB = stage(state, "p1", "R728-GOKU", "battle");
      const cabba = stage(state, "p1", "R728-CABBA", "unison");
      state.cards[cabba].markers = 2;
      const remover = stage(state, "p2", "R728-REMOVER", "battle");
      const removeAndAnswer = (target: string): void => {
        const act = rules.legalActions(CTX, state).find(({ action }) => action.type === "activate" && action.card === remover);
        assert.ok(act, "the remover's [Activate: Main] is offered");
        apply(act.action);
        for (let i = 0; i < 16 && !(state.prompt.kind === "main" && (state.prompt as { player?: PlayerId }).player === "p2"); i++) {
          const options = rules.legalActions(CTX, state);
          const pick =
            options.find(({ action }) => action.type === "choose" && action.player === "p2" && action.cards.includes(target)) ??
            options.find(({ action }) => action.type === "optionalCost") ??
            options.find(({ action }) => action.type !== "concede");
          assert.ok(pick, `stopped at ${state.prompt.kind}`);
          apply(pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
        }
        assert.equal(state.prompt.kind, "main", "back at p2's Main Phase");
      };
      removeAndAnswer(gokuA);
      assert.ok(state.sides.p1.zones.battle.includes(gokuA), "SD15-03 played itself back from the Drop");
      assert.equal(state.cards[cabba].markers, 1, "[Spirit Boost 1]: one marker off SD15-02");
      // A second use the same turn is not asserted: both engines count
      // [Limit X] on the card instance (the glossary's documented 22-44
      // approximation), and a card that went to the Drop and came back is a
      // new instance (3-1-4), so neither another copy nor this one is held to
      // the shared count. That is a separate engine change (the PR says so).
      void gokuB;
    }
    console.log("  #728: SD15 specified-cost, [Awaken] OR and Spirit Boost readings, and rules-engine scenarios passed");
  } finally {
    for (const id of Object.keys(DEFS).filter((candidate) => candidate.startsWith("R728-"))) delete DEFS[id];
  }
}

export default main();

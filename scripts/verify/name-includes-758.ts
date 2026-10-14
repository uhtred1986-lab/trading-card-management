/**
 * Issue #758: SD15-01's "choose up to 1 of your red Unison Cards with {Cabba}
 * in its name" is a name that *includes* Cabba (a bare "in its name" reads as
 * "in its card name", like filters.ts's other includes phrases), not a card
 * named exactly "Cabba". Rule Manual 2-3-1-1 only says part of a name does not
 * make two names equal; it does not define "in its name", so the includes
 * reading is the plain-language one (no official ruling exists to cite).
 * Text is the #649 snapshot's SD15-01 front, verbatim.
 */
import assert from "node:assert/strict";
import { compileCard } from "../../src/lib/arena/compile";
import type { VmState } from "../../src/lib/arena/vm/state";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { matches, parseFilter } from "../../src/lib/arena/text/filters";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import type { CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty } from "./harness";

const SD15_01_FRONT =
  "[Auto] When this card attacks, draw 1 card, then it gets +5000 power for the turn.<br>[Awaken] When your life is at 4 or less or you have a red Unison Card with a specified cost of 2 in play: You may switch up to 2 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, choose up to 1 of your red Unison Cards with {Cabba} in its name and add a marker to it, then flip this card over.";
const RR = parseSpecifiedCost("{r}{r}")!;

function add(id: string, def: Partial<CardDef>): void {
  DEFS[id] = card(id, def);
}
const unison = { type: "UNISON", energyCost: null, comboCost: null, comboPower: null, power: 15000, skill: null } as const;
add("R758-VEGETA", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Vegeta"], skill: SD15_01_FRONT, back: { name: "SSB Vegeta, Spirit Boost Elite", power: 15000, skill: "[Auto] When this card attacks, draw 1 card." } });
add("R758-CABBA", { ...unison, name: "SS Cabba, Spirit Resonance", colors: ["Red"], specifiedCost: RR });
add("R758-RED-OTHER", { ...unison, name: "Red Other Unison", colors: ["Red"], specifiedCost: RR });
add("R758-BLUE-CABBA", { ...unison, name: "Blue Cabba Unison", colors: ["Blue"], specifiedCost: { Blue: 2 } });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const DBS = loaded.definition;
const deck = { seed: 758, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } };

async function main(): Promise<void> {
  try {
    // ── readings ──
    for (const t of ["red Unison Cards with {Cabba} in its name", "Battle Cards with {Cabba} in their names"]) {
      const f = parseFilter(t);
      assert.equal(f.unreadable, false, t);
      assert.deepEqual([f.names, f.namesIncluding], [[], ["Cabba"]], t);
    }
    assert.deepEqual(parseFilter("cards without {Cabba} in its name").notNamesIncluding, ["Cabba"]);
    assert.deepEqual(parseFilter("card with {SS4} in its card name").namesIncluding, ["SS4"], "explicit card name unchanged");
    assert.deepEqual(parseFilter("card with <Pan> in its character name").charactersIncluding, ["Pan"], "character name unchanged");
    const f = parseFilter("red Unison Cards with {Cabba} in its name");
    assert.equal(matches(card("x", { type: "UNISON", colors: ["Red"], name: "SS Cabba, Spirit Resonance" }), f), true);
    assert.equal(matches(card("x", { type: "UNISON", colors: ["Red"], name: "Red Other Unison" }), f), false);
    assert.equal(matches(card("x", { type: "UNISON", colors: ["Blue"], name: "Cabba" }), f), false);
    const front = compileCard(DEFS["R758-VEGETA"], "front");
    assert.deepEqual(Object.values(front.bySkill).flatMap((s) => s.unsupported), []);

    // ── the rules engine: the [Awaken] marker pick (one Unison in play at a time) ──
    const { moveCard } = await import("../../src/lib/arena/vm/zones");
    const STAGED = 1;
    const run = (unisonCard: string): { offered: Set<string>; markers: number; flipped: boolean; unison: string } => {
      let state = RULES.createGame(CTX, deck).state as VmState;
      const apply = (a: Parameters<typeof RULES.apply>[2]): void => {
        state = RULES.apply(CTX, state, a).state as VmState;
      };
      apply({ type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" });
      apply({ type: "mulligan", player: "p1", redraw: false });
      apply({ type: "mulligan", player: "p2", redraw: false });
      apply({ type: "charge", player: "p1", card: null });
      const leader = state.sides.p1.zones.leader[0];
      state.cards[leader].cardId = "R758-VEGETA";
      state.sides.p1.zones.life.splice(4);
      const unison = state.sides.p1.zones.hand[0] ?? state.sides.p1.zones.deck[0];
      state.cards[unison].cardId = unisonCard;
      const mv = moveCard(state, DBS, unison, "unison", { owner: "p1" });
      assert.ok(mv.ok, mv.ok ? "" : mv.refused);
      // A Unison in play carries markers; one with none is placed in the Drop Area (21-9-2, #759).
      state.cards[unison].markers = STAGED;
      state.pending = [];
      const act = RULES.legalActions(CTX, state).find(({ action }) => action.type === "activate" && action.card === leader);
      assert.ok(act, "[Awaken] is offered at 4 life");
      apply(act.action);
      const offered = new Set<string>();
      for (let i = 0; i < 12 && state.prompt.kind !== "main"; i++) {
        const options = RULES.legalActions(CTX, state).filter(({ action }) => "player" in action && action.player === "p1");
        for (const { action } of options) if (action.type === "choose") for (const c of action.cards) offered.add(c);
        const pick =
          options.find(({ action }) => action.type === "optionalCost" || action.type === "chooseMode") ??
          options.find(({ action }) => action.type === "choose" && action.cards.includes(unison)) ??
          options.find(({ action }) => action.type === "choose") ??
          options[0];
        assert.ok(pick, `stopped at ${state.prompt.kind}`);
        apply(pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
      }
      return { offered, markers: state.cards[unison].markers ?? 0, flipped: !!state.cards[leader].flipped, unison };
    };
    const yes = run("R758-CABBA");
    assert.ok(yes.offered.has(yes.unison), "the marker pick offers SD15-02");
    assert.equal(yes.markers, STAGED + 1, "SD15-02 got the marker");
    assert.equal(yes.flipped, true);
    const noName = run("R758-RED-OTHER");
    assert.ok(!noName.offered.has(noName.unison), "not a red Unison without Cabba in its name");
    assert.equal(noName.markers, STAGED, "no marker added");
    const noColor = run("R758-BLUE-CABBA");
    assert.ok(!noColor.offered.has(noColor.unison), "not a blue Unison with Cabba in its name");
    assert.equal(noColor.markers, STAGED, "no marker added");
    console.log("  #758: '{X} in its name' reads as includes; SD15-01 [Awaken] marks SD15-02");
  } finally {
    for (const id of Object.keys(DEFS).filter((c) => c.startsWith("R758-"))) delete DEFS[id];
  }
}

export default main();

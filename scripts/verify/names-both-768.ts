/**
 * Issue #768: "with both <A> and <B>" is all-of. BT22-035's condition prints "a
 * blue Leader with both <Son Goku> and <Vegeta>", and the filter parser stored
 * the two names in the any-of `characters` list, so a Leader with only <Son
 * Goku> qualified. Now `charactersAll` / `namesAll` hold them and every one
 * has to be among the card's names; "<A> or <B>" and "<A>/<B>" stay any-of.
 *
 * Rule basis: Rule Manual 2-3 (a card's names / character names; a name is
 * matched whole, 2-3-1-1). Nothing in the manual turns "both A and B" into
 * "either"; no ruling is needed or invented.
 *
 * The repo carries no card-text snapshot beyond the fragments quoted in its
 * tests, so the printed text exercised here is the one real fragment it holds
 * (keywords.ts: "When your opponent plays a red Battle Card with both <Son
 * Goku> and <Piccolo>, play this card.") and the issue's quote of BT22-035.
 * The [Activate: Main] below is a synthetic card built on the same phrase.
 */
import assert from "node:assert/strict";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { matches, parseFilter } from "../../src/lib/arena/text/filters";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty } from "./harness";

const ACT = "[Activate: Main] Choose up to 1 of your Battle Cards with both <Son Goku> and <Vegeta> and add a marker to it.";
function add(id: string, def: Partial<CardDef>): void {
  DEFS[id] = card(id, def);
}
add("R768-LEADER", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Vegeta"], skill: ACT, back: { name: "Back", power: 15000, skill: "[Auto] When this card attacks, draw 1 card." } });
const battle = { type: "BATTLE", power: 5000, skill: null } as const;
add("R768-BOTH", { ...battle, colors: ["Red"], characters: ["Son Goku", "Vegeta"] });
add("R768-GOKU", { ...battle, colors: ["Red"], characters: ["Son Goku"] });
add("R768-VEGETA", { ...battle, colors: ["Red"], characters: ["Vegeta"] });

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const DBS = loaded.definition;
const deck = { seed: 768, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } };

async function main(): Promise<void> {
  try {
    // ── readings ──
    const both = parseFilter("a blue Leader with both <Son Goku> and <Vegeta>");
    assert.equal(both.unreadable, false);
    assert.deepEqual([both.charactersAll, both.characters, both.colors, both.type], [["Son Goku", "Vegeta"], [], ["Blue"], "LEADER"], "both … and … is all-of");
    const braces = parseFilter("Battle Cards with both {Son Goku} and {Vegeta}");
    assert.deepEqual([braces.namesAll, braces.names], [["Son Goku", "Vegeta"], []], "{A} and {B} is the card-name twin");
    for (const t of ["a <Son Goku> or <Vegeta> Battle Card", "a <Son Goku>/<Vegeta> Battle Card"]) {
      const f = parseFilter(t);
      assert.deepEqual([f.characters, f.charactersAll], [["Son Goku", "Vegeta"], []], `${t} stays any-of`);
    }
    const mk = (characters: string[]) => card("x", { type: "BATTLE", colors: ["Red"], characters });
    const bothBattle = parseFilter("Battle Cards with both <Son Goku> and <Vegeta>");
    assert.equal(matches(mk(["Son Goku"]), bothBattle), false, "one of the names is refused");
    assert.equal(matches(mk(["Son Goku", "Vegeta"]), bothBattle), true);
    const either = parseFilter("a <Son Goku> or <Vegeta> Battle Card");
    assert.equal(matches(mk(["Son Goku"]), either), true, "or: one is enough");
    // the real printed fragment reads as the all-of list
    const fragment = parseFilter("red Battle Card with both <Son Goku> and <Piccolo>");
    assert.deepEqual(fragment.charactersAll, ["Son Goku", "Piccolo"]);

    // ── the rules engine: the marker pick offers only a Battle Card with both ──
    const { moveCard } = await import("../../src/lib/arena/vm/zones");
    let state = RULES.createGame(CTX, deck).state as VmState;
    const apply = (a: Parameters<typeof RULES.apply>[2]): void => {
      state = RULES.apply(CTX, state, a).state as VmState;
    };
    apply({ type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" });
    apply({ type: "mulligan", player: "p1", redraw: false });
    apply({ type: "mulligan", player: "p2", redraw: false });
    apply({ type: "charge", player: "p1", card: null });
    const leader = state.sides.p1.zones.leader[0];
    state.cards[leader].cardId = "R768-LEADER";
    const place = (cardId: string): string => {
      const id = state.sides.p1.zones.deck[0];
      state.cards[id].cardId = cardId;
      const mv = moveCard(state, DBS, id, "battle", { owner: "p1" });
      assert.ok(mv.ok, mv.ok ? "" : mv.refused);
      return id;
    };
    const bothId = place("R768-BOTH");
    const gokuId = place("R768-GOKU");
    const vegetaId = place("R768-VEGETA");
    state.pending = [];
    const act = RULES.legalActions(CTX, state).find(({ action }) => action.type === "activate" && action.card === leader);
    assert.ok(act, "the [Activate: Main] is offered");
    apply(act.action);
    const offered = new Set<string>();
    for (let i = 0; i < 12 && state.prompt.kind !== "main"; i++) {
      const options = RULES.legalActions(CTX, state).filter(({ action }) => "player" in action && action.player === "p1");
      for (const { action } of options) if (action.type === "choose") for (const c of action.cards) offered.add(c);
      const pick =
        options.find(({ action }) => action.type === "optionalCost" || action.type === "chooseMode") ??
        options.find(({ action }) => action.type === "choose" && action.cards.includes(bothId)) ??
        options.find(({ action }) => action.type === "choose") ??
        options[0];
      assert.ok(pick, `stopped at ${state.prompt.kind}`);
      apply(pick.action.type === "optionalCost" ? { ...pick.action, pay: true } : pick.action);
    }
    assert.ok(offered.has(bothId), "the card with both names is offered");
    assert.ok(!offered.has(gokuId), "a card with only <Son Goku> is refused");
    assert.ok(!offered.has(vegetaId), "a card with only <Vegeta> is refused");
    assert.equal(state.cards[bothId].markers ?? 0, 1, "the card with both got the marker");
    assert.equal(state.cards[gokuId].markers ?? 0, 0);
    console.log("  #768: 'with both <A> and <B>' reads as all-of; 'or' and '/' stay any-of");
  } finally {
    for (const id of Object.keys(DEFS).filter((c) => c.startsWith("R768-"))) delete DEFS[id];
  }
}

export default main();

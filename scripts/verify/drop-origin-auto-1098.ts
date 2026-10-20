/**
 * #1098 (9-1-3-2, 3-9-4): an [Auto] whose effect plays this card from the Drop
 * ("When your life moves to another area, you may play this card from your
 * Drop", BT29-065 front 40) is heard from the Drop when a life card leaves the
 * Life Area; nothing else in the Drop is, and a copy in play answers as before.
 *
 * The wording is the stored reading of BT29-065 #40 ("if your leader is vegeta,
 * warrior race pride: you may: choose this card, play the chosen cards") spelt
 * out as printed; the area comes from the compiled record (`usableFrom`), never
 * from the name. The other cards are synthetic and say what they are for.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, leaderOf } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { usableFrom } from "../../src/lib/arena/vm/activate";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const AUTO = "[Auto] If your Leader is {Vegeta, Warrior Race Pride}: When your life moves to another area, you may play this card from your Drop.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  VEGETA1098: card("VEGETA1098", { name: "Vegeta, Back From the Brink of Death", colors: ["Yellow"], energyCost: 3, power: 15000, skill: AUTO }),
  PRIDE1098: card("PRIDE1098", { name: "Vegeta, Warrior Race Pride", type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null, power: 10000 }),
  // The same moment, no declared origin: nothing to hear from the Drop.
  PLAINAUTO1098: card("PLAINAUTO1098", { name: "Plain Watcher", colors: ["Yellow"], energyCost: 1, skill: "[Auto] When your life moves to another area, draw 1 card." }),
  // A Drop-origin play with another trigger: not the life-moves moment.
  OTHERTRIG1098: card("OTHERTRIG1098", { name: "Other Trigger", colors: ["Yellow"], energyCost: 1, skill: "[Auto] When your Leader attacks, you may play this card from your Drop." }),
  SHOOTER1098: card("SHOOTER1098", { name: "Shooter", colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Deal 1 damage to your opponent." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const apply = (s: VmState, action: Action) => rules.apply(ctx, JSON.parse(JSON.stringify(s)), action).state as VmState;
const legal = (s: VmState) => rules.legalActions(ctx, s);
const zone = (s: VmState, p: PlayerId, z: string) => (s.sides[p].zones as Record<string, string[]>)[z] ?? [];

function p2Main(seed: number): VmState {
  let s = rules.createGame(ctx, { seed, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" });
  s = apply(s, { type: "mulligan", player: "p1", redraw: false });
  s = apply(s, { type: "mulligan", player: "p2", redraw: false });
  s = apply(s, { type: "charge", player: "p1", card: null });
  s = apply(s, { type: "endMain", player: "p1" });
  s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p2");
  for (const p of ["p1", "p2"] as const) for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, p: PlayerId, cardId: string, area: "battle" | "hand" | "drop"): string {
  const id = s.sides[p].zones.deck[0];
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `could not stage ${cardId}`);
  s.pending = [];
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
/** p1's board: `leader` leading, `drop`/`battle` staged; p2's Shooter then deals 1 damage to p1's life. */
function shoot(seed: number, o: { leader: string; drop?: string[]; battle?: string[] }) {
  const s = p2Main(seed);
  s.cards[leaderOf(s, "p1")].cardId = o.leader;
  const inDrop = (o.drop ?? []).map((c) => stage(s, "p1", c, "drop"));
  const inBattle = (o.battle ?? []).map((c) => stage(s, "p1", c, "battle"));
  const shooter = stage(s, "p2", "SHOOTER1098", "battle");
  const act = legal(s).find(({ action }) => action.type === "activate" && action.card === shooter);
  assert.ok(act, "the shooter is offered");
  const life = zone(s, "p1", "life").length;
  return { s: apply(s, act.action), inDrop, inBattle, life };
}
/** Answer with the first legal action of whoever is asked until p2's Main Phase is back, or `stop` holds. */
function settle(s: VmState, stop: (s: VmState) => boolean): VmState {
  for (let i = 0; i < 40 && !stop(s); i++) {
    if (s.prompt.kind === "main" && s.turnPlayer === "p2" && s.pending.length === 0) return s;
    const options = legal(s).filter(({ action }) => action.type !== "concede");
    const action = options[0]?.action;
    assert.ok(action, `stopped at ${s.prompt.kind} with nothing to answer`);
    s = apply(s, action);
  }
  return s;
}
const isOffer = (s: VmState) => s.prompt.kind === "chooseMode" && (s.prompt as { player?: string }).player === "p1";

async function main(): Promise<void> {
  // The record names the area, the engine reads it.
  assert.deepEqual(usableFrom(ctx.scripts!.VEGETA1098.bySkill[0]), ["drop"], "the compiled record of the life-moves Auto declares the Drop as its origin");
  assert.deepEqual(usableFrom(ctx.scripts!.PLAINAUTO1098.bySkill[0]), [], "a draw Auto declares no origin");

  // 1. Leader {Vegeta, Warrior Race Pride}, the card in the Drop, 1 damage to life: the Auto is offered; taken, the card is played from the Drop.
  {
    const b = shoot(10980, { leader: "PRIDE1098", drop: ["VEGETA1098"] });
    const s = settle(b.s, isOffer);
    assert.ok(isOffer(s), "the Drop copy's Auto is offered when a life card moves");
    assert.equal(zone(s, "p1", "life").length, b.life - 1, "one life card moved");
    assert.ok(zone(s, "p1", "drop").includes(b.inDrop[0]), "still in the Drop until the offer is taken");
    const declined = settle(apply(s, { type: "chooseMode", player: "p1", index: 1 }), () => false);
    assert.ok(zone(declined, "p1", "drop").includes(b.inDrop[0]), "declined: it stays in the Drop");
    const taken = settle(apply(s, { type: "chooseMode", player: "p1", index: 0 }), () => false);
    assert.ok(zone(taken, "p1", "battle").includes(b.inDrop[0]), "taken: the card was played from the Drop");
    assert.ok(!zone(taken, "p1", "drop").includes(b.inDrop[0]), "taken: it left the Drop");
  }

  // 2. Without that Leader: no offer.
  {
    const b = shoot(10981, { leader: "L-RED", drop: ["VEGETA1098"] });
    let s = settle(b.s, isOffer);
    assert.ok(!isOffer(s), "another Leader: no offer");
    s = settle(s, () => false);
    assert.ok(zone(s, "p1", "drop").includes(b.inDrop[0]) && !zone(s, "p1", "battle").includes(b.inDrop[0]), "it stays in the Drop");
  }

  // 3. A Drop card with no Drop-origin Auto, or another trigger: no offer, nothing happens.
  for (const id of ["PLAINAUTO1098", "OTHERTRIG1098"]) {
    const b = shoot(10982, { leader: "PRIDE1098", drop: [id] });
    const handBefore = zone(b.s, "p1", "hand").length;
    const s = settle(b.s, isOffer);
    assert.ok(!isOffer(s), `${id} in the Drop: no offer`);
    assert.ok(zone(s, "p1", "drop").includes(b.inDrop[0]), `${id} stays in the Drop`);
    assert.equal(zone(s, "p1", "hand").length, handBefore, `${id}: no draw from the Drop`);
  }

  // 4. In play it reads as before: its Drop-origin Auto is not heard in the Battle Area.
  {
    const b = shoot(10983, { leader: "PRIDE1098", battle: ["VEGETA1098"] });
    const s = settle(b.s, isOffer);
    assert.ok(!isOffer(s), "in play: no offer");
    assert.ok(zone(s, "p1", "battle").includes(b.inBattle[0]), "in play: it stays where it is");
  }
}

export default main();

/**
 * Arena F1-03 (#1186): the two Fusion World rules the engine does natively.
 *
 *   (a) Combo has no price (FW manual p. 10). `comboPriceOf` finds no declared combo `DEFINE COST`
 *       in the fusion definition, so a combo card with a printed combo cost is offered, joined and
 *       dropped with no energy rested and no `payCost` prompt; the dbs definition still declares
 *       one and still charges it.
 *   (b) A Battle Card whose power a skill lowers to 0 goes to its owner's Drop at the next
 *       checkpoint, not as a KO (FW manual p. 11): a `moved` moment with cause `powerZero`, no
 *       `ko` moment, no "when KO'd" Auto pended. The same card in a dbs game takes the dbs 21-6 route.
 *
 * Synthetic cards, a game created as `{ game: "fusion" }`. Part of `npm test` (verify-arena.ts).
 */
import assert from "node:assert/strict";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, IMPL, card, fifty, leaderOf, zoneOf } from "./harness";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { comboPriceOf } from "../../src/lib/arena/vm/battle";

const definitionOf = (game: "dbs" | "fusion") => {
  const loaded = rulesetFor(game);
  assert.ok(loaded.ok, `${game} loads`);
  return loaded.definition;
};
assert.equal(comboPriceOf(definitionOf("fusion")), null, "the fusion definition declares no combo price");
assert.equal(comboPriceOf(definitionOf("dbs")), "combo", "the dbs definition declares one");

DEFS["FW-COMBO"] = card("FW-COMBO", { energyCost: 1, power: 5000, comboCost: 3, comboPower: 10000, skill: "" });
DEFS["FW-LOWER"] = card("FW-LOWER", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the duration of the turn." });
DEFS["FW-TARGET"] = card("FW-TARGET", { energyCost: 1, power: 5000, skill: "[Auto] When this card is KO'd, draw 1 card." });

function newGame(game: "fusion" | "dbs"): EngineState {
  let r = IMPL.createGame(CTX, { seed: 7, game, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state;
  const chooser = (r.prompt as { player: PlayerId }).player;
  const steps: Action[] = [
    { type: "chooseFirst", player: chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ];
  for (const a of steps) r = IMPL.apply(CTX, r, a).state;
  assert.equal(r.prompt.kind, "main");
  return r;
}

function stage(state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle"): string {
  const filler = owner === "p1" ? "V1" : "V-BLUE";
  const id = zoneOf(state, owner, "deck").find((x) => state.cards[x].cardId === filler);
  assert.ok(id);
  state.sides[owner].zones.deck = zoneOf(state, owner, "deck").filter((x) => x !== id);
  state.cards[id].cardId = cardId;
  zoneOf(state, owner, area).push(id);
  if (area === "battle") state.cards[id].mode = "active";
  return id;
}

function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), `expected legal ${JSON.stringify(action)} at ${state.prompt.kind}`);
  return IMPL.apply(CTX, state, action);
}

const restedEnergy = (s: EngineState, p: PlayerId) => zoneOf(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;

// (a) Combo without a price.
for (const game of ["fusion", "dbs"] as const) {
  let state = newGame(game);
  const combo = stage(state, "p1", "FW-COMBO", "hand");
  for (const id of zoneOf(state, "p1", "energy")) state.cards[id].mode = "rest"; // nothing left to pay with
  const rested = restedEnergy(state, "p1");
  state = take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1")!, target: leaderOf(state, "p2")! }).state;
  const offered = IMPL.legalActions(CTX, state).some((a) => a.action.type === "combo" && a.action.card === combo);
  assert.equal(offered, game === "fusion", `${game}: a 3-cost combo with no energy is ${game === "fusion" ? "offered free" : "refused"}`);
  if (game === "dbs") continue;
  const joined = take(state, { type: "combo", player: "p1", card: combo });
  assert.notEqual(joined.state.prompt.kind, "payCost", "no payment prompt");
  assert.equal(restedEnergy(joined.state, "p1"), rested, "no energy rested");
  assert.ok(zoneOf(joined.state, "p1", "combo").includes(combo), "the card is in the Combo Area");
  state = joined.state;
  for (let i = 0; i < 12 && state.prompt.kind !== "main" && state.phase !== "over"; i++) {
    const prompt = state.prompt as { kind: string; player: PlayerId };
    assert.equal(prompt.kind, "combo", `battle stopped at ${prompt.kind}`);
    state = take(state, { type: "pass", player: prompt.player }).state;
  }
  assert.ok(zoneOf(state, "p1", "drop").includes(combo), "the combo card is in the Drop at the end of the battle");
}

// (b) Power 0 is not a KO.
for (const game of ["fusion", "dbs"] as const) {
  let state = newGame(game);
  const target = stage(state, "p2", "FW-TARGET", "battle");
  const lower = stage(state, "p1", "FW-LOWER", "hand");
  const handBefore = zoneOf(state, "p2", "hand").length;
  const result = take(state, { type: "play", player: "p1", card: lower });
  state = result.state;
  const events = [...result.events];
  for (let i = 0; i < 6 && state.prompt.kind !== "main"; i++) {
    const rows = IMPL.legalActions(CTX, state);
    const pick = rows.find((r) => r.action.type === "choose" || r.action.type === "chooseMode") ?? rows[0];
    const next = IMPL.apply(CTX, state, pick.action);
    state = next.state;
    events.push(...next.events);
  }
  assert.equal(state.prompt.kind, "main", `${game}: back at the Main Phase`);
  assert.ok(zoneOf(state, "p2", "drop").includes(target), `${game}: the power-0 card is in its owner's Drop`);
  assert.ok(!zoneOf(state, "p2", "battle").includes(target));
  assert.equal(zoneOf(state, "p2", "hand").length, handBefore, `${game}: its "when KO'd" draw did not fire`);
  assert.ok(!state.pending.some((p) => p.card === target), `${game}: nothing pends on it`);
  assert.ok(!events.some((e) => e.type === "ko" && e.card === target), `${game}: no KO is logged for it`);
}
console.log("arena-fusion-world-vm: ok");

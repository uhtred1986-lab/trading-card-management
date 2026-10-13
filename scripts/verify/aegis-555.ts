/** Aegis's colour payment is an incremental, reloadable choice (#555). */
import assert from "node:assert/strict";
import { DEFS, IMPL, CTX, assertConsistentG, canActivateG, findG, labelsG, leaderOf, playG, stageMoveG, stagedG, zoneOf, type EngineState } from "./harness";
import type { Action, GameEvent } from "../../src/lib/arena/types";

// The legacy engine remains the frozen oracle. These checks intentionally
// exercise the rules VM only; its unchanged legacy comparisons are elsewhere.
const fixtureDefs = ["AEG555", "AEG555_MULTI", "AEG555_THREE", "V-GREEN"];
const previousDefs = new Map(fixtureDefs.map((id) => [id, DEFS[id]] as const));
try {
DEFS.AEG555 = { ...DEFS.V1, id: "AEG555", name: "AEG555", skill: "[Aegis red/blue] {r}" };
DEFS.AEG555_MULTI = { ...DEFS.V1, id: "AEG555_MULTI", name: "AEG555_MULTI", colors: ["Red", "Blue"] };
DEFS.AEG555_THREE = { ...DEFS.V1, id: "AEG555_THREE", name: "AEG555_THREE", skill: "[Aegis red/blue/red/green]" };
DEFS["V-GREEN"] = { ...DEFS.V1, id: "V-GREEN", name: "V-GREEN", colors: ["Green"] };

function defense(hand: string[], battle = "AEG555", requireAvailable = true): EngineState {
  let s = stagedG({ battle: [battle], hand, energy: ["V1", "V1", "V1"] });
  const needed = new Map<string, number>();
  for (const cardId of hand) needed.set(cardId, (needed.get(cardId) ?? 0) + 1);
  for (const id of zoneOf(s, "p1", "hand").slice()) {
    const cardId = s.cards[id].cardId;
    const count = needed.get(cardId) ?? 0;
    if (count > 0) needed.set(cardId, count - 1);
    else stageMoveG(s, id, "deck", "p1");
  }
  const aegis = findG(s, "p1", "battle", battle);
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const energy = zoneOf(s, "p1", "energy");
  assert.equal(energy.length, 3, "three staged energy provide the printed orb and two rested resources");
  s.cards[energy[0]].mode = "rest";
  s.cards[energy[1]].mode = "rest";
  s = playG(
    s,
    { type: "attack", player: "p2", attacker: leaderOf(s, "p2"), target: leaderOf(s, "p1") },
    { type: "pass", player: "p2" },
  );
  assert.equal(s.prompt.kind, "combo", "Aegis is offered at the Defense Step combo prompt");
  assert.equal(canActivateG(s, aegis), requireAvailable, requireAvailable ? "the full payment is available before the activation" : "the impossible payment is refused before activation");
  return s;
}

function apply(s: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  const result = IMPL.apply(CTX, s, action);
  return { state: result.state as EngineState, events: result.events };
}

const choice = (s: EngineState) => {
  assert.equal(s.prompt.kind, "chooseCards");
  return (s.prompt as { choice: { candidates: string[]; min: number; max: number } }).choice;
};
const activate = (s: EngineState, skill = 0) => playG(s, { type: "activate", player: "p1", card: findG(s, "p1", "battle", "AEG555"), skill });

// The first pick may be either named colour. A Blue-first choice must ask
// only for a Red card next; the selected Blue remains in hand until all
// colours are covered, but is excluded from every later payment prompt.
{
  let s = defense(["V1", "V1", "V-BLUE", "V-BLUE"]);
  const energyBefore = zoneOf(s, "p1", "energy").map((id) => s.cards[id].mode);
  const activation = apply(s, { type: "activate", player: "p1", card: findG(s, "p1", "battle", "AEG555"), skill: 0 });
  s = activation.state;
  const energyAfter = zoneOf(s, "p1", "energy").map((id) => s.cards[id].mode);
  assert.deepEqual(energyAfter, energyBefore, "22-30-3: the printed {r} waits until after the hand-color cost");
  assert.equal(activation.events.filter((event) => event.type === "move" && event.from === "hand" && event.to === "drop").length, 0, "no colour card is dropped before full coverage is selected");
  const [red1, red2] = zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "V1");
  const [blue1, blue2] = zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "V-BLUE");
  assert.deepEqual(choice(s).candidates, [red1, red2, blue1, blue2], "the first choice remains open to either printed colour");
  assert.equal(choice(s).min, 1, "the first card is a required part of the skill cost");
  s = playG(s, { type: "choose", player: "p1", cards: [blue1] });
  assert.deepEqual(choice(s).candidates, [red1, red2], "only a missing Red is eligible after Blue was chosen");
  assert.equal(choice(s).min, 1, "every remaining color is a required part of the accepted skill cost");
  assert.equal(choice(s).max, 1);
  assert.ok(!labelsG(s).includes("Choose none"), "the remaining cost cannot be declined");

  const beforeReload = JSON.stringify(s);
  const invalid: Action = { type: "choose", player: "p1", cards: [blue1] };
  assert.throws(() => apply(s, invalid), /invalid choice/, "a stale answer cannot pay with the selected Blue twice");
  assert.equal(JSON.stringify(s), beforeReload, "a refused stale answer leaves the prompt and state intact");

  s = JSON.parse(beforeReload) as EngineState;
  const paid = apply(s, { type: "choose", player: "p1", cards: [red1] });
  s = paid.state;
  assert.ok(zoneOf(s, "p1", "drop").includes(red1) && zoneOf(s, "p1", "drop").includes(blue1), "the complete mono-colour pair is dropped as the cost");
  assert.ok(zoneOf(s, "p1", "hand").includes(red2) && zoneOf(s, "p1", "hand").includes(blue2), "unused copies stay in hand");
  const costMoves = paid.events.filter((event) => event.type === "move");
  assert.equal(costMoves.length, 2, "the final colour answer moves the two-card cost exactly once");
  assert.deepEqual(
    costMoves.map((event) => event.type === "move" ? [event.card, event.from, event.to] : []),
    [[blue1, "hand", "drop"], [red1, "hand", "drop"]],
    "both selected cards move from hand to Drop exactly once",
  );
  assert.equal(s.prompt.kind, "chooseCards", "the completed cost proceeds to the separate energy choice");
  const rested = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.equal(rested.length, 3, "the printed orb has already rested, so all three energy are eligible for Aegis's effect");
  s = playG(s, { type: "choose", player: "p1", cards: [rested[0]] }, { type: "choose", player: "p1", cards: [rested[1]] });
  assert.equal(zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "active").length, 2, "both rested energy stand after payment");
  assertConsistentG(s);
}

// Red-first order, with several Blue alternatives, persists the intermediate
// ScriptFrame through a JSON reload and filters the selected Red out.
{
  let s = activate(defense(["V1", "V1", "V-BLUE", "V-BLUE"]));
  const [red1, red2] = zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "V1");
  const [blue1, blue2] = zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "V-BLUE");
  s = playG(s, { type: "choose", player: "p1", cards: [red1] });
  assert.deepEqual(choice(s).candidates, [blue1, blue2], "Red-first leaves only Blue choices");
  assert.equal(choice(s).min, 1, "the remaining colour payment is mandatory");
  assert.ok(!labelsG(s).includes("Choose none"));
  const waiting = JSON.stringify(s);
  assert.throws(() => apply(s, { type: "choose", player: "p1", cards: [] }), /choose at least 1/, "an empty answer cannot leave Aegis partially paid");
  assert.equal(JSON.stringify(s), waiting, "rejecting an empty answer preserves the reloadable prompt");
  s = JSON.parse(JSON.stringify(s)) as EngineState;
  assert.deepEqual(choice(s).candidates, [blue1, blue2], "the missing-colour prompt survives reload");
  s = playG(s, { type: "choose", player: "p1", cards: [blue2] });
  assert.ok(zoneOf(s, "p1", "drop").includes(red1) && zoneOf(s, "p1", "drop").includes(blue2));
  assert.ok(zoneOf(s, "p1", "hand").includes(red2) && zoneOf(s, "p1", "hand").includes(blue1));
  assert.equal(s.prompt.kind, "chooseCards");
  assertConsistentG(s);
}

// A single multicolour card is a forced complete payment and is moved once;
// there is no redundant second hand prompt.
{
  let s = defense(["AEG555_MULTI"]);
  const multi = findG(s, "p1", "hand", "AEG555_MULTI");
  const result = apply(s, { type: "activate", player: "p1", card: findG(s, "p1", "battle", "AEG555"), skill: 0 });
  s = result.state;
  assert.ok(zoneOf(s, "p1", "drop").includes(multi));
  assert.equal(s.prompt.kind, "chooseCards", "the next prompt is energy, not another hand colour");
  assert.match((s.prompt as { choice: { reason: string } }).choice.reason, /energy to switch/);
  assert.equal(result.events.filter((event) => event.type === "move" && event.card === multi && event.from === "hand" && event.to === "drop").length, 1, "the single card pays once");
  assertConsistentG(s);
}

// The continuation is recursive over the printed list, not a two-colour
// special case: three mono-colour cards satisfy a three-colour Aegis.
{
  let s = defense(["V1", "V1", "V-BLUE", "V-BLUE", "V-GREEN", "V-GREEN"], "AEG555_THREE");
  const aegis = findG(s, "p1", "battle", "AEG555_THREE");
  s = playG(s, { type: "activate", player: "p1", card: aegis, skill: 0 });
  const first = choice(s).candidates;
  assert.equal(first.length, 6, "duplicate printed Red normalizes to one required colour, not two payment cards");
  const greens = first.filter((id) => s.cards[id].cardId === "V-GREEN");
  const blues = first.filter((id) => s.cards[id].cardId === "V-BLUE");
  const reds = first.filter((id) => s.cards[id].cardId === "V1");
  const green = greens[0];
  const blue = blues[0];
  const red = reds[0];
  s = playG(s, { type: "choose", player: "p1", cards: [green] });
  assert.deepEqual(choice(s).candidates, reds, "after Green, only a missing named colour is offered");
  s = playG(s, { type: "choose", player: "p1", cards: [red] });
  assert.deepEqual(choice(s).candidates, blues, "the third distinct colour is then the only eligible payment");
  s = playG(s, { type: "choose", player: "p1", cards: [blue] });
  assert.ok([red, blue, green].every((id) => zoneOf(s, "p1", "drop").includes(id)));
  assert.equal(s.prompt.kind, "chooseCards");
  assertConsistentG(s);
}

// Coverage is checked before activation, so an impossible partial payment
// cannot spend its printed orb or move a card.
{
  const s = defense(["V1"], "AEG555", false);
  const aegis = findG(s, "p1", "battle", "AEG555");
  const before = JSON.stringify(s);
  assert.ok(!canActivateG(s, aegis), "red alone cannot pay a Red/Blue Aegis");
  assert.equal(JSON.stringify(s), before, "a refused impossible activation changes neither card zones nor energy modes");
  assert.ok(!zoneOf(s, "p1", "drop").length);
}
} finally {
  for (const id of fixtureDefs) {
    const previous = previousDefs.get(id);
    if (previous) DEFS[id] = previous;
    else delete DEFS[id];
  }
}

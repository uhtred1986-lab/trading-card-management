/**
 * #1118 (Rule Manual 9-1-3-2): an [Activate] whose price or effect takes THIS card out of the Warp is offered from the Warp.
 *
 * The area is read off the compiled record (`usableFrom`: the Warp on the `[self]` selector), never the name or id, the
 * same reading #748 (hand) and #1098 (Drop) use. A Warp card with no such line offers nothing; the same card in the Drop
 * or the hand does not offer the line; [Over Realm] from the Warp is unchanged (its own proof is in keywords.ts).
 *
 * Printed texts: BT31-007 f0 and BT16-103 f20 are NOT in the repo in full (batch-5.md truncates the first; the second is
 * nowhere). The BT31-007 line is reconstructed from the batch-5 receipt (price: place this card from the Warp into the
 * Drop and discard a red <Vegeta> from the hand; effect: a red <Veku> of cost 5 from the Drop/Warp to the hand). The
 * "play this card from your Warp" line stands in for BT16-103 f20 with the shape of the printed BT31-010 f20 receipt
 * ({r}, a red <Veku>/<Gogeta> to the Drop, play this card from your Warp). Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, fifty, findG, rejectedActionsG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import { usableFrom } from "../../src/lib/arena/vm/activate";

const BT31_007_F0 = "[Activate: Main][Limit 1] Place this card from your Warp into its owner's Drop and discard 1 red <Vegeta> card from your hand: Choose 1 red <Veku> card with an energy cost of 5 from your Drop Area and/or Warp and add it to your hand.";
const PLAY_FROM_WARP = "[Activate: Main/Battle]{r}, choose 1 of your red <Veku> or <Gogeta> cards and place it into its owner's Drop: Play this card from your Warp.";

DEFS["W-007"] = card("W-007", { energyCost: 5, characters: ["SS3 Son Goku"], skill: BT31_007_F0 });
DEFS["W-103"] = card("W-103", { energyCost: 5, characters: ["Gogeta"], skill: PLAY_FROM_WARP });
DEFS["W-PLAIN"] = card("W-PLAIN", { skill: "[Activate: Main] Draw 1 card." });
DEFS["W-OR"] = card("W-OR", { energyCost: 5, skill: "[Over Realm 3]{1}" });
DEFS["W-VEGETA"] = card("W-VEGETA", { characters: ["Vegeta"] });
DEFS["W-VEKU5"] = card("W-VEKU5", { energyCost: 5, characters: ["Veku"] });
DEFS["W-VEKU6"] = card("W-VEKU6", { energyCost: 6, characters: ["Veku"] });
DEFS["W-KEEP"] = card("W-KEEP", { characters: ["Keep"] });

// The records declare the Warp as the origin, and an ordinary line declares none.
{
  const sc = CTX.scripts as Record<string, import("../../src/lib/arena/vm/script").CardScripts>;
  assert.deepEqual(usableFrom(sc["W-007"].bySkill[0]), ["warp"], "BT31-007 f0: the record declares the Warp");
  assert.deepEqual(usableFrom(sc["W-103"].bySkill[0]), ["warp"], "play-from-Warp line: the record declares the Warp");
  assert.deepEqual(usableFrom(sc["W-PLAIN"].bySkill[0]), [], "an ordinary [Activate: Main] declares no area");
}

type Zone = "hand" | "battle" | "energy" | "warp" | "drop";
/** p1's second-turn Main Phase with the named cards staged in the areas (hand, battle, energy start empty). */
function game(o: Partial<Record<Zone, string[]>>): VmState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(CTX, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p2", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p2" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  assert.equal(r.prompt.kind, "main");
  for (const area of ["hand", "battle", "energy", "warp", "drop"] as const) {
    r.sides.p1.zones.deck.push(...r.sides.p1.zones[area]);
    r.sides.p1.zones[area] = [];
  }
  for (const area of ["hand", "battle", "energy", "warp", "drop"] as const) {
    for (const cardId of o[area] ?? []) {
      const id = r.sides.p1.zones.deck.find((x) => r.cards[x].cardId === "V1");
      assert.ok(id, "the deck has a filler card to relabel");
      r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((x) => x !== id);
      r.cards[id!].cardId = cardId;
      r.sides.p1.zones[area] = [...r.sides.p1.zones[area], id!];
      if (area !== "hand") r.cards[id!].mode = "active";
    }
  }
  return r;
}
const activations = (s: EngineState, id: string) => IMPL.legalActions(CTX, s).map((a) => a.action).filter((a) => a.type === "activate" && a.card === id);
const refusal = (s: EngineState, id: string) => rejectedActionsG(s).find((row) => row.action.type === "activate" && row.action.card === id)?.why;
const names = (s: EngineState, area: Zone) => zoneOf(s, "p1", area).map((id) => s.cards[id].cardId);

/** Answer what the line asks (the named card when offered, else the first) until nothing is asked. */
function answer(s: EngineState, pick: string[]): EngineState {
  for (let i = 0; i < 24; i++) {
    const p = s.prompt as unknown as { kind: string; player: PlayerId; choice?: { candidates: string[] } };
    if (p.kind !== "chooseCards") break;
    const want = p.choice!.candidates.find((c) => pick.includes(c));
    s = IMPL.apply(CTX, JSON.parse(JSON.stringify(s)) as EngineState, { type: "choose", player: p.player, cards: [want ?? p.choice!.candidates[0]!] } as Action).state;
  }
  return s;
}

// ── BT31-007 f0: offered from the Warp and resolves as printed ──
{
  const s = game({ warp: ["W-007"], hand: ["W-VEGETA", "W-KEEP"], drop: ["W-VEKU5", "W-VEKU6"] });
  const host = findG(s, "p1", "warp", "W-007");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered from the Warp (refusal: ${JSON.stringify(refusal(s, host))})`);
  const veku5 = findG(s, "p1", "drop", "W-VEKU5");
  const t = answer(IMPL.apply(CTX, s, acts[0]!).state, [veku5]);
  assert.ok(names(t, "drop").includes("W-007"), "the card went from the Warp into the Drop (the price)");
  assert.ok(!names(t, "warp").includes("W-007"));
  assert.ok(names(t, "drop").includes("W-VEGETA") && !names(t, "hand").includes("W-VEGETA"), "the red <Vegeta> was discarded");
  assert.ok(names(t, "hand").includes("W-VEKU5"), "the cost-5 <Veku> came to the hand");
  assert.ok(names(t, "drop").includes("W-VEKU6"), "the cost-6 <Veku> stays");
  assert.ok(names(t, "hand").includes("W-KEEP"), "the other hand card is kept");
  assert.equal(t.prompt.kind, "main", "back at the main prompt");
}
// The same card in the Drop or the hand is not offered.
for (const area of ["drop", "hand"] as const) {
  const s = game({ [area]: area === "hand" ? ["W-007", "W-VEGETA"] : ["W-007"], ...(area === "drop" ? { hand: ["W-VEGETA"] } : {}) } as Partial<Record<Zone, string[]>>);
  const host = findG(s, "p1", area, "W-007");
  assert.equal(activations(s, host).length, 0, `not offered from the ${area}`);
}
// Not offered from the Battle Area either (9-1-3-2 names the Warp: the line is used from there and nowhere else).
{
  const s = game({ battle: ["W-007"], hand: ["W-VEGETA"] });
  assert.equal(activations(s, findG(s, "p1", "battle", "W-007")).length, 0, "not offered from the Battle Area");
}
// The price must still be payable: no red <Vegeta> in hand, nothing is offered.
{
  const s = game({ warp: ["W-007"], hand: ["W-KEEP"], drop: ["W-VEKU5"] });
  assert.equal(activations(s, findG(s, "p1", "warp", "W-007")).length, 0, "price unpayable: not offered");
}

// ── "play this card from your Warp" (stands in for BT16-103 f20) ──
{
  const s = game({ warp: ["W-103"], battle: ["W-VEKU5"], energy: ["V1", "V1"] });
  const host = findG(s, "p1", "warp", "W-103");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered from the Warp (refusal: ${JSON.stringify(refusal(s, host))})`);
  const veku = findG(s, "p1", "battle", "W-VEKU5");
  const t = answer(IMPL.apply(CTX, s, acts[0]!).state, [veku]);
  assert.ok(names(t, "drop").includes("W-VEKU5"), "the price: the <Veku> went to the Drop");
  assert.ok(names(t, "battle").includes("W-103"), "the card was played from the Warp");
  assert.ok(!names(t, "warp").includes("W-103"));
}
for (const area of ["drop", "hand"] as const) {
  const s = game({ [area]: ["W-103"], battle: ["W-VEKU5"], energy: ["V1", "V1"] } as Partial<Record<Zone, string[]>>);
  assert.equal(activations(s, findG(s, "p1", area, "W-103")).length, 0, `not offered from the ${area}`);
}

// ── a Warp card without such a line offers nothing ──
{
  const s = game({ warp: ["W-PLAIN", "W-OR"], energy: ["V1", "V1", "V1"] });
  assert.equal(activations(s, findG(s, "p1", "warp", "W-PLAIN")).length, 0, "an ordinary [Activate: Main] is not offered from the Warp");
  assert.equal(activations(s, findG(s, "p1", "warp", "W-OR")).length, 0, "[Over Realm] without its permission is not offered from the Warp");
  const h = game({ battle: ["W-PLAIN"] });
  assert.equal(activations(h, findG(h, "p1", "battle", "W-PLAIN")).length, 1, "the same ordinary line is still offered from where it always was");
}

/**
 * #1096 (23-2, 4-3-3): an [Activate] price that places a card under a card the price chose is payable.
 *
 * BT10-091 One-Star Ball, Parasitic Darkness, front 20 — "[Activate: Main] Choose 1 <Frieza> card with an energy
 * cost of 4 in your Battle Area and place this card under it: Play up to 1 green <Frieza: Xeno> card from your
 * deck or hand in Active Mode on top of the chosen card. Shuffle your deck." (the wording is the receipt's —
 * `rules-review-2026-10-20/batch-3.md` section 3 — and the stored reading in the deck audit; the energy cost and
 * colours of the card itself are not evidence here). The line is compiled from that text, not hand-built.
 *
 * Also: `play` stays refused with its reason; KO, `comboFrom`, shuffle and reveal became payable in #1117 (`activate-prices-1117.ts`).
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, compileSkill, fifty, findG, parseSkills, playG, rejectedActionsG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import { activationPriceProblem } from "../../src/lib/arena/vm/activation-price-support";
import type { Op } from "../../src/lib/arena/vm/script";

const ONE_STAR = "[Activate: Main] Choose 1 <Frieza> card with an energy cost of 4 in your Battle Area and place this card under it: Play up to 1 green <Frieza: Xeno> card from your deck or hand in Active Mode on top of the chosen card. Shuffle your deck.";

DEFS["PU-BALL"] = card("PU-BALL", { type: "EXTRA", colors: ["Green"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: ONE_STAR, characters: ["One-Star Ball"] });
DEFS["PU-F4"] = card("PU-F4", { energyCost: 4, characters: ["Frieza"], colors: ["Green"], skill: null });
DEFS["PU-F3"] = card("PU-F3", { energyCost: 3, characters: ["Frieza"], colors: ["Green"], skill: null });
DEFS["PU-XENO"] = card("PU-XENO", { energyCost: 2, characters: ["Frieza: Xeno"], colors: ["Green"], power: 20000, skill: null });
// A card of the same price shape that takes a chosen hand card to a chosen Battle Card: the "no card to place" case.
DEFS["PU-TUCK"] = card("PU-TUCK", {
  type: "EXTRA", colors: ["Green"], energyCost: 0, power: null, comboCost: null, comboPower: null, characters: ["Tuck"],
  skill: "[Activate: Main] Choose 1 <Frieza> card in your Battle Area and choose 1 other card in your hand and place it under the chosen <Frieza> card: Draw 1 card.",
});

/** p1's second-turn Main Phase with the named cards staged in hand and Battle Area. */
function game(o: { hand?: string[]; battle?: string[] }): EngineState {
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
  // The hand and the Battle Area start empty: what is staged is all there is.
  for (const area of ["hand", "battle"] as const) {
    r.sides.p1.zones.deck.push(...r.sides.p1.zones[area]);
    r.sides.p1.zones[area] = [];
  }
  const stage = (cardId: string, area: "hand" | "battle") => {
    const id = r.sides.p1.zones.deck.find((x) => r.cards[x].cardId === "V1");
    assert.ok(id, "the deck has a filler card to relabel");
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((x) => x !== id);
    r.cards[id!].cardId = cardId;
    r.sides.p1.zones[area] = [...r.sides.p1.zones[area], id!];
    if (area === "battle") r.cards[id!].mode = "active";
  };
  for (const id of o.hand ?? []) stage(id, "hand");
  for (const id of o.battle ?? []) stage(id, "battle");
  return r;
}

const activations = (s: EngineState, id: string) => IMPL.legalActions(CTX, s).map((a) => a.action).filter((a) => a.type === "activate" && a.card === id);
const refusal = (s: EngineState, id: string) => rejectedActionsG(s).find((row) => row.action.type === "activate" && row.action.card === id)?.why;
const underOf = (s: EngineState, id: string): string[] => s.cards[id].under.map((u) => s.cards[u].cardId);

// ── the compiled line: the price is a place-under, which the static planner now reads ──
assert.deepEqual(compileSkill(parseSkills(ONE_STAR)[0]).unsupported, []);

{
  // Offered: a cost-4 <Frieza> in the Battle Area, a Xeno in hand.
  const s = game({ hand: ["PU-BALL", "PU-XENO"], battle: ["PU-F4"] });
  const ball = findG(s, "p1", "hand", "PU-BALL");
  const frieza = findG(s, "p1", "battle", "PU-F4");
  const xeno = findG(s, "p1", "hand", "PU-XENO");
  const acts = activations(s, ball);
  assert.equal(acts.length, 1, `BT10-091 f20 is offered with a cost-4 <Frieza> in play (refusal: ${JSON.stringify(refusal(s, ball))})`);
  let t = playG(s, acts[0]);
  // Answer whatever is asked with the card the proof names; the host is the only <Frieza>, the Xeno the only Xeno.
  for (let i = 0; i < 6 && t.prompt.kind === "chooseCards"; i++) {
    const p = t.prompt as unknown as { player: PlayerId; choice: { candidates: string[]; reason: string } };
    const pick = p.choice.candidates.includes(xeno) ? xeno : p.choice.candidates[0];
    if (pick === xeno) {
      // The effect is asking: the price is paid, so the ball already stands under the chosen <Frieza> (23-2).
      assert.deepEqual(underOf(t, frieza), ["PU-BALL"], "BT10-091 was placed under the chosen <Frieza> as the price");
      assert.ok(!zoneOf(t, "p1", "hand").includes(ball), "and left the hand");
    }
    t = playG(t, { type: "choose", player: p.player, cards: [pick] } as Action);
  }
  assert.equal(t.prompt.kind, "main", "the line resolved and the game is back at the Main Phase");
  // The Xeno then landed on top of the <Frieza>, which takes its pile along (23-2-6): the stack stands under the Xeno.
  const xenoNow = zoneOf(t, "p1", "battle").find((id) => t.cards[id].cardId === "PU-XENO");
  assert.ok(xenoNow, "the Xeno was played into the Battle Area");
  assert.ok(!zoneOf(t, "p1", "battle").includes(frieza), "on top of the chosen <Frieza>");
  assert.deepEqual(underOf(t, xenoNow!).sort(), ["PU-BALL", "PU-F4"], "the Frieza and the ball it carried are under the Xeno");
}

{
  // Not offered without a cost-4 <Frieza>: the price's own choice has no card.
  const s = game({ hand: ["PU-BALL", "PU-XENO"], battle: ["PU-F3"] });
  const ball = findG(s, "p1", "hand", "PU-BALL");
  assert.equal(activations(s, ball).length, 0, "a cost-3 <Frieza> is no host");
  assert.equal(refusal(s, ball)?.[0]?.kind, "other");
  assert.match(String((refusal(s, ball)?.[0] as { detail?: string }).detail), /cannot pay/);
  const none = game({ hand: ["PU-BALL", "PU-XENO"] });
  assert.equal(activations(none, findG(none, "p1", "hand", "PU-BALL")).length, 0, "and none at all");
}

{
  // Place-under with no card to place: the hand has nothing but the activating card.
  const bare = game({ hand: ["PU-TUCK"], battle: ["PU-F4"] });
  const tuck = findG(bare, "p1", "hand", "PU-TUCK");
  assert.equal(activations(bare, tuck).length, 0, "no other card in hand to place under it: refused");
  const fed = game({ hand: ["PU-TUCK", "PU-XENO"], battle: ["PU-F4"] });
  assert.equal(activations(fed, findG(fed, "p1", "hand", "PU-TUCK")).length, 1, "with a card to place it is offered");
}

// ── the static half, with the reasons the other shapes keep ──
{
  const choose = (as: string): Op => ({ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as }) as Op;
  const place = (o: Partial<Extract<Op, { op: "moveTo" }>>): Op => ({ op: "moveTo", target: { sel: { special: "self" } }, to: "under", under: { var: "c0" }, ...o }) as Op;
  assert.equal(activationPriceProblem([choose("c0"), place({})]), null, "this card under the chosen card");
  assert.equal(activationPriceProblem([choose("c0"), choose("c1"), place({ target: { var: "c1" } })]), null, "a chosen card under the chosen card");
  assert.match(activationPriceProblem([place({})]) ?? "", /moveTo under a card the price did not choose/, "no choice binds the host");
  assert.equal(activationPriceProblem([choose("c0"), place({ under: undefined, target: { var: "c0" } })]), null, "no host named: this card is the host");
  assert.match(activationPriceProblem([choose("c0"), place({ target: { sel: { side: "you", area: "hand" } } })]) ?? "", /for a card the price did not choose/, "a moved card named by a bare selector");
  assert.match(activationPriceProblem([place({ to: "play" })]) ?? "", /cannot charge moveTo play/, "play stays refused");
}

// ── a fixed host: "place 1 card from your hand under this card" (BT2-068, BT4-058 — 55 stored rows) ──
{
  const BT2_068 = "[Activate: Main] [Once per turn] Place 1 card from your hand under this card: Draw 2 cards.";
  DEFS["PU-DRAW"] = card("PU-DRAW", { colors: ["Green"], skill: BT2_068, characters: ["Draw Host"] });
  DEFS["PU-DRAWX"] = card("PU-DRAWX", { type: "EXTRA", colors: ["Green"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: BT2_068, characters: ["Draw Extra"] });

  const s = game({ hand: ["PU-XENO"], battle: ["PU-DRAW"] });
  const host = findG(s, "p1", "battle", "PU-DRAW");
  const fodder = findG(s, "p1", "hand", "PU-XENO");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered in the Battle Area with a card in hand (refusal: ${JSON.stringify(refusal(s, host))})`);
  let t = playG(s, acts[0]);
  for (let i = 0; i < 4 && t.prompt.kind === "chooseCards"; i++) {
    const p = t.prompt as unknown as { player: PlayerId; choice: { candidates: string[] } };
    t = playG(t, { type: "choose", player: p.player, cards: [p.choice.candidates.includes(fodder) ? fodder : p.choice.candidates[0]] } as Action);
  }
  assert.equal(t.prompt.kind, "main");
  assert.deepEqual(underOf(t, host), ["PU-XENO"], "the hand card went under this card (23-2)");
  assert.ok(!zoneOf(t, "p1", "hand").includes(fodder));
  assert.equal(zoneOf(t, "p1", "hand").length, 2, "and 2 cards were drawn");

  const empty = game({ hand: [], battle: ["PU-DRAW"] });
  assert.equal(activations(empty, findG(empty, "p1", "battle", "PU-DRAW")).length, 0, "an empty hand: nothing to place, not offered");

  const away = game({ hand: ["PU-DRAWX", "PU-XENO"] });
  assert.equal(activations(away, findG(away, "p1", "hand", "PU-DRAWX")).length, 0, "this card in the hand holds no pile: not offered");

  // A host given as a selector is resolved to its first match, not chosen: refused with its own reason.
  const selectorHost = { op: "moveTo", target: { var: "c0" }, to: "under", under: { sel: { side: "you", area: "battle" } } } as unknown as Op;
  const pick = { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "c0" } as Op;
  assert.match(activationPriceProblem([pick, selectorHost]) ?? "", /host the price did not choose \(selector\)/);
  assert.equal(activationPriceProblem([pick, { op: "moveTo", target: { var: "c0" }, to: "under" } as Op]), null, "no under: this card is the host");
}

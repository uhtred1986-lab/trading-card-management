/**
 * Owner decision 25 Oct 2026 (23-2, 4-3-3): an [Activate] price that places a card under a host the text fixes —
 * one that can only ever be one card — is payable. Follow-up to #1123 (`selector-host-price-1123.ts`) and #1096
 * (`place-under-price-1096.ts`).
 *
 *  - EX20-04 #20 "If your Leader Card is a mono-green <Cell> card and you place this card under your Leader Card:
 *    Draw 1 card." — price `moveTo self under {special: leader}`.
 *  - EX25-28 #10 — price `choose 1 hand as c0`, then `moveTo c0 under {special: leader}`. The printed effect is not
 *    in the repo; the wording below keeps the price as the stored row has it and gives it a plain "Draw 1 card".
 *  - Fixed hosts are `self`, `leader` and `opponentLeader` (`FIXED_UNDER_HOSTS`), each a bare special. A host given
 *    by a description, or a special with anything beside it, stays refused as a price.
 *
 * The lines are compiled from that text, not hand-built (except the refused stored shapes). Rules engine only;
 * nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, compileCostProgram, compileSkill, fifty, findG, parseSkills, rejectedActionsG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import { activationPriceProblem, isFixedUnderHost } from "../../src/lib/arena/vm/activation-price-support";
import type { Op } from "../../src/lib/arena/vm/script";

const EX20_04 = "[Activate: Main] If your Leader Card is a mono-green <Cell> card and you place this card under your Leader Card: Draw 1 card.";
const EX25_28 = "[Activate: Main] Place 1 card from your hand under your Leader Card: Draw 1 card.";
const OPP = "[Activate: Main] Place 1 card from your hand under your opponent's Leader Card: Draw 1 card.";

type Move = Extract<Op, { op: "moveTo" }>;
const priceOf = (text: string): Op[] => {
  const skill = parseSkills(text)[0]!;
  assert.deepEqual(compileSkill(skill).unsupported, [], `the line reads: ${text}`);
  const price = compileCostProgram(skill)!;
  assert.deepEqual(price.unsupported, [], `the price reads: ${text}`);
  return price.ops;
};

// ── the compiled prices: the host stays the fixed special, and the static planner accepts it ──
{
  const ex20 = priceOf(EX20_04);
  assert.deepEqual(ex20, [{ op: "moveTo", target: { sel: { special: "self" } }, to: "under", under: { sel: { special: "leader" } } }], JSON.stringify(ex20));
  assert.equal(activationPriceProblem(ex20), null, "EX20-04: this card under your Leader is payable");

  const ex25 = priceOf(EX25_28);
  assert.equal(ex25.length, 2, JSON.stringify(ex25));
  const [hand, move] = ex25 as [Extract<Op, { op: "choose" }>, Move];
  assert.equal(hand.op, "choose");
  assert.equal(hand.sel.area, "hand");
  assert.deepEqual(move, { op: "moveTo", target: { var: hand.as }, to: "under", under: { sel: { special: "leader" } } });
  assert.equal(activationPriceProblem(ex25), null, "EX25-28: a chosen hand card under your Leader is payable");

  const opp = priceOf(OPP);
  assert.deepEqual((opp[1] as Move).under, { sel: { special: "opponentLeader" } });
  assert.equal(activationPriceProblem(opp), null, "under your opponent's Leader is a fixed host too");

  const self = [hand, { ...move, under: { sel: { special: "self" } } }] as Op[];
  assert.equal(activationPriceProblem(self), null, "under this card, spelled as a special");
}

// ── refused: descriptive selectors and specials that are not one fixed card at pay time ──
{
  const hand: Op = { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "c0" };
  const under = (sel: Record<string, unknown>): Op[] => [hand, { op: "moveTo", target: { var: "c0" }, to: "under", under: { sel } } as Op];
  for (const sel of [
    { side: "you", area: "battle", filter: { names: ["spirit bomb"] } },
    { side: "you", area: "battle", count: 1 },
    { special: "leader", filter: { names: ["cell"] } },
    { special: "leader", area: "battle" },
    { special: "subject" },
    { special: "attacker" },
    { special: "onTop" },
  ]) {
    assert.match(activationPriceProblem(under(sel)) ?? "", /host the price did not choose \(selector\)/, JSON.stringify(sel));
    assert.equal(isFixedUnderHost({ sel } as never), false, JSON.stringify(sel));
  }
  // The #1123 compiled shape still turns a described host into a choice of the price.
  const bomb = priceOf("[Activate: Main] Place 1 card from your hand under a {Spirit Bomb} in your Battle Area: Draw 2 cards.");
  assert.ok(bomb.some((o) => o.op === "choose" && !!o.sel.filter?.names?.includes("spirit bomb")), "a described host is a choice");
}

// ── fixtures ──
DEFS["FH-L-CELL"] = card("FH-L-CELL", { type: "LEADER", colors: ["Green"], characters: ["Cell"], energyCost: null, comboCost: null, comboPower: null, skill: null });
DEFS["FH-L-OTHER"] = card("FH-L-OTHER", { type: "LEADER", colors: ["Green"], characters: ["Frieza"], energyCost: null, comboCost: null, comboPower: null, skill: null });
DEFS["FH-EX20"] = card("FH-EX20", { colors: ["Green"], characters: ["Cell Jr."], skill: EX20_04 });
DEFS["FH-EX25"] = card("FH-EX25", { colors: ["Green"], characters: ["Twenty-Eight"], skill: EX25_28 });
DEFS["FH-OPP"] = card("FH-OPP", { colors: ["Green"], characters: ["Opp"], skill: OPP });
DEFS["FH-FODDER"] = card("FH-FODDER", { colors: ["Green"], characters: ["Fodder"], skill: null });

/** p1's second-turn Main Phase with the named cards staged in hand and Battle Area (both start empty). */
function game(o: { leader?: string; hand?: string[]; battle?: string[] }): VmState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: o.leader ?? "FH-L-CELL", main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
const leaderOf = (s: EngineState, p: PlayerId): string => s.sides[p].zones.leader[0];
type ChoosePrompt = { player: PlayerId; choice: { candidates: string[] } };

function run(s: EngineState, action: Action, picks: string[] = []): EngineState {
  let t = IMPL.apply(CTX, s, action).state;
  for (let i = 0; i < 6 && t.prompt.kind === "chooseCards"; i++) {
    const p = t.prompt as unknown as ChoosePrompt;
    const pick = picks.find((x) => p.choice.candidates.includes(x)) ?? p.choice.candidates[0];
    t = IMPL.apply(CTX, t, { type: "choose", player: p.player, cards: [pick] } as Action).state;
  }
  return t;
}

// ── EX20-04: mono-green <Cell> Leader: offered; this card goes under the Leader and 1 card is drawn ──
{
  const s = game({ battle: ["FH-EX20"] });
  const src = findG(s, "p1", "battle", "FH-EX20");
  const acts = activations(s, src);
  assert.equal(acts.length, 1, `EX20-04 offered (refusal: ${JSON.stringify(refusal(s, src))})`);
  const t = run(s, acts[0]);
  assert.equal(t.prompt.kind, "main", "the line resolved");
  assert.deepEqual(underOf(t, leaderOf(t, "p1")), ["FH-EX20"], "this card is under the Leader (23-2)");
  assert.ok(!zoneOf(t, "p1", "battle").includes(src), "and left the Battle Area");
  assert.equal(zoneOf(t, "p1", "hand").length, 1, "1 card was drawn");
}

// ── EX20-04 without the <Cell> Leader: the condition is part of the price, so it is not offered ──
{
  const s = game({ leader: "FH-L-OTHER", battle: ["FH-EX20"] });
  const src = findG(s, "p1", "battle", "FH-EX20");
  assert.equal(activations(s, src).length, 0, "no mono-green <Cell> Leader: not offered");
  assert.equal(refusal(s, src)?.[0]?.kind, "condition", "refused on the price's condition (9-1-3)");
}

// ── EX20-04 with this card in the hand: an [Activate: Main] of a Battle Card is not used from there ──
{
  const s = game({ hand: ["FH-EX20"] });
  assert.equal(activations(s, findG(s, "p1", "hand", "FH-EX20")).length, 0, "not offered from the hand");
}

// ── EX25-28: a card in hand: offered; the payer's card goes under the Leader, and 1 card is drawn ──
{
  const s = game({ hand: ["FH-FODDER"], battle: ["FH-EX25"] });
  const src = findG(s, "p1", "battle", "FH-EX25");
  const fodder = findG(s, "p1", "hand", "FH-FODDER");
  const acts = activations(s, src);
  assert.equal(acts.length, 1, `EX25-28 offered (refusal: ${JSON.stringify(refusal(s, src))})`);
  const t = run(s, acts[0], [fodder]);
  assert.equal(t.prompt.kind, "main", "the line resolved");
  assert.deepEqual(underOf(t, leaderOf(t, "p1")), ["FH-FODDER"], "the hand card is under the Leader");
  assert.equal(t.cards[fodder].faceUp, false, "face down: nothing prints otherwise");
  assert.ok(!zoneOf(t, "p1", "hand").includes(fodder), "and left the hand");
  assert.equal(zoneOf(t, "p1", "hand").length, 1, "1 card was drawn");
  assert.ok(zoneOf(t, "p1", "battle").includes(src), "this card stays where it is");
}

// ── EX25-28: nothing in hand: not offered ──
{
  const s = game({ hand: [], battle: ["FH-EX25"] });
  const src = findG(s, "p1", "battle", "FH-EX25");
  assert.equal(activations(s, src).length, 0, "an empty hand: nothing to place, not offered");
  assert.match(String((refusal(s, src)?.[0] as { detail?: string }).detail), /cannot pay/);
}

// ── under the opponent's Leader: the card goes under that Leader ──
{
  const s = game({ hand: ["FH-FODDER"], battle: ["FH-OPP"] });
  const src = findG(s, "p1", "battle", "FH-OPP");
  const fodder = findG(s, "p1", "hand", "FH-FODDER");
  const acts = activations(s, src);
  assert.equal(acts.length, 1, `offered (refusal: ${JSON.stringify(refusal(s, src))})`);
  const t = run(s, acts[0], [fodder]);
  assert.equal(t.prompt.kind, "main");
  assert.deepEqual(underOf(t, leaderOf(t, "p2")), ["FH-FODDER"], "under the opponent's Leader");
  assert.deepEqual(underOf(t, leaderOf(t, "p1")), [], "not under yours");
}


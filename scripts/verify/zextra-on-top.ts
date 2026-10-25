/**
 * "Place a Z-Extra (or a named card) from under this card on top of this card" as an [Activate] price (owner,
 * 25 Oct 2026). Production rows BT31-005#0, BT31-004#10 and BT23-007#10 were refused ("cannot charge moveTo under a
 * host the price did not choose (selector)"): the compiler read the clause as "this card goes under <a pile card>".
 *
 * The rule (Masters rule manual): 23-2-1 a card in a Battle Area may have cards placed on top of or under it;
 * 23-2-2-2 the cards under a card are in the area of the card on top, so nothing changes area; 23-2-2-1 the pile keeps
 * its order; 21-5-2 a card placed on an existing card in the Battle Area takes over its position (Active/Rest), the
 * continuous effects on its power and whether it is in battle, and 21-5-2-1 its other effects are ignored; 5-5 a card
 * that is placed is not played.
 *
 *  - The compiler makes the pile card a choice of the price (`choose 1 <card> from under this card as cN`, then
 *    `placeOnTop cN`), so the payer picks which matching pile card when several match.
 *  - The line is offered only with a matching card in this card's pile and the rest of the price payable.
 *  - Paid: the chosen card is the top card where this card stood, in this card's mode, with its power effects and its
 *    seat in a battle; this card is directly under it, the rest of the pile after it in order.
 *  - The rest of the price (energy, discard, choose + Warp, choose two) and the effect still work; BT23-007's
 *    "place all of the chosen cards under that card" moves the two cards the price chose under the played card.
 *  - Both seats; a JSON reload between the pile question and the end of the line resolves the same.
 *
 * The lines are compiled from the printed text. Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, addEffectG, card, compileCostProgram, compileSkill, fifty, findG, leaderOf, parseSkills, powerOfG, rejectedActionsG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import type { GameEvent } from "../../src/lib/arena/types";
import { activationPriceProblem } from "../../src/lib/arena/vm/activation-price-support";
import { describeScript, type Op } from "../../src/lib/arena/vm/script";

const BT31_005 = "[activate: main/battle] [limit 1] {r}, place a Z-Extra from under this card on top of this card, then discard 1 card from your hand: Play up to 1 mono-red ≪Evil Incarnate≫ card with an energy cost of 4 or less from your Warp.";
const BT31_004 = "[activate: main/battle] [limit 1] Place 1 Z-Extra from under this card on top of this card, then choose 1 of your ≪Evil Incarnate≫ cards and send it to its owner's Warp: Your Leader gets +5000 power for the turn.";
const BT23_007 = "[Activate: Main][Limit 1] Place a {Destroyed West City} from under this card on top of this card, then choose 1 of your red <Android 17> cards and 1 of your red <Android 18> cards: Play up to 1 {Android 17 & Android 18, Domination Achieved} from your hand or Drop, then place all of the chosen cards under that card.";

// ── the compiled prices: a choice from this card's pile, then placeOnTop; the static planner accepts each ──
for (const [text, wanted] of [[BT31_005, ["choose", "placeOnTop", "discard"]], [BT31_004, ["choose", "placeOnTop", "choose", "moveTo"]], [BT23_007, ["choose", "placeOnTop", "choose", "choose"]]] as const) {
  const skill = parseSkills(text)[0]!;
  assert.deepEqual(compileSkill(skill).unsupported, [], `the line reads: ${text}`);
  const price = compileCostProgram(skill)!;
  assert.deepEqual(price.unsupported, [], "the price reads");
  assert.deepEqual(price.ops.map((o) => o.op), wanted, JSON.stringify(price.ops));
  const [pile, top] = price.ops as [Extract<Op, { op: "choose" }>, Extract<Op, { op: "placeOnTop" }>];
  assert.equal(pile.sel.area, "under", "the card comes from this card's pile");
  assert.equal(pile.sel.side, "you");
  assert.equal(pile.sel.count, 1);
  assert.ok(!pile.sel.upTo, "exactly one: no pile card, no payment");
  assert.deepEqual(top, { op: "placeOnTop", target: { var: pile.as } });
  assert.equal(activationPriceProblem(price.ops), null, "the static planner accepts the price");
  assert.match(describeScript([top]), /on top of this card, from under it/);
}
{
  const z = compileCostProgram(parseSkills(BT31_004)[0]!)!.ops[0] as Extract<Op, { op: "choose" }>;
  assert.equal(z.sel.filter?.type, "EXTRA");
  assert.equal(z.sel.filter?.z, true, "a Z-Extra: Extra and Z (17-1-2)");
  const w = compileCostProgram(parseSkills(BT23_007)[0]!)!.ops[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual(w.sel.filter?.names, ["destroyed west city"]);
  // BT23-007's effect: "all of the chosen cards" are the two the price chose, not the played card or the placed one.
  const effect = compileSkill(parseSkills(BT23_007)[0]!).ops;
  const price = compileCostProgram(parseSkills(BT23_007)[0]!)!.ops as Extract<Op, { op: "choose" }>[];
  const played = effect.find((o): o is Extract<Op, { op: "play" }> => o.op === "play")!;
  assert.ok(played && "var" in played.target);
  const unders = effect.filter((o): o is Extract<Op, { op: "moveTo" }> => o.op === "moveTo" && o.to === "under");
  assert.deepEqual(unders.map((o) => o.target), [{ var: price[2].as }, { var: price[3].as }], JSON.stringify(effect));
  for (const o of unders) assert.deepEqual(o.under, played.target, "under that card: the played card");
  // A placeOnTop of a card the price did not choose from this card's pile stays refused.
  assert.match(activationPriceProblem([{ op: "placeOnTop", target: { sel: { side: "you", area: "under", count: 1 } } }]) ?? "", /did not choose from under this card/);
  assert.match(activationPriceProblem([{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "c0" }, { op: "placeOnTop", target: { var: "c0" } }]) ?? "", /did not choose from under this card/);
}

// ── fixtures ──
const zx = (id: string, name: string) => card(id, { name, type: "Z-EXTRA", colors: ["Red"], energyCost: 1, zEnergyCost: 1, power: null, comboCost: null, comboPower: null, characters: [], skill: null });
DEFS["ZT-005"] = card("ZT-005", { colors: ["Red"], traits: ["Evil Incarnate"], characters: ["Host Five"], skill: BT31_005 });
DEFS["ZT-004"] = card("ZT-004", { colors: ["Red"], traits: ["Evil Incarnate"], characters: ["Host Four"], skill: BT31_004 });
DEFS["ZT-ZA"] = zx("ZT-ZA", "Z Alpha");
DEFS["ZT-ZB"] = zx("ZT-ZB", "Z Beta");
DEFS["ZT-PLAIN"] = card("ZT-PLAIN", { colors: ["Red"], characters: ["Plain"], skill: null });
DEFS["ZT-EI"] = card("ZT-EI", { colors: ["Red"], traits: ["Evil Incarnate"], characters: ["Fodder"], skill: null });
DEFS["ZT-EI-WARP"] = card("ZT-EI-WARP", { colors: ["Red"], energyCost: 3, traits: ["Evil Incarnate"], characters: ["Returner"], skill: null });
DEFS["ZT-RED"] = card("ZT-RED", { colors: ["Red"], characters: ["Energy"], skill: null });
DEFS["ZT-ACCEL"] = card("ZT-ACCEL", { name: "Accel Dance", type: "Z-EXTRA", colors: ["Red"], energyCost: 1, zEnergyCost: 1, power: null, comboCost: null, comboPower: null, characters: [], skill: BT23_007 });
DEFS["ZT-DWC"] = card("ZT-DWC", { name: "Destroyed West City", colors: ["Red"], characters: [], skill: null });
DEFS["ZT-A17"] = card("ZT-A17", { colors: ["Red"], characters: ["Android 17"], skill: null });
DEFS["ZT-A18"] = card("ZT-A18", { colors: ["Red"], characters: ["Android 18"], skill: null });
DEFS["ZT-DOM"] = card("ZT-DOM", { name: "Android 17 & Android 18, Domination Achieved", colors: ["Red"], energyCost: 6, characters: ["Android 17", "Android 18"], skill: null });

type Stage = { hand?: string[]; battle?: string[]; energy?: string[]; warp?: string[]; pile?: string[] };
const Z_TYPES = new Set(["ZT-ZA", "ZT-ZB", "ZT-ACCEL"]);

/** The Main Phase of `seat` (p1's second turn, or p2's second turn) with the named cards staged; the first battle card holds `pile`. */
function game(o: Stage, seat: PlayerId = "p1"): VmState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-RED", main: fifty("V1") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(CTX, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  for (const p of ["p1", "p2", "p1", ...(seat === "p2" ? ["p2"] : [])] as PlayerId[]) {
    if (r.prompt.kind !== "charge") r = IMPL.apply(CTX, r, { type: "endMain", player: p === "p1" ? "p2" : "p1" }).state as VmState;
    r = IMPL.apply(CTX, r, { type: "charge", player: p, card: null }).state as VmState;
  }
  assert.equal(r.prompt.kind, "main");
  assert.equal((r.prompt as { player: PlayerId }).player, seat, `${seat}'s Main Phase`);
  const side = r.sides[seat].zones;
  for (const area of ["hand", "battle", "energy"] as const) {
    side.deck.push(...side[area]);
    side[area] = [];
  }
  const take = (cardId: string): string => {
    const id = side.deck.find((x) => r.cards[x].cardId === "V1");
    assert.ok(id, "the deck has a filler card to relabel");
    side.deck = side.deck.filter((x) => x !== id);
    r.cards[id!].cardId = cardId;
    if (Z_TYPES.has(cardId)) r.cards[id!].zCard = true;
    return id!;
  };
  for (const area of ["hand", "battle", "energy", "warp"] as const) {
    for (const cardId of o[area] ?? []) {
      const id = take(cardId);
      side[area] = [...side[area], id];
      if (area === "battle" || area === "energy") r.cards[id].mode = "active";
    }
  }
  const host = side.battle[0];
  for (const cardId of o.pile ?? []) r.cards[host].under.push(take(cardId));
  return r;
}

const activations = (s: EngineState, id: string) => IMPL.legalActions(CTX, s).map((a) => a.action).filter((a) => a.type === "activate" && a.card === id);
const refusal = (s: EngineState, id: string) => String((rejectedActionsG(s).find((row) => row.action.type === "activate" && row.action.card === id)?.why?.[0] as { detail?: string } | undefined)?.detail);
const pileOf = (s: EngineState, id: string): string[] => s.cards[id].under.map((u) => s.cards[u].cardId);
type ChoosePrompt = { kind: string; player: PlayerId; choice: { candidates: string[] } };

/** Take the line and answer each card question with the first of `picks` on offer, reloading from JSON before every step. */
function run(s: EngineState, action: Action, picks: string[]): { t: EngineState; asked: string[][]; ev: GameEvent[] } {
  const ev: GameEvent[] = [];
  const asked: string[][] = [];
  let step = IMPL.apply(CTX, s, action);
  ev.push(...step.events);
  let t = step.state;
  for (let i = 0; i < 8 && t.prompt.kind === "chooseCards"; i++) {
    const p = t.prompt as unknown as ChoosePrompt;
    asked.push([...p.choice.candidates]);
    const pick = picks.find((x) => p.choice.candidates.includes(x)) ?? p.choice.candidates[0];
    // A JSON reload between every question and the next: the price's choices live in the saved state (#550).
    step = IMPL.apply(CTX, JSON.parse(JSON.stringify(t)) as EngineState, { type: "choose", player: p.player, cards: [pick] } as Action);
    ev.push(...step.events);
    t = step.state;
  }
  return { t, asked, ev };
}

// ── BT31-004: several Z-Extras, the payer picks; the stack turns over with mode, power and pile kept; both seats ──
for (const seat of ["p1", "p2"] as PlayerId[]) {
  for (const want of ["ZT-ZA", "ZT-ZB"]) {
    const s = game({ battle: ["ZT-004", "ZT-EI"], pile: ["ZT-ZA", "ZT-PLAIN", "ZT-ZB"] }, seat);
    const host = findG(s, seat, "battle", "ZT-004");
    const ei = findG(s, seat, "battle", "ZT-EI");
    const [za, plain, zb] = s.cards[host].under;
    const chosen = want === "ZT-ZA" ? za : zb;
    const other = want === "ZT-ZA" ? zb : za;
    s.cards[host].mode = "rest";
    addEffectG(s, [], { target: host, kind: "power", value: 3000, until: "turn", source: host });
    addEffectG(s, [], { target: host, kind: "comboPower", value: 5000, until: "turn", source: host });
    const before = powerOfG(s, leaderOf(s, seat));
    const acts = activations(s, host);
    assert.equal(acts.length, 1, `${seat}: offered with Z-Extras under this card (refusal: ${refusal(s, host)})`);
    const { t, asked, ev } = run(s, acts[0], [chosen, ei]);
    assert.equal(t.prompt.kind, "main", `${seat}: the line resolved`);
    const pileQ = asked.find((c) => c.includes(za) || c.includes(zb));
    assert.deepEqual([...(pileQ ?? [])].sort(), [za, zb].sort(), `${seat}: asked which Z-Extra, both offered, the plain pile card not`);
    const battle = zoneOf(t, seat, "battle");
    assert.equal(battle[0], chosen, `${seat}: the chosen Z-Extra stands where this card stood`);
    assert.ok(!battle.includes(host), "this card is no longer the top card");
    assert.deepEqual(t.cards[chosen].under, [host, ...[za, plain, zb].filter((x) => x !== chosen)], `${seat}: this card directly under it, the rest of the pile in its order (23-2-2-1)`);
    assert.deepEqual(t.cards[host].under, [], "this card carries no pile of its own now");
    assert.ok(!battle.includes(other) && t.cards[chosen].under.includes(other), "the other Z-Extra stays in the pile");
    assert.equal(t.cards[chosen].mode, "rest", "21-5-2: the position carries over");
    assert.ok(t.effects.some((e) => e.target === chosen && e.kind === "power" && e.value === 3000), "21-5-2: the power effect carries over");
    assert.ok(!t.effects.some((e) => e.target === host), "21-5-2-1: this card's other effects end");
    assert.ok(!t.effects.some((e) => e.target === chosen && e.kind === "comboPower"), "and are not carried to the new top card (a combo-power change is no power change)");
    assert.ok(zoneOf(t, seat, "warp").includes(ei), `${seat}: the rest of the price: the ≪Evil Incarnate≫ card went to the Warp`);
    assert.equal(powerOfG(t, leaderOf(t, seat)), before + 5000, `${seat}: the effect ran: Leader +5000`);
    assert.ok(!ev.some((e) => e.type === "move" && e.card === chosen), "5-5: placed, not played - and no card changed area (23-2-2-2)");
    assert.equal(t.cards[chosen].playedUsing, undefined);
    assert.ok(ev.some((e) => e.type === "stack" && (e as { top?: string }).top === chosen), "the stack is logged");
  }
}

// ── one Z-Extra: taken without a question ──
{
  const s = game({ battle: ["ZT-004", "ZT-EI"], pile: ["ZT-PLAIN", "ZT-ZA"] });
  const host = findG(s, "p1", "battle", "ZT-004");
  const za = s.cards[host].under[1];
  const { t, asked } = run(s, activations(s, host)[0], []);
  assert.ok(!asked.some((c) => c.includes(za)), "a forced pile card is not asked about");
  assert.equal(zoneOf(t, "p1", "battle")[0], za);
  assert.deepEqual(pileOf(t, za), ["ZT-004", "ZT-PLAIN"]);
}

// ── not offered: no Z-Extra under this card, or the rest of the price unpayable ──
{
  const none = game({ battle: ["ZT-004", "ZT-EI"], pile: ["ZT-PLAIN"] });
  const host = findG(none, "p1", "battle", "ZT-004");
  assert.equal(activations(none, host).length, 0, "no Z-Extra under this card: not offered");
  assert.match(refusal(none, host), /cannot pay/);
  const empty = game({ battle: ["ZT-004", "ZT-EI"] });
  assert.equal(activations(empty, findG(empty, "p1", "battle", "ZT-004")).length, 0, "an empty pile: not offered");
  // This card is itself ≪Evil Incarnate≫, but it is under the Z-Extra by the time the price chooses the card to
  // send to the Warp: with no other ≪Evil Incarnate≫ card the price cannot be paid whole, so it is not offered.
  const noWarp = game({ battle: ["ZT-004"], pile: ["ZT-ZA"] });
  const noWarpHost = findG(noWarp, "p1", "battle", "ZT-004");
  assert.equal(activations(noWarp, noWarpHost).length, 0, "only this card is ≪Evil Incarnate≫, and it goes under first: not offered");
  assert.match(refusal(noWarp, noWarpHost), /cannot pay/);
  const p2 = game({ battle: ["ZT-004", "ZT-EI"], pile: ["ZT-ZA"] }, "p2");
  assert.equal(activations(p2, findG(p2, "p2", "battle", "ZT-004")).length, 1, "p2's own line on p2's turn");
}

// ── BT31-005: {r}, the Z-Extra, then discard 1; the effect plays from the Warp ──
{
  const s = game({ hand: ["ZT-PLAIN"], battle: ["ZT-005"], energy: ["ZT-RED"], warp: ["ZT-EI-WARP"], pile: ["ZT-ZB"] });
  const host = findG(s, "p1", "battle", "ZT-005");
  const zb = s.cards[host].under[0];
  const returner = findG(s, "p1", "warp", "ZT-EI-WARP");
  const discard = findG(s, "p1", "hand", "ZT-PLAIN");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered with {r}, a Z-Extra and a card to discard (refusal: ${refusal(s, host)})`);
  const { t } = run(s, acts[0], [zb, discard, returner]);
  assert.equal(t.prompt.kind, "main");
  assert.equal(zoneOf(t, "p1", "battle")[0], zb, "the Z-Extra is the top card");
  assert.deepEqual(t.cards[zb].under, [host]);
  assert.ok(zoneOf(t, "p1", "drop").includes(discard), "the discard was paid");
  assert.equal(t.cards[findG(t, "p1", "energy", "ZT-RED")].mode, "rest", "{r} was paid");
  assert.ok(zoneOf(t, "p1", "battle").includes(returner), "the effect played the ≪Evil Incarnate≫ card from the Warp");
  // Without a card to discard, or without the Z-Extra, the line is not offered.
  const noHand = game({ battle: ["ZT-005"], energy: ["ZT-RED"], pile: ["ZT-ZB"] });
  assert.equal(activations(noHand, findG(noHand, "p1", "battle", "ZT-005")).length, 0, "nothing to discard: not offered");
  const noZ = game({ hand: ["ZT-PLAIN"], battle: ["ZT-005"], energy: ["ZT-RED"], pile: ["ZT-PLAIN"] });
  assert.equal(activations(noZ, findG(noZ, "p1", "battle", "ZT-005")).length, 0, "no Z-Extra in the pile: not offered");
}

// ── BT23-007: a named pile card on top; the two chosen Androids go under the played card ──
{
  const s = game({ hand: ["ZT-DOM"], battle: ["ZT-ACCEL", "ZT-A17", "ZT-A18"], pile: ["ZT-DWC"] });
  const accel = findG(s, "p1", "battle", "ZT-ACCEL");
  const a17 = findG(s, "p1", "battle", "ZT-A17");
  const a18 = findG(s, "p1", "battle", "ZT-A18");
  const dom = findG(s, "p1", "hand", "ZT-DOM");
  const dwc = s.cards[accel].under[0];
  const acts = activations(s, accel);
  assert.equal(acts.length, 1, `offered with {Destroyed West City} under this card (refusal: ${refusal(s, accel)})`);
  const { t } = run(s, acts[0], [dwc, a17, a18, dom]);
  assert.equal(t.prompt.kind, "main");
  const battle = zoneOf(t, "p1", "battle");
  assert.equal(battle[0], dwc, "{Destroyed West City} is the top card where this card stood");
  assert.deepEqual(t.cards[dwc].under, [accel], "this card (a Z-Extra) is under it, still in the Battle Area (23-2-2-2, not removed: 17-1-4)");
  assert.ok(battle.includes(dom), "the effect played {Android 17 & Android 18, Domination Achieved}");
  assert.deepEqual([...t.cards[dom].under].sort(), [a17, a18].sort(), "all of the chosen cards went under that card");
  assert.ok(!battle.includes(a17) && !battle.includes(a18));
  // Without the named card under this card, or without one of the two Androids, the line is not offered.
  const noCity = game({ hand: ["ZT-DOM"], battle: ["ZT-ACCEL", "ZT-A17", "ZT-A18"], pile: ["ZT-PLAIN"] });
  assert.equal(activations(noCity, findG(noCity, "p1", "battle", "ZT-ACCEL")).length, 0, "no {Destroyed West City} under this card: not offered");
  const no18 = game({ hand: ["ZT-DOM"], battle: ["ZT-ACCEL", "ZT-A17"], pile: ["ZT-DWC"] });
  assert.equal(activations(no18, findG(no18, "p1", "battle", "ZT-ACCEL")).length, 0, "no red <Android 18>: not offered");
}

/**
 * #1123 (owner ruling 25 Oct 2026, 23-2, 4-3-3): an [Activate] price that places a card under a host named by a
 * description — BT20-087 #20 "Place 1 card from your hand under a {Spirit Bomb} in your Battle Area: Draw 2 cards."
 * (the wording is the issue's) — is payable.
 *
 *  - The compiler makes the host a choice (`choose 1 <host> as h`, then `moveTo … under {var: h}`), so #1096's payable
 *    path and its payment planner apply unchanged.
 *  - With several matching hosts the payer chooses which; with none, or nothing in hand to place, the line is not offered.
 *  - The hand card goes under face down (no printed "face up"), as every card placed under another does.
 *  - The interpreter no longer takes the first match of a selector host: a stored record that still names its host by
 *    a selector and finds several places nothing, and the log says why.
 *
 * The line is compiled from that text, not hand-built (except the stored-record case). Rules engine only; nothing reads
 * the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, compileCostProgram, compileSkill, fifty, findG, parseSkills, rejectedActionsG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import type { EngineContext, GameEvent } from "../../src/lib/arena/types";
import { activationPriceProblem } from "../../src/lib/arena/vm/activation-price-support";
import type { CardScripts, Op } from "../../src/lib/arena/vm/script";

const BT20_087 = "[Activate: Main] Place 1 card from your hand under a {Spirit Bomb} in your Battle Area: Draw 2 cards.";

// ── the compiled price: the hand card, then the host, each a choice; the static planner accepts it ──
{
  const skill = parseSkills(BT20_087)[0]!;
  assert.deepEqual(compileSkill(skill).unsupported, [], "the line reads");
  const price = compileCostProgram(skill)!;
  assert.deepEqual(price.unsupported, []);
  const [hand, host, move] = price.ops as [Extract<Op, { op: "choose" }>, Extract<Op, { op: "choose" }>, Extract<Op, { op: "moveTo" }>];
  assert.equal(price.ops.length, 3, JSON.stringify(price.ops));
  assert.equal(hand.op, "choose");
  assert.equal(hand.sel.area, "hand");
  assert.equal(host.op, "choose");
  assert.deepEqual(host.sel.filter?.names, ["spirit bomb"], "the host is chosen among {Spirit Bomb}s");
  assert.equal(host.sel.count, 1);
  assert.ok(!host.sel.upTo, "exactly one host: no host, no payment");
  assert.deepEqual(move, { op: "moveTo", target: { var: hand.as }, to: "under", under: { var: host.as } });
  assert.equal(activationPriceProblem(price.ops), null, "the static planner accepts the price");
}

// A host the text names exactly stays as it is: no choice is added for "this card", "your Leader" or "the chosen card".
{
  const self = compileCostProgram(parseSkills("[Activate: Main] Place 1 card from your hand under this card: Draw 2 cards.")[0]!)!.ops;
  assert.equal(self.filter((o) => o.op === "choose").length, 1, "under this card: only the hand card is chosen");
  const leader = compileSkill(parseSkills("[Auto] When you play this card, place the top card of your deck under your Leader Card.")[0]!).ops;
  assert.ok(!leader.some((o) => o.op === "choose"), "under your Leader: nothing to choose");
}

// ── fixtures ──
DEFS["SH-GOKU"] = card("SH-GOKU", { colors: ["Red"], characters: ["Son Goku"], skill: BT20_087 });
DEFS["SH-BOMB-A"] = card("SH-BOMB-A", { name: "Spirit Bomb", colors: ["Red"], characters: ["Spirit Bomb"], skill: null });
DEFS["SH-BOMB-B"] = card("SH-BOMB-B", { name: "Spirit Bomb", colors: ["Red"], characters: ["Spirit Bomb"], skill: null });
DEFS["SH-FODDER"] = card("SH-FODDER", { colors: ["Red"], characters: ["Fodder"], skill: null });
DEFS["SH-OTHER"] = card("SH-OTHER", { colors: ["Red"], characters: ["Other"], skill: null });

/** p1's second-turn Main Phase with the named cards staged in hand and Battle Area (both start empty). */
function game(o: { hand?: string[]; battle?: string[] }, ctx: EngineContext = CTX): VmState {
  let r = IMPL.createGame(ctx, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(ctx, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "charge", player: "p1", card: null }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "endMain", player: "p1" }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "charge", player: "p2", card: null }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "endMain", player: "p2" }).state as VmState;
  r = IMPL.apply(ctx, r, { type: "charge", player: "p1", card: null }).state as VmState;
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

const activations = (s: EngineState, id: string, ctx: EngineContext = CTX) => IMPL.legalActions(ctx, s).map((a) => a.action).filter((a) => a.type === "activate" && a.card === id);
const refusal = (s: EngineState, id: string) => rejectedActionsG(s).find((row) => row.action.type === "activate" && row.action.card === id)?.why;
const underOf = (s: EngineState, id: string): string[] => s.cards[id].under.map((u) => s.cards[u].cardId);
type ChoosePrompt = { player: PlayerId; choice: { candidates: string[]; reason: string } };

/**
 * Take the line and answer each question with the first of `picks` that is a candidate, recording what was asked.
 * Returns the final state, the candidate lists seen, and the events.
 */
function run(s: EngineState, action: Action, picks: string[], ctx: EngineContext = CTX): { t: EngineState; asked: string[][]; ev: GameEvent[] } {
  const ev: GameEvent[] = [];
  const asked: string[][] = [];
  let step = IMPL.apply(ctx, s, action);
  ev.push(...step.events);
  let t = step.state;
  for (let i = 0; i < 6 && t.prompt.kind === "chooseCards"; i++) {
    const p = t.prompt as unknown as ChoosePrompt;
    asked.push([...p.choice.candidates]);
    const pick = picks.find((x) => p.choice.candidates.includes(x)) ?? p.choice.candidates[0];
    step = IMPL.apply(ctx, t, { type: "choose", player: p.player, cards: [pick] } as Action);
    ev.push(...step.events);
    t = step.state;
  }
  return { t, asked, ev };
}

// ── one host: offered; the host is the only candidate and is taken without a question; the card goes under it ──
{
  const s = game({ hand: ["SH-FODDER"], battle: ["SH-GOKU", "SH-BOMB-A"] });
  const goku = findG(s, "p1", "battle", "SH-GOKU");
  const bomb = findG(s, "p1", "battle", "SH-BOMB-A");
  const fodder = findG(s, "p1", "hand", "SH-FODDER");
  const acts = activations(s, goku);
  assert.equal(acts.length, 1, `offered with one {Spirit Bomb} and a card in hand (refusal: ${JSON.stringify(refusal(s, goku))})`);
  const { t, asked } = run(s, acts[0], [fodder]);
  assert.equal(t.prompt.kind, "main", "the line resolved");
  assert.ok(!asked.some((c) => c.includes(bomb)), "a forced host is not asked about");
  assert.deepEqual(underOf(t, bomb), ["SH-FODDER"], "the hand card went under the {Spirit Bomb} (23-2)");
  assert.equal(t.cards[fodder].faceUp, false, "face down: nothing prints otherwise");
  assert.ok(!zoneOf(t, "p1", "hand").includes(fodder), "and left the hand");
  assert.equal(zoneOf(t, "p1", "hand").length, 2, "2 cards were drawn");
  assert.deepEqual(underOf(t, goku), [], "nothing went under this card");
}

// ── several hosts: the payer chooses, and either answer is honoured ──
{
  const s = game({ hand: ["SH-FODDER"], battle: ["SH-GOKU", "SH-BOMB-A", "SH-BOMB-B"] });
  const goku = findG(s, "p1", "battle", "SH-GOKU");
  const a = findG(s, "p1", "battle", "SH-BOMB-A");
  const b = findG(s, "p1", "battle", "SH-BOMB-B");
  const fodder = findG(s, "p1", "hand", "SH-FODDER");
  const acts = activations(s, goku);
  assert.equal(acts.length, 1, `offered with two {Spirit Bomb}s (refusal: ${JSON.stringify(refusal(s, goku))})`);
  for (const [want, other] of [[a, b], [b, a]] as const) {
    const { t, asked } = run(s, acts[0], [fodder, want]);
    assert.ok(asked.some((c) => c.length === 2 && c.includes(a) && c.includes(b)), "the payer is asked which {Spirit Bomb}, both offered");
    assert.ok(!asked.some((c) => c.includes(goku)), "this card is no {Spirit Bomb}");
    assert.equal(t.prompt.kind, "main");
    assert.deepEqual(underOf(t, want), ["SH-FODDER"], "under the {Spirit Bomb} the payer chose");
    assert.deepEqual(underOf(t, other), [], "and not the other");
    assert.equal(zoneOf(t, "p1", "hand").length, 2, "the effect ran: 2 cards drawn");
  }
}

// ── no host: not offered ──
{
  const s = game({ hand: ["SH-FODDER"], battle: ["SH-GOKU", "SH-OTHER"] });
  const goku = findG(s, "p1", "battle", "SH-GOKU");
  assert.equal(activations(s, goku).length, 0, "no {Spirit Bomb} in the Battle Area: not offered");
  assert.equal(refusal(s, goku)?.[0]?.kind, "other");
  assert.match(String((refusal(s, goku)?.[0] as { detail?: string }).detail), /cannot pay/);
}

// ── nothing to place: not offered ──
{
  const s = game({ hand: [], battle: ["SH-GOKU", "SH-BOMB-A", "SH-BOMB-B"] });
  const goku = findG(s, "p1", "battle", "SH-GOKU");
  assert.equal(activations(s, goku).length, 0, "an empty hand: nothing to place, not offered");
  assert.match(String((refusal(s, goku)?.[0] as { detail?: string }).detail), /cannot pay/);
}

// ── the interpreter: a stored record that still names its host by a selector ──
{
  // "Place 1 card from your hand under a {Spirit Bomb} in your Battle Area." as an effect, in the shape records had
  // before #1123: the hand card chosen, the host a bare selector. Built from the compiled line with the host choice
  // taken out, so the selector is the compiler's own.
  const EFFECT = "[Activate: Main] Place 1 card from your hand under a {Spirit Bomb} in your Battle Area.";
  DEFS["SH-LEGACY"] = card("SH-LEGACY", { colors: ["Red"], characters: ["Legacy"], skill: EFFECT });
  const fresh = CTX.scripts["SH-LEGACY"] as CardScripts;
  const ops = fresh.bySkill[0].ops;
  const hostChoice = ops.find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose" && !!o.sel.filter?.names?.includes("spirit bomb"));
  assert.ok(hostChoice, `the compiled effect chooses its host too: ${JSON.stringify(ops)}`);
  const legacyOps = ops
    .filter((o) => o !== hostChoice)
    .map((o) => (o.op === "moveTo" && o.to === "under" ? { ...o, under: { sel: hostChoice.sel } } : o)) as Op[];
  const legacy: CardScripts = { ...fresh, bySkill: { ...fresh.bySkill, 0: { ...fresh.bySkill[0], ops: legacyOps } } };
  const scripts = new Proxy({} as Record<string, CardScripts>, { get: (_, key) => (key === "SH-LEGACY" ? legacy : (CTX.scripts as Record<string | symbol, CardScripts>)[key]) });
  const ctx: EngineContext = { ...CTX, scripts };

  // Two matches: nothing is placed, and the log says why.
  const s = game({ hand: ["SH-FODDER"], battle: ["SH-LEGACY", "SH-BOMB-A", "SH-BOMB-B"] }, ctx);
  const src = findG(s, "p1", "battle", "SH-LEGACY");
  const a = findG(s, "p1", "battle", "SH-BOMB-A");
  const b = findG(s, "p1", "battle", "SH-BOMB-B");
  const fodder = findG(s, "p1", "hand", "SH-FODDER");
  const acts = activations(s, src, ctx);
  assert.equal(acts.length, 1, "the stored effect line is offered (it has no price)");
  const { t, asked, ev } = run(s, acts[0], [fodder], ctx);
  assert.ok(!asked.some((c) => c.includes(a)), "the record asks no host question");
  assert.equal(t.prompt.kind, "main");
  assert.deepEqual(underOf(t, a), [], "not under the first match");
  assert.deepEqual(underOf(t, b), [], "nor under the second");
  assert.ok(zoneOf(t, "p1", "hand").includes(fodder), "the card stayed in the hand");
  assert.ok(ev.some((e) => e.type === "note" && /2 cards match the card to place under/.test(String((e as { text?: string }).text))), "and the log says why");

  // One match: the selector names one card, so the move happens as before.
  const one = game({ hand: ["SH-FODDER"], battle: ["SH-LEGACY", "SH-BOMB-A"] }, ctx);
  const only = findG(one, "p1", "battle", "SH-BOMB-A");
  const r = run(one, activations(one, findG(one, "p1", "battle", "SH-LEGACY"), ctx)[0], [findG(one, "p1", "hand", "SH-FODDER")], ctx);
  assert.deepEqual(underOf(r.t, only), ["SH-FODDER"], "a selector host with one match is that card");

  // The same stored shape as a price stays refused by the static planner (#1096), so it is never offered.
  const price = [{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "c0" }, legacyOps.find((o) => o.op === "moveTo")!] as Op[];
  assert.match(activationPriceProblem(price) ?? "", /host the price did not choose \(selector\)/);
}


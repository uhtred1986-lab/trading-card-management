/**
 * #926: the action a keyword move prints before its colon is a **cost** —
 * printed text -> compile -> stored-row JSON round-trip -> the real VM.
 *
 * [Union-Fusion] (BT25-060 "Draw 1 card", BT11-013 "{r}{r}{r}, draw 2 cards"),
 * [Union-Potara] (BT26-084 "{g} if your Leader is a green <Zamasu> card, you
 * draw 1 card, and place the top card of your opponent's deck into its
 * owner's Drop", BT20-125 "Choose up to 1 of your opponent's Battle Cards,
 * send it to its owner's Warp, and draw 1 card") and [EX-Evolve] (BT13-024
 * "{r}{r}{r}, draw 1 card", official card list). Each is offered only while
 * it can be paid in full (5-8-3), the price is paid at activation and in
 * full (5-8-2-2) — Fusion's after its materials are in the Drop
 * (22-13-4-4-1) — and the line is announced once it is. Both seats; every
 * step through a JSON reload; a price paid in part fails the activation
 * (5-8-4); a price the compiler cannot read stays an honest `unread`.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { correctSkillText } from "../../src/lib/catalog/errata";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the cards, as printed ────────────────────────────────────────────────────
// Union texts: the catalog rows of docs/arena-backlog/evidence/923/inventory.json.
// BT13-024: the official card list (dbs-cardgame.com, 16 Oct 2026), three red orbs.
const PRINTED: Record<string, { name: string; colors: Color[]; characters: string[]; power: number; skill: string }> = {
  "BT25-060": { name: "Gotenks, Energy Storm Release", colors: ["Blue"], characters: ["Gotenks"], power: 25000,
    skill: "[Deflect]\n[br]\n[Union-Fusion][Limit 1] Draw 1 card: Blue <Son Goten> card and blue <Trunks: Youth> card.\n[br]\n[Auto] If your Leader is a blue <Gotenks> card: When this card attacks, use up to 1 blue card with 5000 combo power from your Drop in a combo with its skills negated for the turn." },
  "BT11-013": { name: "Gogeta, Fusion of the Gods", colors: ["Red"], characters: ["Gogeta: Br"], power: 35000,
    skill: "[deflect]<br>[union-fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and red <Vegeta: Br>.<br>[permanent] This card can't be KO'd.<br>[auto] If your Leader Card is red: When this card is played, choose up to 1 of your red Unison Cards, add a marker to it, then choose all of your opponent's Battle Cards and they get -15000 power for the turn." },
  "BT26-084": { name: "Fused Zamasu, Ideal World Creation", colors: ["Green"], characters: ["Zamasu"], power: 30000,
    skill: "[Indestructible]\n[br]\n[Union-Potara]{g} if your Leader is a green <Zamasu> card, you draw 1 card, and place the top card of your opponent's deck into its owner's Drop: Green <Zamasu> card and green <Goku Black> card.\n[br]\n[Auto] Place 1 card from under this card into its owner's Drop: When this card attacks, choose up to 1 of your opponent's Battle Cards with an energy cost of 5 or less and KO it, then choose up to 1 of your opponent's Unisons and remove 1 marker from it." },
  "BT20-125": { name: "SSB Vegito, Supreme Gleaming", colors: ["Black"], characters: ["Vegito"], power: 30000,
    skill: "[Barrier][Blocker]<br>[Union-Potara] Choose up to 1 of your opponent's Battle Cards, send it to its owner's Warp, and draw 1 card: &lt;Son Goku&gt; and &lt;Vegeta&gt;.<br>[Permanent] This card is played from your hand in your opponent's Battle Area, and when choosing cards to use with this card's [Union] skill from your hand, you can choose Battle Cards you own in your opponent's Battle Area.<br>[Auto] If your life is at 4 or more and your opponent's Leader is a black &lt;Cumber&gt; card: When this card is played, for the turn, if your opponent's &lt;Evil Saiyan&gt; or &lt;Cumber&gt; card—both black and with an energy cost of 8—is attacking and in a battle, you can't activate [Counter] skills." },
  "BT13-024": { name: "SS Broly, Brawn Amplified", colors: ["Red"], characters: ["Broly: Br"], power: 30000,
    skill: "[Deflect][Barrier]<br>[EX-Evolve]{r}{r}{r}, draw 1 card: Red <Broly: Br> with an energy cost of 3.<br>[Permanent] This card can't be played from any area with non-[Evolve] skills.<br>[Auto][Once per turn] If this card is in Rest Mode: When your opponent attacks a Leader Card, they reveal their hand. Choose up to 1 card from it and send it to their Warp. At the end of the turn, return the card sent to the Warp by this skill to its owner's hand." },
  "BT31-149": { name: "SS Gogeta, Hell-Piercing Flash", colors: ["Red"], characters: ["Gogeta"], power: 35000,
    skill: "[ultimate] [barrier] [triple attack]\n[br]\n[union-fusion] {1}, if your opponent has 3 or more energy and your draw 3 cards: <Son Goku> card and <Vegeta> card.\n[br]\n[auto] When this card is played, choose all of your opponent's Battle Cards and Unisons, ignoring [barrier], and they get -25000 power for the turn.\n[br]\n[auto] When your opponent's card is played, choose up to 1 of your opponent's cards, ignoring [barrier], and it gets -10000 power for the turn." },
};
const mat = (id: string, colors: Color[], characters: string[], power = 10000, energyCost = 1) => card(id, { colors, characters, power, energyCost, skill: null });
const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(Object.entries(PRINTED).map(([id, p]) => [id, card(id, { ...p, energyCost: 5, traits: ["Saiyan"] })])),
  "LZAM926": card("LZAM926", { type: "LEADER", colors: ["Green"], characters: ["Zamasu"], energyCost: null, comboCost: null, comboPower: null, skill: null }),
  "G926": mat("G926", ["Green"], ["Filler"]), "B926": mat("B926", ["Blue"], ["Filler"]),
  "SECRET926": mat("SECRET926", ["Red"], ["Secret"]),
  "GOTEN926": mat("GOTEN926", ["Blue"], ["Son Goten"]), "TRUNKS926": mat("TRUNKS926", ["Blue"], ["Trunks: Youth"]),
  "GOKUBR926": mat("GOKUBR926", ["Red"], ["Son Goku: Br"]), "VEGBR926": mat("VEGBR926", ["Red"], ["Vegeta: Br"]),
  "ZAM926": mat("ZAM926", ["Green"], ["Zamasu"]), "BLACK926": mat("BLACK926", ["Green"], ["Goku Black"]),
  "GOKU926": mat("GOKU926", ["Black"], ["Son Goku"]), "VEG926": mat("VEG926", ["Black"], ["Vegeta"]),
  "BROLY926": mat("BROLY926", ["Red"], ["Broly: Br"], 15000, 3), "BROLY2926": mat("BROLY2926", ["Red"], ["Broly: Br"], 15000, 2),
};
defs.FIXED926 = { ...defs["BT31-149"], id: "FIXED926", skill: correctSkillText("BT31-149", PRINTED["BT31-149"].skill) };
assert.match(defs.FIXED926.skill!, /and you draw 3 cards:/, "errata.ts corrects BT31-149's 'your draw 3 cards'");
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── 1. the reading: the price before the colon is a program, condition kept ──
const priceOf = (id: string) => skillRecords(defs[id]).find((r) => r.kind === "keyword" && r.cost?.text)!.cost!;
const ops = (id: string) => priceOf(id).program?.map((o) => o.op);
assert.deepEqual(priceOf("BT25-060").program, [{ op: "draw", n: 1 }], "BT25-060: Draw 1 card");
assert.deepEqual(priceOf("BT11-013").program, [{ op: "draw", n: 2 }], "BT11-013: draw 2 cards");
assert.deepEqual(priceOf("BT11-013").orbs, { Red: 3 }, "…beside {r}{r}{r}");
assert.deepEqual(priceOf("BT13-024").program, [{ op: "draw", n: 1 }], "BT13-024: draw 1 card");
assert.deepEqual(priceOf("BT13-024").orbs, { Red: 3 });
assert.deepEqual(ops("BT26-084"), ["draw", "mill"], "BT26-084: the draw is not swallowed by the Leader description");
assert.equal(priceOf("BT26-084").condition?.kind, "leaderMatches", "…and the Leader condition is kept");
assert.deepEqual(ops("BT20-125"), ["choose", "moveTo", "draw"], "BT20-125: send up to 1 to the Warp, and draw");
assert.equal(priceOf("BT31-149").program, null, "BT31-149's misprinted 'your draw 3 cards' is no program…");
assert.equal(priceOf("BT31-149").condition, null, "…and never its condition alone, which would be a free draw-less Fusion");
assert.deepEqual(priceOf("FIXED926").program, [{ op: "draw", n: 3 }], "corrected, it reads: draw 3 cards…");
assert.equal(priceOf("FIXED926").condition?.kind, "count", "…with its opponent-energy condition");
// The comma guard is shared with every printed [Activate] price: an action
// after a comma was swallowed by the Leader description before it, and the
// line was charged in part (EX23-11: the hand card never went to the deck;
// BT30-130: the discard was skipped) or not at all (BT23-132: its reveal and
// discard dropped, the condition alone asked — now an honest unread).
{
  const price = (skill: string) => skillRecords(card("PIN926", { skill }))[0].cost!;
  const ex2311 = price("[activate: main][limit 1] If your Leader is {Miracle Strike Gogeta} or {SSB Gogeta, Miraculous Strongest Warrior}, you place 1 card from your hand at the bottom of your deck, and you remove this card from the game: Add up to 1 <Son Goku> card and 1 <Vegeta> card―both blue and with 20000 power―from among all cards in your deck and Drop to your hand, shuffle your deck if you looked through it.");
  assert.deepEqual(ex2311.program?.map((o) => o.op), ["choose", "moveTo", "moveTo"], "EX23-11: the hand card to the deck's bottom, then this card removed");
  assert.equal(ex2311.condition?.kind, "any", "…behind its Leader condition");
  const bt30130 = price("[activate: main] [limit 1] If your Leader is a white <Pan> card, you discard 1 card from your hand, and you switch this card to Hidden Mode: Draw 1 card.");
  assert.deepEqual(bt30130.program?.map((o) => o.op), ["discard", "hidden"], "BT30-130: the discard is charged too");
  const bt23132 = price("[Activate: Main][Limit 1] If your Leader is a ≪Universe 6≫ card, you reveal 1 <Kefla> card from your hand, and discard another card from your hand: Draw 1 card.");
  assert.equal(bt23132.program, null, "BT23-132: a reveal-and-discard the compiler cannot read is no program…");
  assert.equal(bt23132.condition, null, "…and not its Leader condition alone");
}
for (const id of Object.keys(PRINTED)) {
  const line = skillRecords(defs[id]).find((r) => r.kind === "keyword" && r.cost?.text)!;
  assert.deepEqual(line.unread, [], `${id}: the keyword's own line has no effect clause to leave unread`);
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): { s: VmState; ev: GameEvent[] } {
  const r = RULES.apply(ctx, roundtrip(s), action);
  return { s: roundtrip(r.state as VmState), ev: r.events };
}
/** `seat`'s first Main Phase, with both hands and energy areas emptied back into the decks. */
function fresh(seat: PlayerId, leader = "L-RED", seed = 926): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action).s;
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  // The second player's opening energy marker would pay an orb; the boards count energy exactly.
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
/** Leave exactly `n` cards in `p`'s deck (the rest to the Warp), the top one `top` when given. */
function deckOf(s: VmState, p: PlayerId, n: number, top?: string): void {
  for (const id of s.sides[p].zones.deck.slice(n)) assert.ok(moveCard(s, game, id, "warp", { owner: p }).ok);
  if (top && n) s.cards[s.sides[p].zones.deck[0]].cardId = top;
}
const keywordIndex = (id: string) => parseSkills(defs[id].skill!).find((sk) => sk.kind === "keyword" && (sk.keyword?.name === "Union" || sk.keyword?.name === "Evolve"))!.index;
const isMove = (s: VmState, card: string) => (a: Action) => a.type === "activate" && a.card === card && a.skill === keywordIndex(s.cards[card].cardId);
const offer = (s: VmState, card: string) => RULES.legalActions(ctx, s).find((l) => isMove(s, card)(l.action));
const refusal = (s: VmState, card: string) => RULES.rejectedActions(ctx, s, RULES.legalActions(ctx, s)).find((r) => isMove(s, card)(r.action))?.why ?? [];
const forged = (s: VmState, seat: PlayerId, card: string) => ({ type: "activate", player: seat, card, skill: keywordIndex(s.cards[card].cardId) } as Action);
const count = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area].length;
/** The keyword line's own `skill` event (9-6) — not a later [Auto] of the same card. */
const announced = (e: GameEvent, card: string) => e.type === "skill" && (e as { card: string }).card === card && /\[(?:union|ex-evolve)/i.test((e as { text: string }).text);
const skillAt = (ev: GameEvent[], card: string) => ev.findIndex((e) => announced(e, card));
const firstDraw = (ev: GameEvent[]) => ev.findIndex((e) => e.type === "draw");
const view = (s: VmState, viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 926, revision: 1, mode: "versus", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));

/** Declare the move and answer every prompt it raises with `pick` (default: the first `min` candidates), collecting the events. */
function resolve(s: VmState, seat: PlayerId, card: string, pick: (s: VmState) => string[] | undefined = () => undefined): { s: VmState; ev: GameEvent[]; prompts: string[] } {
  const o = offer(s, card); assert.ok(o, `${s.cards[card].cardId} is offered`);
  let r = take(s, o.action);
  const ev = [...r.ev]; const prompts: string[] = [];
  for (let i = 0; i < 12 && r.s.prompt.kind !== "main"; i++) {
    const q = r.s.prompt;
    prompts.push(q.kind === "chooseCards" ? q.choice.reason : q.kind);
    if (q.kind === "payCost") r = take(r.s, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "chooseCards") r = take(r.s, { type: "choose", player: q.player, cards: pick(r.s) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") r = take(r.s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else r = take(r.s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
    ev.push(...r.ev);
  }
  assert.equal(r.s.prompt.kind, "main", `${s.cards[card].cardId} resolves back to the Main Phase`);
  return { s: r.s, ev, prompts };
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // 2. BT11-013: {r}{r}{r} and draw 2 — energy and the draw both charged, after the materials.
  {
    const board = (energy: number, deck: number) => {
      const s = fresh(seat);
      const fus = stage(s, seat, "BT11-013", "hand");
      const goku = stage(s, seat, "GOKUBR926", "hand"), veg = stage(s, seat, "VEGBR926", "hand");
      // A second <Son Goku: Br>, so the material choice is a real question.
      const spare = stage(s, seat, "GOKUBR926", "hand");
      for (let i = 0; i < energy; i++) stage(s, seat, "V1", "energy");
      deckOf(s, seat, deck, "SECRET926");
      return { s, fus, goku, veg, spare };
    };
    const ok = board(3, 10);
    assert.ok(offer(ok.s, ok.fus), `${seat}: BT11-013 offered with RRR and a deck to draw 2 from`);
    const short = board(2, 10);
    assert.equal(offer(short.s, short.fus), undefined, "two energy cannot pay {r}{r}{r}");
    const thin = board(3, 1);
    assert.equal(offer(thin.s, thin.fus), undefined, "5-8-3: one card in the deck cannot pay 'draw 2 cards'");
    assert.deepEqual(refusal(thin.s, thin.fus), [{ kind: "other", detail: "its skill cost cannot be paid in full" }]);
    assert.throws(() => RULES.apply(ctx, roundtrip(thin.s), forged(thin.s, seat, thin.fus)), IllegalAction, "a forged declaration is refused with nothing paid");
    assert.ok(offer(board(3, 2).s, board(3, 2).fus), "exactly two cards can pay it");

    const deck = count(ok.s, seat, "deck"), drop = count(ok.s, seat, "drop");
    // The old energy-at-declaration expectation was disproved by official manual
    // ver4 §22-13-4-4/-4-1 (19 Oct #907 source receipt): materials precede all remaining cost.
    const declared = take(ok.s, offer(ok.s, ok.fus)!.action);
    let mid = declared.s;
    if (mid.prompt.kind === "payCost") mid = take(mid, { type: "payCost", player: seat, option: 0 } as Action).s;
    assert.equal(mid.prompt.kind, "chooseCards", "the material choice comes first (22-13-4-2)");
    assert.equal(count(mid, seat, "deck"), deck, "no card drawn before the materials are in the Drop");
    assert.equal(skillAt(declared.ev, ok.fus), -1, "the skill is not announced before its price is paid");
    assert.equal(mid.sides[seat].zones.energy.filter((id) => mid.cards[id].mode === "rest").length, 0, "{r}{r}{r} remains unpaid until materials are placed");
    const pair = (t: VmState) => t.prompt.kind === "chooseCards" ? [ok.goku, ok.veg].filter((id) => t.prompt.kind === "chooseCards" && t.prompt.choice.candidates.includes(id)).slice(0, Math.max(1, t.prompt.choice.min)) : undefined;
    const done = resolve(ok.s, seat, ok.fus, pair);
    assert.ok(done.s.sides[seat].zones.battle.includes(ok.fus), "Gogeta is played");
    assert.ok([ok.goku, ok.veg].every((id) => done.s.sides[seat].zones.drop.includes(id)), "the materials are in the Drop");
    assert.equal(count(done.s, seat, "drop"), drop + 2);
    assert.equal(count(done.s, seat, "deck"), deck - 2, "draw 2: two cards off the deck…");
    assert.equal(count(done.s, seat, "hand"), 1 + 2, "…into a hand that held the Fusion, its materials and a spare");
    const drew = firstDraw(done.ev), dropped = done.ev.findIndex((e) => e.type === "move" && (e as { card: string }).card === ok.goku);
    assert.ok(dropped >= 0 && drew > dropped, "22-13-4-4-1: the draw is paid after the materials are placed in the Drop");
    assert.ok(skillAt(done.ev, ok.fus) > drew, "announced once the whole price is paid");
    assert.equal(done.ev.filter((e) => announced(e, ok.fus)).length, 1, "announced once");
    // Privacy: the drawn card is the drawer's to see.
    assert.ok(done.s.sides[seat].zones.hand.some((id) => done.s.cards[id].cardId === "SECRET926"));
    assert.ok(view(done.s, seat).includes("SECRET926"), "the drawer sees the card drawn as a cost");
    assert.ok(!view(done.s, foe).includes("SECRET926"), "the opponent does not");

    // 5-8-4: a price that can no longer be paid when its turn comes fails the
    // activation — materials stay paid, no draw, no play, no announcement.
    let gone = declared.s;
    if (gone.prompt.kind === "payCost") gone = take(gone, { type: "payCost", player: seat, option: 0 } as Action).s;
    deckOf(gone, seat, 1);
    let failed = take(gone, { type: "choose", player: seat, cards: pair(gone)! });
    const failEv = [...failed.ev];
    for (let i = 0; i < 4 && failed.s.prompt.kind === "chooseCards"; i++) { failed = take(failed.s, { type: "choose", player: seat, cards: pair(failed.s)! }); failEv.push(...failed.ev); }
    assert.equal(failed.s.prompt.kind, "main");
    assert.ok(failed.s.sides[seat].zones.hand.includes(ok.fus), "5-8-4: the Fusion is not played");
    assert.ok([ok.goku, ok.veg].every((id) => failed.s.sides[seat].zones.drop.includes(id)), "what was paid stays paid");
    assert.equal(count(failed.s, seat, "deck"), 1, "a draw that cannot be paid in full is not paid in part");
    assert.equal(skillAt(failEv, ok.fus), -1, "a failed activation is never announced");
  }

  // 3. BT25-060: no orbs, "Draw 1 card", [Limit 1].
  {
    const s = fresh(seat, seat === "p1" ? "L-RED" : "L-BLUE", 9261);
    const first = stage(s, seat, "BT25-060", "hand"), second = stage(s, seat, "BT25-060", "hand");
    for (let i = 0; i < 2; i++) { stage(s, seat, "GOTEN926", "hand"); stage(s, seat, "TRUNKS926", "hand"); }
    const empty = roundtrip(s); deckOf(empty, seat, 0);
    assert.equal(offer(empty, first), undefined, "an empty deck cannot pay 'Draw 1 card'");
    assert.deepEqual(refusal(empty, first), [{ kind: "other", detail: "its skill cost cannot be paid in full" }]);
    const deck = count(s, seat, "deck"), hand = count(s, seat, "hand");
    assert.ok(offer(s, first) && offer(s, second), "both copies are offered before either is used");
    const done = resolve(s, seat, first);
    assert.ok(done.s.sides[seat].zones.battle.includes(first));
    assert.equal(count(done.s, seat, "deck"), deck - 1, "one card drawn as the cost");
    assert.equal(count(done.s, seat, "hand"), hand - 3 + 1, "Fusion and two materials out, one card in");
    assert.equal(offer(done.s, second), undefined, "[Limit 1]: the second copy's [Union-Fusion] is spent with the first");
  }

  // 4. BT26-084: [Union-Potara]{g}, Leader condition, draw 1 and mill the opponent's top card.
  {
    const board = (leader: string, foeDeck?: number) => {
      const s = fresh(seat, leader, 9262);
      const pot = stage(s, seat, "BT26-084", "hand");
      const zam = stage(s, seat, "ZAM926", "battle"), black = stage(s, seat, "BLACK926", "battle");
      stage(s, seat, "G926", "energy");
      if (foeDeck !== undefined) deckOf(s, foe, foeDeck);
      return { s, pot, zam, black };
    };
    const b = board("LZAM926");
    assert.ok(offer(b.s, b.pot), `${seat}: offered under a green <Zamasu> Leader`);
    const wrong = board("L-RED");
    assert.equal(offer(wrong.s, wrong.pot), undefined, "the Leader condition is asked");
    assert.deepEqual(refusal(wrong.s, wrong.pot).map((r) => r.kind), ["condition"]);
    const bare = board("LZAM926", 0);
    assert.equal(offer(bare.s, bare.pot), undefined, "the opponent's top card must be there to place in their Drop");
    const deck = count(b.s, seat, "deck"), foeDeck = count(b.s, foe, "deck"), foeDrop = count(b.s, foe, "drop");
    const top = b.s.sides[foe].zones.deck[0];
    const done = resolve(b.s, seat, b.pot);
    assert.ok(done.s.sides[seat].zones.battle.includes(b.pot), "Potara played");
    assert.deepEqual([...done.s.cards[b.pot].under].sort(), [b.zam, b.black].sort(), "on top of both named cards");
    assert.equal(count(done.s, seat, "deck"), deck - 1, "you draw 1 card");
    assert.equal(count(done.s, seat, "hand"), 1);
    assert.equal(count(done.s, foe, "deck"), foeDeck - 1);
    assert.equal(count(done.s, foe, "drop"), foeDrop + 1);
    assert.ok(done.s.sides[foe].zones.drop.includes(top), "their top card is in their Drop");
    assert.ok(skillAt(done.ev, b.pot) > firstDraw(done.ev), "announced once paid");
  }

  // 5. BT20-125: "Choose up to 1 of your opponent's Battle Cards, send it to
  //    its owner's Warp, and draw 1 card" — a question inside the price,
  //    answered through a reload, before the Potara's own choices.
  {
    const s = fresh(seat, seat === "p1" ? "L-RED" : "L-BLUE", 9263);
    const pot = stage(s, seat, "BT20-125", "hand");
    stage(s, seat, "GOKU926", "battle"); stage(s, seat, "VEG926", "battle");
    const victim = stage(s, foe, "V1", "battle");
    const deck = count(s, seat, "deck");
    const declared = take(s, offer(s, pot)!.action).s;
    assert.equal(declared.prompt.kind, "chooseCards", "the price asks first (22-13-5-2)");
    if (declared.prompt.kind !== "chooseCards") throw new Error();
    assert.deepEqual(declared.prompt.choice.candidates, [victim], "only the opponent's Battle Cards");
    assert.equal(declared.prompt.choice.min, 0, "up to 1");
    assert.equal(count(declared, seat, "deck"), deck, "nothing drawn while the price waits");
    const reloaded = roundtrip(declared);
    assert.throws(() => RULES.apply(ctx, roundtrip(reloaded), { type: "choose", player: seat, cards: [pot] }), IllegalAction, "a forged answer outside the price's choice is refused");
    const paid = take(reloaded, { type: "choose", player: seat, cards: [victim] });
    assert.ok(paid.s.sides[foe].zones.warp.includes(victim), "sent to its owner's Warp");
    assert.equal(count(paid.s, seat, "deck"), deck - 1, "and 1 card drawn");
    let t = paid; for (let i = 0; i < 6 && t.s.prompt.kind !== "main"; i++) { const q = t.s.prompt; t = take(t.s, q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, 1) } : { type: "pass", player: (q as { player: PlayerId }).player } as Action); }
    assert.equal(t.s.prompt.kind, "main");
    assert.equal(findZone(t.s, pot), "battle", "Potara played once the price is paid");
    // Declining the optional half still pays the draw.
    const declined = take(roundtrip(declared), { type: "choose", player: seat, cards: [] });
    assert.ok(declined.s.sides[foe].zones.battle.includes(victim));
    assert.equal(count(declined.s, seat, "deck"), deck - 1, "'up to 1' may choose none; the draw is still owed and paid");
  }

  // 6. BT13-024: [EX-Evolve]{r}{r}{r}, draw 1 card, onto a red <Broly: Br> with an energy cost of 3.
  {
    const board = (energy: number, deck: number, base = "BROLY926") => {
      const s = fresh(seat, "L-RED", 9264);
      const evo = stage(s, seat, "BT13-024", "hand");
      const b = stage(s, seat, base, "battle");
      for (let i = 0; i < energy; i++) stage(s, seat, "V1", "energy");
      deckOf(s, seat, deck, "SECRET926");
      return { s, evo, base: b };
    };
    const ok = board(3, 5);
    assert.ok(offer(ok.s, ok.evo), `${seat}: EX-Evolve offered with RRR, a deck and a valid base`);
    assert.equal(offer(board(2, 5).s, board(2, 5).evo), undefined, "fewer than three energy cannot pay {r}{r}{r}");
    const empty = board(3, 0);
    assert.equal(offer(empty.s, empty.evo), undefined, "an empty deck cannot pay 'draw 1 card' (5-8-3)");
    assert.deepEqual(refusal(empty.s, empty.evo), [{ kind: "other", detail: "its skill cost cannot be paid in full" }]);
    assert.equal(offer(board(3, 5, "BROLY2926").s, board(3, 5, "BROLY2926").evo), undefined, "a cost-2 <Broly: Br> is no base");
    const deck = count(ok.s, seat, "deck");
    const done = resolve(ok.s, seat, ok.evo);
    assert.ok(done.s.sides[seat].zones.battle.includes(ok.evo), "evolved");
    assert.ok(done.s.cards[ok.evo].under.includes(ok.base), "on top of the base");
    assert.equal(count(done.s, seat, "deck"), deck - 1, "draw 1 paid");
    assert.deepEqual(done.s.sides[seat].zones.hand.map((id) => done.s.cards[id].cardId), ["SECRET926"], "the hand is the drawn card");
    assert.equal(done.s.sides[seat].zones.energy.filter((id) => done.s.cards[id].mode === "rest").length, 3, "{r}{r}{r} paid");
    assert.ok(skillAt(done.ev, ok.evo) > firstDraw(done.ev), "announced once the price is paid");
    assert.ok(!view(done.s, foe).includes("SECRET926"), "the drawn card stays private");
  }

  // 7. BT31-149: a price the compiler cannot read is refused as unread — never free.
  {
    const s = fresh(seat, "L-RED", 9265);
    const gog = stage(s, seat, "BT31-149", "hand");
    stage(s, seat, "GOKU926", "hand"); stage(s, seat, "VEG926", "hand");
    for (let i = 0; i < 3; i++) { stage(s, seat, "V1", "energy"); stage(s, foe, "V-BLUE", "energy"); }
    assert.equal(offer(s, gog), undefined, "BT31-149 is not offered");
    // #1071: a keyword record the compiler could not read whole is blocked, and a blocked record is no activation line at
    // all (`recordedSkillIdentity`), so it has no refusal to list; what must hold is that it is never offered and
    // that declaring the activation anyway is refused rather than charged for part of its price.
    assert.deepEqual(refusal(s, gog), [], "a blocked keyword record lists no per-line refusal");
    for (const skill of [0, 10, 20]) assert.throws(() => take(s, { type: "activate", player: seat, card: gog, skill }), "declaring the unread activation anyway is refused");
    // …and its catalog typo is corrected on the way in (errata.ts, official card list):
    // "{1}, if your opponent has 3 or more energy and you draw 3 cards".
    const board = (foeEnergy: number, deck: number) => {
      const t = fresh(seat, "L-RED", 9266);
      const fixed = stage(t, seat, "FIXED926", "hand");
      const goku = stage(t, seat, "GOKU926", "hand"), veg = stage(t, seat, "VEG926", "hand");
      stage(t, seat, "V1", "energy");
      for (let i = 0; i < foeEnergy; i++) stage(t, foe, "V-BLUE", "energy");
      deckOf(t, seat, deck);
      return { t, fixed, goku, veg };
    };
    const yes = board(3, 4);
    assert.ok(offer(yes.t, yes.fixed), "corrected: offered with the condition met and cards to draw three");
    assert.deepEqual(refusal(board(2, 3).t, board(2, 3).fixed).map((r) => r.kind), ["condition"], "the opponent's energy is asked");
    assert.equal(offer(board(3, 2).t, board(3, 2).fixed), undefined, "two cards cannot pay 'draw 3 cards'");
    assert.ok(offer(board(3, 3).t, board(3, 3).fixed), "exactly three can (the empty deck then loses the game by rule, 21-2-2-2)");
    const done = resolve(yes.t, seat, yes.fixed);
    assert.ok(done.s.sides[seat].zones.battle.includes(yes.fixed));
    assert.equal(count(done.s, seat, "deck"), 1, "all three drawn");
    assert.equal(count(done.s, seat, "hand"), 3);
  }
}

function findZone(s: VmState, id: string): string | undefined {
  for (const side of Object.values(s.sides)) for (const [zone, ids] of Object.entries(side.zones)) if (ids.includes(id)) return zone;
  return undefined;
}

console.log("keyword-action-costs-926: Union-Fusion (draw; draw + RRR), Union-Potara (draw + mill; send + draw), EX-Evolve (RRR + draw) — reading, stored rows, offer only when payable, paid after the materials, 5-8-4 failure, Limit, reload, privacy, both seats passed");

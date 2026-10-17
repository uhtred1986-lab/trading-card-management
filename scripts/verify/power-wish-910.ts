/**
 * #910 (remaining supporting effects of the ≪Power Wish≫ deck, EX24) and the
 * gaps #961 exposed in it: printed text -> compile -> stored-row JSON ->
 * the real VM, per card, on both seats.
 *
 *  - EX24-04  "{1}, if your Leader is a ≪Power Wish≫ card, you have 3 or more
 *             energy, and neither you nor your opponent have a Battle Card in
 *             play: Play this card from your hand."
 *  - EX24-08 / EX24-13  "If your Leader is a ≪Power Wish≫ card and you add this
 *             card and 1 non-<Oolong> (resp. non-<Cheelai: Br>) ≪Power Wish≫
 *             card from your hand to your Z-Energy: Draw 2 cards."
 *  - EX24-03  "…you add this card in your hand to your Z-Energy: During this
 *             turn, ignore the specified costs on ≪Shenron≫ Z-Unisons in your Z-Deck."
 *  - EX24-01 (back)  "[Auto][Once per turn] When your ≪Shenron≫ Z-Unison leaves
 *             the Unison Area, add up to 1 ≪Power Wish≫ card from your deck to
 *             your hand for every 1 specified cost on that card, then shuffle."
 *  - EX24-10  "…choose 1 of your Battle Cards whose owner is your opponent:
 *             Play this card from your hand on top of the chosen card in Active Mode."
 *
 * Printed text: the official card list (dbs-cardgame.com/us-en/cardlist, 17 Oct
 * 2026). The official Q&A (card_faq.php) answers EX24-03 (the energy cost of an
 * affected Z-Unison is the X of its ignored specified cost, any number 0 or
 * more), EX24-08/13 (the Activate only works from the hand) and EX24-09/04;
 * errata-cards.php lists none of these cards. Costs are mandatory (5-8-2) and
 * checked for payability before the skill is offered (5-8-3).
 */
import assert from "node:assert/strict";
import shenron from "./fixtures/shenron-910.json";
import wish from "./fixtures/power-wish-910.json";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the cards, as printed ────────────────────────────────────────────────────
const printed = [...(shenron as CardDef[]), ...(wish as CardDef[])];
const defs: Record<string, CardDef> = { ...DEFS, ...Object.fromEntries(printed.map((d) => [d.id, d])) };
const pw = (id: string, o: Partial<CardDef> = {}) => card(id, { traits: ["Power Wish"], characters: [id], skill: null, ...o });
Object.assign(defs, {
  LPW910: card("LPW910", { type: "LEADER", colors: ["Red"], traits: ["Power Wish"], energyCost: null, comboCost: null, comboPower: null, skill: null }),
  PWX910: pw("PWX910"), PWY910: pw("PWY910"),
  PWOOLONG910: pw("PWOOLONG910", { characters: ["Oolong"] }), PWCHEELAI910: pw("PWCHEELAI910", { characters: ["Cheelai: Br"] }),
  PLAIN910: card("PLAIN910", { skill: null }),
  // A Unison with two orbs of specified cost, a Shenron by trait.
  SHEN2: card("SHEN2", { type: "Z-UNISON", colors: ["Red", "Blue"], energyCost: null, zEnergyCost: 1, traits: ["Shenron"], skill: null }),
  // Shenron only while in play: the trait it leaves with is not the trait it has afterwards (event-time information).
  INPLAY910: card("INPLAY910", { type: "Z-UNISON", colors: ["Red"], energyCost: null, zEnergyCost: 1, traits: [], skill: "[Permanent] This card gains ≪Shenron≫." }),
  PLAINUNI910: card("PLAINUNI910", { type: "Z-UNISON", colors: ["Red"], energyCost: null, zEnergyCost: 1, traits: ["Saiyan"], skill: null }),
  LEAVER910: card("LEAVER910", { skill: "[Activate: Main] Choose 1 of your Unison Cards and place it in your Drop Area." }),
  FOELEAVER910: card("FOELEAVER910", { skill: "[Activate: Main] Choose 1 of your opponent's Unison Cards and place it in its owner's Drop Area." }),
  WHOLE910: card("WHOLE910", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it gets +5000 power for the turn." }),
});
// An X cost carries its coloured requirement as hand-entered data (`cards.specified_cost`, #255); the public feed has none.
for (const [id, orbs] of Object.entries({ "BT25-138": { Red: 1 }, "BT25-139": { Blue: 1 }, "BT25-140": { Red: 1 }, SHEN2: { Red: 1, Blue: 1 }, INPLAY910: { Red: 1 }, PLAINUNI910: { Red: 1 } } as Record<string, CardDef["specifiedCost"]>)) defs[id] = { ...defs[id], specifiedCost: orbs };
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── 1. the reading ───────────────────────────────────────────────────────────
const rec = (id: string, kind: string, side: "front" | "back" = "front") => skillRecords(defs[id]).find((r) => r.side === side && r.kind === kind)!;
const costOf = (id: string) => rec(id, "activate:main").cost!;
{
  const e04 = costOf("EX24-04");
  assert.deepEqual(rec("EX24-04", "activate:main").unread, [], "EX24-04's Activate reads in full");
  assert.deepEqual(e04.orbs, { any: 1 }, "{1} stays the orb price");
  const conds = (e04.condition as { kind: string; conds: { kind: string; atLeast?: number; atMost?: number; sel?: { side: string; area: string } }[] }).conds;
  assert.deepEqual(conds.map((c) => c.kind), ["leaderMatches", "count", "all"], "Leader, energy, and the neither-nor pair: all three kept");
  assert.equal(conds[1].atLeast, 3);
  const pair = (conds[2] as unknown as { conds: { sel: { side: string; area: string }; atMost: number }[] }).conds;
  assert.deepEqual(pair.map((c) => [c.sel.side, c.sel.area, c.atMost]), [["you", "battle", 0], ["opponent", "battle", 0]], "neither you nor your opponent: each side's own Battle Area holds none");

  for (const [id, name] of [["EX24-08", "oolong"], ["EX24-13", "cheelai: br"]] as const) {
    const r = rec(id, "activate:main");
    assert.deepEqual(r.unread, [], `${id} reads in full`);
    assert.equal(r.cost!.condition!.kind, "leaderMatches", `${id}: the Leader condition is the condition`);
    const program = r.cost!.program!;
    assert.deepEqual(program.map((o) => o.op), ["choose", "moveTo", "moveTo"], `${id}: pick the partner, then both cards move`);
    const pick = program[0] as { sel: { area: string; count: number; upTo: boolean; notSelf: string; filter: { notCharacters: string[]; traits: string[] } } };
    assert.deepEqual([pick.sel.area, pick.sel.count, pick.sel.upTo, pick.sel.notSelf], ["hand", 1, false, "card"], `${id}: exactly one other card from the hand`);
    assert.deepEqual(pick.sel.filter.notCharacters, [name]);
    assert.deepEqual(pick.sel.filter.traits, ["power wish"]);
    assert.deepEqual(program.slice(1).map((o) => (o as { to: string }).to), ["zEnergy", "zEnergy"]);
    assert.deepEqual(r.ops.map((o) => o.op), ["draw"], `${id}: the effect is only the draw`);
  }

  // Generic: no card ids, no fixed trait.
  const price = (text: string) => skillRecords(card("GEN910", { skill: text }))[0];
  const addTwo = (rest: string) => price(`[Activate: Main] If your Leader is a ≪Saiyan≫ card and you add this card and ${rest} to your Z-Energy: Draw 1 card.`);
  assert.deepEqual(addTwo("1 red <Vegeta> card from your hand").unread, [], "any description, any trait");
  assert.ok(addTwo("2 red <Vegeta> cards from your hand").unread.length, "two partners: not read (one counted card only)");
  assert.ok(addTwo("up to 1 red <Vegeta> card from your hand").unread.length, "an optional partner is no cost");
  assert.ok(addTwo("1 red <Vegeta> card from your Drop").unread.length, "from the Drop: not the hand's pair");
  assert.ok(addTwo("1 red <Vegeta> card").unread.length, "no place named: not read");
  const neither = (rest: string) => price(`[Activate: Main] If neither you nor your opponent have ${rest}: Draw 1 card.`);
  assert.deepEqual(neither("a Unison in play").unread, [], "neither-nor reads for any description");
  assert.ok(neither("a mumble frobnicate in play").unread.length, "a description it cannot read stays unread");

  const e03 = rec("EX24-03", "activate:main");
  assert.deepEqual(e03.unread, [], "EX24-03 reads in full");
  assert.deepEqual(e03.cost!.program!.map((o) => o.op), ["moveTo"], "its price: this card to the Z-Energy");
  const op = e03.ops[0] as { op: string; what: string; all: boolean; until: string; target: { sel: { area: string; side: string; count?: number } } };
  assert.deepEqual([op.op, op.what, op.all, op.until], ["costReduction", "specified", true, "turn"]);
  assert.deepEqual([op.target.sel.side, op.target.sel.area, op.target.sel.count], ["you", "zDeck", undefined], "every matching card in your Z-Deck, not one chosen");
  assert.ok(price("[Activate: Main] During this turn, ignore the specified costs on ≪Shenron≫ Z-Unisons.").unread.length, "no place named: stays unread");

  const e01 = rec("EX24-01", "auto", "back");
  assert.deepEqual(e01.unread, [], "EX24-01's leave-Unison Auto reads in full");
  assert.deepEqual(e01.trigger, ["yourUnisonLeft"]);
  assert.ok(price("[Auto][Once per turn] When your ≪Shenron≫ Z-Unison leaves the Unison Area or the Battle Area, draw 1 card.").trigger.length === 0
    || price("[Auto][Once per turn] When your ≪Shenron≫ Z-Unison leaves the Unison Area or the Battle Area, draw 1 card.").unread.length > 0, "an alternative place is not read as the Unison Area alone");
  assert.ok(skillRecords(card("GEN2", { skill: "[Auto] When your ≪Shenron≫ Z-Unison leaves the Unison Area, add up to 2 ≪Power Wish≫ cards from your deck to your hand for every 1 specified cost on that card, then shuffle your deck." }))[0].unread.length, "'up to 2 … for every 1' is another allowance: unread");

  const e10 = rec("EX24-10", "activate:main");
  const pick10 = e10.cost!.program![0] as { sel: { area: string; ownedByOpponent: boolean } };
  assert.equal(pick10.sel.ownedByOpponent, true, "EX24-10: 'whose owner is your opponent' is kept in the price's choice");
  assert.ok(price("[Activate: Main] Choose 1 of your opponent's Battle Cards whose owner is your opponent: Draw 1 card.").unread.length, "an opponent's own cards are never 'owned by your opponent' in your hands: not read");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState); }
/** `seat`'s first Main Phase, hands and energy emptied back into the decks. */
function fresh(seat: PlayerId, leader = "LPW910", seed = 910): VmState {
  const leaders = { p1: seat === "p1" ? leader : "L-BLUE", p2: seat === "p2" ? leader : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  // A Unison with no marker is dropped at the next checkpoint (21-9).
  if (area === "unison") s.cards[id].markers = 2;
  return id;
}
const count = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area].length;
const lineIndex = (s: VmState, id: string, kind = "activate:main") => parseSkills(defs[s.cards[id].cardId].skill!).find((sk) => sk.kind === kind)!.index;
const isIt = (s: VmState, id: string) => (a: Action) => a.type === "activate" && a.card === id && a.skill === lineIndex(s, id);
const offer = (s: VmState, id: string) => RULES.legalActions(ctx, s).find((l) => isIt(s, id)(l.action));
const refusal = (s: VmState, id: string) => RULES.rejectedActions(ctx, s, RULES.legalActions(ctx, s)).find((r) => isIt(s, id)(r.action))?.why;
const forged = (s: VmState, seat: PlayerId, id: string) => ({ type: "activate", player: seat, card: id, skill: lineIndex(s, id) } as Action);
/** Declare and answer every prompt (default: the first candidate, or nothing for an optional choice). */
function run(s: VmState, seat: PlayerId, first: Action, pick: (s: VmState) => string[] | undefined = () => undefined): { s: VmState; asked: string[][] } {
  let cur = take(s, first); const asked: string[][] = [];
  for (let i = 0; i < 14 && cur.prompt.kind !== "main"; i++) {
    const q = cur.prompt;
    if (q.kind === "payCost") cur = take(cur, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "chooseCards") { asked.push([...q.choice.candidates]); cur = take(cur, { type: "choose", player: q.player, cards: pick(cur) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) }); }
    else if (q.kind === "orderPending") cur = take(cur, { type: "orderPending", player: q.player, index: 0 } as Action);
    else cur = take(cur, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(cur.prompt.kind, "main", "the activation resolves back to the Main Phase");
  return { s: cur, asked };
}
const restCount = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((id) => s.cards[id].mode === "rest").length;

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // ── 2. EX24-04: the conjunct list, every conjunct earns its refusal ─────────
  {
    const board = (o: { leader?: string; energy?: number; mine?: boolean; theirs?: boolean } = {}) => {
      const s = fresh(seat, o.leader ?? "LPW910");
      const id = stage(s, seat, "EX24-04", "hand");
      for (let i = 0; i < (o.energy ?? 3); i++) stage(s, seat, "V1", "energy");
      if (o.mine) stage(s, seat, "V1", "battle");
      if (o.theirs) stage(s, foe, "V-BLUE", "battle");
      return { s, id };
    };
    const ok = board();
    assert.ok(offer(ok.s, ok.id), `${seat}: EX24-04 offered when every condition holds`);
    for (const [why, b] of [["a non-Power Wish Leader", board({ leader: "L-RED" })], ["2 energy", board({ energy: 2 })], ["a Battle Card of yours", board({ mine: true })], ["a Battle Card of theirs", board({ theirs: true })]] as const) {
      assert.equal(offer(b.s, b.id), undefined, `${seat}: not offered with ${why}`);
      assert.ok(refusal(b.s, b.id)?.some((r) => r.kind === "condition"), `${seat}: ${why} is refused as a condition`);
      assert.throws(() => RULES.apply(ctx, roundtrip(b.s), forged(b.s, seat, b.id)), IllegalAction, `${seat}: a forged declaration with ${why} changes nothing`);
    }
    const done = run(ok.s, seat, offer(ok.s, ok.id)!.action);
    assert.ok(done.s.sides[seat].zones.battle.includes(ok.id), "the card is played");
    assert.equal(restCount(done.s, seat), 1, "{1} paid");
    assert.equal(count(done.s, seat, "energy"), 3, "the energy stays where it is, rested");
  }

  // ── 3. EX24-08 / EX24-13: the pair is the price ───────────────────────────
  for (const [id, own] of [["EX24-08", "PWOOLONG910"], ["EX24-13", "PWCHEELAI910"]] as const) {
    const board = (o: { leader?: string; partners?: string[]; deck?: number } = {}) => {
      const s = fresh(seat, o.leader ?? "LPW910");
      const me = stage(s, seat, id, "hand");
      const partners = (o.partners ?? ["PWX910"]).map((d) => stage(s, seat, d, "hand"));
      return { s, me, partners };
    };
    const ok = board({ partners: ["PWX910", own, "PLAIN910", "PWY910"] });
    assert.ok(offer(ok.s, ok.me), `${seat}: ${id} offered with a qualifying partner`);
    const [good, same, plain, good2] = ok.partners;
    const deck = count(ok.s, seat, "deck");
    const done = run(ok.s, seat, offer(ok.s, ok.me)!.action, (t) => (t.prompt.kind === "chooseCards" ? [good2] : undefined));
    assert.deepEqual(done.asked[0].sort(), [good, good2].sort(), `${id}: only another non-${own} Power Wish card of the hand is offered (not itself, its namesake or a plain card)`);
    const z = done.s.sides[seat].zones.zEnergy;
    assert.ok(z.includes(ok.me) && z.includes(good2), "both cards moved to the Z-Energy Area as the cost");
    assert.ok(done.s.sides[seat].zones.hand.includes(good) && done.s.sides[seat].zones.hand.includes(same) && done.s.sides[seat].zones.hand.includes(plain), "the cards not chosen stay in hand");
    assert.equal(count(done.s, seat, "deck"), deck - 2, "Draw 2 cards");
    assert.equal(count(done.s, seat, "hand"), 4 - 1 + 2 - 0, "four in hand + this card, minus the pair, plus two drawn");
    for (const [why, b] of [
      ["no other card in hand", board({ partners: [] })],
      ["only a non-Power Wish card", board({ partners: ["PLAIN910"] })],
      ["only its own namesake", board({ partners: [own] })],
      ["a non-Power Wish Leader", board({ leader: "L-RED" })],
    ] as const) {
      assert.equal(offer(b.s, b.me), undefined, `${seat}: ${id} not offered with ${why}`);
      assert.ok(refusal(b.s, b.me)?.length, `${seat}: ${id} refusal is stated (${why})`);
      const before = JSON.stringify(b.s);
      assert.throws(() => RULES.apply(ctx, roundtrip(b.s), forged(b.s, seat, b.me)), IllegalAction, `${seat}: ${id} forged with ${why}`);
      assert.equal(JSON.stringify(b.s), before, "nothing moved");
    }
    // A card in play is not in the hand: the line works from the hand only (the official Q&A for EX24-08 and EX24-13).
    const inPlay = board(); assert.ok(moveCard(inPlay.s, game, inPlay.me, "battle", { owner: seat }).ok);
    assert.equal(offer(inPlay.s, inPlay.me), undefined, `${seat}: ${id} in the Battle Area is not offered`);
  }

  // ── 4. EX24-03: no specified cost on your Shenron Z-Unisons in the Z-Deck, this turn ─
  {
    const board = (o: { leader?: string; energy?: number } = {}) => {
      const s = fresh(seat, o.leader ?? "LPW910");
      const pilaf = stage(s, seat, "EX24-03", "hand");
      for (let i = 0; i < (o.energy ?? 2); i++) stage(s, seat, "V1", "energy");
      const shen = stage(s, seat, "BT25-138", "zDeck"), plain = stage(s, seat, "PLAINUNI910", "zDeck"), two = stage(s, seat, "SHEN2", "zDeck");
      const foeShen = stage(s, foe, "BT25-139", "zDeck");
      const inPlay = stage(s, seat, "BT25-140", "unison");
      return { s, pilaf, shen, plain, two, foeShen, inPlay };
    };
    const spec = (s: VmState, id: string) => attrsNow(ctx, game, s, id).specifiedCost;
    const ok = board();
    assert.deepEqual(spec(ok.s, ok.shen), ["Red"], "before: BT25-138 asks for {r} by the one-orb convention");
    assert.deepEqual(spec(ok.s, ok.two), ["Red", "Blue"]);
    assert.ok(offer(ok.s, ok.pilaf), `${seat}: Pilaf offered with 2 energy`);
    for (const [why, b] of [["1 energy", board({ energy: 1 })], ["a non-Power Wish Leader", board({ leader: "L-RED" })]] as const) {
      assert.equal(offer(b.s, b.pilaf), undefined, `${seat}: Pilaf not offered with ${why}`);
      assert.throws(() => RULES.apply(ctx, roundtrip(b.s), forged(b.s, seat, b.pilaf)), IllegalAction);
    }
    const done = run(ok.s, seat, offer(ok.s, ok.pilaf)!.action);
    assert.ok(done.s.sides[seat].zones.zEnergy.includes(ok.pilaf), "the price: Pilaf goes to the Z-Energy Area");
    assert.deepEqual(spec(done.s, ok.shen), [], "BT25-138 in the Z-Deck: no specified cost");
    assert.deepEqual(spec(done.s, ok.two), [], "…every Shenron Z-Unison in the Z-Deck, not one");
    assert.deepEqual(spec(done.s, ok.plain), ["Red"], "a non-Shenron Z-Unison keeps its specified cost");
    assert.deepEqual(spec(done.s, ok.foeShen), ["Blue"], "the opponent's Z-Deck is not yours");
    assert.deepEqual(spec(done.s, ok.inPlay), ["Red"], "a Unison already in play is not in the Z-Deck");
    assert.equal(attrsNow(ctx, game, done.s, ok.shen).costOf, attrsNow(ctx, game, ok.s, ok.shen).costOf, "1-2-3-2: the total cost is not reduced");
    assert.deepEqual(spec(roundtrip(done.s), ok.shen), [], "the effect survives a reload");
    // The point of it: the price the engine charges for playing the Z-Unison no longer demands the colour
    // (official Q&A: its energy cost is then the X of the ignored specified cost, the master's to choose).
    assert.deepEqual(cardPrice(ctx, game, ok.s, ok.shen).orbs, { Red: 1 }, "before: playing BT25-138 demands {r}");
    assert.deepEqual(cardPrice(ctx, game, done.s, ok.shen).orbs, {}, "after: no colour demanded");
    assert.deepEqual(cardPrice(ctx, game, done.s, ok.two).orbs, {}, "…for each Shenron Z-Unison of the Z-Deck");
    assert.deepEqual(cardPrice(ctx, game, done.s, ok.plain).orbs, { Red: 1 }, "…not for a non-Shenron one");
    assert.deepEqual(cardPrice(ctx, game, done.s, ok.foeShen).orbs, { Blue: 1 }, "…nor for the opponent's");
    // …and it is for this turn only.
    let s = done.s;
    for (let i = 0; i < 40 && s.turn === done.s.turn; i++) {
      const player = (s.prompt as { player: PlayerId }).player;
      s = take(s, s.prompt.kind === "main" ? { type: "endMain", player } : s.prompt.kind === "chooseCards" ? { type: "choose", player, cards: [] } : { type: "pass", player });
    }
    assert.ok(s.turn > done.s.turn);
    assert.deepEqual(spec(s, ok.shen), ["Red"], "the turn ended: the specified cost is back");
  }

  // ── 5. EX24-01 (back): the leave-Unison search, one card per specified cost ──
  {
    const board = (o: { flipped?: boolean; searchable?: number; foeUnison?: string } = {}) => {
      const s = fresh(seat, "EX24-01");
      const leader = s.sides[seat].zones.leader[0];
      s.cards[leader].flipped = o.flipped ?? true;
      const leaver = stage(s, seat, "LEAVER910", "battle");
      const found = s.sides[seat].zones.deck.slice(0, o.searchable ?? 4);
      for (const id of found) s.cards[id].cardId = "PWX910";
      // The searched cards sit on top; the rest of the deck is plain.
      return { s, leader, leaver, found };
    };
    const search = (b: { s: VmState; leaver: string }, unisons: string[], pick?: (s: VmState) => string[] | undefined) => {
      const s = b.s;
      const ids = unisons.map((d) => stage(s, seat, d, "unison"));
      const r = run(s, seat, offer(s, b.leaver)!.action, (t) => {
        if (t.prompt.kind !== "chooseCards") return undefined;
        const cands = t.prompt.choice.candidates;
        if (cands.some((c) => ids.includes(c))) return [ids[0]];
        return pick ? pick(t) : undefined;
      });
      return { ...r, ids };
    };
    const handPW = (s: VmState) => s.sides[seat].zones.hand.filter((id) => s.cards[id].cardId === "PWX910").length;

    // BT25-138 has one orb: up to 1.
    {
      const b = board();
      const r = search(b, ["BT25-138"], (t) => (t.prompt.kind === "chooseCards" ? t.prompt.choice.candidates.slice(0, 1) : undefined));
      const search1 = r.asked.find((c) => c.every((id) => r.s.cards[id].cardId === "PWX910"));
      assert.ok(r.s.sides[seat].zones.drop.includes(r.ids[0]), "the Unison left the Unison Area");
      assert.equal(handPW(r.s), 1, "1 specified cost: up to 1 Power Wish card ");
      assert.ok(search1, "the search was a real choice");
    }
    // Two orbs: up to 2, through a reload.
    {
      const b = board();
      const r = search(b, ["SHEN2"], (t) => (t.prompt.kind === "chooseCards" ? t.prompt.choice.candidates.slice(0, 1) : undefined));
      assert.equal(handPW(r.s), 2, "2 specified cost: up to 2");
      const fewer = search(board(), ["SHEN2"], () => []);
      assert.equal(handPW(fewer.s), 0, "'up to': none is allowed");
      const scarce = search(board({ searchable: 1 }), ["SHEN2"], (t) => (t.prompt.kind === "chooseCards" ? t.prompt.choice.candidates.slice(0, 1) : undefined));
      assert.equal(handPW(scarce.s), 1, "only one in the deck: only one added");
    }
    // The Unison's information as it left: Shenron by a trait it has in play only.
    {
      const b = board();
      const r = search(b, ["INPLAY910"], (t) => (t.prompt.kind === "chooseCards" ? t.prompt.choice.candidates.slice(0, 1) : undefined));
      const dropped = r.ids[0];
      assert.ok(!(attrsNow(ctx, game, r.s, dropped).traits as string[]).some((t) => t.toLowerCase() === "shenron"), "in the Drop it no longer gains Shenron");
      assert.equal(handPW(r.s), 1, "yet it was a Shenron Z-Unison when it left: the Auto answers (event-time information)");
    }
    // Not a Shenron, not yours, not the back face, not twice.
    {
      const plainLeft = search(board(), ["PLAINUNI910"]);
      assert.equal(handPW(plainLeft.s), 0, "a non-Shenron Z-Unison leaving answers nothing");
      const front = search(board({ flipped: false }), ["BT25-138"]);
      assert.equal(handPW(front.s), 0, "the front face of the Leader has no such Auto");
      // The opponent's Shenron Z-Unison leaving their Unison Area is not yours.
      const b = board(); const theirs = stage(b.s, foe, "BT25-139", "unison");
      const foeLeaver = stage(b.s, seat, "FOELEAVER910", "battle");
      const r = run(b.s, seat, offer(b.s, foeLeaver)!.action, (t) => (t.prompt.kind === "chooseCards" && t.prompt.choice.candidates.includes(theirs) ? [theirs] : undefined));
      assert.ok(r.s.sides[foe].zones.drop.includes(theirs), "their Unison was sent to their Drop");
      assert.equal(handPW(r.s), 0, "…and your Leader does not answer to it");
      // [Once per turn]: a second Shenron Unison leaving the same turn answers nothing more.
      const t = board();
      const u1 = stage(t.s, seat, "BT25-138", "unison");
      const second = stage(t.s, seat, "LEAVER910", "battle");
      const pickAny = (s: VmState) => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates.slice(0, 1) : undefined);
      const one = run(t.s, seat, offer(t.s, t.leaver)!.action, (s) => (s.prompt.kind === "chooseCards" && s.prompt.choice.candidates.includes(u1) ? [u1] : pickAny(s)));
      assert.equal(handPW(one.s), 1);
      // The Unison Area holds one Unison: the next one arrives once the first has left.
      const u2 = stage(one.s, seat, "BT25-139", "unison");
      const two = run(one.s, seat, offer(one.s, second)!.action, (s) => (s.prompt.kind === "chooseCards" && s.prompt.choice.candidates.includes(u2) ? [u2] : pickAny(s)));
      assert.ok(two.s.sides[seat].zones.drop.includes(u2), "the second Unison left too");
      assert.equal(handPW(two.s), 1, "[Once per turn]: the Auto answered once");
    }
  }

  // ── 6. EX24-10: 'whose owner is your opponent' is in the price ───────────────
  {
    const board = (borrowed: boolean) => {
      const s = fresh(seat, "LPW910");
      const black = stage(s, seat, "EX24-10", "hand");
      stage(s, seat, "V1", "energy");
      const mine = stage(s, seat, "V1", "battle");
      const loan = stage(s, foe, "V-BLUE", "battle");
      if (borrowed) { s.cards[loan].owner = foe; assert.ok(moveCard(s, game, loan, "battle", { owner: seat }).ok); s.cards[loan].owner = foe; }
      return { s, black, mine, loan };
    };
    const own = board(false);
    assert.equal(offer(own.s, own.black), undefined, `${seat}: with only cards you own, there is nothing whose owner is your opponent: not offered`);
    const lent = board(true);
    assert.ok(lent.s.sides[seat].zones.battle.includes(lent.loan) && lent.s.cards[lent.loan].owner === foe, "the staged loan is in your Battle Area, owned by your opponent");
    assert.ok(offer(lent.s, lent.black), `${seat}: offered once a borrowed card is in your Battle Area`);
    const done = run(lent.s, seat, offer(lent.s, lent.black)!.action);
    assert.ok(done.s.cards[lent.black].under.includes(lent.loan), "it is played on top of the card you do not own…");
    assert.ok(!done.s.cards[lent.black].under.includes(lent.mine) && done.s.sides[seat].zones.battle.includes(lent.mine), "…never on your own Battle Card, which stays beside it");
    assert.ok(done.s.sides[seat].zones.battle.includes(lent.black), "EX24-10 is played");
  }
}

console.log("  ok #910: EX24-04 conjunct list, EX24-08/13 add-two Z-Energy price, EX24-03 Z-Deck specified cost, EX24-01 leave-Unison search, EX24-10 borrowed-card choice — both seats, through reloads");

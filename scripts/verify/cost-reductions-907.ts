/**
 * #907: the cost-reduction wordings the compiler could not read - "the next
 * time you activate [Arrival] on ..., reduce the skill cost by {r}", "the next
 * time you play X from your Z-Deck, reduce its energy cost by 1", "reduce the
 * [Z-Awaken] skill cost of ... by {2}", "treat ... as if they had no specified
 * cost", "reduce the energy cost of this card in your hand by N" under the
 * conditions the early sets print - and the engine half that pays them.
 *
 * The compiler half pins the readings (and the clauses that must stay unread
 * because they would read wider than printed). The board half runs the VM:
 *
 * - 20-21-2 / FAQ Skills Q24: a plain number comes off the total only; a
 *   reduction by a coloured orb takes that colour out of the specified cost as
 *   well, by as many as the card really demands (20-21-2-1); 1-2-2-1 keeps the
 *   total from falling under the specified orbs that remain.
 * - 5-8-2-4: a skill-cost reduction said in a colour does nothing to a {1} orb
 *   and one said as {1} does nothing to a coloured orb.
 * - "The next time ...": one use, shared by every card the words reached, spent
 *   by the move that pays (a play, an Extra's activation, a skill line).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { CTX, DBS_DEFINITION, DEFS, actsG, addEffectG, assertConsistentG, card, compileSkill, comboCostOfG, describeScript, findG, moveG, parseSkills, playCostG, playG, stagedG, zoneOf } from "./harness";
import type { Action, EngineState } from "./harness";
import { skillOrbs, spendSkillCostUses } from "../../src/lib/arena/vm/costs";
import type { ContinuousEffect, Skill } from "../../src/lib/arena/types";

const one = (text: string) => compileSkill(parseSkills(text)[0]);
type CostOp = { op: string; target: { sel?: Record<string, unknown>; var?: string }; amount: number; what?: string; skillKind?: string; tag?: string; colors?: string[]; uses?: number; until?: string; all?: boolean };
const ops = (text: string): CostOp[] => {
  const s = one(text);
  const flat: CostOp[] = [];
  const walk = (list: unknown[]) => {
    for (const o of list as { op: string; then?: unknown[] }[]) {
      if (o.op === "costReduction") flat.push(o as unknown as CostOp);
      if (o.then) walk(o.then);
    }
  };
  walk(s.ops);
  return flat;
};

// ── the compiler: one-use reductions of a skill line's price ────────────────
{
  // BT24-002b: [Arrival Red/Yellow] on a <Beerus> card with an energy cost of 5 in the hand.
  const arrival = one("[Auto][Once per turn] When you use one of your Red/Yellow multicolor ≪God≫ cards in a combo, add up to 1 card from your life to your hand, and during this turn, the next time you activate [arrival red/yellow] on a <Beerus> card with an energy cost of 5 in your hand, reduce the skill cost by {r}.");
  assert.deepEqual(arrival.unsupported, []);
  const [a] = ops("[Auto][Once per turn] When you use one of your Red/Yellow multicolor ≪God≫ cards in a combo, add up to 1 card from your life to your hand, and during this turn, the next time you activate [arrival red/yellow] on a <Beerus> card with an energy cost of 5 in your hand, reduce the skill cost by {r}.");
  assert.deepEqual([a.what, a.tag, a.skillKind, a.amount, a.colors, a.uses, a.until], ["skill", "arrival", undefined, 1, ["Red"], 1, "turn"]);
  assert.equal(a.target.sel?.area, "hand");
  assert.equal(a.target.sel?.count, 99, "every such card, not a choice of one");

  // BT27-035: [EX-Evolve] is the Evolve channel, narrowed to the variant.
  const [ex] = ops("[activate: main][limit 1] During this turn, the next time you activate an [ex-evolve] skill on {Boujack, on a Rampage} in your hand, reduce the skill cost by {3}.");
  assert.deepEqual([ex.what, ex.tag, ex.amount, ex.colors, ex.uses], ["evolve", "ex-evolve", 3, ["any", "any", "any"], 1]);

  // 22-5-2-2: a bare [Evolve] is all three variants, so it carries no tag.
  const [evo] = ops("[activate: main][once per turn]{1}: If you activate the [evolve] skill on a yellow <Hit> card in your hand this turn, reduce the skill cost of that [evolve] skill by {y}{y}.");
  assert.deepEqual([evo.what, evo.tag, evo.amount, evo.uses], ["evolve", undefined, 2, 1]);

  // [Swap], [Successor], [Union], [Dark Over Realm] and [Activate] lines.
  assert.equal(ops("[Activate: Main][Once per turn] If you have 4 or more energy: Draw 1 card, and the next time you activate a [Swap] skill on a ≪Goku's Lineage≫ card with an energy cost of 5 during this turn, reduce the skill cost by {y}.")[0].tag, "swap");
  assert.equal(ops("[auto] When this card is played, during this turn, the next time you activate a [successor] skill on a <Frieza> card in your hand, reduce its skill cost by {y}{1}.")[0].tag, "successor");
  assert.equal(ops("[auto] When this card is played, add up to 1 card from your life to your hand. Additionally, if you have 3 or more energy, during this turn, the next time you activate the [union] skill on a green <Gogeta: GT> card from your hand, reduce the skill cost by {g}.")[0].tag, "union");
  assert.equal(ops("[Activate: Main/Battle][Limit 1] During this turn, the next time you activate a [Dark Over Realm] skill from your hand, reduce its skill cost by {b}.")[0].tag, "dark over realm");
  const [act] = ops("[activate: main][limit 1] During this turn, the next time your activate an [activate: main] skill on a white <Son Goku: GT> or <Pan> card from your hand, reduce the skill cost by {1}.");
  assert.deepEqual([act.skillKind, act.tag, act.colors, act.uses], ["activate", undefined, ["any"], 1]);

  // BT31-040: "that card's [activate: main] skill" is the card the skill just chose.
  const [that] = ops("[activate: main] [once per turn] Discard 1 card from your hand: Choose up to 1 blue card with <Beerus> in its character name from your Battle Area and during the turn, the next time your activate that card's [activate: main] skill, reduce the skill cost by {u}.");
  assert.deepEqual([that.skillKind, that.uses, that.until], ["activate", 1, "turn"]);
  assert.ok(that.target.var, "bound to the chosen card");

  // "During the battle" is a battle, not a turn (BT28-056b).
  const [battle] = ops("[Activate: Battle][Once per turn] If your opponent has 2 or more energy: The next time you activate an [Activate: Battle] skill on a green <Tien Shinhan> card in your hand during the battle, reduce the skill cost by {g}.");
  assert.equal(battle.until, "battle");

  // What would read wider (or elsewhere) than printed stays unread, both halves.
  for (const text of [
    "[Auto] When this card is played, during this turn, the next time you activate a skill on a <Lord Slug> card from your Z-Deck or {Lord Slug, Colossal Destroyer} from your hand, reduce the skill cost by {y}.",
    "[activate: main/battle] Place 1 of your Z-Energy in your Drop: During this turn, the next time you use an [activate] skill on a red <Son Gohan: Future> or <Trunks: Future> card in your Battle Area and/or Combo Area, reduce its skill cost by {1}.",
    "[Activate: Main][Limit 1] If your Leader is a black <Vegito> card: During this turn, the next time you activate [Activate: Main] on a <Trunks: Future> card under your black <Mai: Future> Z-Battle Card, reduce the skill cost by {b}.",
  ]) {
    const s = one(text);
    assert.ok(s.unsupported.some((u) => /reduce/i.test(u)), `stays unread: ${text.slice(0, 80)}`);
    assert.deepEqual(ops(text), []);
  }
}

// ── the compiler: static and timed reductions of a keyword line's price ─────
{
  // BT27-069: a [Permanent] "when you activate ..., reduce the skill cost" is standing, with no budget.
  const [p] = ops("[Permanent] When you activate an [Activate: Main/Battle] skill on {SS Broly, Vigor} in your hand, reduce the skill cost by {y}{y}.");
  assert.deepEqual([p.what, p.skillKind, p.amount, p.uses, p.until], ["skill", "activate", 2, undefined, "game"]);
  // ... but a counted "once per turn" cannot be a standing change.
  assert.deepEqual(ops("[Permanent] Once per turn, when you activate {Stop You Fiend!}'s skill from your hand, reduce the energy cost by {y}."), []);

  // [Z-Awaken], [Union], [Swap], [EX-Evolve], [Auto] lines, said both ways round.
  assert.equal(ops("[Permanent] Reduce the [Z-Awaken] skill cost on <Majin Buu> cards in your Z-Deck by {u}.")[0].tag, "z-awaken");
  assert.equal(ops("[auto][limit 1] When this card is played, reduce the [z-awaken] skill cost of <Piccolo: SH> cards in your Z-Deck by {2}.")[0].amount, 2);
  assert.equal(ops("[permanent] Reduce the skill cost of [union] skills on yellow <Vegito> cards in your hand by {1}.")[0].tag, "union");
  assert.equal(ops("[permanent] If your Leader is a Z-Leader, reduce the skill cost of this card's [union] skill in your hand by {g}.")[0].tag, "union");
  assert.equal(ops("[activate: main] Choose up to 1 of your <Monaka> cards and reduce the [swap] skill cost of that card by {u} for the turn.")[0].tag, "swap");
  assert.deepEqual([ops("[Permanent] Reduce the [Auto] skill cost of {Practicing Fusion} in your Battle Area by {u}.")[0].skillKind], ["auto"]);
  const [exp] = ops("[permanent] If you have a yellow <Son Gohan: SH> card in play, reduce the [ex-evolve] skill cost on {Son Gohan, Flash of Brilliance} in your hand or Drop by {y}.");
  assert.deepEqual([exp.what, exp.tag, exp.target.sel?.count], ["evolve", "ex-evolve", 99]);
  // "[Swap]" is the swap line only: it is no longer the cost of every line of the card.
  assert.equal(ops("[permanent] Reduce the skill cost of [swap] on your yellow <Frieza> cards by {y}.")[0].tag, "swap");
}

// ── the compiler: one-use reductions of a card's energy price ───────────────
{
  const [ext] = ops("[Activate: Main/Battle][Limit 1] During this turn, the next time you activate a green ≪World Tournament≫ Extra in your hand, reduce the energy cost by {g}.");
  assert.deepEqual([ext.what, ext.amount, ext.colors, ext.uses, ext.target.sel?.area], [undefined, 1, ["Green"], 1, "hand"]);
  const [named] = ops("[activate: main]{r}{r}, if you have 4 or more energy: Play up to 1 red <Garlic Jr.> card with an energy cost of 8 from your hand on top of this card, then during this turn, the next time you activate {Garlic Jr.'s Ambition}, reduce the energy cost by {r}.");
  assert.equal(named.target.sel?.area, "hand", "a card about to be bought is in the hand");
  const [z] = ops("[auto] Place 2 cards from under this card into their owner's Drop: When this card attacks, choose up to 1 card under this card, negate its skills for the turn, add it to your Z-Energy, and the next time you play a red <Broly> card from your Z-Deck during this turn, reduce its energy cost by 1.");
  assert.deepEqual([z.target.sel?.area, z.amount, z.uses], ["zDeck", 1, 1]);
  const [placed] = ops("[auto] When this card is played, during this turn, the next time you place {Power Ball, Mimicking the Moon} in your Battle Area from your Z-Deck, reduce its energy cost by {y}.");
  assert.equal(placed.target.sel?.area, "zDeck");
  const [zextra] = ops("[activate: main][limit 1]{g}{g}, if your Leader is green and you have 3 or more energy: Play this card from your hand, and during that turn, the next time you place a Z-Extra in your Battle Area, reduce its energy cost by {g}.");
  assert.equal(zextra.target.sel?.area, "zDeck", "a Z-card is placed from the Z-Deck");
  const [spec] = ops("[Activate: Main][Once per turn] During this turn, the next time you play a red Z-Unison with an [Empower] skill from your Z-Deck, reduce its specified cost by {r}.");
  assert.deepEqual([spec.what, spec.colors, spec.uses], ["specified", ["Red"], 1]);
  // "When you would play ..." is every such play this turn: no budget.
  const [would] = ops("[auto] If your Leader's back side is {SS Son Goku, Fearless Fighter}: When this card is played, during this turn, when you would play a Unison with [empower] from your hand, reduce the specified cost by {y}.");
  assert.deepEqual([would.what, would.uses], ["specified", undefined]);

  // "Original energy cost" asks for the printed price, which the filter could not tell from the one being moved until #907 round 6
  // gave it a measure of its own (`originalCostMin`/`originalCostMax`): the scope is the printed 2, not the price being lowered.
  const printed = ops("[Permanent] When activating a [Field] skill of a green Extra Card with an original energy cost of 2 from your hand, reduce that card's energy cost by 1.");
  assert.equal(printed.length, 1);
  const scope = printed[0].target.sel?.filter as { originalCostMin?: number; originalCostMax?: number; costMin: number | null } | undefined;
  assert.deepEqual([scope?.originalCostMin, scope?.originalCostMax, scope?.costMin], [2, 2, null], "scoped by the printed price");
  // A different line of the Extra ([Counter]) would make the change wider than printed.
  assert.deepEqual(ops("[Activate: Main] During this turn, the next time you activate the [Counter] skill on a red Extra in your hand, reduce the energy cost by 1."), []);
}

// ── the compiler: "treat as if it had no specified cost" ────────────────────
{
  const [all] = ops("[Permanent] Treat ≪Universe 9≫ cards in all areas as if they have no specified cost.");
  assert.deepEqual([all.what, all.all], ["specified", true]);
  assert.deepEqual(all.target.sel?.areas, ["hand", "zDeck"], "the two places a price is asked, as [Warrior of Universe 7]");
  const [hand] = ops("[Permanent] Treat ≪Agent of Destruction≫ cards in your hand as if they had no specified cost.");
  assert.equal(hand.target.sel?.area, "hand");
  const [self] = ops("[permanent] If your Leader Card is a ≪Saiyan≫ card, treat this card in your hand as if it has no specified cost.");
  assert.deepEqual([self.all, self.target.sel?.special], [true, "self"]);
  // The printed price of other cards, and trait phrases the reader does not hold, stay unread.
  assert.deepEqual(ops("[Permanent] Treat cards with ≪Universe≫ as part of their special traits in all areas as if they had no specified cost."), []);
}

// ── the compiler: the conditions in front of "reduce this card's energy cost" ──
{
  const gate = (text: string): string => describeScript(one(text).ops, { permanent: true });
  assert.match(gate("[permanent] If a ≪Bardock's Crew≫ card is in your Drop Area, reduce the energy cost of this card in your hand by 1."), /1 or more .*cards in your Drop Area: this card costs 1 less/);
  assert.match(gate("[Permanent] If {A King's Return to Youth} is in your Drop Area, reduce the energy cost of this card in your hand by 1."), /{a king's return to youth}/);
  assert.match(gate("[Permanent] If your have 2 or more ≪Saiyan≫ cards in your Warp, reduce the energy cost of this card in your hand by 2."), /2 or more .* in your Warp: this card costs 2 less/);
  assert.match(gate("[Permanent] During your opponent's turn, if <Son Goten> and <Trunks: Youth> cards are in play in your Battle Area, reduce the energy cost of this card in your hand by 2."), /opponent's turn.*<son goten>.*and.*<trunks: youth>/);
  assert.match(gate("[Permanent] If you or your opponent have a skill-less Battle Card in play, reduce the energy cost of this card in your hand by 1."), /your Battle Area, or .*your opponent's Battle Area/);
  assert.match(gate("[Permanent] If you or your opponent have 3 or more cards in their Warp, reduce the energy cost of this card in your hand by 2."), /3 or more cards in your Warp, or .*3 or more cards in your opponent's Warp/);
  const total = one("[Permanent] If the total number of cards in you and your opponent's Warps is 7 or more, reduce the energy cost of this card in your hand by 7.");
  assert.deepEqual(total.unsupported, []);
  assert.deepEqual(JSON.parse(JSON.stringify((total.ops[0] as { cond: unknown }).cond)), { kind: "count", sel: { side: "both", area: "warp" }, atLeast: 7 });
  // "an additional 1" stacks with the first sentence's reduction.
  const extra = one("[Permanent] If there are 5 or more red Extra Cards in your Drop Area, reduce the energy cost of this card in your hand by 1. If there are 10 or more red Extra Cards in your Drop Area, reduce the energy cost of this card in your hand by an additional 1.");
  assert.deepEqual(extra.unsupported, []);
  assert.equal(extra.ops.length, 2);
  // BT26-043 prints "cost o this card".
  assert.deepEqual(one("[Permanent] If your Leader is a blue <Gogeta: Br> card, reduce the energy cost o this card in your hand by 2.").unsupported, []);
  // A leading "for each" hangs on the reducer; a count of markers, of other cards' costs, or across two places is not a count of cards.
  // (Phrasing batch 4: cards of your own Z-Energy, Drop or Battle Area counted across two of them are — "For every 2 green
  // Extras in your Battle Area and/or Drop" (P-430) reads, proved in the VM by `phrasing-batch-4.ts`.)
  const per = one("[Permanent] If your Leader is a green <Son Goku: GT> card, for each green <Son Goku: GT> card in your Warp, reduce the energy cost of this card in your hand by 1.");
  assert.deepEqual(per.unsupported, []);
  // (Phrasing batch 6: the markers on Unison Cards in play, both players', are read — `phrasing-batch-6.ts`.)
  // Phrasing batch 8: a printed ceiling is read as the count capped there (`capped`, P-464), never flat.
  {
    const s = one("[permanent] For each green Unison Card in your Drop, reduce the Z-Energy cost of this card in your Z-Deck by 1. (Up to 2)");
    const cut = s.ops[0];
    assert.ok(s.unsupported.length === 0 && cut?.op === "costReduction" && typeof cut.amount === "object" && "capped" in cut.amount && cut.amount.capped[1] === 2, "P-464: capped at 2, never read flat");
  }
}

// ── the board: 20-21-2 and the FAQ on the specified half of an energy price ──
{
  DEFS.C907RB = card("C907RB", { colors: ["Red"], energyCost: 3, specifiedCost: { Red: 2 } });
  const price = (value: number, colors?: ContinuousEffect["colors"]) => {
    const s = stagedG({ hand: ["C907RB"] });
    const id = findG(s, "p1", "hand", "C907RB");
    addEffectG(s, [], { target: id, kind: "cost", value, until: "turn", master: "p1", ...(colors ? { colors } : {}) });
    return playCostG(s, id);
  };
  assert.deepEqual(playCostG(stagedG({ hand: ["C907RB"] }), findG(stagedG({ hand: ["C907RB"] }), "p1", "hand", "C907RB")), { total: 3, specified: { Red: 2 } }, "printed");
  assert.deepEqual(price(1), { total: 2, specified: { Red: 2 } }, "FAQ Skills Q24: a plain reduction does not reduce the specified cost");
  assert.deepEqual(price(3), { total: 2, specified: { Red: 2 } }, "1-2-2-1: never under the specified cost that remains");
  assert.deepEqual(price(1, ["Red"]), { total: 2, specified: { Red: 1 } }, "20-21-2: {r} takes a red orb off both halves");
  assert.deepEqual(price(1, ["Blue"]), { total: 3, specified: { Red: 2 } }, "20-21-2-1: no blue to take, so nothing comes off");
  assert.deepEqual(price(2, ["Red", "Red"]), { total: 1, specified: {} }, "two red orbs");
  assert.deepEqual(price(1, ["any"]), { total: 2, specified: { Red: 2 } }, "{1} lowers the total alone");
  // The combo cost of 20-21 is a bare number: no coloured half to floor it by.
  DEFS.C907COMBO = card("C907COMBO", { comboCost: 2, specifiedCost: { Red: 1 } });
  const cs = stagedG({ hand: ["C907COMBO"] });
  const combo = findG(cs, "p1", "hand", "C907COMBO");
  addEffectG(cs, [], { target: combo, kind: "comboCost", value: 2, until: "turn", master: "p1" });
  assert.equal(comboCostOfG(cs, combo), 0);
}

// ── the board: a [Permanent]'s conditions and "no specified cost" ───────────
{
  DEFS.C907TRAIT = card("C907TRAIT", { traits: ["C907Crew"] });
  DEFS.C907COND = card("C907COND", { colors: ["Red"], energyCost: 3, skill: "[Permanent] If a ≪C907Crew≫ card is in your Drop Area, reduce the energy cost of this card in your hand by 2." });
  const s = stagedG({ hand: ["C907COND", "C907TRAIT"] });
  const cond = findG(s, "p1", "hand", "C907COND");
  assert.equal(playCostG(s, cond).total, 3, "no ≪C907Crew≫ card in the Drop yet");
  moveG(s, findG(s, "p1", "hand", "C907TRAIT"), "drop", "p1");
  assert.equal(playCostG(s, cond).total, 1, "with one there");

  DEFS.C907SUM = card("C907SUM", { energyCost: 5, skill: "[Permanent] If the total number of cards in you and your opponent's Warps is 3 or more, reduce the energy cost of this card in your hand by 2." });
  DEFS.C907OPP = card("C907OPP", { colors: ["Blue"] });
  const w = stagedG({ hand: ["C907SUM", "V1", "V1"], oppHand: ["C907OPP"] });
  const sum = findG(w, "p1", "hand", "C907SUM");
  const [a, b] = zoneOf(w, "p1", "hand").filter((id) => w.cards[id].cardId === "V1");
  moveG(w, a, "warp", "p1");
  moveG(w, b, "warp", "p1");
  assert.equal(playCostG(w, sum).total, 5, "two cards in my Warp");
  moveG(w, zoneOf(w, "p2", "hand")[0], "warp", "p2");
  assert.equal(playCostG(w, sum).total, 3, "two of mine and one of the opponent's make three");

  DEFS.C907NOSPEC = card("C907NOSPEC", { colors: ["Red"], energyCost: 2, specifiedCost: { Red: 2 }, traits: ["C907Nine"] });
  DEFS.C907NINE = card("C907NINE", { skill: "[Permanent] Treat ≪C907Nine≫ cards in all areas as if they have no specified cost." });
  const bare = stagedG({ hand: ["C907NOSPEC"] });
  assert.deepEqual(playCostG(bare, findG(bare, "p1", "hand", "C907NOSPEC")), { total: 2, specified: { Red: 2 } });
  const helped = stagedG({ hand: ["C907NOSPEC"], battle: ["C907NINE"] });
  assert.deepEqual(playCostG(helped, findG(helped, "p1", "hand", "C907NOSPEC")), { total: 2, specified: {} }, "1-2-3-2: the colours go, the total stays");
}

// ── the board: "the next time you play X, reduce its energy cost by ..." ────
{
  const pay = (s: EngineState) => (s.prompt.kind === "payCost" ? playG(s, { type: "payCost", player: "p1", option: 0 } as Action) : s);
  const rested = (s: EngineState) => zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest").length;
  DEFS.C907FOO = card("C907FOO", { energyCost: 2, colors: ["Red"] });
  DEFS.C907ONCE = card("C907ONCE", { energyCost: 0, skill: "[Auto] When this card is played, the next time you play a <C907FOO> card from your hand during this turn, reduce its energy cost by 1." });
  let s = stagedG({ hand: ["C907ONCE", "C907FOO", "C907FOO"], energy: ["V1", "V1", "V1", "V1"] });
  s = pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "C907ONCE") }));
  const foos = zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "C907FOO");
  assert.equal(foos.length, 2);
  assert.deepEqual(foos.map((id) => playCostG(s, id).total), [1, 1], "both copies are cheaper, as the change reached both");
  const effects = (s as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "cost");
  assert.equal(effects.length, 2);
  assert.equal(effects[0].group, effects[0].id, "one use between them");
  assert.equal(effects[1].group, effects[0].id);
  s = pay(playG(s, { type: "play", player: "p1", card: foos[0] }));
  assert.equal(rested(s), 1, "the first play paid 2 less 1");
  assert.deepEqual((s as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "cost"), [], "and spent the change, for both copies");
  assert.equal(playCostG(s, foos[1]).total, 2, "the second copy costs its price");
  assertConsistentG(s);

  // Unused, it ends with the turn.
  let t = stagedG({ hand: ["C907ONCE", "C907FOO"], energy: ["V1", "V1"] });
  t = pay(playG(t, { type: "play", player: "p1", card: findG(t, "p1", "hand", "C907ONCE") }));
  assert.equal((t as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "cost").length, 1);
  t = playG(t, { type: "endMain", player: "p1" });
  assert.deepEqual((t as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "cost"), []);

  // An Extra bought by activating it spends its one-use change there (12-2-2).
  DEFS.C907EXTRA = card("C907EXTRA", { type: "EXTRA", energyCost: 2, colors: ["Red"], power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." });
  DEFS.C907EXTRAUSE = card("C907EXTRAUSE", { energyCost: 0, skill: "[Auto] When this card is played, the next time you activate a red Extra in your hand during this turn, reduce the energy cost by 1." });
  let e = stagedG({ hand: ["C907EXTRAUSE", "C907EXTRA", "C907EXTRA"], energy: ["V1", "V1", "V1", "V1"] });
  e = pay(playG(e, { type: "play", player: "p1", card: findG(e, "p1", "hand", "C907EXTRAUSE") }));
  const extras = zoneOf(e, "p1", "hand").filter((id) => e.cards[id].cardId === "C907EXTRA");
  const activate = (st: EngineState, id: string) => actsG(st).find((a) => a.type === "activate" && a.card === id) as Action;
  e = pay(playG(e, activate(e, extras[0])));
  assert.equal(rested(e), 1, "the Extra's energy cost was 2 less 1");
  assert.equal(playCostG(e, extras[1]).total, 2, "and the change is gone");
}

// ── the board: a skill line's own price ─────────────────────────────────────
{
  const line = (energyCost: Skill["energyCost"], keyword: Skill["keyword"], extra: Partial<Skill> = {}): Skill => ({
    index: 0, kind: keyword ? "keyword" : "activate:main", tags: [], keyword, cost: "", effect: "", oncePerTurn: false, limit: null, bond: null, sparking: null, burst: null, spiritBoost: null, markerCost: null, energyCost, energyEither: [], raw: "", ...extra,
  });
  const arrival = line({ Red: 2 }, { name: "Arrival", colors: ["Red"] });
  const swap = line({ Red: 2 }, { name: "Swap", x: 3 });
  const exEvolve = line({ Red: 2 }, { name: "Evolve", variant: "EX-Evolve" });
  const xeno = line({ Red: 2 }, { name: "Evolve", variant: "Xeno-Evolve" });
  const orbs = (s: EngineState, id: string, sk: Skill) => skillOrbs(CTX, DBS_DEFINITION, s, id, sk);
  const fresh = () => {
    const s = stagedG({ hand: ["V1", "V1"] });
    return { s, a: zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "V1")[0], b: zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "V1")[1] };
  };
  const put = (s: EngineState, e: Partial<ContinuousEffect> & { target: string; kind: ContinuousEffect["kind"]; value: number }) => {
    addEffectG(s, [], { until: "turn", master: "p1", ...e } as never);
    return (s as unknown as { effects: ContinuousEffect[] }).effects.at(-1)!;
  };

  // A tagged change reaches that keyword's line and no other.
  {
    const { s, a } = fresh();
    put(s, { target: a, kind: "skillCost", value: 1, colors: ["Red"], tag: "arrival", uses: 1 });
    assert.equal(orbs(s, a, arrival).total, 1, "the [Arrival] line is a red orb cheaper");
    assert.equal(orbs(s, a, swap).total, 2, "a [Swap] line of the same card is not");
    spendSkillCostUses(CTX, DBS_DEFINITION, s as never, [], a, swap);
    assert.equal(orbs(s, a, arrival).total, 1, "paying the [Swap] spent nothing");
    spendSkillCostUses(CTX, DBS_DEFINITION, s as never, [], a, arrival);
    assert.equal(orbs(s, a, arrival).total, 2, "paying the [Arrival] spent the one use");
  }
  // [EX-Evolve] is the Evolve channel narrowed to its variant (22-5-2-2).
  {
    const { s, a } = fresh();
    put(s, { target: a, kind: "evolveCost", value: 1, colors: ["Red"], tag: "ex-evolve" });
    assert.equal(orbs(s, a, exEvolve).total, 1);
    assert.equal(orbs(s, a, xeno).total, 2, "[Xeno-Evolve] is another variant");
    put(s, { target: a, kind: "evolveCost", value: 1, colors: ["Red"] });
    assert.equal(orbs(s, a, xeno).total, 1, "an untagged [Evolve] change reaches all three");
  }
  // One "next time" is one use, however many cards it reached.
  {
    const { s, a, b } = fresh();
    const first = put(s, { target: a, kind: "skillCost", value: 1, colors: ["Red"], tag: "arrival", uses: 1 });
    first.group = first.id;
    put(s, { target: b, kind: "skillCost", value: 1, colors: ["Red"], tag: "arrival", uses: 1, group: first.id });
    spendSkillCostUses(CTX, DBS_DEFINITION, s as never, [], a, arrival);
    assert.equal(orbs(s, b, arrival).total, 2, "the other card's copy of the same change went with it");
    assert.deepEqual((s as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "skillCost"), []);
  }
  // 5-8-2-4: colour against {1}.
  {
    const { s, a } = fresh();
    const mixed = line({ Red: 1, any: 1 }, null);
    put(s, { target: a, kind: "skillCost", value: 1, colors: ["any"], skillKind: "activate" });
    assert.deepEqual([orbs(s, a, mixed).total, orbs(s, a, mixed).orbs], [1, { Red: 1 }], "{1} takes the colourless orb");
    const redOnly = line({ Red: 2 }, null);
    assert.equal(orbs(s, a, redOnly).total, 2, "{1} does nothing to a cost of coloured orbs");
    const f2 = fresh();
    put(f2.s, { target: f2.a, kind: "skillCost", value: 1, colors: ["Red"], skillKind: "activate" });
    assert.deepEqual([orbs(f2.s, f2.a, mixed).total, orbs(f2.s, f2.a, mixed).orbs], [1, {}], "{r} takes the red orb and leaves the colourless one");
    assert.equal(orbs(f2.s, f2.a, line({ any: 2 }, null)).total, 2, "{r} does nothing to a cost of colourless orbs");
    const f3 = fresh();
    put(f3.s, { target: f3.a, kind: "skillCost", value: 1, colors: ["Blue"], skillKind: "activate" });
    assert.equal(orbs(f3.s, f3.a, redOnly).total, 2, "{u} does nothing to a red orb");
    const f4 = fresh();
    put(f4.s, { target: f4.a, kind: "skillCost", value: 1, skillKind: "activate" });
    assert.equal(orbs(f4.s, f4.a, redOnly).total, 1, "a bare number is no symbol: the legacy order, coloured first");
  }
  // A [Permanent]'s standing reduction of a named card's [Activate] line.
  {
    DEFS.C907LINE = card("C907LINE", { energyCost: 1, skill: "[Activate: Main] {r}{r}{1}: Draw 1 card." });
    DEFS.C907AURA = card("C907AURA", { energyCost: 0, skill: "[Permanent] When you activate an [Activate: Main/Battle] skill on {C907LINE} in your hand, reduce the skill cost by {r}{1}." });
    const bare = stagedG({ hand: ["C907LINE"] });
    const lineId = findG(bare, "p1", "hand", "C907LINE");
    const sk = parseSkills(DEFS.C907LINE.skill!)[0] as Skill;
    assert.equal(orbs(bare, lineId, sk).total, 3);
    const aura = stagedG({ hand: ["C907LINE"], battle: ["C907AURA"] });
    assert.equal(orbs(aura, findG(aura, "p1", "hand", "C907LINE"), sk).total, 1, "{r}{1} less, standing");
  }
}

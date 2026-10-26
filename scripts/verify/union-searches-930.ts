/**
 * #930, the two searches for "the revealed card's [Union] characters" and the
 * variant-exact "[union-fusion] skill" beside them:
 *
 *  - EX13-14 front#10 — Gokule, the Legendary Fusion Warrior: "[activate:
 *    main]{g}, place this card in its owner's Drop Area, then choose 1 card in
 *    your hand with a [union-fusion] skill and reveal it: For each character
 *    name required for the revealed card's [union] skill, add up to 1 card with
 *    a matching character name and energy cost between 3 and 7 from your deck
 *    to your hand, then shuffle your deck." The price reads (`reveal it` after
 *    a choice of your own hand cards is a reveal of that card), and the search
 *    is one `choose` of up to 1 card per name the revealed card's
 *    [Union-Fusion] requires (`unionNameOf: revealed`), each card filling a
 *    name of its own.
 *  - EX13-14 front#0: "…add up to 1 green card with an energy cost of 6 or less
 *    and a [union-fusion] skill from your deck…": a [union-fusion] skill is
 *    that variant (`keywordsExact: Union-Fusion`), not any [Union].
 *  - SD19-03 front#20 — SS3 Gogeta, Carefree Combatant: "[+1][Activate: Main]
 *    Place 1 card from your hand at the bottom of your deck, then reveal 1 card
 *    with [Union-Fusion] in your hand: Add up to 1 Battle Card each from your
 *    deck and/or Drop to your hand, each with a character name that matches the
 *    [Union] skill conditions of the revealed card and an energy cost between 3
 *    and 7, then shuffle your deck if you looked through it." One choice per
 *    place — up to 1 from the deck, then up to 1 from the Drop — each a Battle
 *    Card with one of the revealed card's [Union] names (the same name may come
 *    from both places).
 *
 * Owner rulings of 26 Oct 2026 (#930): "up to 1" is per name (EX13-14);
 * SD19-03's "each" is one per place (deck, Drop); only the character name of
 * the [Union] conditions is matched, exactly (2-10-1-1), the printed energy
 * cost still applies.
 *
 * Proved here: the records (nothing unread, the JSON round trip, the rules
 * language's print and reparse), and in the VM for both seats with every step
 * reloaded from JSON — only matching cards are offered, the chosen cards reach
 * the hand, the decoys stay. Printed texts: docs/arena-backlog/evidence/923/
 * inventory.json and docs/rules-audit-2026-10-15/audit.json (catalog snapshot
 * of 15 Oct 2026).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts ────────────────────────────────────────────────────────────
const EX13_14_F0 = "[auto] When this card is played, add up to 1 green card with an energy cost of 6 or less and a [union-fusion] skill from your deck to your hand, then shuffle your deck.";
const EX13_14_F10 =
  "[activate: main]{g}, place this card in its owner's Drop Area, then choose 1 card in your hand with a [union-fusion] skill and reveal it: For each character name required for the revealed card's [union] skill, add up to 1 card with a matching character name and energy cost between 3 and 7 from your deck to your hand, then shuffle your deck.";
const SD19_03_F10 = "[Auto][Once per turn] When you activate a [Union] skill, add a marker to this card.";
const SD19_03_F20 =
  "[+1][Activate: Main] Place 1 card from your hand at the bottom of your deck, then reveal 1 card with [Union-Fusion] in your hand: Add up to 1 Battle Card each from your deck and/or Drop to your hand, each with a character name that matches the [Union] skill conditions of the revealed card and an energy cost between 3 and 7, then shuffle your deck if you looked through it.";
const FUSION = "[Union-Fusion]{g}{g}{1}, draw 1 card: Green <Son Goku> card and green <Vegeta> card.";
const POTARA = "[Union-Potara]{g}{g}: Green <Son Goku> and green <Vegeta>.";

const bat = (id: string, characters: string[], energyCost: number, o: Partial<CardDef> = {}) => card(id, { colors: ["Green"], characters, energyCost, power: 10000, skill: null, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "L-GRN": card("L-GRN", { type: "LEADER", colors: ["Green"], characters: ["Gogeta"], power: 10000, energyCost: null, skill: null }),
  EX1314: card("EX1314", { colors: ["Green"], characters: ["Gokule"], energyCost: 2, power: 15000, skill: `${EX13_14_F0}\n${EX13_14_F10}` }),
  SD1903: card("SD1903", { type: "UNISON", colors: ["Red"], characters: ["SS3 Gogeta"], energyCost: "X", power: 15000, comboCost: null, comboPower: null, skill: `${SD19_03_F10}\n${SD19_03_F20}` }),
  // The cards revealed: a [Union-Fusion] needing <Son Goku> and <Vegeta>, and a [Union-Potara] that is no [union-fusion].
  FUS: bat("FUS", ["Gogeta"], 6, { power: 35000, skill: FUSION }),
  POT: bat("POT", ["Vegito"], 6, { power: 35000, skill: POTARA }),
  // What the searches find, and the decoys beside them.
  "GOKU-4": bat("GOKU-4", ["Son Goku"], 4),
  "GOKU-5": bat("GOKU-5", ["Son Goku"], 5),
  "VEG-6": bat("VEG-6", ["Vegeta"], 6),
  "GOKU-2": bat("GOKU-2", ["Son Goku"], 2),
  "VEG-8": bat("VEG-8", ["Vegeta"], 8),
  "TRUNKS-4": bat("TRUNKS-4", ["Trunks"], 4),
  "XENO-4": bat("XENO-4", ["Son Goku: Xeno"], 4),
  "VEG-EXTRA": card("VEG-EXTRA", { type: "EXTRA", colors: ["Green"], characters: ["Vegeta"], energyCost: 4, power: null, comboCost: null, comboPower: null, skill: null }),
  "G-E": bat("G-E", ["Filler"], 1),
};

// ── 1. the records ───────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
/** The one record of `line`, through the stored-row JSON round trip and the rules language's print and reparse. */
const only = (def: CardDef): Rec => {
  const recs = skillRecords(def);
  assert.equal(recs.length, 1, `${def.id}: one record`);
  const rule = asRule(recs[0]);
  assert.equal(validateRule(rule, recs[0].kind), null, `${def.id}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${def.id}: the rules language prints and reparses it`);
  const plain = (v: unknown) =>
    JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
      if (k === "upTo" && x === false) return undefined;
      if (k === "area" && Array.isArray(this.areas) && this.areas[0] === x) return undefined;
      return x;
    }));
  assert.deepEqual(plain(round.value), plain(rule), `${def.id}: …unchanged`);
  return recs[0];
};
const noFilterNoise = (f: unknown) => Object.fromEntries(Object.entries((f ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)));
{
  const r = only(card("EX13-14", { skill: EX13_14_F10 }));
  assert.deepEqual(r.unread, [], "EX13-14 front#10: nothing unread");
  const price = r.cost?.program ?? [];
  assert.deepEqual(price.map((o) => o.op), ["moveTo", "choose", "reveal"], "the price: this card to the Drop, a choice, its reveal");
  const [drop, pick, show] = price;
  assert.ok(drop.op === "moveTo" && drop.to === "drop" && "sel" in drop.target && drop.target.sel.special === "self");
  if (pick.op !== "choose" || !("side" in pick.sel)) throw new Error("a description");
  assert.equal(pick.sel.area, "hand");
  assert.deepEqual(noFilterNoise(pick.sel.filter), { keywords: ["Union"], keywordsExact: ["Union-Fusion"] }, "a card with a [union-fusion] skill");
  assert.ok(show.op === "reveal" && show.sel.fromVar === pick.as && show.as === "revealed", "…and reveal it");
  assert.deepEqual(r.cost?.orbs, { Green: 1 });
  const [search, move, shuffle] = r.ops;
  if (search.op !== "choose" || !("side" in search.sel)) throw new Error("a description");
  assert.equal(search.sel.area, "deck");
  assert.equal(search.sel.count, 1);
  assert.equal(search.sel.upTo, true, "up to 1 per name");
  assert.equal(search.sel.eachUnionName, true, "…for each character name");
  assert.deepEqual(noFilterNoise(search.sel.filter), { costMin: 3, costMax: 7, unionNameOf: "revealed" }, "a matching character name, energy cost 3 to 7");
  assert.ok(move.op === "moveTo" && move.to === "hand" && "var" in move.target && move.target.var === search.as);
  assert.equal(shuffle.op, "shuffle");
}
{
  const r = only(card("EX13-14", { skill: EX13_14_F0 }));
  assert.deepEqual(r.unread, []);
  const [search] = r.ops;
  if (search.op !== "choose" || !("side" in search.sel)) throw new Error("a description");
  assert.deepEqual(noFilterNoise(search.sel.filter), { colors: ["Green"], keywords: ["Union"], keywordsExact: ["Union-Fusion"], costMax: 6 }, "EX13-14 front#0: a [union-fusion] skill, not any [Union]");
}
{
  const r = only(card("SD19-03", { type: "UNISON", skill: SD19_03_F20 }));
  assert.deepEqual(r.unread, [], "SD19-03 front#20: nothing unread");
  const price = r.cost?.program ?? [];
  const show = price.at(-1)!;
  assert.ok(show.op === "reveal" && show.as === "revealed" && "side" in show.sel, "the price reveals a card in the hand");
  assert.deepEqual(noFilterNoise((show.sel as { filter?: unknown }).filter), { keywords: ["Union"], keywordsExact: ["Union-Fusion"] }, "…with [Union-Fusion]");
  const [fromDeck, fromDrop, moveA, moveB, shuffle] = r.ops;
  for (const [ch, area] of [[fromDeck, "deck"], [fromDrop, "drop"]] as const) {
    if (ch.op !== "choose" || !("side" in ch.sel)) throw new Error("a description");
    assert.equal(ch.sel.area, area, `one choice from the ${area}`);
    assert.equal(ch.sel.areas, undefined);
    assert.equal(ch.sel.count, 1);
    assert.equal(ch.sel.upTo, true, "up to 1");
    assert.equal(ch.sel.eachUnionName, undefined, "one per place, not per name");
    assert.deepEqual(noFilterNoise(ch.sel.filter), { type: "BATTLE", costMin: 3, costMax: 7, unionNameOf: "revealed" }, "a Battle Card whose name matches, energy cost 3 to 7");
  }
  assert.deepEqual([moveA, moveB].map((m) => m.op === "moveTo" && m.to), ["hand", "hand"]);
  assert.equal(shuffle.op, "shuffle");
}
{
  // BT6-105 front#10 and back#0: the same "choose 1 … from your hand and reveal it" price, now readable.
  for (const line of [
    "[Activate: Main] [Once per turn] Choose 1 {Four-Star Ball} from your hand and reveal it: Draw 1 card and this card gets +5000 power for the duration of the turn.",
    "[Activate: Main][Once per turn] Choose 1 {Four-Star Ball} from your hand and reveal it: Draw 2 cards, then choose 1 card from your hand and place it in your Drop Area.",
  ]) {
    const r = only(card("BT6-105", { type: "LEADER", skill: line }));
    assert.deepEqual(r.unread, [], "BT6-105: nothing unread");
    const [pick, show] = r.cost?.program ?? [];
    if (pick?.op !== "choose" || !("side" in pick.sel)) throw new Error("a choice");
    assert.deepEqual([pick.sel.area, noFilterNoise(pick.sel.filter)], ["hand", { names: ["Four-Star Ball"] }]);
    assert.ok(show?.op === "reveal" && show.sel.fromVar === pick.as, "…and reveal it");
  }
}
{
  // SD19-03's other line was read before and is not changed.
  const r = only(card("SD19-03", { type: "UNISON", skill: SD19_03_F10 }));
  assert.deepEqual(r.unread, []);
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
/** `turn`'s Main Phase, hands and energy emptied back into the decks. */
function fresh(seat: PlayerId, seed: number): VmState {
  const leaders = { p1: seat === "p1" ? "L-GRN" : "L-BLUE", p2: seat === "p2" ? "L-GRN" : "L-BLUE" };
  let s = RULES.createGame(ctx, {
    seed,
    p1: { name: "First", leader: leaders.p1, main: fifty("V1") },
    p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") },
  }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[])
    s = take(s, action);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  staged.clear();
  return s;
}
const staged = new Set<string>();
function stage(s: VmState, p: PlayerId, def: string, area: string, markers?: number): string {
  const deck = s.sides[p].zones.deck;
  const id = area === "deck" ? deck.find((c) => !staged.has(c))! : deck.at(-1)!;
  staged.add(id);
  s.cards[id].cardId = def;
  if (area !== "deck") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  if (markers !== undefined) s.cards[id].markers = markers;
  s.pending = [];
  return id;
}
const lineOf = (def: string, pred: (sk: ReturnType<typeof parseSkills>[number]) => boolean) => parseSkills(defs[def].skill!).find(pred)!.index;
const activateLine = (def: string) => lineOf(def, (sk) => sk.kind.startsWith("activate"));
const offer = (s: VmState, c: string, skill: number) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === skill);
type Ask = Extract<VmState["prompt"], { kind: "chooseCards" }>;

/** Answer every question until back at the Main Phase; `pick` answers the card choices. */
function settle(s0: VmState, pick: (q: Ask) => string[]): VmState {
  let s = s0;
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: pick(q) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `back at the Main Phase (at ${s.prompt.kind})`);
  return s;
}
const sorted = (xs: readonly string[]) => xs.slice().sort();

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = (n: number) => 9930 + n * 2 + (seat === "p1" ? 0 : 1);
  const zones = (s: VmState) => s.sides[seat].zones;

  // ── EX13-14 front#10 ──
  // (a) The Fusion is revealed (the Potara beside it is not on offer); the search offers only the
  // Son Goku and Vegeta cards of cost 3 to 7, one card per name; both reach the hand, decoys stay.
  {
    let s = fresh(seat, seed(0));
    stage(s, seat, "G-E", "energy");
    const gokule = stage(s, seat, "EX1314", "battle");
    const fus = stage(s, seat, "FUS", "hand");
    const pot = stage(s, seat, "POT", "hand");
    const goku4 = stage(s, seat, "GOKU-4", "deck");
    const goku5 = stage(s, seat, "GOKU-5", "deck");
    const veg6 = stage(s, seat, "VEG-6", "deck");
    const decoys = ["GOKU-2", "VEG-8", "TRUNKS-4", "XENO-4"].map((d) => stage(s, seat, d, "deck"));
    const a = offer(s, gokule, activateLine("EX1314"));
    assert.ok(a, `${seat}: EX13-14's [Activate: Main] is offered`);
    const asked: string[][] = [];
    s = settle(take(s, a.action), (q) => {
      const c = sorted(q.choice.candidates);
      asked.push(c);
      if (c.includes(fus)) {
        assert.ok(!c.includes(pot), "the [Union-Potara] card is no card with a [union-fusion] skill");
        return [fus];
      }
      return c.includes(goku4) ? [goku4] : c.slice(0, 1);
    });
    assert.ok(zones(s).drop.includes(gokule), "the price: EX13-14 is in the Drop");
    assert.ok(zones(s).hand.includes(fus) && zones(s).hand.includes(pot), "the revealed card stays in the hand");
    assert.ok(asked.some((c) => JSON.stringify(c) === JSON.stringify(sorted([goku4, goku5, veg6]))), "first pick: only Son Goku / Vegeta of cost 3 to 7");
    assert.ok(asked.some((c) => JSON.stringify(c) === JSON.stringify([veg6])), "second pick: the Son Goku slot is filled, only the Vegeta is left");
    assert.ok(zones(s).hand.includes(goku4) && zones(s).hand.includes(veg6), "both chosen cards reach the hand");
    assert.ok(zones(s).deck.includes(goku5), "a second Son Goku is not taken");
    for (const d of decoys) assert.ok(zones(s).deck.includes(d), "the decoys stay in the deck");
    cases++;
  }
  // (b) With only a [Union-Potara] card in hand, the price cannot be paid: not offered.
  {
    const s = fresh(seat, seed(1));
    stage(s, seat, "G-E", "energy");
    const gokule = stage(s, seat, "EX1314", "battle");
    stage(s, seat, "POT", "hand");
    assert.equal(offer(s, gokule, activateLine("EX1314")), undefined, `${seat}: no [union-fusion] card to reveal, not offered`);
    cases++;
  }
  // (c) "Up to": the player may stop after one card.
  {
    let s = fresh(seat, seed(2));
    stage(s, seat, "G-E", "energy");
    const gokule = stage(s, seat, "EX1314", "battle");
    const fus = stage(s, seat, "FUS", "hand");
    const goku4 = stage(s, seat, "GOKU-4", "deck");
    const veg6 = stage(s, seat, "VEG-6", "deck");
    const a = offer(s, gokule, activateLine("EX1314"));
    assert.ok(a);
    let searched = 0;
    s = settle(take(s, a.action), (q) => {
      if (q.choice.candidates.includes(fus)) return [fus];
      assert.equal(q.choice.min, 0, "up to: may take none");
      return searched++ === 0 ? [veg6] : [];
    });
    assert.ok(zones(s).hand.includes(veg6) && zones(s).deck.includes(goku4), "one taken, the other left");
    cases++;
  }

  // ── EX13-14 front#0 ── a [union-fusion] card found, the [Union-Potara] one not.
  {
    let s = fresh(seat, seed(3));
    for (let i = 0; i < 2; i++) stage(s, seat, "G-E", "energy");
    const gokule = stage(s, seat, "EX1314", "hand");
    const fus = stage(s, seat, "FUS", "deck");
    const pot = stage(s, seat, "POT", "deck");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card?: string }).card === gokule);
    assert.ok(play, `${seat}: EX13-14 can be played`);
    const asked: string[][] = [];
    s = settle(take(s, play.action), (q) => {
      asked.push(sorted(q.choice.candidates));
      return q.choice.candidates.includes(fus) ? [fus] : q.choice.candidates.slice(0, Math.max(1, q.choice.min));
    });
    assert.ok(asked.some((c) => c.includes(fus) && !c.includes(pot)), "only the [Union-Fusion] card is offered");
    assert.ok(zones(s).hand.includes(fus) && zones(s).deck.includes(pot));
    cases++;
  }

  // ── SD19-03 front#20 ── (owner ruling of 26 Oct 2026: up to 1 from the deck and up to 1 from the Drop)
  /** Stage SD19-03 with a card to put under the deck and the two [Union] cards in hand; activate it. */
  const sd = (n: number, deckCards: string[], dropCards: string[], answer: (q: Ask, asked: string[][]) => string[]) => {
    let s = fresh(seat, seed(n));
    const gogeta = stage(s, seat, "SD1903", "unison", 1);
    const fodder = stage(s, seat, "G-E", "hand");
    const fus = stage(s, seat, "FUS", "hand");
    const pot = stage(s, seat, "POT", "hand");
    const deck = deckCards.map((d) => stage(s, seat, d, "deck"));
    const drop = dropCards.map((d) => stage(s, seat, d, "drop"));
    const a = offer(s, gogeta, activateLine("SD1903"));
    assert.ok(a, `${seat}: SD19-03's [+1][Activate: Main] is offered`);
    const asked: string[][] = [];
    s = settle(take(s, a.action), (q) => {
      const c = sorted(q.choice.candidates);
      if (c.includes(fodder) && c.includes(fus)) return [fodder];
      if (c.includes(fus)) {
        assert.ok(!c.includes(pot), "the [Union-Potara] card cannot be revealed");
        return [fus];
      }
      asked.push(c);
      assert.equal(q.choice.max, 1, "one card from each place");
      return answer(q, asked);
    });
    assert.ok(zones(s).deck.includes(fodder) && !zones(s).hand.includes(fodder), "the price: the card went from the hand to the deck");
    assert.equal(s.cards[gogeta].markers, 2, "[+1]");
    assert.ok(zones(s).hand.includes(fus), "the revealed card stays in the hand");
    return { s, deck, drop, asked };
  };
  // (a) One from the deck and one from the Drop; only matching Battle Cards of cost 3 to 7 offered.
  {
    const { s, deck: [goku4, veg5Deck, goku2Deck], drop: [veg6, extra, goku2, trunks], asked } = sd(4, ["GOKU-4", "VEG-6", "GOKU-2"], ["VEG-6", "VEG-EXTRA", "GOKU-2", "TRUNKS-4"], (q) => [sorted(q.choice.candidates)[0]]);
    assert.deepEqual(asked[0], sorted([goku4, veg5Deck]), "from the deck: the Son Goku and the Vegeta of cost 3 to 7");
    assert.deepEqual(asked[1], [veg6], "from the Drop: only the Vegeta Battle Card of cost 6");
    const tookFromDeck = asked[0][0];
    assert.ok(zones(s).hand.includes(tookFromDeck) && zones(s).hand.includes(veg6), "one from the deck and one from the Drop reach the hand");
    assert.ok(zones(s).deck.includes(asked[0][1]), "the second deck card is not taken: only one from the deck");
    assert.ok(zones(s).deck.includes(goku2Deck));
    for (const d of [extra, goku2, trunks]) assert.ok(zones(s).drop.includes(d), "the Extra, the cost-2 Goku and the Trunks stay in the Drop");
    cases++;
  }
  // (b) Two from the deck refused: handing both deck cards at once still takes only one, or is refused.
  {
    let s = fresh(seat, seed(5));
    const gogeta = stage(s, seat, "SD1903", "unison", 1);
    const fodder = stage(s, seat, "G-E", "hand");
    const fus = stage(s, seat, "FUS", "hand");
    const goku4 = stage(s, seat, "GOKU-4", "deck");
    const veg6 = stage(s, seat, "VEG-6", "deck");
    const a = offer(s, gogeta, activateLine("SD1903"));
    assert.ok(a);
    s = take(s, a.action);
    for (let i = 0; i < 10 && s.prompt.kind === "chooseCards"; i++) {
      const q = s.prompt as Ask;
      const c = q.choice.candidates;
      if (c.includes(goku4)) break;
      s = take(s, { type: "choose", player: q.player, cards: [c.includes(fodder) && c.includes(fus) ? fodder : fus] });
    }
    const q = s.prompt as Ask;
    assert.equal(q.kind, "chooseCards");
    assert.deepEqual(sorted(q.choice.candidates), sorted([goku4, veg6]), "the deck choice");
    let both: VmState | null = null;
    try {
      both = take(s, { type: "choose", player: q.player, cards: [goku4, veg6] });
    } catch {
      both = null;
    }
    if (both) {
      const done = settle(both, (qq) => (qq.choice.min ? qq.choice.candidates.slice(0, qq.choice.min) : []));
      assert.ok(!(zones(done).hand.includes(goku4) && zones(done).hand.includes(veg6)), "two cards from the deck are never both taken");
    }
    cases++;
  }
  // (c) The same name from both places: a Son Goku from the deck and a Son Goku from the Drop.
  {
    const { s, deck: [goku4], drop: [goku5], asked } = sd(6, ["GOKU-4"], ["GOKU-5"], (q) => q.choice.candidates.slice(0, 1));
    assert.deepEqual(asked, [[goku4], [goku5]], "a Son Goku offered from each place");
    assert.ok(zones(s).hand.includes(goku4) && zones(s).hand.includes(goku5), "both Son Goku cards reach the hand");
    cases++;
  }
}

console.log(`union-searches-930: EX13-14 front#0/#10, SD19-03 front#20 — records and ${cases} both-seat reload cases`);

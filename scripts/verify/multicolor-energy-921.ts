/**
 * #921: BT7-005, BT7-029, BT7-058, BT7-078 — "[Permanent] If a multicolored
 * card is in your energy, reduce the energy cost of this card in your hand by
 * 1." Printed text (Bandai card list, read 16 Oct 2026) -> compile -> stored-row
 * JSON round-trip -> the real VM, on both seats, in a Main Phase play and in a
 * [Counter: Play] window.
 *
 * The owner's reading (15 Oct 2026): the qualifying card must itself have two
 * colours or more; two different monocoloured energy cards do not make one; and
 * the reduction is one flat 1 while at least one qualifying card is in the
 * energy — not 1 per such card.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const PERMANENT = "[Permanent] If a multicolored card is in your energy, reduce the energy cost of this card in your hand by 1.";
/** The four cards as printed (Bandai card list; icon alt texts are the bracketed keywords). */
const PRINTED: Record<string, { name: string; color: Color; skill: string }> = {
  "BT7-005": { name: "Machspeed Kaio-Ken Son Goku", color: "Red", skill: `[Counter: Play] Play this card.<br>${PERMANENT}<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the duration of the turn. Then, if it's your opponent's turn, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the duration of the turn.` },
  "BT7-029": { name: "Undying Spirit Son Gohan", color: "Blue", skill: `[Counter: Play] Play this card.<br>${PERMANENT}<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less, and return it to its owner's hand. Then, if it's your opponent's turn, choose up to 1 of your blue energy and switch it to Active Mode.` },
  "BT7-058": { name: "Vegeta the Cruel", color: "Green", skill: `[Counter: Play] Play this card.<br>${PERMANENT}<br>[Auto] When you play this card during your opponent's turn, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less, KO it, then your opponent chooses 1 card in their hand and sends it to their Warp.` },
  "BT7-078": { name: "Champa the Trickster", color: "Yellow", skill: `[Counter: Play] Play this card.<br>${PERMANENT}<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], switch it to Rest Mode, then draw 1 card if it's your opponent's turn.` },
};
const IDS = Object.keys(PRINTED);
const COLORS: Color[] = ["Red", "Blue", "Green", "Yellow", "Black"];
const FODDER = ["OWN", "A", "B", "MC", "MC2"] as const;
type Token = (typeof FODDER)[number];
const fodder = (token: Token, id: string) => `${token}-${PRINTED[id].color}-921`;
const defs: Record<string, CardDef> = { ...DEFS,
  // Energy fodder per colour of the card played (its own colour must be there to pay it): a plain card of that colour
  // (OWN), two plain cards of other colours (A, B), a two-coloured card that includes it (MC) and another two-coloured one (MC2).
  ...Object.fromEntries(FODDER.flatMap((token) => COLORS.map((c, i) => {
    const colors = ({ OWN: [c], A: [COLORS[(i + 1) % 5]], B: [COLORS[(i + 2) % 5]], MC: [c, COLORS[(i + 1) % 5]], MC2: [COLORS[(i + 2) % 5], COLORS[(i + 3) % 5]] } as Record<string, Color[]>)[token];
    return [`${token}-${c}-921`, card(`${token}-${c}-921`, { colors, energyCost: 0, power: 5000, skill: null })];
  }))),
  RED921: card("RED921", { colors: ["Red"], energyCost: 0, power: 5000, skill: null }),
  FOE921: card("FOE921", { colors: ["Red"], energyCost: 1, power: 30000, skill: null }),
  ...Object.fromEntries(IDS.map((id) => [id, card(id, { name: PRINTED[id].name, colors: [PRINTED[id].color], energyCost: 3, power: 15000, skill: PRINTED[id].skill })])),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
for (const id of IDS) {
  const perm = skillRecords(defs[id]).find((r) => r.kind === "permanent")!;
  assert.deepEqual(perm.unread, [], `${id}: the whole [Permanent] reads`);
  const cond = roundtrip(perm.cond) as { kind: string; atLeast: number; sel: { side: string; area: string; count?: number } };
  assert.equal(cond.kind, "count"); assert.equal(cond.atLeast, 1, `${id}: at least one`);
  assert.equal(cond.sel.side, "you"); assert.equal(cond.sel.area, "energy");
  const filter = (perm.cond as { sel: { filter: { multiColor: boolean; monoColor: boolean; colors: string[] } } }).sel.filter;
  assert.equal(filter.multiColor, true, `${id}: the card itself is multicoloured`);
  assert.equal(filter.monoColor, false); assert.deepEqual(filter.colors, []);
  assert.equal(perm.ops.length, 1);
  const op = perm.ops[0] as { op: string; amount: number; target: unknown; until: string };
  assert.equal(op.op, "costReduction"); assert.equal(op.amount, 1, "a flat 1, not a count");
  assert.deepEqual(op.target, { sel: { special: "self", area: "hand" } }, "this card, in the hand only");
  // The Counter line and the printed Autos keep their own readings; the Autos are not claimed here.
  const counterRow = skillRecords(defs[id]).find((r) => r.kind === "counter:play");
  assert.ok(counterRow && counterRow.unread.length === 0, `${id}: [Counter: Play] reads`);
}
{
  // The wording variants of the same condition read the same way, and a monocolour card in energy is another sentence.
  const read = (text: string) => skillRecords(card("W921", { skill: text }))[0];
  const a = read("[Permanent] If there is a multicolored card in your energy, reduce the energy cost of this card in your hand by 1.");
  const b = read(PERMANENT);
  assert.deepEqual(a.cond, b.cond, "'there is' and 'is in' say one thing");
  const c = read("[Permanent] If a multicolored card is in your Energy Area, reduce the energy cost of this card in your hand by 1.");
  assert.deepEqual(c.cond, b.cond, "'your Energy Area' too");
  const d = read("[Permanent] If a multicolored card is in your opponent's energy, reduce the energy cost of this card in your hand by 1.");
  assert.notDeepEqual(d.cond, b.cond, "the opponent's energy is no spelling of your own");
  assert.ok(!(d.cond && "sel" in d.cond && (d.cond.sel as { side?: string }).side === "you"), "and is never read as 'you'");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 921, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "energy" || area === "battle") s.cards[id].mode = mode;
  return id;
}
/** The owner's hand and energy are emptied of whatever the deal put there, so the board holds exactly what a case names. */
function clear(s: VmState, p: PlayerId): void {
  for (const area of ["hand", "energy"]) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p, position: "bottom" }).ok);
}
const restCount = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((id) => s.cards[id].mode === "rest").length;
const price = (s: VmState, id: string) => Number(attrsNow(ctx, game, s, id).costOf);
const legalFor = (s: VmState, type: "play" | "counter", id: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === type && (l.action as { card?: string }).card === id);

/** The energy a case holds: [fodder token, mode]. Always 3 cards, so a 3-cost card is payable either way. */
type Energy = [Token, ("active" | "rest")?][];
const CASES: { name: string; energy: Energy; foe?: Token[]; ownOutside?: string[]; discounted: boolean }[] = [
  { name: "one multicolour energy card", energy: [["MC"], ["OWN"], ["OWN"]], discounted: true },
  { name: "two multicolour energy cards (flat, not per card)", energy: [["MC"], ["MC2"], ["OWN"]], discounted: true },
  { name: "three multicolour energy cards", energy: [["MC"], ["MC2"], ["MC"]], discounted: true },
  { name: "a multicolour card in Rest Mode", energy: [["MC", "rest"], ["OWN"], ["OWN"]], discounted: true },
  { name: "two different monocolour cards", energy: [["OWN"], ["A"], ["B"]], discounted: false },
  { name: "multicolour card in the opponent's energy only", energy: [["OWN"], ["A"], ["B"]], foe: ["MC"], discounted: false },
  { name: "multicolour card outside energy (hand, Drop, Battle Area)", energy: [["OWN"], ["A"], ["B"]], ownOutside: ["hand", "drop", "battle"], discounted: false },
];


/** Answer what a play or counter asks until the table is quiet: the payment (every offered way costs `want`), then the Auto's optional choices (declined). Returns the energy rested by the payment. */
function settle(s: VmState, p: PlayerId, want: number, label: string): { s: VmState; paid: number } {
  let paid = -1;
  for (let i = 0; i < 12; i++) {
    const q = s.prompt;
    if (q.kind === "payCost") {
      assert.equal(q.player, p, `${label}: the player pays`);
      for (const option of q.options) { assert.equal(option.rest.length + option.markers, want, `${label}: every way to pay is worth ${want} (energy rested plus the Energy markers the second player holds)`); }
      paid = q.options[0].rest.length;
      s = take(s, { type: "payCost", player: p, option: 0 });
    } else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: [] });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else break;
  }
  return { s, paid };
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  for (const id of IDS) {
    for (const c of CASES) {
      const want = c.discounted ? 2 : 3;
      const stageBoard = (s: VmState, owner: PlayerId, rival: PlayerId) => {
        clear(s, owner); clear(s, rival);
        const target = stage(s, owner, id, "hand");
        const energy = c.energy.map(([token, mode]) => stage(s, owner, fodder(token, id), "energy", mode ?? "active"));
        for (const area of c.ownOutside ?? []) stage(s, owner, fodder("MC", id), area);
        for (const token of c.foe ?? []) stage(s, rival, fodder(token, id), "energy");
        return { target, energy };
      };
      const free = c.energy.filter(([, mode]) => mode !== "rest").length;
      const resting = c.energy.length - free;
      // ── ordinary play in the Main Phase ────────────────────────────────────
      {
        const s = fresh(seat);
        const { target, energy } = stageBoard(s, seat, foe);
        const label = `${seat}/${id}/${c.name}/main`;
        assert.equal(price(s, target), want, `${label}: the cost in hand`);
        assert.equal(cardPrice(ctx, game, s, target).total, want, `${label}: the price planner agrees`);
        const play = legalFor(s, "play", target);
        if (want > free) { assert.equal(play, undefined, `${label}: not payable, so not offered`); }
        else {
          assert.ok(play, `${label}: offered`);
          assert.ok(play.paymentPreview, `${label}: the menu shows its payment`);
          for (const o of play.paymentPreview.options) assert.equal(o.energyRest.length + o.markers, want, `${label}: the menu names ${want} energy to rest`);
          const done = settle(take(s, play.action), seat, want, label);
          assert.ok(done.paid < 0 || done.paid === want, label);
          assert.ok(done.s.sides[seat].zones.battle.includes(target), `${label}: played`);
          assert.equal(restCount(done.s, seat) - resting, want, `${label}: ${want} energy rested, as the menu said`);
          for (const e of energy) assert.ok(done.s.sides[seat].zones.energy.includes(e), `${label}: the energy stays in the Energy Area`);
        }
        assert.equal(price(roundtrip(s), target), want, `${label}: after a reload`);
      }
      // ── [Counter: Play] in the opponent's attack ────────────────────────────
      {
        const s = fresh(foe);
        const { target } = stageBoard(s, seat, foe);
        const label = `${seat}/${id}/${c.name}/counter`;
        assert.equal(price(s, target), want, `${label}: the cost in hand`);
        // [Counter: Play] answers a card the opponent plays: the opponent plays one, and the window opens for this seat.
        const played = stage(s, foe, "FOE921", "hand"); stage(s, foe, "RED921", "energy");
        let r = take(s, { type: "play", player: foe, card: played });
        if (r.prompt.kind === "payCost") r = take(r, { type: "payCost", player: foe, option: 0 });
        assert.equal(r.prompt.kind, "counter", `${label}: the counter window opens`);
        assert.equal(price(r, target), want, `${label}: the same cost in the window`);
        const offer = legalFor(r, "counter", target);
        if (want > free) { assert.equal(offer, undefined, `${label}: not payable, so not offered`); continue; }
        assert.ok(offer, `${label}: offered`);
        const rows = RULES.abilityAvailability(ctx, r, seat, RULES.legalActions(ctx, r), RULES.rejectedActions(ctx, r, RULES.legalActions(ctx, r))).filter((x) => x.card === target); assert.equal(rows[0]?.offers?.[0]?.cost?.energy, want, `${label}: the ability row shows the paid cost`);
        for (const o of offer.paymentPreview?.options ?? []) assert.equal(o.energyRest.length + o.markers, want, `${label}: preview`);
        const done = settle(take(r, offer.action), seat, want, label);
        assert.ok(done.s.sides[seat].zones.battle.includes(target), `${label}: played from the hand`);
        assert.equal(restCount(done.s, seat) - resting, want, `${label}: ${want} energy rested, as the menu said`);
        assert.equal(price(roundtrip(r), target), want, `${label}: a reload in the window changes nothing`);
      }
    }
  }
}

// ── the condition is read live: the last qualifying card leaving ends the discount ────────────
for (const seat of ["p1", "p2"] as const) {
  for (const id of IDS) {
    const s = fresh(seat);
    clear(s, seat);
    const target = stage(s, seat, id, "hand");
    const a = stage(s, seat, fodder("MC", id), "energy"), b = stage(s, seat, fodder("MC2", id), "energy");
    stage(s, seat, fodder("OWN", id), "energy");
    const label = `${seat}/${id}`;
    const orbsBefore = cardPrice(ctx, game, s, target).orbs;
    assert.equal(price(s, target), 2, `${label}: two qualifying cards, one flat discount`);
    // The first leaves: the other still qualifies, so the price holds.
    assert.ok(moveCard(s, game, a, "drop", { owner: seat }).ok);
    assert.equal(price(s, target), 2, `${label}: one qualifying card is enough`);
    // The last leaves: the discount is gone, the printed 3 is back.
    assert.ok(moveCard(s, game, b, "drop", { owner: seat }).ok);
    assert.equal(price(s, target), 3, `${label}: no qualifying card, no discount`);
    assert.equal(cardPrice(ctx, game, s, target).total, 3);
    // And a qualifying card coming back (from the Drop, into the Energy Area) restores it.
    assert.ok(moveCard(s, game, b, "energy", { owner: seat }).ok);
    assert.equal(price(roundtrip(s), target), 2, `${label}: back in the Energy Area, the discount is back`);
    // The printed orb colour stays what the catalog fallback says; only the total moved.
    assert.deepEqual(cardPrice(ctx, game, s, target).orbs, orbsBefore, `${label}: the orb part of the price is what it was without the discount`);
  }
}

// ── neighbours of the same wording keep their other qualifiers ─────────────────────────────────
{
  const read = (text: string) => skillRecords(card("W921", { skill: text }))[0];
  // BT20-031: only during the opponent's turn, by 2, and only a Red/Blue multicolour card.
  const opp = read("[Permanent] During your opponent's turn, if a Red/Blue multicolor card is in your energy, reduce the energy cost of this card in your hand by 2.");
  assert.deepEqual(opp.unread, []);
  assert.match(opp.reads, /opponent's turn/); assert.match(opp.reads, /multicolour red blue/); assert.match(opp.reads, /2 less/);
  // EX21-16, P-452: the combo cost stays a combo cost.
  const combo = read("[permanent] If a Red/Blue multicolor card is in your energy, reduce the combo cost of this card in your hand by 1.");
  assert.deepEqual(combo.unread, []);
  assert.equal((combo.ops[0] as { what?: string }).what, "combo");
  // An unconditional hand reduction still reads, now scoped to the hand it names.
  const plain = read("[Permanent] Reduce the energy cost of this card in your hand by 1.");
  assert.deepEqual(roundtrip(plain.ops[0]), { op: "costReduction", target: { sel: { special: "self", area: "hand" } }, amount: 1, until: "game" });
}
console.log("#921 multicolour energy: reading, stored rows, Main play and [Counter: Play], live removal, both seats, four cards passed");

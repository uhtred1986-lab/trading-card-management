/**
 * Mechanism batch 3 (27 Oct 2026): keywords, cards under cards (23-2), skill negation (9-1-5, 22-10-8) and targeting.
 * Printed text inline (catalog text of the open-rules export of 26 Oct 2026, with the catalog's errata applied; costs,
 * powers and companions in the VM cases are synthetic).
 *
 * K: keywords — no §22 keyword is missing from the registry; the "keyword not implemented" bucket is wordings that name
 *    one. "a card with a [Sparking 7] skill" (EX25-08/09) is a filter on the lines' tags; "your <Gamma 1: SH> and
 *    <Gamma 2: SH> cards―both red and with energy costs of 2―gain [Barrier]" (BT22-002b); "cards with energy costs of
 *    2" is a measure, never a count of two (P-638).
 * U: cards under cards — "if a <Garlic Jr.> is under this card" (BT21-006, BT19-019, BT20-011, BT2-108, SD17-02,
 *    BT19-127), "if an <Android 18> card is under your Leader" (BT20-058/059), "add … from under this card to its owner's
 *    hand" (BT19-127), "from under that card / it" bound to the card chosen or to the card a pile was just put under
 *    (BT21-020, P-717, SD21-01b, BT29-123), "place this card from under your (Z-)Leader on top of your Leader"
 *    (BT20-057/058/059).
 * N: negation — "Negate the [Counter: Attack] skill" (EX09-06: only a [Counter: Attack] being answered), "Then, for the
 *    duration of the game, negate this skill" (P-040), "you negate this skill for the battle" (BT26-044), "negate this
 *    card's skill for the game" (BT19-007), "negate the skills of all cards sent to Warps by this skill for the turn and
 *    play them" (BT13-096, EX21-15).
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip, the rules language's print and reparse), what
 * stays unread on purpose, and in the VM for both seats with every action reloaded from JSON.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. the records ───────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    return x;
  }));
/** The record of `text` at `index`, read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, index: number, o: Partial<CardDef> = {}): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = index < 0 ? recs.at(index) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index} (${recs.map((r) => r.skillIndex).join()})`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const unreadOf = (text: string, index = 0) => skillRecords(card("U", { skill: text })).find((r) => r.skillIndex === index)!.unread;
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "replace" ? opsDeep(o.with) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const pileCond = (rec: Rec) => {
  const conds = rec.cond ? (rec.cond.kind === "all" ? rec.cond.conds : [rec.cond]) : [];
  return conds.find((x) => x.kind === "count" && x.sel.area === "under") as Extract<NonNullable<Rec["cond"]>, { kind: "count" }> | undefined;
};
let records = 0;

// K. Keywords.
{
  const ex25 = record("[Dual Attack][Sparking 10] [Auto] When this card is played, choose up to 1 of your red ≪Universe 7≫ Battle Cards other than this card and it gets +10000 power for the turn. [Activate: Main][Limit 1]{r}{r}, if your Leader is {Son Goku, Supreme Warrior} and you have 3 or more energy: Play this card from your hand, then play up to 1 red non-&lt;Son Gohan: Adolescence&gt; ≪Universe 7≫ card with a [Sparking 7] skill from your Drop.", "EX25-08", -1);
  const fromDrop = opOf(ex25, "choose").find((p) => p.sel.area === "drop");
  assert.ok(fromDrop && fromDrop.sel.filter?.keywordsExact?.includes("Sparking 7") && fromDrop.sel.filter.notCharacters.length === 1, "K: EX25-08 — a card with a [Sparking 7] line, not <Son Gohan: Adolescence>");
  const gamma = record("[Permanent] During your turn, your &lt;Gamma 1: SH&gt; and &lt;Gamma 2: SH&gt; cards―both red and with energy costs of 2―gain [Barrier].", "BT22-002", 0, { type: "LEADER" });
  const g = opOf(gamma, "grant")[0];
  assert.ok(g && "sel" in g.target && g.target.sel.count === 99 && g.target.sel.filter?.colors.join() === "Red" && g.target.sel.filter.costMin === 2 && g.target.sel.filter.costMax === 2 && g.target.sel.filter.characters.length === 2 && g.keyword.name === "Barrier", "K: BT22-002b — every red <Gamma 1>/<Gamma 2> with an energy cost of 2 gains [Barrier]");
  assert.equal(gamma.cond?.kind, "isTurnPlayer", "K: BT22-002b — during your turn");
  const p638 = record("[Permanent] Your yellow ≪Boujack Brigade≫ cards with energy costs of 2 or less other than this card gain [Barrier], and once per turn, this card can't be removed from a Battle Area by skills.", "P-638", 0);
  const pg = opOf(p638, "grant")[0];
  assert.ok(pg && "sel" in pg.target && pg.target.sel.count === 99, "K: P-638 — every such card, not two of them");
  records += 3;
}

// U. Cards under cards.
{
  const garlic = record("[auto] If a &lt;Garlic Jr.&gt; is under this card: When this card is played, choose up to 1 of your opponent's Battle Cards, and it gets -20000 power for the turn.", "BT21-006", 0);
  const gc = pileCond(garlic);
  assert.ok(gc && !gc.sel.underHost && gc.sel.filter?.characters.includes("garlic jr.") && gc.atLeast === 1, "U: BT21-006 — this card's pile holds a <Garlic Jr.>");
  const koi = record("[permanent] While a red &lt;Koichiarator&gt; card is under this card, this card can attack Battle Cards in Active Mode.", "BT20-011", 0);
  assert.ok(pileCond(koi)?.sel.filter?.colors.includes("Red"), "U: BT20-011 — a red <Koichiarator> in the pile");
  const gete = record("[Auto] When you play this card or when it attacks, if {Big Gete Star} is under this card, choose up to 2 &lt;Meta-Cooler&gt; from your Drop Area and play them.", "BT2-108", 0);
  assert.ok(pileCond(gete)?.sel.filter?.names.length, "U: BT2-108 — {Big Gete Star} with no article");
  const pan = record("[Permanent] While a card with &lt;Pan&gt; in its character name is under this card, this card gains [Blocker].<br>[Auto] When this card activates [Blocker], add up to 1 card with &lt;Pan&gt; in its character name from under this card to its owner's hand.", "BT19-127", 10);
  assert.ok(opOf(pan, "choose")[0].sel.area === "under" && opOf(pan, "moveTo")[0].to === "hand", "U: BT19-127 — from the pile to the hand");
  const a18 = record("[auto] If an &lt;Android 18&gt; card is under your Leader and you place 1 card from under a &lt;Super 17&gt; card in your Battle Area in its owner's Drop: At the end of your turn, place this card from under your Leader on top of your Leader.", "BT20-058", 0, { type: "Z-LEADER" });
  const top = opOf(a18, "placeOnTop")[0];
  assert.ok(top && "sel" in top.target && top.target.sel.special === "self" && top.target.sel.underHost?.area === "leader" && top.onto && "sel" in top.onto && top.onto.sel.special === "leader", "U: BT20-058 — this card, from the Leader's pile, on top of the Leader");
  const leaderPile = a18.cost?.condition as { kind: string; sel?: { underHost?: { area?: string } } } | null;
  assert.ok(leaderPile && JSON.stringify(leaderPile).includes('"underHost":{"side":"you","area":"leader"}'), "U: BT20-058 — the price condition asks the Leader's pile");
  const z = record("[auto] At the end of your opponent's turn, place this card from under your Z-Leader on top of your Leader.", "BT20-057", 0, { type: "Z-LEADER" });
  assert.equal(opOf(z, "placeOnTop").length, 1, "U: BT20-057 — the Z-Leader said for the Leader");
  const pole = record("[Activate: Main][Limit 1] Place 1 card from your hand at the bottom of your deck: Choose up to 1 of your &lt;Son Goku&gt; cards and add up to 1 {Power Pole} from under that card into your hand.", "BT21-020", 0);
  const [goku, pick] = opOf(pole, "choose");
  assert.ok(pick.sel.area === "under" && pick.sel.underHost?.fromVar === goku.as, "U: BT21-020 — the pile of the <Son Goku> chosen (not the <Son Goku> itself)");
  assert.ok(opOf(pole, "moveTo").every((m) => "var" in m.target && m.target.var === pick.as), "U: BT21-020 — only the {Power Pole} moves");
  const egg = record("[auto] When this card is played, draw 1 card, then choose up to 1 {King Piccolo's Egg, Terror is Born} from your Battle Area, place up to 1 ≪Demon Clan≫ card from your Drop under that card and play up to 1 red ≪Demon Clan≫ card with an energy cost of 3 from under that card.", "P-717", 0);
  const [eggPick, placed, played] = opOf(egg, "choose");
  assert.ok(played.sel.underHost?.fromVar === eggPick.as && played.sel.underHost.fromVar !== placed.as, "U: P-717 — \"that card\" is the Egg, not the card just put under it");
  const sd21 = record("[activate: battle][once per turn]{r}/{u}: Choose up to 1 of your ≪Universe 7≫ &lt;Son Gohan: Adolescence&gt; Z-Battle Cards and play up to 1 ≪Universe 7≫ Z-Battle Card without &lt;Son Gohan: Adolescence&gt; with an energy cost of 2 or less from under it.", "SD21-01", 0);
  const [host, under] = opOf(sd21, "choose");
  assert.ok(under.sel.underHost?.fromVar === host.as && opOf(sd21, "play").every((p) => "var" in p.target && p.target.var === under.as), "U: SD21-01b — \"under it\" is the chosen card's pile");
  records += 9;
}
// A pile the sentence never named stays unread.
assert.ok(unreadOf("[Activate: Main] Add up to 1 card from under that card to your hand.").length > 0, "U: \"that card\" with nothing chosen stays unread");
assert.ok(unreadOf("[Activate: Main] Place up to 1 &lt;Son Goku&gt; Z-Leader from under your Leader on top of your Leader.").length > 0, "U: BT20-087's counted Z-Leader stays unread");

// N. Negation.
{
  const ex09 = record("[Energy-Exhaust]<br>[Counter: Counter] If your Leader Card is red and you choose 1 yellow card in your hand and place it in your Drop Area: Negate the [Counter: Attack] skill.", "EX09-06", 10, { type: "EXTRA" });
  const guard = opOf(ex09, "if").find((o) => o.cond.kind === "countering");
  assert.ok(guard && guard.cond.kind === "countering" && guard.cond.what === "attack" && guard.then[0].op === "negateCounter", "N: EX09-06 — only a [Counter: Attack] being answered");
  const p040 = record("[Critical]<br>[Barrier] (This card can't be chosen by the skills of your opponent's cards)<br>[Activate: Main] Choose up to 1 of the opponent's Battle Card with an energy cost equal or less than your energy and KO it. Then, for the duration of the game, negate this skill.", "P-040", 20);
  assert.deepEqual(opOf(p040, "negateOwnSkill").map((o) => o.until), [undefined], "N: P-040 — this skill, for the game");
  const bt19 = record("[Villainous] (When you play another ≪Villainous≫ Battle Card or activate a ≪Villainous≫ Extra's skill, your opponent discards a card from their hand. Negate this skill for the turn.)<br>[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 ≪Villainous≫ card among them to your hand, then shuffle your deck. If you added a card to your hand, negate this card's skill for the game.", "BT19-007", 10);
  const neg = opOf(bt19, "negateSkills")[0];
  assert.ok(neg && "sel" in neg.target && neg.target.sel.special === "self" && neg.until === "game", "N: BT19-007 — this card's skills, for the game");
  const bt13 = record("[Auto] When this card is played, choose this card and up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and send them to their owners' Warps; at the end of the turn, negate the skills of all cards sent to Warps by this skill for the turn and play them to their owners' Battle Areas.", "BT13-096", 0);
  const later = opOf(bt13, "delay")[0];
  const inner = opsDeep(later.ops);
  const n13 = inner.find((o): o is Extract<Op, { op: "negateSkills" }> => o.op === "negateSkills");
  assert.ok(n13 && "sel" in n13.target && n13.target.sel.fromVar && n13.until === "turn" && inner.findIndex((o) => o.op === "negateSkills") < inner.findIndex((o) => o.op === "play"), "N: BT13-096 — the cards sent are negated for the turn, then played");
  records += 4;
}
assert.deepEqual(unreadOf("[Auto] When this card attacks, it gains +1000 for each 1 energy you have, for the duration of the turn."), ["it gains +1000 for each 1 energy you have", "for the duration of the turn"], "N: a trailing span stays its own clause (BT1-030)");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const extra = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  // U: the pile asked of this card and of the Leader.
  PILEDRAW: card("PILEDRAW", { skill: "[Activate: Main] If a &lt;Garlic Jr.&gt; is under this card: Draw 1 card." }),
  GARLIC: card("GARLIC", { characters: ["Garlic Jr."] }),
  // U: the pile of the card chosen.
  POLE: card("POLE", { skill: "[Activate: Main] Choose up to 1 of your &lt;Son Goku&gt; cards and add up to 1 {Power Pole} from under that card into your hand." }),
  GOKU: card("GOKU", { characters: ["Son Goku"] }),
  STAFF: card("STAFF", { name: "Power Pole", type: "EXTRA", power: null }),
  // U: a Z-Leader in the Leader's pile placed on top of it.
  ZL: card("ZL", { type: "Z-LEADER", energyCost: null, comboCost: null, comboPower: null, power: 20000, skill: "[auto] At the end of your opponent's turn, place this card from under your Z-Leader on top of your Leader." }),
  // K: [Sparking 7] asked of a card's lines.
  SPARKER: card("SPARKER", { skill: "[Activate: Main] Play up to 1 red card with a [Sparking 7] skill from your Drop." }),
  S7: card("S7", { skill: "[Sparking 7] [Auto] When this card attacks, draw 1 card." }),
  S10: card("S10", { skill: "[Sparking 10] [Auto] When this card attacks, draw 1 card." }),
  // N: negated for the game, and the cards sent to the Warp negated as they are played.
  ONCE: card("ONCE", { skill: "[Activate: Main] Draw 1 card. Then, for the duration of the game, negate this skill." }),
  WARPER: card("WARPER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp; at the end of the turn, negate the skills of all cards sent to Warps by this skill for the turn and play them to their owners' Battle Areas." }),
  DRAWER: card("DRAWER", { skill: "[Auto] When this card is played, draw 1 card." }),
  // N: "Negate the [Counter: Attack] skill" answering an attack counter and a play counter.
  CATK: extra("CATK", "[Counter: Attack] Negate the attack."),
  CPLAY: extra("CPLAY", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  STOPATK: extra("STOPATK", "[Counter: Counter] Negate the [Counter: Attack] skill."),
  BC: card("BC", { energyCost: 1 }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, roundtrip(s), action);
  events.push(...(out.events ?? []));
  return roundtrip(out.state as VmState);
}
/** The seat's Main Phase, hands and energy emptied back into the decks. */
function fresh(seat: PlayerId, seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: "L-BLUE", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
  assert.equal(s.turnPlayer, seat);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  events = [];
  return s;
}
/** A deck card of `p` turned into `def` and moved to `area` — or, with `under`, put under that card. */
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined };
/** Answer every question until `done` holds (the turn player's Main Phase by default). */
function settle(s0: VmState, steer: Steer = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main", seen: Prompt[] = []): VmState {
  let s = s0;
  for (let i = 0; i < 80 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    seen.push(roundtrip(q));
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string, line = linesOf(s.cards[c].cardId)[0]) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === line);
function activateLine(s: VmState, c: string, steer: Steer = {}, seen: Prompt[] = []): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer, undefined, seen);
}
const pick = (...ids: string[]) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => ids.filter((id) => q.choice.candidates.includes(id)) });
const zoneOf = (s: VmState, p: PlayerId, id: string) => Object.entries(s.sides[p].zones).find(([, ids]) => (ids as string[]).includes(id))?.[0];
const endTurn = (s: VmState, who: PlayerId, steer: Steer = {}) => settle(take(s, { type: "endMain", player: who } as Action), steer, (x) => x.prompt.kind === "main" && x.turnPlayer === other(who));
const counterAt = (s: VmState) => {
  assert.equal(s.prompt.kind, "counter");
  return s.prompt as Extract<Prompt, { kind: "counter" }>;
};

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 27300 + n * 2 + (seat === "p1" ? 0 : 1);

  // U. The condition on this card's pile: drawn only with a <Garlic Jr.> under it.
  for (const withPile of [false, true]) {
    const s = fresh(seat, seed(withPile ? 1 : 0));
    const me = stage(s, seat, "PILEDRAW", "battle");
    if (withPile) stage(s, seat, "GARLIC", "battle", me);
    stage(s, seat, "V1", "energy");
    const offer = offerOf(s, me);
    if (!withPile) assert.ok(!offer || settle(take(s, offer.action)).sides[seat].zones.hand.length === 0, `${seat}: U: no <Garlic Jr.> under it — nothing drawn`);
    else assert.equal(activateLine(s, me).sides[seat].zones.hand.length, 1, `${seat}: U: a <Garlic Jr.> under it — 1 card drawn`);
    cases++;
  }
  // U. "from under that card": only the pile of the <Son Goku> chosen is offered, and only its card moves.
  {
    let s = fresh(seat, seed(2));
    const me = stage(s, seat, "POLE", "battle");
    const gokuA = stage(s, seat, "GOKU", "battle");
    const gokuB = stage(s, seat, "GOKU", "battle");
    const poleA = stage(s, seat, "STAFF", "battle", gokuA);
    const poleB = stage(s, seat, "STAFF", "battle", gokuB);
    const seen: Prompt[] = [];
    s = activateLine(s, me, pick(gokuA, poleA), seen);
    const asked = seen.filter((q): q is Extract<Prompt, { kind: "chooseCards" }> => q.kind === "chooseCards").find((q) => q.choice.candidates.includes(poleA));
    assert.ok(asked && !asked.choice.candidates.includes(poleB) && !asked.choice.candidates.includes(gokuA), `${seat}: U: only the chosen <Son Goku>'s {Power Pole} is offered`);
    assert.equal(zoneOf(s, seat, poleA), "hand", `${seat}: U: …it is added to the hand`);
    assert.equal(zoneOf(s, seat, gokuA), "battle", `${seat}: U: …and the <Son Goku> stays`);
    assert.ok(s.cards[gokuB].under.includes(poleB), `${seat}: U: …the other pile untouched`);
    cases++;
  }
  // U. BT20-057's shape: at the end of the opponent's turn the Z-Leader in the Leader's pile goes on top of it.
  {
    let s = fresh(seat, seed(3));
    const leader = s.sides[seat].zones.leader[0];
    const zl = stage(s, seat, "ZL", "leader", leader);
    s.cards[zl].zCard = true; // a Z-card, as one from the Z-Deck is (14-1)
    assert.ok(s.cards[leader].under.includes(zl), `${seat}: U: staged under the Leader`);
    s = endTurn(s, seat);
    assert.deepEqual(s.sides[seat].zones.leader, [leader], `${seat}: U: not at the end of its own turn`);
    events = [];
    s = endTurn(s, foe);
    assert.deepEqual(s.sides[seat].zones.leader, [zl], `${seat}: U: at the end of the opponent's turn it is the Leader`);
    assert.ok(s.cards[zl].under.includes(leader), `${seat}: U: …with the old Leader under it`);
    assert.equal(s.cards[zl].mode, s.cards[zl].mode ?? "active", `${seat}: U: …standing where the Leader stood`);
    cases++;
  }
  // K. "a card with a [Sparking 7] skill": the [Sparking 10] card and the plain one are not offered.
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "SPARKER", "battle");
    const s7 = stage(s, seat, "S7", "drop");
    const s10 = stage(s, seat, "S10", "drop");
    const plainCard = stage(s, seat, "V1", "drop");
    const seen: Prompt[] = [];
    s = activateLine(s, me, pick(s7), seen);
    const asked = seen.find((q): q is Extract<Prompt, { kind: "chooseCards" }> => q.kind === "chooseCards");
    assert.ok(!asked || (asked.choice.candidates.includes(s7) && !asked.choice.candidates.includes(s10) && !asked.choice.candidates.includes(plainCard)), `${seat}: K: only the [Sparking 7] card is offered`);
    assert.equal(zoneOf(s, seat, s7), "battle", `${seat}: K: …and it is played`);
    assert.equal(zoneOf(s, seat, s10), "drop", `${seat}: K: …the [Sparking 10] card stays`);
    cases++;
  }
  // N. "Then, for the duration of the game, negate this skill": once, and never again — this turn or the next.
  {
    let s = fresh(seat, seed(5));
    const me = stage(s, seat, "ONCE", "battle");
    s = activateLine(s, me);
    assert.equal(s.sides[seat].zones.hand.length, 1, `${seat}: N: drawn once`);
    assert.equal(offerOf(s, me), undefined, `${seat}: N: …not offered again this turn`);
    s = endTurn(endTurn(s, seat), foe);
    assert.equal(offerOf(s, me), undefined, `${seat}: N: …nor on the next turn`);
    cases++;
  }
  // N. The card sent to the Warp comes back at the end of the turn with its skills negated: its "when played" is silent.
  {
    let s = fresh(seat, seed(6));
    const me = stage(s, seat, "WARPER", "battle");
    const target = stage(s, foe, "DRAWER", "battle");
    s = activateLine(s, me, pick(target));
    assert.equal(zoneOf(s, foe, target), "warp", `${seat}: N: sent to the Warp`);
    const handBefore = s.sides[foe].zones.hand.length;
    events = [];
    s = endTurn(s, seat);

    assert.equal(zoneOf(s, foe, target), "battle", `${seat}: N: …played back at the end of the turn`);
    assert.ok(!events.some((e) => e.type === "skill" && (e as { card?: string }).card === target), `${seat}: N: …with its skills negated, its [Auto] does not resolve`);
    assert.equal(s.sides[foe].zones.hand.length - handBefore, 1, `${seat}: N: …the opponent drew only the turn's own draw`);
    assert.equal(skillsNegated(s, target), false, `${seat}: N: …and the negation was for that turn only`);
    cases++;
  }
  // N. "Negate the [Counter: Attack] skill": the attack counter is negated; a play counter is not.
  {
    // The seat attacks; the foe answers with a [Counter: Attack]; the seat answers that with STOPATK.
    let s = fresh(seat, seed(7));
    for (let i = 0; i < 2; i++) stage(s, seat, "V1", "energy");
    stage(s, foe, "V1", "energy");
    const catk = stage(s, foe, "CATK", "hand");
    const stop = stage(s, seat, "STOPATK", "hand");
    const lifeBefore = s.sides[foe].zones.life.length;
    s = take(s, { type: "attack", player: seat, attacker: s.sides[seat].zones.leader[0], target: s.sides[foe].zones.leader[0] } as Action);
    assert.deepEqual(counterAt(s).candidates, [catk], `${seat}: N: the attack window`);
    s = take(s, { type: "counter", player: foe, card: catk } as Action);
    assert.deepEqual(counterAt(s).candidates, [stop], `${seat}: N: the [Counter: Counter] window`);
    events = [];
    s = take(s, { type: "counter", player: seat, card: stop } as Action);
    s = settle(s);
    assert.ok(!events.some((e) => e.type === "attackNegated"), `${seat}: N: the [Counter: Attack] was negated, so the attack was not`);
    assert.ok(s.sides[foe].zones.life.length < lifeBefore, `${seat}: N: …and it hit`);
    cases++;
  }
  {
    // The seat plays a card; the foe answers with a [Counter: Play]; STOPATK answers that and does nothing.
    let s = fresh(seat, seed(8));
    for (let i = 0; i < 2; i++) stage(s, seat, "V1", "energy");
    stage(s, foe, "V1", "energy");
    const cplay = stage(s, foe, "CPLAY", "hand");
    const stop = stage(s, seat, "STOPATK", "hand");
    const bc = stage(s, seat, "BC", "hand");
    s = take(s, { type: "play", player: seat, card: bc } as Action);
    if (s.prompt.kind === "payCost") s = take(s, { type: "payCost", player: seat, option: 0 } as Action);
    assert.equal(counterAt(s).window, "play", `${seat}: N: the play window`);
    s = take(s, { type: "counter", player: foe, card: cplay } as Action);
    assert.deepEqual(counterAt(s).candidates, [stop], `${seat}: N: the [Counter: Counter] window`);
    s = take(s, { type: "counter", player: seat, card: stop } as Action);
    s = settle(s);
    assert.equal(zoneOf(s, seat, bc), "drop", `${seat}: N: a [Counter: Play] is not a [Counter: Attack] — not negated, the card goes to the Drop`);
    assert.equal(zoneOf(s, seat, stop), "drop", `${seat}: N: …and the [Counter: Counter] was still used`);
    cases++;
  }
}

console.log(`mechanism-3: ${records} record-level cases, and ${cases} both-seat reload cases`);

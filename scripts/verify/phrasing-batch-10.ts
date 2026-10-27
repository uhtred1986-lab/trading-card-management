/**
 * Phrasing batch 10 (27 Oct 2026). Printed text inline (catalog text of the card_rules snapshot of 26 Oct 2026; costs,
 * powers and companions in the VM cases are synthetic).
 *
 * A.  The regression held out of production: BT7-039's "you may choose **all** of your Battle Cards other than this card
 *     and place them in their owner's Drop Area. If you do, …" is all of them or none — an offer, never "any number" —
 *     and "if you do" follows whether the offer was taken (BT6-125 prints the same). "Any number of" is a choice of how
 *     many, never "all" (BT17-051) and never one (BT24-099, P-019, P-724, BT2-059, TB1-034, BT25-002); a choice after it
 *     "up to the same number" / "up to the number of cards placed … this way" is bounded by it (P-625, BT31-067).
 * B.  The owner's rulings of 27 Oct 2026: an Extra card's skill's damage is a skill's damage (the skill damage moments
 *     no longer ask where the card is, except "…from a skill on one of your Battle Cards or Unison Cards", DB3-017); a
 *     described card picked from the hand and moved into the deck or the life is revealed (3-1-7).
 * C.  [Spirit Boost X] records X on the cost (BT14-029, BT14-030, BT14-090, BT17-081b); "they place cards from their hand
 *     at the bottom of their deck … until they have 10 cards in their hand" (BT19-037, BT19-038); "add up to 1 card to
 *     your hand, send up to 1 card to your Warp" after a choice out of a look (BT30-101, BT30-104).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM for both seats with every action reloaded from JSON.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond, Op } from "../../src/lib/arena/vm/script";
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
/** The record of `text` (its only one, or the one at `index`), read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}, index?: number): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${what}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" || c.kind === "any" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
let records = 0;

// A. "You may choose all …": an offer of all of them, and "if you do" reads whether it was taken.
for (const [text, what] of [
  ["[auto] When a card evolves into this card, you may choose all of your Battle Cards other than this card and place them in their owner's Drop Area. If you do, choose all of your opponent's Battle Cards with energy costs of 4 or less and return them to their owners' hands.", "BT7-039"],
  ["[Auto] When 1 of your green Battle Cards with an energy cost of 7 or more is removed from a Battle Area by a skill or KO'd, activate this skill. You may choose all cards other than this card from your hand and place them in your Drop Area, and if you do, play this card from your hand.", "BT6-125"],
] as const) {
  const rec = record(text, what);
  const offer = rec.ops[0];
  assert.ok(offer.op === "may", `A: ${what} — an offer first (${JSON.stringify(offer).slice(0, 200)})`);
  const all = offer.ops[0];
  assert.ok(all.op === "choose" && all.sel.count === 99 && !all.sel.upTo, `A: ${what} — of all of them, never "any number" (${JSON.stringify(all).slice(0, 200)})`);
  // The move only uses what the offer chose, so it stays after it: declined, nothing was chosen and nothing moves.
  assert.ok(opOf(rec, "moveTo").some((o) => o.to === "drop" && "var" in o.target && o.target.var === all.as), `A: ${what} — …what it chose placed in the Drop`);
  const gate = rec.ops.find((o): o is Extract<Op, { op: "if" }> => o.op === "if");
  assert.ok(gate && gate.cond.kind === "chose" && gate.cond.var === all.as, `A: ${what} — "if you do" reads the offer's choice (${JSON.stringify(gate?.cond)})`);
  assert.ok(/^you may: choose all /.test(rec.reads), `A: ${what} — and says so (${rec.reads})`);
  records++;
}
// BT7-039's second choice stays "all" of theirs with energy costs of 4 or less (a measure, mechanism batch 3).
{
  const rec = record("[auto] When a card evolves into this card, you may choose all of your Battle Cards other than this card and place them in their owner's Drop Area. If you do, choose all of your opponent's Battle Cards with energy costs of 4 or less and return them to their owners' hands.", "BT7-039");
  const theirs = opOf(rec, "choose").find((o) => o.sel.side === "opponent")!;
  assert.ok(theirs.sel.count === 99 && !theirs.sel.upTo && theirs.sel.filter?.costMax === 4, `A: BT7-039 — all of theirs costing 4 or less (${JSON.stringify(theirs.sel).slice(0, 200)})`);
  records++;
}
// A bare plural after "you can choose" stays a choice of how many (EX21-12's [Union] permission).
{
  const recs = skillRecords(card("EX21-12", { skill: "[permanent] If your Leader is a yellow <Gotenks: Adolescence> card, you can choose Battle Cards in your Drop when choosing cards to use with this card's [union] skill from your hand. If you do, place the chosen cards at the bottom of your deck in any order." }));
  const pick = recs.flatMap((r) => opsDeep(r.ops)).find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  assert.ok(pick?.sel.upTo, `A: EX21-12 — a bare plural is still "any number" (${JSON.stringify(pick?.sel).slice(0, 160)})`);
  records++;
}
// "Any number of": as many as the player likes, none included.
for (const [text, what, area] of [
  ["[activate: main][once per turn]{u}{g}{6}: Play any number of blue ≪Red Ribbon Army≫ ≪Android≫ Battle Cards with different card names from your energy.", "BT17-051", "energy"],
  ["[auto] When you play this card, choose any number of ≪Ginyu Force≫ from your hand other than <Ginyu> and play them.", "P-019", "hand"],
  ["[Auto] When you play this card, if your Leader Card is ≪God≫, choose any number of other ≪God≫ in your Battle Area and add them to your Energy Area in Rest Mode.", "BT2-059", "battle"],
  ["[activate: main] If your opponent has 2 or more energy: Play up to 1 {Android 18, Deadly Combat Settled} from your Drop, then place any number of red Extras from your Drop under that card.", "P-724", "drop"],
  ["[Auto] When this card is placed in your Leader Area, place any number of {King Piccolo's Egg, Terror is Born} from your Z-Deck under this card.", "BT25-002", "zDeck"],
  ["[auto] When this card is removed from the game by a white ≪King Kai's Planet≫ <Son Goku> card's skill, switch any number of your energy to Revealed Mode.", "BT30-109", "energy"],
] as const) {
  const rec = record(text, what);
  const pick = opOf(rec, "choose").find((o) => o.sel.area === area && o.sel.count === 99);
  assert.ok(pick?.sel.upTo, `A: ${what} — any number of them, none included (${JSON.stringify(opOf(rec, "choose").map((o) => o.sel)).slice(0, 300)})`);
  assert.ok(/choose any number of /.test(rec.reads), `A: ${what} — and says so (${rec.reads})`);
  records++;
}
// BT17-051 keeps its different names; BT24-099 reads whole: any number, different names, costing 1, without <Turles>.
{
  const rec = record("[activate: main][once per turn]{u}{g}{6}: Play any number of blue ≪Red Ribbon Army≫ ≪Android≫ Battle Cards with different card names from your energy.", "BT17-051");
  assert.ok(opOf(rec, "choose")[0].sel.differentNames, "A: BT17-051 — with different card names");
  const turles = record("[Auto][Limit 1][Spirit Boost 1] If your Leader's back side is {Turles, Corps Commander}: When this card attacks, look at up to 5 cards from the top of your deck, play any number of yellow ≪Turles Crusher Corps≫ cards with different card names, energy costs of 1, and without <Turles> in their character names, then shuffle your deck.", "BT24-099");
  const pick = opOf(turles, "choose")[0];
  assert.ok(pick.sel.count === 99 && pick.sel.upTo && pick.sel.differentNames && pick.sel.fromVar === "looked", `A: BT24-099 — any number out of the look, different names (${JSON.stringify(pick.sel).slice(0, 200)})`);
  assert.ok(pick.sel.filter?.costMin === 1 && pick.sel.filter.costMax === 1 && pick.sel.filter.notCharactersIncluding.join().toLowerCase() === "turles", "A: BT24-099 — costing 1, without <Turles> in their names");
  assert.equal(opOf(turles, "play")[0] && "var" in opOf(turles, "play")[0].target ? (opOf(turles, "play")[0].target as { var: string }).var : null, pick.as, "A: BT24-099 — and plays them");
  records += 2;
}
// "Up to the same number" / "up to the number of cards placed … this way": bounded by the choice before it.
for (const [text, what] of [
  ["[auto] When this card attacks, choose any number of your Battle Cards and they get -10000 power for the turn. Choose up to the same number of your opponent's Battle Cards with 25000 power or less and KO them.", "P-625"],
  ["[auto] Add this card to your Z-Energy: At the end of your turn, choose any number of your yellow Battle Cards   and place them into their owner's Drop, choose a number of your opponent's Battle Cards up to the number of cards placed int their owner's Drop this way, switch them to Rest Mode, and they can't switch to Active Mode until the end of your opponent's turn.", "BT31-067"],
] as const) {
  const rec = record(text, what);
  const [mine, theirs] = opOf(rec, "choose");
  assert.ok(mine.sel.side === "you" && mine.sel.upTo && mine.sel.count === 99, `A: ${what} — any number of yours`);
  assert.ok(theirs.sel.side === "opponent" && theirs.sel.upTo, `A: ${what} — then theirs`);
  assert.deepEqual(theirs.atMost, what === "P-625" ? { var: mine.as } : { count: { fromVar: mine.as, area: "drop" } }, `A: ${what} — …up to as many as yours ${what === "P-625" ? "chosen" : "placed in a Drop"} (${JSON.stringify(theirs).slice(0, 200)})`);
  records++;
}

// B1. "…from a skill on one of your Battle Cards or Unison Cards" asks where the card was; the bare forms do not.
for (const [text, what, trigger] of [
  ["[Auto] If your Leader Card is red and you choose 1 card in your hand other than this card and discard it: When your opponent takes damage from a skill on one of your Battle Cards or Unison Cards, play this card from your hand.", "DB3-017", "opponentTookBoardSkillDamage"],
  ["[Auto] If you have a red Unison Card in play: When your opponent takes damage from non-keyword skills on your Battle Cards or Unison Cards, deal 1 damage to your opponent, then negate this skill for the game.", "BT10-001b", "opponentTookBoardSkillDamage"],
  ["[Auto] When your opponent takes damage from a skill, draw 1 card.", "OPP-TOOK", "opponentTookDamage"],
] as const) {
  assert.deepEqual(record(text, what).trigger, [trigger], `B1: ${what} answers ${trigger}`);
  records++;
}

// C. [Spirit Boost X]: X on the cost; "if you removed a marker … using this skill" is X ≥ 1 and that Unison; "for each
// marker you removed using this skill" is X.
for (const [text, what, kind] of [
  ["[Counter: Attack][Spirit Boost X] If your Leader Card is mono-red: Choose up to 1 of your opponent's cards and it gets -5000 power for the turn. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 of your opponent's cards and it gets -5000 power for the turn for each marker you removed using this skill.", "BT14-029", "Red"],
  ["[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) If your Leader Card is a red ≪Universe 11≫ card: Negate the attack, add up to 1 red <Jiren> card with an [Evolve] skill and an energy cost of 5 or less from your deck to your hand, then shuffle your deck. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 red ≪Universe 11≫ card with an energy cost of 1 in your Drop Area and play it in Rest Mode with its skills negated for the turn.", "BT14-030", "Red"],
  ["[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) Negate the attack; if you removed a marker from your green Unison Card using this skill, play 1 Majin Token in Rest Mode. (Majin Tokens have 15000 power, 0 combo cost, and 5000 combo power.)", "BT14-090", "Green"],
] as const) {
  const rec = record(text, what);
  assert.deepEqual(rec.cost?.x, { spiritBoost: true }, `C: ${what} — X markers on the cost`);
  assert.equal(rec.cost?.spiritBoost, null, `C: ${what} — no fixed [Spirit Boost N]`);
  const gate = opOf(rec, "if").map((o) => flat(o.cond)).find((cs) => cs.some((x) => x.kind === "xAtLeast"));
  assert.ok(gate, `C: ${what} — "if you removed a marker" asks X`);
  assert.ok(gate.some((x) => x.kind === "xAtLeast" && x.n === 1) && gate.some((x) => x.kind === "count" && "area" in x.sel && x.sel.area === "unison" && x.sel.filter?.colors.join() === kind), `C: ${what} — X ≥ 1 and a ${kind.toLowerCase()} Unison (${JSON.stringify(gate).slice(0, 300)})`);
  records++;
}
{
  const rec = record("[Counter: Attack][Spirit Boost X] If your Leader Card is mono-red: Choose up to 1 of your opponent's cards and it gets -5000 power for the turn. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 of your opponent's cards and it gets -5000 power for the turn for each marker you removed using this skill.", "BT14-029");
  assert.deepEqual(opOf(rec, "power").map((o) => o.amount), [-5000, { x: true, times: -5000 }], "C: BT14-029 — -5000, then -5000 for each marker removed");
  assert.equal(rec.cond?.kind, "leaderMatches", "C: BT14-029 — the mono-red Leader gates the whole skill");
  records++;
}
// BT19-037/BT19-038: the opponent puts the cards above 10 at the bottom of their deck.
{
  const rec = record("[Auto] If your Leader is mono-blue: When this card is played, if your opponent has 11 or more cards in their hand, they place cards from their hand at the bottom of their deck in any order until they have 10 cards in their hand.", "BT19-037");
  const pick = opOf(rec, "choose")[0];
  assert.ok(pick.chooser === "opponent" && pick.sel.side === "opponent" && pick.sel.area === "hand" && pick.owed, `C: BT19-037 — the opponent picks out of their hand, owed (${JSON.stringify(pick).slice(0, 300)})`);
  assert.deepEqual(pick.atMost, { plus: [{ count: { side: "opponent", area: "hand", count: 99, upTo: false } }, -10] }, "C: BT19-037 — as many as stand above 10");
  const move = opOf(rec, "moveTo")[0];
  assert.ok(move.to === "deck" && move.position === "bottom" && "var" in move.target && move.target.var === pick.as, "C: BT19-037 — to the bottom of their deck");
  assert.ok(flat(opOf(rec, "if")[0].cond).some((x) => x.kind === "count" && x.atLeast === 11), "C: BT19-037 — only with 11 or more in their hand");
  record("[Auto] If your Leader has <SH> in its character name: When this card is played, if your opponent has 11 or more cards in their hand, they place cards from their hand at the bottom of their deck in any order until they have 10 cards in their hand.", "BT19-038");
  records += 2;
}
// BT30-101/BT30-104: the bare cards are the ones just chosen out of the look; BT30-101's [Activate] picks out of the look.
{
  const rec = record("[auto] [limit 1] When this card is played, look at up to 5 cards from the top of your deck, choose up to 2 ≪Universe 2≫ cards, add up to 1 card to your hand, send up to 1 card to your Warp, then shuffle your deck.", "BT30-101");
  const [two, toHand, toWarp] = opOf(rec, "choose");
  assert.ok(two.sel.fromVar === "looked" && two.sel.count === 2 && two.sel.upTo, "C: BT30-101 — up to 2 ≪Universe 2≫ cards out of the look");
  for (const [pick, to] of [[toHand, "hand"], [toWarp, "warp"]] as const) {
    assert.ok(pick.sel.fromVar === two.as && pick.sel.count === 1 && pick.sel.upTo, `C: BT30-101 — up to 1 of those to the ${to}`);
    assert.ok(opOf(rec, "moveTo").some((o) => o.to === to && "var" in o.target && o.target.var === pick.as), `C: BT30-101 — …moved to the ${to}`);
  }
  const act = record("[activate: main] [limit 1] If your Leader is a ≪Universe 2≫ card and you send this card from your Drop to your Warp: Look at up to 2 cards from the top of your deck, place up to 1 card in your Drop, send up to 1 card to its owner's Warp, then place the rest at the bottom of your deck in any order.", "BT30-101");
  const picks = opOf(act, "choose");
  assert.ok(picks.length === 2 && picks.every((p) => p.sel.fromVar === "looked" && p.sel.count === 1 && p.sel.upTo), "C: BT30-101 [Activate] — up to 1 out of the look, twice");
  assert.deepEqual(opOf(act, "moveTo").map((o) => o.to), ["drop", "warp", "deck"], "C: BT30-101 [Activate] — to the Drop, the Warp, and the rest to the deck");
  records += 2;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const extra = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", colors: ["Red"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A: BT7-039's offer on an [Activate].
  MAYALL: card("MAYALL", { skill: "[Activate: Main] You may choose all of your Battle Cards other than this card and place them in their owner's Drop Area. If you do, choose all of your opponent's Battle Cards with energy costs of 4 or less and return them to their owners' hands." }),
  ANYKO: card("ANYKO", { skill: "[Activate: Main] Choose any number of your opponent's Battle Cards and KO them." }),
  SAMEKO: card("SAMEKO", { skill: "[Activate: Main] Choose any number of your Battle Cards and they get -10000 power for the turn. Choose up to the same number of your opponent's Battle Cards with 25000 power or less and KO them." }),
  // B1: an Extra's damage, and the board-only moment.
  EXDMG: extra("EXDMG", "[Activate: Main] Deal 1 damage to your opponent."),
  DMGSKILL: card("DMGSKILL", { skill: "[Activate: Main] Deal 1 damage to your opponent." }),
  TOOKSKILL: card("TOOKSKILL", { skill: "[Auto] When you take damage from a skill, draw 1 card." }),
  TOOKOPP: card("TOOKOPP", { skill: "[Auto] When you take damage from an opponent's non-keyword skill, draw 1 card." }),
  OPPTOOK: card("OPPTOOK", { skill: "[Auto] When your opponent takes damage from a skill, draw 1 card." }),
  BOARDTOOK: card("BOARDTOOK", { skill: "[Auto] When your opponent takes damage from a skill on one of your Battle Cards or Unison Cards, draw 1 card." }),
  // B2: a described pick out of the hand, into the deck.
  HANDPICK: card("HANDPICK", { skill: "[Activate: Main] Place 1 red Battle Card from your hand at the bottom of your deck." }),
  HANDANY: card("HANDANY", { skill: "[Activate: Main] Place 1 card from your hand at the bottom of your deck." }),
  // C: [Spirit Boost X] on an [Activate], and the hand down to 10.
  SBX: card("SBX", { skill: "[Activate: Main][Spirit Boost X] For each marker you remove using this skill, this card gets +5000 power for the turn." }),
  UNI: card("UNI", { type: "UNISON", colors: ["Red"], energyCost: 0, power: 10000, comboCost: null, comboPower: null }),
  TOTEN: card("TOTEN", { skill: "[Activate: Main] If your opponent has 11 or more cards in their hand, they place cards from their hand at the bottom of their deck in any order until they have 10 cards in their hand." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
let logged: { type: string; text?: string; player?: string; reveal?: boolean; card?: string; cards?: string[] }[] = [];
function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, roundtrip(s), action);
  logged.push(...(out.events as unknown as typeof logged));
  return roundtrip(out.state as VmState);
}
/** The seat's Main Phase, hands and energy emptied back into the decks. */
function fresh(seat: PlayerId, seed: number, leader = "L-BLUE"): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader, main: fifty("V1") }, p2: { name: "Second", leader, main: fifty("V-BLUE") } }).state as VmState;
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
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const offersOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).filter((l) => (l.action as { card?: string }).card === c && ["activate", "play"].includes(l.action.type));
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined; mode?: number };
function settle(s0: VmState, steer: Steer = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main"): VmState {
  let s = s0;
  for (let i = 0; i < 120 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: steer.mode ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: (q as { candidates: number[] }).candidates[0] } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else if (q.kind === "blocker") s = take(s, { type: "block", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
function activate(s: VmState, c: string, steer: Steer = {}, x?: number): VmState {
  const offers = offersOf(s, c);
  const offer = x === undefined ? offers[0] : offers.find((l) => (l.action as { x?: number }).x === x);
  assert.ok(offer, `${s.cards[c].cardId}: offered${x === undefined ? "" : ` at X = ${x}`} (${offers.map((l) => JSON.stringify(l.action)).join(" ")})`);
  return settle(take(s, offer.action), steer);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 31000 + n * 2 + (seat === "p1" ? 0 : 1);

  // A. BT7-039's shape: declined, nothing moves and "if you do" fails; taken, all of yours go and theirs return.
  for (const answer of ["take", "decline"] as const) {
    let s = fresh(seat, seed(answer === "take" ? 1 : 2));
    const me = stage(s, seat, "MAYALL", "battle");
    const mine = [stage(s, seat, "V1", "battle"), stage(s, seat, "V1", "battle")];
    const theirs = [stage(s, foe, "V-BLUE", "battle"), stage(s, foe, "V-BLUE", "battle")];
    let asked: number | null = null;
    s = activate(s, me, { mode: answer === "take" ? 0 : 1, cards: (q) => ((asked = q.choice.min), undefined) });
    const dropped = mine.filter((id) => s.sides[seat].zones.drop.includes(id)).length;
    const returned = theirs.filter((id) => s.sides[foe].zones.hand.includes(id)).length;
    assert.equal(dropped, answer === "take" ? 2 : 0, `${seat}: A: ${answer} — ${answer === "take" ? "all" : "none"} of yours placed in the Drop`);
    assert.equal(returned, answer === "take" ? 2 : 0, `${seat}: A: ${answer} — "if you do" ${answer === "take" ? "returns theirs" : "fails"}`);
    assert.ok(s.sides[seat].zones.battle.includes(me), `${seat}: A: this card stays`);
    assert.notEqual(asked, 0, `${seat}: A: never a choice of fewer than all`);
    cases++;
  }
  // A. "Any number of": one picked of three, one KO'd.
  {
    let s = fresh(seat, seed(3));
    const me = stage(s, seat, "ANYKO", "battle");
    const theirs = [0, 1, 2].map(() => stage(s, foe, "V-BLUE", "battle"));
    let min: number | null = null;
    let asks = 0;
    // Answered one card at a time: the first answer takes one, the next stops.
    s = activate(s, me, { cards: (q) => (asks++ === 0 ? ((min = q.choice.min), [q.choice.candidates[0]]) : []) });
    assert.equal(min, 0, `${seat}: A: any number — none is an answer`);
    assert.equal(theirs.filter((id) => s.sides[foe].zones.drop.includes(id)).length, 1, `${seat}: A: any number — only the one chosen is KO'd`);
    cases++;
  }
  // A. "Up to the same number": one of yours, so at most one of theirs.
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "SAMEKO", "battle");
    const mine = stage(s, seat, "V1", "battle");
    const theirs = [0, 1, 2].map(() => stage(s, foe, "V-BLUE", "battle"));
    let bound: number | null = null;
    let mineAsked = 0;
    s = activate(s, me, { cards: (q) => (!theirs.includes(q.choice.candidates[0]) ? (mineAsked++ === 0 ? [mine] : []) : ((bound ??= q.choice.max), q.choice.candidates.slice(0, q.choice.max))) });
    assert.equal(bound, 1, `${seat}: A: up to the same number — one of yours, so one of theirs`);
    assert.equal(theirs.filter((id) => s.sides[foe].zones.drop.includes(id)).length, 1, `${seat}: A: …one KO'd`);
    cases++;
  }

  // B1. An Extra's damage is a skill's: "from a skill", "from an opponent's skill" and "your opponent takes damage from
  // a skill" answer; "…from a skill on one of your Battle Cards or Unison Cards" does not. A Battle Card's damage: all four.
  for (const dealer of ["EXDMG", "DMGSKILL"] as const) {
    let s = fresh(seat, seed(dealer === "EXDMG" ? 5 : 6));
    const card = stage(s, seat, dealer, dealer === "EXDMG" ? "hand" : "battle");
    stage(s, foe, "TOOKSKILL", "battle");
    stage(s, foe, "TOOKOPP", "battle");
    stage(s, seat, "OPPTOOK", "battle");
    stage(s, seat, "BOARDTOOK", "battle");
    s = activate(s, card);
    assert.equal(hand(s, foe), 3, `${seat}: B1: ${dealer} — the life card and both of the damaged player's draws`);
    assert.equal(hand(s, seat), dealer === "EXDMG" ? 1 : 2, `${seat}: B1: ${dealer} — "your opponent takes damage from a skill" answers${dealer === "EXDMG" ? ", the Battle-Card-only moment does not" : ", and so does the Battle-Card-only one"}`);
    cases++;
  }

  // B2. A described card picked out of the hand and placed in the deck is revealed (3-1-7); an undescribed one is not.
  for (const def of ["HANDPICK", "HANDANY"] as const) {
    let s = fresh(seat, seed(def === "HANDPICK" ? 7 : 11));
    const me = stage(s, seat, def, "battle");
    const red = stage(s, seat, "V1", "hand");
    logged = [];
    s = activate(s, me, { cards: () => [red] });
    assert.equal(s.sides[seat].zones.deck[0] === red || s.sides[seat].zones.deck.at(-1) === red, true, `${seat}: B2: ${def} — the card is at the bottom of the deck`);
    const shown = logged.some((e) => (e.type === "reveal" || e.reveal === true) && JSON.stringify(e).includes(red));
    assert.equal(shown, def === "HANDPICK", `${seat}: B2: ${def} — ${def === "HANDPICK" ? "revealed on the way" : "not revealed"} (${JSON.stringify(logged.filter((e) => JSON.stringify(e).includes(red))).slice(0, 400)})`);
    cases++;
  }

  // C. [Spirit Boost X] on an [Activate]: one offer per number of markers the Unison holds; X = 2 takes two markers and
  // gives +10000.
  {
    let s = fresh(seat, seed(8));
    const me = stage(s, seat, "SBX", "battle");
    const uni = stage(s, seat, "UNI", "unison");
    s.cards[uni].markers = 3;
    const xs = offersOf(s, me).map((l) => (l.action as { x?: number }).x).filter((n) => n !== undefined);
    assert.deepEqual(xs, [0, 1, 2, 3], `${seat}: C: Spirit Boost X — offered at 0 to 3 markers`);
    const before = s.cards[me].power ?? null;
    s = activate(s, me, {}, 2);
    assert.equal(s.cards[uni].markers, 1, `${seat}: C: Spirit Boost X — two markers removed`);
    const effects = s.effects.filter((e) => e.target === me && e.kind === "power").reduce((n, e) => n + (e.value ?? 0), 0);
    assert.equal(effects, 10000, `${seat}: C: Spirit Boost X — +5000 for each (${before})`);
    cases++;
  }

  // C. BT19-037's shape: 12 in their hand, they put 2 at the bottom of their deck; 9 in their hand, nothing.
  for (const n of [12, 9]) {
    let s = fresh(seat, seed(9 + (n === 9 ? 1 : 0)));
    const me = stage(s, seat, "TOTEN", "battle");
    for (let i = 0; i < n; i++) stage(s, foe, "V-BLUE", "hand");
    const bottom = s.sides[foe].zones.deck.slice(-3);
    let chooser: PlayerId | null = null;
    s = activate(s, me, { cards: (q) => ((chooser = q.player), q.choice.candidates.slice(0, Math.max(1, q.choice.min))) });
    assert.equal(hand(s, foe), Math.min(n, 10), `${seat}: C: ${n} in their hand — ${n > 10 ? "down to 10" : "untouched"}`);
    if (n > 10) assert.equal(chooser, foe, `${seat}: C: …the opponent picks which`);
    else assert.deepEqual(s.sides[foe].zones.deck.slice(-3), bottom, `${seat}: C: …and their deck is untouched`);
    cases++;
  }
}

console.log(`phrasing-batch-10: ${records} record-level cases, and ${cases} both-seat reload cases`);

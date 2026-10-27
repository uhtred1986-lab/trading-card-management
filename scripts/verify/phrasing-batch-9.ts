/**
 * Phrasing batch 9 (27 Oct 2026). Printed text inline (catalog text of the card_rules snapshot of 26 Oct 2026; costs,
 * powers and companions in the VM cases are synthetic).
 *
 * A.  The regression phrasing batch 8 left: a count that opens its own clause leads it, and what that clause chose is
 *     what "it"/"them" means after it — P-346, P-651, BT20-006 (and P-597) read "KO this card", "move this card to
 *     warp", "this card -30000 power".
 * B.  The owner's rulings of 27 Oct 2026: a bare "When you take damage" answers battle damage too (1-13-2); "…from your
 *     opponent's skill" is never your own skill's; "mono-green or black" is two Leaders; a described pick out of the
 *     hand may be declined (5-2-7); a search shuffles the deck as the skill ends (20-12-3); an energy card that left and
 *     came back is a new card (3-1-4, BT10-054); and the `damage` op's `lifeLeft` answers once.
 * C.  Leftovers: XD3-07, EX09-01, EX23-52, BT15-001b, BT26-061b, BT24-112 (front and back).
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
import { parseSkills } from "../../src/lib/arena/text/cards";
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
/** The back side's record of `text`. */
const backRecord = (text: string, what: string) => {
  const recs = skillRecords(card(what, { skill: "", back: { name: what, power: 10000, skill: text } } as Partial<CardDef>)).filter((r) => r.side === "back");
  assert.equal(recs.length, 1, `${what}: one back record`);
  assert.deepEqual(recs[0].unread, [], `${what}: nothing unread`);
  return roundtrip(recs[0]);
};
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" || c.kind === "any" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const condsDeep = (rec: Rec): Cond[] => [...flat(rec.cond ?? rec.cost?.condition), ...opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const targetVar = (o: { target: unknown }) => (o.target as { var?: string }).var;
let records = 0;

// A. The pronoun after a counted choice is the chosen cards, never this card.
for (const [text, what, act] of [
  ["[auto] If your Leader Card is green: When this card is played, for every 2 non-black cards in your opponent's Warp, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and KO it.", "P-346", "ko"],
  ["[auto][limit 1] If your Leader is a <Pan: Xeno> card: When this card is played, for every Z-Energy cost of the Z-Cards in your Battle Area and Unison Area, choose up to 1 of your opponent's Battle Cards with an energy cost of 6 or less and send it to its owner's Warp.", "P-651", "moveTo"],
  ["[Auto][Once per turn] When this card attacks, for every 2 cards under this card, choose up to 1 of your opponent's Battle Cards or Unisons, and it gets -30000 power for the turn.", "BT20-006", "power"],
  ["[auto] When this card is played, place up to 1 yellow Unison from your deck into your Drop, shuffle your deck, then for each yellow Unison in your Unison Area and Drop, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it.", "P-597", "ko"],
] as const) {
  const rec = record(text, what);
  const pick = opOf(rec, "choose").find((o) => o.atMost);
  assert.ok(pick && pick.sel.side === "opponent", `A: ${what} — the counted choice is of the opponent's cards`);
  const acts = opOf(rec, act as "ko") as { target: unknown }[];
  const last = acts.at(-1)!;
  assert.equal(targetVar(last), pick.as, `A: ${what} — "it" is the chosen cards (${JSON.stringify(last.target)})`);
  assert.ok(!JSON.stringify(last.target).includes('"self"'), `A: ${what} — …never this card`);
  assert.ok(!/\bthis card\b/.test(rec.reads.split(", ").at(-1)!), `A: ${what} — and says so (${rec.reads})`);
  records++;
}
// A. P-346's bound is per step of 2 (`per: 2`), rounded down in the VM below.
{
  const rec = record("[auto] If your Leader Card is green: When this card is played, for every 2 non-black cards in your opponent's Warp, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and KO it.", "P-346");
  const bound = opOf(rec, "choose")[0].atMost as { count?: { side?: string; area?: string; filter?: { notColors?: string[] } }; per?: number };
  assert.ok(bound.per === 2 && bound.count?.side === "opponent" && bound.count.area === "warp" && bound.count.filter?.notColors?.join() === "Black", `A: P-346 — up to 1 for every 2 non-black cards in their Warp (${JSON.stringify(bound)})`);
  records++;
}

// B1/B2. The damage moments by their wordings.
for (const [text, what, triggers] of [
  ["[Auto] When you take damage, draw 1 card.", "TOOK-ANY", ["youTookBattleDamage", "youTookDamage"]],
  ["[Auto] When you take damage from a skill, draw 1 card.", "TOOK-SKILL", ["youTookDamage"]],
  ["[Auto] If your Leader Card is green: When you take damage from an opponent's non-keyword skill, you may play this card from your hand. If you do, add the top card of your deck to your life; you can't activate the [Auto] skill on copies of this card for the game.", "BT14-070", ["youTookOpponentSkillDamage"]],
  ["[Auto] If your Leader Card is blue: When you take damage from one of your opponent's non-keyword skills, you may play this card from your hand. If you do, add the top card of your deck to your life, and you can't activate the [Auto] skill on copies of this card for the game.", "BT13-039", ["youTookOpponentSkillDamage"]],
  ["[Auto] When you take damage from an opponent's attack, draw 1 card.", "TOOK-ATTACK", ["youTookBattleDamage"]],
] as const) {
  assert.deepEqual([...record(text, what).trigger].sort(), [...triggers].sort(), `B: ${what} answers ${triggers.join(" and ")}`);
  records++;
}
// B3. "mono-green or black" with no article: two Leaders.
for (const [text, what, second] of [
  ["[Auto] If your Leader is mono-green or black: When this card is played, draw 1 card.", "MONO-OR", []],
  ["[Auto] If your Leader Card is mono-green or black ≪Demon Realm Race≫: When this card is played, draw 1 card.", "MONO-OR-TRAIT", ["demon realm race"]],
] as const) {
  const rec = record(text, what);
  const any = condsDeep(rec).length ? (rec.cond ?? rec.cost?.condition) : null;
  const alts = any?.kind === "any" ? any.conds.filter((x): x is Extract<Cond, { kind: "leaderMatches" }> => x.kind === "leaderMatches") : [];
  assert.equal(alts.length, 2, `B3: ${what} — two alternatives (${JSON.stringify(any)?.slice(0, 200)})`);
  assert.ok(alts[0].filter.monoColor && alts[0].filter.colors.join() === "Green" && !alts[0].filter.traits.length, `B3: ${what} — a mono-green Leader`);
  assert.ok(!alts[1].filter.monoColor && alts[1].filter.colors.join() === "Black" && alts[1].filter.traits.map((x) => x.toLowerCase()).join() === second.join(), `B3: ${what} — or a black one`);
  records++;
}
// "mono-red or mono-green" stays the same two mono Leaders.
{
  const rec = record("[Auto] If your Leader is mono-red or mono-green: When this card is played, draw 1 card.", "MONO-MONO");
  assert.ok(/mono-colour Red, or your leader is mono-colour Green/.test(rec.reads), `B3: mono-red or mono-green (${rec.reads})`);
  records++;
}

// C. Leftovers.
// XD3-07: the count is how many tokens the price took.
{
  const rec = record("[activate: battle] Choose up to 2 Cell Jr. tokens in your Battle Area and remove them from the game: For each Cell Jr. token you remove from the game with this skill, choose up to 1 of your opponent's cards and switch it to Rest Mode.", "XD3-07");
  const priced = (rec.cost?.program ?? []).find((o): o is Extract<Op, { op: "choose" }> => o.op === "choose")!.as;
  const pick = opOf(rec, "choose")[0];
  assert.deepEqual(pick.atMost, { var: priced }, `C: XD3-07 — up to one per token the price removed (${JSON.stringify(pick.atMost)})`);
  assert.notEqual(pick.as, priced, "C: XD3-07 — the effect's choice has a name of its own");
  assert.equal(targetVar(opOf(rec, "switchMode")[0]), pick.as, "C: XD3-07 — and switches what it chose");
  records++;
}
// EX09-01: the card attacked, asked as the attack is declared; "it" is that card.
{
  const rec = record("[Auto] If your Leader Card is red and you place this card in its owner's Drop Area: When this card attacks a Battle Card, if that card has 25000 power or less, KO it.", "EX09-01");
  const asked = condsDeep(rec).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count" && "special" in x.sel && x.sel.special === "guard");
  assert.equal(asked?.sel.filter?.powerMax, 25000, "C: EX09-01 — the attacked card's power, 25000 or less");
  assert.deepEqual(opOf(rec, "ko")[0]?.target, { sel: { special: "guard" } }, "C: EX09-01 — KO that card");
  records++;
}
// EX23-52: one count of either kind; the power after the raise.
{
  const rec = record("[auto] When this card attacks, for each of your <Pan> cards and cards with <GT> in their character names, this card gets +5000 power for the battle. Additionally, if this skill makes this card's power 70000 or more, choose all of your opponent's Battle Cards, ignoring [barrier], and KO them, then deal 1 damage to your opponent.", "EX23-52");
  const raise = opOf(rec, "power")[0];
  // One filter whose `characters` and `charactersIncluding` answer in one `some` (either name, each card once).
  const counted = (raise.amount as { count?: { side?: string; filter?: { characters: string[]; charactersIncluding: string[] } } }).count;
  assert.ok(counted?.side === "you" && counted.filter?.characters.join().toLowerCase() === "pan" && counted.filter.charactersIncluding.join().toLowerCase() === "gt", `C: EX23-52 — your <Pan> cards or cards with <GT> in their names, each once (${JSON.stringify(raise.amount).slice(0, 300)})`);
  assert.ok(condsDeep(rec).some((x) => x.kind === "count" && "special" in x.sel && x.sel.special === "self" && x.sel.filter?.powerMin === 70000), "C: EX23-52 — this card's power, 70000 or more");
  assert.ok(opOf(rec, "ko").length && opOf(rec, "damage").length, "C: EX23-52 — the KO and the damage hang on it");
  records++;
}
// BT15-001b: the Unison [Spirit Boost 1] took its marker from.
{
  const rec = backRecord("[Activate: Main][Once per turn][Spirit Boost 1] This card gets +10000 power until the end of a battle or the end of the turn, whichever comes first, and if you removed a marker from a red Unison Card with a specified cost of 3 or more using this skill, choose up to 1 of your opponent's Battle Cards with 15000 power or less and KO it.", "BT15-001");
  const asked = condsDeep(rec).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count" && "area" in x.sel && x.sel.area === "unison");
  assert.ok(asked && asked.sel.side === "you" && asked.sel.filter?.colors.join() === "Red" && asked.sel.filter.specifiedCostMin === 3, `C: BT15-001b — your red Unison with a specified cost of 3 or more (${JSON.stringify(asked)?.slice(0, 200)})`);
  records++;
}
// [Spirit Boost X] may have removed none: still unread.
assert.ok(skillRecords(card("BT14-090", { skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) Negate the attack; if you removed a marker from your green Unison Card using this skill, play 1 Majin Token in Rest Mode." }))[0].unread.length > 0, "C: BT14-090 ([Spirit Boost X]) stays unread");
// BT26-061b: a card with either keyword.
{
  const rec = backRecord("[Auto] When your green <Zamasu> card with an [Evolve] or [Union] skill is played, place the top card of your opponent's deck into its owner's Drop.", "BT26-061");
  assert.deepEqual(rec.trigger, ["youPlayed"], "C: BT26-061b — its moment");
  const f = condsDeep(rec).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count" && "special" in x.sel && x.sel.special === "subject")?.sel.filter;
  assert.deepEqual(f?.anyOf?.map((a) => a.keywords.join()).sort(), ["Evolve", "Union"], `C: BT26-061b — [Evolve] or [Union], neither dropped (${JSON.stringify(f)?.slice(0, 200)})`);
  records++;
}
// BT24-112: the card used in the combo; BT24-112b: two moments of another card of yours.
{
  const rec = record("[Auto][Once per turn][Burst 1] When one of your <Son Goku: Xeno> or <Vegeta: Xeno> cards is used in a combo, draw 1 card.", "BT24-112");
  assert.deepEqual(rec.trigger, ["youCombo"], "C: BT24-112 — `youCombo`");
  const f = condsDeep(rec).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count" && "special" in x.sel && x.sel.special === "subject")?.sel.filter;
  assert.deepEqual(f?.characters.map((x) => x.toLowerCase()).sort(), ["son goku: xeno", "vegeta: xeno"], "C: BT24-112 — either name");
  records++;
  const back = backRecord("[Auto][Once per turn] When your black card with a [Union] skill or black Z-Unison attacks or activates the [Blocker] skill, draw 1 card and it gets +5000 power for the turn.", "BT24-112b");
  assert.deepEqual([...back.trigger].sort(), ["yourCardAttacks", "yourCardBlockerUsed"], "C: BT24-112b — the attack and the block");
  assert.deepEqual(opOf(back, "power")[0]?.target, { sel: { special: "subject" } }, "C: BT24-112b — \"it\" is that card");
  records++;
}

// D. Phrasing clusters: a modal head's own effect joined to the menu by "and"; "and without <Name> in their character
// names" as one more measure.
for (const [text, what, first] of [
  ["[Activate: Main][Once per turn][Sparking 5] (This skill takes effect when you have 5 or more cards in your Drop Area.)  Draw 1 card and choose one - ・Choose up to 2 of your energy and switch them to Active Mode. ・Choose 1 Battle Card with an energy cost of 2 or less from your Drop Area and play it. ・Choose your Leader Card or 1 of your Battle Cards, and it gets +5000 power and [Critical] for the duration of the turn.", "SD7-04", "draw"],
  ["[Activate: Main] If your Leader Card is a ≪Heroine≫ card: Look at up to 7 cards from the top of your deck and choose one- ・Add up to 2 green skill-less Battle Cards among them to your hand, then shuffle your deck. ・If you don't have a Unison Card in play, play up to 1 green Unison Card with 6000 power among them with a marker on it, then shuffle your deck.", "BT14-086", "look"],
] as const) {
  const rec = record(text, what);
  const body = rec.ops[0]?.op === "if" ? rec.ops[0].then : rec.ops;
  assert.deepEqual(body.map((o) => o.op), [first, "chooseMode"], `D: ${what} — the head's ${first}, then the menu`);
  records++;
}
for (const [text, what] of [
  ["[auto] When this card is played, draw 1 card and choose one— ・Choose up to 1 of your opponent's Rest Mode Battle Cards and KO it. ・Choose up to 3 yellow ≪Turles Crusher Corps≫ cards with energy costs of 1 and without <Turles> in their character names and switch them to Active Mode.", "BT24-097"],
  ["[Activate: Main] If your Leader is a yellow <Turles> card: Look at up to 7 cards from the top of your deck, add up to 2 yellow ≪Turles Crusher Corps≫ cards with energy costs of 1 and without <Turles> in their character names to your hand, then shuffle your deck.", "BT24-110"],
] as const) {
  const rec = record(text, what);
  const pick = opOf(rec, "choose").find((o) => o.sel.filter?.traits.length);
  assert.ok(pick && pick.sel.filter!.notCharactersIncluding.join().toLowerCase() === "turles" && pick.sel.filter!.costMax === 1, `D: ${what} — ≪Turles Crusher Corps≫ cards costing 1, without <Turles> in their names`);
  records++;
}
// BT24-099's comma list stays unread: its "any number of … with different card names" is not read as one card.
assert.ok(skillRecords(card("BT24-099", { skill: "[Auto][Limit 1][Spirit Boost 1] If your Leader's back side is {Turles, Corps Commander}: When this card attacks, look at up to 5 cards from the top of your deck, play any number of yellow ≪Turles Crusher Corps≫ cards with different card names, energy costs of 1, and without <Turles> in their character names, then shuffle your deck." }))[0].unread.length > 0, "D: BT24-099 stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A: P-346's shape on an [Activate].
  KOSTEP: card("KOSTEP", { skill: "[Activate: Main] For every 2 non-black cards in your opponent's Warp, choose up to 1 of your opponent's Battle Cards and KO it." }),
  // B1/B2: the damage moments.
  DMGSKILL: card("DMGSKILL", { skill: "[Activate: Main] Deal 1 damage to your opponent." }),
  SELFHURT: card("SELFHURT", { skill: "[Activate: Main] Deal 1 damage to your opponent." }),
  TOOKANY: card("TOOKANY", { skill: "[Auto] When you take damage, draw 1 card." }),
  TOOKSKILL: card("TOOKSKILL", { skill: "[Auto] When you take damage from a skill, draw 1 card." }),
  TOOKOPP: card("TOOKOPP", { skill: "[Auto] When you take damage from an opponent's non-keyword skill, draw 1 card." }),
  // B4: searches.
  HANDPICK: card("HANDPICK", { skill: "[Activate: Main] Place 1 red Battle Card from your hand at the bottom of your deck." }),
  SEARCH: card("SEARCH", { skill: "[Activate: Main] Add up to 1 Battle Card from your deck to your hand." }),
  SEARCHSHUF: card("SEARCHSHUF", { skill: "[Activate: Main] Add up to 1 Battle Card from your deck to your hand, then shuffle your deck." }),
  PLACEEN: card("PLACEEN", { skill: "[Activate: Main] Place the top card of your deck in your energy, then at the end of the turn, if the card you placed in your energy with this skill is in your energy, place it in its owner's Drop Area. If the card you placed in your energy with this skill isn't in your energy, place 1 card from your energy in its owner's Drop Area." }),
  // B5: a life card leaving.
  LIFEMOVE: card("LIFEMOVE", { skill: "[Auto] When your life moves to another area, draw 1 card." }),
  // C: EX09-01's shape, and the blocker moment.
  ATKKO: card("ATKKO", { skill: "[Auto] When this card attacks a Battle Card, if that card has 25000 power or less, KO it." }),
  HUGE: card("HUGE", { power: 30000 }),
  BLUEBLOCKER: card("BLUEBLOCKER", { colors: ["Blue"], skill: "[Blocker]" }),
  BLOCKWATCH: card("BLOCKWATCH", { skill: "[Auto] When your blue card attacks or activates the [Blocker] skill, draw 1 card." }),
};
const rows = Object.values(defs).flatMap((d) =>
  skillRecords(d).map((r, id) => {
    const row = { ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow;
    // SELFHURT: the same damage, dealt to its own master — no printed wording reads so, so the stored row says it.
    if (d.id === "SELFHURT") (row as unknown as { ops: Op[] }).ops = [{ op: "damage", n: 1, side: "you" } as Op];
    return row;
  }),
);
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
let logged: { type: string; text?: string; player?: string }[] = [];
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
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === linesOf(s.cards[c].cardId).at(-1));
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined; block?: (q: Extract<Prompt, { kind: "blocker" }>) => string | null };
function settle(s0: VmState, steer: Steer = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main"): VmState {
  let s = s0;
  for (let i = 0; i < 120 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else if (q.kind === "blocker") s = take(s, { type: "block", player: who, card: steer.block?.(q) ?? null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
function activate(s: VmState, c: string, steer: Steer = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}
const shuffles = (p: PlayerId) => logged.filter((e) => e.type === "note" && e.text === `${p === "p1" ? "First" : "Second"} shuffles their deck`).length;

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 29900 + n * 2 + (seat === "p1" ? 0 : 1);

  // A. "For every 2 non-black cards in your opponent's Warp, choose up to 1 … and KO it": five in their Warp is two
  // steps; the two chosen are KO'd and this card stays. One in their Warp is no step: nothing is chosen or KO'd.
  for (const inWarp of [5, 1]) {
    let s = fresh(seat, seed(inWarp));
    const me = stage(s, seat, "KOSTEP", "battle");
    for (let i = 0; i < inWarp; i++) stage(s, foe, "V1", "warp");
    const theirs = [0, 1, 2].map(() => stage(s, foe, "V-BLUE", "battle"));
    s = activate(s, me);
    const koed = theirs.filter((id) => s.sides[foe].zones.drop.includes(id)).length;
    assert.equal(koed, inWarp === 5 ? 2 : 0, `${seat}: A: ${inWarp} in their Warp — ${inWarp === 5 ? "two" : "none"} of theirs KO'd`);
    assert.ok(s.sides[seat].zones.battle.includes(me), `${seat}: A: …and this card is not KO'd`);
    cases++;
  }

  // B1. A bare "when you take damage" answers the attack's damage and a skill's.
  {
    let s = fresh(seat, seed(10));
    const attacker = stage(s, seat, "V1", "battle");
    const dealer = stage(s, seat, "DMGSKILL", "battle");
    stage(s, foe, "TOOKANY", "battle");
    s = activate(s, dealer);
    assert.equal(hand(s, foe), 2, `${seat}: B1: a skill's damage — the life card and the draw`);
    s = settle(take(s, { type: "attack", player: seat, attacker, target: s.sides[foe].zones.leader[0] } as Action));
    assert.equal(hand(s, foe), 4, `${seat}: B1: …and the attack's damage — the life card and the draw`);
    cases++;
  }
  // B2. "From an opponent's skill" — never your own skill's damage to you; "from a skill" is either.
  {
    let s = fresh(seat, seed(11));
    const hurt = stage(s, seat, "SELFHURT", "battle");
    stage(s, seat, "TOOKOPP", "battle");
    stage(s, seat, "TOOKSKILL", "battle");
    s = activate(s, hurt);
    assert.equal(hand(s, seat), 2, `${seat}: B2: your own skill's damage — the life card and "from a skill"'s draw, not "from an opponent's skill"'s`);
    const dealer = stage(s, seat, "DMGSKILL", "battle");
    stage(s, foe, "TOOKOPP", "battle");
    s = activate(s, dealer);
    assert.equal(hand(s, foe), 2, `${seat}: B2: the opponent's skill's damage — "from an opponent's skill" answers`);
    cases++;
  }

  // B4. A described pick out of the hand may be declined; with none of that description it asks nothing.
  {
    let s = fresh(seat, seed(12));
    const me = stage(s, seat, "HANDPICK", "battle");
    const red = stage(s, seat, "V1", "hand");
    let min: number | null = null;
    s = activate(s, me, { cards: (q) => ((min = q.choice.min), []) });
    assert.equal(min, 0, `${seat}: B4: the exact pick from the hand may be declined (5-2-7)`);
    assert.ok(s.sides[seat].zones.hand.includes(red), `${seat}: B4: …declined, the card stays in the hand`);
    cases++;
  }
  // B4. A search shuffles the deck as the skill ends, printed or not — and once.
  for (const def of ["SEARCH", "SEARCHSHUF"] as const) {
    let s = fresh(seat, seed(def === "SEARCH" ? 13 : 14));
    const me = stage(s, seat, def, "battle");
    logged = [];
    s = activate(s, me);
    assert.equal(hand(s, seat), 1, `${seat}: B4: ${def} — the card found`);
    // One shuffle each: the host notes every shuffle, and a printed "shuffle your deck" notes it once more itself.
    assert.equal(shuffles(seat), def === "SEARCH" ? 1 : 2, `${seat}: B4: ${def} — the deck shuffled once (${def === "SEARCH" ? "not printed" : "printed, and not again"})`);
    cases++;
  }
  // B4. BT10-054: the placed card left the energy and came back — a new card, so "isn't in your energy" holds and a card
  // is chosen; untouched, the placed card itself goes.
  for (const reentered of [false, true]) {
    let s = fresh(seat, seed(15 + (reentered ? 1 : 0)));
    const me = stage(s, seat, "PLACEEN", "battle");
    const spare = stage(s, seat, "V1", "energy");
    const top = s.sides[seat].zones.deck[0];
    s = activate(s, me);
    assert.ok(s.sides[seat].zones.energy.includes(top), `${seat}: B4: the top card placed in the energy`);
    if (reentered) {
      assert.ok(moveCard(s, game, top, "hand", { owner: seat }).ok);
      assert.ok(moveCard(s, game, top, "energy", { owner: seat }).ok);
      s.cards[top].mode = "active";
    }
    let asked = false;
    s = take(s, { type: "endMain", player: seat } as Action);
    s = settle(s, { cards: (q) => (q.player === seat && q.choice.candidates.includes(spare) ? ((asked = true), [spare]) : undefined) }, (x) => x.turnPlayer === foe && x.prompt.kind === "main");
    assert.equal(asked, reentered, `${seat}: B4: ${reentered ? "a new card — a card of the energy is chosen" : "the placed card itself — nothing chosen"}`);
    assert.ok(reentered ? s.sides[seat].zones.drop.includes(spare) && s.sides[seat].zones.energy.includes(top) : s.sides[seat].zones.drop.includes(top), `${seat}: B4: …and the ${reentered ? "chosen card" : "placed card"} is dropped`);
    cases++;
  }

  // B5. One damage, one life card: "when your life moves to another area" answers once, and no note of a moment nothing names.
  {
    let s = fresh(seat, seed(17));
    const dealer = stage(s, seat, "DMGSKILL", "battle");
    stage(s, foe, "LIFEMOVE", "battle");
    logged = [];
    s = activate(s, dealer);
    assert.equal(hand(s, foe), 2, `${seat}: B5: the life card and one draw`);
    assert.ok(!logged.some((e) => e.type === "note" && /lifeLeft/.test(e.text ?? "")), `${seat}: B5: no unanswered lifeLeft`);
    cases++;
  }

  // C. EX09-01's shape: the card attacked is KO'd when it has 25000 power or less, and not otherwise.
  for (const def of ["V-BLUE", "HUGE"] as const) {
    let s = fresh(seat, seed(18 + (def === "HUGE" ? 1 : 0)));
    const me = stage(s, seat, "ATKKO", "battle");
    const target = stage(s, foe, def, "battle");
    s.cards[target].mode = "rest";
    s = settle(take(s, { type: "attack", player: seat, attacker: me, target } as Action));
    assert.equal(s.sides[foe].zones.drop.includes(target), def === "V-BLUE", `${seat}: C: EX09-01 — ${def === "V-BLUE" ? "10000 power: KO'd" : "30000 power: not KO'd"}`);
    cases++;
  }
  // C. BT24-112b's block moment: your blue card activating [Blocker] answers; a red one does not.
  for (const blocker of ["BLUEBLOCKER", "BLOCKER"] as const) {
    let s = fresh(foe, seed(20 + (blocker === "BLOCKER" ? 1 : 0)));
    const attacker = stage(s, foe, "V1", "battle");
    const guard = stage(s, seat, blocker, "battle");
    stage(s, seat, "BLOCKWATCH", "battle");
    s = settle(take(s, { type: "attack", player: foe, attacker, target: s.sides[seat].zones.leader[0] } as Action), { block: (q) => (q.candidates.includes(guard) ? guard : null) });
    assert.equal(hand(s, seat), blocker === "BLUEBLOCKER" ? 1 : 0, `${seat}: C: ${blocker === "BLUEBLOCKER" ? "your blue card blocked — draw 1" : "a red card blocked — nothing"}`);
    cases++;
  }
}

console.log(`phrasing-batch-9: ${records} record-level cases, and ${cases} both-seat reload cases`);

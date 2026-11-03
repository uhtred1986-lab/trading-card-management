/**
 * Audit effects 3 (lane E of the readings audit, round 3): effects, clauses, durations and the ops they need. Printed
 * text inline (the catalog snapshot of 3 Nov 2026, corrected by `errata.ts` as a sync stores it).
 *
 * A.  "An [Activate: Main/Battle] skill" in a description is a line of that timing (BT31-132, BT31-116), never any [Activate].
 * B.  "…with [blocker] and without ≪Great Ape≫" is one description, the trait named out (P-487): a moment, not a replacement.
 * C.  "…in your Drop Area or Warp" is one area, picked first (DB2-019's Q&A, R-340); "…from your Drop Area or Warp"
 *     pools the two (BT6-126's Q&A), as do "and/or", "a total of" and "shuffle any areas you looked through".
 * D.  "When … attacks during that turn, …" (BT21-142) is a delayed trigger the engine lacks: unread, never a condition now.
 * E.  "Only 1 {X} can be played in your Battle Area" (21-11-2): a second copy that arrives anyway is processed like
 *     [Unique] — the master keeps one (BT6-047's Mafuba Q&A).
 * F.  "Skip your turn and begin your opponent's Charge Phase" (BT31-097): `skip` "rest" — the turn in progress ends now,
 *     nothing at its end happens, and the opponent's turn begins (its Q&As).
 * G.  "Reduce the energy cost of the next {X} you place in your Battle Area this turn" (BT23-041): one purchase, from
 *     the Z-Deck or the hand.
 * H.  "Your Leader Card doesn't take damage …" / "you don't take damage …" (`forbid` of `takeDamage`): a battle's
 *     damage, a skill's, or the attacks of certain cards; what the language cannot say stays unread.
 * I.  "This card can't be played from any area if you have 2 or less energy" (BT9-078): the ban's condition.
 * J.  The feed's "(White)" / "(X)" orbs in a price (errata.ts): priced, never free; "Deal X damage" (DB3-135).
 * K.  One wording each: "does not leave the Battle Area due to your opponent's skills" (BT2-047), "during this turn you
 *     can only play …" (BT23-109), and "only play" with a trait or a coloured name.
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules language's
 * print and reparse) and, where the engine learned something, a short play on the rules engine.
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
import { correctSkillText } from "../../src/lib/catalog/errata";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the records ─────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    return x;
  }));
let records = 0;
/** The record of `text` on card `id` (its only one, or the one at `index`), read whole, round-tripped and reparsed. */
function record(id: string, text: string, o: Partial<CardDef> = {}, index?: number, unread: string[] = []): Rec {
  const recs = skillRecords(card(id, { skill: correctSkillText(id, text) ?? text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${id}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${id}: a record at ${index}`);
  assert.deepEqual(rec.unread, unread, `${id}: unread is ${JSON.stringify(unread)} (${rec.reads})`);
  if (!unread.length) {
    const rule = asRule(rec);
    assert.equal(validateRule(rule, rec.kind), null, `${id}: the record validates`);
    const round = parseRule(printRule(rule));
    assert.ok(round.ok, `${id}: the rules language prints and reparses it`);
    assert.deepEqual(plain(round.value), plain(rule), `${id}: …unchanged`);
  }
  records++;
  return roundtrip(rec);
}
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);

// A. "…with an [Activate: Main/Battle] skill": that one timing, as printed.
for (const [id, text] of [
  ["BT31-132", "[Activate: Main][Limit 1] If your Leader is a white <Cell> card, and you remove this card in your Drop from the game and discard 1 card from your hand: Add up to 1 white Extra with an[Activate: Main/Battle] skill from your Drop to your hand."],
  ["BT31-116", "[activate: main/battle] [once per turn] Add up to 1 white Extra with an [activate: main/battle] skill and an energy cost of 2 from your Drop to your hand."],
] as const) {
  const rec = record(id, text);
  const pick = opOf(rec, "choose")[0];
  assert.equal(pick.sel.filter?.skillKind, "activate:main/battle", `A: ${id}: an [Activate: Main/Battle] line, not any [Activate]`);
  assert.match(rec.reads, /with \[Activate: Main\/Battle\] skills/, `A: ${id}: …and the reading says so`);
}

// B. P-487: the description is whole, "without ≪Great Ape≫" names the trait out, and the moment is a moment.
{
  const rec = record("P-487", "[auto][limit 1]{g}: When one of your green <Vegeta> cards with [blocker] and without ≪Great Ape≫ is removed from your Battle Area by an opponent's skill, play this card from your hand.");
  assert.deepEqual(rec.trigger, ["yourCardRemovedByOpponent"], "B: P-487: the removal moment");
  assert.equal(opOf(rec, "replace").length, 0, "B: P-487: …never a replacement");
  const subject = rec.cond && rec.cond.kind === "count" ? rec.cond.sel : null;
  assert.ok(subject && "special" in subject && subject.special === "subject", "B: P-487: a condition on the card removed");
  const f = (subject as { filter?: { colors: string[]; characters: string[]; keywords: string[]; traits: string[]; notTraits: string[] } }).filter!;
  assert.deepEqual([f.colors, f.characters, f.keywords, f.traits, f.notTraits], [["Green"], ["vegeta"], ["Blocker"], [], ["great ape"]], "B: P-487: green <Vegeta> with [Blocker], not ≪Great Ape≫");
  assert.equal(opOf(rec, "play").length, 1, "B: P-487: …then this card is played");
}

// C. One area of two (R-340): DB2-019 picks the Drop Area or the Warp first (its Q&A), and DB3-133's "in your deck or
// hand" the same way; "from your Drop Area or Warp" (BT6-126's Q&A: 3 from the Warp and 2 from the Drop, yes), "from
// your deck or Drop Area", "and/or", "a total of" and "shuffle any areas you looked through" keep the pooled choice.
for (const [id, text, areas] of [
  ["DB2-019", "[Activate: Main][Once per turn] Choose up to 2 skill-less Battle Cards with an energy cost of 1 in your Drop Area or Warp and play them.", ["drop", "warp"]],
  ["DB3-133", "[-6][Activate: Main] If your Leader Card is red: Choose up to 2 mono-red Battle Cards with different card names, energy costs of 3 or less, and 19000 power or less in your deck or hand, play them, then shuffle your deck if you looked through it.", ["deck", "hand"]],
] as const) {
  const rec = record(id, text);
  const mode = opOf(rec, "chooseMode");
  assert.equal(mode.length, 1, `C: ${id}: the area is picked first`);
  assert.deepEqual(mode[0].modes.map((m) => (m.ops[0] as Extract<Op, { op: "choose" }>).sel), mode[0].modes.map((m, i) => ({ ...(m.ops[0] as Extract<Op, { op: "choose" }>).sel, area: areas[i] })), `C: ${id}: …each mode one area`);
  for (const m of mode[0].modes) assert.equal((m.ops[0].op === "choose" && "areas" in m.ops[0].sel) ? m.ops[0].sel.areas : undefined, undefined, `C: ${id}: …never the pooled pair`);
  const vars = new Set(mode[0].modes.map((m) => (m.ops[0] as Extract<Op, { op: "choose" }>).as));
  assert.equal(vars.size, 1, `C: ${id}: …both modes bind the one variable the rest reads`);
}
for (const [id, text] of [
  ["BT6-126", "[Auto] When you play this card, if there is an <Evil Wizard Babidi> card under this card, choose up to 5 ≪Agent of Destruction≫ cards from your Drop Area or Warp and play them."],
  ["P-336", "[auto] When this card is played, add up to 2 cards with [dragon ball] from your deck or Drop Area to your hand, then shuffle your deck if you looked through it."],
  ["EX13-30", "[-1][Activate: Main] Play up to 2 skill-less Battle Cards with energy costs of 1 from your deck or Drop Area, then shuffle your deck if you looked through it."],
  ["DB2-031", "[Activate: Main] Choose up to 2 skill-less Battle Cards with 10000 power in your Drop Area and/or Warp and play them."],
  ["BT6-106", "[Activate: Main] Switch this card to Rest Mode: Choose up to 2 [Dragon Ball] cards from your deck or life and add them to your hand. Then shuffle any areas you looked through."],
  ["BT21-051", "[Auto][Limit 1] If your Leader is mono-blue and your opponent has 3 or more energy: When this card is played, draw 1 card, choose up to a total of 3 Battle Cards in your opponent's Battle Area or Drop and add them to its owner's Z-Energy."],
] as const) {
  const rec = record(id, text);
  assert.equal(opOf(rec, "chooseMode").length, 0, `C: ${id}: the pooled choice stays`);
  assert.ok(opOf(rec, "choose").some((o) => !("special" in o.sel) && (o.sel as { areas?: string[] }).areas?.length === 2), `C: ${id}: …across both areas`);
}

// D. A moment inside an effect that waits for the rest of the turn: unread, never a condition on the battle at hand.
{
  const recs = skillRecords(card("BT21-142", { skill: "[activate: battle][limit 1] If your Leader is a mono-red card and you discard 1 card from your hand during your opponent's turn: When your opponent's Battle Card or Unison attacks during that turn, choose up to 1 of your cards, and that card gets +10000 power for the battle." }));
  assert.deepEqual(recs[0].unread, ["When your opponent's Battle Card or Unison attacks during that turn"], "D: BT21-142: the delayed trigger is unread");
  records++;
}

// E. 21-11-2's wording keeps its play ban (the reading is unchanged) — the engine's processing is below.
for (const [id, text] of [
  ["BT6-047", "[Permanent] You can only have up to 1 {Babidi, Overseer of Destruction} in play in your Battle Area. Treat ≪Agent of Destruction≫ cards in your hand as if they had no specified cost."],
  ["DB2-039", "[Permanent] Only 1 copy of this card can be played in your Battle Area."],
] as const) {
  const rec = record(id, text);
  assert.ok(opOf(rec, "forbid").some((o) => o.what === "play" && (o.sameNameAsSelf || o.filter?.names.length === 1)), `E: ${id}: a ban on its own name`);
}

// F. "Skip your turn": the turn in progress.
{
  const rec = record("BT31-097", "[activate: main] If your Leader is an <Aeos> card: Skip your turn and begin your opponent's Charge Phase");
  assert.deepEqual(opOf(rec, "skip"), [{ op: "skip", what: "rest" }], "F: BT31-097: the rest of this turn, not the next one");
}

// G. The next named card placed in the Battle Area: one purchase this turn, wherever its price is paid from.
{
  const rec = record("BT23-041", "[auto][limit 1] If your Leader is a mono-blue <Son Goku> card and you remove this card from the game: When your blue <Piccolo> card attacks, the attacking card gains [critical] for the battle, then reduce the energy cost of the next {Piercing Special Beam Cannon} you place in your Battle Area this turn by {u}. Additionally, you may choose 1 of your blue <Son Goku> Battle Cards and KO it. If you do, choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck, then the attacking card gets +15000 power for the battle.", { type: "EXTRA" });
  const cut = opOf(rec, "costReduction");
  assert.equal(cut.length, 1, "G: BT23-041: one cost change");
  const sel = (cut[0].target as { sel: { area: string; areas?: string[]; filter?: { names: string[] } } }).sel;
  assert.deepEqual([sel.areas, sel.filter?.names, cut[0].uses, cut[0].until, cut[0].colors], [["zDeck", "hand"], ["piercing special beam cannon"], 1, "turn", ["Blue"]], "G: BT23-041: the next one this turn, by {u}, from the Z-Deck or the hand");
}

// H. Damage not taken.
for (const [id, text, o, want] of [
  ["P-263", "[activate: battle] {b}, if your Leader Card is black and you discard this card from your hand: Place 1 card from your life in your Drop Area, and your Leader Card doesn't take damage for the battle.", {}, { leader: true, bySkill: undefined, until: "battle" }],
  ["BT21-002", "[activate: battle] {r}, if your life is at 2 or less and you remove 7 [dragon ball] cards in your Drop from the game: You don't take damage for the turn, then flip this card over at the end of the turn.", {}, { leader: false, bySkill: undefined, until: "turn" }],
  ["BT22-139", "[permanent] If this card is in Rest Mode, you don't take damage.", {}, { leader: false, bySkill: undefined, until: "game" }],
  ["SD12-02", "[Permanent] If your Leader Card is a blue ≪Saiyan≫ card and you have a blue ≪Saiyan≫ Battle Card in play in Rest Mode, your Leader Cards don't take damage from attacks.", {}, { leader: true, bySkill: false, until: "game" }],
  ["P-234", "[Permanent] If your Leader Card is a blue ≪Saiyan≫ card and you have a blue ≪Saiyan≫ card in play in Rest Mode, your Leader Card doesn't take damage from attacks.", {}, { leader: true, bySkill: false, until: "game" }],
  ["E3-SPAN", "[Auto] When this card attacks, your Leader doesn't take damage and this card can't be KO'd for the battle.", {}, { leader: true, bySkill: undefined, until: "battle" }],
] as const) {
  const rec = record(id, text, o);
  const ban = opOf(rec, "forbid").find((f) => f.what === "takeDamage");
  assert.ok(ban, `H: ${id}: a ban on taking damage`);
  assert.equal(!!ban.target, want.leader, `H: ${id}: …${want.leader ? "the Leader's" : "the player's"}`);
  assert.equal(ban.side, want.leader ? undefined : "you", `H: ${id}: …whose`);
  assert.equal(ban.bySkill, want.bySkill, `H: ${id}: …${want.bySkill === false ? "a battle's damage only" : "any damage"}`);
  assert.equal(ban.until, want.until, `H: ${id}: …for ${want.until}`);
}
for (const [id, text] of [
  ["BT16-070", "[Counter: Attack] Negate the attack, and you don't take damage from your opponent's non-keyword skills for the turn."],
  ["BT15-141", "[Activate: Main/Battle][Limit 1] If your Leader Card is a black ≪Shadow Dragon≫ card and you place 1 card from your life in your Drop Area: Place the top card of your opponent's deck in their Drop Area, and your Leader Card doesn't take damage from your opponent's attacks until the end of a battle or the end of the turn, whichever comes first."],
  ["BT11-105", "[Auto] If your Leader Card is a yellow ≪Demon Clan≫ card: When this card is played, activate this skill. During your opponent's next turn, your Leader Cards and Unison Cards don't take damage from attacks of cards that have [Double Strike] or [Triple Strike] skills."],
] as const) {
  const recs = skillRecords(card(id, { skill: text }));
  assert.ok(recs.some((r) => r.unread.some((u) => /take damage/i.test(u))), `H: ${id}: what the language cannot say stays unread`);
  records++;
}

// I. The passive play ban with its condition after it.
for (const id of ["BT9-078", "BT9-079"]) {
  const rec = record(id, "[Permanent] This card can't be played from any area if you have 2 or less energy.");
  assert.deepEqual(rec.cond, { kind: "count", sel: { side: "you", area: "energy" }, atMost: 2 }, `I: ${id}: while you have 2 or less energy`);
  assert.ok(opOf(rec, "forbid").some((f) => f.what === "play" && f.target && "sel" in f.target && f.target.sel.special === "self"), `I: ${id}: …this card can't be played`);
}

// J. Orbs the feed prints in round brackets are the price (errata.ts), and X is read off it.
for (const [id, text, orbs] of [
  ["BT31-124", "[Activate: Main][Limit 1](White), if you have 2 or more energy: Play this card from your hand or from under a <Hyperbolic Time Chamber> card, and this card gets +10000 power for the turn.", { White: 1 }],
  ["BT31-137", "[Activate: Main/Battle](White), if your opponent has 2 or more energy: Draw 1 card.", { White: 1 }],
  ["DB3-135", "[-4][activate: main]{r}{r}{r}{r}(X), if your Leader Card is red: Deal X damage to your opponent.", { Red: 4 }],
] as const) {
  const fixed = correctSkillText(id, text);
  assert.ok(fixed && !/\((?:White|X)\)/.test(fixed), `J: ${id}: the bracketed orb is corrected`);
  const rec = record(id, text);
  assert.deepEqual(rec.cost?.orbs, orbs, `J: ${id}: …and priced`);
}
{
  const rec = record("DB3-135", "[-4][activate: main]{r}{r}{r}{r}(X), if your Leader Card is red: Deal X damage to your opponent.");
  assert.ok(rec.cost?.x, "J: DB3-135: an X price");
  assert.deepEqual(opOf(rec, "damage"), [{ op: "damage", n: { x: true }, side: "opponent" }], "J: DB3-135: X damage");
}

// K. One wording each.
for (const id of ["BT2-047", "BT2-055"]) {
  const rec = record(id, id === "BT2-047" ? "[Permanent] This card cannot be KO'd by your opponent's card's skills and does not leave the Battle Area due to your opponent's skills." : "[Permanent] If <Zamasu> is in play in your Battle Area, this card cannot be KO'd by your opponent's card's skills and does not leave the Battle Area due to your opponent's skills.");
  assert.ok(opOf(rec, "forbid").some((f) => f.what === "beMovedBySkill" && f.side === "opponent"), `K: ${id}: not removed by the opponent's skills (its Q&A)`);
}
{
  const rec = record("BT23-109", "[activate: main][limit 1]{y}, if your Leader is yellow, your opponent has 3 or more energy, and you have 4 or more Z-Energy: Play this card from your hand, choose up to 1 of your opponent's Rest Mode Battle Cards, ignoring [barrier], KO it, and during this turn you can only play yellow ≪Universe 7≫ cards and this card gains the following skill:<br>\"[activate: main] Place 3 of your Z-Energy in your Drop: Switch this card to Active Mode.\"", {}, 0);
  const only = opOf(rec, "forbid").find((f) => f.what === "play");
  assert.ok(only && only.until === "turn" && only.exceptFilter?.traits.includes("universe 7") && only.exceptFilter.colors.includes("Yellow"), "K: BT23-109: only yellow ≪Universe 7≫ cards, for the turn");
  for (const [said, field] of [["≪Universe 7≫ cards", "traits"], ["yellow <Zamasu> cards", "characters"]] as const) {
    const r = record("E3-ONLY", `[Activate: Main] Draw 1 card, and you can only play ${said} for the turn.`);
    const f = opOf(r, "forbid").find((o) => o.what === "play");
    assert.ok(f && f.exceptFilter && f.exceptFilter[field].length === 1, `K: "only play ${said}" is read`);
  }
}

// ── the VM ──────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  E3_ONE_AREA: card("E3_ONE_AREA", { skill: "[Activate: Main] Choose up to 2 skill-less Battle Cards with an energy cost of 1 in your Drop Area or Warp and play them." }),
  E3_POOLED: card("E3_POOLED", { skill: "[Activate: Main] Choose up to 2 skill-less Battle Cards with an energy cost of 1 from your Drop Area or Warp and play them." }),
  E3_LIMITED: card("E3_LIMITED", { name: "E3 Limited", skill: "[Permanent] Only 1 {E3 Limited} can be played in your Battle Area." }),
  E3_COPY: card("E3_COPY", { name: "E3 Copy", skill: "[Permanent] Only 1 copy of this card can be played in your Battle Area." }),
  // (A full stop inside the braces, as BT8-016's "{Dr.Myuu, the Mastermind}" prints one.)
  E3_DOTTED: card("E3_DOTTED", { name: "Dr.E3, the Limited", skill: "[Permanent] Only 1 {Dr.E3, the Limited} can be played in your Battle Area, and reduce the energy cost of this card in your hand by 1." }),
  E3_DRAWER: card("E3_DRAWER", { skill: "[Activate: Main] Draw 1 card." }),
  E3_SKIPPER: card("E3_SKIPPER", { skill: "[Activate: Main] Skip your turn and begin your opponent's Charge Phase" }),
  E3_LATER: card("E3_LATER", { skill: "[Activate: Main] At the end of the turn, draw 2 cards." }),
  E3_NO_BATTLE_DAMAGE: card("E3_NO_BATTLE_DAMAGE", { skill: "[Permanent] Your Leader Card doesn't take damage from attacks." }),
  E3_NO_DAMAGE: card("E3_NO_DAMAGE", { skill: "[Permanent] You don't take damage." }),
  E3_BURN: card("E3_BURN", { skill: "[Activate: Main] Deal 1 damage to your opponent." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
function take(s: VmState, action: Action): VmState {
  const out = RULES.apply(ctx, roundtrip(s), action);
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
/** A card from the deck's bottom, made `def`, put in `area` (Battle and Energy Areas Active). */
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && linesOf(s.cards[c].cardId).includes((l.action as { skill: number }).skill));
type Prompt = VmState["prompt"];
type Steer = { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined; mode?: number; asked?: string[] };
/** Answer every question until the turn player's Main Phase. */
function settle(s0: VmState, steer: Steer = {}): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: steer.mode ?? 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") {
      steer.asked?.push(q.choice.reason);
      s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `settled (at ${s.prompt.kind})`);
  return s;
}
function activate(s: VmState, c: string, steer: Steer = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const seed = (n: number) => 53300 + n * 2 + (seat === "p1" ? 0 : 1);

  // C. One area: with a card in the Drop and one in the Warp, the Warp is picked and only the Warp's card is offered.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "E3_ONE_AREA", "battle");
    const inDrop = stage(s, seat, "V1", "drop");
    const inWarp = stage(s, seat, "V1", "warp");
    const offered: string[][] = [];
    s = activate(s, me, { mode: 1, cards: (q) => (offered.push(q.choice.candidates), q.choice.candidates) });
    assert.deepEqual(offered, [[inWarp]], `${seat}: C: only the Warp's card is offered once the Warp is picked`);
    assert.ok(s.sides[seat].zones.battle.includes(inWarp) && s.sides[seat].zones.drop.includes(inDrop), `${seat}: C: …the Warp's card played, the Drop's left`);
    cases++;
  }
  // …while "from your Drop Area or Warp" (BT6-126's Q&A) offers both at once, and both are played.
  {
    let s = fresh(seat, seed(8));
    const me = stage(s, seat, "E3_POOLED", "battle");
    const inDrop = stage(s, seat, "V1", "drop");
    const inWarp = stage(s, seat, "V1", "warp");
    const offered: string[][] = [];
    // (A Warp is chosen from one card at a time, R-006: the first question offers both, the second the one left.)
    s = activate(s, me, { cards: (q) => (offered.push(q.choice.candidates), q.choice.candidates.slice(0, 1)) });
    assert.deepEqual([...offered[0]].sort(), [inDrop, inWarp].sort(), `${seat}: C: the pooled choice offers the Drop's and the Warp's card together`);
    assert.ok([inDrop, inWarp].every((id) => s.sides[seat].zones.battle.includes(id)), `${seat}: C: …and plays 1 from each`);
    cases++;
  }

  // E. Two copies in one Battle Area while the limit is in force (the Mafuba case): the master keeps one at once.
  for (const def of ["E3_LIMITED", "E3_COPY", "E3_DOTTED"]) {
    let s = fresh(seat, seed(def === "E3_LIMITED" ? 1 : def === "E3_COPY" ? 2 : 9));
    const drawer = stage(s, seat, "E3_DRAWER", "battle");
    const a = stage(s, seat, def, "battle");
    const b = stage(s, seat, def, "battle");
    const asked: string[] = [];
    s = activate(s, drawer, { asked, cards: (q) => (q.choice.candidates.includes(b) ? [b] : undefined) });
    assert.ok(asked.length >= 1, `${seat}: E: ${def}: the master is asked which to keep`);
    assert.ok(s.sides[seat].zones.battle.includes(b) && !s.sides[seat].zones.battle.includes(a), `${seat}: E: ${def}: …the one kept stays`);
    assert.ok(s.sides[seat].zones.drop.includes(a), `${seat}: E: ${def}: …the other goes to the Drop Area`);
    cases++;
  }
  // …and one copy alone is no violation; another card's name is never limited.
  {
    let s = fresh(seat, seed(3));
    const drawer = stage(s, seat, "E3_DRAWER", "battle");
    const a = stage(s, seat, "E3_LIMITED", "battle");
    const c1 = stage(s, seat, "V1", "battle");
    const c2 = stage(s, seat, "V1", "battle");
    s = activate(s, drawer);
    assert.ok([a, c1, c2].every((id) => s.sides[seat].zones.battle.includes(id)), `${seat}: E: one limited copy and two of another name stay`);
    cases++;
  }
  // H. A Leader that doesn't take damage from attacks: the attack hits and nothing moves; a skill's damage still lands.
  // A player that doesn't take damage takes neither.
  for (const [def, battle, skill] of [["", 1, 1], ["E3_NO_BATTLE_DAMAGE", 0, 1], ["E3_NO_DAMAGE", 0, 0]] as const) {
    let s = fresh(seat, seed(5 + (def === "" ? 0 : def === "E3_NO_BATTLE_DAMAGE" ? 1 : 2)));
    const foe = other(seat);
    if (def) stage(s, foe, def, "battle");
    const attacker = stage(s, seat, "V1", "battle");
    const burn = stage(s, seat, "E3_BURN", "battle");
    const leader = s.sides[foe].zones.leader[0];
    const life0 = s.sides[foe].zones.life.length;
    s = take(s, { type: "attack", player: seat, attacker, target: leader } as Action);
    s = settle(s);
    assert.equal(life0 - s.sides[foe].zones.life.length, battle, `${seat}: H: ${def || "no rule"}: the attack takes ${battle} life`);
    const life1 = s.sides[foe].zones.life.length;
    s = activate(s, burn);
    assert.equal(life1 - s.sides[foe].zones.life.length, skill, `${seat}: H: ${def || "no rule"}: the skill's damage takes ${skill} life`);
    cases++;
  }

  // F. Skip your turn: the Main Phase ends at once, the "at the end of the turn" draw never happens, and the opponent's
  // turn begins with its Charge Phase.
  {
    let s = fresh(seat, seed(4));
    const later = stage(s, seat, "E3_LATER", "battle");
    const skipper = stage(s, seat, "E3_SKIPPER", "battle");
    s = activate(s, later);
    const hand = s.sides[seat].zones.hand.length;
    const turn = s.turn;
    const offer = offerOf(s, skipper);
    assert.ok(offer, `${seat}: F: the skip is offered`);
    s = take(s, offer.action);
    for (let i = 0; i < 20 && s.turnPlayer === seat; i++) {
      const q = s.prompt;
      const who = (q as { player: PlayerId }).player;
      if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
      else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
      else if (q.kind === "main") assert.fail(`${seat}: F: the Main Phase asked again after the skip`);
      else s = take(s, { type: "pass", player: who } as Action);
    }
    assert.equal(s.turnPlayer, other(seat), `${seat}: F: the opponent's turn`);
    assert.equal(s.turn, turn + 1, `${seat}: F: …the very next turn`);
    assert.equal(s.prompt.kind, "charge", `${seat}: F: …at its Charge Phase`);
    assert.equal(s.sides[seat].zones.hand.length, hand, `${seat}: F: the end-of-turn draw never happened (its timing was skipped)`);
    assert.deepEqual(s.sides[seat].skips ?? [], [], `${seat}: F: no skip entry is left over`);
    cases++;
  }
}

console.log(`verify/audit-effects-3: ok (${records} records, ${cases} VM cases across both seats)`);

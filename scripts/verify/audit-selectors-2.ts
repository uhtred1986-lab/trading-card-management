/**
 * Audit selectors 2 (3 Nov 2026): the readings audit's selector lane, round 2. Printed text inline (catalog text of the
 * snapshot of 3 Nov 2026; costs, powers and companions in the VM cases are synthetic).
 *
 * A.  The two-named search (R-250): "choose / play / add up to 1 <A> card and 1 <B> card ―…― from/in your X" is one
 *     choice per name with the place, owner and shared measures every card's (BT7-075, BT9-054, EX23-01, BT23-022,
 *     BT17-010, BT12-136, BT12-138, BT7-031, EX06-02, BT5-016, BT15-115, BT7-057, prices of BT23-022 and BT24-007);
 *     "play or add to your hand" is one option for all of them (R-252, BT11-029, BT11-078); after a look a counted
 *     card to play on top names one of the cards looked at (BT28-103).
 * B.  Choice lists (R-251): "them" after "choose A and B" is every card of the list (BT18-144, BT13-096, BT13-101,
 *     BT25-062, BT30-150), "all other Battle Cards" the rest (BT24-140), two choices told apart by place (TB3-055),
 *     "up to 1 of them" unread (EX23-25), "the Battle Card you played" the card played (BT8-068, EX07-10).
 * C.  The opponent's hand unseen (R-253): a choice of it with no look before is blind (BT13-146, BT10-086, BT3-063).
 * D.  No owner (R-254): a bare name or trait is either player's (P-435, BT16-017); the card switched into your seat in a
 *     battle is yours (BT31-085); a list whose first card lost its place is refused.
 * E.  "Up to N cards from the top of your deck" (R-255) is the top that many, the master choosing only how many
 *     (EX08-04, BT30-020, BT27-032, EX23-32, P-537) — it was a search of the whole deck.
 * F.  "…to your opponent's Battle Area" (`toOpponent`, BT13-028, BT13-029, BT20-123); "would leave the Battle Area by a
 *     skill" keeps its cause (BT25-014).
 * G.  Honest gaps: a cost bound counted off the board (P-300, BT15-145, BT22-127), "not a copy of this card" (BT20-124).
 *
 * Proved here: the records (nothing unread where the line is whole, the stored-row JSON round trip, the rules
 * language's print and reparse), and in the VM where an engine path moved (A, B, C).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Op } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the records ──────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if (k === "upTo" && x === false) return undefined;
    if (k === "area" && Array.isArray(this.areas)) return undefined;
    if (k === "kind" && typeof x === "string" && x.startsWith("counter:")) return x.replace(/\s+/g, "");
    return x;
  }));
/** The record of `text` at `index` (or its only one), read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}, index?: number): Rec {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  const rec = index === undefined ? (assert.equal(recs.length, 1, `${what}: one record`), recs[0]) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread (${rec.reads})`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const opOf = <K extends Op["op"]>(ops: Op[], op: K) => opsDeep(ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const chooses = (rec: Rec) => opOf(rec.ops, "choose");
const named = (rec: Rec) => chooses(rec).filter((o) => (o.sel.filter?.characters.length ?? 0) + (o.sel.filter?.names.length ?? 0) + (o.sel.filter?.traits.length ?? 0) > 0);
const targetVar = (o: Op) => ("target" in o && o.target && "var" in o.target ? o.target.var : null);
let records = 0;

// ── A. the two-named search (R-250) ──────────────────────────────────────────
for (const [text, what, area, n, act] of [
  ["[Activate: Main] When you have 3 or more energy: Choose up to 1 blue <Kale> card and 1 yellow <Caulifla> card with energy costs of 2 or less in your hand and play them, then negate this skill for the duration of the game.", "BT7-075", "hand", 2, "play"],
  ["[activate: main]{g}{g}{y}, place this card in its owner's Drop Area: Choose up to 1 <Android 17> card and up to 1 <Android 18> card with energy costs of 4 or less in your Drop Area and play them.", "BT9-054", "drop", 2, "play"],
  ["[activate: main][once per turn]{r}{r}{u}{2}, if your opponent has 20 or fewer cards in their deck: Play up to 1 <Frieza> card and up to 1 <Cooler> card―both Red/Blue multicolor and with an energy cost of 5―from your hand, then switch up to 2 of your energy to Active Mode at the end of the turn.", "EX23-01", "hand", 2, "play"],
  ["[activate: main/battle][limit 1] Play up to 1 <Android 17> and up to 1 <Android 18>―both red and with an energy cost of 3 or less―from under this card, then place this card in your Drop.", "BT23-022", "under", 2, "play"],
  ["[activate: main][limit 1]{r}{r}, if your Leader Card is a <Son Goku: GT> card: Play up to 1 <Son Goku: GT> card and up to 1 <Trunks: GT> card—both red and with 15000 power or less—from under a {Spaceship, Vessel of Hope} in your Unison Area.", "BT17-010", "under", 2, "play"],
  ["[activate: main]{b}, place this card at the bottom of your deck: Play up to 1 <Son Goku: Xeno> card with an energy cost of 1 and up to 1 <Vegeta: Xeno> card with an energy cost of 1 from your Drop Area or Warp.", "BT12-136", "drop", 2, "play"],
  ["[activate: main] If you have a black Unison Card in play: Place this card in its owner's Drop Area, then play 1 <Son Gohan: Xeno> card with an energy cost of 1 and 1 <Trunks: Xeno> card with an energy cost of 1 from your deck or Drop Area, then shuffle your deck if you looked through it.", "BT12-138", "deck", 2, "play"],
  ["[Auto] When you play this card, you may choose 1 card in your hand and place it in your Drop Area. If you do, choose up to 1 yellow {Super Saiyan Blue Vegeta} with an energy cost of 2 and up to 1 {SSB Son Goku, the Sweeper} from your deck, add them to your hand, then shuffle your deck.", "BT7-031", "deck", 2, "moveTo"],
  ["[activate: main]{1}, place this card in your Drop Area from your hand: If your Leader Card is a <Vegito> card, choose up to 1 <Son Goku> card and 1 <Vegeta> card in your deck or Drop Area with energy costs of 2 or less, negate their skills, play them in Rest Mode, shuffle your deck if you looked through it.", "EX06-02", "deck", 2, "play"],
  ["[Activate: Main][Once per turn] Choose 1 [Dragon Ball] card from your deck, place it in your Drop Area, then shuffle your deck: Choose 1 {Shu, Trusted Lackey} and 1 {Mai, Trusted Lackey} in your Battle Area, and they get +5000 power for the duration of the turn.", "BT5-016", "battle", 2, "power"],
  ["[Activate: Main] Play up to 2 skill-less ≪Monster≫ cards with energy costs of 1 and 2 respectively from your deck in Rest Mode, then shuffle your deck.", "BT15-115", "deck", 2, "play"],
] as const) {
  const rec = record(text, what);
  const picks = named(rec);
  assert.equal(picks.length, n, `A: ${what} — a choice per name (${rec.reads})`);
  assert.ok(picks.every((p) => p.sel.area === area && p.sel.side === "you"), `A: ${what} — every card from your ${area} (${JSON.stringify(picks.map((p) => [p.sel.side, p.sel.area]))})`);
  assert.ok(picks.slice(1).every((p, i) => p.sel.notIn?.includes(picks[i].as)), `A: ${what} — each a card of its own`);
  const acts = opsDeep(rec.ops).filter((o) => o.op === act);
  assert.ok(picks.every((p) => acts.some((o) => targetVar(o) === p.as)), `A: ${what} — every card chosen is acted on (${act})`);
  records++;
}
{
  // The measures: each name's own (BT7-031, BT12-136), every card's when printed once in the plural (BT9-054), the
  // dash aside's colour (EX23-01), "up to" for each name (BT7-075), both owed without it (BT12-138), a cost each (BT15-115).
  const kale = named(record("[Activate: Main] When you have 3 or more energy: Choose up to 1 blue <Kale> card and 1 yellow <Caulifla> card with energy costs of 2 or less in your hand and play them, then negate this skill for the duration of the game.", "BT7-075"));
  assert.deepEqual(kale.map((p) => [p.sel.upTo, p.sel.filter?.colors, p.sel.filter?.costMax]), [[true, ["Blue"], 2], [true, ["Yellow"], 2]], "A: BT7-075 — up to 1 of each, each its colour, both 2 or less");
  const vegeta = named(record("[Auto] When you play this card, you may choose 1 card in your hand and place it in your Drop Area. If you do, choose up to 1 yellow {Super Saiyan Blue Vegeta} with an energy cost of 2 and up to 1 {SSB Son Goku, the Sweeper} from your deck, add them to your hand, then shuffle your deck.", "BT7-031"));
  assert.deepEqual(vegeta.map((p) => [p.sel.filter?.costMin ?? null, p.sel.filter?.colors]), [[2, ["Yellow"]], [null, []]], "A: BT7-031 — the cost and colour are the Vegeta's alone");
  const frieza = named(record("[activate: main][once per turn]{r}{r}{u}{2}, if your opponent has 20 or fewer cards in their deck: Play up to 1 <Frieza> card and up to 1 <Cooler> card―both Red/Blue multicolor and with an energy cost of 5―from your hand, then switch up to 2 of your energy to Active Mode at the end of the turn.", "EX23-01"));
  assert.ok(frieza.every((p) => p.sel.filter?.multiColor && p.sel.filter.colors.join() === "Red,Blue" && p.sel.filter.costMin === 5), "A: EX23-01 — both multicolour red and blue, cost 5");
  const xeno = named(record("[activate: main] If you have a black Unison Card in play: Place this card in its owner's Drop Area, then play 1 <Son Gohan: Xeno> card with an energy cost of 1 and 1 <Trunks: Xeno> card with an energy cost of 1 from your deck or Drop Area, then shuffle your deck if you looked through it.", "BT12-138"));
  assert.ok(xeno.every((p) => !p.sel.upTo && p.sel.count === 1 && p.sel.areas?.join() === "deck,drop"), "A: BT12-138 — one of each, owed, from the deck or Drop");
  const monsters = named(record("[Activate: Main] Play up to 2 skill-less ≪Monster≫ cards with energy costs of 1 and 2 respectively from your deck in Rest Mode, then shuffle your deck.", "BT15-115"));
  assert.deepEqual(monsters.map((p) => [p.sel.filter?.costMin, p.sel.filter?.skillLess]), [[1, true], [2, true]], "A: BT15-115 — a card per cost, both skill-less");
  const spaceship = named(record("[activate: main][limit 1]{r}{r}, if your Leader Card is a <Son Goku: GT> card: Play up to 1 <Son Goku: GT> card and up to 1 <Trunks: GT> card—both red and with 15000 power or less—from under a {Spaceship, Vessel of Hope} in your Unison Area.", "BT17-010"));
  assert.ok(spaceship.every((p) => p.sel.filter?.powerMax === 15000 && p.sel.underHost?.filter?.names.join().toLowerCase() === "spaceship, vessel of hope"), "A: BT17-010 — 15000 or less, from under the Spaceship");
  records += 6;
}
{
  // A pair in energy switched to Rest Mode (BT7-057): #970's disjoint list, offered as one.
  const rec = record("[Auto] When this card is placed in a Drop Area from a Battle Area by a skill, you may choose 1 red card and 1 green card in your energy and switch them to Rest Mode. If you do, choose up to 1 <Vegeta> card that is both red and green in your Drop Area with an energy cost of 6 or less and play it.", "BT7-057");
  const offer = rec.ops.find((o): o is Extract<Op, { op: "may" }> => o.op === "may");
  const pair = offer ? opOf(offer.ops, "choose") : [];
  assert.ok(pair.length === 2 && pair.every((p) => p.sel.area === "energy" && !p.sel.upTo) && pair[1].sel.notIn?.[0] === pair[0].as, `A: BT7-057 — a red and a green energy, in the offer (${rec.reads})`);
  assert.deepEqual(opOf(offer!.ops, "switchMode").map(targetVar), pair.map((p) => p.as), "A: BT7-057 — both switched to Rest Mode");
  records++;
}
{
  // Prices: "you choose 1 red <Android 17> and 1 red <Android 18> from under the Z-Extras in your Battle Area" (BT23-022),
  // "…and 1 <Videl> card—all from under this card" (BT24-007, five individual cards — its Q&A).
  for (const [text, what, n] of [
    ["[activate: main][limit 1]{r}{r}, if you have 4 or more energy and you choose 1 red <Android 17> and 1 red <Android 18> from under the Z-Extras in your Battle Area: Draw 1 card, play this card from your hand, and place all of the chosen cards under it.", "BT23-022", 2],
    ["[activate: main][once per turn]{r}{r}, if you have 4 or more energy and you choose 1 <Son Gohan: Adolescence> card, 1 <Son Goten> card, 1 <Vegeta> card, 1 <Trunks: Youth> card, and 1 <Videl> card—all from under this card: Play up to 1 {SSG Son Goku, Crimson Guardian Deity} from your Z-Deck with 5 markers on it and place the chosen cards under it.", "BT24-007", 5],
  ] as const) {
    const rec = record(text, what);
    const price = opOf(rec.cost?.program ?? [], "choose");
    assert.ok(price.length === n && price.every((p) => p.sel.area === "under" && !p.sel.upTo) && price.slice(1).every((p, i) => p.sel.notIn?.includes(price[i].as)), `A: ${what} — the price takes ${n} cards from under (${JSON.stringify(price.map((p) => p.sel.area))})`);
    records++;
  }
}
{
  // "Play or add to your hand" (R-252): both played or both added — the option first.
  const pair = record("[Activate: Main] If your Leader Card is a red <Gogeta: Br> card: Play or add to your hand up to 1 skill-less <Son Goku: Br> card with an energy cost of 1 and up to 1 skill-less <Vegeta: Br> card with an energy cost of 1 from your deck, then shuffle your deck.", "BT11-029");
  const menu = opOf(pair.ops, "chooseMode")[0];
  assert.ok(menu && menu.modes.length === 2, `A: BT11-029 — two options (${pair.reads})`);
  assert.equal(opOf(menu.modes[0].ops, "play").length, 2, "A: BT11-029 — the pair played");
  assert.equal(opOf(menu.modes[1].ops, "moveTo").filter((o) => o.to === "hand").length, 2, "A: BT11-029 — or the pair added");
  assert.ok(opOf(menu.modes[0].ops, "choose").every((p) => p.sel.area === "deck"), "A: BT11-029 — from the deck, not the hand");
  const one = record("[activate: main]{g}, if your Leader Card is a green <Gotenks> card and you discard this card from your hand: Play or add to your hand up to 1 green <Trunks: Youth> card with an energy cost of 3 from your deck, then shuffle your deck.", "BT11-078");
  const single = opOf(one.ops, "chooseMode")[0];
  assert.ok(single && opOf(single.modes[0].ops, "play").length === 1 && opOf(single.modes[1].ops, "moveTo").length === 1 && opOf(one.ops, "choose").every((p) => p.sel.area === "deck"), `A: BT11-078 — played or added, from the deck (${one.reads})`);
  records += 2;
}
{
  // After a look, the card to play on top is one of the cards looked at (BT28-103).
  const rec = record("[Activate: Main] If your Leader is a yellow <Son Gohan: Adolescence> card, you may choose 1 of your yellow <Son Gohan: Adolescence> cards with an energy cost of 4. If you do, look at up to 1 card from the top of your deck, then play up to 1 yellow ≪Heroic≫ <Son Gohan: Adolescence> card on top of the chosen card in Active Mode.", "BT28-103");
  const play = opOf(rec.ops, "play")[0];
  const pick = chooses(rec).find((c) => c.as === targetVar(play));
  assert.ok(pick && pick.sel.fromVar === "looked" && play.onto && "var" in play.onto && play.onto.var === chooses(rec)[0].as, `A: BT28-103 — one of the cards looked at, on top of the chosen card (${rec.reads})`);
  records++;
}

// ── B. choice lists (R-251) ──────────────────────────────────────────────────
for (const [text, what, act, n] of [
  ["[auto] When this card is played, choose up to 1 of your opponent's Battle Cards and up to 1 card in your opponent's hand and place them at the bottom of their owners' decks in any order.", "BT18-144", "moveTo", 2],
  ["[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and up to 1 of their energy and switch them to Rest Mode.", "DB2-121", "switchMode", 2],
  ["[Auto][Limit 1] If this card has 4 or more markers on it: When this card is played, draw 1 card, then choose up to 1 of your red Battle Cards and up to 1 of your red Leader Cards and they get +5000 power for the turn.", "BT17-003", "power", 2],
  ["[activate: main][once per turn] If this card is in Rest Mode: Choose up to 1 of your opponent's Battle Cards in Rest Mode and up to 1 of their energy in Rest Mode, and the chosen cards can't be switched to Active Mode until the end of your opponent's next turn.", "BT13-101", "forbid", 2],
  ["[Auto] When this card attacks, choose up to 1 Battle Card in your opponent's Battle Area and up to 1 Battle Card in your opponent's Drop and use them in a combo in your Combo Area with their skills negated for the turn.", "BT25-062", "comboFrom", 2],
  ["[auto] When this card is played or attacks, choose up to 1 card in your opponent's hand, up to 1 of their Z-Energy, and up to 1 of their Battle Cards—all ignoring [barrier]—and place them into their owner's Drop.", "BT30-150", "moveTo", 3],
] as const) {
  const rec = record(text, what);
  const picks = chooses(rec);
  const acts = opsDeep(rec.ops).filter((o) => o.op === act);
  assert.ok(picks.length === n && picks.every((p) => acts.some((o) => targetVar(o) === p.as)), `B: ${what} — every card of the list (${act}) (${rec.reads})`);
  records++;
}
{
  const all = record("[auto] When this card is played or attacks, choose up to 1 card in your opponent's hand, up to 1 of their Z-Energy, and up to 1 of their Battle Cards—all ignoring [barrier]—and place them into their owner's Drop.", "BT30-150");
  assert.ok(chooses(all).every((p) => p.sel.ignoreBarrier), "B: BT30-150 — the aside's 'all' marks every choice");
  // Both sent to the Warp under one name, both played back (BT13-096).
  const warp = record("[Auto] When this card is played, choose this card and up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and send them to their owners' Warps; at the end of the turn, negate the skills of all cards sent to Warps by this skill for the turn and play them to their owners' Battle Areas.", "BT13-096");
  const sent = opOf(warp.ops, "moveTo").filter((o) => o.to === "warp");
  const back = opOf(warp.ops, "choose").find((p) => p.sel.fromVar);
  assert.ok(sent.length === 2 && sent[0].as && sent.every((o) => o.as === sent[0].as) && back?.sel.fromVar === sent[0].as, `B: BT13-096 — this card and theirs sent, and both played back (${warp.reads})`);
  // "All other Battle Cards" is the rest of them (BT24-140, its third option).
  const other = record("[activate: main][limit 3] Choose one— ・Draw 1 card and your opponent discards 1 card from their hand. ・Choose up to 1 of your opponent's cards and switch it to Rest Mode. ・Choose 1 of your Battle Cards and 1 of your opponent's Battle Cards, ignoring [barrier], and place all other Battle Cards at the bottom of their owners' decks in any order.", "BT24-140");
  const third = opOf(other.ops, "chooseMode")[0]?.modes[2]?.ops ?? [];
  const kept = opOf(third, "choose").slice(0, 2).map((p) => p.as);
  const rest = opOf(third, "choose")[2];
  assert.ok(rest && rest.sel.count === 99 && kept.every((v) => rest.sel.notIn?.includes(v)) && !rest.sel.notSelf && opOf(third, "moveTo")[0] && targetVar(opOf(third, "moveTo")[0]) === rest.as, `B: BT24-140 — the two chosen stay, all others go (${other.reads})`);
  // Two choices told apart by place (TB3-055).
  const pile = record("[Auto] When you play this card, draw 1 card, then choose up to 1 ≪Namekian≫ card in your Battle Area and up to 3 ≪Namekian≫ cards in your Drop Area, and place the chosen cards from your Drop Area under the chosen card in your Battle Area.", "TB3-055");
  const [host, guests] = chooses(pile);
  const under = opOf(pile.ops, "moveTo")[0];
  assert.ok(targetVar(under) === guests.as && under.under && "var" in under.under && under.under.var === host.as, `B: TB3-055 — the Drop cards under the Battle Area card (${JSON.stringify(under)})`);
  // "The Battle Card you played" is the card played (EX07-10, BT8-068).
  const kale = record("[Auto] If your Leader Card is a yellow ≪Universe 6≫ card and your opponent has 3 or more energy: When you play this card, choose up to 1 blue <Kale> card with an energy cost of 4 in your Drop Area, negate its skills for the duration of the turn, and play it in Rest Mode; at the end of the turn, place the Battle Card played with this skill at the bottom of its owner's deck.", "EX07-10");
  const later = opOf(kale.ops, "delay")[0];
  assert.ok(later && !opOf(later.ops, "choose").length && targetVar(opOf(later.ops, "moveTo")[0]) === targetVar(opOf(kale.ops, "play")[0]), `B: EX07-10 — the Kale played goes to the deck, no other card (${kale.reads})`);
  records += 5;
}
{
  // "Play up to 1 of them" out of a list pools two choices, which no selector does: unread (EX23-25).
  const [rec] = skillRecords(card("EX23-25", { skill: "[auto] Send 2 cards from under this card to your Warp: When this card attacks, your opponent discards 1 card from their hand, and at the start of your next turn, you choose up to 1 each of <Android 17> and <Hell Fighter 17> cards with an energy cost of 1 from your Warp, then play up to 1 of them and add up to 1 of them to your Z-Energy." }));
  assert.ok(rec.unread.some((u) => /up to 1 of them/.test(u)), `B: EX23-25 — unread (${JSON.stringify(rec.unread)})`);
  records++;
}

// ── C. the opponent's hand, unseen (R-253) ───────────────────────────────────
for (const [text, what, blind] of [
  ["[auto] When this card is played, choose up to 1 card in your opponent's hand or up to 1 of their Battle Cards and send it to its owner's Warp.", "BT13-146", true],
  ["[Activate: Main] Place this card in its owner's Drop Area: Choose up to 1 card in your opponent's hand and discard it.", "BT10-086", true],
  ["[Auto] When you play this card, if your Leader Card is <Vegito>, choose up to 1 of your opponent's Battle Cards and up to 1 of the cards in your opponent's hand and place them in the Drop Area, then draw 2 cards.", "BT3-063", true],
  ["[auto] When you play this card, choose up to 2 cards from your opponent's hand at random and place them in the Drop Area.", "BT1-073", false],
  ["[Auto] When this card is played, look at your opponent's hand, choose up to 1 card in it and place it in their Drop Area.", "AS2-LOOKED", false],
] as const) {
  const rec = record(text, what);
  const hand = chooses(rec).find((p) => p.sel.fromVar || (p.sel.side === "opponent" && p.sel.area === "hand"));
  assert.ok(hand, `C: ${what} — a choice of the opponent's hand`);
  assert.equal(!!hand.blind, blind, `C: ${what} — ${blind ? "unseen" : "seen or not a pick by sight"} (${rec.reads})`);
  if (blind) assert.match(rec.reads, /without seeing them/, `C: ${what} — the reading says so`);
  records++;
}

// ── D. no owner (R-254) ──────────────────────────────────────────────────────
for (const [text, what, side] of [
  ["[Auto][Limit 1] When this card is played, you may choose 1 ≪Villainous≫ card and place it in its owner's Drop. If you do, this card gets +10000 power and [Double Strike] for the turn.", "P-435", "both"],
  ["[Activate: Battle] Choose up to 1 ≪God≫ card and it gets +6000 power for the battle.", "BT16-017", "both"],
  ["[activate: battle] [once per turn] [burst 1] If this card is in a battle: Choose up to 1 <Vegito> or <Vegito: Xeno> card -- both black and with an energy cost of 7 -- and switch your card that's in a battle with the chosen card.", "BT31-085", "you"],
  ["[Activate: Main] Choose up to 1 of your <Kale> cards and it gets +5000 power for the turn.", "AS2-MINE", "you"],
] as const) {
  const rec = record(text, what);
  const pick = named(rec)[0];
  assert.equal(pick?.sel.side, side, `D: ${what} — ${side} (${rec.reads})`);
  records++;
}
{
  // A list whose first card lost its place to the second is refused, never read as a card on the table.
  const [rec] = skillRecords(card("AS2-LOST", { skill: "[Activate: Main] Choose up to 1 <Kale> card and up to 1 <Caulifla> card in your hand with their skills negated and send them to your Warp." }));
  assert.ok(rec.unread.length || named(rec).every((p) => p.sel.area === "hand"), `D: AS2-LOST — refused or both from the hand (${rec.reads} | ${JSON.stringify(rec.unread)})`);
  records++;
}

// ── E. "up to N cards from the top of your deck" (R-255) ─────────────────────
for (const [text, what, n] of [
  ["[auto] At the end of your turn, place up to 2 cards from the top of your deck in your energy, then negate this skill for the duration of the game.", "EX08-04", 2],
  ["[auto] When this card is removed from a Battle Area by an opponent's skill or KO'd, add up to 1 card from the top of your deck to your energy.", "BT30-020", 1],
  ["[Auto] If your Leader's back side is {Gamma 1 & Gamma 2, Justice}: When this card in your energy is placed into its owner's Drop by the skill of a blue ≪Red Ribbon Army≫ card in any area, add up to 1 card from the top fo your deck to your energy in Rest Mode.", "BT27-032", 1],
  ["[activate: main][once per turn] Reveal up to 3 cards from the top of your deck and place them in your Drop.", "EX23-32", 3],
  ["[Auto] When this card is played from your hand, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], place it at the bottom of their deck, then choose up to 1 of your blue <Kale> Leaders and place up to 2 cards from the top of your deck under it.", "P-537", 2],
] as const) {
  const rec = record(text, what);
  const top = chooses(rec).find((p) => p.sel.area === "deck");
  assert.ok(top && top.sel.take === n && top.sel.upTo && !top.sel.filter, `E: ${what} — up to the top ${n}, not a search (${rec.reads})`);
  assert.match(rec.reads, new RegExp(`up to the top ${n}`), `E: ${what} — said so`);
  records++;
}

// ── F. "to your opponent's Battle Area" ──────────────────────────────────────
for (const [text, what] of [
  ["[auto]{r}, if your Leader Card is a <King Vegeta: Br> card: At the start of your opponent's turn, play up to 1 red ≪Saiyan≫ card with 500 power from your deck to your opponent's Battle Area, then shuffle your deck.", "BT13-028"],
  ["[Activate: Main] If your Leader Card is a red ≪Saiyan≫-only card: Play up to 1 red ≪Saiyan≫ card with an energy cost of 1 and 500 power from your deck to your opponent's Battle Area, shuffle your deck, and draw 1 card.", "BT13-029"],
  ["[Counter: Attack][Limit 1] Negate the attack and play this card in your opponent's Battle Area.", "BT20-123"],
] as const) {
  const rec = record(text, what);
  const play = opOf(rec.ops, "play")[0];
  assert.ok(play?.toOpponent, `F: ${what} — into the opponent's Battle Area (${rec.reads})`);
  assert.match(rec.reads, /in your opponent's Battle Area/, `F: ${what} — said so`);
  records++;
}
{
  // The Unison Area stays unread (BT15-129's gap).
  const [rec] = skillRecords(card("AS2-UNI", { skill: "[Activate: Main] Play the Unison Card under this card in your opponent's Unison Area." }));
  assert.ok(rec.unread.length, "F: a play into the opponent's Unison Area stays unread");
  // "Would leave the Battle Area by a skill" keeps its cause (BT25-014).
  const swap = record("[Permanent] If this card would leave the Battle Area by a skill, you may play 1 Battle Card from under this card into your opponent's Battle Area with its skills negated for the turn instead.", "BT25-014");
  const rep = opOf(swap.ops, "replace")[0];
  assert.ok(rep && rep.event === "leave" && rep.by === "skillOrKoBySkill" && opOf(rep.with, "play")[0]?.toOpponent, `F: BT25-014 — a skill's removal only, the card under played to the opponent (${swap.reads})`);
  records += 2;
}

// ── G. honest gaps ───────────────────────────────────────────────────────────
for (const [text, what] of [
  // A cost bound counted off the board: no filter field holds it (was read as a Battle Card in the opponent's hand).
  ["[activate: main]{g}{g}, discard this card from your hand: Choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to the number of cards in their hand, ignoring [barrier], and KO it.", "P-300"],
  ["[auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with an energy cost greater than the number of cards in their hand and KO it.", "BT15-145"],
  ["[auto] When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to the number of cards in your Z-Deck, ignoring [barrier], and send it to its owner's Warp.", "BT22-127"],
  // "Not a copy of this card" excludes this card; it is not this card (was "move this card to hand").
  ["[Activate: Main][Limit 1] If your Leader is a <Evil Saiyan> or <Cumber> card—both black: Play this card from your hand in your opponent's Battle Area, look at up to 5 cards from the top of your deck, add up to 1 <Mai: Future> card or ≪Saiyan≫ card—both black, not a copy of this card, and with an energy cost of 6 or less—among them to your hand, and shuffle your deck.", "BT20-124"],
] as const) {
  const [rec] = skillRecords(card(what, { skill: text }));
  assert.ok(rec.unread.length, `G: ${what} — unread (${rec.reads})`);
  assert.ok(!opsDeep(rec.ops).some((o) => o.op === "moveTo" && "sel" in o.target && o.target.sel.special === "self" && o.to === "hand"), `G: ${what} — never this card to the hand`);
  records++;
}

// ── VM ───────────────────────────────────────────────────────────────────────
const vmDefs: Record<string, CardDef> = {
  ...DEFS,
  "AS2-PAIR": card("AS2-PAIR", { skill: "[Activate: Main] Choose up to 1 <AS2 Kale> card and up to 1 <AS2 Caulifla> card with energy costs of 2 or less in your Drop Area and play them." }),
  "AS2-KALE": card("AS2-KALE", { characters: ["AS2 Kale"], energyCost: 2 }),
  "AS2-CAUL": card("AS2-CAUL", { characters: ["AS2 Caulifla"], energyCost: 1 }),
  "AS2-LIST": card("AS2-LIST", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and up to 1 of their energy and switch them to Rest Mode." }),
  "AS2-PEEK": card("AS2-PEEK", { skill: "[Activate: Main] Choose up to 1 card in your opponent's hand and discard it." }),
  "AS2-TOP": card("AS2-TOP", { skill: "[Activate: Main] Place up to 2 cards from the top of your deck in your energy." }),
  "AS2-GIFT": card("AS2-GIFT", { skill: "[Activate: Main] Play up to 1 <AS2 Gift> card from your hand to your opponent's Battle Area." }),
  "AS2-GIFTEE": card("AS2-GIFTEE", { characters: ["AS2 Gift"] }),
};
const vmRows = Object.values(vmDefs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs: vmDefs, scripts: rulesFromRows(roundtrip(vmRows), vmDefs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
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
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
type Prompt = VmState["prompt"];
function settle(s0: VmState, pick: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[], answer = 0): VmState {
  let s = s0;
  for (let i = 0; i < 60 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: pick(q) });
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: answer } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", "settled");
  return s;
}
function activate(s: VmState, c: string, pick: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[], answer = 0): VmState {
  const offer = RULES.legalActions(ctx, s).find((l) => (l.action as { card?: string }).card === c && l.action.type === "activate");
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), pick, answer);
}
let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // A: both named cards come out of the Drop and are played.
  {
    let s = fresh(seat, 53000 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS2-PAIR", "battle");
    const kale = stage(s, seat, "AS2-KALE", "drop");
    const caul = stage(s, seat, "AS2-CAUL", "drop");
    const inPlay = stage(s, seat, "AS2-KALE", "battle");
    let offered: string[] = [];
    s = activate(s, me, (q) => ((offered = [...offered, ...q.choice.candidates]), q.choice.candidates.slice(0, 1)));
    assert.ok(!offered.includes(inPlay), `${seat}: A — the Kale already in play is not on offer`);
    assert.ok(s.sides[seat].zones.battle.includes(kale) && s.sides[seat].zones.battle.includes(caul), `${seat}: A — both played from the Drop`);
    cases++;
  }
  // B: both cards of the list are rested.
  {
    let s = fresh(seat, 53010 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS2-LIST", "battle");
    const theirs = stage(s, foe, "V-BLUE", "battle");
    const energy = stage(s, foe, "V-BLUE", "energy");
    s = activate(s, me, (q) => q.choice.candidates.filter((c) => c === theirs || c === energy).slice(0, 1));
    assert.deepEqual([s.cards[theirs].mode, s.cards[energy].mode], ["rest", "rest"], `${seat}: B — the Battle Card and the energy both rested`);
    cases++;
  }
  // E: "up to 2 from the top" asks how many, unseen, and takes the top that many in order.
  {
    let s = fresh(seat, 53030 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS2-TOP", "battle");
    const [first, second] = s.sides[seat].zones.deck.slice(0, 2);
    let seen: string[] = [];
    s = activate(s, me, (q) => ((seen = q.choice.candidates), []), 1);
    assert.deepEqual(seen, [], `${seat}: E — no card offered to pick`);
    assert.ok(s.sides[seat].zones.energy.includes(first) && !s.sides[seat].zones.energy.includes(second), `${seat}: E — "1 from the top" took the top card only`);
    cases++;
  }
  // F: the card is played into the opponent's Battle Area, its owner unchanged.
  {
    let s = fresh(seat, 53040 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS2-GIFT", "battle");
    const gift = stage(s, seat, "AS2-GIFTEE", "hand");
    s = activate(s, me, (q) => q.choice.candidates.filter((c) => c === gift));
    assert.ok(s.sides[foe].zones.battle.includes(gift) && !s.sides[seat].zones.battle.includes(gift), `${seat}: F — in the opponent's Battle Area`);
    cases++;
  }
  // C: the opponent's hand is offered unseen.
  {
    let s = fresh(seat, 53020 + (seat === "p1" ? 0 : 1));
    const me = stage(s, seat, "AS2-PEEK", "battle");
    const secret = stage(s, foe, "V-BLUE", "hand");
    let blind = false;
    let labels: string[] = [];
    const offer = RULES.legalActions(ctx, s).find((l) => (l.action as { card?: string }).card === me && l.action.type === "activate");
    assert.ok(offer);
    s = take(s, offer.action);
    for (let i = 0; i < 10 && s.prompt.kind !== "chooseCards"; i++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player } as Action);
    if (s.prompt.kind === "chooseCards") {
      blind = !!s.prompt.choice.blind;
      labels = RULES.legalActions(ctx, s).map((l) => l.label);
    }
    assert.ok(blind && labels.some((l) => /face-down card/.test(l)) && !labels.some((l) => l.includes("V-BLUE")), `${seat}: C — offered by position (${labels.join(" | ")})`);
    s = settle(s, (q) => q.choice.candidates.slice(0, 1));
    assert.ok(s.sides[foe].zones.drop.includes(secret), `${seat}: C — and discarded`);
    cases++;
  }
}

console.log(`audit-selectors-2: ${records} records, ${cases} VM cases`);

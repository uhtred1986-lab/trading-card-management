/**
 * Audit triggers 3 (3 Nov 2026): more of the [Auto] skills unread on their moment alone, taught by the general moment
 * grammar (subject × event × origin × cause) — a keyword's move watched (`watchedKeywordMove`), a card's move between
 * areas (`zoneMoveOf`), going into a pile from an area (`placedUnderFrom`), used in a combo / added to the Z-Energy /
 * placed from the Combo Area in the grammar's own table, a list of names in a description ("<Raditz>, <Vegeta>, or
 * <Nappa>"), and an older card's condition before its moment ("If …, when you play this card, …"). Also: a combo a skill
 * makes reaches its watchers (`youCombo`/`opponentCombos` had no moment, the production fuzz of 3 Nov 2026), every
 * moment a record can carry and every name the interpreter pends is declared, and the probe stages the card a watched
 * moment describes. Printed text inline (catalog snapshot of 3 Nov 2026; the VM cases' cards are synthetic).
 *
 * A.  The records, one representative per family.
 * B.  What stays unread, and what stays as it was.
 * C.  Every trigger name declared; every name the interpreter pends has a moment.
 * D.  The VM, both seats: [Over Realm] watched and [Dark Over Realm] not; a card your skill sent from the opponent's hand
 *     to their Warp; a card placed under a described card from the hand.
 * E.  The probe: "when your ≪Saiyan≫ card is played / attacks" is tried with a ≪Saiyan≫.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { TRIGGERS } from "../../src/lib/arena/gaps";
import { pendedNameHasMoment } from "../../src/lib/arena/vm/host";
import { priceFromCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { probe, scenariosFor, type ProbeRule } from "../../src/lib/arena/probe";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const only = (text: string, what: string, o: Partial<CardDef> = {}): Rec => {
  const recs = skillRecords(card(what, { skill: correctSkillText(what, text) ?? text, ...o }));
  assert.equal(recs.length, 1, `${what}: one record`);
  return recs[0];
};
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
const chain = (rec: Rec): Cond[] => {
  const out = flat(rec.cond);
  for (let at = rec.ops; at.length === 1 && at[0].op === "if" && !at[0].else; at = at[0].then) out.push(...flat(at[0].cond));
  return out;
};
const subjectOf = (rec: Rec) => chain(rec).find((c) => c.kind === "count" && c.sel.special === "subject") as Extract<Cond, { kind: "count" }> | undefined;
const onTopOf = (rec: Rec) => chain(rec).find((c) => c.kind === "count" && c.sel.special === "onTop") as Extract<Cond, { kind: "count" }> | undefined;
const lower = (xs: readonly string[] | undefined) => xs?.map((x) => x.toLowerCase());

// ── A. the records ───────────────────────────────────────────────────────────
// [card id, printed text, triggers (sorted), what else the record asks]
const A: [string, string, string[], ((rec: Rec) => void)?][] = [
  // A keyword's move, watched.
  ["BT9-094", "[Auto] When your Leader Card activates [Awaken], draw 1 card and this card gets +10000 power for the duration of the turn.", ["awakenActivated"],
    (r) => assert.equal(subjectOf(r)?.sel.filter?.type, "LEADER")],
  ["P-533", "[auto][limit 1] If your Leader's back side is {SS4 Son Goku, Senses Regained}, you have 3 or more energy, and you place 1 of your red Battle Cards with 25000 power or more in your Drop: When your Leader's [awaken] skill activates, play this card from your hand, and this card gains [triple strike] and [dual attack] for the turn.", ["awakenActivated"]],
  ["BT8-131", "[Auto] When your Leader Card activates [Awaken] or [Wish], this card gets +20000 power and [Double Strike] for the duration of the turn.", ["awakenActivated", "wishActivated"]],
  ["BT16-111", "[Auto][Once per turn] When you activate [Over Realm], draw 1 card.", ["overRealmPlayed"], (r) => assert.equal(subjectOf(r), undefined)],
  ["BT11-123", "[Auto][Once per turn] When you activate an [Over Realm] skill, add a marker to this card.", ["overRealmPlayed"]],
  ["BT17-121", "[Auto][Limit 1] When you activate [Overlord], play up to 1 Demon Realm Soldier Token. (Demon Realm Soldier Tokens have 5000 power, 0 combo cost, and 5000 combo power.)", ["overlordActivated"]],
  ["P-568", "[Auto] When your yellow <Garlic Jr.> activates an [Overlord] skill, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it.", ["overlordActivated"],
    (r) => assert.deepEqual(lower(subjectOf(r)?.sel.filter?.characters), ["garlic jr."])],
  ["BT12-055", "[Auto] If you have 3 or more green energy: When you activate a [Rejuvenate] skill, draw 2 cards, then flip this card over.", ["rejuvenateActivated"]],
  ["EX18-01", "[Auto][Once per turn] When you activate the [Blocker] skill on one of your yellow Battle Cards, add a marker to this card.", ["yourCardBlockerUsed"],
    (r) => assert.deepEqual([subjectOf(r)?.sel.filter?.type, subjectOf(r)?.sel.filter?.colors], ["BATTLE", ["Yellow"]])],
  ["BT14-123", "[Auto] When your Leader Card activates a [Blocker] skill, place the top card of your deck in your Drop Area, then add a marker to this card.", ["yourCardBlockerUsed"]],
  ["BT26-140", "[auto] When your opponent activates a [blocker] or [counter] skill, choose all of your opponent's Battle Cards, send them to their owner's Warp, and your opponent sends 1 card from their hand to its owner's Warp.", ["opponentBlockerUsed", "opponentCounter"]],
  ["P-449", "[auto][limit 1] When you activate a [counter] skill, switch this card to Active Mode, and choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.", ["youCounter"]],
  ["BT21-101", "[auto] If you have 2 or more energy: When you activate [swap] on one of your yellow <Frieza> cards, you may flip this card to its back side. If you do, draw 2 cards, then add cards from your life to your hand until you have 6 life left.", ["swapActivated"]],
  ["BT19-067", "[Auto] If you have 2 or more energy: When one of your Z-Energy cards activates [EX-Evolve], you may flip this card to its back. If you do, draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.", ["yourCardExEvolveFromZEnergy"],
    (r) => assert.equal(subjectOf(r), undefined, "BT19-067: the Z-Energy says where, not what")],
  // A card's move between areas.
  ["BT31-108", "[auto] Send 1 card from your hand to its owner's Warp: When this card is sent to its owner's Warp, add up to 1 red ≪Evil Incarnate≫ card with no keyword skills from your Warp to your hand.", ["toWarp"]],
  ["BT5-048", "[Auto] When this card is sent from a Battle Area to a Warp, choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp, then look at the bottom card of your deck and add up to 1 <Janemba> card from it to your hand, then shuffle your deck.", ["battleToWarp"],
    (r) => assert.ok(JSON.stringify(r.ops).includes("\"fromVar\":\"looked\""), "BT5-048: the <Janemba> card is one of the cards looked at, not the card sent to the Warp")],
  ["BT31-018", "[auto] [limit 1] If your Leader is {Janemba, Blade of Hatred}: When this card is sent to its owner's Warp by a skill, play this card from its owner's Warp.", ["toWarpBySkill"]],
  ["P-760", "[auto] When this card in your Z-Deck is added to your Z-Energy, choose up to 1 of your yellow ≪Saiyan≫ cards and it gets +5000 power for the turn.", ["zDeckToZEnergy"]],
  ["DB1-097", "[Auto] When this card is returned to its owner's hand from the Battle Area, choose up to 1 of your opponent's Battle Cards and return it to its owner's hand.", ["battleToHand"]],
  ["BT12-088", "[Auto] If your Leader Card is yellow and all of your energy is mono-yellow: When this face-up card in your life is placed in your Drop Area, if you don't have a Unison Card in play, you may play this card from your Drop Area with a marker on it.", ["faceUpLifeToDrop"]],
  ["BT20-023", "[Auto][Once per turn] When you add a card from your life to your hand, place up to 1 blue card from your Drop under this card.", ["yourLifeToHand"]],
  ["BT11-088", "[Auto] When you add cards from your life to your hand or place cards from your life in your Drop Area, place the top card of your deck under this card.", ["yourLifeToHandOrDrop"]],
  ["BT13-004", "[Auto][Once per turn] When your opponent adds a card from their life to their hand or places a card from their life in their Drop Area, add a marker to this card, and if it's your turn, this card gets +5000 power for the turn.", ["opponentLifeToHandOrDrop"]],
  ["DB3-133", "[Auto][Once per turn] When your opponent adds a card from their life to their hand or Drop Area, add a marker to this card.", ["opponentLifeToHandOrDrop"]],
  ["BT7-019", "[Auto] When a card in your opponent's life is placed in their Drop Area, you may place this card in its owner's Drop Area. If you do, choose up to 1 red {Natade Village Monster} with an energy cost of 2 from your deck and play it, then shuffle your deck.", ["opponentLifeToDrop"]],
  ["BT18-031", "[Auto] If you have 2 or more energy: When one of your energy is added to your Z-Energy, you may flip this card over. If you do, draw 2 cards, then add cards from your life to your hand until you have 6 life left.", ["yourEnergyToZEnergy"]],
  ["P-326", "[Auto][Limit 1] If you have 4 or more energy and you place this card in its owner's Drop Area: When an opponent's card is sent to the Warp, choose up to 1 red or green <Vegeta> card with an energy cost of 4 and up to 1 red or green <Nappa> card with an energy cost of 4 in your deck and play them with their non-keyword skills negated for the game, then shuffle your deck.", ["opponentCardToWarp"]],
  ["P-346", "[auto][limit 1]{g}: When a card in your opponent's hand is sent to their Warp by one of your skills, you may play this card from your hand.", ["opponentHandToWarpByYou"]],
  ["BT13-148", "[Auto][Once per turn] If your Leader Card is black: When a Battle Card in your opponent's Drop Area is sent to their Warp by one of your skills, draw 1 card, then choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp.", ["opponentDropToWarpByYou"],
    (r) => assert.equal(subjectOf(r)?.sel.filter?.type, "BATTLE")],
  ["BT16-003", "[Auto][Once per turn] If it's your turn: When a card is placed in your Drop Area from your deck, add a marker to this card, then choose up to 1 of your opponent's Battle Cards and it gets -15000 power for the turn.", ["yourDeckToDrop"]],
  ["BT22-058", "[auto][once per turn] If you have 4 or more energy: When a Battle Area card is placed in a Drop, this card gets +5000 power and [double strike] for the turn.", ["eitherBattleToDrop"]],
  ["BT10-092", "[Auto][Once per turn] If your opponent has 1 or more energy: When your opponent activates an Extra Card, draw 1 card.", ["opponentExtraActivated"]],
  ["BT13-061", "[Auto][Once per turn] When you activate a green Extra Card with an original energy cost of 2 and the [Field] skill, draw 1 card.", ["extraActivated"],
    (r) => assert.deepEqual([subjectOf(r)?.sel.filter?.keywords, subjectOf(r)?.sel.filter?.originalCostMin], [["Field"], 2])],
  // The grammar's own table.
  ["BT12-085", "[Auto][Once per turn] If it's your opponent's turn: When a yellow skill-less Battle Card with 15000 power is placed in your Drop Area from your Combo Area, you may play it from your Drop Area.", ["comboToDrop"],
    (r) => assert.equal(subjectOf(r)?.sel.filter?.powerMin, 15000)],
  ["BT24-025", "[Auto] When a card in your Combo Area is placed in its owner's Drop, you may play up to 2 blue ≪Hero≫ cards with energy costs of 1 from your Combo Area in Rest Mode. If you do, negate this skill for the turn.", ["comboToDrop"]],
  ["SD9-02", "[Auto] When {King Vegeta's Dynasty} in your Battle Area is placed in its owner's Drop Area, activate this skill. If {Raditz, Earth Invader} isn't in play in your Battle Area, you may play this card from your hand.", ["yourCardBattleToDrop"]],
  ["SD22-07", "[auto][limit 1]{y}, if your Leader is a yellow <Vegeta> card: When you add one of your yellow cards to your Z-Energy, play this card from your hand.", ["yourCardToZEnergy"],
    (r) => assert.deepEqual(subjectOf(r)?.sel.filter?.colors, ["Yellow"])],
  ["BT12-142", "[Auto][Once per turn] If your Leader Card is a black ≪Demon Realm Race≫ card and it's your turn: When you use a black ≪Evil Wizard≫, ≪Demon Realm Race≫, or ≪Demon God≫ card in a combo, draw 1 card.", ["youCombo"],
    (r) => assert.deepEqual(lower(subjectOf(r)?.sel.filter?.traits), ["evil wizard", "demon realm race", "demon god"])],
  ["BT26-111", "[Auto] If this card isn't in a battle: When you or your opponent uses a card with <Son Goku> in its character name in a combo, use this card in a combo in your Combo Area, and this card gets +10000 combo power for the battle.", ["opponentCombos", "youCombo"]],
  // Going into a pile, from the areas named; the card on top a condition.
  ["BT23-025", "[auto][limit 1] When this card in your hand is placed under a {Destroyed West City} in your Battle Area, place up to 1 red <Android 18> card from your deck under a Z-Extra in your Battle Area, then shuffle your deck.", ["placedUnderFromHand"],
    (r) => assert.equal(onTopOf(r)?.sel.area, "battle")],
  ["BT20-014", "[Auto][Limit 1] When this card is placed from your hand or Drop under an <Anilaza> or <Koichiarator> card―both red and in your Battle Area―choose up to 1 of your opponent's Battle Cards, and it gets -10000 power for the turn.", ["placedUnderFromDrop", "placedUnderFromHand"],
    (r) => assert.deepEqual([onTopOf(r)?.sel.filter?.colors, lower(onTopOf(r)?.sel.filter?.characters), onTopOf(r)?.sel.area], [["Red"], ["anilaza", "koichiarator"], "battle"])],
  ["P-635", "[Auto][Limit 1] When this card in your hand or Battle Area is placed under your green <Mai: Future>-only Leader, your Leader gets +10000 power for the turn.", ["placedUnderFromBattle", "placedUnderFromHand"]],
  // Wordings of known moments.
  ["P-163", "[Auto] When you attack with this card, draw 1 card.", ["attacks"]],
  ["BT4-040", "[Auto] When you attack with this card or combo with it, if your Leader Card is blue, place up to 3 cards from the top of your deck in your Drop Area.", ["attacks", "comboUsed"]],
  ["BT26-014", "[Auto] If your Leader is red and your life is at 4 or less: When this card is used in combo, draw 1 card.", ["comboUsed"]],
  ["P-522", "[auto][limit 1]{u}{u}, if your Leader is a blue <Paikuhan> card and you have 3 or more energy: When this card in your Z-Energy is placed in your Drop, play up to 1 blue <Paikuhan> card with an energy cost of 8 from your hand.", ["zEnergyToDrop"]],
  ["EX19-06", "[+1][auto] When a card in your Energy Area is placed in its owner's Drop Area, draw 1 card, then switch this card to Active Mode.", ["energyToDrop"]],
  ["BT31-021", "[auto] When this card is played or sent to its owner's Warp by a skill, choose up to 2 of your opponent's Battle Cards and they get -5000 power for the turn.", ["played", "toWarpBySkill"]],
  ["BT2-022", "[Auto] If you have 6 or more red energy, when you play this card, look at up to 7 cards from the top of your deck. Choose up to 2 red Battle Cards among them with 25000 or less power other than <Evil Wizard Babidi> and play them. Then, shuffle your deck.", ["played"],
    (r) => assert.ok(chain(r).some((c) => c.kind === "count" && c.sel.area === "energy" && c.atLeast === 6), "BT2-022: the condition in front of the moment is kept")],
  ["BT16-142", "[auto] If your Leader Card is a blue <Vegeta: Br> or blue <Gogeta: Br> card: At the end of a turn where this card was played, draw 1 card, then add up to 1 Red/Blue multicolor card from your Drop Area to your energy.", ["opponentTurnEnd", "turnEnd"],
    (r) => assert.ok(chain(r).some((c) => c.kind === "placedThisTurn" && c.played), "BT16-142: the turn this card was played")],
  ["BT23-042", "[Auto][Limit 1] If your Leader is a blue <Raditz> or <Nappa> card and it's your turn: When your mono-blue <Raditz>, <Vegeta>, or <Nappa> card is played, draw 1 card.", ["youPlayed"],
    (r) => assert.deepEqual(lower(subjectOf(r)?.sel.filter?.characters), ["raditz", "vegeta", "nappa"])],
];
let records = 0;
for (const [id, text, triggers, check] of A) {
  const rec = only(text, id);
  assert.deepEqual(rec.unread, [], `${id}: nothing unread (${rec.unread.join(" | ")})`);
  assert.deepEqual([...(rec.trigger ?? [])].sort(), triggers, `${id}: answers ${triggers.join(", ")}`);
  check?.(rec);
  records++;
}

// ── B. what stays unread, and what stays as it was ───────────────────────────
const unread: [string, string][] = [
  // "With power greater than or equal to that card" (the attacking card) is a measure the filter does not take.
  ["BT28-005", "[Auto] When your red <Son Gohan: Youth>, <Vegeta>, <Krillin>, or ≪Namekian≫ card attacks, choose up to 1 of your opponent's Battle Cards with power greater than or equal to that card and KO it."],
  // The played card is in play: the effect would play it again.
  ["BT23-042", "[Auto][Limit 1] If your Leader is a blue <Raditz> or <Nappa> card and it's your turn: When your mono-blue <Raditz>, <Vegeta>, or <Nappa> card is played, your opponent reveals the cards in their hand. Additionally, if your opponent has a Battle Card with 15000 power or less in their hand, play up to 1 <Raditz>, <Vegeta>, or <Nappa> card―all blue, with 16000 power, and a different character name than the played card―from your hand."],
  // A list of areas with commas splits the moment ("in your hand, Z-Energy, or Combo Area").
  ["P-659", "[Auto] [Limit 1] If your Leader's back side is a red <Super 17> card: When this card in your hand, Z-Energy, or Combo Area is placed under your red <Super 17> card, choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn."],
  // A description on one moment of two ("a Battle Card using a skill" beside "a [Counter] skill").
  ["BT10-139", "[Auto][Once per turn] When your opponent plays a Battle Card using a skill or activates a [Counter] skill, choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode."],
  // [Over Realm] or [Dark Over Realm] or a play from the Warp: three moments, a description on one.
  ["BT18-124", "[Auto][Once per turn] If it's your turn: When you activate [Over Realm] or [Dark Over Realm] or play a black Battle Card from your Warp, draw 1 card, and choose up to 1 of your opponent's Battle Cards with an energy cost of 6 or less and send it to its owner's Warp."],
  // "…played from your hand": where from is not remembered.
  ["BT16-015", "[Auto] Choose 1 Red/Blue multicolor card in your energy: At the end of a turn where this card was played from your hand, draw 1 card and switch the chosen card to Active Mode."],
];
for (const [id, text] of unread) assert.ok(only(text, id).unread.length, `${id}: stays unread`);
// "When you use one of your opponent's Battle Cards in a combo" (BT21-068's back) is your combo with their card, never theirs.
assert.deepEqual(only("[Auto][Once per turn] When you use one of your opponent's Battle Cards in a combo, this card gets +5000 power until the end of your opponent's turn.", "BT21-068").trigger, ["youCombo"], "BT21-068: your combo");
// A bare "when you play a card" / "when you activate [Swap]" asks nothing of the card.
assert.equal(subjectOf(only("[Auto] When you activate [Swap], draw 1 card.", "AT3-SWAP")), undefined, "a bare [Swap] asks nothing of the card");

// ── C. every moment declared ────────────────────────────────────────────────
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
for (const t of TRIGGERS) assert.ok(game.triggers[t], `${t}: a record can carry it, and triggers.rules declares it`);
// Every name the interpreter pends has a moment (the fuzz of 3 Nov 2026: "youCombo is a moment no declaration names").
const source = fs.readFileSync(path.join(process.cwd(), "src/lib/arena/vm/script.ts"), "utf8");
const pended = [...new Set([...source.matchAll(/\bh\.pend\("([A-Za-z]+)"/g)].map((m) => m[1]))];
assert.ok(pended.includes("youCombo") && pended.includes("opponentCombos"), "the combo watchers are pended by name");
for (const name of pended) {
  assert.ok(pendedNameHasMoment(name), `${name}: pended by the interpreter, with a moment`);
  assert.ok(game.triggers[name], `${name}: …and declared`);
}

// ── D. the VM ────────────────────────────────────────────────────────────────
const DRAW = "draw 1 card.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  AT3_PLAIN: card("AT3_PLAIN", {}),
  AT3_BLACK: card("AT3_BLACK", { colors: ["Black"] }),
  AT3_OR: card("AT3_OR", { skill: "[Over Realm 1]" }),
  AT3_DOR: card("AT3_DOR", { colors: ["Black"], skill: "[Dark Over Realm 1]" }),
  AT3_W_OR: card("AT3_W_OR", { skill: `[Auto] When you activate [Over Realm], ${DRAW}` }),
  AT3_WARP_HAND: card("AT3_WARP_HAND", { skill: "[Activate: Main] Choose 1 card in your opponent's hand and send it to its owner's Warp." }),
  AT3_W_WARP: card("AT3_W_WARP", { skill: `[Auto] When a card in your opponent's hand is sent to their Warp by one of your skills, ${DRAW}` }),
  AT3_HOST: card("AT3_HOST", { characters: ["Host"], skill: "[Activate: Main] Choose 1 card in your hand and place it under this card." }),
  AT3_UNDER: card("AT3_UNDER", { skill: `[Auto] When this card in your hand is placed under a <Host> card in your Battle Area, ${DRAW}` }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
for (const k of ["AT3_W_OR", "AT3_WARP_HAND", "AT3_W_WARP", "AT3_HOST", "AT3_UNDER"]) assert.deepEqual(skillRecords(defs[k]).flatMap((r) => r.unread), [], `${k}: read`);
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
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
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy", "drop"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
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
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && linesOf(s.cards[c].cardId).includes((l.action as { skill: number }).skill));
function settle(s0: VmState, want: string[] = []): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseCards") {
      const got = want.filter((id) => q.choice.candidates.includes(id)).slice(0, q.choice.max);
      s = take(s, { type: "choose", player: who, cards: got.length ? got : q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `settled (at ${s.prompt.kind})`);
  return s;
}
const activate = (s: VmState, c: string, want: string[] = []): VmState => {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), want);
};
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 53300 + n * 2 + (seat === "p1" ? 0 : 1);

  // D1. [Over Realm] is watched; [Dark Over Realm] is a keyword of its own (22-23) and is not.
  for (const [line, filler, drew] of [["AT3_OR", "AT3_PLAIN", 1], ["AT3_DOR", "AT3_BLACK", 0]] as const) {
    let s = fresh(seat, seed(line === "AT3_OR" ? 0 : 1));
    stage(s, seat, "AT3_W_OR", "battle");
    stage(s, seat, filler, "drop");
    const realm = stage(s, seat, line, "hand");
    s = activate(s, realm);
    assert.ok(s.sides[seat].zones.battle.includes(realm), `${seat}: D1: ${line} played`);
    assert.equal(hand(s, seat), drew, `${seat}: D1: ${line === "AT3_OR" ? "[Over Realm] is watched" : "[Dark Over Realm] is not [Over Realm]"}`);
    cases++;
  }

  // D2. A card your skill sent from the opponent's hand to their Warp.
  {
    let s = fresh(seat, seed(2));
    const me = stage(s, seat, "AT3_WARP_HAND", "battle");
    stage(s, seat, "AT3_W_WARP", "battle");
    const theirs = stage(s, foe, "AT3_PLAIN", "hand");
    s = activate(s, me, [theirs]);
    assert.ok(s.sides[foe].zones.warp.includes(theirs), `${seat}: D2: sent to their Warp`);
    assert.equal(hand(s, seat), 1, `${seat}: D2: …and the watcher drew 1 (opponentHandToWarpByYou)`);
    cases++;
  }

  // D3. Placed under a described card from the hand: the card's own [Auto] answers from the pile.
  {
    let s = fresh(seat, seed(3));
    const host = stage(s, seat, "AT3_HOST", "battle");
    const under = stage(s, seat, "AT3_UNDER", "hand");
    s = activate(s, host, [under]);
    assert.ok(s.cards[host].under.includes(under), `${seat}: D3: placed under the <Host>`);
    assert.equal(hand(s, seat), 1, `${seat}: D3: …and it drew 1 (placedUnderFromHand)`);
    cases++;
  }
}

// ── E. the probe ─────────────────────────────────────────────────────────────
function ruleFor(def: CardDef): ProbeRule {
  const rec = skillRecords(def)[0];
  return { def, side: rec.side, skillIndex: rec.skillIndex, kind: rec.kind, trigger: rec.trigger, usage: rec.usage, validity: rec.validity, ...(rec.combo ? { combo: rec.combo } : {}),
    ops: rec.cond ? [{ op: "if", cond: rec.cond, then: rec.ops }] : rec.ops, open: rec.unread.length > 0, unread: rec.unread, price: priceFromCostRecord(rec.cost) };
}
for (const [id, o] of [
  ["AT3-P-PLAY", { skill: "[Auto] When you play a ≪Saiyan≫ card, draw 1 card." }],
  ["AT3-P-PLAYL", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: "[Auto] When you play a ≪Saiyan≫ card, draw 1 card." }],
  ["AT3-P-ATK", { skill: "[Auto] When your ≪Saiyan≫ card attacks, draw 1 card." }],
] as const) {
  const rule = ruleFor(card(id, o as Partial<CardDef>));
  const run = probe(rule, scenariosFor(rule)[0]);
  assert.equal(run.outcome, "fired", `${id}: the probe stages a ≪Saiyan≫ (${run.input.join(" / ")})`);
  cases++;
}

console.log(`audit-triggers-3: ${records} records, ${unread.length} kept unread, ${TRIGGERS.length} moments declared, ${pended.length} pended names, ${cases} VM and probe cases`);

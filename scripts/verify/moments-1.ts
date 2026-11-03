/**
 * Moments batch 1 (2 Nov 2026): the [Auto] skills a production audit found stored read whole with an empty trigger
 * list — they never fired, and nothing said so. Printed text inline (catalog text of the snapshot of 2 Nov 2026; costs,
 * powers and companions in the VM cases are synthetic).
 *
 * A.  An [Auto] whose moment no reader places records its moment clause as unread (or says it names none); a keyword
 *     hook and BT12-071's Combo Area replacement (moment-less by design) are left alone. The whole list file is
 *     `triggerless-autos.ts`.
 * B.  The families taught, biggest first: a discard (20-7), a switch to Active Mode (1-10-1, BT31-029's Q&A), a Drop to
 *     Warp move by a described card (20-7-3), a power change (BT9-002's Q&A), a deck to Drop move and a revealed card
 *     (20-11-1), a pile (23-2), the energy to the Drop, a Battle Area to the Drop by your skill (3-1), and the Drop from
 *     any area. The cause a card prints is a condition on the skill's card the moment hands on, asked before the Auto is
 *     pended (9-6-2); a cause the target grammar cannot read whole leaves the skill unread.
 *
 * Proved here: the records (the stored-row JSON round trip, the rules language's print and reparse), and in the VM for
 * both seats with every action reloaded from JSON. Rulings: R-126 (official), R-127, R-128, R-129, R-130, R-131, R-132 (pending, best-guess).
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
import type { Cond } from "../../src/lib/arena/vm/script";
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
const only = (text: string, what: string, o: Partial<CardDef> = {}): Rec => {
  const recs = skillRecords(card(what, { skill: text, ...o }));
  assert.equal(recs.length, 1, `${what}: one record`);
  return recs[0];
};
/** The record of `text`, read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, o: Partial<CardDef> = {}): Rec {
  const rec = only(text, what, o);
  assert.deepEqual(rec.unread, [], `${what}: nothing unread`);
  const rule = asRule(rec);
  assert.equal(validateRule(rule, rec.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
  return roundtrip(rec);
}
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" ? c.conds.flatMap(flat) : [c]);
const chain = (rec: Rec): Cond[] => {
  const out = flat(rec.cond);
  for (let at = rec.ops; at.length === 1 && at[0].op === "if" && !at[0].else; at = at[0].then) out.push(...flat(at[0].cond));
  return out;
};
const subjectConds = (rec: Rec) => chain(rec).filter((c) => (c.kind === "count" && c.sel.special === "subject") || (c.kind === "any" && c.conds.every((x) => x.kind === "count" && x.sel.special === "subject")));
let records = 0;

// A. The silent case is loud.
{
  const rec = only("[Auto] When your opponent activates an Extra Card, add a marker to this card.", "BT10-095");
  assert.deepEqual(rec.trigger, [], "A: BT10-095 — no moment read");
  assert.deepEqual(rec.unread, ["When your opponent activates an Extra Card"], "A: …and its moment clause is unread");
  const none = only("[Auto] If your Leader is a yellow ≪Demon Clan≫ card: Look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Demon Clan≫ card among them to your hand, then shuffle your deck.", "P-417");
  assert.ok(/^an \[Auto\] that names no moment never fires/.test(none.unread[0]), `A: P-417 prints no moment and says so (${none.unread[0]})`);
  const iff = only("[Auto] If this card is removed from a Battle Area by a skill, choose up to 1 {SSB Son Goku, Hope for Victory} in your hand and place it in your energy.", "BT10-038");
  assert.deepEqual(iff.unread, ["If this card is removed from a Battle Area by a skill"], "A: BT10-038 — an older card's moment said with \"if\"");
  // Moment-less by design: a replacement of its own departure from the Combo Area stands there like a [Permanent].
  const combo = only("[Auto] If your Leader Card is a ≪Turles Crusher Corps≫ card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.", "BT12-072");
  assert.deepEqual([combo.trigger, combo.unread], [[], []], "A: BT12-072 — read, no moment, by design");
  // A keyword hook names its moments through its keyword.
  assert.ok(skillRecords(card("REV", { skill: "[Revenge]" })).every((r) => !r.unread.length), "A: a keyword line is not refused");
  // A misread effect is not made readable by its moment: BT5-071's "it" names the condition's Leader.
  // (Audit effects 2: its paid play — "…by paying its energy cost" — is unread before the pronoun is asked.)
  assert.ok(/names the Leader|by paying its energy cost/.test(only("[Auto] When this card is placed in your Drop Area from your deck, if your Leader Card is green, you may play it by paying its energy cost.", "BT5-071").unread[0] ?? ""), "A: BT5-071 stays unread");
  records += 6;
}

// B. The moments, each from its printed lines.
const B: [string, string, string, ((rec: Rec) => void)?][] = [
  // discards (20-7-1, 20-7-2, 20-7-3)
  ["[Auto] If your Leader Card is yellow: When this card is discarded from your hand by an opponent's skill, play this card from your Drop Area.", "BT13-098", "droppedFromHandByOpponent"],
  ["[auto]{y}, if your Leader is a <Piccolo: SH> card: When this card is discarded from your hand, play this card from your Drop in Rest Mode with a marker on it.", "BT18-095", "droppedFromHand"],
  ["[Auto][Limit 1] If your Leader is a yellow <Super 17> card and it's your turn: When this card is discarded from your hand by a skill, look at up to 7 cards from the top of your deck, add up to 1 yellow Unison Card with a specified cost of 2 among them to your hand, then shuffle your deck.", "P-448", "droppedFromHand"],
  ["[Auto][Limit 1]{r}{r}, if your Leader is red and your opponent has 3 or more energy: When this card in your hand is discarded by one of you or your opponent's skills, play this card from your Drop, and it gains [Barrier] for the turn.", "BT26-013", "droppedFromHand"],
  ["[auto] When this card is placed in your Drop Area from your hand by a Battle Card's skill, if {Beerus, Godly Majesty} isn't in play in your Battle Area, you may play this card from your Drop Area.", "BT8-053", "droppedFromHand", (rec) => {
    const [c] = subjectConds(rec);
    assert.ok(c?.kind === "count" && c.sel.area === "battle" && c.sel.filter?.type === "BATTLE", `B: BT8-053 — a Battle Card in a Battle Area (20-7-2) (${JSON.stringify(c)})`);
  }],
  ["[auto][limit 1] When you use one of your yellow <Majin Buu> or yellow <Evil Wizard Babidi> card skills to discard this card from your hand, choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.", "BT20-104", "droppedFromHandByYou", (rec) => {
    const [c] = subjectConds(rec);
    assert.ok(c?.kind === "any" && c.conds.length === 2, `B: BT20-104 — either named card (20-7-3) (${JSON.stringify(c).slice(0, 200)})`);
  }],
  ["[auto] If your Leader Card is a red ≪God≫ card and you choose 1 card in your life and add it to your hand: When this card is placed in your Drop Area from your hand by your Leader Card's skill, choose 1 of your opponent's Battle Cards and switch it to Rest Mode.", "P-207", "droppedFromHandByYou", (rec) => {
    const [c] = subjectConds(rec);
    assert.ok(c?.kind === "count" && c.sel.area === "leader" && c.sel.side === "you", "B: P-207 — the cause is your Leader");
  }],
  // switched to Active Mode (1-10-1)
  ["[auto] When this card is switched to Active Mode, it gets +5000 power until the end of your opponent's turn.", "BT31-029", "selfRestToActive"],
  ["[Auto][Once per turn] When this card is switched to Active Mode by a <Dr. Hedo: SH> card skill, choose up to 1 of your opponent's Battle Cards, and it and this card get -5000 power for the turn.", "BT22-020", "activeBySkill", (rec) => {
    const [c] = subjectConds(rec);
    assert.ok(c?.kind === "count" && c.sel.filter?.characters.includes("Dr. Hedo: SH"), "B: BT22-020 — the cause is a <Dr. Hedo: SH> card");
  }],
  ["[Auto] When this card is switched to Active Mode by your Leader Card's skill, add a marker to this card.", "P-212", "activeBySkill"],
  ["[auto][once per turn] When your energy is switched to Active Mode by a skill, switch this card to Active Mode, then choose up to 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode.", "BT22-137", "yourEnergyActiveBySkill"],
  // the Drop to the Warp
  ["[Auto][Limit 1]{y}: When this card is sent from your Drop to your Warp by a ≪Shadow Dragon≫ card's skill, play this card from your Warp.", "P-612", "dropToWarpBySkill"],
  ["[auto][limit 1]{u}: When this card in your Drop is sent to your Warp by your {Soul Punisher, the Cleansing Light} or a blue <Gogeta> card skill, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and place it at the bottom of its owner's deck, then play this card from your Warp.", "BT22-039", "dropToWarpBySkill", (rec) => {
    const [c] = subjectConds(rec);
    assert.ok(c?.kind === "any" && c.conds.length === 2, "B: BT22-039 — either cause, never one card that is both");
  }],
  // power (5-6)
  ["[auto] When this card's power is increased by one of your <Paikuhan> card skills, choose up to 1 of your opponent's Battle Cards and place it on top of its owner's deck.", "BT18-032", "powerRaisedBySkill"],
  ["[Auto][Once per turn] When this card's power is increased by a skill during your turn, draw 1 card.", "EX06-01", "powerRaisedBySkill", (rec) => {
    assert.ok(chain(rec).some((c) => c.kind === "isTurnPlayer"), "B: EX06-01 — during your turn");
  }],
  ["[Auto] When the power of one of your opponent's Battle Cards is decreased, your opponent places the top card of their deck in their Drop Area.", "BT9-002", "opponentCardPowerLowered"],
  ["[auto][once per turn] When the power of one of your opponent's Battle Cards is decreased by the skill of one of your Battle Cards, draw 1 card.", "BT9-002b", "opponentCardPowerLoweredByBattleCard"],
  ["[Auto][Once per turn] When the power of one of your opponent's cards is decreased, choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn.", "BT13-002b", "opponentCardPowerLowered"],
  ["[Auto] When your Leader Card's power is decreased by a skill, it gets +10000 power for the turn.", "EX11-02", "yourCardPowerLowered"],
  ["[Auto][Once per turn] When this card's power is decreased by a skill, it gains [Dual Attack] for the turn.", "EX11-01b", "powerLoweredBySkill"],
  ["[auto][limit 1] When your card's power is increased by one of your skills, draw 1 card, then choose up to 1 of your opponent's Battle Cards and it gets -20000 power for the turn.", "EX23-09", "yourCardPowerRaisedByYou"],
  ["[auto][once per turn] When the power of one of you or your opponent's Battle Cards is decreased, draw 1 card.", "P-517b", "eitherCardPowerLowered"],
  // the deck to the Drop (20-11-1)
  ["[Auto][Limit 1][Burst 1] If your Leader Card is a red ≪Universe 7≫ card: When this card is placed in your Drop Area from your deck by a skill, play it from your Drop Area.", "BT16-009", "deckToDropBySkill"],
  ["[Auto] If your Leader Card is a black ≪Saiyan≫-only card: When this card is placed in your Drop Area from your deck by one of your skills, if you don't have a Unison Card in play, you may play this card from your Drop Area with a marker on it.", "SD16-02", "deckToDropByYou"],
  ["[Auto] If your Leader Card is yellow: When this card is revealed from the top of your deck and placed in your Drop Area, you may play this card from your Drop Area.", "BT14-103", "revealedTopToDrop"],
  // piles (23-2)
  ["[Auto][Once per turn] When a card under this card is returned to its owner's hand, draw 1 card.", "BT26-051", "underReturnedToHand"],
  ["[auto][once per turn] When a card under this card is return to its owner's hand, draw 1 card.", "BT26-052", "underReturnedToHand"],
  ["[Auto] When this card is placed from under a card into its owner's Drop by your {SS Vegito, Transcendent Rage}'s skill, choose up to 1 of your yellow <Vegito> Battle Cards and switch it to Active Mode.", "BT28-094", "underToDropBySkill"],
  ["[auto] If your {SSG Son Goku, Crimson Warrior} is in a battle and there are no cards in your Combo Area: When your Leader Card's skill places this card in a Drop Area from under your Leader Card, use this card in a combo.", "BT16-027", "underLeaderToDropBySkill"],
  ["[auto][limit 1] if your Leader is a green <Super 17> card: When a card is placed from under this card in its owner's Drop by your Leader's skill, choose up to 1 of your opponent's Battle Cards and KO it.", "BT20-073", "pileToDropBySkill"],
  // the energy to the Drop
  ["[Auto] If your Leader is a blue <Zamasu> card: When this card is placed from your energy in a Drop by your Leader's skill, draw 1 card.", "P-485", "energyToDropBySkill"],
  ["[Auto] When one of your energy is placed in your Drop by your Leader's skill, switch this card to Active Mode at the end of the turn.", "EX22-03", "yourEnergyToDropByYourLeader"],
  // a Battle Area, and any area, to the Drop (3-1, 5-12-1)
  ["[Auto] When this card in your Battle Area is placed in its owner's Drop Area by one of your skills, choose up to 1 of your opponent's Unison Cards and remove a marker from it.", "BT13-088", "droppedFromBattleByYou"],
  ["[Auto] When this card is placed in a Drop Area from a Battle Area by one of your skills, draw 1 card, then choose 1 card in your hand and discard it.", "BT13-085", "droppedFromBattleByYou"],
  ["[auto][limit 1] When this card is placed into its owner's Drop by an opponent's skill, play this card from your Drop.", "BT30-058", "toDropByOpponent"],
  ["[auto][limit 1] When this card is placed into its owner's Drop by one of your skills, play this card from your Drop.", "P-701", "toDropByYou"],
  ["[auto][limit 1] If it's your turn: When this card is placed in your Drop by a skill, choose up to 1 of your blue ≪Red Ribbon Army≫ cards and it gets +5000 power for the turn.", "P-421", "toDropBySkill"],
];
for (const [text, what, trigger, more] of B) {
  const rec = record(text, what);
  assert.deepEqual(rec.trigger, [trigger], `B: ${what} answers ${trigger} (${JSON.stringify(rec.trigger)})`);
  more?.(rec);
  records++;
}
// A cause the grammar cannot read whole names no moment: "…by an opponent's skill or by your [Revive] skill" (EX10-05).
assert.equal(only("[Auto] When this card is placed in your Drop Area from your hand by an opponent's skill or by your [Revive] skill, play this card from your Drop Area.", "EX10-05").trigger.length, 0, "B: EX10-05 stays unread");
records++;

// ── 2. the VM ────────────────────────────────────────────────────────────────
const DRAW = "draw 1 card.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  // discards
  OPPDISCARD: card("OPPDISCARD", { skill: "[Activate: Main] Your opponent chooses 1 card in their hand and discards it." }),
  OWNDISCARD: card("OWNDISCARD", { skill: "[Activate: Main] Choose 1 card in your hand and discard it." }),
  BLUEDISCARD: card("BLUEDISCARD", { colors: ["Blue"], skill: "[Activate: Main] Choose 1 card in your hand and discard it." }),
  W_BYOPP: card("W_BYOPP", { skill: `[Auto] When this card is discarded from your hand by an opponent's skill, ${DRAW}` }),
  W_BARE: card("W_BARE", { skill: `[Auto] When this card is discarded from your hand, ${DRAW}` }),
  W_BLUE: card("W_BLUE", { skill: `[Auto] When this card is placed in your Drop Area from your hand by one of your blue card skills, ${DRAW}` }),
  // Active Mode
  HEDO: card("HEDO", { characters: ["Dr. Hedo: SH"], skill: "[Activate: Main] Choose up to 1 of your Battle Cards in Rest Mode and switch it to Active Mode." }),
  NOTHEDO: card("NOTHEDO", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards in Rest Mode and switch it to Active Mode." }),
  W_HEDO: card("W_HEDO", { skill: `[Auto] When this card is switched to Active Mode by a <Dr. Hedo: SH> card skill, ${DRAW}` }),
  W_ACTIVE: card("W_ACTIVE", { skill: `[Auto] When this card is switched to Active Mode, ${DRAW}` }),
  ENERGYUP: card("ENERGYUP", { skill: "[Activate: Main] Choose up to 1 of your energy and switch it to Active Mode." }),
  W_ENERGY: card("W_ENERGY", { skill: `[Auto] When your energy is switched to Active Mode by a skill, ${DRAW}` }),
  // the Drop to the Warp
  SHADOW: card("SHADOW", { traits: ["Shadow Dragon"], skill: "[Activate: Main] Choose up to 1 card in your Drop Area and send it to your Warp." }),
  NOTSHADOW: card("NOTSHADOW", { skill: "[Activate: Main] Choose up to 1 card in your Drop Area and send it to your Warp." }),
  W_WARP: card("W_WARP", { skill: `[Auto] When this card is sent from your Drop to your Warp by a ≪Shadow Dragon≫ card's skill, ${DRAW}` }),
  // power
  PAIKUHAN: card("PAIKUHAN", { characters: ["Paikuhan"], skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it gets +5000 power for the turn." }),
  NOTPAIKUHAN: card("NOTPAIKUHAN", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it gets +5000 power for the turn." }),
  W_RAISED: card("W_RAISED", { skill: `[Auto] When this card's power is increased by one of your <Paikuhan> card skills, ${DRAW}` }),
  LOWER2: card("LOWER2", { skill: "[Activate: Main] Choose up to 2 of your opponent's Battle Cards and they get -5000 power for the turn." }),
  LOWERLEADER: card("LOWERLEADER", { skill: "[Activate: Main] Your opponent's Leader Card gets -5000 power for the turn." }),
  W_THEIRS: card("W_THEIRS", { skill: `[Auto] When the power of one of your opponent's Battle Cards is decreased, ${DRAW}` }),
  W_LEADERDOWN: card("W_LEADERDOWN", { skill: `[Auto] When your Leader Card's power is decreased, ${DRAW}` }),
  // the deck to the Drop
  MILL1: card("MILL1", { skill: "[Activate: Main] Place the top card of your deck in your Drop Area." }),
  REVEAL1: card("REVEAL1", { skill: "[Activate: Main] Reveal the top card of your deck and place it in your Drop Area." }),
  W_DECK: card("W_DECK", { skill: `[Auto] When this card is placed in your Drop Area from your deck by a skill, ${DRAW}` }),
  W_REVEALED: card("W_REVEALED", { skill: `[Auto] When this card is revealed from the top of your deck and placed in your Drop Area, ${DRAW}` }),
  // piles
  UNDERHAND: card("UNDERHAND", { skill: `[Activate: Main] Add 1 card from under this card to your hand.\n[Auto] When a card under this card is returned to its owner's hand, ${DRAW}` }),
  UNDERDROP: card("UNDERDROP", { characters: ["SS Vegito"], name: "SS Vegito, Transcendent Rage", skill: "[Activate: Main] Choose 1 card under this card and place it in your Drop Area." }),
  W_UNDER: card("W_UNDER", { skill: `[Auto] When this card is placed from under a card into its owner's Drop by your {SS Vegito, Transcendent Rage}'s skill, ${DRAW}` }),
  // the energy to the Drop, by your Leader's skill; and any area to the Drop
  "L-DROP": card("L-DROP", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Choose 1 of your energy and place it in your Drop Area." }),
  W_MYENERGY: card("W_MYENERGY", { skill: `[Auto] When one of your energy is placed in your Drop by your Leader's skill, ${DRAW}` }),
  W_ENERGYSELF: card("W_ENERGYSELF", { skill: `[Auto] When this card is placed from your energy in a Drop by your Leader's skill, ${DRAW}` }),
  DROPTHEIRS: card("DROPTHEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." }),
  DROPMINE: card("DROPMINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and place it in your Drop Area." }),
  W_BYTHEM: card("W_BYTHEM", { skill: `[Auto] When this card is placed into its owner's Drop by an opponent's skill, ${DRAW}` }),
  W_BYME: card("W_BYME", { skill: `[Auto] When this card is placed in a Drop Area from a Battle Area by one of your skills, ${DRAW}` }),
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
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
/** The top of the deck made `def`. */
function onTop(s: VmState, p: PlayerId, def: string): string {
  const id = s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  return id;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && linesOf(s.cards[c].cardId).includes((l.action as { skill: number }).skill) && parseSkills(defs[s.cards[c].cardId].skill!).find((sk) => sk.index === (l.action as { skill: number }).skill)?.kind.startsWith("activate"));
type Prompt = VmState["prompt"];
/** Answer every question until the turn player's Main Phase. */
function settle(s0: VmState, steer: { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}): VmState {
  let s = s0;
  for (let i = 0; i < 80 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
    if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: who, index: 0 } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: steer.cards?.(q) ?? q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.equal(s.prompt.kind, "main", `settled (at ${s.prompt.kind})`);
  return s;
}
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
function activate(s: VmState, c: string, steer: Parameters<typeof settle>[1] = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}
const pick = (...ids: string[]) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => { const got = ids.filter((id) => q.choice.candidates.includes(id)).slice(0, q.choice.max); return got.length ? got : undefined; } });

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 41100 + n * 2 + (seat === "p1" ? 0 : 1);

  // B1. Discards: an opponent's skill (their hand, their watcher), the bare discard, and a blue cause only.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "OPPDISCARD", "battle");
    const theirs = stage(s, foe, "W_BYOPP", "hand");
    s = activate(s, me);
    assert.ok(s.sides[foe].zones.drop.includes(theirs), `${seat}: B1: discarded by the opponent's skill`);
    assert.equal(hand(s, foe), 1, `${seat}: B1: …and its watcher drew 1 (droppedFromHandByOpponent)`);
    s = fresh(seat, seed(1));
    const own = stage(s, seat, "OWNDISCARD", "battle");
    stage(s, seat, "W_BYOPP", "hand");
    s = activate(s, own);
    assert.equal(hand(s, seat), 0, `${seat}: B1: your own discard is not an opponent's`);
    s = fresh(seat, seed(2));
    const own2 = stage(s, seat, "OWNDISCARD", "battle");
    stage(s, seat, "W_BARE", "hand");
    s = activate(s, own2);
    assert.equal(hand(s, seat), 1, `${seat}: B1: a bare discard answers any (20-7-1)`);
    for (const [actor, drew] of [["BLUEDISCARD", 1], ["OWNDISCARD", 0]] as const) {
      s = fresh(seat, seed(actor === "BLUEDISCARD" ? 3 : 4));
      const a = stage(s, seat, actor, "battle");
      stage(s, seat, "W_BLUE", "hand");
      s = activate(s, a);
      assert.equal(hand(s, seat), drew, `${seat}: B1: discarded by a ${actor === "BLUEDISCARD" ? "blue" : "red"} card's skill — ${drew ? "answers" : "no trigger (9-6-2)"}`);
    }
    cases += 5;
  }

  // B2. Active Mode: by a <Dr. Hedo: SH> card's skill only; a bare switch answers any; your energy stood by a skill.
  for (const [actor, drew] of [["HEDO", 1], ["NOTHEDO", 0]] as const) {
    let s = fresh(seat, seed(actor === "HEDO" ? 5 : 6));
    const a = stage(s, seat, actor, "battle");
    const w = stage(s, seat, "W_HEDO", "battle");
    s.cards[w].mode = "rest";
    s = activate(s, a, pick(w));
    assert.equal(s.cards[w].mode, "active", `${seat}: B2: switched`);
    assert.equal(hand(s, seat), drew, `${seat}: B2: by ${actor} — ${drew ? "answers (activeBySkill)" : "no trigger"}`);
    cases++;
  }
  {
    let s = fresh(seat, seed(7));
    const a = stage(s, seat, "NOTHEDO", "battle");
    const w = stage(s, seat, "W_ACTIVE", "battle");
    s.cards[w].mode = "rest";
    s = activate(s, a, pick(w));
    assert.equal(hand(s, seat), 1, `${seat}: B2: "switched to Active Mode" answers a skill's switch (selfRestToActive)`);
    s = fresh(seat, seed(8));
    const up = stage(s, seat, "ENERGYUP", "battle");
    stage(s, seat, "W_ENERGY", "battle");
    const e = stage(s, seat, "V1", "energy");
    s.cards[e].mode = "rest";
    s = activate(s, up, pick(e));
    assert.equal(s.cards[e].mode, "active", `${seat}: B2: the energy stood`);
    assert.equal(hand(s, seat), 1, `${seat}: B2: …and the watcher drew 1 (yourEnergyActiveBySkill)`);
    cases += 2;
  }

  // B3. The Drop to the Warp by a ≪Shadow Dragon≫ card's skill only.
  for (const [actor, drew] of [["SHADOW", 1], ["NOTSHADOW", 0]] as const) {
    let s = fresh(seat, seed(actor === "SHADOW" ? 9 : 10));
    const a = stage(s, seat, actor, "battle");
    const w = stage(s, seat, "W_WARP", "drop");
    s = activate(s, a, pick(w));
    assert.ok(s.sides[seat].zones.warp.includes(w), `${seat}: B3: sent to the Warp`);
    assert.equal(hand(s, seat), drew, `${seat}: B3: by ${actor} — ${drew ? "answers" : "no trigger"}`);
    cases++;
  }

  // B4. Power: raised by your <Paikuhan> card's skill only; two of theirs lowered is two moments (BT9-002's Q&A); their
  // Leader lowered, watched by their card.
  for (const [actor, drew] of [["PAIKUHAN", 1], ["NOTPAIKUHAN", 0]] as const) {
    let s = fresh(seat, seed(actor === "PAIKUHAN" ? 11 : 12));
    const a = stage(s, seat, actor, "battle");
    const w = stage(s, seat, "W_RAISED", "battle");
    s = activate(s, a, pick(w));
    assert.equal(hand(s, seat), drew, `${seat}: B4: raised by ${actor} — ${drew ? "answers (powerRaisedBySkill)" : "no trigger"}`);
    cases++;
  }
  {
    let s = fresh(seat, seed(13));
    const a = stage(s, seat, "LOWER2", "battle");
    stage(s, seat, "W_THEIRS", "battle");
    const t1 = stage(s, foe, "V-BLUE", "battle");
    const t2 = stage(s, foe, "V-BLUE", "battle");
    s = activate(s, a, pick(t1, t2));
    assert.equal(hand(s, seat), 2, `${seat}: B4: two of theirs lowered — two moments`);
    s = fresh(seat, seed(14));
    const l = stage(s, seat, "LOWERLEADER", "battle");
    stage(s, foe, "W_LEADERDOWN", "battle");
    s = activate(s, l);
    assert.equal(hand(s, foe), 1, `${seat}: B4: their Leader lowered — their watcher answers (yourCardPowerLowered)`);
    cases += 2;
  }

  // B5. The deck to the Drop: a skill's move answers; a revealed card answers a reveal only (20-11-1).
  {
    let s = fresh(seat, seed(15));
    const a = stage(s, seat, "MILL1", "battle");
    const w = onTop(s, seat, "W_DECK");
    s = activate(s, a);
    assert.ok(s.sides[seat].zones.drop.includes(w), `${seat}: B5: milled`);
    assert.equal(hand(s, seat), 1, `${seat}: B5: …and it answered (deckToDropBySkill)`);
    for (const [actor, drew] of [["REVEAL1", 1], ["MILL1", 0]] as const) {
      s = fresh(seat, seed(actor === "REVEAL1" ? 16 : 17));
      const r = stage(s, seat, actor, "battle");
      const top = onTop(s, seat, "W_REVEALED");
      s = activate(s, r);
      assert.ok(s.sides[seat].zones.drop.includes(top), `${seat}: B5: in the Drop`);
      assert.equal(hand(s, seat), drew, `${seat}: B5: by ${actor} — ${drew ? "revealed and placed: answers" : "placed without a reveal: no moment"}`);
    }
    cases += 3;
  }

  // B6. Piles: a card under this card returned to the hand; a card placed from under its host by the named card's skill.
  {
    let s = fresh(seat, seed(18));
    const host = stage(s, seat, "UNDERHAND", "battle");
    const under = stage(s, seat, "V1", "under", host);
    s = activate(s, host);
    assert.ok(s.sides[seat].zones.hand.includes(under), `${seat}: B6: the card under it went to the hand`);
    assert.equal(hand(s, seat), 2, `${seat}: B6: …and the host drew 1 (underReturnedToHand)`);
    s = fresh(seat, seed(19));
    const vegito = stage(s, seat, "UNDERDROP", "battle");
    const w = stage(s, seat, "W_UNDER", "under", vegito);
    s = activate(s, vegito, pick(w));
    assert.ok(s.sides[seat].zones.drop.includes(w), `${seat}: B6: placed from under in the Drop`);
    assert.equal(hand(s, seat), 1, `${seat}: B6: …by your {SS Vegito, Transcendent Rage}'s skill — answers (underToDropBySkill)`);
    cases += 2;
  }

  // B7. Your energy placed in your Drop by your Leader's skill: the watcher and the card itself answer.
  {
    let s = fresh(seat, seed(20), "L-DROP");
    stage(s, seat, "W_MYENERGY", "battle");
    const e = stage(s, seat, "W_ENERGYSELF", "energy");
    const leader = s.sides[seat].zones.leader[0];
    s = activate(s, leader, pick(e));
    assert.ok(s.sides[seat].zones.drop.includes(e), `${seat}: B7: the energy went to the Drop`);
    assert.equal(hand(s, seat), 2, `${seat}: B7: the watcher and the card each drew 1 (yourEnergyToDropByYourLeader, energyToDropBySkill)`);
    cases++;
  }

  // B8. Any area to the Drop: their card by your skill (theirs answers); your card from your Battle Area by your skill.
  {
    let s = fresh(seat, seed(22));
    const a = stage(s, seat, "DROPTHEIRS", "battle");
    const t = stage(s, foe, "W_BYTHEM", "battle");
    s = activate(s, a, pick(t));
    assert.ok(s.sides[foe].zones.drop.includes(t), `${seat}: B8: placed in its owner's Drop`);
    assert.equal(hand(s, foe), 1, `${seat}: B8: …by an opponent's skill — answers (toDropByOpponent)`);
    s = fresh(seat, seed(23));
    const d = stage(s, seat, "DROPMINE", "battle");
    const m = stage(s, seat, "W_BYME", "battle");
    s = activate(s, d, pick(m));
    assert.equal(hand(s, seat), 1, `${seat}: B8: your card by your skill — answers (droppedFromBattleByYou)`);
    cases += 2;
  }
}

console.log(`verify/moments-1: ok (${records} records, ${cases} VM cases across both seats)`);

/**
 * Audit triggers 2 (3 Nov 2026): the [Auto] skills unread on their moment alone (405 of them, 336 wordings), taught by
 * one grammar for a watched card's moment — whose card × what happened to it × from where × who made it happen
 * (`watchedMomentOf`, `text/triggers.ts`) — and R-204's second half: a printed "choose" of the card a moment names is a
 * choice. Printed text inline (catalog snapshot of 3 Nov 2026; costs, powers and companions in the VM cases are
 * synthetic).
 *
 * A.  The grammar, one representative per family: removed (by a skill, by an opponent's skill, with no cause), KO'd
 *     (by whom), attacks and KOs, attacked, attacks (a player's, an opponent's, your Leader), a Unison to the Drop,
 *     played (one of your, a named card, from the Drop / Warp / energy / life), "this card or X", switched to Rest
 *     Mode, the [Evolve] / [EX-Evolve] / [Swap] / [Aegis] moves, and a life card moved.
 * B.  What stays unread, and what stays as it was.
 * C.  R-204 (owner, 3 Nov 2026): "choose that card", "choose it", "choose up to 1 of those Battle Cards" are choices
 *     (`choice`), the choices the compiler writes for wording that prints none are not.
 * D.  The VM, both seats: a watched removal by any skill, an opponent's card KO'd by your skill, a Unison placed in the
 *     Drop from the Unison Area (and not from the hand), and [Barrier] against "choose that card".
 *
 * Rulings: R-204 (owner). R-135 (pending) for "removed … by an opponent's skill or KO'd".
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { resolveSelector } from "../../src/lib/arena/vm/program";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond, Op, Selector } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. the records ───────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const asRule = (rec: Rec) => roundtrip({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    if ((k === "upTo" || k === "choice") && x === false) return undefined;
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
  assert.deepEqual(rec.unread, [], `${what}: nothing unread (${rec.unread.join(" | ")})`);
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
const subject = (rec: Rec) => chain(rec).find((c) => c.kind === "count" && c.sel.special === "subject") as Extract<Cond, { kind: "count" }> | undefined;
const chooses = (ops: readonly Op[]): Selector[] => ops.flatMap((op) => (op.op === "choose" ? [op.sel] : []).concat(op.op === "if" ? [...chooses(op.then), ...chooses(op.else ?? [])] : []));
let records = 0;
// A description is read as said, in lower case; the VM compares names and traits without case.
const lower = (xs: readonly string[] | undefined) => xs?.map((x) => x.toLowerCase());

// A. The grammar: [printed text, card id, triggers (sorted), what the subject condition asks of the card handed on].
const A: [string, string, string[], ((rec: Rec) => void)?][] = [
  // removed from a Battle Area (3-1)
  ["[auto] When one of your ≪Red Ribbon Army≫ cards is removed from your Battle Area by a skill, this card gets +5000 power for the turn.", "BT17-038", ["yourCardRemovedBySkill"],
    (rec) => assert.deepEqual(lower(subject(rec)?.sel.filter?.traits), ["red ribbon army"], "BT17-038: a ≪Red Ribbon Army≫ card")],
  ["[Auto][Once per turn] When one of your opponent's Battle Cards is removed from their Battle Area by a skill or KO'd, add a marker to this card.", "DB3-103", ["opponentCardKoed", "opponentCardRemovedBySkill"]],
  ["[Auto] When a <Bulma> card in your Battle Area is removed from your Battle Area by an opponent's skill or KO'd, you may play this card from your hand.", "BT8-111", ["yourCardKoed", "yourCardRemovedByOpponent"],
    (rec) => assert.deepEqual(lower(subject(rec)?.sel.filter?.characters), ["bulma"], "BT8-111: a <Bulma> card, the place set aside")],
  ["[auto] [limit 1] If your Leader is green and you send this card from your Drop to its owner's Warp: When your green ≪Saiyan≫ card is removed from a Battle Area by your opponent's card's skill, draw 1 card.", "BT32-058", ["yourCardRemovedByOpponent"]],
  ["[Auto][Limit 1] When your Battle Card is removed from a Battle Area, switch this card in a Battle Area to Active Mode.", "BT27-059", ["yourCardLeftBattle"]],
  ["[Auto] When your {Power-Infused Shocking Death Ball} leaves the Battle Area, place up to 1 red <Android 17> card from your Drop under your Leader.", "BT26-030", ["yourCardLeftBattle"]],
  // KO'd, and by whom (5-12)
  ["[Auto] When one of your green Battle Cards is KO'd by an opponent's skill, you may play this card from your hand. If you do, this card gets +10000 power for the turn.", "BT15-072", ["yourCardKoedByOpponentSkill"]],
  ["[Auto] If your Leader is a green ≪Boujack Brigade≫ card: When your green ≪Boujack Brigade≫ card is KO'd by one of your skills, you may place that card from your Drop face-up in your Z-Deck.", "BT25-077", ["yourCardKoedByYourSkill"]],
  ["[auto][once per turn] When an opponent's Battle Card is KO'd by one of your skills, switch this card to Active Mode.", "BT24-008", ["opponentCardKoedByYourSkill"]],
  ["[Auto] When a <Krillin> card with an energy cost of 4 or more in your Battle Area is KO'd by your opponent, if your Leader Card is green or black, play this card from your hand.", "TB3-035", ["yourCardKoedByOpponent"],
    (rec) => assert.equal(subject(rec)?.sel.filter?.costMin, 4, "TB3-035: an energy cost of 4 or more")],
  // attacks and KOs (8-4-6-2), is attacked, attacks (8-1-3)
  ["[auto][limit 1]{g}, if your Leader Card is green and this card is in your Combo Area: When one of your green Battle Cards attacks and KOs an opponent's Battle Card, play this card from your Combo Area.", "BT16-050", ["yourCardKosByAttack"],
    (rec) => assert.deepEqual(subject(rec)?.sel.filter?.colors, ["Green"], "BT16-050: the attacker is green")],
  ["[Auto] When a ≪Universe 7≫ <Son Goku> card in your Battle Area is attacked, negate the attack, and negate this skill for the game.", "SD21-03", ["yourCardAttacked"]],
  ["[auto][once per turn] When a player attacks, add a marker to this card.", "BT17-033", ["opponentAttacks", "yourCardAttacks"]],
  ["[auto]{1}: When an opponent's Battle Card with an energy cost of 4 or less attacks, negate the attack, then negate this skill for the turn.", "DB2-148", ["opponentAttacks"],
    (rec) => assert.equal(subject(rec)?.sel.filter?.costMax, 4, "DB2-148: an energy cost of 4 or less")],
  ["[Auto] If your Leader Card is a yellow ≪Turles Crusher Corps≫ card: When your Leader Card attacks, draw 1 card.", "BT15-094", ["yourCardAttacks"],
    (rec) => assert.equal(subject(rec)?.sel.filter?.type, "LEADER", "BT15-094: the Leader attacking")],
  ["[Auto][Once per turn] Switch this card to Rest Mode: When you attack with a <Gotenks> card with an energy cost of 5 or more, draw 1 card.", "P-404", ["yourCardAttacks"]],
  // a Unison to the Drop (Q&A BT17-059, BT17-069: from the Unison Area)
  ["[Auto][Once per turn] When one of your green Unison Cards is placed in your Drop Area, draw 1 card.", "BT17-059", ["yourUnisonToDrop"],
    (rec) => assert.deepEqual([subject(rec)?.sel.filter?.type, subject(rec)?.sel.filter?.colors], ["UNISON", ["Green"]], "BT17-059: a green Unison")],
  ["[auto][limit 1] If your Leader is a yellow <Son Goku> card: When your yellow Unison is placed in your Drop, this card gets +5000 power for the turn.", "P-423", ["yourUnisonToDrop"]],
  // played (5-5), and from where
  ["[Auto][Once per turn] If you have 2 or more energy: When one of your yellow <Son Goku> cards with an energy cost of 2 is played, this card gets +6000 power for the turn.", "BT21-115", ["youPlayed"]],
  ["[Auto][Limit 1] When you play {Final Strike Bardock}, draw 1 card.", "EX25-10", ["youPlayed"],
    (rec) => assert.deepEqual(lower(subject(rec)?.sel.filter?.names), ["final strike bardock"], "EX25-10: the named card")],
  ["[Auto] [Once per turn] When {Toughened Up Krillin} is played in your Battle Area, draw 1 card.", "TB2-056", ["youPlayed"]],
  ["[Auto][Once per turn] If your Leader Card is a blue ≪Phantom Demon≫ card and it's your turn: When you play a blue Battle Card from your Drop Area, add a marker to this card.", "BT14-034", ["yourCardPlayedFromDrop"]],
  ["[Auto] If your Leader Card is a black <Trunks: Xeno>-only card: When a black Battle Card is played from your Warp, this card gains [Wormhole] for the turn.", "BT16-110", ["yourCardPlayedFromWarp"]],
  ["[Auto] When a blue card is played from your energy, place the top card of your deck in your energy in Rest Mode.", "BT17-032", ["yourCardPlayedFromEnergy"]],
  ["[auto] [limit 1] If your Leader is a red <Launch> card: When you play a Battle Card from your life, draw 1 card.", "P-406", ["yourCardPlayedFromLife"]],
  ["[Auto][Once per turn] When you or your opponent play a non-token Battle Card, it can't attack for the duration of the turn.", "BT8-041", ["eitherCardPlayed"]],
  // two subjects of one predicate
  ["[Auto][Once per turn] When this card or an opponent's card is played, draw 1 card.", "BT27-085", ["opponentPlayed", "played"],
    (rec) => assert.equal(subject(rec), undefined, "BT27-085: \"an opponent's card\" says nothing more")],
  ["[Auto][Once per turn] Send 1 ≪Saiyan≫ card from your Drop to its owner's Warp: When this card or your opponent's Battle Card is played, choose up to 1 of your opponent's Battle Cards and it gets -20000 power for the turn.", "BT27-123", ["opponentPlayed", "played"],
    (rec) => assert.ok(chain(rec).some((c) => c.kind === "any"), "BT27-123: a Battle Card, asked only of the opponent's card")],
  ["[Auto] When this card or one of your opponent's cards attacks, draw 1 card.", "BT11-012", ["attacks", "opponentAttacks"]],
  ["[Auto] When this card or your opponent attacks, draw 1 card.", "BT21-149", ["attacks", "opponentAttacks"]],
  // switched to Rest Mode (1-10)
  ["[auto][limit 1]{1}, if your life is at 4 or less: When an opponent's card is switched to Rest Mode by one of your skills, play this card from your hand.", "BT19-148", ["restedTheirsBySkill"]],
  ["[Auto] When one of your yellow ≪Android≫ Battle Cards is switched to Rest Mode by a skill, draw 1 card.", "BT13-092", ["yourBattleCardRestedBySkill"]],
  ["[Auto] If you have 5 or more energy: When one of your opponent's Battle Cards is switched to Rest Mode by a skill, you may play this card from your hand.", "DB1-075", ["opponentBattleCardRestedBySkill"]],
  // keyword moves (22-5, 22-22, 22-30)
  ["[Auto][Once per turn] When one of your blue Battle Cards activates an [Evolve] skill from your hand, draw 1 card.", "BT14-032", ["evolveActivated"]],
  ["[Auto][Once per turn] When a yellow Battle Card activates an [EX-Evolve] skill from your hand, add a marker to this card.", "BT16-073", ["yourCardExEvolveFromHand"]],
  ["[Auto][Once per turn] When one of your red Battle Cards activates a [Swap] skill, add a marker to this card.", "BT11-004", ["swapActivated"]],
  ["[auto][once per turn] When you activate [swap], draw 1 card.", "BT21-101", ["swapActivated"]],
  ["[Auto] When this card activates [Aegis], draw 1 card.", "EX05-03", ["aegisActivated"]],
  ["[auto] When this card activates its [aegis blue/yellow] skill, choose up to 1 of your opponent's non-Leader Cards and switch it to Rest Mode.", "BT16-130", ["aegisActivated"],
    (rec) => assert.ok(!chooses(rec.ops).some((s) => s.area === "leader" && !s.areas), "BT16-130: a non-Leader card is not chosen in the Leader Area")],
  ["[auto] When this card's [aegis] skill activates, draw 1 card.", "P-534", ["aegisActivated"]],
  // life (3-9)
  ["[auto] When a card is moved from your life to another area, choose up to 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode.", "BT31-072", ["lifeLeft"]],
];
for (const [text, id, triggers, check] of A) {
  const rec = record(text, id);
  assert.deepEqual([...(rec.trigger ?? [])].sort(), triggers, `A: ${id} — ${triggers.join(", ")} (${(rec.trigger ?? []).join(", ")})`);
  check?.(rec);
  records++;
}

// B. Unread: "other than" a kind (BT10-011, BT25-085), a means (BT11-124, BT15-033), one moment inside another (BT6-114).
for (const [text, id] of [
  ["[Auto] When one of your red ≪Earthling≫ cards other than a <Bulma> card is removed from a Battle Area by an opponent's skill, you may play this card from your hand.", "BT10-011"],
  ["[auto] If this card is in Rest Mode: When an opponent's card other than their Leader attacks, your opponent discards 1 card from their hand.", "BT25-085"],
  ["[auto][once per turn] If your Leader Card is black: When your opponent plays a Battle Card using a non-keyword skill, they choose 1 card from their hand and discard it.", "BT11-124"],
  ["[auto][once per turn] If it's your opponent's turn: When you play a blue Battle Card using [arrival], add a marker to this card.", "BT15-033"],
  ["[Auto] When your <Son Goku: Childhood> card is KO'd by an opponent's skill or leaves a Battle Area, choose up to 1 of your opponent's Battle Cards and KO it.", "BT6-114"],
] as const) {
  assert.ok(only(text, id).unread.length, `B: ${id} stays unread`);
  records++;
}
// …and as it was: a Leader attacked keeps its own moment (SD15-02), "KO'd by an opponent's attack" is no attack (BT13-103).
assert.deepEqual(record("[-6][Auto] If your opponent's life is at 3 or more: When your mono-red ≪Saiyan≫ Leader Card is attacked, deal 1 damage to your opponent.", "SD15-02").trigger, ["yourLeaderAttacked"], "B: SD15-02 — yourLeaderAttacked alone");
assert.deepEqual([...(record("[Auto] When one of your yellow <Son Gohan: Future> cards is KO'd by an opponent's attack or removed from your Battle Area by one of their skills, draw 1 card.", "BT13-103").trigger ?? [])].sort(), ["yourCardKoedByAttack", "yourCardRemovedByOpponent"], "B: BT13-103 — no attack moment");
records += 2;

// C. R-204: a printed "choose" of the card a moment names is a choice; one the compiler writes for "play it" is not.
for (const [text, id, kinds, o] of [
  ["[Auto] When your opponent plays a Battle Card or Unison Card, you may choose that card and it gets -10000 power for the turn. If you do, negate this skill for the turn.", "EX13-02", [true], {}],
  ["[auto][once per turn] If your Leader Card is a yellow <Trunks: Future> card: When your opponent plays a Battle Card or Unison Card, choose it and switch it to Rest Mode.", "BT16-081", [true], {}],
  ["[Counter: Play] When the Battle Card is played, choose up to 1 of those Battle Cards and it gets -15000 power for the duration of the turn.", "DB1-020", [true], { type: "EXTRA" }],
  ["[Counter: Play] If your Leader is a black <Cumber> card and you discard 1 card from your hand: If the Battle Card being played has an energy cost of 4 or less, play it in your Battle Area instead and it gains [Servant] for the game.", "BT20-136", [false], { type: "EXTRA" }],
  ["[auto] When this card attacks a Battle Card, KO that card after the battle.", "BT1-015", [false], {}],
] as const) {
  const rec = record(text, id, o as Partial<CardDef>);
  const special = chooses(rec.ops).filter((s) => s.special === "subject" || s.special === "resolving" || s.special === "guard");
  assert.deepEqual(special.map((s) => !!s.choice), kinds, `C: ${id} — ${kinds.join(", ")}`);
  if (kinds[0]) assert.match(printRule(asRule(rec)), /\basChoice\b/, `C: ${id} — the rules language says it`);
  records++;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const DRAW = "draw 1 card.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  AT2_RRA: card("AT2_RRA", { traits: ["Red Ribbon Army"] }),
  AT2_PLAIN: card("AT2_PLAIN", {}),
  AT2_REMOVE_THEIRS: card("AT2_REMOVE_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  AT2_REMOVE_MINE: card("AT2_REMOVE_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards other than this card and return it to its owner's hand." }),
  AT2_W_REMOVED: card("AT2_W_REMOVED", { skill: `[Auto] When one of your ≪Red Ribbon Army≫ cards is removed from your Battle Area by a skill, ${DRAW}` }),
  AT2_KO_THEIRS: card("AT2_KO_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  AT2_KO_MINE: card("AT2_KO_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards other than this card and KO it." }),
  AT2_W_KOED: card("AT2_W_KOED", { skill: `[Auto] When an opponent's Battle Card is KO'd by one of your skills, ${DRAW}` }),
  AT2_UNISON: card("AT2_UNISON", { type: "UNISON", colors: ["Green"], energyCost: null, comboCost: null, comboPower: null }),
  AT2_DROP_UNISON: card("AT2_DROP_UNISON", { skill: "[Activate: Main] Choose up to 1 of your Unison Cards and place it in your Drop Area." }),
  AT2_DISCARD: card("AT2_DISCARD", { skill: "[Activate: Main] Choose 1 card in your hand and discard it." }),
  AT2_W_UNISON: card("AT2_W_UNISON", { skill: `[Auto] When one of your green Unison Cards is placed in your Drop Area, ${DRAW}` }),
  AT2_BARRIER: card("AT2_BARRIER", { power: 20000, skill: "[Barrier]" }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
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
  return s;
}
/** A card from the deck's bottom, made `def`, put in `area` (in-play areas Active). */
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
/** Answer every question until the turn player's Main Phase; a choice takes the ids asked for when offered. */
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
function activate(s: VmState, c: string, want: string[] = []): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), want);
}
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
void (null as unknown as Prompt);

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 52200 + n * 2 + (seat === "p1" ? 0 : 1);

  // D1. Removed from your Battle Area by a skill — an opponent's or your own — watched for a ≪Red Ribbon Army≫ card only.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "AT2_REMOVE_THEIRS", "battle");
    const rra = stage(s, foe, "AT2_RRA", "battle");
    stage(s, foe, "AT2_W_REMOVED", "battle");
    s = activate(s, me, [rra]);
    assert.ok(s.sides[foe].zones.hand.includes(rra), `${seat}: D1: the ≪Red Ribbon Army≫ card returned`);
    assert.equal(hand(s, foe), 2, `${seat}: D1: …and the watcher drew 1 (yourCardRemovedBySkill)`);
    s = fresh(seat, seed(1));
    const me2 = stage(s, seat, "AT2_REMOVE_THEIRS", "battle");
    const plainCard = stage(s, foe, "AT2_PLAIN", "battle");
    stage(s, foe, "AT2_W_REMOVED", "battle");
    s = activate(s, me2, [plainCard]);
    assert.equal(hand(s, foe), 1, `${seat}: D1: another card removed is no trigger (only the card returned)`);
    s = fresh(seat, seed(2));
    const mine = stage(s, seat, "AT2_REMOVE_MINE", "battle");
    const ownRra = stage(s, seat, "AT2_RRA", "battle");
    stage(s, seat, "AT2_W_REMOVED", "battle");
    s = activate(s, mine, [ownRra]);
    assert.equal(hand(s, seat), 2, `${seat}: D1: your own skill is "a skill" too`);
    cases += 3;
  }

  // D2. An opponent's Battle Card KO'd by one of your skills; their card KO'd by their own skill is not it.
  {
    let s = fresh(seat, seed(3));
    const me = stage(s, seat, "AT2_KO_THEIRS", "battle");
    stage(s, seat, "AT2_W_KOED", "battle");
    const theirs = stage(s, foe, "AT2_PLAIN", "battle");
    s = activate(s, me, [theirs]);
    assert.ok(s.sides[foe].zones.drop.includes(theirs), `${seat}: D2: KO'd`);
    assert.equal(hand(s, seat), 1, `${seat}: D2: …and the watcher drew 1 (opponentCardKoedByYourSkill)`);
    s = fresh(seat, seed(4));
    const mine = stage(s, seat, "AT2_KO_MINE", "battle");
    const own = stage(s, seat, "AT2_PLAIN", "battle");
    stage(s, foe, "AT2_W_KOED", "battle");
    s = activate(s, mine, [own]);
    assert.equal(hand(s, foe), 0, `${seat}: D2: a card KO'd by its own master's skill is not the watcher's opponent's card KO'd by its skill`);
    cases += 2;
  }

  // D3. A green Unison placed in your Drop from your Unison Area; a Unison discarded from the hand is not it (Q&A BT17-069).
  {
    let s = fresh(seat, seed(5));
    const me = stage(s, seat, "AT2_DROP_UNISON", "battle");
    const uni = stage(s, seat, "AT2_UNISON", "unison");
    stage(s, seat, "AT2_W_UNISON", "battle");
    s = activate(s, me, [uni]);
    assert.ok(s.sides[seat].zones.drop.includes(uni), `${seat}: D3: the Unison is in the Drop`);
    assert.equal(hand(s, seat), 1, `${seat}: D3: …and the watcher drew 1 (yourUnisonToDrop)`);
    s = fresh(seat, seed(6));
    const disc = stage(s, seat, "AT2_DISCARD", "battle");
    const inHand = stage(s, seat, "AT2_UNISON", "hand");
    stage(s, seat, "AT2_W_UNISON", "battle");
    s = activate(s, disc, [inHand]);
    assert.ok(s.sides[seat].zones.drop.includes(inHand), `${seat}: D3: the Unison was discarded`);
    assert.equal(hand(s, seat), 0, `${seat}: D3: …and nothing was drawn`);
    cases += 2;
  }

  // D4. R-204: "choose that card" is a choice — [Barrier] on the moment's card refuses it; without `choice`, it does not.
  {
    const s = fresh(seat, seed(7));
    const watcher = stage(s, seat, "AT2_PLAIN", "battle");
    const barrier = stage(s, foe, "AT2_BARRIER", "battle");
    const plainCard = stage(s, foe, "AT2_PLAIN", "battle");
    const frame = (subject: string) => ({ ops: [], ip: 0, vars: {}, card: watcher, master: seat, subject });
    assert.deepEqual(resolveSelector(ctx, game, s, frame(barrier), { special: "subject", choice: true }), [], `${seat}: D4: a [Barrier] card is not chosen`);
    assert.deepEqual(resolveSelector(ctx, game, s, frame(barrier), { special: "subject", choice: true, ignoreBarrier: true }), [barrier], `${seat}: D4: …unless ignoring [Barrier]`);
    assert.deepEqual(resolveSelector(ctx, game, s, frame(barrier), { special: "subject" }), [barrier], `${seat}: D4: the moment's card named, not chosen, is still that card`);
    assert.deepEqual(resolveSelector(ctx, game, s, frame(plainCard), { special: "subject", choice: true }), [plainCard], `${seat}: D4: a card without [Barrier] is chosen`);
    cases += 4;
  }
}

console.log(`verify/audit-triggers-2: ${records} records, ${cases} VM cases`);

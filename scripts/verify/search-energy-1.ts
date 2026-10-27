/**
 * Mechanism batch 2 (27 Oct 2026): searching a secret area (20-12, with 3-1-7 and 5-2-7) and energy manipulation (3-8).
 * Printed text inline (catalog text of the open-rules export of 26 Oct 2026, with the catalog's errata applied; costs,
 * powers and companions in the VM cases are synthetic).
 *
 * S: searches — "with the same name as the chosen card" (P-440), a pair chosen out of the deck with a measure said once
 *    for both and sent to the Warp, then played at the start of the next Main Phase (BT7-051), the pair said with a comma
 *    (P-156), slots named by a character name they include (BT19-066), a hyphen or a long vowel mark for the dashes
 *    (BT29-024), "and without [Super Combo]" (P-569), the place searched said last (BT13-003), "you place" after a
 *    sentence about the opponent (BT13-124), "add … from your deck" with no place named (BT21-145's wording).
 * E: energy — "this card is in your energy" (BT10-051), "the card you placed in your energy with this skill is (isn't) in
 *    your energy" (BT10-054), "Place this card in your energy from your hand" (BT10-051), "If you KO'd it" (TB3-051,
 *    TB2-058), "take the top 6 cards from your deck and add them to your energy" (P-104), "choose this card and 1 of
 *    your energy and switch them" (TB2-058).
 * H: hidden information in the VM — a card a description picks out of the deck may not be found even when it is there
 *    (5-2-7), and one moved on into the hand is shown to both players (3-1-7); an undescribed pick is neither.
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
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { historicalMask } from "../../src/lib/arena/policy/observation";
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
  const rec = recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index}`);
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
let records = 0;

// S. Searches.
{
  const p440 = record("[Permanent] If your Leader is a mono-red &lt;Broly&gt; card, reduce the energy cost of this card in your hand by 2.<br>[Activate: Main][Limit 1] Discard 1 other mono-red Extra from your hand: Draw 1 card, and add up to 1 card from your life to your hand.<br>[Activate: Battle][Limit 1] Choose up to 1 mono-red &lt;Broly&gt; card in your Battle Area with an energy cost of 6 or less, add up to 1 card with the same name as the chosen card from your deck to your hand, and shuffle your deck.", "P-440", 20, { type: "EXTRA" });
  const [first, second] = opOf(p440, "choose");
  assert.ok(first && second && second.sel.area === "deck" && second.sel.filter?.sameNameAs === first.as, "S: P-440 — the deck card shares a name with the chosen one");
  assert.ok(opOf(p440, "moveTo").some((m) => "var" in m.target && m.target.var === second.as && m.to === "hand"), "S: P-440 — …added to the hand");
  const bt7 = record("[auto] When you play this card, draw 1 card.<br>[activate: main] {r}{g}, place this card in its owner's Drop Area: If your Leader Card is a green ≪Saiyan≫ card, choose up to 1 <Vegeta> card and 1 <Nappa> card with energy costs of 2 or less and 10000 power from your deck, send them to your Warp, then shuffle your deck. At the start of your next Main Phase, play all the cards sent to the Warp by this skill in your Battle Area.", "BT7-051", 10);
  const picks = opOf(bt7, "choose").filter((p) => p.sel.area === "deck");
  assert.equal(picks.length, 2, "S: BT7-051 — a slot per name");
  for (const p of picks) assert.ok(p.sel.area === "deck" && p.sel.filter?.costMax === 2 && p.sel.filter?.powerMin === 10000 && p.sel.filter?.powerMax === 10000, "S: BT7-051 — both measures on both slots");
  assert.ok(picks[1].sel.notIn?.includes(picks[0].as), "S: BT7-051 — two different cards");
  const sends = opOf(bt7, "moveTo").filter((m) => m.to === "warp");
  assert.ok(sends.length === 2 && sends.every((m) => m.as && m.as === sends[0].as), "S: BT7-051 — both sent under one name");
  const later = opOf(bt7, "delay")[0];
  assert.ok(later && later.at === "mainStart" || (later && /main/i.test(later.at)), "S: BT7-051 — at the start of the next Main Phase");
  assert.ok(opsDeep(later.ops).some((o) => o.op === "play"), "S: BT7-051 — …the cards sent are played");
  const p156 = skillRecords(card("P-156", { skill: "[auto] When this card is removed from a Battle Area by a skill, choose up to 1 {Unyielding Victory Son Goku} and 1 {Unyielding Victory Jackie Chun} from your deck, play them, then shuffle your deck." }))[0];
  assert.deepEqual(p156.unread, [], "S: P-156's pair said with a comma reads");
  const pairs = opsDeep(p156.ops).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  assert.ok(pairs.length === 2 && pairs.every((p) => p.sel.area === "deck"), "S: P-156 — both names from the deck (the first was read as a card in play)");
  const bt19 = record("[Activate: Main] Add up to 1 card with &lt;Son Goten&gt; in its character name and 1 card with &lt;Trunks&gt; in its character name—both blue and with an energy cost of 3—from your deck or Drop to your hand, then shuffle your deck if you looked through it.", "BT19-066", 0);
  const slots = opOf(bt19, "choose");
  assert.ok(slots.length === 2 && slots.every((p) => p.sel.areas?.join() === "deck,drop" && p.sel.filter?.colors.includes("Blue") && p.sel.filter?.costMin === 3), "S: BT19-066 — two slots, blue, cost 3, deck or Drop");
  assert.deepEqual(slots.map((p) => p.sel.filter?.charactersIncluding), [["son goten"], ["trunks"]], "S: BT19-066 — each by the name it includes");
  const bt29 = record("[activate: main/battle]{1}, if your Leader is a red <Krillin> card and you discard 1 card from your hand: Play up to 1 each of <Son Goten> and <Trunks : Youth> cards-both red and with an energy cost of 1-from your deck and/or Drop in Rest Mode, then shuffle your deck.", "BT29-024", 0);
  assert.ok(opOf(bt29, "play").length === 2 && opOf(bt29, "play").every((p) => p.mode === "rest"), "S: BT29-024 — the hyphens are the dashes: both played in Rest Mode");
  const p569 = record("[Auto] When this card is KO'd or removed from the Battle Area by a skill, add up to 1 green &lt;Paragus: Br&gt; card with an energy cost of 2 or less and without [Super Combo] from your deck or Drop to your hand, then shuffle your deck if you looked through it.", "P-569", 0);
  assert.ok(opOf(p569, "choose")[0].sel.filter?.notKeywords.includes("Super Combo"), "S: P-569 — without [Super Combo]");
  assert.deepEqual([...p569.trigger].sort(), ["koed", "removedFromBattle"], "S: P-569 — KO'd or removed by a skill: both moments");
  const bt13 = record("[+1][Activate: Main] Place up to 1 of your red ≪Saiyan≫ cards with an energy cost of 1 in your Drop Area from your deck, shuffle your deck, then draw 1 card.", "BT13-003", 0);
  assert.ok(opOf(bt13, "choose")[0].sel.area === "deck" && opOf(bt13, "moveTo")[0].to === "drop", "S: BT13-003 — from the deck to the Drop");
  const bt13b = record("[-1][Activate: Main] Your opponent sends 1 Battle Card from their Drop Area to their Warp; you place up to 2 ≪Dark Dragon Ball≫ cards from your deck in your Drop Area, shuffle your deck, and draw 1 card.", "BT13-124", 0);
  const [theirs, mine] = opOf(bt13b, "choose");
  assert.ok(theirs.chooser === "opponent" && mine.sel.area === "deck" && mine.sel.count === 2 && mine.sel.upTo, "S: BT13-124 — theirs is the opponent's pick, then your search");
  const bt21 = record("[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it, add up to 1 {Cell's Full-Power Kamehameha} from your deck, then shuffle your deck.", "BT21-145", 0);
  assert.ok(opOf(bt21, "moveTo").some((m) => m.to === "hand"), "S: BT21-145's wording — added to the hand");
  records += 10;
}
// The colour-and-name and the paid-with moments stay unread.
assert.ok(unreadOf("[Activate: Main] Choose up to 1 of your Battle Cards, and add up to 1 card with the same color and name as the chosen card from your deck to your hand.").length > 0, "S: 'same color and name' stays unread");
assert.ok(unreadOf("[auto] When this card is played using a [successor] skill that was activated by choosing 1 or more each of <Android 17>, <Android 18>, and <Cell> for their skill costs, choose up to 1 of your opponent's Battle Cards and KO it.").length > 0, "S: BT21-145's paid-with moment stays unread");

// E. Energy.
{
  const bt10 = record("[Activate: Main] If your Leader Card is a blue &lt;Zamasu&gt; or &lt;Goku Black&gt; card: Place this card in your energy from your hand, and you can't place cards in your energy or play cards other than mono-blue &lt;Zamasu&gt; or &lt;Goku Black&gt; cards for the turn; at the end of the turn, if this card is in your energy, place it in its owner's Drop Area.", "BT10-051", 0);
  assert.ok(opOf(bt10, "moveTo")[0].to === "energy", "E: BT10-051 — this card from the hand to the energy");
  const bans = opOf(bt10, "forbid");
  assert.deepEqual(bans.map((f) => f.what).sort(), ["placeEnergy", "play"], "E: BT10-051 — both prohibitions (the play one was lost)");
  const end = opOf(bt10, "delay")[0];
  assert.ok(end && end.at === "turnEnd" && end.ops[0].op === "if" && end.ops[0].cond.kind === "count" && "special" in end.ops[0].cond.sel && end.ops[0].cond.sel.area === "energy", "E: BT10-051 — at the end of the turn, if it is still in the energy");
  const bt54 = record("[Auto] If your Leader Card is a blue &lt;Zamasu&gt; or &lt;Goku Black&gt; card: When this card is played from your hand, place the top card of your deck in your energy, then at the end of the turn, if the card you placed in your energy with this skill is in your energy, place it in its owner's Drop Area. If the card you placed in your energy with this skill isn't in your energy, place 1 card from your energy in its owner's Drop Area.", "BT10-054", 0);
  const placed = opOf(bt54, "moveTo").find((m) => m.to === "energy")!;
  assert.ok(placed.as, "E: BT10-054 — the move names the card it takes");
  const delays = opOf(bt54, "delay");
  assert.equal(delays.length, 1, "E: BT10-054 — one question at the end of the turn");
  const q = delays[0].ops[0];
  assert.ok(q.op === "if" && q.cond.kind === "count" && "fromVar" in q.cond.sel && q.cond.sel.fromVar === placed.as && q.else?.some((o) => o.op === "choose" && o.sel.area === "energy"), "E: BT10-054 — is it there: it goes; else 1 other energy card goes");
  const tb3 = record("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with [Barrier] in Rest Mode ignoring [Barrier] and KO it. If you KO'd it, choose up to 1 of your energy and switch it to Active Mode.", "TB3-051", 0);
  assert.ok(opOf(tb3, "if")[0].cond.kind === "did" && opOf(tb3, "switchMode")[0].mode === "active", "E: TB3-051 — the switch only if the KO happened");
  const tb2 = record("[Blocker]<br>[Barrier]<br>[Auto] At the end of your turn, choose 1 {Unyielding Victory Son Goku} in your Battle Area and KO it. If you KO-ed it, choose this card and 1 of your energy and switch them to Active Mode.", "TB2-058", 20);
  const switches = opOf(tb2, "switchMode");
  assert.ok(switches.length === 2 && switches.some((s) => "sel" in s.target && s.target.sel.special === "self"), "E: TB2-058 — this card is switched too");
  const p104 = record("[Auto] When a card evolves into this card, take the top 6 cards from your deck and add them to your energy.", "P-104", 0);
  assert.ok(opOf(p104, "moveTo")[0].to === "energy" && "sel" in opOf(p104, "moveTo")[0].target && (opOf(p104, "moveTo")[0].target as { sel: { take?: number } }).sel.take === 6, "E: P-104 — the top 6 to the energy");
  records += 6;
}
// "At the end of your next turn after you place this card in your energy with this skill" (BT10-036) stays unread.
assert.ok(unreadOf("[Auto] At the end of your next turn after you place this card in your energy with this skill, if this card is in your energy, place it in its owner's Drop Area.").length > 0, "E: BT10-036's moment stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // H: a described search (5-2-7, 3-1-7) and an undescribed one.
  SEEK: card("SEEK", { skill: "[Activate: Main] Add 1 <Vegeta> card from your deck to your hand, then shuffle your deck." }),
  BLIND: card("BLIND", { skill: "[Activate: Main] Add 1 card from your deck to your hand, then shuffle your deck." }),
  VEG: card("VEG", { characters: ["Vegeta"], energyCost: 2 }),
  NAP: card("NAP", { characters: ["Nappa"], energyCost: 2 }),
  // S: P-440's name match.
  SAMENAME: card("SAMENAME", { skill: "[Activate: Main] Choose up to 1 <Broly> card in your Battle Area, add up to 1 card with the same name as the chosen card from your deck to your hand, and shuffle your deck." }),
  BROLY: card("BROLY", { name: "Broly, Legend", characters: ["Broly"] }),
  BROLY2: card("BROLY2", { name: "Broly, Legend", characters: ["Broly"], power: 5000 }),
  BROLYX: card("BROLYX", { name: "Broly, Other", characters: ["Broly"] }),
  // S: BT7-051's pair, sent to the Warp and played at the start of the next Main Phase.
  PAIR: card("PAIR", { skill: "[Activate: Main] Choose up to 1 <Vegeta> card and 1 <Nappa> card with energy costs of 2 or less and 10000 power from your deck, send them to your Warp, then shuffle your deck. At the start of your next Main Phase, play all the cards sent to the Warp by this skill in your Battle Area." }),
  // E: BT10-054's remembered card; TB3-051's "if you KO'd it"; BT10-051's card placed in the energy from the hand.
  PLACER: card("PLACER", { energyCost: 0, skill: "[Auto] When this card is played from your hand, place the top card of your deck in your energy, then at the end of the turn, if the card you placed in your energy with this skill is in your energy, place it in its owner's Drop Area. If the card you placed in your energy with this skill isn't in your energy, place 1 card from your energy in its owner's Drop Area." }),
  KOSWITCH: card("KOSWITCH", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it. If you KO'd it, choose up to 1 of your energy and switch it to Active Mode." }),
  SELFENERGY: card("SELFENERGY", { skill: "[Activate: Main] Place this card in your energy from your hand, and you can't place cards in your energy or play cards other than <Vegeta> cards for the turn; at the end of the turn, if this card is in your energy, place it in its owner's Drop Area." }),
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
/** A deck card of `p` turned into `def` and moved to `area` (`deck` keeps it in the deck, on top). */
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  if (area === "deck") {
    s.sides[p].zones.deck = [id, ...s.sides[p].zones.deck.slice(0, -1)];
    return id;
  }
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = mode;
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
const none = { cards: () => [] as string[] };
const zoneOf = (s: VmState, p: PlayerId, id: string) => Object.entries(s.sides[p].zones).find(([, ids]) => (ids as string[]).includes(id))?.[0];
const SECRET = { p1: ["deck", "hand", "life"], p2: ["deck", "hand", "life"] } as never;
/** What the opponent's history shows of the move of `id` into the hand: the card, or the alias. */
function seenByOpponent(id: string): string | undefined {
  const ev = events.find((e) => e.type === "move" && (e as { card: string }).card === id && (e as { to: string }).to === "hand") as (GameEvent & { from: string; to: string; owner: PlayerId; reveal?: true }) | undefined;
  assert.ok(ev, "the move into the hand is logged");
  const beat = historicalMask({ t: "move", n: 0, card: id, from: ev.from, to: ev.to, owner: ev.owner, ...(ev.reveal ? { reveal: true } : {}) } as never, SECRET) as { card: string };
  return beat.card === id ? id : undefined;
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 27200 + n * 2 + (seat === "p1" ? 0 : 1);

  // H. 5-2-7: the described search may come up empty even with a <Vegeta> in the deck; 3-1-7: found, it is shown.
  for (const found of [false, true]) {
    let s = fresh(seat, seed(found ? 1 : 0));
    const me = stage(s, seat, "SEEK", "battle");
    const veg = stage(s, seat, "VEG", "deck");
    const seen: Prompt[] = [];
    s = activateLine(s, me, found ? pick(veg) : none, seen);
    const asked = seen.find((q) => q.kind === "chooseCards") as Extract<Prompt, { kind: "chooseCards" }> | undefined;
    assert.ok(asked && asked.choice.candidates.includes(veg) && asked.choice.min === 0, `${seat}: H: the exact "add 1 <Vegeta>" may be declined (5-2-7)`);
    assert.equal(zoneOf(s, seat, veg), found ? "hand" : "deck", `${seat}: H: ${found ? "found — in the hand" : "not found — still in the deck"}`);
    if (found) assert.equal(seenByOpponent(veg), veg, `${seat}: H: …and the opponent saw which card it was (3-1-7)`);
    cases++;
  }
  // H. An undescribed "add 1 card from your deck" must take a card, and no one else sees it.
  {
    let s = fresh(seat, seed(2));
    const me = stage(s, seat, "BLIND", "battle");
    const handBefore = s.sides[seat].zones.hand.length;
    const seen: Prompt[] = [];
    s = activateLine(s, me, {}, seen);
    const asked = seen.find((q) => q.kind === "chooseCards") as Extract<Prompt, { kind: "chooseCards" }> | undefined;
    assert.ok(!asked || asked.choice.min === 1, `${seat}: H: nothing to find out about the card — the pick is owed`);
    assert.equal(s.sides[seat].zones.hand.length, handBefore + 1, `${seat}: H: a card was added`);
    const added = s.sides[seat].zones.hand.at(-1)!;
    assert.equal(seenByOpponent(added), undefined, `${seat}: H: …and it stays hidden from the opponent`);
    cases++;
  }

  // S. P-440: only a card of the chosen card's name is offered from the deck.
  {
    let s = fresh(seat, seed(3));
    const me = stage(s, seat, "SAMENAME", "battle");
    const broly = stage(s, seat, "BROLY", "battle");
    const same = stage(s, seat, "BROLY2", "deck");
    const otherName = stage(s, seat, "BROLYX", "deck");
    const seen: Prompt[] = [];
    s = activateLine(s, me, pick(broly, same), seen);
    const deckAsk = seen.filter((q): q is Extract<Prompt, { kind: "chooseCards" }> => q.kind === "chooseCards").find((q) => q.choice.candidates.includes(same));
    assert.ok(deckAsk && !deckAsk.choice.candidates.includes(otherName), `${seat}: S: only the same name is offered`);
    assert.equal(zoneOf(s, seat, same), "hand", `${seat}: S: …and added to the hand`);
    assert.equal(seenByOpponent(same), same, `${seat}: S: …shown as it goes (3-1-7)`);
    cases++;
  }
  // S. BT7-051: the pair to the Warp now, both played at the start of the next Main Phase.
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "PAIR", "battle");
    const veg = stage(s, seat, "VEG", "deck");
    const nap = stage(s, seat, "NAP", "deck");
    s = activateLine(s, me, pick(veg, nap));
    assert.deepEqual([zoneOf(s, seat, veg), zoneOf(s, seat, nap)], ["warp", "warp"], `${seat}: S: the pair is sent to the Warp`);
    s = settle(take(s, { type: "endMain", player: seat } as Action), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === foe);
    assert.deepEqual([zoneOf(s, seat, veg), zoneOf(s, seat, nap)], ["warp", "warp"], `${seat}: S: …still there on the opponent's turn`);
    s = settle(take(s, { type: "endMain", player: foe } as Action), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === seat);
    assert.deepEqual([zoneOf(s, seat, veg), zoneOf(s, seat, nap)], ["battle", "battle"], `${seat}: S: …both played at the start of the next Main Phase`);
    cases++;
  }

  // E. BT10-054: the placed card goes to the Drop at the end of the turn; moved away first, another energy card goes.
  for (const away of [false, true]) {
    let s = fresh(seat, seed(5 + (away ? 1 : 0)));
    const keep = stage(s, seat, "V1", "energy");
    const placer = stage(s, seat, "PLACER", "hand");
    const top = s.sides[seat].zones.deck[0];
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === placer);
    assert.ok(play, `${seat}: E: the card can be played`);
    s = settle(take(s, play.action));
    assert.equal(zoneOf(s, seat, top), "energy", `${seat}: E: the top card is placed in the energy`);
    if (away) assert.ok(moveCard(s, game, top, "hand", { owner: seat }).ok);
    s = settle(take(s, { type: "endMain", player: seat } as Action), pick(keep), (x) => x.prompt.kind === "main" && x.turnPlayer === foe);
    if (!away) {
      assert.equal(zoneOf(s, seat, top), "drop", `${seat}: E: …still there at the end of the turn: it goes to the Drop`);
      assert.equal(zoneOf(s, seat, keep), "energy", `${seat}: E: …and the other energy card stays`);
    } else {
      assert.equal(zoneOf(s, seat, top), "hand", `${seat}: E: moved away, the placed card is left alone`);
      assert.equal(zoneOf(s, seat, keep), "drop", `${seat}: E: …and 1 other card of the energy goes instead`);
    }
    cases++;
  }
  // E. TB3-051's "If you KO'd it": the switch only follows a KO.
  for (const ko of [true, false]) {
    let s = fresh(seat, seed(7 + (ko ? 0 : 1)));
    const me = stage(s, seat, "KOSWITCH", "battle");
    const tired = stage(s, seat, "V1", "energy", "rest");
    const target = stage(s, foe, "V1", "battle");
    s = activateLine(s, me, ko ? pick(target, tired) : { cards: (q) => (q.choice.candidates.includes(target) ? [] : [tired]) });
    assert.equal(zoneOf(s, foe, target), ko ? "drop" : "battle", `${seat}: E: ${ko ? "KO'd" : "not KO'd"}`);
    assert.equal(s.cards[tired].mode, ko ? "active" : "rest", `${seat}: E: …the energy ${ko ? "switched to Active Mode" : "left in Rest Mode"}`);
    cases++;
  }
  // E. BT10-051: offered from the hand, placed in the energy, no further energy placed or other plays, Drop at the end.
  {
    let s = fresh(seat, seed(9));
    const self = stage(s, seat, "SELFENERGY", "hand");
    s = activateLine(s, self);
    assert.equal(zoneOf(s, seat, self), "energy", `${seat}: E: the card is in the energy`);
    const nonVegeta = stage(s, seat, "V1", "hand");
    stage(s, seat, "V1", "energy");
    assert.ok(!RULES.legalActions(ctx, s).some((l) => l.action.type === "play" && (l.action as { card: string }).card === nonVegeta), `${seat}: E: …a non-<Vegeta> card can't be played this turn`);
    s = settle(take(s, { type: "endMain", player: seat } as Action), {}, (x) => x.prompt.kind === "main" && x.turnPlayer === foe);
    assert.equal(zoneOf(s, seat, self), "drop", `${seat}: E: …and it goes to the Drop at the end of the turn`);
    cases++;
  }
}

console.log(`search-energy-1: ${records} record-level cases, and ${cases} both-seat reload cases`);

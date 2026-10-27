/**
 * Phrasing batch 8 (27 Oct 2026). Printed text inline (catalog text of the open-rules export of 26 Oct 2026; costs,
 * powers and companions in the VM cases are synthetic).
 *
 * A.  The owner's ruling of 27 Oct 2026: the `damage` op pends `dealtDamage`, `youTookDamage` and `opponentTookDamage`
 *     by name, and none of them had a moment (`MOMENT_OF`, `vm/host.ts`), so no skill's damage was ever answered. Each
 *     has one now, proved here in the VM from both seats; the wordings that say a battle ("by attacking", "in a battle",
 *     "from an opponent's attack") answer only battle damage (`dealtBattleDamage`, `yourCardDealtBattleDamage`,
 *     `youTookBattleDamage`).
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
import { amount } from "../../src/lib/arena/vm/program";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Cond, Op, ScriptFrame } from "../../src/lib/arena/vm/script";
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
/** The record of `text` at `index` (default: the only one), read whole, through the stored-row round trip and the language's print and reparse. */
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
/** The record at `index`, whatever is unread in it. */
const anyRecord = (text: string, index = 0, o: Partial<CardDef> = {}) => skillRecords(card("U", { skill: text, ...o })).find((r) => r.skillIndex === index)!;
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" || c.kind === "any" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const condsDeep = (rec: Rec): Cond[] => [...flat(rec.cond ?? rec.cost?.condition), ...opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const lower = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => x.toLowerCase());
const subjectFilter = (rec: Rec) => condsDeep(rec).find((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count" && "special" in c.sel && c.sel.special === "subject")?.sel.filter;
let records = 0;

// A. The damage moments, by their wordings.
for (const [text, what, trigger] of [
  ["[Auto] When this card deals damage, draw 1 card.", "DEALT", "dealtDamage"],
  ["[Auto] When you take damage from a skill, draw 1 card.", "TOOK", "youTookDamage"],
  ["[Auto] When your opponent takes damage from a skill, draw 1 card.", "OPPTOOK", "opponentTookDamage"],
  ["[Auto] When this card deals damage by attacking, draw 1 card.", "DEALT-ATTACK", "dealtBattleDamage"],
  ["[Auto] When this card deals damage to your opponent in a battle, draw 1 card.", "DEALT-BATTLE", "dealtBattleDamage"],
  ["[Auto] When you take damage from an opponent's attack, draw 1 card.", "TOOK-ATTACK", "youTookBattleDamage"],
] as const) {
  assert.deepEqual(record(text, what).trigger, [trigger], `A: ${what} answers ${trigger}`);
  records++;
}
// BT30-017: "When you deal damage to your opponent by attacking with a blue card" — any blue card of yours, in a battle.
{
  const rec = record("[auto][once per turn] When you deal damage to your opponent by attacking with a blue card, look at up to 3 cards from the top of your deck, add up to 1 blue ≪Earthling≫ card to your hand, then place the remaining cards into their owner's Drop.", "BT30-017", { type: "LEADER" });
  assert.deepEqual(rec.trigger, ["yourCardDealtBattleDamage"], "A: BT30-017 — one of your cards' battle damage");
  assert.deepEqual(subjectFilter(rec)?.colors, ["Blue"], "A: BT30-017 — …a blue card");
  records++;
}
// BT21-071's moment is the attack's damage, not a skill's (its price stays unread).
assert.deepEqual(anyRecord("[auto] If your life is at 3 or less and you play 1 <Android 18> with an energy cost of 2 from under this card into your opponent's Battle Area: When you take damage from an opponent's attack, place up to 1 {Cell, About to Explode} from under this card on top of this card.").trigger, ["youTookBattleDamage"], "A: BT21-071 — the attack's damage");
records++;

// B1. P-560: "the same amount of cards" is as many as the choice before it took — never the whole hand; and "Then at the
// start of your opponent's turn" is their next one.
{
  const rec = record("[auto] When this card is played, choose up to 1 of your opponent's Battle Cards and return it to its owner's hand. Then at the start of your opponent's turn, add up to 1 non-[super combo] card from your energy to your hand, and add the same amount of cards from your hand to your energy.", "P-560");
  const later = opOf(rec, "delay")[0];
  assert.ok(later && later.at === "turnStart" && later.scope === "opponentNextTurn", "B1: P-560 — at the start of the opponent's next turn");
  const [fromEnergy, fromHand] = opOf(rec, "choose").filter((o) => "area" in o.sel && (o.sel.area === "energy" || o.sel.area === "hand"));
  assert.ok(fromEnergy && fromEnergy.sel.upTo && fromEnergy.sel.count === 1, "B1: up to 1 card from the energy");
  assert.deepEqual(fromHand?.exactly, { var: fromEnergy.as }, "B1: …then exactly as many from the hand, not the whole hand");
  assert.equal(fromHand?.sel.count, undefined, "B1: …with no count of its own");
  records++;
}
// B2. BT21-149: "for every card in your opponent's Z-Deck, place up to 1 Battle Card …" — up to that many (the line's
// "instead" replacement stays unread).
{
  const rec = anyRecord("[Ultimate][Dual Attack]<br>[Counter: Play] Play this card, for every card in your opponent's Z-Deck, place up to 1 Battle Card from your Drop or Warp under this card, and this card can't be removed from your Battle Area by your opponent's skills for the turn. Additionally, if the Battle Card to be played has an energy cost of 7 or less, send it to your Warp instead.", 10);
  const placed = opOf(rec as Rec, "choose").find((o) => "areas" in o.sel && o.sel.areas?.includes("warp"));
  const bound = placed?.atMost as { count?: { side?: string; area?: string } } | undefined;
  assert.ok(placed?.sel.upTo && bound?.count?.side === "opponent" && bound.count.area === "zDeck", `B2: BT21-149 — up to one per card in their Z-Deck (${JSON.stringify(placed?.atMost)})`);
  assert.ok(!rec.unread.some((u) => /z-deck/i.test(u)), "B2: …the count is not dropped");
  records++;
}
// B3. BT24-108 / BT23-128: the cards the price chose go under this card, at the end of that battle's Damage Step.
for (const [text, what] of [
  ["[activate: battle][limit 1]{y}{y}, choose 1 yellow <Kale> card in your Battle Area and 1 yellow <Caulifla> card in your Combo area: At the end of the Damage Step for that battle, play this card from your hand, place all of the chosen cards under this card, and this card can't be removed from a Battle Area by your opponent's skills until the end of your opponent's turn.", "BT24-108"],
  ["[activate: battle][limit 1]{y}, if you have 2 or more energy and you choose 1 yellow <Kale> card in your Battle Area and 1 yellow <Caulifla> card in your Combo Area: At the end of your Damage Step for that battle, draw 1 card, play this card from your hand, place the chosen cards under this card, then choose up to 1 of your opponent's Rest Mode Battle Cards and KO it.", "BT23-128"],
] as const) {
  const rec = record(text, what);
  const priced = (rec.cost?.program ?? []).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose").map((o) => o.as);
  assert.equal(priced.length, 2, `B3: ${what} — the price chooses the <Kale> and the <Caulifla>`);
  const later = opOf(rec, "delay")[0];
  assert.equal(later?.at, "damageStepEnd", `B3: ${what} — at the end of that battle's Damage Step`);
  const under = opOf(rec, "moveTo").filter((o) => o.to === "under").map((o) => "var" in o.target && o.target.var);
  assert.deepEqual(under, priced, `B3: ${what} — the chosen cards go under this card, not the card just played`);
  records++;
}
// B4. EX17-04: the leading span reaches both halves.
{
  const rec = record("[activate: main][spirit boost 1] (You must remove a marker from your Unison Card to activate this skill.) {1}, Unison Card with a specified cost, remove this card in your Drop Area from the game: Choose up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy, and until the end of your opponent's next turn, its skills are negated and it can't attack.", "EX17-04");
  assert.equal(opOf(rec, "negateSkills")[0]?.until, "nextTurn", "B4: EX17-04 — its skills, through the opponent's next turn");
  assert.equal(opOf(rec, "forbid").find((o) => o.what === "attack")?.until, "nextTurn", "B4: …and its attacks, for the same span");
  records++;
}
// B5. BT12-153: "mono-green or a black ≪Demon Realm Race≫" is two Leaders, not one (its "[Counter] skill" half stays unread).
{
  const rec = anyRecord("[Permanent] If your Leader Card is mono-green or a black ≪Demon Realm Race≫ card and you're activating this card's [Counter] skill, reduce the energy cost of this card in your hand by 7; if your Leader Card is a black ≪Demon Realm Race≫ card, treat this card in your hand as if it has no specified cost.") as Rec;
  const first = opOf(rec, "if")[0]?.cond;
  const alts = first?.kind === "any" ? first.conds.filter((x): x is Extract<Cond, { kind: "leaderMatches" }> => x.kind === "leaderMatches") : [];
  assert.equal(alts.length, 2, `B5: BT12-153 — two alternatives (${JSON.stringify(first)?.slice(0, 200)})`);
  assert.ok(alts[0].filter.monoColor && alts[0].filter.colors.join() === "Green" && !alts[0].filter.traits.length, "B5: …a mono-green Leader");
  assert.ok(!alts[1].filter.monoColor && alts[1].filter.colors.join() === "Black" && lower(alts[1].filter.traits).join() === "demon realm race", "B5: …or a black ≪Demon Realm Race≫ one");
  assert.ok(/your leader is mono-colour Green, or your leader is Black ≪demon realm race≫/.test(rec.reads), `B5: …and said so (${rec.reads})`);
  records++;
}
// C1. P-464: "(Up to 2)" caps the counted reduction (`capped`), printed and reparsed by the rules language.
{
  const rec = record("[permanent] For each green Unison Card in your Drop, reduce the Z-Energy cost of this card in your Z-Deck by 1. (Up to 2)", "P-464");
  const cut = opOf(rec, "costReduction")[0];
  assert.ok(cut && cut.what === "zEnergy" && typeof cut.amount === "object" && "capped" in cut.amount && cut.amount.capped[1] === 2 && typeof cut.amount.capped[0] === "object" && "count" in cut.amount.capped[0], `C1: P-464 — the count, capped at 2 (${JSON.stringify(cut?.amount)})`);
  assert.ok(/atMost 2/.test(printRule(asRule(rec))), "C1: …printed `atMost 2`");
  records++;
}
// C2. TB1-002: the [Permanent] makes this card's own discard optional; the opponent's discard stays.
{
  const rec = record("[Permanent] If <Caulifla> is in play in your Battle Area, you don't have to place cards from your hand in the Drop Area as a result of this card's skill.<br>[Auto] When this card attacks, draw 1 card. Then, place 1 card from your hand in the Drop Area and your opponent places 1 card from their hand in their Drop Area.", "TB1-002", {}, 0);
  const permit = opOf(rec, "permit")[0];
  assert.ok(permit && permit.what === "ownDiscardOptional" && "sel" in permit.target && permit.target.sel.special === "self", "C2: TB1-002 — this card's skills' discards are optional");
  assert.ok(condsDeep(rec).some((x) => x.kind === "count" && "area" in x.sel && x.sel.area === "battle" && lower(x.sel.filter?.characters).join() === "caulifla"), "C2: …while a <Caulifla> is in play");
  records++;
}
// C3. BT21-105: the line reads whole; it answers from under a Z-Leader (the VM below).
{
  const rec = record("[Unique]<br>[Auto] If you place 2 of your Z-Energy into your Drop: When one of your opponent's Battle Cards is played by a skill, play this card from under one of your Z-Leaders, then choose up to 1 of your opponent's Battle Cards with an energy cost of 7 or less and switch it to Rest Mode.", "BT21-105", {}, 10);
  assert.deepEqual(rec.trigger, ["opponentCardPlayedBySkill"], "C3: BT21-105's moment");
  records++;
}
// C5. The BT9-093 family: "If you do, your opponent can't activate their Leader Card's [Awaken] or [Wish] skills until
// the end of their next turn" — the flip happened, then both keywords, through their next turn.
for (const [text, what, o] of [
  ["[Auto] When you play this card, flip your opponent's Leader Card to the front. If you do, your opponent can't activate their Leader Card's [Awaken] or [Wish] skills until the end of their next turn.", "BT9-093", {}],
  ["[auto][bond 2] ≪Universe 6≫: When a card evolves into this card, if your Leader Card is a yellow ≪Universe 6≫ card and you have 4 or more energy, flip your opponent's Leader Card to the front. If you do, your opponent can't activate their Leader Card's [awaken] or [wish] skills until the end of their next turn.", "BT7-079", {}],
  ["[-1][activate: main]{u}{u}, if your Leader Card is blue or a ≪Universe 6≫ card and your opponent has 3 or more energy: Flip your opponent's Leader Card to the front. If you do, your opponent can't activate their Leader Card's [awaken] and [wish] skills until the end of their next turn.", "BT15-033", { type: "UNISON" }],
] as const) {
  const rec = record(text, what, o as Partial<CardDef>);
  assert.ok(condsDeep(rec).some((x) => x.kind === "did" && x.what === "flip"), `C5: ${what} — "if you do" is the flip having happened`);
  const bans = opOf(rec, "forbid").filter((x) => x.what === "activateSkill");
  assert.deepEqual(bans.map((x) => [x.keywordSkill, x.side, x.until]).sort(), [["Awaken", "opponent", "nextTurn"], ["Wish", "opponent", "nextTurn"]], `C5: ${what} — their [Awaken] and [Wish], through their next turn`);
  records++;
}
// D. A condition about the card a choice took somewhere.
for (const [text, what, check] of [
  ["[activate: main][limit 1] If your opponent has 3 or more energy and you choose 1 card in your hand and discard it: This card gains [dual attack] for the turn. If the card you discarded with this skill is a copy of this card, draw 2 cards, then choose up to 1 of your opponent's cards and switch it to Rest Mode.", "BT15-148", (c: Cond[]) => c.some((x) => x.kind === "count" && "notSelf" in x.sel && x.sel.notSelf === "copies" && x.atMost === 0)],
  ["[Auto][Once per turn] Choose 1 card in your hand and discard it: When you activate the [Activate: Battle] skill on a red Extra Card with an original energy cost of 3 or more in your hand or Drop Area, switch this card to Active Mode. If the card you discarded with this skill is a copy of this card, draw 2 cards, then choose up to 1 of your opponent's Battle Cards or Unison Cards, ignoring [Barrier], and it gets -35000 power for the turn.", "BT15-019", (c: Cond[]) => c.some((x) => x.kind === "count" && "notSelf" in x.sel && x.sel.notSelf === "copies")],
  ["[auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 red card to your hand, then place the remaining cards into their owner's Drop. Additionally, if you added a <Broly> card to your hand, choose up to 1 of your opponent's Battle Cards with 20000 power or less and KO it.", "BT29-014", (c: Cond[]) => c.some((x) => x.kind === "count" && "fromVar" in x.sel && x.sel.area === "hand" && lower(x.sel.filter?.characters).join() === "broly")],
  ["[auto][once per turn] If you have 3 or more energy: When this card attacks, use up to 1 mono-red card with 5000 combo power from under this card in a combo with its skills negated for the turn. Additionally, if the card used in the combo is a <Son Goku>, <Vegeta>, or <Trunks: Future> card, switch this card to Active Mode, then choose up to 1 of your opponent's Battle Cards with 25000 power or less and KO it.", "P-553", (c: Cond[]) => c.some((x) => x.kind === "count" && "fromVar" in x.sel && x.sel.area === "combo" && lower(x.sel.filter?.characters).sort().join() === "son goku,trunks: future,vegeta")],
  ["[auto] Switch 1 or more of your energy to Revealed Mode: When this card attacks, it gets +20000 power for the battle. Additionally, if 3 or more energy is switched to Revealed Mode by this skill, choose up to 1 of your opponent's Battle Cards, ignoring [barrier], and KO it.", "BT30-111", (c: Cond[]) => c.some((x) => x.kind === "count" && "fromVar" in x.sel && x.atLeast === 3)],
] as const) {
  const rec = record(text, what);
  assert.ok(check(condsDeep(rec)), `D: ${what} — asked of the card the choice took (${JSON.stringify(condsDeep(rec)).slice(0, 300)})`);
  records++;
}
// Not read: a bound said "equal to the number of" (BT17-147). (XD3-07's count of what this skill moved is read since
// phrasing batch 9, off the price's own choice — `phrasing-batch-9.ts`.)
assert.equal(anyRecord("[activate: battle] Choose up to 2 Cell Jr. tokens in your Battle Area and remove them from the game: For each Cell Jr. token you remove from the game with this skill, choose up to 1 of your opponent's cards and switch it to Rest Mode.").unread.length, 0, "D: XD3-07 is read (phrasing batch 9)");
assert.ok(!opOf(anyRecord("[Activate: Battle] If your Leader Card is green or a ≪Frieza Clan≫ card and your opponent has 3 or more energy: Your opponent discards 2 cards from their hand. Choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to the number of Unison Cards and ≪Frieza Clan≫ cards in all Leader Areas, Energy Areas, Battle Areas, Unison Areas, Drop Areas, and Warps, KO it, then remove this card from the game.") as Rec, "choose").some((o) => o.atMost), "D: BT17-147 — one card, not up to a count");
// P-597: a count leading a later clause, an "up to" choice per step.
{
  const rec = record("[auto] When this card is played, place up to 1 yellow Unison from your deck into your Drop, shuffle your deck, then for each yellow Unison in your Unison Area and Drop, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it.", "P-597");
  const pick = opOf(rec, "choose").find((o) => o.atMost);
  const n = pick?.atMost as { count?: { areas?: string[] } } | undefined;
  assert.ok(pick?.sel.upTo && JSON.stringify(n?.count?.areas) === '["unison","drop"]', `D: P-597 — up to one per yellow Unison in both areas (${JSON.stringify(pick?.atMost)})`);
  records++;
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A: a skill that deals damage, and the watchers of each moment.
  DMGSKILL: card("DMGSKILL", { skill: "[Activate: Main] Deal 1 damage to your opponent." }),
  SELFDMG: card("SELFDMG", { skill: "[Auto] When this card deals damage, draw 1 card.<br>[Activate: Main] Deal 1 damage to your opponent." }),
  ATTACKDMG: card("ATTACKDMG", { skill: "[Auto] When this card deals damage by attacking, draw 1 card.<br>[Activate: Main] Deal 1 damage to your opponent." }),
  TOOK: card("TOOK", { skill: "[Auto] When you take damage from a skill, draw 1 card." }),
  OPPTOOK: card("OPPTOOK", { skill: "[Auto] When your opponent takes damage from a skill, draw 1 card." }),
  TOOKATTACK: card("TOOKATTACK", { skill: "[Auto] When you take damage from an opponent's attack, draw 1 card." }),
  BLUEDEALT: card("BLUEDEALT", { skill: "[Auto] When you deal damage to your opponent by attacking with a blue card, draw 1 card." }),
  // B1: "the same amount of cards".
  SAMEAMT: card("SAMEAMT", { skill: "[Activate: Main] Add up to 1 card from your energy to your hand, and add the same amount of cards from your hand to your energy." }),
  // B3: the end of the Damage Step for that battle.
  DSE: card("DSE", { skill: "[Auto] When this card attacks, at the end of the Damage Step for that battle, draw 1 card." }),
  // C1: a capped amount.
  // C2: TB1-002's optional discard, and the <Caulifla> it asks.
  TB1: card("TB1", { skill: "[Permanent] If <Caulifla> is in play in your Battle Area, you don't have to place cards from your hand in the Drop Area as a result of this card's skill.<br>[Auto] When this card attacks, draw 1 card. Then, place 1 card from your hand in the Drop Area." }),
  CAULIFLA: card("CAULIFLA", { characters: ["Caulifla"] }),
  // C3: answering from under a Leader.
  SKILLPLAY: card("SKILLPLAY", { skill: "[Activate: Main] Choose 1 Battle Card in your hand and play it." }),
  UNDERWATCH: card("UNDERWATCH", { skill: "[Auto] When one of your opponent's Battle Cards is played by a skill, play this card from under one of your Z-Leaders." }),
  UNDERDRAW: card("UNDERDRAW", { skill: "[Auto] When one of your opponent's Battle Cards is played by a skill, draw 1 card." }),
  // C5: the BT9-093 family's prohibition.
  FLIPBAN: card("FLIPBAN", { skill: "[Activate: Main] Flip your opponent's Leader Card to the front. If you do, your opponent can't activate their Leader Card's [Awaken] or [Wish] skills until the end of their next turn." }),
  // D: a condition about the card a choice took.
  COPYDISC: card("COPYDISC", { skill: "[Activate: Main] Choose 1 card in your hand and discard it: If the card you discarded with this skill is a copy of this card, draw 2 cards." }),
  LOOKBROLY: card("LOOKBROLY", { skill: "[Activate: Main] Look at up to 3 cards from the top of your deck, add up to 1 card to your hand, then place the remaining cards into their owner's Drop. Additionally, if you added a <Broly> card to your hand, draw 1 card." }),
  BROLY: card("BROLY", { characters: ["Broly"] }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
/** Every event the last `take`s logged, for the cases that ask about order. */
let logged: { type: string; step?: string; player?: string }[] = [];
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
const offerOf = (s: VmState, c: string, line = linesOf(s.cards[c].cardId).at(-1)) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === line);
type Prompt = VmState["prompt"];
function settle(s0: VmState, steer: { cards?: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[] | undefined } = {}, done: (s: VmState) => boolean = (s) => s.prompt.kind === "main"): VmState {
  let s = s0;
  for (let i = 0; i < 80 && !done(s); i++) {
    const q = s.prompt;
    const who = (q as { player: PlayerId }).player;
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
const hand = (s: VmState, p: PlayerId) => s.sides[p].zones.hand.length;
const pick = (id: string) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => (q.choice.candidates.includes(id) ? [id] : undefined) });
function activateLine(s: VmState, c: string, steer: Parameters<typeof settle>[1] = {}, line?: number): VmState {
  const offer = offerOf(s, c, line);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}
function attackLeader(s: VmState, seat: PlayerId, attacker: string): VmState {
  return settle(take(s, { type: "attack", player: seat, attacker, target: s.sides[other(seat)].zones.leader[0] } as Action));
}

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 28800 + n * 2 + (seat === "p1" ? 0 : 1);

  // A. A skill's damage: the card that dealt it answers "deals damage"; the damaged side's "you take damage from a
  // skill" and the dealer's "your opponent takes damage from a skill" answer; their mirrors do not.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "SELFDMG", "battle");
    stage(s, seat, "OPPTOOK", "battle");
    stage(s, seat, "TOOK", "battle");
    stage(s, foe, "TOOK", "battle");
    stage(s, foe, "OPPTOOK", "battle");
    const life0 = s.sides[foe].zones.life.length;
    s = activateLine(s, me);
    assert.equal(s.sides[foe].zones.life.length, life0 - 1, `${seat}: A: 1 damage dealt by a skill`);
    // Yours: SELFDMG's "deals damage" and OPPTOOK; not your TOOK.
    assert.equal(hand(s, seat), 2, `${seat}: A: the dealer's "this card deals damage" and "your opponent takes damage from a skill" answer, its "you take damage" does not`);
    // Theirs: the life card, and TOOK; not their OPPTOOK.
    assert.equal(hand(s, foe), 2, `${seat}: A: the damaged side's "you take damage from a skill" answers, its "your opponent takes damage" does not`);
    cases++;
  }

  // A. The battle wordings answer battle damage only: a skill's damage leaves them; an attack's damage fires them.
  {
    let s = fresh(seat, seed(1));
    const me = stage(s, seat, "ATTACKDMG", "battle");
    stage(s, foe, "TOOKATTACK", "battle");
    stage(s, seat, "BLUEDEALT", "battle");
    s.cards[me].cardId = "ATTACKDMG";
    s = activateLine(s, me);
    assert.equal(hand(s, seat), 0, `${seat}: A: "deals damage by attacking" and "…by attacking with a blue card" — not a skill's damage`);
    assert.equal(hand(s, foe), 1, `${seat}: A: "you take damage from an opponent's attack" — not a skill's damage (their hand holds only the life card)`);
    s = attackLeader(s, seat, me);
    assert.equal(hand(s, seat), 1, `${seat}: A: …the attack's damage — "this card deals damage by attacking" answers (a red attacker: BLUEDEALT does not)`);
    assert.equal(hand(s, foe), 3, `${seat}: A: …and "you take damage from an opponent's attack" answers`);
    cases++;
  }
  // A. BT30-017's blue attacker.
  {
    let s = fresh(seat, seed(2));
    const me = stage(s, seat, "V-BLUE", "battle");
    stage(s, seat, "BLUEDEALT", "battle");
    s = attackLeader(s, seat, me);
    assert.equal(hand(s, seat), 1, `${seat}: A: a blue card's battle damage — "when you deal damage … by attacking with a blue card" answers`);
    cases++;
  }

  // B1. "Add up to 1 card from your energy to your hand, and add the same amount of cards from your hand to your energy":
  // one back for one taken, never the whole hand; none taken, none given.
  for (const took of [true, false]) {
    let s = fresh(seat, seed(3 + (took ? 0 : 1)));
    const me = stage(s, seat, "SAMEAMT", "battle");
    for (let i = 0; i < 2; i++) stage(s, seat, "V1", "energy");
    for (let i = 0; i < 3; i++) stage(s, seat, "V1", "hand");
    s = activateLine(s, me, { cards: (q) => (took ? undefined : q.choice.min === 0 ? [] : undefined) });
    assert.equal(hand(s, seat), 3, `${seat}: B1: the hand keeps 3 cards (${took ? "one in, one out" : "none taken, none given"})`);
    assert.equal(s.sides[seat].zones.energy.length, 2, `${seat}: B1: …and the energy 2`);
    cases++;
  }

  // B3. "At the end of the Damage Step for that battle": after the damage, before the Battle End Step — and never when
  // the attack is negated (no Damage Step), nor carried to a later battle.
  for (const negated of [false, true]) {
    let s = fresh(seat, seed(5 + (negated ? 1 : 0)));
    const me = stage(s, seat, "DSE", "battle");
    if (negated) {
      stage(s, foe, "E-NEGATE", "hand");
      stage(s, foe, "V1", "energy");
    }
    logged = [];
    const lifeBefore = s.sides[foe].zones.life.length;
    s = take(s, { type: "attack", player: seat, attacker: me, target: s.sides[foe].zones.leader[0] } as Action);
    for (let i = 0; i < 80 && (s.battle || s.prompt.kind !== "main"); i++) {
      const q = s.prompt;
      const who = (q as { player: PlayerId }).player;
      if (q.kind === "counter") s = take(s, { type: "counter", player: who, card: negated && who === foe ? (q.candidates.find((c) => s.cards[c].cardId === "E-NEGATE") ?? null) : null } as Action);
      else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: who, cards: q.choice.candidates.slice(0, Math.max(1, q.choice.min)) });
      else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: who, index: 0 } as Action);
      else if (q.kind === "payCost") s = take(s, { type: "payCost", player: who, option: 0 } as Action);
      else if (q.kind === "main") break;
      else s = take(s, { type: "pass", player: who } as Action);
    }
    assert.equal(s.prompt.kind, "main");
    assert.equal(hand(s, seat), negated ? 0 : 1, `${seat}: B3: ${negated ? "a negated attack has no Damage Step — nothing drawn" : "drawn at the end of the Damage Step"}`);
    if (negated) assert.equal(s.sides[foe].zones.life.length, lifeBefore, `${seat}: B3: the attack was negated — no damage`);
    else {
      const drew = logged.findIndex((e) => e.type === "draw" && e.player === seat);
      const damage = logged.findIndex((e) => e.type === "damage");
      const ended = logged.findIndex((e) => e.type === "battleStep" && e.step === "battleEnd");
      assert.ok(damage >= 0 && drew > damage && (ended < 0 || drew < ended), `${seat}: B3: …after the damage, before the Battle End Step (damage ${damage}, draw ${drew}, end ${ended})`);
    }
    assert.ok(!s.delayed.some((d) => d.at === "damageStepEnd"), `${seat}: B3: …and nothing waits for another battle`);
    cases++;
  }

  // C1. "(Up to 2)": three cards counted, two given.
  {
    const s = fresh(seat, seed(7));
    const me = stage(s, seat, "V1", "battle");
    for (let i = 0; i < 3; i++) stage(s, seat, "V1", "drop");
    const frame = { ops: [], ip: 0, vars: {}, card: me, master: seat } as unknown as ScriptFrame;
    assert.equal(amount(ctx, game, s, frame, { count: { side: "you", area: "drop" } }), 3);
    assert.equal(amount(ctx, game, s, frame, { capped: [{ count: { side: "you", area: "drop" } }, 2] }), 2, `${seat}: C1: capped at 2`);
    assert.equal(amount(ctx, game, s, frame, { capped: [1, 2] }), 1, `${seat}: C1: …and below the ceiling, as it is`);
    cases++;
  }

  // C2. TB1-002: with a <Caulifla> in play the attack's discard may be declined; without one it may not.
  for (const caulifla of [true, false]) {
    let s = fresh(seat, seed(8 + (caulifla ? 0 : 1)));
    const me = stage(s, seat, "TB1", "battle");
    if (caulifla) stage(s, seat, "CAULIFLA", "battle");
    let min: number | null = null;
    s = take(s, { type: "attack", player: seat, attacker: me, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s, { cards: (q) => (q.player === seat && /discard/.test(q.choice.reason ?? "") ? ((min = q.choice.min), q.choice.min === 0 ? [] : undefined) : undefined) });
    // (Exactly 1 card of exactly 1 in hand is no question: the engine takes it.)
    assert.ok(caulifla ? min === 0 : min === null || min === 1, `${seat}: C2: the discard asks ${caulifla ? "up to 1" : "exactly 1"} (min ${min})`);
    assert.equal(hand(s, seat), caulifla ? 1 : 0, `${seat}: C2: ${caulifla ? "declined — the drawn card stays" : "made"}`);
    cases++;
  }

  // C3. BT21-105: a card under your Leader answers the opponent's skill play, playing itself from there; a pile card
  // whose skill does not take it out of the pile does not.
  for (const def of ["UNDERWATCH", "UNDERDRAW"] as const) {
    let s = fresh(foe, seed(10 + (def === "UNDERWATCH" ? 0 : 1)));
    const watcher = stage(s, seat, def, "deck");
    assert.ok(moveCard(s, game, watcher, "under", { under: s.sides[seat].zones.leader[0] }).ok);
    const player = stage(s, foe, "SKILLPLAY", "battle");
    const played = stage(s, foe, "V-BLUE", "hand");
    s = activateLine(s, player);
    assert.ok(s.sides[foe].zones.battle.includes(played), `${seat}: C3: their card played by a skill`);
    if (def === "UNDERWATCH") assert.ok(s.sides[seat].zones.battle.includes(watcher), `${seat}: C3: …the card under your Leader plays itself`);
    else assert.equal(hand(s, seat), 0, `${seat}: C3: …a pile card whose skill does not leave the pile is not asked`);
    cases++;
  }

  // C5. The BT9-093 family: their Leader flipped to its front, so they can't [Awaken] through their next turn; a Leader
  // already on its front is not flipped, and nothing is forbidden.
  for (const wasBack of [true, false]) {
    let s = fresh(seat, seed(12 + (wasBack ? 0 : 1)), "L-RED");
    const leader = s.sides[foe].zones.leader[0];
    s.cards[leader].flipped = wasBack;
    const me = stage(s, seat, "FLIPBAN", "battle");
    s = activateLine(s, me);
    assert.ok(!s.cards[leader].flipped, `${seat}: C5: their Leader shows its front`);
    while (s.sides[foe].zones.life.length > 4) assert.ok(moveCard(s, game, s.sides[foe].zones.life[0], "drop", { owner: foe }).ok);
    s = take(s, { type: "endMain", player: seat } as Action);
    s = settle(s, {}, (x) => x.turnPlayer === foe && x.prompt.kind === "main");
    const awaken = RULES.legalActions(ctx, s).some((l) => l.action.type === "activate" && l.action.card === leader);
    assert.equal(awaken, !wasBack, `${seat}: C5: ${wasBack ? "flipped — their [Awaken] is not offered" : "not flipped — no prohibition, their [Awaken] is offered"}`);
    cases++;
  }

  // D. "If the card you discarded with this skill is a copy of this card": a copy discarded draws 2; another card, none.
  for (const copy of [true, false]) {
    let s = fresh(seat, seed(14 + (copy ? 0 : 1)));
    const me = stage(s, seat, "COPYDISC", "battle");
    const fodder = stage(s, seat, copy ? "COPYDISC" : "V1", "hand");
    s = activateLine(s, me, pick(fodder));
    assert.ok(s.sides[seat].zones.drop.includes(fodder));
    assert.equal(hand(s, seat), copy ? 2 : 0, `${seat}: D: ${copy ? "a copy discarded — draw 2" : "another card — nothing"}`);
    cases++;
  }
  // D. "If you added a <Broly> card to your hand": the card the choice took, not the cards looked at.
  for (const broly of [true, false]) {
    let s = fresh(seat, seed(16 + (broly ? 0 : 1)));
    const me = stage(s, seat, "LOOKBROLY", "battle");
    const top = s.sides[seat].zones.deck.slice(0, 3);
    s.cards[top[0]].cardId = "BROLY";
    const want = broly ? top[0] : top[1];
    s = activateLine(s, me, pick(want));
    assert.ok(s.sides[seat].zones.hand.includes(want));
    assert.equal(hand(s, seat), broly ? 2 : 1, `${seat}: D: ${broly ? "the <Broly> added — draw 1" : "a <Broly> looked at but not added — nothing"}`);
    cases++;
  }
}

console.log(`phrasing-batch-8: ${records} record-level cases, and ${cases} both-seat reload cases`);

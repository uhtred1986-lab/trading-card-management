/**
 * Phrasing batch 7 (27 Oct 2026): the readings held out of production as wrong (A), the owner's ruling on BT9-104 (B),
 * what batch 6 left (C) and a few of the open clusters (D). Printed text inline (catalog text of the open-rules export
 * of 26 Oct 2026; costs, powers and companions in the VM cases are synthetic).
 *
 * A1. "if your Leader Card is a red {Champa} or red {Vados}" (EX06-03): the reading says the names it asks.
 * A2. "<Pan> card or card with <GT> in its character name -- both multicolor --" (BT25-068, P-711): two alternatives,
 *     each multicolour, as the P-711/BT17-112 "both/all" rulings say.
 * A3. "Choose up to 1 blue <Son Goku> and 1 yellow <Vegeta> card in your hand with energy costs of 2 or less and play
 *     them" (BT7-025): both from the hand, both played.
 * A4. BT28-001b: "When a Battle Card … is KO'd by your red card's attack or skill" — a moment (`yourCardKos`).
 * A5. "negate its keyword skills" (SD16-01b, EB1-07, P-496): the keyword skills and the [Counter]s (P-327's ruling).
 * B.  The owner's ruling of 27 Oct 2026: "When one of your cards deals damage" counts a skill's damage too (BT9-104).
 * C.  "…until the end of a battle or the end of the turn, whichever comes first" (`battleOrTurn`); counts over two areas
 *     said with "and" (P-379, BT21-076, P-479); "This card can be used in combos in Rest Mode" (`comboRestSelf`);
 *     BT20-054b's moment (`yourCardBattleToDrop`, with "without <Son Goku: GT>" read as a name ruled out); BT10-058's
 *     "When this card is activated". Left: P-464's "(Up to 2)", TB1-002, BT21-105 (see the PR).
 * D.  "more life than your opponent" (BT1-058), a Leader flipped back to its front (BT28-015, BT31-081, BT9-093), and
 *     "your black Leader Cards or Battle Cards" (BT15-139).
 *
 * Proved here: the records (nothing unread, the stored-row JSON round trip, the rules language's print and reparse), and
 * in the VM for both seats with every action reloaded from JSON.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
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
const flat = (c: Cond | null | undefined): Cond[] => (!c ? [] : c.kind === "all" || c.kind === "any" ? c.conds.flatMap(flat) : [c]);
const opsDeep = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...(o.op === "if" ? [...opsDeep(o.then), ...opsDeep(o.else ?? [])] : o.op === "may" || o.op === "delay" ? opsDeep(o.ops) : o.op === "chooseMode" ? o.modes.flatMap((m) => opsDeep(m.ops)) : [])]);
const condsDeep = (rec: Rec): Cond[] => [...flat(rec.cond ?? rec.cost?.condition), ...opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? flat(o.cond) : []))];
const opOf = <K extends Op["op"]>(rec: Rec, op: K) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: K }> => o.op === op);
const subjectFilter = (rec: Rec) => condsDeep(rec).find((c): c is Extract<Cond, { kind: "count" }> => c.kind === "count" && "special" in c.sel && c.sel.special === "subject")?.sel.filter;
const lower = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => x.toLowerCase());
let records = 0;

// A1. EX06-03: the names are asked and said.
{
  const rec = record("[Auto] When you play this card, you may choose 1 card in your hand and place it in your Drop Area. If you do, for the duration of the turn, if your Leader Card is a red {Champa} or red {Vados}, you can activate its [Awaken] skill even if you have 5 or more life.", "EX06-03");
  const leaders = condsDeep(rec).filter((c): c is Extract<Cond, { kind: "leaderMatches" }> => c.kind === "leaderMatches");
  assert.deepEqual(leaders.map((c) => lower(c.filter.names)).sort(), [["champa"], ["vados"]], "A1: EX06-03 asks {Champa} or {Vados}");
  assert.ok(leaders.every((c) => c.filter.colors.join() === "Red"), "A1: …each red");
  assert.ok(/your leader is Red \{champa\}, or your leader is Red \{vados\}/.test(rec.reads), `A1: …and the reading says both names (${rec.reads})`);
  // The rest of the Leader description is said too: mono-colour, Z-Leader.
  const mono = record("[Auto] When you play this card, if your Leader Card is mono-green, draw 1 card.", "MONO-LEADER");
  assert.ok(/your leader is mono-colour Green/.test(mono.reads), `A1: "mono-" is said (${mono.reads})`);
  records += 2;
}

// A2. BT25-068 and P-711: two alternatives, each with the aside's measures.
for (const [text, what, area, cost] of [
  ["[Auto] When this card is played, add up to 1 <Pan> card or card with <GT> in its character name -- both multicolor -- from your hand in your energy in Rest Mode.", "BT25-068", "hand", null],
  ["[auto][limit 1] Discard 1 multicolor card from your hand: When this card is played, add up to 1 <Pan> card or card with <GT> in its character name-both multicolor and with an energy cost of 4-from your Drop to your hand.", "P-711", "drop", 4],
] as const) {
  const pick = opOf(record(text, what), "choose")[0];
  assert.ok(pick && "area" in pick.sel && pick.sel.area === area, `A2: ${what} — from the ${area}`);
  const alts = pick.sel.filter?.anyOf ?? [];
  assert.equal(alts.length, 2, `A2: ${what} — two alternatives, not one merged description`);
  assert.deepEqual(lower(alts[0].characters), ["pan"], `A2: ${what} — a <Pan> card…`);
  assert.deepEqual(alts[0].charactersIncluding ?? [], [], `A2: ${what} — …which need not have <GT> in its name`);
  assert.deepEqual(lower(alts[1].charactersIncluding), ["gt"], `A2: ${what} — or a card with <GT> in its character name`);
  assert.deepEqual(alts[1].characters ?? [], [], `A2: ${what} — …which need not be <Pan>`);
  assert.ok(alts.every((f) => f.multiColor && (cost === null ? f.costMax == null : f.costMin === cost && f.costMax === cost)), `A2: ${what} — each multicolour${cost === null ? "" : `, each costing ${cost}`}`);
  records++;
}

// A3. BT7-025#20: both from the hand, both measured, both played.
{
  const rec = record("[Activate: Main] If you have 4 or more energy: Choose up to 1 blue <Son Goku> and 1 yellow <Vegeta> card in your hand with energy costs of 2 or less and play them, you can only play <Trunks: Future> and <Vegito> cards for the duration of the turn, and you can't activate this skill for the duration of the game.", "BT7-025", { type: "LEADER" });
  const picks = opOf(rec, "choose");
  assert.equal(picks.length, 2, "A3: two choices");
  assert.ok(picks.every((p) => "area" in p.sel && p.sel.area === "hand" && p.sel.filter?.costMax === 2 && p.sel.upTo), "A3: …each up to 1 from the hand, costing 2 or less");
  assert.deepEqual(picks.map((p) => [lower(p.sel.filter?.colors), lower(p.sel.filter?.characters)]), [[["blue"], ["son goku"]], [["yellow"], ["vegeta"]]], "A3: …a blue <Son Goku> and a yellow <Vegeta>");
  assert.deepEqual(opOf(rec, "play").map((p) => p.target && "var" in p.target && p.target.var), picks.map((p) => p.as), "A3: …and both are played");
  records++;
}

// A4. BT28-001b: a moment, the card of yours that KO'd described.
{
  const rec = record("[Auto] When a Battle Card that is in your opponent's Battle Area and whose owner is your opponent is KO'd by your red card's attack or skill, flip this card to its front side.", "BT28-001", { type: "LEADER" });
  assert.deepEqual(rec.trigger, ["yourCardKos"], "A4: BT28-001b answers a KO one of your cards made");
  assert.deepEqual(subjectFilter(rec)?.colors, ["Red"], "A4: …by a red card");
  assert.ok(!condsDeep(rec).some((c) => c.kind === "inBattle"), "A4: …not an attack in progress");
  records++;
}

// A5. "negate its keyword skills": the keyword skills and the [Counter]s, never every skill.
for (const [text, what] of [
  ["[Auto][Once per turn] Add 1 card from your life to your hand: When you remove a marker from one of your black Unison Cards using a [Spirit Boost] skill, switch this card to Active Mode and negate its keyword skills for the turn.", "SD16-01"],
  ["[auto]{r}, if your opponent has 3 or more energy and it's your turn: At the end of a battle in which you combo with this card from your hand, switch up to 1 of your mono-red Leader Cards to Active Mode, and that card gets +5000 power and has its keyword skills negated for the turn; you can't activate non-keyword Leader Card skills or skills on copies of this card for the turn.", "EB1-07"],
  ["[activate: main]{u}{g}, if your Leader is an {Android 16, Created By Dr. Gero}: Play up to 1 blue ≪Android≫ with an energy cost of 4 or less from under this card, negating its keyword skills for the turn, and you can't play cards from your deck for the rest of the game.", "P-496"],
  ["[Activate: Main] Choose up to 1 of your opponent's Battle Cards and negate its keyword skills for the turn.", "KWNEG-TEXT"],
] as const) {
  const rec = record(text, what);
  assert.equal(opOf(rec, "negateSkills").length, 0, `A5: ${what} — not every skill`);
  assert.deepEqual(opOf(rec, "negateSkillsOfKind").map((o) => o.kind).sort(), ["counter", "keyword"], `A5: ${what} — its keyword skills and its [Counter]s`);
  records++;
}

// B. BT9-104: the moment, now said of any damage.
{
  const rec = record("[Auto][Once per turn] When one of your cards deals damage to your opponent, deal 1 additional damage to your opponent.", "BT9-104");
  assert.deepEqual(rec.trigger, ["yourCardDealtDamage"], "B: BT9-104 answers yourCardDealtDamage");
  records++;
}

// C. "whichever comes first".
for (const [text, what, op] of [
  ["[Activate: Main/Battle][Limit 1] Choose up to 1 of your black Leader Cards or Battle Cards, and it gets +15000 power until the end of a battle or the end of the turn, whichever comes first.", "BT15-139", "power"],
  ["[activate: main]{r}{1}, if your Leader Card is a red <Son Goten> card and you choose this card and 1 of your Unison Cards and switch them to Rest Mode: Draw 1 card. If you have a red Unison Card with a specified cost of 3 or more in play, you may have 1 of your Leader Cards get +15000 power and [triple strike] until the end of a battle or the end of the turn, whichever comes first.", "BT15-007", "gains"],
] as const) {
  const rec = record(text, what);
  assert.equal(opOf(rec, "power")[0]?.until, "battleOrTurn", `C: ${what} — the power until a battle ends or the turn does`);
  if (op === "gains") assert.equal(opOf(rec, "grant")[0]?.until, "battleOrTurn", `C: ${what} — …and the [Triple Strike]`);
  records++;
}
// …and BT15-139's colour is both kinds'.
{
  const modes = opOf(record("[Activate: Main/Battle][Limit 1] Choose up to 1 of your black Leader Cards or Battle Cards, and it gets +15000 power until the end of a battle or the end of the turn, whichever comes first.", "BT15-139"), "choose");
  assert.equal(modes.length, 2, "D: BT15-139 — a Leader or a Battle Card");
  assert.ok(modes.every((m) => m.sel.filter?.colors.join() === "Black"), "D: BT15-139 — …black either way");
  records++;
}
// Counts over two areas said with "and".
for (const [text, what, check] of [
  ["[Permanent] For each green Unison Card in your Unison Area and Drop Area, reduce the energy cost of this card in your hand by 1.", "P-379", (a: Record<string, unknown>) => "count" in a && JSON.stringify((a.count as { areas: string[] }).areas) === '["unison","drop"]'],
  ["[Permanent] For every Z-Energy cost of the Z-Cards in your Leader Area and Battle Area, reduce the energy cost of this card in your hand by 1.", "BT21-076", (a: Record<string, unknown>) => "sumOf" in a && a.attr === "zEnergyCost" && JSON.stringify((a.sumOf as { areas: string[] }).areas) === '["leader","battle"]'],
  ["[Permanent] For each Z-Energy in the costs of Z-Cards in your Leader Area and Battle Area, reduce the energy cost of this card in your hand by 1.", "P-479", (a: Record<string, unknown>) => "sumOf" in a && a.attr === "zEnergyCost" && JSON.stringify((a.sumOf as { areas: string[] }).areas) === '["leader","battle"]'],
] as const) {
  const cut = opOf(record(text, what), "costReduction")[0];
  assert.ok(cut && typeof cut.amount === "object" && check(cut.amount as unknown as Record<string, unknown>), `C: ${what} — counted over both areas (${JSON.stringify(cut?.amount)})`);
  records++;
}
// "This card can be used in combos in Rest Mode".
for (const [text, what] of [
  ["[permanent] This card can be used in combos in Rest Mode.", "BT26-019"],
  ["[Permanent] If you have 3 or more yellow ≪Turles Crusher Corps≫ cards other than this card in play, this card can be used in combos in Rest Mode.", "P-582"],
] as const) {
  const permit = opOf(record(text, what), "permit")[0];
  assert.ok(permit && permit.what === "comboRestSelf" && "sel" in permit.target && permit.target.sel.special === "self", `C: ${what} — this card, rested, in a combo`);
  records++;
}
// BT20-054b: a moment, the card described — and "without <Son Goku: GT>" rules that name out.
{
  const rec = record("[Auto][Once per turn] When a <Pan> card or a card with <GT> in its character name—both green and without <Son Goku: GT>—is placed from your Battle Area in your Drop, add it to your Z-Energy from your Drop.", "BT20-054", { type: "LEADER" });
  assert.deepEqual(rec.trigger, ["yourCardBattleToDrop"], "C: BT20-054b answers your card leaving the Battle Area for the Drop");
  const alts = subjectFilter(rec)?.anyOf ?? [];
  assert.equal(alts.length, 2, "C: BT20-054b — a <Pan> card or a card with <GT> in its name");
  assert.ok(alts.every((f) => f.colors.join() === "Green" && lower(f.notCharacters).includes("son goku: gt") && !lower(f.characters).includes("son goku: gt")), "C: …each green, and not <Son Goku: GT>");
  const move = opOf(rec, "moveTo")[0];
  assert.ok(move && move.to === "zEnergy" && "sel" in move.target && move.target.sel.special === "subject", "C: …that card to your Z-Energy");
  records++;
}
// BT10-058: a [Field]'s "When this card is activated" is its play (12-2).
{
  const rec = record("[Field]<br>[Auto] When this card is activated, choose all of your opponent's Battle Cards, ignoring [Barrier], and place them in their owners' energy in Rest Mode.", "BT10-058", { type: "EXTRA" }, 10);
  assert.deepEqual(rec.trigger, ["played"], "C: BT10-058 answers its own activation");
  records++;
}
// (Phrasing batch 8 reads P-464's printed ceiling — `capped` — `phrasing-batch-8.ts`.)

// D. "more life than your opponent" is strict.
{
  const rec = record("[Auto] When this card attacks, if you have more life than your opponent, draw 1 card.", "BT1-058");
  const gate = opOf(rec, "if")[0]?.cond ?? rec.cond;
  assert.ok(gate?.kind === "not" && gate.cond.kind === "lifeVsOpponent" && gate.cond.atMost, "D: BT1-058 — not \"at most theirs\", so strictly more");
  records++;
}
// A Leader flipped back to its front.
for (const [text, what, special] of [
  ["[Activate: Main][Limit 1] Flip your red <Son Gohan: Youth> Leader to its front side.", "BT28-015", null],
  ["[activate: main/battle] [limit 1] If you have 3 or fewer cards in your Combo Area and remove this card in its owner's Drop from the game: Flip your yellow <Launch> Leader with an original power of 10000 to its front side.", "BT31-081", null],
] as const) {
  const flip = opOf(record(text, what), "flip")[0];
  assert.ok(flip && flip.to === "front" && "sel" in flip.target && flip.target.sel.area === "leader" && special === null, `D: ${what} — your Leader, to its front`);
  records++;
}
assert.deepEqual(skillRecords(card("BT9-093", { skill: "[Auto] When you play this card, flip your opponent's Leader Card to the front." }))[0].ops, [{ op: "flip", target: { sel: { special: "opponentLeader" } }, to: "front" }], "D: BT9-093 — their Leader, to its front");
records++;

// ── 2. the VM ────────────────────────────────────────────────────────────────
const green = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Green"], ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  // A3: the pair, from the hand.
  PAIRPLAY: card("PAIRPLAY", { skill: "[Activate: Main] Choose up to 1 blue <Son Goku> and 1 yellow <Vegeta> card in your hand with energy costs of 2 or less and play them." }),
  GOKU: card("GOKU", { colors: ["Blue"], characters: ["Son Goku"], energyCost: 2 }),
  VEGETA: card("VEGETA", { colors: ["Yellow"], characters: ["Vegeta"], energyCost: 1 }),
  // A4: BT28-001b's moment, and KOs by a red and a blue card's skill.
  KOWATCH: card("KOWATCH", { skill: "[Auto] When a Battle Card that is in your opponent's Battle Area and whose owner is your opponent is KO'd by your red card's attack or skill, draw 1 card." }),
  KOER: card("KOER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  KOERBLUE: card("KOERBLUE", { colors: ["Blue"], skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  // A5: a keyword and a [Permanent] on the target; only the keyword goes.
  KWNEG: card("KWNEG", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and negate its keyword skills for the turn." }),
  KWTARGET: card("KWTARGET", { colors: ["Blue"], skill: "[Blocker]<br>[Permanent] This card gets +5000 power." }),
  // B: a skill's damage, watched from both sides.
  DMGSKILL: card("DMGSKILL", { skill: "[Activate: Main] Deal 1 damage to your opponent." }),
  DMGWATCH: card("DMGWATCH", { skill: "[Auto] When one of your cards deals damage to your opponent, draw 1 card." }),
  // C: "whichever comes first".
  BOOST: card("BOOST", { skill: "[Activate: Main] This card gets +15000 power until the end of a battle or the end of the turn, whichever comes first." }),
  // C: "This card can be used in combos in Rest Mode".
  RESTCOMBO: card("RESTCOMBO", { skill: "[Permanent] This card can be used in combos in Rest Mode." }),
  // C: P-379's two areas.
  UNICUT: card("UNICUT", { energyCost: 3, skill: "[Permanent] For each green Unison Card in your Unison Area and Drop Area, reduce the energy cost of this card in your hand by 1." }),
  GREENU: card("GREENU", { type: "UNISON", colors: ["Green"], energyCost: "X" as unknown as number, power: 5000, comboCost: null, comboPower: null, skill: "[Blocker]" }),
  // C: BT20-054b's moment.
  PANWATCH: green("PANWATCH", { skill: "[Auto][Once per turn] When a <Pan> card or a card with <GT> in its character name—both green and without <Son Goku: GT>—is placed from your Battle Area in your Drop, add it to your Z-Energy from your Drop." }),
  DROPPER: card("DROPPER", { skill: "[Activate: Main] Choose 1 of your Battle Cards other than this card and place it in its owner's Drop Area." }),
  PAN: green("PAN", { characters: ["Pan"] }),
  GOKUGT: green("GOKUGT", { characters: ["Son Goku: GT"] }),
  // D: strictly more life.
  LIFEDRAW: card("LIFEDRAW", { skill: "[Auto] When this card attacks, if you have more life than your opponent, draw 1 card." }),
  // D: a Leader turned back to its front, yours and theirs.
  FLIPMINE: card("FLIPMINE", { skill: "[Activate: Main] Flip your Leader to its front side." }),
  FLIPTHEIRS: card("FLIPTHEIRS", { skill: "[Activate: Main] Flip your opponent's Leader Card to the front." }),
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
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string, line = linesOf(s.cards[c].cardId)[0]) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === line);
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
function activateLine(s: VmState, c: string, steer: Parameters<typeof settle>[1] = {}): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer);
}
const pick = (id: string) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => (q.choice.candidates.includes(id) ? [id] : undefined) });
const power = (s: VmState, id: string) => Number(attrsNow(ctx, game, s, id).power);

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 27700 + n * 2 + (seat === "p1" ? 0 : 1);

  // A3. Both cards of the pair, from the hand, played.
  {
    let s = fresh(seat, seed(0));
    const me = stage(s, seat, "PAIRPLAY", "battle");
    const goku = stage(s, seat, "GOKU", "hand");
    const vegeta = stage(s, seat, "VEGETA", "hand");
    s = activateLine(s, me);
    assert.ok(s.sides[seat].zones.battle.includes(goku) && s.sides[seat].zones.battle.includes(vegeta), `${seat}: A3: the blue <Son Goku> and the yellow <Vegeta> both played from the hand`);
    cases++;
  }

  // A4. A KO by your red card's skill: the watcher draws. By a blue card's: it does not.
  for (const red of [true, false]) {
    let s = fresh(seat, seed(red ? 1 : 2));
    stage(s, seat, "KOWATCH", "battle");
    const me = stage(s, seat, red ? "KOER" : "KOERBLUE", "battle");
    const theirs = stage(s, foe, "V-BLUE", "battle");
    s = activateLine(s, me, pick(theirs));
    assert.ok(s.sides[foe].zones.drop.includes(theirs), `${seat}: A4: KO'd`);
    assert.equal(hand(s, seat), red ? 1 : 0, `${seat}: A4: ${red ? "by a red card — the watcher draws" : "by a blue card — no moment"}`);
    cases++;
  }

  // A5. The keyword goes; the [Permanent] stays.
  {
    let s = fresh(seat, seed(3));
    const me = stage(s, seat, "KWNEG", "battle");
    const t = stage(s, foe, "KWTARGET", "battle");
    assert.ok(hasKeyword(ctx, game, s, t, "Blocker") && power(s, t) === 15000);
    s = activateLine(s, me, pick(t));
    assert.equal(hasKeyword(ctx, game, s, t, "Blocker"), false, `${seat}: A5: its [Blocker] is negated`);
    assert.equal(power(s, t), 15000, `${seat}: A5: …its [Permanent] still works`);
    cases++;
  }

  // B. A skill's damage: your watcher draws, the opponent's does not.
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "DMGSKILL", "battle");
    stage(s, seat, "DMGWATCH", "battle");
    stage(s, foe, "DMGWATCH", "battle");
    const life0 = s.sides[foe].zones.life.length;
    s = activateLine(s, me);
    assert.equal(s.sides[foe].zones.life.length, life0 - 1, `${seat}: B: 1 damage dealt by a skill`);
    assert.equal(hand(s, seat), 1, `${seat}: B: …your watcher answers it (owner's ruling, 27 Oct 2026)`);
    assert.equal(hand(s, foe), 1, `${seat}: B: …their watcher does not (their hand holds only the life card)`);
    cases++;
  }

  // C. "Whichever comes first": a battle ends it; with no battle, the turn's end does.
  {
    let s = fresh(seat, seed(5));
    const me = stage(s, seat, "BOOST", "battle");
    s = activateLine(s, me);
    assert.equal(power(s, me), 25000, `${seat}: C: +15000`);
    s = take(s, { type: "attack", player: seat, attacker: me, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s);
    assert.equal(power(s, me), 10000, `${seat}: C: …ended with the battle`);
    cases++;
  }
  {
    let s = fresh(seat, seed(6));
    const me = stage(s, seat, "BOOST", "battle");
    s = activateLine(s, me);
    assert.ok(s.effects.some((e) => e.target === me && e.until === "battleOrTurn"), `${seat}: C: in force`);
    s = take(s, { type: "endMain", player: seat } as Action);
    s = settle(s, {}, (x) => x.turnPlayer === foe);
    assert.ok(!s.effects.some((e) => e.target === me && e.until === "battleOrTurn"), `${seat}: C: …ended with the turn, no battle fought`);
    cases++;
  }

  // C. This card, rested, is offered for the combo; another rested card is not.
  {
    let s = fresh(seat, seed(7));
    const rested = stage(s, seat, "RESTCOMBO", "battle");
    const plainRest = stage(s, seat, "V1", "battle");
    const atk = stage(s, seat, "V1", "battle");
    s.cards[rested].mode = "rest";
    s.cards[plainRest].mode = "rest";
    s = take(s, { type: "attack", player: seat, attacker: atk, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s, {}, (x) => x.prompt.kind === "combo");
    const combos = RULES.legalActions(ctx, s).map((l) => l.action).filter((a) => a.type === "combo").map((a) => (a as { card: string }).card);
    assert.ok(combos.includes(rested), `${seat}: C: the rested RESTCOMBO is offered for the combo`);
    assert.ok(!combos.includes(plainRest), `${seat}: C: …a rested card without the permission is not`);
    cases++;
  }

  // C. P-379: a green Unison in the Unison Area and one in the Drop take a 3-cost card to 1; with only one it costs 2.
  for (const both of [true, false]) {
    const s = fresh(seat, seed(both ? 8 : 9));
    stage(s, seat, "GREENU", "unison");
    if (both) stage(s, seat, "GREENU", "drop");
    stage(s, seat, "V1", "energy");
    const c = stage(s, seat, "UNICUT", "hand");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === c);
    assert.equal(!!play, both, `${seat}: C: P-379 ${both ? "counts both areas — playable with one energy" : "one Unison only — not playable with one energy"}`);
    cases++;
  }

  // C. BT20-054b: a green <Pan> sent from your Battle Area to the Drop goes on to Z-Energy; a green <Son Goku: GT> stays.
  for (const pan of [true, false]) {
    let s = fresh(seat, seed(pan ? 10 : 11));
    stage(s, seat, "PANWATCH", "battle");
    const me = stage(s, seat, "DROPPER", "battle");
    const c = stage(s, seat, pan ? "PAN" : "GOKUGT", "battle");
    s = activateLine(s, me, pick(c));
    assert.equal(s.sides[seat].zones.zEnergy.includes(c), pan, `${seat}: C: BT20-054b — ${pan ? "the <Pan> card to Z-Energy" : "the <Son Goku: GT> card stays in the Drop"}`);
    if (!pan) assert.ok(s.sides[seat].zones.drop.includes(c));
    cases++;
  }

  // D. More life than the opponent: drawn. The same life: not.
  for (const more of [true, false]) {
    let s = fresh(seat, seed(more ? 12 : 13));
    const me = stage(s, seat, "LIFEDRAW", "battle");
    if (more) assert.ok(moveCard(s, game, s.sides[foe].zones.life[0], "drop", { owner: foe }).ok);
    s = take(s, { type: "attack", player: seat, attacker: me, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s);
    assert.equal(hand(s, seat), more ? 1 : 0, `${seat}: D: BT1-058 — ${more ? "more life: drawn" : "equal life: not"}`);
    cases++;
  }

  // D. A Leader turned back to its front: yours, and theirs.
  for (const def of ["FLIPMINE", "FLIPTHEIRS"] as const) {
    let s = fresh(seat, seed(def === "FLIPMINE" ? 14 : 15), "L-RED");
    const who = def === "FLIPMINE" ? seat : foe;
    const leader = s.sides[who].zones.leader[0];
    s.cards[leader].flipped = true;
    const me = stage(s, seat, def, "battle");
    s = activateLine(s, me);
    assert.ok(!s.cards[leader].flipped, `${seat}: D: ${def === "FLIPMINE" ? "your" : "their"} Leader is back on its front`);
    cases++;
  }
}

console.log(`phrasing-batch-7: ${records} record-level cases, and ${cases} both-seat reload cases`);

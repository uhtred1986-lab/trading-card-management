/**
 * Mechanism batch 4 (27 Oct 2026): cost change (20-21), count-based amounts, statics in other areas (9-1-3), prohibition
 * leftovers (20-14) and two keyword leftovers of batch 3 (9-1-5, 22-1-1). Printed text inline (catalog text of the
 * open-rules export of 26 Oct 2026, with the catalog's errata applied; costs, powers and companions in the VM cases are
 * synthetic).
 *
 * C: cost conditions — "the total number of cards in Rest Mode between you and your opponent" (P-106, P-110, P-111: the
 *    Leader, Battle and Energy Areas, the official Q&A on P-106), "your opponent's Leader has a Battle Card under it"
 *    (P-499), "you or your opponent's Leader Card has 15000 or more power" (BT3-026), "your Leader Card and all of your
 *    energy are mono-yellow" (BT14-154), "your opponent is the original owner of 4 or more Battle Cards in play"
 *    (BT23-077); "for each card your opponent has in Rest Mode" (BT17-148).
 * A: counted amounts — "For each marker on this card, it gets +5000 power during your turn" (EX19-21), "it gains +1000
 *    for each 1 energy you have, for the duration of the turn" (BT1-030), "for each card in both players' Battle Areas
 *    and energy" (BT30-055), "For each ≪Turtle School≫ card with a different character name in your Z-Energy" (BT18-059b,
 *    BT18-091: names, not cards), "[Triple Strike] and +5000 power for each Extra Card …" (BT13-064).
 * S: other areas — "This card has <Ginyu>, … in all areas" (P-024), "Your <Son Goku> and <Vegeta> cards are also treated
 *    as red, blue, and green in all areas" (EX21-19: valid in all areas, 9-1-3-3), "ignore this card's specified
 *    cost in all areas" (EX21-34).
 * P: prohibitions — "Afterwards, the opponent's Battle Cards are unable to attack" (BT1-106, unconditional: official Q&A),
 *    "can't activate [Blocker] or [Counter] skills" (P-671's half), "can't activate [Counter]" (BT23-076's half), "you
 *    can't play Battle Cards from your Drop Area" (BT12-109's half), "can't attack this card or Unison Cards" with "at
 *    least 1 <Lavender> and 1 <Basil>" (P-268b).
 * K: "[Permanent] Negate the keyword skills of all your Battle Cards" (BT31-002b) — a standing reader now; "play … from
 *    your Drop, ignoring its [permanent] skill" (EX21-31; owner's ruling of 27 Oct 2026: for that play only).
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
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
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
/** The record of `text` at `index`, read whole, through the stored-row round trip and the language's print and reparse. */
function record(text: string, what: string, index: number, o: Partial<CardDef> = {}): Rec {
  const recs = skillRecords(card(what, { skill: correctSkillText(what, text) ?? text, ...o }));
  const rec = index < 0 ? recs.at(index) : recs.find((r) => r.skillIndex === index);
  assert.ok(rec, `${what}: a record at ${index} (${recs.map((r) => r.skillIndex).join()})`);
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
const condsOf = (rec: Rec): Cond[] => {
  const top = rec.cond ? (rec.cond.kind === "all" ? rec.cond.conds : [rec.cond]) : [];
  const inner = opsDeep(rec.ops).flatMap((o) => (o.op === "if" ? [o.cond] : []));
  return [...top, ...inner];
};
let records = 0;

// C. Cost conditions and counts.
{
  const p110 = record("[ex-evolve] {y}{y}: Yellow &lt;Broly: Br&gt; card with an energy cost of 4.<br>[permanent] If the total number of cards in Rest Mode between you and your opponent is 6 or more, reduce the energy cost of this card in your hand by 3.<br>[auto] When you play this card, you can only activate skills on cards that are green or yellow and no other color for the duration of the turn.", "P-110", 10);
  const rest = condsOf(p110).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count");
  assert.ok(rest && rest.sel.side === "both" && rest.sel.mode === "rest" && rest.sel.areas?.join() === "leader,battle,energy" && rest.atLeast === 6, "C: P-110 — both players' rested Leader, Battle and Energy cards, 6 or more");
  assert.equal(opOf(p110, "costReduction")[0].amount, 3, "C: P-110 — 3 less");
  const p499 = record("[Counter: Play][Limit 1] Play this card.<br>[Permanent] If your opponent's Leader has a Battle Card under it, reduce the energy cost of this card in your hand by 2.", "P-499", 10);
  const pile = condsOf(p499).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count");
  assert.ok(pile && pile.sel.area === "under" && pile.sel.underHost?.special === "opponentLeader" && pile.sel.filter?.type === "BATTLE", "C: P-499 — a Battle Card in the opponent's Leader's pile");
  const bt3 = record("[Counter: Attack] Play this card and negate the attack.<br>[Permanent] If you or your opponent's Leader Card has 15000 or more power, reduce the energy cost of this card in your hand by 2.[Auto] When this card KO-s your opponent's Battle Card, switch it to Active Mode.", "BT3-026", 10);
  const either = condsOf(bt3).find((x): x is Extract<Cond, { kind: "any" }> => x.kind === "any");
  assert.ok(either && either.conds.length === 2 && either.conds.every((x) => x.kind === "power"), "C: BT3-026 — either Leader's power (the run-on [Auto] split off by errata)");
  const bt14 = record("[Ultimate][Deflect][Critical]<br>[Permanent] If your Leader Card and all of your energy are mono-yellow, and your opponent has 3 or more energy, reduce the energy cost of this card in your hand by 7.", "BT14-154", -1);
  const kinds = condsOf(bt14).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ["count", "every", "leaderMatches"], "C: BT14-154 — the Leader mono-yellow, every energy mono-yellow, the opponent's 3 energy");
  const bt23 = record("[permanent] If your opponent is the original owner of 4 or more Battle Cards in play, reduce the energy cost of this card in your Z-Deck by {g}{g}{g}{g}.", "BT23-077", 0);
  const owned = condsOf(bt23).find((x): x is Extract<Cond, { kind: "count" }> => x.kind === "count");
  assert.ok(owned && owned.sel.side === "both" && owned.sel.ownedByOpponent && owned.atLeast === 4, "C: BT23-077 — Battle Cards in either Battle Area the opponent owns");
  const bt17 = record("[Ultimate][Super Combo]\n[Permanent] For each card your opponent has in Rest Mode, reduce the combo cost of this card in your hand by 1.", "BT17-148", -1);
  const per = opOf(bt17, "costReduction")[0];
  assert.ok(per.what === "combo" && typeof per.amount === "object" && "count" in per.amount && per.amount.count.side === "opponent" && per.amount.count.mode === "rest" && per.amount.count.areas?.join() === "leader,battle,energy", "C: BT17-148 — 1 less combo cost per rested card of the opponent's");
  records += 6;
}

// A. Counted amounts.
{
  const ex19 = record("[Permanent] For each marker on this card, it gets +5000 power during your turn.", "EX19-21", 0);
  const mp = opOf(ex19, "power")[0];
  assert.ok(mp && "sel" in mp.target && mp.target.sel.special === "self" && typeof mp.amount === "object" && "markers" in mp.amount && mp.amount.times === 5000, "A: EX19-21 — this card, +5000 per marker on it");
  assert.equal(ex19.cond?.kind, "isTurnPlayer", "A: EX19-21 — during your turn");
  const bt1 = record("[Auto] When this card attacks, it gains +1000 for each 1 energy you have, for the duration of the turn.", "BT1-030", 0);
  const ep = opOf(bt1, "power")[0];
  assert.ok(ep && typeof ep.amount === "object" && "count" in ep.amount && ep.amount.count.area === "energy" && ep.amount.times === 1000 && ep.until === "turn", "A: BT1-030 — +1000 per energy, for the turn");
  const bt30 = record("[activate: battle] [limit 1] If your Leader is green: Choose up to 1 of your green cards and it gets +1000 power for the battle for each card in both players' Battle Areas and energy.", "BT30-055", 0);
  const bp = opOf(bt30, "power")[0];
  assert.ok(bp && typeof bp.amount === "object" && "count" in bp.amount && bp.amount.count.side === "both" && bp.amount.count.areas?.join() === "battle,energy" && bp.until === "battle", "A: BT30-055 — both players' Battle Areas and energy");
  const bt18 = record("[Activate: Battle] Choose 1 {Master Roshi's Training} in your Battle Area and place it in its owner's Drop: For each ≪Turtle School≫ card with a different character name in your Z-Energy, this card gets +5000 power and [Double Strike] for the battle.", "BT18-059", 0);
  const np = opOf(bt18, "power")[0];
  assert.ok(np && typeof np.amount === "object" && "count" in np.amount && np.amount.count.differentCharacters && np.amount.count.area === "zEnergy", "A: BT18-059b — one step per character name");
  assert.equal(opOf(bt18, "grant")[0]?.keyword.name, "Strike", "A: BT18-059b — and [Double Strike], once");
  const bt13 = record("[-3][Activate: Battle] This card gets [Triple Strike] and +5000 power for each Extra Card in your Battle Area with the [Field] skill for the turn.", "BT13-064", 0);
  assert.ok(opOf(bt13, "power")[0].until === "turn" && opOf(bt13, "grant")[0].until === "turn", "A: BT13-064 — the counted power and [Triple Strike], both for the turn");
  const eb1 = record("[Auto] If your Leader Card is a ≪World Tournament≫ or ≪Heroine≫ card: When this card is used in a combo, it gets +10000 combo power for the battle; if it's your opponent's turn, this card gets an additional +2000 combo power for the battle for each color in your energy.", "EB1-50", 0);
  const cps = opOf(eb1, "comboPower");
  assert.ok(cps.length === 2 && cps[0].amount === 10000 && typeof cps[1].amount === "object" && "count" in cps[1].amount && cps[1].amount.count.distinctColors && cps[1].amount.times === 2000, "A: EB1-50 — +10000, and +2000 more per colour in your energy");
  assert.ok(opOf(eb1, "if").some((o) => o.cond.kind === "isTurnPlayer"), "A: EB1-50 — the second only on the opponent's turn");
  records += 6;
}

// S. Other areas.
{
  const p024 = record("[Permanent] This card has &lt;Ginyu&gt;, &lt;Jeice&gt;, &lt;Burter&gt;, &lt;Recoome&gt;, and &lt;Guldo&gt; in all areas.", "P-024", 0);
  const g = opOf(p024, "gains")[0];
  assert.ok(g && g.allAreas && g.characters?.length === 5, "S: P-024 — five character names, in all areas");
  const ex21 = record("[permanent] Your &lt;Son Goku&gt; and &lt;Vegeta&gt; cards are also treated as red, blue, and green in all areas.", "EX21-19", 0);
  const c3 = opOf(ex21, "gains");
  assert.ok(c3.length && c3.every((x) => x.allAreas && x.colors?.join() === "Red,Blue,Green" && !!x.target && "sel" in x.target && (x.target.sel.areas?.length ?? 0) > 5), "S: EX21-19 — your <Son Goku>/<Vegeta> cards wherever they are");
  const ex34 = record("[Permanent] If your Leader is a &lt;Broly&gt; card, ignore this card's specified cost in all areas, and this card can't be KO'd by skills while it's in a Battle Area.", "EX21-34", 0);
  assert.ok(opOf(ex34, "costReduction").some((x) => x.what === "specified" && x.all), "S: EX21-34 — no specified cost");
  records += 3;
}

// P. Prohibitions.
{
  const bt1 = record("[Counter: Attack] If your Leader Card is yellow, negate the attack.Afterwards, the opponent's Battle Cards are unable to attack for the duration of the turn.", "BT1-106", 0, { type: "EXTRA" });
  const top = bt1.ops.find((o) => o.op === "forbid");
  assert.ok(top && top.op === "forbid" && top.what === "attack" && top.until === "turn" && !bt1.cond, "P: BT1-106 — outside the Leader condition (official Q&A)");
  const p268 = record("[Permanent] If you have at least 1 &lt;Lavender&gt; and 1 &lt;Basil&gt; card in play, your opponent's Leader Card can't attack this card or Unison Cards.", "P-268", 0, { type: "LEADER" });
  const bans = opOf(p268, "forbid");
  assert.ok(bans.length === 2 && bans.every((b) => b.what === "attack") && bans.some((b) => b.against) && bans.some((b) => b.attackTarget), "P: P-268b — this card, and Unison Cards");
  assert.equal(condsOf(p268).filter((x) => x.kind === "count").length, 2, "P: P-268b — a <Lavender> and a <Basil>");
  const both = record("[Auto] When this card attacks, your opponent can't activate [Blocker] or [Counter] skills for the turn.", "BC", 0);
  assert.deepEqual(opOf(both, "forbid").map((b) => b.what).sort(), ["activateCounter", "block"], "P: [Blocker] or [Counter] — two prohibitions");
  const drop = record("[Activate: Main] Draw 1 card. You can't play Battle Cards from your Drop Area for the turn.", "NODROP", 0);
  assert.equal(opOf(drop, "forbid")[0].fromArea, "drop", "P: BT12-109's half — a play from the Drop");
  records += 4;
}

// K. Keyword negation of a group, and a play ignoring the card's own [Permanent].
{
  const bt31 = record("[permanent] Negate the keyword skills of all your Battle Cards.", "BT31-002", 0, { type: "LEADER" });
  assert.deepEqual(opOf(bt31, "negateSkillsOfKind").map((x) => x.kind), ["keyword", "counter"], "K: BT31-002b — the keyword half (keywords, [Counter]s)");
  const ex21 = record("[auto] Discard 2 cards from your hand: When this card is placed in your Leader Area, play up to 1 {SS3 Broly, Saiyan Berserker} from your Drop, ignoring its [permanent] skill.", "EX21-31", 0, { type: "Z-LEADER" });
  assert.equal(opOf(ex21, "play")[0].ignoreOwnPermanent, true, "K: EX21-31 — the play ignores the card's own [Permanent]");
  records += 2;
}
// Left unread on purpose.
assert.ok(unreadOf("[Auto] When this card is played, draw 1 card, ignoring its [permanent] skill.").length > 0, "K: \"ignoring its [permanent] skill\" with no play before it stays unread");
assert.ok(unreadOf("[Permanent] If your Leader is a green <Tien Shinhan> card, reduce the energy cost of this card in your hand by the total amount of <Tien Shinhan> cards and Multi-Form Tokens in your Battle Area.").length > 0, "C: BT28-073's union of a name and a token stays unread");

// ── 2. the VM ────────────────────────────────────────────────────────────────
const extra = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  // K: the standing keyword negation, and the timed one of the opponent's.
  NEGKW: card("NEGKW", { skill: "[Permanent] Negate the keyword skills of all your Battle Cards." }),
  NEGFOE: card("NEGFOE", { skill: "[Activate: Main] Negate the keyword skills of all your opponent's Battle Cards for the turn." }),
  GUARD: card("GUARD", { skill: "[Blocker]" }),
  // C: the rested-card count (P-111's shape) and the opponent's Leader's pile (P-499's).
  RESTCUT: card("RESTCUT", { energyCost: 3, skill: "[Permanent] If the total number of cards in Rest Mode between you and your opponent is 3 or more, reduce the energy cost of this card in your hand by 2." }),
  PILECUT: card("PILECUT", { energyCost: 3, skill: "[Permanent] If your opponent's Leader has a Battle Card under it, reduce the energy cost of this card in your hand by 2." }),
  // A: markers, energy, character names.
  MARKED: card("MARKED", { skill: "[Permanent] For each marker on this card, it gets +5000 power during your turn." }),
  CHARGER: card("CHARGER", { skill: "[Auto] When this card attacks, it gains +1000 for each 1 energy you have, for the duration of the turn." }),
  ROSHI: card("ROSHI", { skill: "[Activate: Main] For each ≪Turtle School≫ card with a different character name in your Z-Energy, this card gets +5000 power for the turn." }),
  TS1: card("TS1", { traits: ["Turtle School"], characters: ["Krillin"] }),
  TS2: card("TS2", { traits: ["Turtle School"], characters: ["Krillin"] }),
  TS3: card("TS3", { traits: ["Turtle School"], characters: ["Yamcha"] }),
  // S: other cards' identity in all areas.
  RAINBOW: card("RAINBOW", { skill: "[Permanent] Your &lt;Son Goku&gt; and &lt;Vegeta&gt; cards are also treated as red, blue, and green in all areas." }),
  GOKU: card("GOKU", { characters: ["Son Goku"] }),
  GINYU: card("GINYU", { skill: "[Permanent] This card has &lt;Ginyu&gt;, &lt;Jeice&gt;, and &lt;Guldo&gt; in all areas." }),
  // K: a card whose own [Permanent] forbids its play, played ignoring it and not.
  NOPLAY: card("NOPLAY", { skill: "[Permanent] You can't play this card unless all of your energy is green." }),
  IGNORER: card("IGNORER", { skill: "[Activate: Main] Play up to 1 {NOPLAY} from your Drop Area, ignoring its [permanent] skill." }),
  PLAINPLAY: card("PLAINPLAY", { skill: "[Activate: Main] Play up to 1 {NOPLAY} from your Drop Area." }),
  // P: the Drop closed to plays; [Blocker] and [Counter] closed to the defender.
  NODROP: card("NODROP", { skill: "[Activate: Main] Draw 1 card. You can't play Battle Cards from your Drop Area for the turn." }),
  REVIVER: card("REVIVER", { skill: "[Activate: Main] Play up to 1 Battle Card from your Drop Area." }),
  // (An [Activate: Main], not "when this card attacks": the [Counter: Attack] timing of 8-1-4 comes before the
  // attack's own [Auto]s resolve at the checkpoint of 8-1-5, so that window would still be open to the defender.)
  SILENCER: card("SILENCER", { skill: "[Activate: Main] Your opponent can't activate [Blocker] or [Counter] skills for the turn." }),
  CATK: extra("CATK", "[Counter: Attack] Negate the attack."),
  BC: card("BC", { energyCost: 1 }),
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
/** A deck card of `p` turned into `def` and moved to `area` — or, with `under`, put under that card. */
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
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
    else if (q.kind === "blocker") s = take(s, { type: "block", player: who, card: null } as Action);
    else s = take(s, { type: "pass", player: who } as Action);
  }
  assert.ok(done(s), `settled (at ${s.prompt.kind})`);
  return s;
}
const linesOf = (def: string) => parseSkills(defs[def].skill!).map((sk) => sk.index);
const offerOf = (s: VmState, c: string, line = linesOf(s.cards[c].cardId)[0]) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === line);
const playable = (s: VmState, c: string) => RULES.legalActions(ctx, s).some((l) => l.action.type === "play" && l.action.card === c);
function activateLine(s: VmState, c: string, steer: Steer = {}, seen: Prompt[] = []): VmState {
  const offer = offerOf(s, c);
  assert.ok(offer, `${s.cards[c].cardId}: offered`);
  return settle(take(s, offer.action), steer, undefined, seen);
}
const pick = (...ids: string[]) => ({ cards: (q: Extract<Prompt, { kind: "chooseCards" }>) => ids.filter((id) => q.choice.candidates.includes(id)) });
const zoneOf = (s: VmState, p: PlayerId, id: string) => Object.entries(s.sides[p].zones).find(([, ids]) => (ids as string[]).includes(id))?.[0];
const endTurn = (s: VmState, who: PlayerId, steer: Steer = {}) => settle(take(s, { type: "endMain", player: who } as Action), steer, (x) => x.prompt.kind === "main" && x.turnPlayer === other(who));
const attr = (s: VmState, id: string, name: string) => attrsNow(ctx, game, roundtrip(s), id)[name];
const blocker = (s: VmState, id: string) => hasKeyword(ctx, game, roundtrip(s), id, "Blocker");

let cases = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const seed = (n: number) => 27400 + n * 2 + (seat === "p1" ? 0 : 1);

  // K. The standing keyword negation: your [Blocker]s lose it while the card is in play; the opponent's keep theirs.
  {
    const s = fresh(seat, seed(0));
    const neg = stage(s, seat, "NEGKW", "battle");
    const mine = stage(s, seat, "GUARD", "battle");
    const theirs = stage(s, foe, "GUARD", "battle");
    assert.equal(blocker(s, mine), false, `${seat}: K: your [Blocker] is negated`);
    assert.equal(blocker(s, theirs), true, `${seat}: K: …the opponent's is not`);
    assert.ok(!(attr(s, mine, "keywords") as string[]).length, `${seat}: K: …the keywords attribute reads none`);
    assert.ok(moveCard(s, game, neg, "drop", { owner: seat }).ok);
    assert.equal(blocker(s, mine), true, `${seat}: K: …and it is back once the card leaves play (9-1-3-1)`);
    cases++;
  }
  // K. The timed one, of the opponent's Battle Cards: for the turn only.
  {
    let s = fresh(seat, seed(1));
    const me = stage(s, seat, "NEGFOE", "battle");
    const theirs = stage(s, foe, "GUARD", "battle");
    s = activateLine(s, me);
    assert.equal(blocker(s, theirs), false, `${seat}: K: the opponent's [Blocker] is negated for the turn`);
    s = endTurn(s, seat);
    assert.equal(blocker(s, theirs), true, `${seat}: K: …and back on the next turn`);
    cases++;
  }
  // C. Both players' rested Leader, Battle and Energy cards: 3 or more, and the card in hand costs 2 less.
  {
    const s = fresh(seat, seed(2));
    const cut = stage(s, seat, "RESTCUT", "hand");
    stage(s, seat, "V1", "energy");
    assert.equal(attr(s, cut, "costOf"), 3, `${seat}: C: nothing rested — full price`);
    assert.equal(playable(s, cut), false, `${seat}: C: …not playable with 1 energy`);
    for (let i = 0; i < 2; i++) s.cards[stage(s, foe, "V-BLUE", "energy")].mode = "rest";
    const restedHand = stage(s, foe, "V-BLUE", "hand");
    void restedHand;
    assert.equal(attr(s, cut, "costOf"), 3, `${seat}: C: two rested — still full price`);
    s.cards[s.sides[seat].zones.leader[0]].mode = "rest";
    assert.equal(attr(s, cut, "costOf"), 1, `${seat}: C: the seat's rested Leader makes 3 — 2 less`);
    assert.equal(playable(s, cut), true, `${seat}: C: …playable with 1 energy`);
    const after = settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === cut)!.action));
    assert.equal(zoneOf(after, seat, cut), "battle", `${seat}: C: …and played`);
    cases++;
  }
  // C. A Battle Card in the opponent's Leader's pile.
  {
    const s = fresh(seat, seed(3));
    const cut = stage(s, seat, "PILECUT", "hand");
    assert.equal(attr(s, cut, "costOf"), 3, `${seat}: C: no pile — full price`);
    stage(s, foe, "V-BLUE", "battle", s.sides[foe].zones.leader[0]);
    assert.equal(attr(s, cut, "costOf"), 1, `${seat}: C: a Battle Card under the opponent's Leader — 2 less`);
    stage(s, seat, "V1", "battle", s.sides[seat].zones.leader[0]);
    cases++;
  }
  // A. Markers: +5000 each during your turn, nothing on the opponent's.
  {
    let s = fresh(seat, seed(4));
    const me = stage(s, seat, "MARKED", "battle");
    s.cards[me].markers = 2;
    assert.equal(attr(s, me, "power"), 20000, `${seat}: A: two markers, your turn — +10000`);
    s = endTurn(s, seat);
    assert.equal(attr(s, me, "power"), 10000, `${seat}: A: …the opponent's turn — none`);
    cases++;
  }
  // A. "+1000 for each 1 energy you have" as it resolves, for the turn.
  {
    let s = fresh(seat, seed(5));
    const me = stage(s, seat, "CHARGER", "battle");
    for (let i = 0; i < 3; i++) stage(s, seat, "V1", "energy");
    s = take(s, { type: "attack", player: seat, attacker: me, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s);
    assert.equal(attr(s, me, "power"), 13000, `${seat}: A: three energy — +3000`);
    s = endTurn(s, seat);
    assert.equal(attr(s, me, "power"), 10000, `${seat}: A: …for the turn`);
    cases++;
  }
  // A. Character names, not cards: two Krillins and a Yamcha are two steps.
  {
    let s = fresh(seat, seed(6));
    const me = stage(s, seat, "ROSHI", "battle");
    for (const d of ["TS1", "TS2", "TS3"]) stage(s, seat, d, "zEnergy");
    s = activateLine(s, me);
    assert.equal(attr(s, me, "power"), 20000, `${seat}: A: two character names — +10000`);
    cases++;
  }
  // S. Other cards' identity in every area.
  {
    const s = fresh(seat, seed(7));
    const rainbow = stage(s, seat, "RAINBOW", "battle");
    const goku = stage(s, seat, "GOKU", "hand");
    const theirs = stage(s, foe, "GOKU", "hand");
    assert.deepEqual((attr(s, goku, "colors") as string[]).slice().sort(), ["Blue", "Green", "Red"], `${seat}: S: your <Son Goku> in hand — red, blue, green`);
    assert.deepEqual(attr(s, theirs, "colors"), ["Red"], `${seat}: S: …the opponent's is not`);
    // 9-1-3-3 read literally ("…in all areas": the skill is valid in all areas), as `auto-costs-549.ts` already holds
    // for an all-area [Permanent] in hand: it still holds with its card in hand. Ruling question 1 of the PR.
    assert.ok(moveCard(s, game, rainbow, "hand", { owner: seat }).ok);
    assert.deepEqual((attr(s, goku, "colors") as string[]).slice().sort(), ["Blue", "Green", "Red"], `${seat}: S: …and with its card in hand too (9-1-3-3)`);
    const ginyu = stage(s, seat, "GINYU", "hand");
    assert.ok((attr(s, ginyu, "characters") as string[]).map((c) => c.toLowerCase()).includes("jeice"), `${seat}: S: "this card has <Jeice> in all areas" — in hand too`);
    cases++;
  }
  // K. Its own [Permanent] forbids the play; "ignoring its [permanent] skill" plays it, the plain play does not.
  for (const ignoring of [false, true]) {
    let s = fresh(seat, seed(ignoring ? 9 : 8));
    const me = stage(s, seat, ignoring ? "IGNORER" : "PLAINPLAY", "battle");
    const banned = stage(s, seat, "NOPLAY", "drop");
    stage(s, seat, "V1", "energy");
    s = activateLine(s, me, pick(banned));
    assert.equal(zoneOf(s, seat, banned), ignoring ? "battle" : "drop", `${seat}: K: ${ignoring ? "ignoring its [Permanent] — played" : "its [Permanent] holds — not played"}`);
    cases++;
  }
  // P. The Drop closed to plays for the turn; the hand is not.
  {
    let s = fresh(seat, seed(10));
    const closer = stage(s, seat, "NODROP", "battle");
    const reviver = stage(s, seat, "REVIVER", "battle");
    const dead = stage(s, seat, "BC", "drop");
    const inHand = stage(s, seat, "BC", "hand");
    stage(s, seat, "V1", "energy");
    s = activateLine(s, closer);
    const tried = offerOf(s, reviver);
    if (tried) s = settle(take(s, tried.action), pick(dead));
    assert.equal(zoneOf(s, seat, dead), "drop", `${seat}: P: no Battle Card is played from the Drop`);
    assert.equal(playable(s, inHand), true, `${seat}: P: …one in hand still is`);
    cases++;
  }
  // P. No [Blocker], no [Counter] for the defender this turn.
  {
    let s = fresh(seat, seed(11));
    const me = stage(s, seat, "SILENCER", "battle");
    stage(s, foe, "GUARD", "battle");
    const counter = stage(s, foe, "CATK", "hand");
    stage(s, foe, "V1", "energy");
    const lifeBefore = s.sides[foe].zones.life.length;
    const seen: Prompt[] = [];
    s = activateLine(s, me);
    s = take(s, { type: "attack", player: seat, attacker: me, target: s.sides[foe].zones.leader[0] } as Action);
    s = settle(s, {}, undefined, seen);
    assert.ok(!seen.some((q) => q.kind === "blocker" && q.player === foe), `${seat}: P: no block offered`);
    assert.ok(!seen.some((q) => q.kind === "counter" && q.player === foe && (q as { candidates?: string[] }).candidates?.includes(counter)), `${seat}: P: no [Counter] offered`);
    assert.equal(zoneOf(s, foe, counter), "hand", `${seat}: P: …the counter stays in hand`);
    assert.ok(s.sides[foe].zones.life.length < lifeBefore, `${seat}: P: …and the attack hit`);
    // The control: a plain attacker is offered both.
    let c = fresh(seat, seed(12));
    const plainAttacker = stage(c, seat, "BC", "battle");
    stage(c, foe, "GUARD", "battle");
    const counter2 = stage(c, foe, "CATK", "hand");
    stage(c, foe, "V1", "energy");
    const seen2: Prompt[] = [];
    c = take(c, { type: "attack", player: seat, attacker: plainAttacker, target: c.sides[foe].zones.leader[0] } as Action);
    c = settle(c, {}, undefined, seen2);
    assert.ok(seen2.some((q) => q.kind === "blocker" && q.player === foe), `${seat}: P: control — a plain attack offers the block`);
    assert.ok(seen2.some((q) => q.kind === "counter" && q.player === foe && JSON.stringify(q).includes(counter2)), `${seat}: P: control — …and the [Counter]`);
    cases++;
  }
}

console.log(`mechanism-4: ${records} record-level cases, and ${cases} both-seat reload cases`);

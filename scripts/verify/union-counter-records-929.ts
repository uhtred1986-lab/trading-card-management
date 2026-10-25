/**
 * #929 (25 Oct rescope): the opponent's [Counter: Play] and a [Counter: Counter]
 * chain against the Union records that were actually applied, read from their
 * printed catalog text through the stored-row loader (`skillRecords` →
 * `rulesFromRows`, the route a deployed record takes) — not the synthetic
 * FUS/POT/ABS fixtures of `union-counter-929.ts`.
 *
 *   BT3-070 front#0 [Union-Absorb]   (catalog: evidence/923/metadata-2026-10-19)
 *   BT2-012 front#0 [Union-Potara]   (catalog: evidence/907/potara-identity-2026-10-19)
 *   BT11-013        [Union-Fusion]   printed [Deflect]: no Counter: Play window at all
 *   P-360 back#0    granted [Union-Fusion] on a red <Gogeta: Br> in hand
 *   BT6-012 / BT6-013 front#0 [Union-Fusion] (catalog: evidence/897), each with
 *                   "[Auto] When you play this card, you can't play {its name}"
 *
 * The exact stored bodies of these records are proved equal to the compiled
 * ones elsewhere (absorb-identity-923, potara-identity-907, fusion-materials-907,
 * fusion-identity-907); this file proves what the opponent's counters do to
 * them. Companion cards (the materials, the Android 13 played from the deck,
 * the counters, the energy) are synthetic.
 *
 * Rules: 22-10-3-1 (a [Counter: Play] pends when the opponent activates a skill
 * that plays), 22-10-3-4 / 9-7-3 (a [Counter: Counter] answers a [Counter]; the
 * answers alternate and resolve last-first, 9-7-3-5), 22-10-8 (a negated
 * counter's effect never resolves; its costs stay paid), 22-20 ([Deflect]),
 * 22-13-4-5-1 / 22-13-5-4-2 / 22-13-6-3-2 and their "returned to its owner's
 * hand" exception (a card that fails to enter play is dropped unless it was
 * returned to hand). Owner's ruling of 25 Oct 2026 on #930: a card counts as
 * "played using Union" only on a successful Union entry — so a failed entry
 * fires no "when you play this card" Auto (BT6-012/013's self-prohibition is
 * not put in force) and the played-Auto of the card does not draw.
 *
 * Every case runs on both seats; every action goes through a JSON round trip of
 * the executable context and the state and is applied twice to the same result.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbids } from "../../src/lib/arena/vm/program";
import { GRANTED_LINE_BASE } from "../../src/lib/arena/vm/common";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// ── the actual printed cards ────────────────────────────────────────────────
const m923: CardDef[] = JSON.parse(readFileSync("docs/arena-backlog/evidence/923/metadata-2026-10-19/cards.json", "utf8"));
const potara: CardDef = JSON.parse(readFileSync("docs/arena-backlog/evidence/907/potara-identity-2026-10-19/reference-before.json", "utf8")).catalog[0];
const pair = JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json", "utf8")).cards as Parameters<typeof cardDefFrom>[0][];
const actual = <T extends { id: string }>(id: string, from: T[]): T => { const d = from.find((c) => c.id === id); assert.ok(d, `${id} in its frozen catalog`); return d; };
const DRAW = "[auto] When this card is played, draw 1 card.";
const counter = (id: string, skill: string, energyCost = 0): CardDef => card(id, { type: "EXTRA", energyCost, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = { ...DEFS,
  "BT3-070": actual("BT3-070", m923), "BT11-013": actual("BT11-013", m923), "P-360": actual("P-360", m923),
  "BT2-012": potara,
  "BT6-012": cardDefFrom(actual("BT6-012", pair)), "BT6-013": cardDefFrom(actual("BT6-013", pair)),
  // companions
  A14R929: card("A14R929", { colors: ["Green"], characters: ["Android 14"] }),
  A15R929: card("A15R929", { colors: ["Green"], characters: ["Android 15"] }),
  A13R929: card("A13R929", { colors: ["Green"], characters: ["Android 13"], energyCost: 7, power: 25000, skill: DRAW }),
  GKR929: card("GKR929", { characters: ["Son Goku"] }), VGR929: card("VGR929", { characters: ["Vegeta"] }),
  GKBR929: card("GKBR929", { characters: ["Son Goku: Br"], power: 10000 }), VGBR929: card("VGBR929", { characters: ["Vegeta: Br"], power: 10000 }),
  GOGR929: card("GOGR929", { characters: ["Gogeta: Br"], energyCost: 6, power: 25000, skill: DRAW }),
  ER929: card("ER929", { colors: ["Red"] }), EU929: card("EU929", { colors: ["Blue"] }), EG929: card("EG929", { colors: ["Green"] }),
  LSR929: card("LSR929", { type: "LEADER", colors: ["Red"], traits: ["Saiyan"] }),
  CRETR929: counter("CRETR929", "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played."),
  CDROPR929: counter("CDROPR929", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  STOPR929: counter("STOPR929", "[Counter: Counter] Negate the [Counter].", 1),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r) => ({ ...r, source: "compiler", status: "draft" } as RuleRow)));
const scripts = rulesFromRows(rows, defs);
const scriptsKey = (id: string, side: string) => (side === "back" ? `${id}#back` : id); // rules-store.ts: a Leader's awakened side
/** The applied lines: each family's Union line, P-360's granting back#0, and the counters. */
for (const [id, side, pick] of [["BT3-070", "front", /union absorb/i], ["BT2-012", "front", /union-potara/i], ["BT11-013", "front", /union-fusion/i], ["BT6-012", "front", /union-fusion/i], ["BT6-013", "front", /union-fusion/i], ["P-360", "back", /union-fusion/i], ["CRETR929", "front", /counter/i], ["CDROPR929", "front", /counter/i], ["STOPR929", "front", /counter/i]] as const) {
  const row = rows.find((r) => r.cardId === id && r.side === side && pick.test(String(r.printed))); assert.ok(row, `${id} ${side}: the line is compiled`);
  const script = scripts[scriptsKey(id, side)]?.bySkill[row.skillIndex]; assert.ok(script, `${id} ${side}#${row.skillIndex}: loaded from its stored row`);
  assert.deepEqual(script.unsupported, [], `${id} ${side}#${row.skillIndex}: the stored line loads ready`);
}
const baseCtx: EngineContext = clone({ ...CTX, defs, scripts });

// ── saved-game driver ───────────────────────────────────────────────────────
interface Saved { ctx: EngineContext; state: VmState }
const events: GameEvent[] = [];
function take(s: Saved, action: Action): Saved {
  const a = clone(s), b = clone(s);
  const one = RULES.apply(a.ctx, a.state, clone(action)), two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "the saved context, state and action replay identically");
  events.push(...one.events);
  return clone({ ctx: a.ctx, state: one.state as VmState });
}
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const zone = (s: Saved, p: PlayerId, area: string) => s.state.sides[p].zones[area];
function stage(s: Saved, p: PlayerId, def: string, area: string): string {
  const id = s.state.sides[p].zones.deck.find((x) => s.state.cards[x].cardId === "V1"); assert.ok(id, "an unused generic copy");
  s.state.cards[id].cardId = def; assert.ok(moveCard(s.state, game, id, area, { owner: p }).ok); return id;
}
function fresh(seat: PlayerId, leader: string): Saved {
  const foe = other(seat);
  let s: Saved = { ctx: clone(baseCtx), state: RULES.createGame(baseCtx, { seed: 9290, p1: { name: "P1", leader: seat === "p1" ? leader : "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: seat === "p2" ? leader : "L-RED", main: fifty("V1") } }).state as VmState };
  for (const a of [{ type: "chooseFirst", player: s.state.chooser, first: seat }, { type: "mulligan", player: seat, redraw: false }, { type: "mulligan", player: foe, redraw: false }, { type: "charge", player: seat, card: null }] as Action[]) s = take(s, a);
  assert.equal(s.state.turnPlayer, seat); assert.equal(s.state.prompt.kind, "main");
  for (const p of [seat, foe]) for (const area of ["hand", "energy"]) for (const id of zone(s, p, area).slice()) assert.ok(moveCard(s.state, game, id, "deck", { owner: p }).ok);
  return s;
}

type Rec = "BT3-070" | "BT2-012" | "BT11-013" | "P-360" | "BT6-012" | "BT6-013";
type Family = "absorb" | "potara" | "fusion";
const FAMILY: Record<Rec, Family> = { "BT3-070": "absorb", "BT2-012": "potara", "BT11-013": "fusion", "P-360": "fusion", "BT6-012": "fusion", "BT6-013": "fusion" };
interface Board { s: Saved; seat: PlayerId; foe: PlayerId; rec: Rec; source: string; played: string; mats: string[]; energy: string[] }
/** The seat's board for one applied record, the opponent holding `foeHand`, the seat holding `seatHand` beside the Union cards. */
function board(rec: Rec, seat: PlayerId, foeHand: string[] = [], seatHand: string[] = []): Board {
  const foe = other(seat);
  const s = fresh(seat, rec === "P-360" ? "P-360" : rec.startsWith("BT6") ? "LSR929" : "L-RED");
  let source: string, played: string, mats: string[], energy: string[];
  if (rec === "BT3-070") {
    source = stage(s, seat, "BT3-070", "battle");
    mats = [stage(s, seat, "A14R929", "drop"), stage(s, seat, "A15R929", "drop")];
    played = stage(s, seat, "A13R929", "deck");
    energy = [stage(s, seat, "EG929", "energy")];
  } else if (rec === "BT2-012") {
    source = played = stage(s, seat, "BT2-012", "hand");
    mats = [stage(s, seat, "GKR929", "battle"), stage(s, seat, "VGR929", "battle")];
    energy = ["ER929", "ER929", "ER929", "ER929", "ER929"].map((e) => stage(s, seat, e, "energy"));
  } else if (rec === "P-360") {
    s.state.cards[zone(s, seat, "leader")[0]].flipped = true; // SSG Vegeta, Crimson Warrior: the granting back face
    source = played = stage(s, seat, "GOGR929", "hand");
    mats = [stage(s, seat, "GKBR929", "hand"), stage(s, seat, "VGBR929", "hand")];
    energy = ["ER929", "EU929", "ER929", "ER929"].map((e) => stage(s, seat, e, "energy"));
  } else {
    source = played = stage(s, seat, rec, "hand");
    mats = [stage(s, seat, "GKBR929", "hand"), stage(s, seat, "VGBR929", "hand")];
    energy = rec === "BT11-013" ? ["ER929", "ER929", "ER929"].map((e) => stage(s, seat, e, "energy")) : [];
  }
  for (const id of foeHand) stage(s, foe, id, "hand");
  for (const id of seatHand) { stage(s, seat, id, "hand"); energy.push(stage(s, seat, "ER929", "energy")); }
  return { s, seat, foe, rec, source, played, mats, energy };
}
interface Window { player: PlayerId; window: string; landed: boolean; candidates: string[] }
type Policy = (s: Saved, w: Window) => string | null;
interface Run { s: Saved; windows: Window[]; since: number; start: Saved }
function drive(b: Board, policy: Policy = () => null): Run {
  const since = events.length;
  const offer = RULES.legalActions(b.s.ctx, b.s.state).find((l) => l.action.type === "activate" && l.action.card === b.source && (b.rec === "P-360" ? l.action.skill >= GRANTED_LINE_BASE : true));
  assert.ok(offer, `${b.rec}/${b.seat}: the Union activation is offered`);
  let s = take(b.s, offer.action); const windows: Window[] = [];
  for (let i = 0; i < 60 && s.state.prompt.kind !== "main"; i++) {
    const p = s.state.prompt;
    if (p.kind === "chooseMode") s = take(s, { type: "chooseMode", player: p.player, index: 0 });
    else if (p.kind === "payCost") s = take(s, { type: "payCost", player: p.player, option: 0 });
    else if (p.kind === "chooseCards") s = take(s, { type: "choose", player: p.player, cards: p.choice.candidates.slice(0, Math.max(1, p.choice.min)) });
    else if (p.kind === "orderPending") s = take(s, { type: "orderPending", player: p.player, index: 0 });
    else if (p.kind === "counter") {
      const w: Window = { player: p.player, window: p.window, landed: s.state.resolving?.landed === true, candidates: [...p.candidates] };
      windows.push(w); s = take(s, { type: "counter", player: p.player, card: policy(s, w) });
    } else throw new Error(`${b.rec}/${b.seat}: unexpected prompt ${p.kind}`);
  }
  assert.equal(s.state.prompt.kind, "main"); assert.equal(s.state.resolving ?? null, null, "no play is left resolving");
  // one place per card
  const seen = new Map<string, number>();
  for (const side of Object.values(s.state.sides)) for (const ids of Object.values(side.zones)) for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const k of Object.values(s.state.cards)) for (const id of k.under) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of Object.keys(s.state.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one area or pile`);
  return { s, windows, since, start: b.s };
}
const arrivals = (r: Run, id: string) => events.slice(r.since).filter((e) => e.type === "move" && e.card === id && e.to === "battle").length;
const restCount = (s: Saved, p: PlayerId) => zone(s, p, "energy").filter((id) => s.state.cards[id].mode === "rest").length;
const handOf = (s: Saved, p: PlayerId) => zone(s, p, "hand").length;
/** Whether the seat's "when you play this card" self-prohibition (BT6-012/013) is in force: a fresh hand copy cannot be played. */
const selfLocked = (b: Board, r: Run) => { const probe = clone(r.s); const copy = stage(probe, b.seat, b.rec, "hand"); return forbids(probe.ctx, game, probe.state, "play", { player: b.seat, card: copy }); };

/** The Union's own costs stay paid, whatever became of the play. */
function costsPaid(b: Board, r: Run, tag: string): void {
  const fam = FAMILY[b.rec];
  if (fam === "fusion") assert.ok(b.mats.every((m) => zone(r.s, b.seat, "drop").includes(m)), `${tag}: Fusion materials stay in the Drop`);
  if (fam === "potara") assert.ok(b.mats.every((m) => zone(r.s, b.seat, "battle").includes(m) || r.s.state.cards[b.played].under.includes(m)), `${tag}: Potara materials are where the play left them`);
  if (fam === "absorb") assert.ok(b.mats.every((m) => r.s.state.cards[b.source].under.includes(m) || r.s.state.cards[b.played].under.includes(m)), `${tag}: Android 14 and 15 stay placed under (BT3-070's pile, or the stack it joined)`);
  const unionOrbs = { "BT3-070": 1, "BT2-012": 5, "BT11-013": 3, "P-360": 4, "BT6-012": 0, "BT6-013": 0 }[b.rec];
  assert.ok(restCount(r.s, b.seat) >= unionOrbs, `${tag}: the Union's ${unionOrbs} energy stays rested`);
}
/** The play landed once, stacked as its family says, and its "when played" Auto ran. */
function landed(b: Board, r: Run, tag: string): void {
  assert.ok(zone(r.s, b.seat, "battle").includes(b.played), `${tag}: in play`);
  assert.equal(arrivals(r, b.played), 1, `${tag}: exactly one arrival`);
  const fam = FAMILY[b.rec];
  if (fam === "potara") { assert.deepEqual([...r.s.state.cards[b.played].under].sort(), [...b.mats].sort(), `${tag}: both materials under it`); assert.equal(r.s.state.cards[b.played].mode, "active", `${tag}: placed in Active Mode`); }
  if (fam === "absorb") assert.ok(r.s.state.cards[b.played].under.includes(b.source), `${tag}: Android 13 on top of BT3-070`);
  // The played card's own draw (A13/Gogeta companions), and P-360 back's "[auto][once per turn] When you play a <Gogeta: Br> card, draw 1 card".
  const draws = { "BT3-070": 1, "P-360": 2 }[b.rec as string];
  if (draws) assert.equal(events.slice(r.since).filter((e) => e.type === "draw" && e.player === b.seat).length, draws, `${tag}: the "when played" draws ran (${draws})`);
  if (b.rec === "BT6-012" || b.rec === "BT6-013") assert.equal(selfLocked(b, r), true, `${tag}: "when you play this card" ran — a successful Union entry counts as played`);
  costsPaid(b, r, tag);
}
/** The play did not happen: the card is `where`, never arrived, carries nothing, and no "when played" Auto ran. */
function failed(b: Board, r: Run, where: string, tag: string): void {
  assert.ok(zone(r.s, b.seat, where).includes(b.played), `${tag}: ${b.played} in the ${where}`);
  assert.ok(!zone(r.s, b.seat, "battle").includes(b.played) && arrivals(r, b.played) === 0, `${tag}: no false arrival`);
  assert.equal(r.s.state.cards[b.played].under.length, 0, `${tag}: nothing under it`);
  if (FAMILY[b.rec] === "potara") assert.ok(b.mats.every((m) => zone(r.s, b.seat, "battle").includes(m) && r.s.state.cards[m].under.length === 0), `${tag}: the Potara materials stay as they were`);
  if (FAMILY[b.rec] === "absorb") assert.ok(zone(r.s, b.seat, "battle").includes(b.source), `${tag}: the host stays`);
  if (b.rec === "BT6-012" || b.rec === "BT6-013") assert.equal(selfLocked(b, r), false, `${tag}: no "when you play this card" — a failed Union entry is not played using Union (#930 ruling, 25 Oct)`);
  assert.ok(!events.slice(r.since).some((e) => e.type === "draw" && e.player === b.seat), `${tag}: no "when played" draw ran (the card's own, or P-360's "when you play a <Gogeta: Br> card")`);
  costsPaid(b, r, tag);
}

const cases: string[] = [];
for (const seat of ["p1", "p2"] as const) for (const rec of ["BT3-070", "BT2-012", "BT11-013", "P-360", "BT6-012", "BT6-013"] as const) {
  const tag = `${rec}/${seat}`; const foe = other(seat);

  // 1. nothing to answer with: no window, the record's play lands.
  { const b = board(rec, seat); const r = drive(b); assert.deepEqual(r.windows, [], `${tag}: no window`); landed(b, r, `${tag}/plain`); cases.push(`${tag}/plain`); }

  if (rec === "BT11-013") {
    // Printed [Deflect]: the opponent's [Counter: Play] cannot touch it, so no window opens before or after (22-20),
    // and no [Counter: Counter] is ever asked.
    const b = board(rec, seat, ["CRETR929", "CDROPR929"], ["STOPR929"]); const h = handOf(b.s, foe);
    const r = drive(b); assert.deepEqual(r.windows, [], `${tag}: [Deflect] empties both windows`);
    landed(b, r, `${tag}/deflect`); assert.equal(handOf(r.s, foe), h, `${tag}: the counters stay in hand`);
    assert.equal(handOf(r.s, seat) - handOf(b.s, seat), -3 + 2, `${tag}: Fusion card and both materials leave the hand, the printed "draw 2 cards" cost is paid`);
    cases.push(`${tag}/deflect`);
    continue;
  }

  // 2. declined: asked before the card lands and again after; lands.
  { const b = board(rec, seat, ["CRETR929"]); const r = drive(b);
    assert.deepEqual(r.windows.map((w) => [w.player, w.window, w.landed]), [[foe, "play", false], [foe, "play", true]], `${tag}: two declined windows`);
    landed(b, r, `${tag}/declined`); cases.push(`${tag}/declined`); }

  // 3. replaced in the first window: returned to hand (the 22-13 exception) / placed in the Drop.
  for (const [cid, where] of [["CRETR929", "hand"], ["CDROPR929", "drop"]] as const) {
    const b = board(rec, seat, [cid]); const r = drive(b, (_s, w) => (w.landed ? null : w.candidates[0]));
    assert.deepEqual(r.windows.map((w) => w.landed), [false], `${tag}/${cid}: no second window for a play that did not happen`);
    assert.ok(zone(r.s, foe, "drop").length === 1, `${tag}/${cid}: the counter is spent`);
    failed(b, r, where, `${tag}/${cid}`); cases.push(`${tag}/${cid}`);
  }

  // 4. Counter:Counter chain. The opponent answers the Union play with a [Counter: Play] that drops the card; the
  //    Union's player answers that counter with a [Counter: Counter] that negates it (22-10-3-4: only the counter's
  //    opponent is asked). The chain resolves last-first (9-7-3-5): the negation, then the negated counter does
  //    nothing (22-10-8), then the play lands.
  { const b = board(rec, seat, ["CDROPR929"], ["STOPR929"]);
    const stop = zone(b.s, seat, "hand").find((id) => b.s.state.cards[id].cardId === "STOPR929")!;
    const drop = zone(b.s, foe, "hand").find((id) => b.s.state.cards[id].cardId === "CDROPR929")!;
    const r = drive(b, (_s, w) => (w.window === "play" && !w.landed ? drop : w.window === "counter" && w.player === seat ? stop : null));
    assert.deepEqual(r.windows.map((w) => [w.player, w.window, w.landed]), [[foe, "play", false], [seat, "counter", false]],
      `${tag}/chain: the play window, then the [Counter: Counter] window for the Union's player; the opponent has nothing left, so no further window`);
    assert.deepEqual(r.windows[1].candidates, [stop]);
    landed(b, r, `${tag}/chain-negated`);
    assert.ok(zone(r.s, foe, "drop").includes(drop) && zone(r.s, seat, "drop").includes(stop), `${tag}/chain: both counters in their owners' Drop`);
    const ev = events.slice(r.since);
    const iStop = ev.findIndex((e) => e.type === "skill" && e.card === stop), iLand = ev.findIndex((e) => e.type === "move" && e.card === b.played && e.to === "battle");
    assert.ok(iStop >= 0 && iLand > iStop, `${tag}/chain: the negation resolves before the play lands`);
    assert.ok(!ev.some((e) => e.type === "move" && e.card === b.played && e.to === "drop"), `${tag}/chain: the negated counter never dropped the card`);
    cases.push(`${tag}/chain-negated`); }

  // 5. The same chain one deeper: the opponent answers the negation with its own [Counter: Counter]. Last-first:
  //    the opponent's negation, so the Union player's negation never resolves, so the [Counter: Play] does —
  //    the card goes to the Drop, with every cost of the play and of all three counters still paid.
  { const b = board(rec, seat, ["CDROPR929", "STOPR929"], ["STOPR929"]);
    const foeEnergy = stage(b.s, foe, "ER929", "energy");
    const stop = zone(b.s, seat, "hand").find((id) => b.s.state.cards[id].cardId === "STOPR929")!;
    const drop = zone(b.s, foe, "hand").find((id) => b.s.state.cards[id].cardId === "CDROPR929")!;
    const back = zone(b.s, foe, "hand").find((id) => b.s.state.cards[id].cardId === "STOPR929")!;
    const r = drive(b, (_s, w) => (w.window === "play" && !w.landed ? drop : w.window === "counter" ? (w.player === seat ? stop : back) : null));
    assert.deepEqual(r.windows.map((w) => [w.player, w.window]), [[foe, "play"], [seat, "counter"], [foe, "counter"]],
      `${tag}/chain3: answers alternate, one per window, and end when the next player has nothing`);
    failed(b, r, "drop", `${tag}/chain3`);
    assert.ok([drop, back].every((id) => zone(r.s, foe, "drop").includes(id)) && zone(r.s, seat, "drop").includes(stop), `${tag}/chain3: all three counters spent`);
    assert.equal(r.s.state.cards[foeEnergy].mode, "rest", `${tag}/chain3: the opponent's [Counter: Counter] price stays paid`);
    const ev = events.slice(r.since);
    const iBack = ev.findIndex((e) => e.type === "skill" && e.card === back), iDrop = ev.findIndex((e) => e.type === "move" && e.card === b.played && e.to === "drop");
    assert.ok(iBack >= 0 && iDrop > iBack, `${tag}/chain3: the last answer resolves first, the [Counter: Play] last`);
    cases.push(`${tag}/chain-reinstated`); }
}
assert.equal(cases.length, 2 * (5 * 6 + 2));
console.log(`union-counter-records-929: ${cases.length} both-seat cases on the applied Union records (BT3-070, BT2-012, BT11-013, P-360 grant, BT6-012, BT6-013): windows, Deflect, returned/dropped replacement, Union Counter:Counter chains, costs paid, no false arrival, reload-stable`);

/**
 * The prohibition catalog, batch 6 (20-14, 20-14-1, 22-5-7) — the same `forbid`
 * machinery as `prohibition-catalog.ts` … `prohibition-catalog-5.ts`:
 *
 * - owner ruling of 26 Oct 2026 (the batch 5 follow-up): a keyword that plays
 *   its own card under a play tax is judged on the board its whole own price
 *   leaves — [Revive]'s colour cards and [Union-Fusion]'s materials out of the
 *   hand, not only its energy. BT6-023's hand tax that those cards would leave
 *   unpayable means the keyword is not offered (or [Revive] not asked); a tax
 *   still payable after them is asked by the `play` op, and declining it is a
 *   failed play (22-5-7).
 *
 * Part 1 reads one printed card per group (and the reading text); part 2 plays
 * the actions on the VM from **both seats**, with a JSON reload of the state
 * between steps.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. readings ──────────────────────────────────────────────────────────────

const compact = (_k: string, v: unknown) => (v === null || v === false || (Array.isArray(v) && v.length === 0) ? undefined : v);
function record(text: string, index = 0, id = "X") {
  const rec = skillRecords({ ...DEFS.V1, id, skill: text } as CardDef)[index];
  assert.deepEqual(rec.unread, [], `reads whole: ${text}`);
  return rec;
}
const ops = (text: string, index = 0): Op[] => (JSON.parse(JSON.stringify({ ops: record(text, index).ops }, compact)) as { ops?: Op[] }).ops ?? [];
const reads = (text: string, index = 0): string => record(text, index).reads;
function forbids(list: Op[]): Extract<Op, { op: "forbid" }>[] {
  const out: Extract<Op, { op: "forbid" }>[] = [];
  for (const o of list) {
    if (o.op === "forbid") out.push(o);
    if (o.op === "if") out.push(...forbids(o.then), ...forbids(o.else ?? []));
    if (o.op === "chooseMode") for (const mode of (o as { modes: { ops: Op[] }[] }).modes) out.push(...forbids(mode.ops));
  }
  return out;
}
void ops; void reads; void forbids;

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const HAND_TAX = "[Permanent] Your opponent can't play Battle Cards with 20000 power or less unless they choose 3 cards from their hand and place them in their Drop Area as an additional cost.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  HAND_TAX: C("HAND_TAX", { power: 40000, skill: HAND_TAX }),
  REV: C("REV", { power: 10000, colors: ["Green"], skill: "[Revive red/blue]" }),
  RED: C("RED", { colors: ["Red"] }),
  BLUE: C("BLUE", { colors: ["Blue"] }),
  REDBLUE: C("REDBLUE", { colors: ["Red", "Blue"] }),
  YELLOW: C("YELLOW", { colors: ["Yellow"] }),
  PLAIN: C("PLAIN", { power: 30000 }),
  FUS: C("FUS", { power: 20000, energyCost: 1, characters: ["Gogeta: Br"], skill: "[Union-Fusion]{r}: <Son Goku: Br> and <Vegeta: Br>." }),
  BIG_FUS: C("BIG_FUS", { power: 40000, energyCost: 1, characters: ["Gogeta: Br"], skill: "[Union-Fusion]{r}: <Son Goku: Br> and <Vegeta: Br>." }),
  GOKU: C("GOKU", { power: 10000, characters: ["Son Goku: Br"] }),
  VEGETA: C("VEGETA", { power: 10000, characters: ["Vegeta: Br"] }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
// A bare keyword line ([Revive]) has no rule row of its own; the compiler's scripts stand in for it.
const fromRows = rulesFromRows(JSON.parse(JSON.stringify(rows)), defs);
const compiled = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts: new Proxy(fromRows, { get: (base, key) => (typeof key === "string" ? base[key] ?? compiled[key] : undefined) }) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, roundtrip(s), action).state as VmState;
const SEATS: PlayerId[] = ["p1", "p2"];

/** A game at the Main Phase of `turn` (p1's third turn, or p2's after it). */
function game3(turn: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 2017, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const steps: Action[] = [
    { type: "chooseFirst", player: s.chooser, first: "p1" } as Action,
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[];
  for (const a of steps) s = take(s, a);
  if (turn === "p2") s = endTurn(s);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, turn);
  return roundtrip(s);
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = mode;
  return id;
}
/** Answer every prompt up to the next Main Phase; `mode` answers a "choose one" (0 = pay / do it; -1 stops there). */
function settle(s: VmState, pick: string[] = [], mode = 0, stop: (s: VmState) => boolean = () => false): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main" && s.prompt.kind !== "gameOver" && !stop(s); i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      const want = q.choice.candidates.filter((c) => pick.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: want.length ? want.slice(0, q.choice.max ?? want.length) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "chooseMode") {
      if (mode < 0) break;
      s = take(s, { type: "chooseMode", player: q.player, index: mode } as Action);
    }
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "charge") s = take(s, { type: "charge", player: q.player, card: null });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  return s;
}
function endTurn(s: VmState): VmState {
  const p = (s.prompt as { player: PlayerId }).player;
  return settle(take(s, { type: "endMain", player: p }));
}
const activations = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === id);
const zoneOf = (s: VmState, id: string) => (["p1", "p2"] as PlayerId[]).flatMap((p) => Object.entries(s.sides[p].zones).filter(([, ids]) => ids.includes(id)).map(([z]) => z))[0];
/** Empty a pile into the Drop Area down to `keep` cards (a state fixture, not a game action). */
function empty(s: VmState, p: PlayerId, zone: string, keep = 0): void {
  for (const id of s.sides[p].zones[zone].slice(keep)) assert.ok(moveCard(s, game, id, "drop", { owner: p }).ok);
}

for (const me of SEATS) {
  const you = other(me);

  // 1 (owner ruling, the batch 5 follow-up): [Revive] under BT6-023's hand tax
  // is judged once its colour cards have left the hand. Hand of RED, BLUE and
  // `extra` more: the colours take two, the tax three more. With 3 extra it is
  // asked; with 2 it is not (it was before the ruling: 4 cards in hand); with a
  // Red/Blue card paying both colours alone, the same four cards in hand are enough (control).
  for (const [label, colours, extra, asked] of [["two colour cards, 3 more", ["RED", "BLUE"], 3, true], ["two colour cards, 2 more", ["RED", "BLUE"], 2, false], ["one Red/Blue card, 3 more", ["REDBLUE"], 3, true]] as const) {
    let s = game3(you);
    stage(s, you, "HAND_TAX", "battle");
    const rev = stage(s, me, "REV", "battle", "rest");
    empty(s, me, "hand");
    const paid = colours.map((c) => stage(s, me, c, "hand"));
    const rest = Array.from({ length: extra }, () => stage(s, me, "YELLOW", "hand"));
    s = roundtrip(s);
    const hand = s.sides[me].zones.hand.length;
    s = take(s, { type: "attack", player: you, attacker: stage(s, you, "PLAIN", "battle"), target: rev });
    const reviveAsked = (t: VmState) => t.prompt.kind === "chooseCards" && /Revive/.test(t.prompt.choice.reason ?? "");
    s = roundtrip(settle(s, [], 0, reviveAsked));
    assert.equal(zoneOf(s, rev), "drop", `${me}: the Revive card is KO'd`);
    assert.equal(reviveAsked(s), asked, `${me}: [Revive] ${asked ? "is" : "is not"} asked — ${label}`);
    if (!asked) {
      assert.equal(s.sides[me].zones.hand.length, hand, `${me}: no hand card dropped (${label})`);
      continue;
    }
    // Paid: the colours, then the tax's three, and the card is back.
    const taxAsked = (t: VmState) => t.prompt.kind === "chooseMode";
    const atTax = roundtrip(settle(s, paid, 0, taxAsked));
    assert.ok(taxAsked(atTax), `${me}: the play asks the tax once the colours are paid (${label})`);
    for (const id of paid) assert.equal(zoneOf(atTax, id), "drop", `${me}: the colour card is paid`);
    const yes = roundtrip(settle(atTax, rest, 0));
    assert.equal(zoneOf(yes, rev), "battle", `${me}: tax paid — revived (${label})`);
    for (const id of rest.slice(0, 3)) assert.equal(zoneOf(yes, id), "drop", `${me}: the tax's three hand cards are paid`);
    // Declined (22-5-7): no play, and the colours stay paid.
    const no = roundtrip(settle(atTax, [], 1));
    assert.equal(zoneOf(no, rev), "drop", `${me}: tax declined — a failed play, the card stays in the Drop (${label})`);
    for (const id of paid) assert.equal(zoneOf(no, id), "drop", `${me}: the colours stay paid`);
    for (const id of rest) assert.equal(zoneOf(no, id), "hand", `${me}: nothing of the tax is paid`);
  }

  // 2: [Union-Fusion] under the same tax is judged once its two materials have
  // left the hand. Hand of the Fusion card, its two materials and `extra` more.
  {
    for (const [extra, offered] of [[3, true], [2, false]] as const) {
      const s = game3(me);
      stage(s, you, "HAND_TAX", "battle");
      empty(s, me, "hand");
      const fus = stage(s, me, "FUS", "hand");
      const goku = stage(s, me, "GOKU", "hand");
      const vegeta = stage(s, me, "VEGETA", "hand");
      const rest = Array.from({ length: extra }, () => stage(s, me, "YELLOW", "hand"));
      for (let i = 0; i < 2; i++) stage(s, me, "V1", "energy");
      const r = roundtrip(s);
      assert.equal(activations(r, fus).length, offered ? 1 : 0, `${me}: [Union-Fusion] ${offered ? "is" : "is not"} offered with ${extra} cards beside its materials`);
      if (!offered) {
        const big = roundtrip(r);
        big.cards[fus].cardId = "BIG_FUS";
        assert.equal(activations(roundtrip(big), fus).length, 1, `${me}: an untaxed [Union-Fusion] is offered on that hand (control)`);
        continue;
      }
      const taxAsked = (t: VmState) => t.prompt.kind === "chooseMode";
      const atTax = roundtrip(settle(take(r, activations(r, fus)[0].action), [goku, vegeta], 0, taxAsked));
      assert.ok(taxAsked(atTax), `${me}: the Fusion's play asks the tax`);
      assert.deepEqual([zoneOf(atTax, goku), zoneOf(atTax, vegeta)], ["drop", "drop"], `${me}: the materials are paid first`);
      const yes = roundtrip(settle(atTax, rest, 0));
      assert.equal(zoneOf(yes, fus), "battle", `${me}: tax paid — the Fusion is played`);
      const no = roundtrip(settle(atTax, [], 1));
      assert.equal(zoneOf(no, fus), "drop", `${me}: declined — a failed play, the card in the Drop (22-13-4-5-1)`);
      for (const id of rest) assert.equal(zoneOf(no, id), "hand", `${me}: nothing of the tax is paid`);
    }
  }
}
console.log("prohibition catalog 6: owner ruling (a keyword play's tax judged after its own hand costs — [Revive]'s colours, [Union-Fusion]'s materials) — enforced from both seats");

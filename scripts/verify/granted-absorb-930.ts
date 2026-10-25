/**
 * #930, BT30-064 (Absorption) front #0 and #10: a [Union-Absorb] granted in
 * quotation marks.
 *
 *   [Activate: Main] Choose up to 1 of your green <Majin Buu> cards with an
 *   energy cost of 4 and it gains the following skill for the turn—
 *   "[Union Absorb][Once per turn] If your opponent has 2 or more energy,
 *   choose 1 Battle Card in your Drop or your opponent's Battle Area and place
 *   it under this card: Play up to 1 green <Majin Buu> card with an energy cost
 *   of 6 from your deck or Drop on top of this card in Active Mode, then
 *   shuffle your deck."
 *
 * Owner-accepted default of the 25 Oct 2026 triage on #930: the granted Absorb
 * lasts until the end of the turn, is usable once per turn counted on the host
 * card, and carries a typed grant (as P-360's granted Fusion does): the quoted
 * row #10 is the Absorb's own record — `cost.absorb` v1, the typed price
 * program and the effect program — and #0 grants exactly that row to the
 * chosen card (#1166's `copySkills(quoted)`), so nothing is read off the text
 * at game time.
 *
 * The price's "in your Drop or your opponent's Battle Area" names an owner per
 * area (`areaSides`): before, the possessive nearest the second area took both
 * and the price chose from the opponent's Drop.
 *
 * Proof: the printed text → stored rows → JSON → `rulesFromRows` → the VM, both
 * seats, the state reloaded from JSON after every action. Source:
 * docs/rules/rulemanual.txt 22-13-6 (Union-Absorb), 22-11 (Once per turn),
 * 20-18 (gaining skills); printed text from
 * docs/rules-audit-2026-10-15/audit.json.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { recordContractGaps, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { isCopiedSkill } from "../../src/lib/arena/vm/common";
import { describeScript, type Op } from "../../src/lib/arena/vm/script";
import { deepEqual, parseRule, printRule, printSelector, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── the printed text (audit.json, BT30-064 front #0 and #10) ────────────────
const BT30_064_0 = "[activate: main] Choose up to 1 of your green <Majin Buu> cards with an energy cost of 4 and it gains the following skill for the turn—";
const BT30_064_10 = "\"[union absorb][once per turn] If your opponent has 2 or more energy, choose 1 Battle Card in your Drop or your opponent's Battle Area and place it under this card: Play up to 1 green <Majin Buu> card with an energy cost of 6 from your deck or Drop on top of this card in Active Mode, then shuffle your deck.\"";

const buu = (id: string, energyCost: number, power: number, o: Partial<CardDef> = {}): CardDef =>
  card(id, { colors: ["Green"], characters: ["Majin Buu"], energyCost, power, skill: null, ...o });
const defs: Record<string, CardDef> = { ...DEFS,
  "BT30-064": card("BT30-064", { type: "EXTRA", name: "Absorption", colors: ["Green"], energyCost: 0, power: null, comboCost: null, comboPower: null, characters: [], skill: `${BT30_064_0}\n${BT30_064_10}` }),
  "L-GREEN": card("L-GREEN", { type: "LEADER", colors: ["Green"], energyCost: null, comboCost: null, comboPower: null }),
  HOST: buu("HOST", 4, 15000),
  HOST2: buu("HOST2", 4, 15000),
  BUU5: buu("BUU5", 5, 20000),
  BUU6: buu("BUU6", 6, 25000),
  BUU6RED: buu("BUU6RED", 6, 25000, { colors: ["Red"] }),
  MAT: card("MAT", { colors: ["Red"], power: 5000 }),
  MATX: card("MATX", { type: "EXTRA", colors: ["Red"], power: null, comboCost: null, comboPower: null }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

function opsDeep(node: unknown, out: Op[] = []): Op[] {
  if (Array.isArray(node)) for (const x of node) opsDeep(x, out);
  else if (node && typeof node === "object") {
    if (typeof (node as { op?: unknown }).op === "string") out.push(node as Op);
    for (const v of Object.values(node)) opsDeep(v, out);
  }
  return out;
}
const rowOf = (skillIndex: number) => {
  const row = rows.find((r) => r.cardId === "BT30-064" && r.skillIndex === skillIndex);
  assert.ok(row, `BT30-064#${skillIndex}: a stored row`);
  const back = roundtrip(row);
  assert.deepEqual(recordContractGaps(back), [], `BT30-064#${skillIndex}: the stored row needs no rebuild`);
  assert.deepEqual(runtimeSupportOfRow(back).unsupported, [], `BT30-064#${skillIndex}: the stored row is runnable`);
  return back as RuleRow & { ops: Op[]; unread: string[]; reads: string; kind: string; cost: { program: Op[] | null; condition: unknown; absorb?: unknown } | null; usage: { oncePerTurn: boolean; limit: number | null } };
};

// ── 1. the records ───────────────────────────────────────────────────────────
{
  const r0 = rowOf(0);
  assert.equal(r0.kind, "activate:main");
  assert.deepEqual(r0.unread, [], "BT30-064#0 is read whole");
  assert.deepEqual(r0.ops.map((o) => o.op), ["choose", "copySkills"], "choose the card, then it gains line #10");
  const pick = r0.ops[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([pick.sel.side, pick.sel.area, pick.sel.count, pick.sel.upTo, pick.sel.filter?.colors, pick.sel.filter?.characters, pick.sel.filter?.costMin, pick.sel.filter?.costMax], ["you", "play", 1, true, ["Green"], ["Majin Buu"], 4, 4], "up to 1 of your green <Majin Buu> cards with an energy cost of 4");
  const copy = r0.ops[1] as Extract<Op, { op: "copySkills" }>;
  assert.deepEqual([copy.quoted, copy.skill, copy.until, JSON.stringify(copy.target), JSON.stringify(copy.from)], [true, 10, "turn", JSON.stringify({ var: pick.as }), JSON.stringify({ sel: { special: "self" } })], "the chosen card gains this card's quoted line #10 for the turn");
  assert.match(r0.reads, /gains this card's quoted skill \(line 2\) for the turn$/);

  const r10 = rowOf(10);
  assert.equal(r10.printed, BT30_064_10, "the row keeps the printed, quoted line");
  assert.equal(r10.kind, "keyword", "recorded as the [Union-Absorb] it quotes");
  assert.deepEqual(r10.unread, [], "BT30-064#10 is read whole: nothing unread");
  assert.deepEqual([r10.usage.oncePerTurn, r10.usage.limit], [true, null], "[Once per turn]");
  assert.deepEqual(r10.cost?.absorb, { version: 1, variant: "Absorb", area: "battle" }, "typed Union-Absorb identity, used from the Battle Area");
  assert.deepEqual(r10.cost?.condition, { kind: "count", sel: { side: "opponent", area: "energy" }, atLeast: 2 }, "if your opponent has 2 or more energy");
  const price = r10.cost?.program ?? [];
  assert.deepEqual(price.map((o) => o.op), ["choose", "moveTo"], "the price chooses and places under");
  const mat = price[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([mat.sel.side, mat.sel.areas, mat.sel.areaSides, mat.sel.filter?.type, mat.sel.count, mat.sel.upTo], [undefined, ["drop", "battle"], ["you", "opponent"], "BATTLE", 1, false], "1 Battle Card in YOUR Drop or YOUR OPPONENT'S Battle Area");
  assert.deepEqual(price[1], { op: "moveTo", target: { var: mat.as }, to: "under" }, "placed under this card");
  assert.equal(describeScript(price), "choose 1 Battle Card in your Drop Area or in your opponent's Battle Area, move the chosen cards to under");
  assert.deepEqual(r10.ops.map((o) => o.op), ["choose", "play", "shuffle"], "search, play on top, shuffle");
  const search = r10.ops[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([search.sel.side, search.sel.areas, search.sel.filter?.colors, search.sel.filter?.costMin, search.sel.filter?.costMax, search.sel.upTo], ["you", ["deck", "drop"], ["Green"], 6, 6, true], "up to 1 green <Majin Buu> of cost 6 from your deck or Drop");
  const play = r10.ops[1] as Extract<Op, { op: "play" }>;
  assert.deepEqual([JSON.stringify(play.target), JSON.stringify(play.onto), play.mode, play.using, play.counterWindow], [JSON.stringify({ var: search.as }), JSON.stringify({ sel: { special: "self" } }), "active", "Union-Absorb", true], "played on top of this card in Active Mode, as the Absorb's own play");
  assert.match(r10.reads, /^granted by skill #0, not this card's own: /);

  // The rules language says the owner per area and reads it back.
  const rule = { kind: "keyword", trigger: [], cost: null, cond: null, ops: price } as unknown as Rule;
  const text = printRule(rule);
  assert.match(text, /IN you\.drop\|opponent\.battle/, "printed as an owner per area");
  const back = parseRule(text);
  assert.ok(back.ok, `the printed price parses: ${text}`);
  assert.ok(back.ok && deepEqual(back.value, rule), "and comes back the same");
  assert.equal(printSelector({ areas: ["drop", "battle"], areaSides: ["you", "opponent"], count: 1 }), "1 IN you.drop|opponent.battle");

  // A quoted keyword other than [Union-Absorb] stays refused (#1166).
  const other = skillRecords(card("X", { type: "EXTRA", skill: "[activate: main] Choose up to 1 of your Battle Cards and it gains the following skill for the turn—\n\"[evolve]{2}: <Majin Buu>\"" }));
  assert.ok(other[0].unread.length > 0 && other[1].unread.length > 0, "a quoted [Evolve] is still not granted");
}

// ── 2. the VM, both seats ───────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
/** `p` in its second Main Phase; the opponent has `foeEnergy` energy. */
function fresh(p: PlayerId, seed: number, foeEnergy = 2): VmState {
  const o: PlayerId = p === "p1" ? "p2" : "p1";
  const decks = { [p]: { name: "Me", leader: "L-GREEN", main: fifty("V1") }, [o]: { name: "Foe", leader: "L-BLUE", main: fifty("V-BLUE") } } as Record<PlayerId, { name: string; leader: string; main: string[] }>;
  let s = RULES.createGame(ctx, { seed, p1: decks.p1, p2: decks.p2 }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: p },
    { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: o, redraw: false },
    { type: "charge", player: p, card: null }, { type: "endMain", player: p }, { type: "charge", player: o, card: null },
    { type: "endMain", player: o }, { type: "charge", player: p, card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  for (const side of [p, o] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[side].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: side }).ok);
  for (let i = 0; i < foeEnergy; i++) { const e = stage(s, o, "V-BLUE", "energy"); s.cards[e].mode = "active"; }
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
const grantsOn = (s: VmState, id: string) => s.effects.filter((e) => e.kind === "copiedSkills" && e.target === id && e.copied?.quoted);
const absorbOffer = (s: VmState, id: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === id && isCopiedSkill((l.action as { skill?: number }).skill ?? -1));
const extraOffer = (s: VmState, id: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === id);

/** Play BT30-064 from the hand, choosing `host` (or nothing). */
function grant(s: VmState, p: PlayerId, ex: string, host: string | null): VmState {
  const o = extraOffer(s, ex);
  assert.ok(o, `${p}: BT30-064 is offered`);
  s = take(s, o.action);
  for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[] } };
    if (q.kind === "chooseCards") {
      if (host) assert.ok(q.choice!.candidates.includes(host), `${p}: the host is a candidate of BT30-064's choice`);
      s = take(s, { type: "choose", player: q.player, cards: host ? [host] : [] });
    } else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else s = take(s, { type: "pass", player: q.player } as Action);
  }
  assert.equal(s.prompt.kind, "main", `${p}: back in the Main Phase after BT30-064`);
  return s;
}
/** Use the granted Absorb on `host`, paying with `material`, then take `found` (or nothing) from the search. */
function absorb(s: VmState, p: PlayerId, host: string, material: string, found: string | null): { s: VmState; materials: string[] | null; searched: string[] | null } {
  const o = absorbOffer(s, host);
  assert.ok(o, `${p}: the granted Absorb is offered on the host`);
  s = take(s, o.action);
  let materials: string[] | null = null, searched: string[] | null = null;
  for (let i = 0; i < 30 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[] } };
    if (q.kind === "chooseCards" && materials === null) {
      materials = q.choice!.candidates.slice();
      s = take(s, { type: "choose", player: q.player, cards: [material] });
    } else if (q.kind === "chooseCards") {
      searched = q.choice!.candidates.slice();
      s = take(s, { type: "choose", player: q.player, cards: found ? [found] : [] });
    } else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else s = take(s, { type: "pass", player: q.player } as Action);
  }
  assert.equal(s.prompt.kind, "main", `${p}: back in the Main Phase after the Absorb`);
  return { s, materials, searched };
}

let seed = 9300;
for (const p of ["p1", "p2"] as PlayerId[]) {
  const o: PlayerId = p === "p1" ? "p2" : "p1";
  const board = (foeEnergy = 2) => {
    const s = fresh(p, seed++, foeEnergy);
    const ex = stage(s, p, "BT30-064", "hand");
    const host = stage(s, p, "HOST", "battle");
    const other = stage(s, p, "HOST2", "battle");
    const myDrop = stage(s, p, "MAT", "drop");
    const myDropExtra = stage(s, p, "MATX", "drop");
    const myBattle = stage(s, p, "MAT", "battle");
    const theirBattle = stage(s, o, "MAT", "battle");
    const theirDrop = stage(s, o, "MAT", "drop");
    const target = stage(s, p, "BUU6", "drop");
    const wrongCost = stage(s, p, "BUU5", "drop");
    const wrongColour = stage(s, p, "BUU6RED", "drop");
    const inDeck = s.sides[p].zones.deck[0]; s.cards[inDeck].cardId = "BUU6";
    return { s, ex, host, other, myDrop, myDropExtra, myBattle, theirBattle, theirDrop, target, wrongCost, wrongColour, inDeck };
  };

  // 1. Before the grant: no Absorb on the host. After it: on the host only, for the turn; the Extra never has it.
  {
    const b = board();
    assert.equal(absorbOffer(b.s, b.host), undefined, `${p}: no Absorb before the grant`);
    const s = grant(b.s, p, b.ex, b.host);
    assert.ok(s.sides[p].zones.drop.includes(b.ex), `${p}: BT30-064 resolved to the Drop`);
    assert.equal(grantsOn(s, b.host).length, 1, `${p}: the chosen card gains the quoted skill`);
    assert.equal(grantsOn(s, b.host)[0].until, "turn", `${p}: for the turn`);
    const granted = skillsShowing(ctx, s, b.host).skills.filter((sk) => isCopiedSkill(sk.index));
    assert.deepEqual(granted.map((sk) => [sk.kind, sk.keyword?.name, (sk.keyword as { variant?: string } | null)?.variant, sk.oncePerTurn]), [["keyword", "Union", "Absorb", true]], `${p}: the host holds the [Union-Absorb][Once per turn] itself`);
    assert.ok(absorbOffer(s, b.host), `${p}: the Absorb is offered on the host`);
    assert.equal(absorbOffer(s, b.other), undefined, `${p}: and not on the other <Majin Buu>`);
    assert.equal(skillsShowing(ctx, s, b.ex).skills.some((sk) => sk.keyword?.name === "Union"), false, `${p}: BT30-064 itself never has it`);
  }

  // 2. The Absorb resolves: the price offers a Battle Card in your Drop or your opponent's Battle Area only;
  //    the card under is placed; a green <Majin Buu> of cost 6 from the deck or Drop is played on top, in Active Mode; the deck shuffled.
  for (const from of ["mine", "theirs"] as const) {
    const b = board();
    let s = grant(b.s, p, b.ex, b.host);
    const material = from === "mine" ? b.myDrop : b.theirBattle;
    const r = absorb(s, p, b.host, material, b.target);
    s = r.s;
    assert.deepEqual(new Set(r.materials), new Set([b.myDrop, b.theirBattle, b.target, b.wrongCost, b.wrongColour]), `${p}: the price offers Battle Cards in your Drop and your opponent's Battle Area — never your Battle Area, their Drop or an Extra`);
    assert.deepEqual(new Set(r.searched), new Set([b.target, b.inDeck]), `${p}: the search finds the green cost-6 <Majin Buu> in the deck and the Drop, nothing else`);
    assert.ok(s.sides[p].zones.battle.includes(b.target), `${p}: the <Majin Buu> is played`);
    assert.equal(s.cards[b.target].mode, "active", `${p}: in Active Mode`);
    assert.ok(s.cards[b.target].under.includes(b.host), `${p}: on top of the host`);
    assert.ok(s.cards[b.target].under.includes(material), `${p}: with the material (${from}) under the pile`);
    assert.ok(!s.sides[p].zones.battle.includes(b.host), `${p}: the host left the Battle Area for the pile`);
    if (from === "theirs") assert.ok(!s.sides[o].zones.battle.includes(b.theirBattle), `${p}: the opponent's Battle Card left their Battle Area`);
  }

  // 3. Once per turn, counted on the host: declining the play leaves the host in the Battle Area, and it cannot use the Absorb again —
  //    not even after a second BT30-064 grants it again the same turn.
  {
    const b = board();
    const ex2 = stage(b.s, p, "BT30-064", "hand");
    let s = grant(b.s, p, b.ex, b.host);
    s = absorb(s, p, b.host, b.myDrop, null).s;
    assert.ok(s.sides[p].zones.battle.includes(b.host), `${p}: declined, the host stays`);
    assert.ok(s.cards[b.host].under.includes(b.myDrop), `${p}: the price stays paid`);
    assert.equal(absorbOffer(s, b.host), undefined, `${p}: used once, the Absorb is not offered again this turn`);
    s = grant(s, p, ex2, b.host);
    assert.equal(grantsOn(s, b.host).length, 2, `${p}: granted a second time`);
    assert.equal(absorbOffer(s, b.host), undefined, `${p}: still once per turn on the host`);
    // Another card granted it the same turn has a use of its own (22-11-3).
    const ex3 = stage(s, p, "BT30-064", "hand");
    s = grant(s, p, ex3, b.other);
    assert.ok(absorbOffer(s, b.other), `${p}: the other <Majin Buu>, granted it for the first time, may use it`);
  }

  // 4. Gone next turn: the grant ends with the turn, and on the master's next Main Phase it is not offered.
  {
    const b = board();
    let s = grant(b.s, p, b.ex, b.host);
    s = take(s, { type: "endMain", player: p });
    for (let i = 0; i < 20 && !(s.prompt.kind === "charge" && (s.prompt as { player: PlayerId }).player === o); i++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player } as Action);
    assert.equal(grantsOn(s, b.host).length, 0, `${p}: the grant ended with the turn`);
    s = take(s, { type: "charge", player: o, card: null });
    s = take(s, { type: "endMain", player: o });
    for (let i = 0; i < 20 && !(s.prompt.kind === "charge" && (s.prompt as { player: PlayerId }).player === p); i++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player } as Action);
    s = take(s, { type: "charge", player: p, card: null });
    assert.equal(s.prompt.kind, "main");
    assert.ok(s.sides[p].zones.battle.includes(b.host), `${p}: the host is still in play`);
    assert.equal(skillsShowing(ctx, s, b.host).skills.some((sk) => isCopiedSkill(sk.index)), false, `${p}: the host no longer has the skill`);
    assert.equal(absorbOffer(s, b.host), undefined, `${p}: and it is not offered`);
  }

  // 5. The price's condition: with only 1 opponent energy the Absorb is not offered.
  {
    const b = board(1);
    const s = grant(b.s, p, b.ex, b.host);
    assert.equal(grantsOn(s, b.host).length, 1);
    assert.equal(absorbOffer(s, b.host), undefined, `${p}: opponent with 1 energy — not offered`);
  }
}

console.log("granted-absorb-930: BT30-064 grants its quoted [Union-Absorb][Once per turn] to the chosen green cost-4 <Majin Buu> for the turn — offered on the host only, once per turn on the host, gone next turn; the price takes a Battle Card from your Drop or your opponent's Battle Area and the play lands on top in Active Mode; both seats, stored rows, JSON reload");

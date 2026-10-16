/**
 * #938 / #939: a choice made inside an optional placement does not take over
 * the host reference, and a token play can name the tokens it made.
 *
 * BT31-139 Absorb and Power Up and BT31-141 Cell Jr. Summon. The card texts
 * below are the public wording as the issues quote it (BT31-141's is verbatim,
 * BT31-139's is the same sentences in this app's usual spelling); each is
 * compiled, written out as a stored rule row, read back with JSON, and played
 * on the real VM, on both seats.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, parseFilter } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const ABSORB =
  "[Activate: Main] Draw 1 card, then choose 1 of your white ≪Cell≫ Battle Cards. You may place 1 ≪Android≫ card from your Drop Area under the chosen card. If you do, play up to 1 white ≪Cell≫ card with an energy cost of 4 or less from your Drop Area on top of the originally chosen card in Active Mode.";
const SUMMON =
  "[Activate: Main/Battle] Play 2 Cell Jr. Tokens and they gain [Blocker] for the turn. (Cell Jr. Tokens have 10000 power, 0 combo cost, and 5000 combo power.)";

const cell = (id: string, o: Partial<CardDef> = {}): CardDef => card(id, { colors: ["White"], traits: ["Cell"], energyCost: 3, skill: null, ...o });
const extra = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", colors: ["White"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  ABSORB938: extra("ABSORB938", ABSORB),
  SUMMON939: extra("SUMMON939", SUMMON),
  HOSTA938: cell("HOSTA938", { name: "Host A" }),
  HOSTB938: cell("HOSTB938", { name: "Host B" }),
  REDCELL938: cell("REDCELL938", { colors: ["Red"] }),
  WHITEOTHER938: cell("WHITEOTHER938", { traits: ["Saiyan"] }),
  DROID938: card("DROID938", { colors: ["White"], traits: ["Android"], energyCost: 2, skill: null }),
  DROIDB938: card("DROIDB938", { colors: ["Red"], traits: ["Android"], energyCost: 2, skill: null }),
  NODROID938: card("NODROID938", { colors: ["White"], traits: ["Saiyan"], energyCost: 2, skill: null }),
  NEWA938: cell("NEWA938", { energyCost: 4, power: 20000 }),
  NEWB938: cell("NEWB938", { energyCost: 2, power: 15000 }),
  BIGCELL938: cell("BIGCELL938", { energyCost: 5 }),
  REDNEW938: cell("REDNEW938", { colors: ["Red"], energyCost: 2 }),
  OTHERNEW938: cell("OTHERNEW938", { traits: ["Saiyan"], energyCost: 2 }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
// Drafted records, written out and read back: the production row path.
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = withTokens({ ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) });
const apply = (s: VmState, a: Action): VmState => RULES.apply(ctx, roundtrip(s), a).state as VmState;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** A fresh Main Phase for `seat`. */
function board(seed: number, seat: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const step = (a: Action) => { s = apply(s, a); };
  step({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) step({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  if (seat === "p2") { step({ type: "endMain", player: "p1" }); step({ type: "charge", player: "p2", card: null }); }
  assert.equal(s.turnPlayer, seat);
  assert.equal(s.prompt.kind, "main");
  return s;
}
type Area = "battle" | "drop" | "hand";
function stage(s: VmState, p: PlayerId, def: string, area: Area): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id);
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
function stepProgram(s: VmState, ops: Op[], p: PlayerId, vars: Record<string, string[]> = {}): ScriptFrame {
  const frame = { ops, ip: 0, vars: { ...vars }, card: s.sides[p].zones.leader[0], master: p } as unknown as ScriptFrame;
  stepScript(vmHost(ctx, game, s, []), frame);
  return frame;
}
const activation = (s: VmState, id: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
const choose = (s: VmState, p: PlayerId, cards: string[]): VmState => apply(s, { type: "choose", player: p, cards });
const mode = (s: VmState, p: PlayerId, index: number): VmState => apply(s, { type: "chooseMode", player: p, index });
const cands = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? [...s.prompt.choice.candidates].sort() : []);
const refuses = (s: VmState, a: Action, why: string): void => {
  const before = JSON.stringify(s);
  assert.throws(() => apply(s, a), IllegalAction, why);
  assert.equal(JSON.stringify(s), before, `${why}: refusal leaves the state alone`);
};

// ── #938 the reading: the stack goes on the card chosen first ──────────────
{
  const line = compileCard(defs.ABSORB938).bySkill[0];
  assert.deepEqual(line.unsupported, [], "BT31-139 reads whole");
  const play = JSON.stringify(line.ops.flatMap((o) => (o.op === "if" ? o.then : [o])).find((o) => o.op === "play"));
  assert.ok(play.includes('"onto":{"var":"c0"}'), `the new Cell goes onto the first choice, not the Android: ${play}`);
  // Every way the text can point back at the host reads the same, and none of them at the Android.
  for (const tail of ["the chosen card", "the originally chosen card", "that card", "it"]) {
    const l = compileCard({ ...defs.ABSORB938, skill: ABSORB.replace("the originally chosen card", tail) }).bySkill[0];
    assert.deepEqual(l.unsupported, [], tail);
    assert.ok(JSON.stringify(l.ops).includes('"onto":{"var":"c0"}'), `on top of ${tail}`);
  }
  // Without a nested placement nothing changes: the last choice is still the host.
  const plain = compileCard({ ...defs.ABSORB938, skill: "[Activate: Main] Choose 1 of your white ≪Cell≫ Battle Cards. Play up to 1 white ≪Cell≫ card from your Drop Area on top of the chosen card in Active Mode." }).bySkill[0];
  assert.deepEqual(plain.unsupported, []);
  assert.ok(JSON.stringify(plain.ops).includes('"onto":{"var":"c0"}'));
}

// ── #938 the VM, from stored rows, on both seats ───────────────────────────
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const fresh = (seed: number, opts: { droids?: boolean } = {}) => {
    const s = board(seed, seat);
    const t = {
      card: stage(s, seat, "ABSORB938", "hand"),
      hostA: stage(s, seat, "HOSTA938", "battle"), hostB: stage(s, seat, "HOSTB938", "battle"),
      red: stage(s, seat, "REDCELL938", "battle"), saiyan: stage(s, seat, "WHITEOTHER938", "battle"), foeCell: stage(s, foe, "HOSTA938", "battle"),
      droid: opts.droids === false ? "" : stage(s, seat, "DROID938", "drop"), droidB: opts.droids === false ? "" : stage(s, seat, "DROIDB938", "drop"),
      noDroid: stage(s, seat, "NODROID938", "drop"),
      newA: stage(s, seat, "NEWA938", "drop"), newB: stage(s, seat, "NEWB938", "drop"),
      big: stage(s, seat, "BIGCELL938", "drop"), redNew: stage(s, seat, "REDNEW938", "drop"), otherNew: stage(s, seat, "OTHERNEW938", "drop"),
    };
    return { s, t };
  };

  for (const pick of ["hostA", "hostB"] as const) for (const android of ["droid", "droidB"] as const) for (const play of ["newA", "newB"] as const) {
    const { s: s0, t } = fresh(938_000 + (seat === "p1" ? 0 : 100));
    const offer = activation(s0, t.card);
    assert.ok(offer, `${seat}: Absorb is offered`);
    const deck = s0.sides[seat].zones.deck.length;
    let s = apply(s0, offer.action);
    assert.deepEqual(cands(s), [t.hostA, t.hostB].sort(), "only your own white Cell Battle Cards");
    assert.equal(s.sides[seat].zones.deck.length, deck - 1, "the draw happened first");
    refuses(s, { type: "choose", player: seat, cards: [t.red] }, "wrong colour");
    refuses(s, { type: "choose", player: seat, cards: [t.saiyan] }, "wrong trait");
    refuses(s, { type: "choose", player: seat, cards: [t.foeCell] }, "the opponent's Cell");
    refuses(s, { type: "choose", player: foe, cards: [t[pick]] }, "wrong seat");
    s = choose(s, seat, [t[pick]]);
    assert.equal(s.prompt.kind, "chooseMode", "the placement is optional");
    s = mode(s, seat, 0);
    assert.deepEqual(cands(s), [t.droid, t.droidB].sort(), "Androids from your Drop, whatever their colour; not the Saiyan");
    refuses(s, { type: "choose", player: seat, cards: [t.noDroid] }, "wrong trait for the Android");
    refuses(s, { type: "choose", player: seat, cards: [t.newA] }, "a Cell is not an Android");
    s = choose(s, seat, [t[android]]);
    // Reload exactly here, before the replacement is picked: the host must survive the round trip.
    s = roundtrip(s);
    assert.deepEqual(cands(s), [t.newA, t.newB].sort(), "white Cells costing 4 or less in your Drop (not 5, not red, not a Saiyan)");
    for (const bad of [t.big, t.redNew, t.otherNew, t.droidB, t.hostA, t.hostB, t.foeCell]) refuses(s, { type: "choose", player: seat, cards: [bad] }, "ineligible replacement");
    refuses(s, { type: "choose", player: foe, cards: [t[play]] }, "wrong seat");
    s = choose(s, seat, [t[play]]);
    const z = s.sides[seat].zones;
    assert.ok(z.battle.includes(t[play]), "the new Cell is in play");
    assert.equal(s.cards[t[play]].mode, "active", "in Active Mode");
    assert.ok(!z.battle.includes(t[pick]), "the originally chosen Cell is covered, not left beside it");
    assert.ok(s.cards[t[play]].under.includes(t[pick]), "the original Cell lies under the new one (23-2)");
    assert.ok(!z.battle.includes(t[android]), "the Android is not a battle card");
    assert.ok(s.cards[t[play]].under.includes(t[android]) || s.cards[t[pick]].under.includes(t[android]), "the pile carries the Android");
    const unrelated = pick === "hostA" ? t.hostB : t.hostA;
    assert.ok(z.battle.includes(unrelated) && z.battle.includes(t.red) && z.battle.includes(t.saiyan), "unrelated hosts stay where they were");
    assert.ok(s.sides[foe].zones.battle.includes(t.foeCell), "the opponent's board is untouched");
    assert.ok(z.drop.includes(t[android === "droid" ? "droidB" : "droid"]), "the other Android stays in the Drop");
    assert.equal(s.prompt.kind, "main");
  }

  // Declining the optional placement plays nothing.
  {
    const { s: s0, t } = fresh(938_010);
    let s = choose(apply(s0, activation(s0, t.card)!.action), seat, [t.hostA]);
    s = mode(s, seat, 1);
    assert.equal(s.prompt.kind, "main", "the replacement is owed only if the Android was placed");
    assert.ok(s.sides[seat].zones.battle.includes(t.hostA) && s.sides[seat].zones.drop.includes(t.newA) && s.sides[seat].zones.drop.includes(t.droid));
  }
  // No Android in the Drop: nothing placed, nothing played.
  {
    const { s: s0, t } = fresh(938_020, { droids: false });
    let s = choose(apply(s0, activation(s0, t.card)!.action), seat, [t.hostA]);
    if (s.prompt.kind === "chooseMode") s = mode(s, seat, 0);
    if (s.prompt.kind === "chooseCards") s = choose(s, seat, []);
    assert.equal(s.prompt.kind, "main");
    assert.ok(s.sides[seat].zones.battle.includes(t.hostA) && s.sides[seat].zones.drop.includes(t.newA), "no Android, so no replacement");
    assert.equal(s.cards[t.hostA].under.length, 0);
  }
  // The replacement is "up to 1": it may be declined after the Android went under.
  {
    const { s: s0, t } = fresh(938_030);
    let s = mode(choose(apply(s0, activation(s0, t.card)!.action), seat, [t.hostB]), seat, 0);
    s = choose(s, seat, [t.droid]);
    s = choose(s, seat, []);
    assert.equal(s.prompt.kind, "main");
    assert.ok(s.sides[seat].zones.battle.includes(t.hostB) && s.cards[t.hostB].under.includes(t.droid), "the Android stays under the host");
    assert.ok(s.sides[seat].zones.drop.includes(t.newA));
  }
}

// Negative control: the record as it was drafted before the fix (onto the Android, c1)
// leaves the original Cell beside the new one, which is what the VM then does with it.
{
  const bad = roundtrip(rows).map((r) => (r.cardId === "ABSORB938" ? (JSON.parse(JSON.stringify(r).replace('"onto":{"var":"c0"}', '"onto":{"var":"c1"}')) as RuleRow) : r));
  assert.notDeepEqual(bad, roundtrip(rows), "the control record differs from the fixed one");
  const old: EngineContext = withTokens({ ...CTX, defs, scripts: rulesFromRows(bad, defs) });
  const run = (c: EngineContext, a: Action, s: VmState) => RULES.apply(c, roundtrip(s), a).state as VmState;
  const s0 = board(938_900, "p1");
  const card0 = stage(s0, "p1", "ABSORB938", "hand"), host = stage(s0, "p1", "HOSTA938", "battle"); stage(s0, "p1", "HOSTB938", "battle");
  const droid = stage(s0, "p1", "DROID938", "drop"), fresh = stage(s0, "p1", "NEWA938", "drop");
  let s = run(old, RULES.legalActions(old, s0).find((l) => l.action.type === "activate" && l.action.card === card0)!.action, s0);
  s = run(old, { type: "choose", player: "p1", cards: [host] }, s);
  s = run(old, { type: "chooseMode", player: "p1", index: 0 }, s);
  // A lone candidate is taken without asking, so answer only what is asked.
  while (s.prompt.kind === "chooseCards") s = run(old, { type: "choose", player: "p1", cards: [s.prompt.choice.candidates.includes(droid) ? droid : fresh] }, s);
  assert.ok(s.sides.p1.zones.battle.includes(host) && s.sides.p1.zones.battle.includes(fresh), "control: the old record plays the new Cell beside the original host");
}

// ── #939 the reading, the schema and the language ──────────────────────────
{
  const line = compileCard(defs.SUMMON939).bySkill[0];
  assert.deepEqual(line.unsupported, [], "BT31-141 reads whole");
  assert.deepEqual(line.ops.map((o) => o.op), ["token", "grant"], "create, then grant: no choice, no choose-all");
  const [tok, grant] = line.ops;
  assert.ok(tok.op === "token" && grant.op === "grant");
  if (tok.op === "token" && grant.op === "grant") {
    assert.deepEqual([tok.name, tok.n, tok.power, tok.comboCost, tok.comboPower], ["Cell Jr. Token", 2, 10000, 0, 5000]);
    assert.ok(tok.as, "the creation is named");
    assert.deepEqual(grant.target, { var: tok.as }, "the grant is on exactly those tokens");
    assert.equal(grant.until, "turn");
    assert.equal((grant.keyword as { name: string }).name, "Blocker");
  }
  // Old programs: a token with no name still validates and plays.
  const old = { op: "token", name: "Ghost Token", power: 15000, comboCost: 0, comboPower: 5000, colors: [], n: 1 } as Op;
  const oldRule: Rule = { kind: "activate", trigger: [], cost: null, cond: null, ops: [old] };
  assert.equal(validateRule(oldRule, "activate")?.message ?? null, null);
  // The stored rule prints and parses back unchanged.
  const record = rows.find((r) => r.cardId === "SUMMON939")!;
  const rule = { kind: record.kind, trigger: record.trigger, cost: record.cost, cond: record.cond, ops: record.ops } as unknown as Rule;
  const text = printRule(rule);
  const back = parseRule(text);
  assert.ok(back.ok, text);
  assert.ok(back.ok && deepEqual(back.value, rule), text);
  assert.equal(validateRule(rule, record.kind as Rule["kind"])?.message ?? null, null);
  assert.ok(/\bas\b/.test(text), `the binding is part of the printed rule: ${text}`);
}

// ── #939 the VM ─────────────────────────────────────────────────────────────
const blocker = (s: VmState, id: string) => hasKeyword(ctx, game, s, id, "Blocker");
const cellJrs = (s: VmState, p: PlayerId): string[] => s.sides[p].zones.battle.filter((id) => ctx.defs[s.cards[id].cardId]?.name === "Cell Jr. Token");
const JR = { op: "token", name: "Cell Jr. Token", power: 10000, comboCost: 0, comboPower: 5000, colors: [] as never[] };
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const s0 = board(939_000, seat);
  const card1 = stage(s0, seat, "SUMMON939", "hand");
  const card2 = stage(s0, seat, "SUMMON939", "hand");
  // Tokens that existed before, on both sides: they must not gain Blocker.
  const make = (s: VmState, p: PlayerId, n: number): string[] => {
    const before = new Set(Object.keys(s.cards));
    stepProgram(s, [{ ...JR, n } as Op], p);
    return Object.keys(s.cards).filter((id) => !before.has(id));
  };
  const oldMine = make(s0, seat, 1);
  const oldTheirs = make(s0, foe, 2);
  for (const id of [...oldMine, ...oldTheirs]) assert.equal(blocker(s0, id), false, "plain tokens carry no Blocker");

  let s = apply(s0, activation(s0, card1)!.action);
  assert.equal(s.prompt.kind, "main", "no choice is asked");
  const fresh1 = cellJrs(s, seat).filter((id) => !oldMine.includes(id));
  assert.equal(fresh1.length, 2, "two new tokens");
  for (const id of fresh1) {
    assert.equal(blocker(s, id), true, "the new tokens have Blocker");
    const d = ctx.defs[s.cards[id].cardId];
    assert.deepEqual([d.power, d.comboCost, d.comboPower, s.cards[id].owner], [10000, 0, 5000, seat]);
  }
  for (const id of [...oldMine, ...oldTheirs]) assert.equal(blocker(s, id), false, "the control: existing tokens (either side) gain nothing");
  s = roundtrip(s);
  for (const id of fresh1) assert.equal(blocker(s, id), true, "after a reload");
  assert.equal(blocker(s, oldMine[0]), false, "…and the old token still does not");

  // A second activation: its own two, and the first pair is unchanged.
  s = apply(s, activation(s, card2)!.action);
  const fresh2 = cellJrs(s, seat).filter((id) => !oldMine.includes(id) && !fresh1.includes(id));
  assert.equal(fresh2.length, 2);
  for (const id of [...fresh1, ...fresh2]) assert.equal(blocker(s, id), true);
  assert.equal(blocker(s, oldMine[0]), false);

  // The grant is for the turn.
  s = apply(s, { type: "endMain", player: seat });
  for (let i = 0; i < 40 && s.turnPlayer === seat; i++) {
    const waiting = (s.prompt as { player?: PlayerId }).player;
    if (!waiting) break;
    s = apply(s, s.prompt.kind === "charge" ? ({ type: "charge", player: waiting, card: null } as Action) : s.prompt.kind === "main" ? ({ type: "endMain", player: waiting } as Action) : ({ type: "pass", player: waiting } as Action));
  }
  assert.notEqual(s.turnPlayer, seat, "the turn ended");
  for (const id of [...fresh1, ...fresh2]) assert.equal(blocker(s, id), false, "Blocker is gone with the turn");
}

// The Battle half of "Main/Battle": activated inside a battle, by the attacker and by the defender.
{
  const s0 = board(939_050, "p2");
  const mine = stage(s0, "p2", "SUMMON939", "hand"), theirs = stage(s0, "p1", "SUMMON939", "hand");
  const [oldTok] = (() => { const b = new Set(Object.keys(s0.cards)); stepProgram(s0, [{ ...JR, n: 1 } as Op], "p2"); return Object.keys(s0.cards).filter((id) => !b.has(id)); })();
  const swing = RULES.legalActions(ctx, s0).find((l) => l.action.type === "attack" && l.action.attacker === s0.sides.p2.zones.leader[0]);
  assert.ok(swing, "the Leader may attack");
  let s = apply(s0, swing.action);
  const act = (st: VmState, id: string) => RULES.legalActions(ctx, st).find((l) => l.action.type === "activate" && l.action.card === id);
  assert.ok(act(s, mine), "the attacker may activate the Battle half");
  s = apply(s, act(s, mine)!.action);
  const afterMine = cellJrs(s, "p2").filter((id) => id !== oldTok);
  assert.equal(afterMine.length, 2);
  for (const id of afterMine) assert.equal(blocker(s, id), true);
  assert.equal(blocker(s, oldTok), false, "a token from before the battle did not gain it");
  // Let the defender answer: its own pair, on its own side.
  for (let i = 0; i < 6 && !act(s, theirs); i++) {
    const p = (s.prompt as { player?: PlayerId }).player;
    if (!p) break;
    s = apply(s, { type: "pass", player: p });
  }
  {
    assert.ok(act(s, theirs), "the defender may activate it too");
    s = apply(s, act(s, theirs)!.action);
    const foeTokens = cellJrs(s, "p1");
    assert.equal(foeTokens.length, 2);
    for (const id of foeTokens) assert.equal(blocker(s, id), true, "the defender's own two");
    for (const id of afterMine) assert.equal(blocker(s, id), true);
  }
}

// Zero creations binds an empty result: nothing already in play is picked up.
{
  const s = board(939_100, "p1");
  const prior = stepProgram(s, [{ ...JR, n: 1, as: "t0" } as Op], "p1");
  assert.equal(prior.vars.t0.length, 1);
  const none = stepProgram(s, [{ ...JR, n: 0, as: "t0" } as Op, { op: "grant", target: { var: "t0" }, keyword: { name: "Blocker" }, until: "turn" } as Op], "p1", { t0: prior.vars.t0 });
  assert.deepEqual(none.vars.t0, [], "zero creations rebinds to the empty result, not the stale variable");
  assert.equal(blocker(s, prior.vars.t0[0]), false, "the stale token gained nothing");
}

// Negative control: the stored override's approximation (grant to every Cell Jr. Token you
// control after creating) is what over-grants. Never written anywhere; run on a local state only.
{
  const s = board(939_200, "p1");
  const [pre] = (() => { const b = new Set(Object.keys(s.cards)); stepProgram(s, [{ ...JR, n: 1 } as Op], "p1"); return Object.keys(s.cards).filter((id) => !b.has(id)); })();
  stepProgram(s, [{ ...JR, n: 2 } as Op, { op: "grant", target: { sel: { side: "you", area: "battle", filter: parseFilter("Cell Jr. Tokens") } }, keyword: { name: "Blocker" }, until: "turn" } as Op], "p1");
  assert.equal(blocker(s, pre), true, "control: selecting all your tokens also gives the pre-existing one Blocker");
}

console.log("  ok  #938/#939 chosen Cell host kept across the nested Android; created tokens bound by the token op");

/**
 * #757 U1-b (prices and choices): the printed wordings of decks A (SD15) and B (SD5) from the #649
 * snapshot, played on the rules engine. Every card below is `cardDefFrom` of a snapshot row; nothing
 * is a synthetic stand-in for a row's evidence (only the generic fodder cards are).
 * Rule Manual citations are `docs/rules/rulemanual.txt` section numbers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const OWNER_COSTS = (JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json", "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;
const printed = (id: string): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  // The owner's stored specified costs (U7, #733) are part of the audited catalog, as in the audit's own play-through.
  return cardDefFrom({ ...row, specifiedCost: OWNER_COSTS[id] ?? null } as Parameters<typeof cardDefFrom>[0]);
};

const REAL = [
  "BT9-031", "DB2-004", "SD5-04", "BT4-079", "BT4-084", "SD15-01", "SD15-02", "SD15-05", "BT14-010", "DB3-001",
  "BT5-023", "BT4-097", "BT10-008", "BT1-014", "BT4-012", "BT1-027", "BT3-027", "BT6-010", "BT6-011",
  "BT6-025", "BT6-026", "BT11-011", "TB1-023", "TB1-055", "DB1-019", "SD5-01", "SD5-02", "SD5-03",
  "SD5-05", "BT4-089", "SD15-03", "SD15-04",
];
const defs: Record<string, CardDef> = { ...DEFS };
for (const id of REAL) defs[id] = printed(id);
// Generic fodder (never evidence of a row): one card of each colour and an Extra Card, a Unison for markers.
Object.assign(defs, {
  RED757: card("RED757", { colors: ["Red"], skill: null }),
  BLUE757: card("BLUE757", { colors: ["Blue"], skill: null }),
  EXTRA757: card("EXTRA757", { type: "EXTRA", colors: ["Red"], energyCost: 1, power: null, comboCost: null, comboPower: null, skill: null }),
  BUNI757: card("BUNI757", { type: "UNISON", colors: ["Blue"], energyCost: 1, power: 5000, comboCost: null, comboPower: null, skill: null }),
  // A red {r}{r} Unison that has a keyword skill (SD15-01's "no keyword skills" must refuse it), and an opposing Battle Card whose Activate drops a Battle Card.
  RBLK757: card("RBLK757", { type: "UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, skill: "[Blocker]", specifiedCost: parseSpecifiedCost("{r}{r}") ?? undefined }),
  REMOVER757: card("REMOVER757", { colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." }),
  EXACT757: card("EXACT757", { colors: ["Blue"], power: 20000, skill: null }),
  BIG757: card("BIG757", { colors: ["Blue"], power: 25000, skill: null }),
  RUNI757: card("RUNI757", { type: "UNISON", colors: ["Red"], energyCost: 1, power: 5000, comboCost: null, comboPower: null, skill: null }),
});

const scripts = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
type Out = { state: VmState; events: GameEvent[] };
const apply = (s: VmState, action: Action): Out => engine.apply(ctx, reload(s), action) as Out;
const legal = (s: VmState) => engine.legalActions(ctx, s);

let events: GameEvent[] = [];
/** Every card question the engine asked during the play, in order (what was offered, how many). */
let asked: { player: PlayerId; reason: string; candidates: string[]; min: number; max: number }[] = [];
/** Applies actions in order, collecting the events of the whole play in `events`. */
function play(s: VmState, ...actions: Action[]): VmState {
  for (const action of actions) {
    const out = apply(s, action);
    events.push(...out.events);
    s = out.state;
    if (s.prompt.kind === "chooseCards") asked.push({ player: s.prompt.player, reason: s.prompt.choice.reason, candidates: [...s.prompt.choice.candidates], min: s.prompt.choice.min, max: s.prompt.choice.max });
  }
  return s;
}
type Zone = "battle" | "energy" | "hand" | "drop" | "life" | "unison" | "combo" | "deck";
function stage(s: VmState, p: PlayerId, id: string, area: Zone): string {
  const physical = s.sides[p].zones.deck[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok, `staged ${id} in ${area}`);
  s.pending = [];
  return physical;
}
function empty(s: VmState, p: PlayerId, area: Zone): void {
  for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
}

/** Both players to `who`'s Main Phase (p1 goes first; p1's own first Main when `who` is p1). */
function mainOf(who: PlayerId, seed = 757, leaders: { p1: string; p2: string } = { p1: "L-RED", p2: "L-BLUE" }): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Other", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  if (who === "p2") s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, who);
  events = [];
  asked = [];
  for (const p of ["p1", "p2"] as const) { empty(s, p, "hand"); empty(s, p, "energy"); }
  return s;
}
const leaderOf = (s: VmState, p: PlayerId): string => s.sides[p].zones.leader[0];
const zone = (s: VmState, p: PlayerId, a: Zone): string[] => s.sides[p].zones[a];
const cardIs = (s: VmState, id: string): string => s.cards[id].cardId;

/** Answers prompts of `who` with `pick` until `until` holds (or fails loudly). */
function drive(s: VmState, pick: (s: VmState, options: ReturnType<typeof legal>) => Action | undefined, until: (s: VmState) => boolean = (t) => t.prompt.kind === "main"): VmState {
  for (let i = 0; i < 40 && !until(s); i++) {
    const options = legal(s);
    const action = pick(s, options) ?? options.find((o) => o.action.type !== "concede")?.action;
    assert.ok(action, `stopped at ${s.prompt.kind}`);
    s = play(s, action);
  }
  assert.ok(until(s), `did not settle; at ${s.prompt.kind}`);
  return s;
}
const skillsOf = (id: string): GameEvent[] => events.filter((e) => e.type === "skill" && e.card === id);

const attrs = (s: VmState, id: string) => attrsNow(withTokens(ctx), game, s, id);

const promptOf = (s: VmState) => s.prompt as unknown as { kind: string; player: PlayerId; choice: { candidates: string[]; min: number; max: number; reason: string }; options: string[]; reason: string };
const choose = (s: VmState, player: PlayerId, ids: string[]): VmState => play(s, { type: "choose", player, cards: ids });
const mode = (s: VmState, player: PlayerId, index: number): VmState => play(s, { type: "chooseMode", player, index });
/** The Auto's price question (9-6-4): `pay` or decline. */
function payAuto(s: VmState, player: PlayerId, pay: boolean): VmState {
  assert.equal(s.prompt.kind, "chooseMode", "the Auto asks whether to pay its price (9-6-4)");
  assert.match(promptOf(s).reason, /Pay this Auto skill's cost/);
  return mode(s, player, pay ? 0 : 1);
}
/** Attacker declares; defender passes everything until the attacker's combo prompt (or the Auto prompts). */
function attackTo(s: VmState, actor: PlayerId, attacker: string, target?: string): VmState {
  const other: PlayerId = actor === "p1" ? "p2" : "p1";
  s = play(s, { type: "attack", player: actor, attacker, target: target ?? leaderOf(s, other) });
  return s;
}
const passUntil = (s: VmState, until: (t: VmState) => boolean): VmState =>
  drive(s, (t, o) => o.find((l) => l.action.type === "pass")?.action ?? o.find((l) => l.action.type === "block" && l.action.card === null)?.action ?? o.find((l) => l.action.type === "counter" && l.action.card === null)?.action, until);

// ── Auto/Activate price that chooses a card and moves it ───────────────────
// 1-6-1 / 9-6-4: the part before the colon is the skill cost; an Auto's master chooses to pay it in
// full or not at all (9-6-4-1: unpaid = not activated). 5-8-2: a cost that can't be paid at all keeps
// the skill from being declared.
{
  // BT9-031 (hand to Drop): "Choose 1 Extra Card in your hand and place it in your Drop Area".
  const fresh = () => {
    const s = mainOf("p2");
    const c = stage(s, "p2", "BT9-031", "hand");
    const extra = stage(s, "p2", "EXTRA757", "hand");
    const plain = stage(s, "p2", "RED757", "hand");
    return { s: passUntil(attackTo(s, "p2", leaderOf(s, "p2")), (t) => t.prompt.kind === "combo"), c, extra, plain };
  };
  {
    const f = fresh();
    let s = play(f.s, { type: "combo", player: "p2", card: f.c });
    s = payAuto(s, "p2", true);
    assert.ok(zone(s, "p2", "drop").includes(f.extra), "the Extra Card went to the Drop Area (price, 1-6-2)");
    assert.ok(zone(s, "p2", "hand").includes(f.plain), "a non-Extra card cannot pay: it stays in hand");
    assert.equal(attrs(s, f.c).comboPower, 11000, "+6000 combo power (5000 printed) for the turn");
  }
  {
    // Declined (9-6-4-1): nothing moves, nothing gained.
    const f = fresh();
    let s = play(f.s, { type: "combo", player: "p2", card: f.c });
    s = payAuto(s, "p2", false);
    assert.ok(zone(s, "p2", "hand").includes(f.extra) && !zone(s, "p2", "drop").includes(f.extra), "declined: the Extra Card stays");
    assert.equal(attrs(s, f.c).comboPower, 5000, "declined: no combo power");
  }
  {
    // Two Extra Cards: a real choice, exactly 1 (5-2-3), from the Extra Cards only.
    const f = fresh();
    const second = stage(f.s, "p2", "EXTRA757", "hand");
    let s = play(f.s, { type: "combo", player: "p2", card: f.c });
    s = payAuto(s, "p2", true);
    assert.equal(s.prompt.kind, "chooseCards");
    const ch = promptOf(s).choice;
    assert.deepEqual([ch.min, ch.max], [1, 1], "exactly 1 (5-2-3)");
    assert.deepEqual([...ch.candidates].sort(), [f.extra, second].sort(), "only Extra Cards are candidates; the red Battle Card is not");
    s = choose(s, "p2", [second]);
    assert.ok(zone(s, "p2", "drop").includes(second) && zone(s, "p2", "hand").includes(f.extra));
    assert.equal(attrs(s, f.c).comboPower, 11000);
  }
}
{
  // DB2-004 (Life to hand): "Choose 1 card in your life and add it to your hand".
  const s0 = mainOf("p2");
  const c = stage(s0, "p2", "DB2-004", "battle");
  const lifeBefore = zone(s0, "p2", "life").length;
  let s = attackTo(s0, "p2", c);
  s = payAuto(s, "p2", true);
  assert.equal(s.prompt.kind, "chooseCards");
  const ch = promptOf(s).choice;
  assert.deepEqual([ch.min, ch.max], [1, 1], "exactly 1 Life card (5-2-3)");
  assert.deepEqual([...ch.candidates].sort(), [...zone(s, "p2", "life")].sort(), "every Life card is a candidate");
  const picked = ch.candidates[0];
  s = choose(s, "p2", [picked]);
  assert.equal(zone(s, "p2", "life").length, lifeBefore - 1, "one card left the Life Area");
  assert.ok(zone(s, "p2", "hand").includes(picked), "…and is in the hand");
  assert.equal(s.cards[c].mode, "active", "switched to Active Mode (the attack had rested it)");
  assert.equal(attrs(s, c).power, 15000, "+10000 power for the turn");
  s = passUntil(s, (t) => t.prompt.kind === "main");
  assert.ok(!legal(s).some((l) => l.action.type === "attack" && l.action.attacker === c), "can't attack for the turn");
  // Declined (9-6-4-1): no Life card moves, the card stays rested, no power.
  const d0 = mainOf("p2");
  const c2 = stage(d0, "p2", "DB2-004", "battle");
  const d = payAuto(attackTo(d0, "p2", c2), "p2", false);
  assert.equal(zone(d, "p2", "life").length, lifeBefore, "declined: Life unchanged");
  assert.equal(d.cards[c2].mode, "rest");
  assert.equal(attrs(d, c2).power, 5000);
}
{
  // SD5-04 [Activate: Main][Once per turn] (Life to hand), then "if you have 2 or less life" [Triple Strike].
  for (const [life, triple] of [[3, true], [4, false]] as const) {
    const s0 = mainOf("p1");
    const c = stage(s0, "p1", "SD5-04", "battle");
    s0.cards[c].mode = "rest";
    zone(s0, "p1", "life").splice(life);
    let s = play(s0, { type: "activate", player: "p1", card: c, skill: 10 });
    assert.equal(s.prompt.kind, "chooseCards", "the price asks which Life card");
    const ch = promptOf(s).choice;
    assert.deepEqual([ch.min, ch.max, ch.candidates.length], [1, 1, life]);
    s = choose(s, "p1", [ch.candidates[0]]);
    assert.equal(zone(s, "p1", "life").length, life - 1);
    assert.ok(zone(s, "p1", "hand").includes(ch.candidates[0]));
    assert.equal(s.cards[c].mode, "active", "switched to Active Mode");
    assert.equal(JSON.stringify(s.effects).includes('"x":3'), triple, `${life - 1} life left: [Triple Strike] ${triple ? "granted" : "not granted"} (the condition is read after the price)`);
    assert.ok(!legal(s).some((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === 10), "[Once per turn]: not offered again");
  }
  // No Life cards: the price can't be paid, so the skill isn't offered (5-8-3).
  const s1 = mainOf("p1");
  const c1 = stage(s1, "p1", "SD5-04", "battle");
  empty(s1, "p1", "life");
  assert.ok(!legal(s1).some((l) => l.action.type === "activate" && l.action.card === c1 && l.action.skill === 10), "no Life card: the price can't be paid (5-8-3)");
}
{
  // BT4-079 [Swap]: "{y}, choose 1 card from your hand and place it in your Drop Area" (a hand price).
  const s0 = mainOf("p1");
  const c = stage(s0, "p1", "BT4-079", "battle");
  const yel = stage(s0, "p1", "BT4-097", "energy");
  void yel;
  const fodder = stage(s0, "p1", "RED757", "hand");
  const target = stage(s0, "p1", "BT4-084", "hand");
  assert.equal(legal(s0).filter((l) => l.action.type === "activate" && l.action.card === c).length, 1, "[Swap 2] is offered with a yellow energy and a cost-2 card in hand");
  let s = play(s0, { type: "activate", player: "p1", card: c, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards", "the price asks which hand card goes to the Drop");
  assert.deepEqual(promptOf(s).choice.candidates, [fodder], "only a card that is not the specified one can pay (5-8-3)");
  assert.equal(s.cards[yel].mode, "rest", "the {y} was paid");
  s = choose(s, "p1", [fodder]);
  assert.ok(zone(s, "p1", "drop").includes(fodder), "the hand card was placed in the Drop Area (1-6-2)");
  assert.equal(s.prompt.kind, "chooseCards", "then the swap names its specified card");
  assert.deepEqual(promptOf(s).choice.candidates, [target]);
  s = choose(s, "p1", [target]);
  assert.ok(zone(s, "p1", "battle").includes(target) && zone(s, "p1", "hand").includes(c), "then the specified card is played and BT4-079 returns to the hand (22-22-4)");
}

// ── Condition-only price ───────────────────────────────────────────────────
// 9-6-4-1-1: a skill-cost *condition* ("if your Leader is red") that holds can't be declined: an Auto
// whose whole price is a condition is compulsory when it holds and never activates when it doesn't.
{
  // BT14-010: "If your Leader Card is red and your life is at 4 or less: When this card is used in a combo, draw 1 card."
  const run = (leader: string, life: number): { hand: number; asked: boolean; drew: boolean } => {
    const s0 = mainOf("p2", 7570, { p1: "L-BLUE", p2: leader });
    const c = stage(s0, "p2", "BT14-010", "hand");
    zone(s0, "p2", "life").splice(life);
    let s = passUntil(attackTo(s0, "p2", leaderOf(s0, "p2")), (t) => t.prompt.kind === "combo");
    const hand = zone(s, "p2", "hand").length;
    s = play(s, { type: "combo", player: "p2", card: c });
    return { hand: zone(s, "p2", "hand").length - (hand - 1), asked: s.prompt.kind === "chooseMode" || s.prompt.kind === "optionalCost", drew: skillsOf(c).length === 1 };
  };
  const yes = run("L-RED", 4);
  assert.deepEqual([yes.drew, yes.asked, yes.hand], [true, false, 1], "red Leader, 4 life: it activates, is not asked about (9-6-4-1-1) and draws 1");
  const edge = run("L-RED", 5);
  assert.deepEqual([edge.drew, edge.hand], [false, 0], "5 life: the condition fails, nothing is drawn");
  const blue = run("L-BLUE", 3);
  assert.deepEqual([blue.drew, blue.hand], [false, 0], "a blue Leader: the condition fails at 3 life");
}
{
  // DB3-001: "If your Leader Card is red and your opponent's life is at 5 or more: When this card is played, deal 1 damage to your opponent."
  const run = (leader: string, oppLife: number): { life: number; asked: boolean } => {
    const s0 = mainOf("p1", 7571, { p1: leader, p2: "L-BLUE" });
    const u = stage(s0, "p1", "DB3-001", "hand");
    for (let i = 0; i < 3; i++) stage(s0, "p1", "RED757", "energy");
    zone(s0, "p2", "life").splice(oppLife);
    const before = zone(s0, "p2", "life").length;
    const s = play(s0, { type: "playUnison", player: "p1", card: u, x: 2 });
    return { life: before - zone(s, "p2", "life").length, asked: s.prompt.kind === "chooseMode" || s.prompt.kind === "optionalCost" };
  };
  assert.deepEqual(run("L-RED", 5), { life: 1, asked: false }, "red Leader, opponent at 5: 1 damage, compulsory");
  assert.deepEqual(run("L-RED", 4), { life: 0, asked: false }, "opponent at 4: the condition fails");
  assert.deepEqual(run("L-BLUE", 7), { life: 0, asked: false }, "a blue Leader: the condition fails");
}
{
  // SD15-01 [Awaken]: "When your life is at 4 or less or you have a red Unison Card with a specified cost of 2 in play: You may switch up to 2 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, choose up to 1 of your red Unison Cards with {Cabba} in its name and add a marker to it, then flip this card over."
  const fresh = (life: number, unison: boolean) => {
    const s = mainOf("p1", 7572, { p1: "SD15-01", p2: "L-BLUE" });
    zone(s, "p1", "life").splice(life);
    const u = unison ? stage(s, "p1", "SD15-02", "unison") : null;
    const rest = [stage(s, "p1", "RED757", "energy"), stage(s, "p1", "RED757", "energy"), stage(s, "p1", "RED757", "energy")];
    for (const e of rest) s.cards[e].mode = "rest";
    return { s, leader: leaderOf(s, "p1"), u, rest };
  };
  const awaken = (s: VmState, leader: string) => legal(s).find((l) => l.action.type === "activate" && l.action.card === leader)?.action;
  {
    const f = fresh(5, false);
    assert.equal(awaken(f.s, f.leader), undefined, "5 life and no Unison: the condition-only price fails, [Awaken] is not offered");
  }
  {
    const f = fresh(4, false);
    assert.ok(awaken(f.s, f.leader), "4 life: offered");
    let s = play(f.s, awaken(f.s, f.leader)!);
    s = drive(s, (t, o) => o.find((l) => l.action.type === "chooseMode" && l.action.index === 0)?.action ?? o.find((l) => l.action.type === "choose")?.action);
    assert.equal(s.cards[f.leader].flipped, true, "flipped over");
  }
  {
    const f = fresh(8, true);
    const markersBefore = f.s.cards[f.u!].markers ?? 0;
    const askedFrom = asked.length;
    let s = play(f.s, awaken(f.s, f.leader)!);
    s = drive(s, (t, o) => o.find((l) => l.action.type === "chooseMode" && l.action.index === 0)?.action ?? o.find((l) => l.action.type === "choose")?.action);
    assert.equal(s.cards[f.leader].flipped, true);
    assert.equal(zone(s, "p1", "life").length, 5, "life added to the hand until 5 are left");
    const energyAsks = asked.filter((q) => q.candidates.length && q.candidates.every((id) => f.rest.includes(id)));
    assert.equal(energyAsks.length, 2, "\"switch up to 2 of your energy\" is asked one card at a time, twice");
    assert.ok(energyAsks.every((q) => q.min === 0 && q.max === 1), "each pick may be declined (5-2-4, \"up to\")");
    assert.equal(f.rest.filter((id) => s.cards[id].mode === "active").length, 2, "two of the three rested energy are Active again");
    // The marker step: "{Cabba} in its name" means the name contains Cabba (#758), so SD15-02
    // "SS Cabba, Spirit Resonance" is offered and gains the marker (5-13; measured as a delta).
    assert.ok(asked.slice(askedFrom).some((q) => q.candidates.includes(f.u!)), "the red Unison with {Cabba} in its name is offered for the marker (#758)");
    assert.equal(s.cards[f.u!].markers ?? 0, markersBefore + 1, "SD15-02 gains 1 marker from [Awaken]");
  }
}

// ── Counter alternative price ──────────────────────────────────────────────
// 5-3 / 5-8-2-3 / 9-7: a [Counter] may be declared by paying another price in place of its energy cost;
// the card then goes to the Drop Area and its effect resolves in the counter motion (9-7-3-5).
const counterAlt = (s: VmState, card: string) => legal(s).find((l) => l.action.type === "counter" && l.action.card === card && l.action.alt)?.action;
const counterPaid = (s: VmState, card: string) => legal(s).find((l) => l.action.type === "counter" && l.action.card === card && !l.action.alt)?.action;
{
  // BT5-023: Permanent "(takes effect when you have 5 or more cards in your Drop Area) ... by adding a card from your life to your hand instead of paying its energy cost."
  // Counter: "Your Leader Card is red: Choose up to 1 of your cards and it gets +40000 power for the duration of the battle, then choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the duration of the turn."
  const defend = (drop: number, energy: number) => {
    const s = mainOf("p2", 7573, { p1: "L-RED", p2: "L-BLUE" });
    const c = stage(s, "p1", "BT5-023", "hand");
    for (let i = 0; i < drop; i++) stage(s, "p1", "RED757", "drop");
    for (let i = 0; i < energy; i++) stage(s, "p1", "RED757", "energy");
    const foe = stage(s, "p2", "V-BLUE", "battle");
    return { s: attackTo(s, "p2", leaderOf(s, "p2")), c, foe };
  };
  const none = defend(4, 0);
  assert.notEqual(none.s.prompt.kind, "counter", "nothing can be declared, so the window is skipped");
  assert.equal(counterAlt(none.s, none.c), undefined, "4 cards in the Drop Area: the Permanent has not taken effect, no free way in");
  assert.equal(counterPaid(none.s, none.c), undefined, "and there is no energy to pay for it");
  const five = defend(5, 0);
  const alt = counterAlt(five.s, five.c);
  assert.ok(alt, "5 cards in the Drop Area and no energy: offered by the life alternative");
  assert.equal(counterPaid(five.s, five.c), undefined, "the energy way is not available");
  const life = zone(five.s, "p1", "life").length;
  const handBefore = zone(five.s, "p1", "hand").length;
  let s = play(five.s, alt!);
  assert.equal(zone(s, "p1", "life").length, life - 1, "a card left the Life Area");
  assert.equal(zone(s, "p1", "hand").length, handBefore, "...and was added to the hand while the Counter itself left it");
  assert.ok(zone(s, "p1", "drop").includes(five.c), "the Counter went to the Drop Area (22-10-7)");
  assert.equal(s.prompt.kind, "chooseCards");
  let q = promptOf(s).choice;
  assert.deepEqual([q.min, q.max], [0, 1], "\"Choose up to 1 of your cards\" (5-2-4)");
  assert.ok(q.candidates.includes(leaderOf(s, "p1")));
  s = choose(s, "p1", [leaderOf(s, "p1")]);
  assert.equal(s.prompt.kind, "chooseCards");
  q = promptOf(s).choice;
  assert.deepEqual([q.min, q.max], [0, 1], "\"choose up to 1 of your opponent's Battle Cards\"");
  assert.deepEqual(q.candidates, [five.foe], "only the opponent's Battle Card");
  s = choose(s, "p1", [five.foe]);
  assert.equal(attrs(s, leaderOf(s, "p1")).power, 10000 + 40000, "+40000 for the battle");
  assert.equal(attrs(s, five.foe).power, 10000 - 10000, "-10000 for the turn");
  // 5-2-4: "up to" may be answered with nobody.
  let z = play(five.s, alt!);
  z = choose(z, "p1", []);
  assert.equal(attrs(z, leaderOf(z, "p1")).power, 10000, "chose 0: no bonus");
  // With energy: both ways are offered and the energy way leaves the Life Area alone.
  const both = defend(5, 1);
  assert.ok(counterAlt(both.s, both.c) && counterPaid(both.s, both.c), "energy and 5 in the Drop: both prices on offer");
  const paid = play(both.s, counterPaid(both.s, both.c)!);
  assert.equal(zone(paid, "p1", "life").length, life, "paying energy takes nothing from the Life Area");
  // No Life card: the alternative can't be paid (5-8-3).
  const bare = defend(5, 0);
  empty(bare.s, "p1", "life");
  assert.equal(counterAlt(bare.s, bare.c), undefined, "no Life card to add: not offered");
}
{
  // BT4-097: "[Permanent] If your Leader Card is <<Goku's Lineage>>, when you activate this card's [Counter], you may choose 1 card in your life and add it to your hand. If you do so, you may activate this card's [Counter] without paying its energy cost."
  // [Counter: Attack] Negate the attack.   (Leader SD5-01 is the audited deck B's own Leader.)
  const defend = (leader: string, yellow: number) => {
    const s = mainOf("p2", 7574, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "BT4-097", "hand");
    for (let i = 0; i < yellow; i++) stage(s, "p1", "BT4-084", "energy");
    return { s: attackTo(s, "p2", leaderOf(s, "p2")), c };
  };
  const nothing = defend("SD5-01", 0);
  const alt = counterAlt(nothing.s, nothing.c);
  assert.ok(alt, "Goku's Lineage Leader, no energy: offered through the life alternative");
  const life = zone(nothing.s, "p1", "life").length;
  events = [];
  const s = play(nothing.s, alt!);
  assert.equal(zone(s, "p1", "life").length, life - 1, "1 card from the Life Area");
  assert.ok(zone(s, "p1", "drop").includes(nothing.c), "the Counter is in the Drop Area");
  assert.ok(events.some((e) => e.type === "attackNegated"), "Negate the attack (9-7-3-5)");
  const wrong = defend("L-RED", 0);
  assert.equal(counterAlt(wrong.s, wrong.c), undefined, "a Leader that is not Goku's Lineage: no free way in");
  const rich = defend("SD5-01", 1);
  assert.ok(counterPaid(rich.s, rich.c), "with a yellow energy the printed cost is also on offer");
  const keepsLife = play(rich.s, counterPaid(rich.s, rich.c)!);
  assert.equal(zone(keepsLife, "p1", "life").length, life, "paying energy leaves the Life Area alone");
}
{
  // BT10-008: "[Permanent] If you have a red Unison Card with 2 or more markers in play, you can activate this card's [Counter] skill from your hand without paying its energy cost."
  // Counter: "You can't activate the [Counter: Play] skills of other cards for the turn: Choose up to 2 of your opponent's Battle Cards, they get -15000 power for the turn, then play this card."
  const window = (markers: number) => {
    const s = mainOf("p2", 7575, { p1: "L-RED", p2: "L-BLUE" });
    const y = stage(s, "p1", "BT10-008", "hand");
    const u = stage(s, "p1", "RUNI757", "unison");
    s.cards[u].markers = markers;
    const pl = stage(s, "p2", "V-BLUE", "hand");
    stage(s, "p2", "V-BLUE", "energy"); stage(s, "p2", "V-BLUE", "energy");
    const foes = [stage(s, "p2", "V-BLUE", "battle"), stage(s, "p2", "V-BLUE", "battle"), stage(s, "p2", "V-BLUE", "battle")];
    let t = play(s, { type: "play", player: "p2", card: pl });
    if (t.prompt.kind === "payCost") t = play(t, legal(t)[0].action);
    return { s: t, y, foes };
  };
  const one = window(1);
  assert.equal(counterAlt(one.s, one.y), undefined, "a red Unison with 1 marker: no free way in");
  const w = window(2);
  const alt = counterAlt(w.s, w.y);
  assert.ok(alt, "a red Unison with 2 markers and no energy: the Counter is offered free");
  let s = play(w.s, alt!);
  assert.equal(s.prompt.kind, "chooseCards");
  // "Up to 2" is asked one card at a time, each pick optional (5-2-4), the first pick no longer on offer.
  let q = promptOf(s).choice;
  assert.deepEqual([q.min, q.max], [0, 1], "first pick of \"up to 2\": 0 or 1");
  assert.ok(w.foes.every((id) => q.candidates.includes(id)), "the opponent's Battle Cards are the candidates");
  assert.ok(q.candidates.every((id) => zone(s, "p2", "battle").includes(id)), "...and only theirs");
  s = choose(s, "p1", [w.foes[0]]);
  assert.equal(s.prompt.kind, "chooseCards");
  q = promptOf(s).choice;
  assert.deepEqual([q.min, q.max], [0, 1], "second pick: 0 or 1");
  assert.ok(!q.candidates.includes(w.foes[0]) && q.candidates.includes(w.foes[1]), "the first pick is not offered again");
  s = choose(s, "p1", [w.foes[1]]);
  assert.equal(attrs(s, w.foes[0]).power, 10000 - 15000, "-15000 power for the turn");
  assert.equal(attrs(s, w.foes[1]).power, 10000 - 15000);
  assert.equal(attrs(s, w.foes[2]).power, 10000, "the third was not chosen");
  assert.ok(zone(s, "p1", "battle").includes(w.y), "...then play this card");
}


// ── Choose cards / targets ─────────────────────────────────────────────────
// 5-2-3: a stated number must be chosen as far as possible; 5-2-4: "up to N" may be any number 0..N;
// 5-2-5/6: with fewer (or no) legal targets, as many as possible (or none) are chosen and the rest of
// the effect on them is ignored. The prompt carries min/max and the candidate list, so each scenario
// reads both: what may be picked, and that the wrong cards are not on offer.
/** Plays a card from hand with energy paid (colour picks answered with the first option). */
function cast(s: VmState, who: PlayerId, id: string): VmState {
  s = play(s, { type: "play", player: who, card: id });
  while (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
  return s;
}
const energyFor = (s: VmState, p: PlayerId, n: number, id = "RED757"): void => { for (let i = 0; i < n; i++) stage(s, p, id, "energy"); };
const ask = (s: VmState) => {
  assert.equal(s.prompt.kind, "chooseCards", `a card question is open (at ${s.prompt.kind}: ${JSON.stringify(s.prompt).slice(0, 300)})`);
  return promptOf(s).choice;
};
const sorted = (ids: string[]) => [...ids].sort();
{
  // BT6-010 [Auto] "When you play this card, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the duration of the turn."
  const s0 = mainOf("p1", 7580);
  const c = stage(s0, "p1", "BT6-010", "hand");
  energyFor(s0, "p1", 3);
  const mine = stage(s0, "p1", "RED757", "battle");
  const foeA = stage(s0, "p2", "V-BLUE", "battle");
  const foeB = stage(s0, "p2", "V-BLUE", "battle");
  let s = cast(s0, "p1", c);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 1\" (5-2-4)");
  assert.deepEqual(sorted(q.candidates), sorted([foeA, foeB]), "only the opponent's Battle Cards, not mine and not BT6-010 itself");
  assert.ok(!q.candidates.includes(mine) && !q.candidates.includes(c));
  s = choose(s, "p1", [foeA]);
  assert.equal(attrs(s, foeA).power, 10000 - 5000, "-5000 for the turn");
  assert.equal(attrs(s, foeB).power, 10000);
  // Choosing nobody is allowed (5-2-4).
  const none = choose(cast(s0, "p1", c), "p1", []);
  assert.equal(attrs(none, foeA).power, 10000);
  // No opposing Battle Card: no target can be chosen, the effect is ignored (5-2-6).
  const empty0 = mainOf("p1", 7580);
  const c2 = stage(empty0, "p1", "BT6-010", "hand");
  energyFor(empty0, "p1", 3);
  empty(empty0, "p2", "battle");
  assert.notEqual(cast(empty0, "p1", c2).prompt.kind, "chooseCards", "no opposing Battle Card: nothing to choose (5-2-6)");
}
{
  // BT6-011 [Auto] "When you play this card, if there is a <<Saiyan>> card in play in your Battle Area, draw 2 cards, then choose 2 cards from your hand and place them in your Drop Area."
  const run = (saiyan: boolean) => {
    const s = mainOf("p1", 7581);
    const c = stage(s, "p1", "BT6-011", "hand");
    energyFor(s, "p1", 1);
    if (saiyan) stage(s, "p1", "BT11-011", "battle");
    const keep = stage(s, "p1", "RED757", "hand");
    return { s, c, keep };
  };
  const yes = run(true);
  const handBefore = zone(yes.s, "p1", "hand").length;
  let s = cast(yes.s, "p1", yes.c);
  assert.equal(zone(s, "p1", "hand").length, handBefore - 1 + 2, "BT6-011 left the hand, 2 cards were drawn");
  // "Choose 2" is asked a card at a time, each a mandatory pick (5-2-3): two questions of exactly 1.
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [1, 1], "no \"up to\": each pick is mandatory (5-2-3)");
  assert.equal(q.candidates.length, zone(s, "p1", "hand").length, "any card in hand");
  assert.throws(() => choose(s, "p1", []), IllegalAction, "declining a mandatory pick is refused");
  const dropBefore = zone(s, "p1", "drop").length;
  const first = q.candidates[0];
  s = choose(s, "p1", [first]);
  const q2 = ask(s);
  assert.deepEqual([q2.min, q2.max], [1, 1]);
  assert.ok(!q2.candidates.includes(first), "the first pick is not offered again");
  s = choose(s, "p1", [q2.candidates[0]]);
  assert.equal(zone(s, "p1", "drop").length, dropBefore + 2, "both went to the Drop Area");
  assert.ok(zone(s, "p1", "drop").includes(first) && zone(s, "p1", "drop").includes(q2.candidates[0]));
  const no = run(false);
  const hb = zone(no.s, "p1", "hand").length;
  const t = cast(no.s, "p1", no.c);
  assert.equal(zone(t, "p1", "hand").length, hb - 1, "no <<Saiyan>> in play: nothing is drawn");
  assert.notEqual(t.prompt.kind, "chooseCards");
}
{
  // BT11-011 [Auto] "If your Leader Card is red: When this card is played from your hand, choose up to 1 of your red Unison Cards and add a marker to it."
  const run = (leader: string, unison = "RUNI757") => {
    const s = mainOf("p1", 7582, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "BT11-011", "hand");
    energyFor(s, "p1", 2);
    const red = stage(s, "p1", unison, "unison");
    return { s, c, red };
  };
  const r = run("L-RED");
  let s = cast(r.s, "p1", r.c);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 1\"");
  assert.ok(q.candidates.includes(r.red), "a red Unison is on offer");
  assert.ok(q.candidates.every((id) => zone(s, "p1", "unison").includes(id)), "Unison Cards only");
  s = choose(s, "p1", [r.red]);
  assert.equal(s.cards[r.red].markers, 1, "a marker was added to the chosen Unison");
  const b = run("L-BLUE");
  assert.notEqual(cast(b.s, "p1", b.c).prompt.kind, "chooseCards", "a blue Leader: the condition fails, nothing to choose");
  // A blue Unison is not a red one: no candidate, so no target is chosen (5-2-6) and no marker is added.
  const u = run("L-RED", "BUNI757");
  const after = cast(u.s, "p1", u.c);
  assert.notEqual(after.prompt.kind, "chooseCards", "only a blue Unison in play: nothing to choose");
  assert.equal(after.cards[u.red].markers, 0);
}
{
  // SD5-03 [Auto] "When you play this card, if your Leader Card is <<Goku's Lineage>>, choose up to 1 of your opponent's Battle Cards and KO it."
  const run = (leader: string) => {
    const s = mainOf("p1", 7583, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "SD5-03", "hand");
    energyFor(s, "p1", 5, "BT4-084");
    const mine = stage(s, "p1", "RED757", "battle");
    const foe = stage(s, "p2", "V-BLUE", "battle");
    const foe2 = stage(s, "p2", "V-BLUE", "battle");
    return { s, c, mine, foe, foe2 };
  };
  const r = run("SD5-01");
  let s = cast(r.s, "p1", r.c);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.deepEqual(sorted(q.candidates), sorted([r.foe, r.foe2]), "only the opponent's Battle Cards");
  s = choose(s, "p1", [r.foe]);
  assert.ok(zone(s, "p2", "drop").includes(r.foe) && !zone(s, "p2", "battle").includes(r.foe), "KO'd: in the Drop Area (5-12)");
  assert.ok(zone(s, "p2", "battle").includes(r.foe2), "the other stays");
  const w = run("L-RED");
  assert.notEqual(cast(w.s, "p1", w.c).prompt.kind, "chooseCards", "a Leader that is not <<Goku's Lineage>>: no KO");
}
{
  // SD5-05 [Auto] "When you play this card, choose up to 1 of your opponent's Rest Mode Battle Cards and KO it."
  const s0 = mainOf("p1", 7584, { p1: "SD5-01", p2: "L-BLUE" });
  const c = stage(s0, "p1", "SD5-05", "hand");
  energyFor(s0, "p1", 3, "BT4-084");
  const resting = stage(s0, "p2", "V-BLUE", "battle");
  s0.cards[resting].mode = "rest";
  const active = stage(s0, "p2", "V-BLUE", "battle");
  let s = cast(s0, "p1", c);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.deepEqual(q.candidates, [resting], "only the Rest Mode Battle Card; the Active one is not on offer");
  s = choose(s, "p1", [resting]);
  assert.ok(zone(s, "p2", "drop").includes(resting) && zone(s, "p2", "battle").includes(active));
  // Only Active Mode Battle Cards: no legal target, nothing is chosen (5-2-6).
  const t0 = mainOf("p1", 7584, { p1: "SD5-01", p2: "L-BLUE" });
  const c2 = stage(t0, "p1", "SD5-05", "hand");
  energyFor(t0, "p1", 3, "BT4-084");
  stage(t0, "p2", "V-BLUE", "battle");
  assert.notEqual(cast(t0, "p1", c2).prompt.kind, "chooseCards");
}
{
  // BT4-089 [Auto] "When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 <<Goku's Lineage>> from among them and add it to your hand, then shuffle your deck."
  const s0 = mainOf("p1", 7585, { p1: "SD5-01", p2: "L-BLUE" });
  const c = stage(s0, "p1", "BT4-089", "hand");
  energyFor(s0, "p1", 1, "BT4-084");
  const [t1, t2, t3] = zone(s0, "p1", "deck");
  s0.cards[t1].cardId = "SD5-02"; s0.cards[t2].cardId = "RED757"; s0.cards[t3].cardId = "SD5-05";
  const fourth = zone(s0, "p1", "deck")[3];
  s0.cards[fourth].cardId = "BT4-097";
  let s = cast(s0, "p1", c);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 1\"");
  assert.deepEqual(sorted(q.candidates), sorted([t1, t3]), "the two <<Goku's Lineage>> cards among the top 3; not the red one, not the 4th card");
  s = choose(s, "p1", [t3]);
  assert.ok(zone(s, "p1", "hand").includes(t3), "added to the hand");
  assert.ok(zone(s, "p1", "deck").includes(t1) && zone(s, "p1", "deck").includes(t2), "the others went back to the deck, which was shuffled");
  assert.equal(zone(s, "p1", "deck").length, zone(s0, "p1", "deck").length - 1);
}

{
  // BT1-014 [Auto] "When this card attacks, you may choose 1 card from your life and add it to your hand. If you do so, this card gains +10000 power and [Double Strike] for the duration of the turn."
  // BT4-012 [Auto] the same with +10000 power and [Critical].
  for (const [id, kw] of [["BT1-014", "Strike"], ["BT4-012", "Critical"]] as const) {
    const s0 = mainOf("p2", 7591);
    const c = stage(s0, "p2", id, "battle");
    const life = zone(s0, "p2", "life").length;
    const hand = zone(s0, "p2", "hand").length;
    const s = attackTo(s0, "p2", c);
    const q = ask(s);
    assert.deepEqual([q.min, q.max], [0, 1], `${id}: "you may choose 1 card from your life" is optional (min 0)`);
    assert.deepEqual(sorted(q.candidates), sorted(zone(s, "p2", "life")), `${id}: every Life card is on offer`);
    const done = choose(s, "p2", [q.candidates[0]]);
    assert.equal(zone(done, "p2", "life").length, life - 1);
    assert.equal(zone(done, "p2", "hand").length, hand + 1);
    assert.equal(attrs(done, c).power, 15000, `${id}: +10000 power ("if you do so", 20-16)`);
    assert.equal(hasKeyword(ctx, game, done, c, kw), true, `${id}: gains [${kw}]`);
    // Declined: "if you do so" is not met (20-16-1).
    const declined = choose(s, "p2", []);
    assert.equal(zone(declined, "p2", "life").length, life);
    assert.equal(attrs(declined, c).power, 5000, `${id}: nothing gained when no card was added`);
    assert.equal(hasKeyword(ctx, game, declined, c, kw), false);
  }
}
{
  // SD5-02 [Auto] "When this card attacks, you may draw 1 card. If you did not draw a card with this skill, this card gains [Double Strike] for the duration of the turn."
  for (const [index, draws] of [[0, true], [1, false]] as const) {
    const s0 = mainOf("p2", 7592);
    const c = stage(s0, "p2", "SD5-02", "battle");
    const hand = zone(s0, "p2", "hand").length;
    let s = attackTo(s0, "p2", c);
    assert.equal(s.prompt.kind, "chooseMode", "\"you may\" asks");
    assert.deepEqual(promptOf(s).options, ["draw 1 card", "Don't"]);
    s = mode(s, "p2", index);
    assert.equal(zone(s, "p2", "hand").length, hand + (draws ? 1 : 0), draws ? "drew 1" : "declined: no draw");
    assert.equal(hasKeyword(ctx, game, s, c, "Strike"), !draws, draws ? "drew: no [Double Strike]" : "did not draw: [Double Strike]");
  }
}
{
  // SD5-01 [Awaken] "When your life is at 4 or less: You may choose up to 2 of your energy, switch them to Active Mode, and flip this card over."
  const s0 = mainOf("p1", 7593, { p1: "SD5-01", p2: "L-BLUE" });
  zone(s0, "p1", "life").splice(4);
  const rest = [0, 1, 2].map(() => stage(s0, "p1", "RED757", "energy"));
  for (const e of rest) s0.cards[e].mode = "rest";
  const awaken = legal(s0).find((l) => l.action.type === "activate" && l.action.card === leaderOf(s0, "p1"));
  assert.ok(awaken, "offered at 4 life");
  let s = play(s0, awaken!.action);
  const q1 = ask(s);
  assert.deepEqual([q1.min, q1.max], [0, 1], "the first of \"up to 2\" energy");
  s = choose(s, "p1", [rest[0]]);
  const q2 = ask(s);
  assert.deepEqual([q2.min, q2.max], [0, 1]);
  assert.ok(!q2.candidates.includes(rest[0]));
  s = choose(s, "p1", [rest[1]]);
  assert.equal(s.cards[rest[0]].mode, "active");
  assert.equal(s.cards[rest[1]].mode, "active");
  assert.equal(s.cards[rest[2]].mode, "rest", "only the two chosen");
  assert.equal(s.cards[leaderOf(s, "p1")].flipped, true, "flipped");
  // 5 life: the condition is not met.
  const t0 = mainOf("p1", 7593, { p1: "SD5-01", p2: "L-BLUE" });
  assert.equal(legal(t0).some((l) => l.action.type === "activate" && l.action.card === leaderOf(t0, "p1")), false, "5 life: not offered");
}
{
  // BT6-025 [Activate: Main] "If your Leader Card is red: Choose up to 1 of your opponent's Battle Cards with 20000 power or less and KO it."
  const run = (leader: string) => {
    const s = mainOf("p1", 7594, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "BT6-025", "hand");
    energyFor(s, "p1", 1);
    const small = stage(s, "p2", "V-BLUE", "battle");
    const exact = stage(s, "p2", "EXACT757", "battle");
    const big = stage(s, "p2", "BIG757", "battle");
    return { s, c, small, exact, big };
  };
  const r = run("L-RED");
  let s = play(r.s, { type: "activate", player: "p1", card: r.c, skill: 0 });
  while (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.ok(q.candidates.includes(r.small), "a 10000-power Battle Card is on offer");
  assert.ok(q.candidates.includes(r.exact), "so is one with exactly 20000 power (\"or less\")");
  assert.ok(!q.candidates.includes(r.big), "a 25000-power one is not");
  s = choose(s, "p1", [r.small]);
  assert.ok(zone(s, "p2", "drop").includes(r.small), "KO'd to the Drop Area");
  assert.ok(zone(s, "p2", "battle").includes(r.big));
  const b = run("L-BLUE");
  assert.equal(legal(b.s).some((l) => l.action.type === "activate" && l.action.card === b.c), false, "a blue Leader: the condition-only price fails, not offered");
}
{
  // TB1-023 [Activate: Main] "Choose all red <<Saiyan>> cards in your Battle Area. They gain [Barrier] until the end of your opponent's next turn."
  const s0 = mainOf("p1", 7595);
  const c = stage(s0, "p1", "TB1-023", "hand");
  const saiyan = stage(s0, "p1", "BT11-011", "battle");
  const saiyan2 = stage(s0, "p1", "BT6-010", "battle");
  const plain = stage(s0, "p1", "RED757", "battle");
  const foe = stage(s0, "p2", "BT11-011", "battle");
  const s = play(s0, { type: "activate", player: "p1", card: c, skill: 0 });
  assert.notEqual(s.prompt.kind, "chooseCards", "\"choose all\" asks nothing");
  assert.equal(hasKeyword(ctx, game, s, saiyan, "Barrier"), true, "a red <<Saiyan>> card in my Battle Area");
  assert.equal(hasKeyword(ctx, game, s, saiyan2, "Barrier"), true);
  assert.equal(hasKeyword(ctx, game, s, plain, "Barrier"), false, "a red non-<<Saiyan>> card does not");
  assert.equal(hasKeyword(ctx, game, s, foe, "Barrier"), false, "nor does the opponent's Saiyan");
}
{
  // SD15-02 [+1][Activate: Main] "Choose up to 1 of your opponent's Battle Cards or Unison Cards and it gets -10000 power for the turn."
  const s0 = mainOf("p1", 7596);
  const u = stage(s0, "p1", "SD15-02", "unison");
  const mine = stage(s0, "p1", "RED757", "battle");
  const foeB = stage(s0, "p2", "V-BLUE", "battle");
  const foeU = stage(s0, "p2", "RUNI757", "unison");
  const act = legal(s0).find((l) => l.action.type === "activate" && l.action.card === u && l.action.skill === 10);
  assert.ok(act, "[+1][Activate: Main] is offered");
  let s = play(s0, act!.action);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.deepEqual(sorted(q.candidates), sorted([foeB, foeU]), "the opponent's Battle Cards and Unison Cards, nothing of mine");
  assert.ok(!q.candidates.includes(mine) && !q.candidates.includes(u));
  s = choose(s, "p1", [foeU]);
  assert.equal(attrs(s, foeU).power, 5000 - 10000, "-10000 for the turn");
  assert.equal(attrs(s, foeB).power, 10000);
  assert.equal(s.cards[u].markers, 1, "[+1] added a marker");
}
{
  // SD15-02 [Auto][Limit 1] "When this card is placed in your Drop Area from your Unison Area, choose up to 1 of your mono-red Leader Cards and it gets +5000 power for the turn."
  const run = (leader: string) => {
    const s = mainOf("p1", 7597, { p1: leader, p2: "L-BLUE" });
    const u = stage(s, "p1", "SD15-02", "unison");
    const next = stage(s, "p1", "RUNI757", "hand");
    energyFor(s, "p1", 2);
    return { s: play(s, { type: "playUnison", player: "p1", card: next, x: 1 }), u };
  };
  const r = run("L-RED");
  assert.ok(zone(r.s, "p1", "drop").includes(r.u), "SD15-02 was placed in the Drop Area from the Unison Area (3-11-5)");
  const q = ask(r.s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.deepEqual(q.candidates, [leaderOf(r.s, "p1")], "my mono-red Leader only (not the opponent's)");
  const s = choose(r.s, "p1", [leaderOf(r.s, "p1")]);
  assert.equal(attrs(s, leaderOf(s, "p1")).power, 10000 + 5000);
  const b = run("L-BLUE");
  assert.notEqual(b.s.prompt.kind, "chooseCards", "a blue Leader is not mono-red: nothing to choose");
}

// ── Battle-time Extra Cards and Counters ───────────────────────────────────
const activateAction = (s: VmState, id: string, skill = 0) => legal(s).find((l) => l.action.type === "activate" && l.action.card === id && l.action.skill === skill)?.action;
const toCombo = (s: VmState): VmState => passUntil(s, (t) => t.prompt.kind === "combo");
const toMain = (s: VmState): VmState => drive(s, (t, o) => o.find((l) => l.action.type === "pass")?.action ?? o.find((l) => l.action.type === "zEnergyFromCombo" && l.action.card === null)?.action ?? o.find((l) => l.action.type === "counter" && l.action.card === null)?.action ?? o.find((l) => l.action.type === "block" && l.action.card === null)?.action, (t) => t.prompt.kind === "main");
{
  // BT1-027 [Activate: Battle] "Choose up to 1 of your red cards. It gains +6000 power for the duration of the battle."
  const s0 = mainOf("p2", 7600, { p1: "L-BLUE", p2: "SD15-01" });
  const c = stage(s0, "p2", "BT1-027", "hand");
  const red = stage(s0, "p2", "BT11-011", "battle");
  const blue = stage(s0, "p2", "BLUE757", "battle");
  const foe = stage(s0, "p1", "RED757", "battle");
  let s = toCombo(attackTo(s0, "p2", leaderOf(s0, "p2")));
  const act = activateAction(s, c);
  assert.ok(act, "[Activate: Battle] is offered at the combo prompt");
  s = play(s, act!);
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 1\"");
  assert.ok(q.candidates.includes(red) && q.candidates.includes(leaderOf(s, "p2")), "my red Battle Card and my red Leader are on offer");
  assert.ok(!q.candidates.includes(blue) && !q.candidates.includes(foe), "not a blue card and not the opponent's red one");
  const base = attrs(s, leaderOf(s, "p2")).power as number;
  s = choose(s, "p2", [leaderOf(s, "p2")]);
  assert.equal(attrs(s, leaderOf(s, "p2")).power, base + 6000, "+6000 in the battle");
  s = toMain(s);
  assert.equal(attrs(s, leaderOf(s, "p2")).power, base, "...and only for the duration of the battle");
}
{
  // BT3-027 [Counter: Attack] "Negate the attack. Then, choose up to 1 of your red <<Saiyan>> Leader Cards. It gains +5000 power for the duration of the turn."
  const run = (leader: string) => {
    const s = mainOf("p2", 7601, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "BT3-027", "hand");
    energyFor(s, "p1", 1);
    return { s: attackTo(s, "p2", leaderOf(s, "p2")), c };
  };
  const r = run("SD15-01");
  events = [];
  let s = play(r.s, counterPaid(r.s, r.c)!);
  assert.ok(events.some((e) => e.type === "attackNegated"), "the attack is negated first");
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.deepEqual(q.candidates, [leaderOf(s, "p1")], "my red <<Saiyan>> Leader");
  const base = attrs(s, leaderOf(s, "p1")).power as number;
  s = choose(s, "p1", [leaderOf(s, "p1")]);
  assert.equal(attrs(s, leaderOf(s, "p1")).power, base + 5000);
  const n = run("L-RED");
  const t = play(n.s, counterPaid(n.s, n.c)!);
  assert.notEqual(t.prompt.kind, "chooseCards", "a red Leader without the <<Saiyan>> trait: no candidate, nothing is chosen (5-2-6)");
}
{
  // BT6-026 [Counter: Attack] "If your Leader Card is red: Negate the attack, then you may choose 1 red card from your hand and place it in your Drop Area. If you do, choose up to 2 of your opponent's Battle Cards, and they get -15000 power for the duration of the turn."
  const run = (leader: string) => {
    const s = mainOf("p2", 7602, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "BT6-026", "hand");
    const red = stage(s, "p1", "RED757", "hand");
    const blue = stage(s, "p1", "BLUE757", "hand");
    energyFor(s, "p1", 1);
    const foes = [stage(s, "p2", "V-BLUE", "battle"), stage(s, "p2", "V-BLUE", "battle")];
    return { s: attackTo(s, "p2", leaderOf(s, "p2")), c, red, blue, foes };
  };
  const r = run("L-RED");
  events = [];
  let s = play(r.s, counterPaid(r.s, r.c)!);
  assert.ok(events.some((e) => e.type === "attackNegated"));
  let q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"you may choose 1\": optional");
  assert.deepEqual(q.candidates, [r.red], "only the red card in hand, not the blue one");
  const declined = choose(s, "p1", []);
  assert.notEqual(declined.prompt.kind, "chooseCards", "declined: \"if you do\" fails, no second choice (20-16-1)");
  assert.equal(attrs(declined, r.foes[0]).power, 10000);
  s = choose(s, "p1", [r.red]);
  assert.ok(zone(s, "p1", "drop").includes(r.red), "the red card was placed in the Drop Area");
  q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 2\" is asked one card at a time");
  assert.deepEqual(sorted(q.candidates), sorted(r.foes), "the opponent's Battle Cards");
  s = choose(s, "p1", [r.foes[0]]);
  q = ask(s);
  assert.ok(!q.candidates.includes(r.foes[0]) && q.candidates.includes(r.foes[1]));
  s = choose(s, "p1", [r.foes[1]]);
  assert.equal(attrs(s, r.foes[0]).power, 10000 - 15000);
  assert.equal(attrs(s, r.foes[1]).power, 10000 - 15000);
  const b = run("L-BLUE");
  assert.equal(counterPaid(b.s, b.c), undefined, "a blue Leader: the condition-only price fails, not offered");
}
{
  // DB1-019 [Activate: Battle] "If your Leader Card is a red <<Saiyan>> card: Choose 1 of your Leader Cards or Battle Cards, and for the duration of the turn, that card gets +5000 power, then if your life is at 3 or less and it's your opponent's turn, choose up to 1 of your red energy, switch it to Active Mode, and draw 1 card."
  const own = mainOf("p2", 7603, { p1: "L-BLUE", p2: "SD15-01" });
  const c = stage(own, "p2", "DB1-019", "hand");
  energyFor(own, "p2", 2);
  const b = stage(own, "p2", "BT11-011", "battle");
  const b2 = stage(own, "p2", "BT6-010", "battle");
  zone(own, "p2", "life").splice(2);
  let s = toCombo(attackTo(own, "p2", leaderOf(own, "p2")));
  s = play(s, activateAction(s, c)!);
  while (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
  // "Leader Cards or Battle Cards" is a printed either/or: the engine asks which kind first, then the card.
  assert.equal(s.prompt.kind, "chooseMode");
  assert.deepEqual(promptOf(s).options, ["Leader Cards", "Battle Cards"]);
  s = mode(s, "p2", 1);
  let q = ask(s);
  assert.deepEqual([q.min, q.max], [1, 1], "\"Choose 1\": mandatory (5-2-3)");
  assert.deepEqual(sorted(q.candidates), sorted([b, b2]), "my Battle Cards (the Leader was the other option)");
  const hand = zone(s, "p2", "hand").length;
  s = choose(s, "p2", [b]);
  assert.equal(attrs(s, b).power, 10000 + 5000, "+5000 for the turn");
  assert.notEqual(s.prompt.kind, "chooseCards", "my own turn: the 3-or-less-life clause does not apply");
  assert.equal(zone(s, "p2", "hand").length, hand, "no draw on my own turn");
  // On the opponent's turn at 3 life or less: the energy is switched to Active Mode and 1 card drawn.
  const def = mainOf("p2", 7604, { p1: "SD15-01", p2: "L-BLUE" });
  const d = stage(def, "p1", "DB1-019", "hand");
  const e = [stage(def, "p1", "RED757", "energy"), stage(def, "p1", "BLUE757", "energy"), stage(def, "p1", "RED757", "energy"), stage(def, "p1", "RED757", "energy")];
  def.cards[e[0]].mode = "rest"; def.cards[e[1]].mode = "rest";
  zone(def, "p1", "life").splice(3);
  let t = attackTo(def, "p2", leaderOf(def, "p2"));
  t = drive(t, (u, o) => o.find((l) => l.action.type === "pass")?.action, (u) => u.prompt.kind === "counter" || u.prompt.kind === "combo");
  if (t.prompt.kind === "counter") t = play(t, legal(t).find((l) => l.action.type === "counter" && l.action.card === null)!.action);
  t = drive(t, (u, o) => o.find((l) => l.action.type === "pass")?.action, (u) => u.prompt.kind === "combo" && (u.prompt as { player: PlayerId }).player === "p1");
  const act = activateAction(t, d);
  assert.ok(act, "offered to the defender at the combo prompt");
  const handD = zone(t, "p1", "hand").length;
  t = play(t, act!);
  while (t.prompt.kind === "payCost") t = play(t, legal(t)[0].action);
  assert.equal(t.prompt.kind, "chooseMode");
  t = mode(t, "p1", 0);
  // One Leader Card: the single legal pick is taken without a question (5-2-5).
  q = ask(t);
  assert.deepEqual([q.min, q.max], [0, 1], "\"choose up to 1 of your red energy\"");
  assert.ok(q.candidates.every((id) => ["RED757"].includes(cardIs(t, id))), "red energy only");
  assert.deepEqual(sorted(q.candidates), sorted([e[0], e[2], e[3]]), "the red energy cards (rested by the cost or before), not the blue one");
  const rested = e[0];
  t = choose(t, "p1", [rested]);
  assert.equal(t.cards[rested].mode, "active", "switched to Active Mode");
  assert.equal(zone(t, "p1", "hand").length, handD - 1 + 1, "DB1-019 left the hand, 1 card drawn");
}
{
  // SD15-04 [Activate: Battle] "{r}, if you have 2 or more mono-red Battle Cards in your Combo Area: Play this card from your hand, then choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn."
  const s0 = mainOf("p2", 7605, { p1: "L-BLUE", p2: "SD15-01" });
  const c = stage(s0, "p2", "SD15-04", "hand");
  const x1 = stage(s0, "p2", "BT11-011", "hand");
  const x2 = stage(s0, "p2", "BT1-014", "hand");
  energyFor(s0, "p2", 4);
  const foe = stage(s0, "p1", "V-BLUE", "battle");
  let s = toCombo(attackTo(s0, "p2", leaderOf(s0, "p2")));
  assert.equal(activateAction(s, c), undefined, "no mono-red card in the Combo Area: the price condition fails");
  s = play(s, { type: "combo", player: "p2", card: x1 });
  while (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
  assert.equal(activateAction(s, c), undefined, "one mono-red Battle Card in the Combo Area: still not offered");
  s = play(s, { type: "combo", player: "p2", card: x2 });
  while (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
  const act = activateAction(s, c);
  assert.ok(act, "two mono-red Battle Cards in the Combo Area: offered");
  s = play(s, act!);
  while (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
  assert.ok(zone(s, "p2", "battle").includes(c), "played from the hand");
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1]);
  assert.deepEqual(q.candidates, [foe], "the opponent's Battle Card only");
  s = choose(s, "p2", [foe]);
  assert.equal(attrs(s, foe).power, 10000 - 10000);
}

// ── The flipped SD15-01 and the Unison / Spirit Boost Autos ────────────────
{
  // SD15-01 back #0 [Auto] "When this card attacks, draw 1 card, then choose up to 1 of your red Unison Cards with a specified cost of 2 and no keyword skills, and it gains [Double Strike] for the turn."
  const run = (unison: string) => {
    const s = mainOf("p2", 7610, { p1: "L-BLUE", p2: "SD15-01" });
    s.cards[leaderOf(s, "p2")].flipped = true;
    const u = stage(s, "p2", unison, "unison");
    return { s, u, hand: zone(s, "p2", "hand").length };
  };
  const r = run("SD15-02");
  const s = attackTo(r.s, "p2", leaderOf(r.s, "p2"));
  assert.equal(zone(s, "p2", "hand").length, r.hand + 1, "drew 1 first");
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 1\"");
  assert.deepEqual(q.candidates, [r.u], "SD15-02: red, specified cost {r}{r}, [Limit 1] / [+1] / [-6] are no keyword skills");
  assert.equal(hasKeyword(ctx, game, s, r.u, "Strike"), false);
  const done = choose(s, "p2", [r.u]);
  assert.equal(hasKeyword(ctx, game, done, r.u, "Strike"), true, "the chosen Unison gains [Double Strike]");
  assert.equal(hasKeyword(ctx, game, choose(s, "p2", []), r.u, "Strike"), false, "chose nobody: nothing granted");
  // A Unison that does have a keyword skill is not on offer.
  const k = run("RBLK757");
  const kq = attackTo(k.s, "p2", leaderOf(k.s, "p2"));
  assert.notEqual(kq.prompt.kind, "chooseCards", "a red {r}{r} Unison with [Blocker]: no candidate, nothing chosen (5-2-6)");
}
{
  // SD15-01 back #10 [Auto][Once per turn][Spirit Boost 1] "When your opponent attacks your red Unison Card with a specified cost of 2, negate the attack, then choose up to 1 of your Unison Cards and it gets +6000 power for the turn."
  const run = () => {
    const s = mainOf("p2", 7611, { p1: "SD15-01", p2: "L-BLUE" });
    s.cards[leaderOf(s, "p1")].flipped = true;
    const u = stage(s, "p1", "SD15-02", "unison");
    s.cards[u].markers = 2;
    return { s, u };
  };
  const r = run();
  let s = attackTo(r.s, "p2", leaderOf(r.s, "p2"), r.u);
  s = payAuto(s, "p1", true);
  assert.equal(s.cards[r.u].markers, 1, "[Spirit Boost 1]: 1 marker removed from the Unison (22-43)");
  const negated = events.some((e) => e.type === "attackNegated");
  assert.ok(negated, "the attack was negated");
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "\"up to 1\"");
  assert.deepEqual(q.candidates, [r.u], "my Unison Card");
  const base = attrs(s, r.u).power as number;
  s = choose(s, "p1", [r.u]);
  assert.equal(attrs(s, r.u).power, base + 6000, "+6000 for the turn");
  // Declined price (9-6-4-1): the attack goes through, no marker is lost.
  const d = run();
  const t = payAuto(attackTo(d.s, "p2", leaderOf(d.s, "p2"), d.u), "p1", false);
  assert.equal(d.s.cards[d.u].markers, 2);
  assert.equal(t.cards[d.u].markers, 2, "declined: markers kept");
  // A Unison without markers cannot pay Spirit Boost: the Auto is not asked about (5-8-2).
  const z = run();
  z.s.cards[z.u].markers = 0;
  const zs = attackTo(z.s, "p2", leaderOf(z.s, "p2"), z.u);
  assert.notEqual(zs.prompt.kind, "chooseMode", "no marker to remove: the price can't be paid");
}
{
  // SD15-03 #20 [Auto][Limit 1][Spirit Boost 1] "When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area."
  // SD15-05 #10 [Auto] "If your opponent has 2 or more energy: When you remove a marker from one of your red Unison Cards using a [Spirit Boost] skill, you may play this card from your hand."
  const run = (oppEnergy: number) => {
    const s = mainOf("p2", 7612, { p1: "SD15-01", p2: "L-BLUE" });
    const goku = stage(s, "p1", "SD15-03", "battle");
    const u = stage(s, "p1", "SD15-02", "unison");
    s.cards[u].markers = 2;
    const five = stage(s, "p1", "SD15-05", "hand");
    energyFor(s, "p1", 4);
    const remover = stage(s, "p2", "REMOVER757", "battle");
    for (let i = 0; i < oppEnergy; i++) stage(s, "p2", "BLUE757", "energy");
    return { s, goku, u, five, remover };
  };
  const answer = (s: VmState, mayPlay: boolean) => drive(s, (t, o) => {
    if (t.prompt.kind === "chooseMode" && promptOf(t).reason.includes("Pay")) return o.find((l) => l.action.type === "chooseMode" && l.action.index === 0)?.action;
    if (t.prompt.kind === "chooseMode") return o.find((l) => l.action.type === "chooseMode" && l.action.index === (mayPlay ? 0 : 1))?.action;
    if (t.prompt.kind === "chooseCards") return o.find((l) => l.action.type === "choose" && l.action.cards.length === (mayPlay ? 1 : 0))?.action;
    return o.find((l) => l.action.type === "optionalCost")?.action ? { type: "optionalCost", player: (t.prompt as { player: PlayerId }).player, pay: true } as Action : undefined;
  }, (t) => t.prompt.kind === "main" && (t.prompt as { player: PlayerId }).player === "p2");
  const r = run(2);
  let s = play(r.s, { type: "activate", player: "p2", card: r.remover, skill: 0 });
  const q = ask(s);
  assert.deepEqual([q.min, q.max], [0, 1], "the opponent's skill: up to 1 Battle Card");
  s = choose(s, "p2", [r.goku]);
  const sawFive = events.some((e) => e.type === "skill" && e.card === r.five);
  s = answer(s, true);
  assert.ok(zone(s, "p1", "battle").includes(r.goku), "SD15-03 chose itself and played itself back from the Drop Area");
  assert.equal(s.cards[r.u].markers, 1, "[Spirit Boost 1] took a marker from the red Unison");
  assert.ok(sawFive || events.some((e) => e.type === "skill" && e.card === r.five), "SD15-05's Auto answered to the marker being removed");
  assert.ok(zone(s, "p1", "battle").includes(r.five), "\"you may play this card from your hand\": it was played");
  // SD15-05 declined: it stays in hand.
  const n = run(2);
  let t = choose(play(n.s, { type: "activate", player: "p2", card: n.remover, skill: 0 }), "p2", [n.goku]);
  t = answer(t, false);
  assert.ok(zone(t, "p1", "hand").includes(n.five), "declined: SD15-05 stays in the hand");
  // The opponent has 1 energy: SD15-05's condition fails.
  const c = run(1);
  let u = choose(play(c.s, { type: "activate", player: "p2", card: c.remover, skill: 0 }), "p2", [c.goku]);
  u = answer(u, true);
  assert.ok(zone(u, "p1", "hand").includes(c.five), "opponent with 1 energy: not played");
  assert.ok(zone(u, "p1", "battle").includes(c.goku), "…but SD15-03 still returned");
}
{
  // BT6-010 #0 [Auto] "At the end of a battle in which you combo with this card from your hand during your opponent's turn, if your Leader Card is red, play this card in Rest Mode."
  // TB1-055 [Auto] "At the end of the battle after you combo with this card from your hand, if your Leader Card is <<Universe 7>>, play this card in Rest Mode."
  const finish = (s: VmState): VmState => toMain(s);
  const defended = (leader: string) => {
    const s = mainOf("p2", 7613, { p1: leader, p2: "L-BLUE" });
    const c = stage(s, "p1", "BT6-010", "hand");
    energyFor(s, "p1", 1);
    let t = attackTo(s, "p2", leaderOf(s, "p2"));
    t = drive(t, (u, o) => o.find((l) => l.action.type === "pass")?.action ?? o.find((l) => l.action.type === "counter" && l.action.card === null)?.action ?? o.find((l) => l.action.type === "block" && l.action.card === null)?.action,
      (u) => u.prompt.kind === "combo" && (u.prompt as { player: PlayerId }).player === "p1");
    t = play(t, { type: "combo", player: "p1", card: c });
    while (t.prompt.kind === "payCost") t = play(t, legal(t)[0].action);
    return { t, c };
  };
  const red = defended("L-RED");
  const redEnd = finish(red.t);
  assert.ok(zone(redEnd, "p1", "battle").includes(red.c), "red Leader, combo from hand on the opponent's turn: played at the end of the battle");
  assert.equal(redEnd.cards[red.c].mode, "rest", "...in Rest Mode");
  const blue = defended("L-BLUE");
  const blueEnd = finish(blue.t);
  assert.ok(!zone(blueEnd, "p1", "battle").includes(blue.c) && zone(blueEnd, "p1", "drop").includes(blue.c), "a blue Leader: not played, the combo card goes to the Drop Area");
  const own = (leader: string) => {
    const s = mainOf("p2", 7614, { p1: "L-BLUE", p2: leader });
    const c = stage(s, "p2", "TB1-055", "hand");
    energyFor(s, "p2", 1);
    let t = toCombo(attackTo(s, "p2", leaderOf(s, "p2")));
    t = play(t, { type: "combo", player: "p2", card: c });
    while (t.prompt.kind === "payCost") t = play(t, legal(t)[0].action);
    return { t, c };
  };
  const u7 = own("SD15-01");
  const u7End = finish(u7.t);
  assert.ok(zone(u7End, "p2", "battle").includes(u7.c), "an <<Universe 7>> Leader: TB1-055 played at the end of the battle");
  assert.equal(u7End.cards[u7.c].mode, "rest", "...in Rest Mode");
  const no = own("L-RED");
  const noEnd = finish(no.t);
  assert.ok(!zone(noEnd, "p2", "battle").includes(no.c), "a Leader without the trait: not played");
}

console.log("#757 U1-b: played price and choice scenarios passed");
export default Promise.resolve();

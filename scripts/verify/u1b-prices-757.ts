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
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
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
  RUNI757: card("RUNI757", { type: "UNISON", colors: ["Red"], energyCost: 1, power: 5000, comboCost: null, comboPower: null, skill: null }),
});

const scripts = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
type Out = { state: VmState; events: GameEvent[] };
const apply = (s: VmState, action: Action): Out => engine.apply(ctx, reload(s), action) as Out;
const legal = (s: VmState) => engine.legalActions(ctx, s);

let events: GameEvent[] = [];
/** Applies actions in order, collecting the events of the whole play in `events`. */
function play(s: VmState, ...actions: Action[]): VmState {
  for (const action of actions) {
    const out = apply(s, action);
    events.push(...out.events);
    s = out.state;
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

console.log("#757 U1-b: played price and choice scenarios passed");
export default Promise.resolve();

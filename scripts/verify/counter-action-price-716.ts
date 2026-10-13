/** #716 (1-6, 5-8, 9-7, 22-10): a [Counter]'s printed price beyond orbs, paid on the strict action-price host. */
// Independent expectations; never derived from the legacy oracle. BT5-023,
// BT6-026 and BT10-008 are the catalog's own text (the #649 audit snapshot);
// the CNT716* cards are synthetic printings of the price shapes 1-6-1 names.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { stepCounterCost } from "../../src/lib/arena/vm/battle";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Requirement } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
};

const defs: Record<string, CardDef> = { ...DEFS,
  "BT5-023": printed("BT5-023"),
  "BT6-026": printed("BT6-026"),
  "BT10-008": printed("BT10-008"),
  // A hand price: the payer picks a card other than the [Counter] itself.
  CNTDISC716: card("CNTDISC716", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Choose 1 card in your hand and place it in your Drop Area: Negate the attack." }),
  // A draw is outside the strict host: a typed #716 gap, never free.
  CNTDRAW716: card("CNTDRAW716", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Draw 1 card: Negate the attack." }),
  // Another card's [Counter: Play], for BT10-008's restriction.
  CNTPLAY716: card("CNTPLAY716", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Play] Draw 1 card." }),
  CNTATK716: card("CNTATK716", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
  FODDER716: card("FODDER716", { colors: ["Green"], skill: null }),
  RED716: card("RED716", { colors: ["Red"], skill: null }),
  // #721: Unisons for BT10-008's [Permanent] "a red Unison Card with 2 or more markers".
  RUNI721: card("RUNI721", { type: "UNISON", colors: ["Red"], energyCost: 1, power: 5000, comboCost: null, comboPower: null, skill: null }),
  BUNI721: card("BUNI721", { type: "UNISON", colors: ["Blue"], energyCost: 1, power: 5000, comboCost: null, comboPower: null, skill: null }),
};

// ── the reading: the three printed price shapes compile to a price record ──
const leaderRed = { kind: "leaderMatches" };
{
  for (const id of ["BT5-023", "BT6-026"]) {
    const line = compileCard(defs[id]).bySkill[0];
    assert.deepEqual(line.unsupported, [], `${id} reads`);
    assert.equal(line.price?.condition?.kind, leaderRed.kind, `${id}: "Your Leader Card is red" is the price's condition (9-1-3)`);
    assert.deepEqual((line.price?.condition as { filter: { colors: string[] } }).filter.colors, ["Red"]);
    assert.equal(line.price?.ops, null, `${id}: no action to carry out`);
  }
  const yamcha = compileCard(defs["BT10-008"]).bySkill[0];
  assert.deepEqual(yamcha.unsupported, []);
  assert.deepEqual(yamcha.price?.ops, [{ op: "forbid", what: "activateCounter", side: "you", until: "turn", counterKind: "play", otherCards: true }],
    "BT10-008: the restriction is the price — [Counter: Play] only, other cards only, for the turn");
  assert.equal(yamcha.price?.condition, null);
  const disc = compileCard(defs.CNTDISC716).bySkill[0];
  assert.ok(disc.price?.ops?.length, "a hand price reads");
  assert.deepEqual(compileCard(defs.CNTDRAW716).bySkill[0].price?.ops, [{ op: "draw", n: 1 }]);
}

const scripts = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function play(s: VmState, ...actions: Action[]): VmState { for (const action of actions) s = apply(s, action).state; return s; }
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "hand" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
const legal = (s: VmState) => engine.legalActions(ctx, s);
const rejected = (s: VmState) => engine.rejectedActions(ctx, s, legal(s));
const offered = (s: VmState, id: string) => legal(s).some((l) => l.action.type === "counter" && l.action.card === id);
const refusal = (s: VmState, id: string): Requirement[] | undefined => rejected(s).find((r) => r.action.type === "counter" && r.action.card === id)?.why;
const counter = (s: VmState, id: string, extra: Partial<Extract<Action, { type: "counter" }>> = {}) => apply(s, { type: "counter", player: "p1", card: id, ...extra } as Action);
const choose = (s: VmState, ids: string[], player: PlayerId = "p1") => apply(s, { type: "choose", player, cards: ids });
const at = (ev: GameEvent[], test: (e: GameEvent) => boolean) => ev.findIndex(test);
const view = (s: VmState, viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 716, revision: 1, mode: "versus", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));

/** Both players through to p2's first Main Phase (p1 went first). */
function toSecondMain(seed: number, blueDefender = false): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: blueDefender ? "L-BLUE" : "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, "p2");
  return s;
}

/**
 * p2 (blue Leader) attacks p1's Leader; p1 holds `hand` and `energy` (all
 * active). Red Leader for p1 unless `blueDefender`.
 */
function defense(hand: string[], energy: string[], blueDefender = false) {
  const s = toSecondMain(7160, blueDefender);
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  const cards = hand.map((id) => stage(s, "p1", id, "hand"));
  const paid = energy.map((id) => stage(s, "p1", id, "energy"));
  return { s, cards, energy: paid };
}
function attack(s: VmState): VmState {
  return play(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] });
}

// ── BT5-023: a condition-only price is offered while it holds ─────────────
{
  const a = defense(["BT5-023"], ["RED716"]);
  const s = attack(a.s);
  assert.equal(s.prompt.kind, "counter", "the counter window opens for BT5-023 (U5)");
  assert.ok(offered(s, a.cards[0]), "red Leader and one energy: offered");
  const rows = engine.abilityAvailability(ctx, s, "p1", legal(s), rejected(s)).filter((r) => r.card === a.cards[0] && r.skill === 0);
  assert.equal(rows[0]?.state, "offered");
  assert.equal(rows[0]?.offers?.[0]?.cost?.energy, 1, "a condition-only price is a complete energy summary");
  const done = counter(s, a.cards[0]);
  const rest = at(done.events, (e) => e.type === "mode" && e.card === a.energy[0] && e.mode === "rest");
  const drop = at(done.events, (e) => e.type === "move" && e.card === a.cards[0] && e.to === "drop");
  const skill = at(done.events, (e) => e.type === "skill" && e.card === a.cards[0]);
  assert.ok(rest >= 0 && rest < drop && drop < skill, "energy, then the card to the Drop (22-10-7), then the skill");
  assert.equal(done.state.prompt.kind, "chooseCards", "its effect asks for its first target");
}
// Under a blue Leader the condition does not hold: refused by the condition, not as unread.
{
  const a = defense(["BT5-023", "CNTATK716"], ["RED716"], true);
  const s = attack(a.s);
  assert.equal(s.prompt.kind, "counter");
  assert.ok(!offered(s, a.cards[0]));
  assert.deepEqual(refusal(s, a.cards[0]), [{ kind: "condition", text: "Your Leader Card is red" }]);
  assert.throws(() => counter(s, a.cards[0]), IllegalAction, "a forged declaration is refused");
  // A forged candidate list is still checked against the condition (5-8-3).
  const forged = reload(s); if (forged.prompt.kind === "counter") forged.prompt.candidates.push(a.cards[0]);
  const before = JSON.stringify(forged);
  assert.throws(() => counter(forged, a.cards[0]), (err: unknown) => err instanceof IllegalAction && /condition/.test((err as Error).message));
  assert.equal(JSON.stringify(forged), before, "nothing was paid");
}
// No energy: refused by the energy, the condition holding.
{
  const a = defense(["BT5-023", "CNTATK716"], []);
  const s = attack(a.s);
  assert.ok(!offered(s, a.cards[0]));
  assert.equal(refusal(s, a.cards[0])?.[0]?.kind, "energy");
}

// ── BT6-026: the same leading condition, then its own effect ───────────────
{
  const a = defense(["BT6-026", "RED716"], ["RED716"]);
  const s = attack(a.s);
  assert.ok(offered(s, a.cards[0]), "BT6-026 is offered under a red Leader (U5)");
  const done = counter(s, a.cards[0]);
  assert.ok(done.events.some((e) => e.type === "skill" && e.card === a.cards[0]));
  assert.ok(done.state.battle?.negated, "Negate the attack");
}

// ── an action price on the strict host ─────────────────────────────────────
{
  // Alone in hand, the [Counter] cannot pay its own price (it is the card
  // being activated): not offered, and the refusal says the price is short.
  const alone = defense(["CNTDISC716", "CNTATK716"].slice(0, 1).concat("CNTATK716"), ["RED716"]);
  // CNTATK716 is the only other card, so it can pay; take it away.
  const t = attack(alone.s);
  assert.ok(offered(t, alone.cards[0]), "another hand card can pay");
  const bare = reload(t); assert.ok(moveCard(bare, game, alone.cards[1], "deck", { owner: "p1" }).ok);
  if (bare.prompt.kind === "counter") bare.prompt.candidates = bare.prompt.candidates.filter((id) => id !== alone.cards[1]);
  assert.ok(!offered(bare, alone.cards[0]), "with nothing else in hand the price cannot be paid in full");
  assert.deepEqual(refusal(bare, alone.cards[0]), [{ kind: "other", detail: "its skill cost cannot be paid in full" }]);
}
{
  const a = defense(["CNTDISC716", "FODDER716", "FODDER716"], ["RED716"]);
  const s = attack(a.s);
  assert.ok(offered(s, a.cards[0]));
  const declared = counter(s, a.cards[0]);
  const d = declared.state;
  assert.equal(d.prompt.kind, "chooseCards", "the price asks which hand card pays");
  assert.equal(d.programs[0].counterCost?.skill.index, 0, "the stored continuation is on the paying frame");
  assert.ok(d.sides.p1.zones.hand.includes(a.cards[0]), "the [Counter] is still in hand while its price is paid");
  assert.equal(d.cards[a.energy[0]].mode, "rest", "the energy half is paid first");
  assert.equal(declared.events.filter((e) => e.type === "skill").length, 0, "nothing is activated yet");
  const candidates = d.prompt.kind === "chooseCards" ? d.prompt.choice.candidates : [];
  assert.deepEqual([...candidates].sort(), [a.cards[1], a.cards[2]].sort(), "the [Counter] itself is not a candidate");
  // Both viewer projections: the payer sees the candidates, the attacker does not.
  assert.ok(view(d, "p1").includes("FODDER716"), "the payer sees the hand candidates");
  assert.ok(!view(d, "p2").includes("FODDER716"), "the opponent's view masks them");
  // Wrong actor, a card that cannot pay, an empty answer: refused, unchanged.
  const before = JSON.stringify(d);
  assert.throws(() => choose(d, [a.cards[1]], "p2"), IllegalAction, "only the payer answers");
  assert.throws(() => choose(d, [a.cards[0]]), IllegalAction, "the [Counter] cannot pay for itself");
  assert.throws(() => choose(d, []), IllegalAction, "the price is not optional");
  assert.equal(JSON.stringify(d), before);
  // Stale: the picked card left the hand since the question was asked.
  const stale = reload(d); assert.ok(moveCard(stale, game, a.cards[1], "deck", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [a.cards[1]]), IllegalAction); assert.equal(JSON.stringify(stale), staleBefore);
  // A JSON reload mid-price resolves the same, and charges once.
  const paid = choose(reload(d), [a.cards[1]]); const again = choose(reload(d), [a.cards[1]]);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "a reload at the price resolves the same");
  assert.equal(JSON.stringify(again.events), JSON.stringify(paid.events));
  const p = paid.state;
  assert.ok(p.sides.p1.zones.drop.includes(a.cards[1]) && p.sides.p1.zones.hand.includes(a.cards[2]), "one card paid, the other kept");
  const priceAt = at(paid.events, (e) => e.type === "move" && e.card === a.cards[1] && e.to === "drop");
  const dropAt = at(paid.events, (e) => e.type === "move" && e.card === a.cards[0] && e.to === "drop");
  const skillAt = at(paid.events, (e) => e.type === "skill" && e.card === a.cards[0]);
  assert.ok(priceAt >= 0 && priceAt < dropAt && dropAt < skillAt, "price, then the card to the Drop, then the skill (5-8-1, 22-10-7)");
  assert.equal(paid.events.filter((e) => e.type === "skill" && e.card === a.cards[0]).length, 1);
  assert.ok(at(paid.events, (e) => e.type === "attackNegated") > skillAt, "the effect resolved after the activation");
  assert.equal(p.sides.p1.zones.life.length, d.sides.p1.zones.life.length, "no damage: the attack was negated");
  assert.ok(!p.programs.some((f) => f.counterCost), "no payment cursor is left behind");
}
// 5-8-4 / 22-10-7-1: a price that can no longer be paid when its turn comes
// fails the activation: the energy stays spent, the card goes to the Drop, no
// skill, no moment, no effect.
{
  const a = defense(["CNTDISC716", "FODDER716", "FODDER716"], ["RED716"]);
  const d = counter(attack(a.s), a.cards[0]).state;
  assert.equal(d.prompt.kind, "chooseCards");
  const s = reload(d);
  const frame = s.programs.shift()!; delete frame.awaiting;
  assert.ok(frame.counterCost, "the paying frame");
  for (const id of [a.cards[1], a.cards[2]]) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  const ev: GameEvent[] = [];
  assert.equal(stepCounterCost(ctx, game, s, ev, frame), "done");
  assert.ok(s.sides.p1.zones.drop.includes(a.cards[0]), "22-10-7-1: the card still goes to the Drop");
  assert.equal(s.cards[a.energy[0]].mode, "rest", "the paid energy is not refunded");
  assert.equal(ev.filter((e) => e.type === "skill").length, 0);
  assert.ok(ev.some((e) => e.type === "note" && /\[Counter\] activation failed/.test(e.text)));
  assert.ok(!s.programs.some((f) => f.card === a.cards[0]), "no effect is queued");
  assert.ok(!s.battle?.negated);
}
// A price outside the strict host is a typed #716 gap: not offered, named in
// the refusal, and a forged declaration stops before anything is paid.
{
  const a = defense(["CNTDRAW716", "CNTATK716"], ["RED716"]);
  const s = attack(a.s);
  assert.ok(!offered(s, a.cards[0]));
  const why = refusal(s, a.cards[0]);
  assert.equal(why?.length, 1); assert.equal(why?.[0].kind, "other");
  assert.match((why?.[0] as { detail: string }).detail, /^not yet: .*draw.*\(#716\)$/);
  const forged = reload(s); if (forged.prompt.kind === "counter") forged.prompt.candidates.push(a.cards[0]);
  const before = JSON.stringify(forged);
  assert.throws(() => counter(forged, a.cards[0]), (err: unknown) => err instanceof NotYet && err.issue === "#716");
  assert.equal(JSON.stringify(forged), before, "no energy and no card moved");
}

// ── BT10-008: the restriction price, then [Counter: Play] of other cards ──
{
  let s = toSecondMain(7161);
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  for (const id of s.sides.p2.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
  const yamcha = stage(s, "p1", "BT10-008", "hand");
  const other = stage(s, "p1", "CNTPLAY716", "hand");
  const atk = stage(s, "p1", "CNTATK716", "hand");
  ["RED716", "RED716", "RED716"].forEach((id) => stage(s, "p1", id, "energy"));
  const first = stage(s, "p2", "V-BLUE", "hand");
  const second = stage(s, "p2", "V-BLUE", "hand");
  stage(s, "p2", "V-BLUE", "energy"); stage(s, "p2", "V-BLUE", "energy");
  const playIt = (u: VmState, id: string) => {
    u = play(u, { type: "play", player: "p2", card: id });
    return u.prompt.kind === "payCost" ? play(u, legal(u)[0].action) : u;
  };
  s = playIt(s, first);
  assert.equal(s.prompt.kind, "counter", "the [Counter: Play] window opens");
  assert.ok(offered(s, yamcha), "BT10-008 is offered: its restriction can always be put in force (U5)");
  const done = counter(s, yamcha);
  const effectAt = at(done.events, (e) => e.type === "effect" && (e as { effect: { forbid?: { what: string } } }).effect.forbid?.what === "activateCounter");
  const skillAt = at(done.events, (e) => e.type === "skill" && e.card === yamcha);
  assert.ok(effectAt >= 0 && effectAt < skillAt, "the restriction is paid before the skill activates");
  let t = done.state;
  // Its effect: up to 2 targets, then "play this card".
  for (let i = 0; i < 6 && t.prompt.kind === "chooseCards" && t.prompt.player === "p1"; i++) t = choose(t, []).state;
  for (let i = 0; i < 6 && t.prompt.kind !== "main"; i++) t = play(t, legal(t)[0].action);
  assert.equal(t.prompt.kind, "main");
  // Where "then play this card" leaves BT10-008 (#716 boundary: it is played
  // from the Drop it was placed in at activation, 22-10-7; see the glossary).
  assert.ok(t.sides.p1.zones.battle.includes(yamcha), "the effect played BT10-008");
  // The rule in force: [Counter: Play] of other cards only, for the turn.
  assert.ok(forbiddenBy(ctx, game, t, "activateCounter", { player: "p1", card: other, skillKind: "counter:play" })?.by === "Yamcha, Merciless Barrage", "another card's [Counter: Play] is forbidden, by BT10-008");
  assert.equal(forbiddenBy(ctx, game, t, "activateCounter", { player: "p1", card: atk, skillKind: "counter:attack" }), null, "a [Counter: Attack] is not");
  assert.equal(forbiddenBy(ctx, game, t, "activateCounter", { player: "p1", card: yamcha, skillKind: "counter:play" }), null, "nor BT10-008's own (other cards only)");
  assert.equal(forbiddenBy(ctx, game, t, "activateCounter", { player: "p2", card: other, skillKind: "counter:play" }), null, "nor the opponent's");
  // Another [Counter: Play] is forbidden for the turn; this card's rule names it.
  t = playIt(t, second);
  assert.notEqual(t.prompt.kind, "counter", "no window: the only [Counter: Play] left is forbidden");
  // A [Counter: Attack] of another card is not: the rule names one kind.
  t = attack(t);
  assert.equal(t.prompt.kind, "counter");
  assert.ok(offered(t, atk), "[Counter: Attack] is still allowed");
  const banned = refusal(t, other);
  assert.ok(!banned || banned[0].kind === "timing", "the [Counter: Play] card is only out of its window here");
}
// ── #721: BT10-008's free alternative needs a RED Unison with 2 or MORE markers ──
{
  /** p1 holds BT10-008 and no energy at all, so only the [Permanent]'s alternative can pay for it. */
  const window = (setup: (s: VmState) => void): { s: VmState; yamcha: string } => {
    let s = toSecondMain(7210);
    for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
    for (const id of s.sides.p1.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
    for (const id of s.sides.p2.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
    const yamcha = stage(s, "p1", "BT10-008", "hand");
    const played = stage(s, "p2", "V-BLUE", "hand");
    stage(s, "p2", "V-BLUE", "energy"); stage(s, "p2", "V-BLUE", "energy");
    setup(s);
    s = play(s, { type: "play", player: "p2", card: played });
    if (s.prompt.kind === "payCost") s = play(s, legal(s)[0].action);
    return { s, yamcha };
  };
  const unison = (s: VmState, p: PlayerId, id: string, markers: number): string => {
    const u = stage(s, p, id, "hand");
    const moved = moveCard(s, game, u, "unison", { owner: p });
    assert.ok(moved.ok, `the Unison is in the Unison Area: ${JSON.stringify(moved)}`);
    s.cards[u].markers = markers;
    return u;
  };
  const cases: [string, (s: VmState) => void, boolean][] = [
    ["no Unison at all", () => undefined, false],
    ["a red Unison with no marker", (s) => { unison(s, "p1", "RUNI721", 0); }, false],
    ["a red Unison with 1 marker", (s) => { unison(s, "p1", "RUNI721", 1); }, false],
    ["a red Unison with 2 markers", (s) => { unison(s, "p1", "RUNI721", 2); }, true],
    ["a red Unison with 5 markers (2 or MORE)", (s) => { unison(s, "p1", "RUNI721", 5); }, true],
    ["a blue Unison with 2 markers", (s) => { unison(s, "p1", "BUNI721", 2); }, false],
    ["only the opponent's red Unison with 3 markers", (s) => { unison(s, "p2", "RUNI721", 3); }, false],
  ];
  for (const [name, setup, expected] of cases) {
    const { s, yamcha } = window(setup);
    assert.equal(s.prompt.kind, expected ? "counter" : s.prompt.kind, name);
    assert.equal(offered(s, yamcha), expected, `BT10-008 with no energy, ${name}: ${expected ? "offered" : "not offered"}`);
  }
  // The filter itself, through both ends of the reading: compile, then the rules engine's matcher.
  const gate = compileCard(defs["BT10-008"]).bySkill[10];
  assert.deepEqual(gate.unsupported, []);
  const cond = (gate.ops[0] as { cond: { kind: string; sel: { filter: { colors: string[]; markersMin: number | null; markersMax: number | null } } } }).cond;
  assert.equal(cond.kind, "count");
  assert.deepEqual([cond.sel.filter.colors, cond.sel.filter.markersMin, cond.sel.filter.markersMax], [["Red"], 2, null], "BT10-008's [Permanent] reads \"a red Unison Card with 2 or more markers\"");
}

console.log("#716: [Counter] condition, action and restriction prices paid on the strict host before activation");

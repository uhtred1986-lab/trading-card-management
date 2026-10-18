/**
 * #1011 (found in #1010): a card's energy cost measured against a player's energy
 * count with any comparator — "choose up to 1 of your opponent's Battle Cards with an
 * energy cost **greater than their current energy**" (BT19-036, DB2-129, P-658, SD12-02 …,
 * about 55 skills). #979 read the one comparison "at most your energy"; the others were
 * read as a choice in the opponent's *Energy Area* ("their current energy" taken for the
 * area), or with the bound dropped (DB1-059, BT7-045: any Battle Card), and #1004 refused
 * the "greater than" form. Now:
 *
 *  - `parseTarget` reads <, <=, >=, > against `your` energy or the opponent's
 *    (`their`, `your opponent's`) and puts the bound on the selector, never an Energy Area;
 *  - `resolveSelector` applies it when the skill runs, at equal / one over / one under,
 *    against the right player's count;
 *  - what has nowhere to apply it (a forbid, a trigger's subject, a noun with no side
 *    named) stays refused.
 *
 * Rules engine only; nothing reads the database. The wordings are the catalog's
 * deckplanet text of 18 Oct 2026, abridged to the clause that matters.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { costEnergyOk, emptyFilter, parseFilter } from "../../src/lib/arena/text/filters";
import { parseTarget } from "../../src/lib/arena/compile/targets";
import { describeScript, validateProgram } from "../../src/lib/arena/vm/script";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";

const compile = (text: string, index = 0) => compileSkill(parseSkills(text)[index]!);
const opsOf = (text: string): Op[] => compile(text).ops;
/** Every choose in a program, however deep (a condition or a mode wraps its branch). */
function chooses(node: unknown, out: Extract<Op, { op: "choose" }>[] = []): Extract<Op, { op: "choose" }>[] {
  if (Array.isArray(node)) for (const x of node) chooses(x, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === "choose") out.push(node as Extract<Op, { op: "choose" }>);
    for (const v of Object.values(node)) chooses(v, out);
  }
  return out;
}

// ── the readings ────────────────────────────────────────────────────────────
type Case = { said: string; flag: "costAtMostEnergy" | "costBelowEnergy" | "costAtLeastEnergy" | "costAboveEnergy"; opponent: boolean };
const CASES: Case[] = [
  { said: "greater than their current energy", flag: "costAboveEnergy", opponent: true }, // BT19-036
  { said: "greater than their energy", flag: "costAboveEnergy", opponent: true }, // BT13-054
  { said: "greater than your opponent's energy", flag: "costAboveEnergy", opponent: true }, // BT23-043
  { said: "greater than or equal to their current energy", flag: "costAtLeastEnergy", opponent: true }, // BT19-041
  { said: "greater than or equal to your opponent's energy", flag: "costAtLeastEnergy", opponent: true }, // BT7-045
  { said: "greater than or equal to your opponent's current energy", flag: "costAtLeastEnergy", opponent: true }, // EX08-06
  { said: "less than or equal to their current energy", flag: "costAtMostEnergy", opponent: true }, // BT18-139
  { said: "less than their current energy", flag: "costBelowEnergy", opponent: true },
  { said: "less than or equal to your current energy", flag: "costAtMostEnergy", opponent: false }, // #979
  { said: "equal or less than your energy", flag: "costAtMostEnergy", opponent: false }, // P-040
  { said: "greater than your energy", flag: "costAboveEnergy", opponent: false },
  { said: "greater than or equal to your current energy", flag: "costAtLeastEnergy", opponent: false },
  { said: "less than your energy", flag: "costBelowEnergy", opponent: false },
];
const FLAGS = ["costAtMostEnergy", "costBelowEnergy", "costAtLeastEnergy", "costAboveEnergy"] as const;
{
  for (const c of CASES) {
    const sel = parseTarget(`up to 1 of your opponent's Battle Cards with an energy cost ${c.said}`);
    assert.ok(sel, c.said);
    assert.deepEqual([sel.side, sel.area, sel.upTo], ["opponent", "battle", true], `${c.said}: the opponent's Battle Area, never an Energy Area`);
    for (const flag of FLAGS) assert.equal(sel.filter?.[flag], flag === c.flag, `${c.said}: ${flag}`);
    assert.equal(sel.filter?.energyOfOpponent, c.opponent, `${c.said}: whose energy`);
    assert.equal(sel.filter?.unreadable, false);
    // The words survive the program's own description.
    assert.ok(/energy cost (?:less|greater)/.test(describeScript([{ op: "choose", sel, var: "c0" } as unknown as Op])), `${c.said}: the reading says it`);
  }
  // Another place, "ignoring [Barrier]" and a typo are no obstacle (P-658, BT31-109).
  assert.equal(parseTarget("up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy, ignoring [Barrier]")?.filter?.costAboveEnergy, true);
  // "whose energy cost is …" (P-434b): the bound, and the area the card comes from.
  const villain = parseTarget("up to 1 ≪Villainous≫ card whose energy cost is less than or equal to your energy from your hand");
  assert.deepEqual([villain?.area, villain?.filter?.costAtMostEnergy, villain?.filter?.traits], ["hand", true, ["Villainous"]]);
  // A bare noun names no side (DB1-059, EX08-06): not guessed.
  assert.equal(parseTarget("1 Battle Card with an energy cost greater than or equal to your opponent's energy"), null, "no side named: unread, not your own Battle Area");
  // Two descriptions with one bound are not bound to both.
  assert.equal(parseTarget("1 red <A> card or 1 blue <B> card of your opponent's with an energy cost greater than their current energy"), null);
  // A description that reaches `parseFilter` whole — a forbid, a trigger subject — has nowhere to apply it.
  for (const c of CASES.filter((x) => x.flag !== "costAtMostEnergy" || x.opponent)) assert.equal(parseFilter(`Battle Card with an energy cost ${c.said}`).unreadable, true, `${c.said}: refused where it cannot be applied`);
  assert.equal(parseFilter("Battle Card with an energy cost less than or equal to your current energy").costAtMostEnergy, true, "#979 unchanged");
  assert.ok(compile("[Permanent] When this card is in Rest Mode, your opponent's Battle Cards with energy costs greater than or equal to their current energy can't attack Leader Cards.").unsupported.length > 0, "P-299: a forbid stays unread");
  assert.ok(compile("[Activate: Main] Your opponent can't attack with Battle Cards with energy costs greater than their current energy until the end of their next turn.").unsupported.length > 0, "EX12-02: stays unread");

  // The skills themselves, whole.
  for (const [id, text] of [
    ["BT19-036", "[auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy and place it at the bottom of its owner's deck, and this card gets +5000 power for the turn."],
    ["BT7-045", "[Activate: Main] Choose 1 of your opponent's Battle Cards with an energy cost greater than or equal to your opponent's energy and return it to its owner's hand."],
    ["BT18-139", "[Activate: Main] Choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to their current energy and send it to its owner's Warp. Additionally, if your Leader is a ≪Demon God≫ card, draw 1 card."],
    ["P-040", "[Activate: Main] Choose up to 1 of the opponent's Battle Card with an energy cost equal or less than your energy and KO it."],
    ["BT31-109", "[activate: main] If your opponent has 2 or more energy: Choose up to 1 of your opponent's Battle Cards with an energy cost less then or equal to their current energy, ignoring [barrier], send it to its owner's Warp, and place up to 2 black cards from your Warp into its owner's Drop."],
  ] as const) {
    const out = compile(text);
    assert.equal(out.unsupported.length, 0, `${id} reads whole`);
    const choose = chooses(out.ops).find((c) => "sel" in c && c.sel.area === "battle");
    assert.ok(choose && "sel" in choose && choose.sel.area === "battle" && choose.sel.side === "opponent" && choose.sel.filter && FLAGS.some((f) => choose.sel.filter![f]), `${id}: an opponent's-Battle-Area choice carrying the bound`);
    assert.equal(validateProgram(out.ops), true, `${id}: the stored form validates`);
  }
  // BT16-026: the bound stays on its own choice, and the later clause acts on that card, not on the blue energy.
  const bt16 = opsOf("[Auto][Once per turn] Switch this card to Rest Mode: When you take damage from an opponent's attack, switch up to 1 of your blue energy to Active Mode, then choose up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy and return it to its owner's hand.");
  const found = chooses(bt16);
  assert.equal(found.length, 2);
  assert.equal(found[0].sel.area, "energy");
  assert.deepEqual([found[1].sel.area, found[1].sel.side, found[1].sel.filter?.costAboveEnergy], ["battle", "opponent", true]);
  const move = bt16.find((o) => o.op === "moveTo");
  const second = (found[1] as unknown as { as?: string }).as;
  assert.ok(second && JSON.stringify(move).includes(second), "the return-to-hand acts on the second choice, not on the blue energy");
  assert.ok(!JSON.stringify(move).includes((found[0] as unknown as { as?: string }).as ?? "?"));
  // BT31-109's typo no longer splits the clause: one choose, with the bound.
  assert.equal(opsOf("[activate: main] Choose up to 1 of your opponent's Battle Cards with an energy cost less then or equal to their current energy and send it to its owner's Warp.").filter((o) => o.op === "choose").length, 1);

  // The comparison itself.
  const f = { ...emptyFilter() };
  for (const [flag, expect] of [
    ["costBelowEnergy", [true, false, false]],
    ["costAtMostEnergy", [true, true, false]],
    ["costAtLeastEnergy", [false, true, true]],
    ["costAboveEnergy", [false, false, true]],
  ] as const) assert.deepEqual([4, 5, 6].map((cost) => costEnergyOk({ ...f, [flag]: true }, cost, 5)), expect, flag);
  assert.equal(costEnergyOk(f, 99, 0), true, "no bound, no test");
}

// ── in a game ───────────────────────────────────────────────────────────────
const WORD = { costBelowEnergy: "less than", costAtMostEnergy: "less than or equal to", costAtLeastEnergy: "greater than or equal to", costAboveEnergy: "greater than" } as const;
const KEPT: Record<(typeof FLAGS)[number], (cost: number, n: number) => boolean> = {
  costBelowEnergy: (c, n) => c < n,
  costAtMostEnergy: (c, n) => c <= n,
  costAtLeastEnergy: (c, n) => c >= n,
  costAboveEnergy: (c, n) => c > n,
};
const leader = (id: string, skill: string) => card(id, { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = { ...DEFS, "E-ENERGY": card("E-ENERGY", { colors: ["Red"], skill: null }) };
for (const flag of FLAGS) {
  defs[`ET-${flag}`] = leader(`ET-${flag}`, `[Activate: Main] Choose up to 1 of your opponent's Battle Cards with an energy cost ${WORD[flag]} their current energy and KO it.`);
  defs[`EY-${flag}`] = leader(`EY-${flag}`, `[Activate: Main] Choose up to 1 of your opponent's Battle Cards with an energy cost ${WORD[flag]} your energy and KO it.`);
}
// BT9-056's shape: a count of the opponent's cards over the bound, as a condition.
defs["E-COND"] = leader("E-COND", "[Activate: Main] If your opponent has a Battle Card in play with an energy cost greater than their current energy: Draw 1 card.");
for (let cost = 0; cost <= 14; cost++) defs[`BB-${cost}`] = card(`BB-${cost}`, { colors: ["Blue"], energyCost: cost, skill: null });
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

function main(leaderId: string): VmState {
  let state = RULES.createGame(ctx, { seed: 1011, p1: { name: "You", leader: leaderId, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = RULES.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = RULES.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: string, area: "hand" | "energy" | "battle" | "drop", player: PlayerId = "p1"): string {
  const physical = state.sides[player].zones.deck[0];
  assert.ok(physical);
  state.cards[physical].cardId = id;
  assert.ok(moveCard(state, game, physical, area, { owner: player }).ok);
  return physical;
}
function take(state: VmState, action: Action): VmState {
  assert.ok(RULES.legalActions(ctx, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), JSON.stringify({ prompt: state.prompt, action }));
  return RULES.apply(ctx, JSON.parse(JSON.stringify(state)), action).state as VmState;
}
const candidates = (state: VmState): string[] => (state.prompt.kind === "chooseCards" ? state.prompt.choice.candidates : []);
const activate = (state: VmState) => take(state, { type: "activate", player: "p1", card: state.sides.p1.zones.leader[0], skill: 0 });
const energyOf = (state: VmState, player: PlayerId) => state.sides[player].zones.energy.length;
/** Give each player a different energy count so that "yours" and "theirs" cannot be confused. */
function counts(state: VmState): { mine: number; theirs: number; decoy: string } {
  stage(state, "E-ENERGY", "energy", "p1");
  for (let i = 0; i < 3; i++) stage(state, "E-ENERGY", "energy", "p2");
  // A Battle Card in the opponent's Energy Area: what the old misreading chose.
  const decoy = stage(state, "BB-6", "energy", "p2");
  const mine = energyOf(state, "p1"), theirs = energyOf(state, "p2");
  assert.ok(Math.abs(mine - theirs) >= 2 && mine >= 1 && theirs + 2 <= 14, `counts ${mine} / ${theirs}`);
  return { mine, theirs, decoy };
}

for (const flag of FLAGS) {
  for (const whose of ["ET", "EY"] as const) {
    const state = main(`${whose}-${flag}`);
    const { mine, theirs, decoy } = counts(state);
    const n = whose === "ET" ? theirs : mine; // "their current energy" is the opponent's; "your energy" the master's
    const other = whose === "ET" ? mine : theirs;
    const staged = new Map<number, string>();
    for (const cost of [n - 1, n, n + 1]) staged.set(cost, stage(state, `BB-${cost}`, "battle", "p2"));
    // A cost sitting exactly on the *other* count's edge must not be mistaken for the bound.
    for (const cost of [other - 1, other, other + 1]) if (!staged.has(cost) && cost >= 0 && cost <= 14) staged.set(cost, stage(state, `BB-${cost}`, "battle", "p2"));
    const mineOnOffer = stage(state, `BB-${n}`, "battle", "p1");
    const energyArea = decoy;
    const started = activate(state);
    const offered = candidates(started);
    const expected = [...staged].filter(([cost]) => KEPT[flag](cost, n)).map(([, id]) => id);
    assert.deepEqual(offered.slice().sort(), expected.slice().sort(), `${whose} ${flag}: n=${n} (mine ${mine}, theirs ${theirs}); equal ${staged.get(n) && offered.includes(staged.get(n)!)}, one under ${offered.includes(staged.get(n - 1)!)}, one over ${offered.includes(staged.get(n + 1)!)}`);
    assert.equal(offered.includes(staged.get(n)!), KEPT[flag](n, n), `${whose} ${flag}: equal`);
    assert.equal(offered.includes(staged.get(n - 1)!), KEPT[flag](n - 1, n), `${whose} ${flag}: one under`);
    assert.equal(offered.includes(staged.get(n + 1)!), KEPT[flag](n + 1, n), `${whose} ${flag}: one over`);
    assert.ok(!offered.includes(mineOnOffer) && !offered.includes(energyArea), `${whose} ${flag}: neither my own Battle Card nor the opponent's Energy Area is on offer`);
    // The count is read when the skill runs: the saved choice reloads and stays the same, and a card outside it cannot be taken.
    assert.deepEqual(candidates(JSON.parse(JSON.stringify(started)) as VmState).slice().sort(), offered.slice().sort());
    const refused = [...staged].find(([cost]) => !KEPT[flag](cost, n));
    if (refused) assert.throws(() => RULES.apply(ctx, JSON.parse(JSON.stringify(started)) as VmState, { type: "choose", player: "p1", cards: [refused[1]] }), `${whose} ${flag}: cost ${refused[0]} cannot be chosen by hand`);
    if (offered.length) {
      const pick = offered[0];
      const done = take(started, { type: "choose", player: "p1", cards: [pick] });
      assert.ok(!done.sides.p2.zones.battle.includes(pick), `${whose} ${flag}: the chosen card is KO'd`);
      assert.ok(done.sides.p2.zones.energy.includes(energyArea), "the opponent's Energy Area is untouched");
    }
  }
}

// The count follows the energy area as it grows, for the opponent's wording (BT19-036): two more energy moves the line.
{
  const state = main("ET-costAboveEnergy");
  const { theirs } = counts(state);
  const high = stage(state, `BB-${theirs + 2}`, "battle", "p2");
  const edge = stage(state, `BB-${theirs}`, "battle", "p2");
  assert.deepEqual(candidates(activate(state)), [high], "over their energy, not at it");
  stage(state, "E-ENERGY", "energy", "p2");
  stage(state, "E-ENERGY", "energy", "p2");
  const after = candidates(activate(state));
  assert.ok(!after.includes(high) && !after.includes(edge), "two more energy and neither card is over it any more: recounted each time");
}

// A condition counting the opponent's cards over the bound (BT9-056): equal does not count, one over does.
{
  const read = compile("[Activate: Main] If your opponent has a Battle Card in play with an energy cost greater than their current energy: Draw 1 card.");
  assert.equal(read.unsupported.length, 0);
  for (const [offset, draws] of [[-1, false], [0, false], [1, true]] as const) {
    const state = main("E-COND");
    const { theirs } = counts(state);
    stage(state, `BB-${theirs + offset}`, "battle", "p2");
    const before = state.sides.p1.zones.hand.length;
    const label = `condition at cost ${theirs}${offset >= 0 ? "+" : ""}${offset}`;
    // The skill's condition is its validity (9-1-3): false, it cannot be activated at all.
    const activatable = RULES.legalActions(ctx, state).some((row) => row.action.type === "activate");
    assert.equal(activatable, draws, label);
    if (draws) assert.equal(activate(state).sides.p1.zones.hand.length - before, 1, label);
  }
}

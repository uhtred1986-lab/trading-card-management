/**
 * #742: "[Permanent] (If …,) you can activate this card's [Activate: Battle]
 * skill from your hand without paying its energy cost" — a standing waiver of
 * the energy cost an Extra pays when that line is activated from the hand
 * (12-2-2-2, 5-3), read as `altCost` with `for: "activate:battle"`. It used to
 * read "choose this card, play the chosen cards".
 *
 * Readings are the catalog text (deckplanet, 13 Oct 2026). The scenario runs
 * on whichever engine `--engine` named, so `npm test` proves both.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript } from "../../src/lib/arena/vm/script";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, ENGINE, IMPL, arenaG, card, leaderOf, moveG, powerOfG, unisonOf, zoneOf } from "./harness";

// ── readings ────────────────────────────────────────────────────────────────

const BT14_059 =
  "[Permanent] If you have a blue Unison Card with a specified cost of 3 in play, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.<br>[Activate: Battle][Limit 1] (You can only activate this skill once per turn across all copies of this card.) [Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) If your Leader Card is a mono-blue <Trunks: Youth> card: Draw 1 card, then choose up to 1 of your Leader Cards or Unison Cards and it gets +10000 power for the battle.";
const BT9_017 =
  "[Permanent] You can activate this card's [Activate: Battle] from your hand without paying its energy cost.<br>[Activate: Main] If your Leader Card is red: Choose up to 2 of your opponent's Battle Cards, ignoring [Barrier], and they get -25000 power for the duration of the turn.<br>[Activate: Battle] Choose up to 1 of your Leader Cards or Battle Cards and it gets +5000 power for the duration of the battle.";

// Every catalog card in the family (deckplanet, 13 Oct 2026): the [Permanent]
// line as printed, and the condition it opens with (null for none).
const FAMILY: [string, string, string | null][] = [
  ["BT9-017", "[Permanent] You can activate this card's [Activate: Battle] from your hand without paying its energy cost.", null],
  ["BT9-036", "[Permanent] You can activate this card's [Activate: Battle] from your hand without paying its energy cost.", null],
  ["BT9-051", "[Permanent] You can activate this card's [Activate: Battle] from your hand without paying its energy cost.", null],
  ["BT9-067", "[Permanent] You can activate this card's [Activate: Battle] from your hand without paying its energy cost.", null],
  ["BT9-086", "[Permanent] You can activate this card's [Activate: Battle] from your hand without paying its energy cost.", null],
  ["BT13-120", "[Permanent] If you have 1 or more mono-yellow energy in Active Mode, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.", "count"],
  ["BT13-151", "[Permanent] If your opponent has 3 or more cards in their Warp, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.", "count"],
  ["BT14-059", "[Permanent] If you have a blue Unison Card with a specified cost of 3 in play, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.", "count"],
  ["BT15-057", "[Permanent] If your Leader Card is a ≪Universe 6≫ card, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.", "leaderMatches"],
  ["BT16-019", "[Permanent] If your Leader Card is a mono-red ≪Universe 7≫ card, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.", "leaderMatches"],
  ["EX13-28", "[Permanent] If you have a ≪Great Ape≫ card in play in your Battle Area, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.", "count"],
];
for (const [id, printed, cond] of FAMILY) {
  const read = compileSkill(parseSkills(printed)[0]!);
  assert.deepEqual(read.unsupported, [], `${id}: the whole line reads`);
  const flat = JSON.stringify(read.ops);
  assert.ok(!flat.includes('"op":"play"') && !flat.includes('"op":"choose"'), `${id}: nothing is played or chosen — an Extra is never played (12-1-1)`);
  const alt = cond ? (read.ops[0] as { op: string; cond: { kind: string }; then: unknown[] }) : null;
  if (alt) {
    assert.equal(alt.op, "if", `${id}: the opening condition gates the waiver`);
    assert.equal(alt.cond.kind, cond, `${id}: the condition is the printed one`);
  }
  const body = alt ? alt.then : read.ops;
  assert.deepEqual(body, [{ op: "altCost", pay: "none", for: "activate:battle" }], `${id}: the energy cost of this card's [Activate: Battle] is waived`);
  assert.match(describeScript(read.ops), /this card's \[Activate: Battle\] may be activated from your hand for no energy/, `${id}: the reading says so`);
}
// The [Counter] form is unchanged (BT10-008's shape), and a price the engines
// cannot charge for this line is refused rather than read as a play.
assert.deepEqual(
  compileSkill(parseSkills("[Permanent] You can activate this card's [Counter] skill from your hand without paying its energy cost.")[0]!).ops.at(-1),
  { op: "altCost", pay: "none" },
  "the [Counter] waiver still defaults to `for: counter`",
);
{
  const priced = compileSkill(parseSkills("[Permanent] You can activate this card's [Activate: Battle] skill from your hand without paying its energy cost by choosing 1 other card in your hand and discarding it.")[0]!);
  assert.ok(!JSON.stringify(priced.ops).includes('"op":"play"'), "an action price for this line is not read as a play");
  assert.ok(priced.unsupported.length > 0, "…it is left unread (no card prints one; `altCostFor` charges action prices only for a [Counter])");
}

// ── the game ────────────────────────────────────────────────────────────────

DEFS["C742-TRUNKS"] = card("C742-TRUNKS", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Trunks: Youth"], skill: null });
DEFS["C742-BT14"] = card("C742-BT14", { type: "EXTRA", colors: ["Blue"], energyCost: 1, power: null, comboCost: null, comboPower: null, characters: ["Trunks: Youth"], skill: BT14_059 });
DEFS["C742-BT9"] = card("C742-BT9", { type: "EXTRA", colors: ["Red"], energyCost: 3, power: null, comboCost: null, comboPower: null, skill: BT9_017 });
DEFS["C742-UNI3"] = card("C742-UNI3", { type: "UNISON", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 5000, skill: null, specifiedCost: { Blue: 3 } });
DEFS["C742-UENERGY"] = card("C742-UENERGY", { colors: ["Blue"], skill: null });
DEFS["C742-UNI2"] = card("C742-UNI2", { type: "UNISON", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, power: 5000, skill: null, specifiedCost: { Blue: 2 } });
const ctx = { ...CTX, defs: DEFS };
void ctx;

type Rows = ReturnType<typeof IMPL.legalActions>;
const rows = (s: EngineState): Rows => IMPL.legalActions(CTX, s);
const take = (s: EngineState, action: Action): { state: EngineState; events: GameEvent[] } => {
  assert.ok(rows(s).some((r) => JSON.stringify(r.action) === JSON.stringify(action)), `${ENGINE}: ${JSON.stringify(action)} is not offered at ${s.prompt.kind}: ${JSON.stringify(rows(s).map((r) => r.label))}`);
  return IMPL.apply(CTX, JSON.parse(JSON.stringify(s)) as EngineState, action);
};
const reload = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;

function stage(s: EngineState, cardId: string, area: "hand" | "energy" | "unison"): string {
  const id = zoneOf(s, "p1", "deck").find((x) => s.cards[x].cardId === "V1");
  assert.ok(id, "the fixture deck has a spare card");
  s.cards[id].cardId = cardId;
  moveG(s, id, area, "p1");
  if (area !== "hand") s.cards[id].mode = "active";
  return id;
}

/** p1's Main Phase with a mono-blue <Trunks: Youth> Leader, a Unison (or none) and some energy. */
function board(opts: { unison?: "C742-UNI3" | "C742-UNI2" | null; markers?: number; energy?: number; hand?: string[] }): { s: EngineState; unison: string | null; hand: string[]; energy: string[] } {
  const s = arenaG();
  s.cards[leaderOf(s, "p1")].cardId = "C742-TRUNKS";
  const unison = opts.unison === null ? null : stage(s, opts.unison ?? "C742-UNI3", "unison");
  if (unison) s.cards[unison].markers = opts.markers ?? 2;
  const energy = Array.from({ length: opts.energy ?? 0 }, () => stage(s, "C742-UENERGY", "energy"));
  const hand = (opts.hand ?? ["C742-BT14"]).map((id) => stage(s, id, "hand"));
  assert.equal(s.prompt.kind, "main");
  if (unison) assert.equal(unisonOf(s, "p1"), unison);
  return { s, unison, hand, energy };
}

/** Attack the opponent's Leader with p1's and answer the defender until p1's combo prompt (8-2, 8-3). */
function toCombo(s: EngineState): EngineState {
  s = take(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1"), target: leaderOf(s, "p2") }).state;
  for (let i = 0; i < 12; i++) {
    const p = s.prompt as { kind: string; player?: PlayerId };
    if (p.kind === "combo" && p.player === "p1") return s;
    const pass = rows(s).find((r) => "player" in r.action && r.action.player === "p2" && (r.action.type === "pass" || (r.action.type === "block" && r.action.card === null)));
    assert.ok(pass, `${ENGINE}: the battle stopped at ${p.kind} (${p.player}) with no pass for p2: ${JSON.stringify(rows(s).map((r) => r.action))}`);
    s = IMPL.apply(CTX, s, pass.action).state;
  }
  throw new Error(`${ENGINE}: never reached p1's combo prompt`);
}

const battleRows = (s: EngineState, id: string): Rows => rows(s).filter((r) => r.action.type === "activate" && r.action.card === id);
const isAlt = (r: Rows[number]): boolean => (r.action as { alt?: boolean }).alt === true;

// 1. BT14-059 with the blue {u}{u}{u} Unison and no energy at all: the
//    [Activate: Battle] is offered at the combo prompt for no energy, and only
//    so — its full price (1 energy) cannot be paid.
{
  const { s: main, unison, hand: [bt14] } = board({ energy: 0 });
  assert.equal(battleRows(main, bt14).length, 0, "[Activate: Battle] is not a Main Phase skill (9-1-2): the waiver does not change the line's timing");
  const combo = toCombo(main);
  const offered = battleRows(combo, bt14);
  assert.equal(offered.length, 1, `${ENGINE}: one row, the waived one: ${JSON.stringify(offered.map((r) => r.label))}`);
  assert.ok(isAlt(offered[0]!), "the row is the alternative price");
  assert.match(offered[0]!.label, /for no energy/, "and it says so");

  const handBefore = zoneOf(combo, "p1", "hand").length;
  const taken = take(combo, offered[0]!.action);
  let s = taken.state;
  const events = [...taken.events];
  assert.ok(zoneOf(s, "p1", "drop").includes(bt14), "12-2-2-2: the Extra is placed in the Drop as it is activated");
  assert.ok(!zoneOf(s, "p1", "battle").includes(bt14), "…and is not played");
  assert.equal(s.cards[unison!].markers, 1, "[Spirit Boost 1] still takes its marker (12-2-2-3)");

  // Answer what the skill and the opponent's counter timing ask, reloading at
  // p1's first decision to prove the question survives a save.
  let reloaded = false;
  for (let i = 0; i < 16; i++) {
    const p = s.prompt as { kind: string; player?: PlayerId };
    if (p.kind === "combo" && p.player === "p1") break;
    if (p.player === "p1" && !reloaded) {
      const a = rows(s)[0]!.action;
      const here = IMPL.apply(CTX, reload(s), a);
      const there = IMPL.apply(CTX, reload(reload(s)), a);
      assert.deepEqual(there.state, here.state, `${ENGINE}: the ${p.kind} question resolves identically after a reload`);
      reloaded = true;
    }
    const mine = rows(s).filter((r) => "player" in r.action && r.action.player === p.player);
    const pick =
      mine.find((r) => r.action.type === "chooseMode" && (r.action as { index: number }).index === 0) ??
      mine.find((r) => r.action.type === "choose" && (r.action as { cards: string[] }).cards.includes(leaderOf(s, "p1"))) ??
      mine.find((r) => r.action.type === "pass") ??
      mine[0];
    assert.ok(pick, `${ENGINE}: stopped at ${p.kind}`);
    const next = IMPL.apply(CTX, s, pick.action);
    s = next.state;
    events.push(...next.events);
  }
  assert.equal(s.prompt.kind, "combo", `${ENGINE}: back at p1's combo prompt once the skill resolved`);
  assert.equal(zoneOf(s, "p1", "hand").length, handBefore - 1 + 1, "the Extra left the hand and the skill drew 1");
  assert.equal(events.filter((e) => e.type === "draw").length >= 1, true, "Draw 1 card");
  assert.equal(powerOfG(s, leaderOf(s, "p1")), 20000, "the Leader gets +10000 for the battle");
  assert.ok(ENGINE !== "rules" || reloaded, "the rules engine asked p1 something to reload at");
}

// 2. The condition gates the waiver: no Unison, or a {u}{u} one — only the
//    full price is offered, and with no energy nothing is.
for (const unison of [null, "C742-UNI2"] as const) {
  const { s, hand: [bt14] } = board({ unison, energy: 0 });
  assert.equal(battleRows(toCombo(s), bt14).filter(isAlt).length, 0, `${ENGINE}: ${unison ?? "no Unison"}: no waiver`);
}
{
  const { s, hand: [bt14] } = board({ unison: "C742-UNI2", energy: 1 });
  const offered = battleRows(toCombo(s), bt14);
  assert.deepEqual(offered.map(isAlt), [false], `${ENGINE}: without the condition the line is still offered at its full price`);
}

// 3. The waiver is not the line's whole price: with no marker on the Unison,
//    [Spirit Boost 1] cannot be paid and the waived row is not offered.
{
  const { s, hand: [bt14] } = board({ markers: 0, energy: 0 });
  assert.equal(battleRows(toCombo(s), bt14).length, 0, `${ENGINE}: no marker, no activation`);
}

// 4. With energy to pay, both rows are offered side by side.
{
  const { s, hand: [bt14] } = board({ energy: 1 });
  assert.deepEqual(battleRows(toCombo(s), bt14).map(isAlt).sort(), [false, true], `${ENGINE}: full price and the waiver`);
}

// 5. BT9-017: only the [Activate: Battle] is waived. Its [Activate: Main]
//    keeps its price (3 energy), so with none it is not offered at all.
{
  const { s, hand: [bt9] } = board({ unison: null, energy: 0, hand: ["C742-BT9"] });
  assert.equal(battleRows(s, bt9).length, 0, `${ENGINE}: [Activate: Main] is not waived`);
  const combo = toCombo(s);
  const offered = battleRows(combo, bt9);
  assert.equal(offered.length, 1);
  assert.ok(isAlt(offered[0]!));
  const done = take(combo, offered[0]!.action).state;
  assert.ok(zoneOf(done, "p1", "drop").includes(bt9), "BT9-017 goes to the Drop");
}

for (const id of Object.keys(DEFS).filter((k) => k.startsWith("C742-"))) delete DEFS[id];
console.log(`  #742: [Activate: Battle] cost waiver readings (11 catalog cards) and ${ENGINE}-engine scenarios passed`);

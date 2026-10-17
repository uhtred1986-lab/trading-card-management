/**
 * #966: shared readers for the commonest price shapes #961 left unread. Printed
 * text -> compile -> stored-row JSON round-trip -> the real VM, per group:
 *
 *   1. "If your Leader is red and―your Leader is a Z-Leader, or you have 2 or more
 *      Z-Energy, or you have a Z-Battle Card in play:" (BT19-028 and eleven more)
 *      is the Leader colour AND one of three alternatives.
 *   2. "if your Leader is a <A> or <B> card—both yellow—and …" (BT20-091 and a
 *      dozen more): the colour holds for every name in the list.
 *   3. "Place 1 card from your life to the Drop Area:" (BT1-065) and "you place 1
 *      card in your Drop Area from your life" (BT13-099): a price that is paid,
 *      and that makes the skill unavailable when the Life Area is empty.
 *
 * Shapes outside those stay unread (the controls at the end).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const one = (text: string) => parseSkills(text)[0]!;
const unread = (text: string) => compileSkill(one(text)).unsupported.length > 0;
const reads = (text: string) => compileSkill(one(text)).unsupported.length === 0;

// ── printed text (Bandai card list / deckplanet feed, 17 Oct 2026) ───────────
const Z_TAIL = "your Leader is a Z-Leader, or you have 2 or more Z-Energy, or you have a Z-Battle Card in play: When this card is used in a combo, draw 1 card.";
const BT19_028 = `[Auto] If your Leader is red and―${Z_TAIL}`;
const BT27_023 = `[Auto] If your Leader is red and -- ${Z_TAIL}`;
const BT20_129 = "[Auto] If your Leader is a black card and—your Leader is a Z-Leader, or you have 2 or more Z-Energy or a Z-Battle Card in play: When this card is used in a combo, draw 1 card.";
const P_482 = "[activate: main][limit 1]{r}, if your Leader is a red ≪Shadow Dragon≫ card and—your Leader is a Z-Leader or you have 6 or more Z-Energy: Add up to 1 card from your life to your hand, and play this card from your hand.";
const BT25_066 = "[Auto][Limit 1]{u}, if your Leader is blue, and if your Leader is a Z-Leader or if you have a blue Z-Card in play: At the end of a battle in which this card was used in a combo from your hand, play this card from your Drop.";
const BT20_097 = "[activate: main]{y}, if your Leader is a <Son Goku> or <Vegeta> card—both yellow—and you have 2 or more energy: Play this card from your hand.";
const BT20_091 = "[activate: main][limit 1]{y}, if your Leader is a <Majin Buu> or <Evil Wizard Babidi> card?both yellow?and you have 4 or more energy: Place up to 1 yellow ≪Majin≫ cards from your Drop under this card, and play up to 1 {Majin Buu, Intelligence Manifest} from your hand on top of this card.";
const BT20_100 = "[Activate: Main] If your Leader is a <Son Goku> or <Vegeta> card—both yellow—and you send this card to its owner's Warp: Play up to 1 {SS Son Goku & SS Vegeta, Ultimate Duo} from your deck with its keyword skills negated for the turn, and shuffle your deck.";
const BT20_103 = "[Activate: Main][Limit 1] If your Leader is a <Son Goku> or <Vegeta> card—both yellow—you have 2 or more energy, and you send this card to its owner's Warp: Play up to 1 yellow Battle Card with an energy cost of 1 from your deck with its skills negated for the turn, and shuffle your deck.";
const SD22_06 = "[activate: main][limit 1]{y}, if your Leader is a <Son Goku>, <Vegeta>, or <Evil Wizard Babidi> card―all yellow―and you have 2 or more energy: Draw 1 card, and play this card from your hand.";
const BT20_147 = "[Activate: Main/Battle] If your Leader is a ≪Saiyan≫ or ≪Earthling≫ card—both mono-yellow—and your opponent has 3 or more energy: Choose up to 1 of your opponent's cards, ignoring [Barrier], switch it to Rest Mode.";
const BT1_065 = "[Activate: Main] [Once per turn] Place 1 card from your life to the Drop Area: Choose 1 of your opponent's Battle Cards and KO it.";
const BT13_099 = "[Auto] If your Leader Card is a <Son Gohan: Future> card and you place 1 card in your Drop Area from your life: When this card is played from your hand, play up to 1 yellow <Trunks: Future> card with an energy cost of 1 from your deck, then shuffle your deck.";

// Synthetic lines for the VM: the printed condition with a price an Activate: Main can be offered for.
const Z_LINE = "[Activate: Main]{u}, if your Leader is red and―your Leader is a Z-Leader, or you have 2 or more Z-Energy, or you have a Z-Battle Card in play: Play this card from your hand.";
const Z_LINE_BARE = "[Activate: Main]{u}, if your Leader is red and―your Leader is a Z-Leader, or you have 2 or more Z-Energy or a Z-Battle Card in play: Play this card from your hand.";
const SEND_LINE = "[Activate: Main] If your Leader is a <Son Goku> or <Vegeta> card—both yellow—and you send this card to its owner's Warp: Draw 1 card.";
const MONO_LINE = "[Activate: Main]{y}, if your Leader is a ≪Saiyan≫ or ≪Earthling≫ card—both mono-yellow—and you have 2 or more energy: Play this card from your hand.";

// ── the reading ──────────────────────────────────────────────────────────────
{
  type C = { kind: string; conds?: C[]; filter?: Record<string, unknown>; sel?: { area?: string }; atLeast?: number };
  const condOf = (text: string): C => (compileSkill(one(text)).ops[0] as unknown as { cond: C }).cond;

  // Group 1: colour AND (Z-Leader OR Z-Energy OR Z-Battle Card), at every spelling of the dash.
  for (const [name, text] of [["BT19-028 (―)", BT19_028], ["BT27-023 ( -- )", BT27_023]] as const) {
    assert.deepEqual(compileSkill(one(text)).unsupported, [], `${name} reads whole`);
    const c = condOf(text);
    assert.equal(c.kind, "all", `${name}: the Leader colour and the alternatives both gate it`);
    assert.equal(c.conds![0].kind, "leaderMatches");
    assert.deepEqual(c.conds![0].filter!.colors, ["Red"]);
    const alt = c.conds![1];
    assert.equal(alt.kind, "any", `${name}: three alternatives`);
    assert.deepEqual(alt.conds!.map((x) => x.kind), ["leaderMatches", "count", "count"]);
    assert.equal(alt.conds![0].filter!.z, true, "a Z-Leader");
    assert.equal(alt.conds![1].sel!.area, "zEnergy");
    assert.equal(alt.conds![1].atLeast, 2, "2 or more Z-Energy");
    assert.equal((alt.conds![2] as unknown as { sel: { filter: { z: boolean; type: string } } }).sel.filter.z, true, "a Z-Battle Card…");
  }
  // "2 or more Z-Energy or a Z-Battle Card in play" carries its "you have" to the third alternative.
  assert.deepEqual(condOf(BT20_129).conds![1].conds!.map((x) => x.kind), ["leaderMatches", "count", "count"]);
  for (const text of [P_482, BT25_066]) assert.deepEqual(compileSkill(one(text)).unsupported, [], text.slice(0, 40));
  assert.equal(condOf(BT25_066).kind, "all", "BT25-066's 'and if … or if …' is the colour AND the pair");

  // Group 2: the colour qualifier holds for every name.
  for (const text of [BT20_097, BT20_091, BT20_100, BT20_103, SD22_06, BT20_147]) assert.deepEqual(compileSkill(one(text)).unsupported, [], text.slice(0, 60));
  const names = condOf(BT20_097).conds!;
  const leaders = names[0].kind === "any" ? names[0].conds! : condOf(BT20_097).conds!.slice(0, 1);
  assert.ok(leaders.length === 2 && leaders.every((l) => (l.filter!.colors as string[]).join() === "Yellow"), "yellow on <Son Goku> AND on <Vegeta>");
  const three = (compileSkill(one(SD22_06)).ops[0] as unknown as { cond: C }).cond.conds![0].conds!;
  assert.deepEqual(three.flatMap((l) => l.filter!.characters as string[]).sort(), ["evil wizard babidi", "son goku", "vegeta"].map((n) => n), "all three names");
  assert.ok(three.every((l) => (l.filter!.colors as string[]).join() === "Yellow"), "…each of them yellow");

  // Group 3: the life price is a compiled, chargeable action.
  for (const text of [BT1_065, BT13_099]) {
    assert.deepEqual(compileSkill(one(text)).unsupported, [], text.slice(0, 40));
    assert.equal(skillRecords({ ...DEFS["L-RED"], id: "X", skill: text }).find((r) => r.kind.startsWith("activate") || r.kind === "auto")!.unread.length, 0);
  }
}

// ── the VM ───────────────────────────────────────────────────────────────────
const lead = (id: string, extra: Partial<CardDef>) => card(id, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, power: 10000, skill: null, ...extra });
const plain = (id: string, extra: Partial<CardDef> = {}) => card(id, { colors: ["Blue"], energyCost: 0, power: 5000, skill: null, ...extra });
const hand = (id: string, skill: string, extra: Partial<CardDef> = {}) => card(id, { colors: ["Blue"], energyCost: 3, power: 15000, comboCost: 0, comboPower: 5000, skill, ...extra });
const defs: Record<string, CardDef> = {
  ...DEFS,
  Z966: hand("Z966", Z_LINE),
  ZB966: hand("ZB966", Z_LINE_BARE),
  SEND966: card("SEND966", { type: "EXTRA", colors: ["Yellow"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: SEND_LINE, characters: ["Send"] }),
  GOKU966: hand("GOKU966", BT20_097, { colors: ["Yellow"] }),
  SD966: hand("SD966", SD22_06, { colors: ["Yellow"] }),
  MONO966: hand("MONO966", MONO_LINE, { colors: ["Yellow"] }),
  BT1_065: card("BT1_065", { colors: ["Red"], energyCost: 0, power: 10000, comboCost: 0, comboPower: 5000, skill: BT1_065 }),
  "L966-RED": lead("L966-RED", { colors: ["Red"] }),
  "L966-ZRED": lead("L966-ZRED", { type: "Z-LEADER", colors: ["Red"] }),
  "L966-ZBLUE": lead("L966-ZBLUE", { type: "Z-LEADER", colors: ["Blue"] }),
  "L966-BLUE": lead("L966-BLUE", { colors: ["Blue"] }),
  "L966-GOKU-Y": lead("L966-GOKU-Y", { colors: ["Yellow"], characters: ["Son Goku"] }),
  "L966-VEGETA-Y": lead("L966-VEGETA-Y", { colors: ["Yellow"], characters: ["Vegeta"] }),
  "L966-BABIDI-Y": lead("L966-BABIDI-Y", { colors: ["Yellow"], characters: ["Evil Wizard Babidi"] }),
  "L966-GOKU-R": lead("L966-GOKU-R", { colors: ["Red"], characters: ["Son Goku"] }),
  "L966-VEGETA-R": lead("L966-VEGETA-R", { colors: ["Red"], characters: ["Vegeta"] }),
  "L966-GOHAN-Y": lead("L966-GOHAN-Y", { colors: ["Yellow"], characters: ["Son Gohan"] }),
  "L966-GOKU-YR": lead("L966-GOKU-YR", { colors: ["Yellow", "Red"], characters: ["Son Goku"] }),
  "L966-SAIYAN-Y": lead("L966-SAIYAN-Y", { colors: ["Yellow"], traits: ["Saiyan"] }),
  "L966-SAIYAN-YR": lead("L966-SAIYAN-YR", { colors: ["Yellow", "Red"], traits: ["Saiyan"] }),
  B966: plain("B966"),
  Y966: plain("Y966", { colors: ["Yellow"] }),
  ZE966: plain("ZE966", { type: "Z-BATTLE", zEnergyCost: 1 }),
  ZBATTLE966: plain("ZBATTLE966", { type: "Z-BATTLE", colors: ["Red"] }),
  BATTLE966: plain("BATTLE966", { colors: ["Red"] }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" } as unknown as RuleRow)));
const stored = roundtrip(rows);
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(stored, defs) };
const game = (() => {
  const loaded = rulesetFor("dbs");
  assert.ok(loaded.ok);
  return loaded.definition;
})();

function take(s: VmState, action: Action): VmState {
  return RULES.apply(ctx, roundtrip(s), action).state as VmState;
}
function main(leader: string): VmState {
  let s = RULES.createGame(ctx, { seed: 966, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader: "L-RED", main: fifty("V-BLUE") } }).state as VmState;
  s = take(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = take(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = take(s, { type: "endMain", player: "p1" });
  for (let i = 0; i < 40 && !(s.prompt.kind === "main" && s.turnPlayer === "p1"); i++) {
    const p = (s.prompt as { player: PlayerId }).player;
    s = take(s, s.prompt.kind === "main" ? { type: "endMain", player: p } : s.prompt.kind === "charge" ? { type: "charge", player: p, card: null } : { type: "pass", player: p });
  }
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p1");
  return s;
}
function stage(s: VmState, def: string, area: string, side: PlayerId = "p1", mode: "active" | "rest" = "active"): string {
  const id = s.sides[side].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: side }).ok, `${def} into ${area}`);
  if (area === "energy" || area === "battle") s.cards[id].mode = mode;
  return id;
}
function clear(s: VmState): void {
  for (const area of ["hand", "energy"]) for (const id of s.sides.p1.zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1", position: "bottom" }).ok);
}
const activates = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && (l.action as { card?: string }).card === id);
const zone = (s: VmState, area: string, side: PlayerId = "p1") => s.sides[side].zones[area];

// ── group 1 ──────────────────────────────────────────────────────────────────
type Z = [string, string, { zEnergy?: number; zBattle?: boolean; battle?: boolean }, boolean];
const Z_CASES: Z[] = [
  ["L966-RED", "plain red Leader, nothing Z", {}, false],
  ["L966-ZRED", "red Z-Leader", {}, true],
  ["L966-RED", "red Leader, 2 Z-Energy", { zEnergy: 2 }, true],
  ["L966-RED", "red Leader, 1 Z-Energy", { zEnergy: 1 }, false],
  ["L966-RED", "red Leader, a Z-Battle Card", { zBattle: true }, true],
  ["L966-RED", "red Leader, an ordinary Battle Card", { battle: true }, false],
  ["L966-ZBLUE", "blue Z-Leader: the colour half fails", {}, false],
  ["L966-BLUE", "blue Leader, 2 Z-Energy and a Z-Battle Card", { zEnergy: 2, zBattle: true }, false],
];
for (const def of ["Z966", "ZB966"]) {
  for (const [leader, name, board, offered] of Z_CASES) {
    const s = main(leader);
    clear(s);
    const id = stage(s, def, "hand");
    stage(s, "B966", "energy");
    for (let i = 0; i < (board.zEnergy ?? 0); i++) stage(s, "ZE966", "zEnergy");
    if (board.zBattle) stage(s, "ZBATTLE966", "battle");
    if (board.battle) stage(s, "BATTLE966", "battle");
    const rows = activates(s, id);
    assert.equal(rows.length > 0, offered, `${def}, ${name}: ${offered ? "offered" : "not offered"} (${JSON.stringify(rows.map((r) => r.label))})`);
    if (offered) assert.ok(zone(take(s, rows[0].action), "battle").includes(id), `${name}: and the activation plays the card`);
  }
}

// ── group 2 ──────────────────────────────────────────────────────────────────
const Y_CASES: [string, string, number, boolean][] = [
  ["L966-GOKU-Y", "yellow <Son Goku>", 2, true],
  ["L966-VEGETA-Y", "yellow <Vegeta>", 2, true],
  ["L966-GOKU-Y", "yellow <Son Goku>, 1 energy", 1, false],
  ["L966-GOKU-R", "red <Son Goku>: the colour holds for the first name", 2, false],
  ["L966-VEGETA-R", "red <Vegeta>: the colour holds for the second name too", 2, false],
  ["L966-GOHAN-Y", "yellow Leader of another name", 2, false],
  ["L966-GOKU-YR", "yellow/red <Son Goku> (yellow among its colours)", 2, true],
];
for (const [leader, name, energy, offered] of Y_CASES) {
  const s = main(leader);
  clear(s);
  const id = stage(s, "GOKU966", "hand");
  for (let i = 0; i < energy; i++) stage(s, "Y966", "energy");
  const rows = activates(s, id);
  assert.equal(rows.length > 0, offered, `BT20-097, ${name}: ${offered ? "offered" : "not offered"}`);
  if (offered) assert.ok(zone(take(s, rows[0].action), "battle").includes(id));
}
// "all yellow" over three names.
for (const [leader, offered] of [["L966-BABIDI-Y", true], ["L966-GOKU-Y", true], ["L966-GOHAN-Y", false], ["L966-GOKU-R", false]] as [string, boolean][]) {
  const s = main(leader);
  clear(s);
  const id = stage(s, "SD966", "hand");
  stage(s, "Y966", "energy");
  stage(s, "Y966", "energy");
  assert.equal(activates(s, id).length > 0, offered, `SD22-06 shape, ${leader}`);
}
// "both mono-yellow": a yellow/red Leader of the right trait does not qualify.
for (const [leader, offered] of [["L966-SAIYAN-Y", true], ["L966-SAIYAN-YR", false]] as [string, boolean][]) {
  const s = main(leader);
  clear(s);
  const id = stage(s, "MONO966", "hand");
  stage(s, "Y966", "energy");
  stage(s, "Y966", "energy");
  assert.equal(activates(s, id).length > 0, offered, `mono-yellow, ${leader}`);
}
// BT20-100's price: "you send this card to its owner's Warp" is paid, the card leaves, the effect runs.
for (const [leader, offered] of [["L966-GOKU-Y", true], ["L966-GOKU-R", false]] as [string, boolean][]) {
  const s = main(leader);
  clear(s);
  const id = stage(s, "SEND966", "hand");
  const rows = activates(s, id);
  assert.equal(rows.length > 0, offered, `send-this-card line, ${leader}`);
  if (offered) {
    const handBefore = zone(s, "hand").length;
    const after = take(s, rows[0].action);
    assert.ok(zone(after, "warp").includes(id), "the card is sent to the Warp as the price");
    assert.equal(zone(after, "hand").length, handBefore - 1 + 1, "…and the skill drew its card");
  }
}

// ── group 3 ──────────────────────────────────────────────────────────────────
function lifeBoard(lifeCards: number): { s: VmState; id: string; target: string } {
  const s = main("L-RED");
  clear(s);
  const id = stage(s, "BT1_065", "battle");
  const target = stage(s, "BATTLE966", "battle", "p2");
  for (const l of zone(s, "life").slice(lifeCards)) assert.ok(moveCard(s, game, l, "drop", { owner: "p1" }).ok);
  assert.equal(zone(s, "life").length, lifeCards);
  return { s, id, target };
}
{
  const { s, id, target } = lifeBoard(3);
  const rows = activates(s, id);
  assert.equal(rows.length, 1, "BT1-065 is offered with cards in the Life Area");
  const dropBefore = zone(s, "drop").length;
  let t = take(s, rows[0].action);
  // The price is chosen from the Life Area, then the effect chooses its target.
  for (let i = 0; i < 6 && t.prompt.kind === "chooseCards"; i++) {
    const legal = RULES.legalActions(ctx, t).find((l) => l.action.type === "choose")!;
    t = take(t, legal.action);
  }
  assert.equal(zone(t, "life").length, 2, "one card left the Life Area as the price");
  assert.ok(!zone(t, "battle", "p2").includes(target), "the opponent's Battle Card was KO'd");
  assert.equal(zone(t, "drop").length >= dropBefore + 1, true, "the price card is in the Drop Area");
}
{
  const { s, id } = lifeBoard(0);
  assert.equal(activates(s, id).length, 0, "BT1-065 is not offered with an empty Life Area: the price cannot be paid");
}
// BT13-099 (an [Auto] with the price after the Leader): a stored, chargeable program.
{
  const rec = skillRecords({ ...DEFS["L-RED"], id: "BT13-099", skill: BT13_099 }).find((r) => r.kind === "auto")!;
  assert.deepEqual(rec.unread, []);
  assert.ok(roundtrip(rec.cost), "its price is stored with the row");
}

// ── controls: what stays unread ──────────────────────────────────────────────
assert.ok(unread("[Activate: Main] If your Leader is red and―your Leader is a Z-Leader, or you have a foo of bar: Draw 1 card."), "an alternative that does not read leaves the line unread");
assert.ok(unread("[Activate: Main]{r}, if your Leader is red and―: Draw 1 card."), "a dash with nothing after it is unread");
assert.ok(unread("[Activate: Main] If your Leader is a <Son Goku> or <Vegeta> card—both red and with [EX-Evolve]—and you have 2 or more energy: Draw 1 card."), "a qualifier that says more than a colour is not folded");
assert.ok(unread("[Activate: Main]{r}{r}{r}, send 1 <Pilaf> card, 1 <Mai> card, and 1 <Shu> card from your Drop Area to your Warp: Play this card from your hand."), "BT10-025's three-card send stays unread: one card may carry two names");
assert.ok(unread("[Activate: Main] Place 1 card from your life and 1 card from your hand to the Drop Area: Draw 1 card."), "a two-source place price stays unread");
assert.ok(reads("[Activate: Main] If your Leader is red and you have 2 or more energy: Draw 1 card."), "plain conditions still read");
assert.ok(reads("[Activate: Main] Place 1 card from your life in the Drop Area: Draw 1 card."), "the 'in' wording still reads");

console.log("  #966: dash-qualified Z conditions, 'both <colour>' Leader lists and the life-to-Drop price read whole and gate the VM; the rest stays unread");

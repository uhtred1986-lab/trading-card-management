/**
 * Integration 2 (3 Nov 2026): the owner's answers to the four audit lanes' open questions, as the compiler and the engine
 * carry them. Printed text inline (catalog text of the snapshot of 2 Nov 2026; the VM case's cards are synthetic).
 *
 * R-204. "**Choose** the attacking Battle Card" (P-203), "choose up to 1 of the attacking Battle Cards" (P-409), "choose the
 *        attacking card, ignoring [Barrier]" (BT10-123, BT13-030) choose: the attacker in a battle role, so [Barrier] and
 *        "can't be chosen" are asked unless the text ignores them. "The attacking card gets …" with no "choose" is the
 *        attacker named, untouched by [Barrier].
 * R-205. A counted choice of cards in play that names no owner is either player's: "choose up to 1 Battle Card, and it
 *        gets -5000 power" (BT22-026), "choose up to 1 Unison and remove a marker from it" (EX21-09). A condition's cards
 *        ("if <Pan> is in your Battle Area", BT3-012) and a sweep keep their own reading.
 * Guard. A program that plays a card already in play is unread, not run: "Play up to 1 <Frieza> card and up to 1 <Cooler>
 *        card ―both …― from your hand" (EX23-01) lost "from your hand" on its first card. A card sent out of play first
 *        and played from there ("…send it to your Warp, and at the start of your next Main Phase, play that card from
 *        your Warp", BT4-044) is read.
 * R-206. "If you do, … . Then flip this card over at the end of the turn." (BT5-080's back): the "Then" sentence goes on
 *        with what was done — no Dragon Balls removed, no flip.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { resolveSelector } from "../../src/lib/arena/vm/program";
import type { Op, ScriptFrame, Selector } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmBattle, VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = ReturnType<typeof skillRecords>[number];
const recordsOf = (what: string, o: Partial<CardDef>) => skillRecords(card(what, o));
function only(text: string, what: string): Rec {
  const recs = recordsOf(what, { skill: text });
  assert.equal(recs.length, 1, `${what}: one record`);
  return roundtrip(recs[0]);
}
const opsDeep = (v: unknown): Op[] => {
  const out: Op[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if (typeof (x as { op?: unknown }).op === "string") out.push(x as Op);
    for (const [k, y] of Object.entries(x)) if (k !== "sel" && k !== "target") walk(y);
  };
  walk(v);
  return out;
};
const chooses = (rec: Rec) => opsDeep(rec.ops).filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
let records = 0;
let cases = 0;

// ── R-204 ────────────────────────────────────────────────────────────────────
const attackerChoice: Record<string, Selector> = {};
for (const [text, what, area, upTo, ignoreBarrier] of [
  ["[counter: battle card attack] Choose the attacking Battle Card, KO it, then play this card.", "P-203", "battle", false, false],
  ["[auto]{u}, if your Leader is mono-blue and you discard this card from your hand: When one of your Battle Cards is KO'd by an opponent's attack, choose up to 1 of the attacking Battle Cards and place it on top of its owner's deck.", "P-409", "battle", true, false],
  ["[Counter: Attack] If your Leader Card is mono-yellow: Choose the attacking card, ignoring [Barrier], negate its skills for the turn, and it can't be switched to Active Mode until the start of your next turn.", "BT10-123", "play", false, true],
] as const) {
  const rec = only(text, what);
  assert.deepEqual(rec.unread, [], `R-204: ${what} — read`);
  const sel = chooses(rec)[0]?.sel;
  assert.ok(sel && !sel.special && sel.battleRole === "attacker" && sel.side === "both" && sel.area === area && !!sel.upTo === upTo && !!sel.ignoreBarrier === ignoreBarrier, `R-204: ${what} — a choice of the attacker (${JSON.stringify(sel)})`);
  attackerChoice[what] = sel;
  records++;
}
{
  // No "choose": the attacker is named, and [Barrier] has nothing to say.
  const rec = only("[Counter: Attack] The attacking card gets -5000 power for the turn.", "NAMED");
  const power = opsDeep(rec.ops).find((o): o is Extract<Op, { op: "power" }> => o.op === "power");
  assert.ok(power && "sel" in power.target && power.target.sel.special === "attacker" && !chooses(rec).length, `R-204: the attacking card named, not chosen (${JSON.stringify(rec.ops)})`);
  records++;
}

// ── R-205 ────────────────────────────────────────────────────────────────────
for (const [text, what, side] of [
  ["[Activate: Main][Limit 1] If your Leader is a red ≪Red Ribbon Army≫ card: Play this card in Rest Mode from your hand, choose up to 1 Battle Card, and it gets -5000 power for the turn. Additionally, if the chosen card is a <Magenta: SH> card, it gets -10000 power for the turn.", "BT22-026", "both"],
  ["[Activate: Main] If your Leader is a green <Evil Wizard Babidi> card and you place this card from your hand at the bottom of your deck: Choose up to 1 Unison and remove a marker from it.", "EX21-09", "both"],
  // A bare name keeps the caster default for now (the two-named search is not built): "up to 1 <Kale> card".
  ["[Activate: Battle] Choose up to 1 ≪God≫ card and it gets +6000 power for the battle.", "BT16-017", "you"],
  ["[Activate: Main] Choose up to 1 of your Battle Cards, and it gets +5000 power for the turn.", "MINE", "you"],
  ["[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it.", "THEIRS", "opponent"],
] as const) {
  const rec = only(text, what);
  const sel = chooses(rec).find((c) => !c.sel.special)?.sel;
  assert.equal(sel?.side, side, `R-205: ${what} — ${side} (${JSON.stringify(sel)})`);
  records++;
}
{
  // A condition's cards keep their owner: "if <Pan> is in your Battle Area" (BT3-012).
  const rec = only("[Permanent] If <Pan> is in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost.", "BT3-012");
  assert.ok(!/both players|either player|each player/.test(rec.reads), `R-205: BT3-012 — your own Battle Area (${rec.reads})`);
  records++;
}

// ── Guard: a card in play is never played ────────────────────────────────────
{
  const [rec] = recordsOf("EX23-01", { skill: "[activate: main][once per turn]{r}{r}{u}{2}, if your opponent has 20 or fewer cards in their deck: Play up to 1 <Frieza> card and up to 1 <Cooler> card―both Red/Blue multicolor and with an energy cost of 5―from your hand, then switch up to 2 of your energy to Active Mode at the end of the turn." });
  assert.ok(rec.unread.some((u) => /already in play/.test(u)), `guard: EX23-01 — unread (${JSON.stringify(rec.unread)})`);
  const warp = only("[Counter: Play] Choose up to 1 <Hirudegarn> in your Battle Area, send it to your Warp, and at the start of your next Main Phase, play that card from your Warp.", "BT4-044");
  assert.deepEqual(warp.unread, [], "guard: BT4-044 — sent out of play first, then played: read");
  records += 2;
}

// ── R-206 ────────────────────────────────────────────────────────────────────
{
  const back = "[Activate: Main][Once per turn] Choose one—<br>・Draw 1 card.<br>・Choose 1 yellow or black ≪Desire≫ card from your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.<br>・Remove 7 [Dragon Ball] cards in your Drop Area from the game. If you do,  choose a total of up to 2 of your opponent's Battle Cards and energy and switch them to Rest Mode, and this card gets +15000 power for the duration of the turn. Then flip this card over at the end of the turn.";
  const rec = recordsOf("BT5-080", { type: "LEADER", skill: "[Permanent] Nothing happens.", back: { name: "Frieza, Resurrected Emperor", power: 15000, skill: back } }).find((r) => r.side === "back");
  assert.ok(rec && !rec.unread.length, "R-206: BT5-080's back — read");
  const gate = opsDeep(rec.ops).find((o): o is Extract<Op, { op: "if" }> => o.op === "if" && JSON.stringify(o.then).includes("15000"));
  assert.ok(gate && /flip/i.test(JSON.stringify(gate.then)), `R-206: the flip sits inside "if you do" (${rec.reads})`);
  records++;
}

// ── VM: [Barrier] on a chosen attacker (R-204) ───────────────────────────────
const vmDefs: Record<string, CardDef> = { ...DEFS, WALL: card("WALL", { skill: "[Barrier]" }) };
const vmRows = Object.values(vmDefs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = { ...CTX, defs: vmDefs, scripts: rulesFromRows(roundtrip(vmRows), vmDefs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
function fresh(seat: PlayerId, seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: "L-BLUE", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[])
    s = take(s, action);
  assert.equal(s.turnPlayer, seat);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const s = fresh(seat, 62030 + (seat === "p1" ? 0 : 1));
  const mine = stage(s, seat, "V1", "battle");
  const wall = stage(s, foe, "WALL", "battle");
  const plain = stage(s, foe, "V-BLUE", "battle");
  const frame = { card: mine, master: seat, vars: {} } as unknown as ScriptFrame;
  const offered = (what: string) => resolveSelector(ctx, game, s, frame, attackerChoice[what]);
  s.battle = { attacker: wall, guard: mine, target: mine, step: "attack", negated: false, blockerOffered: false } as unknown as VmBattle;
  assert.deepEqual([offered("P-203"), offered("P-409"), offered("BT10-123")], [[], [], [wall]], `${seat}: R-204 — a [Barrier] attacker can't be chosen, unless the text ignores [Barrier]`);
  s.battle = { attacker: plain, guard: mine, target: mine, step: "attack", negated: false, blockerOffered: false } as unknown as VmBattle;
  assert.deepEqual([offered("P-203"), offered("P-409"), offered("BT10-123")], [[plain], [plain], [plain]], `${seat}: R-204 — any other attacker is chosen`);
  cases++;
}

console.log(`integration-2: ${records} records, ${cases} VM cases`);

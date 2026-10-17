/**
 * #915: "[Permanent] If your Leader is a ≪Bardock's Crew≫ card and there are 4
 * or more ≪Bardock's Crew≫ cards with different card names in your energy,
 * Z-Energy, Battle Area, and/or Drop, this card gets +6000 power." — printed
 * text -> compile -> stored-row JSON round-trip -> the real VM.
 *
 * Official Bandai card list (read 17 Oct 2026): BT18-099 Tora, BT18-101 Fasha,
 * BT18-103 Shugesh, BT18-105 Borgos and BT18-108 Bardock, Crew Leader all print
 * Saiyan/Bardock's Crew and the sentence above. The card Q&A has no entry for
 * these cards and the errata page lists none. The owner's reading: the count is
 * four DISTINCT FULL CARD NAMES over the union of the four areas.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const PERMANENT = "[Permanent] If your Leader is a ≪Bardock's Crew≫ card and there are 4 or more ≪Bardock's Crew≫ cards with different card names in your energy, Z-Energy, Battle Area, and/or Drop, this card gets +6000 power.";
const CREW = ["Saiyan", "Bardock's Crew"];
const PRINTED = [
  ["BT18-099", "Tora, Feelings Bequeathed", "Tora"],
  ["BT18-101", "Fasha, Feelings Bequeathed", "Fasha"],
  ["BT18-103", "Shugesh, Feelings Bequeathed", "Shugesh"],
  ["BT18-105", "Borgos, Feelings Bequeathed", "Borgos"],
  ["BT18-108", "Bardock, Crew Leader", "Bardock"],
] as const;
const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(PRINTED.map(([id, name, who]) => [id, card(id, { name, characters: [who], traits: CREW, colors: ["Yellow"], power: 4000, energyCost: 1, skill: PERMANENT })])),
  // Four-or-more fillers: distinct full names; two of them share a character, one is not a Saiyan.
  A915: card("A915", { name: "Gine, Crew Mother", characters: ["Gine"], traits: CREW, colors: ["Yellow"], skill: null }),
  B915: card("B915", { name: "Tora, Another Print", characters: ["Tora"], traits: CREW, colors: ["Yellow"], skill: null }),
  C915: card("C915", { name: "Fasha, Another Face", characters: ["Fasha"], traits: CREW, colors: ["Yellow"], skill: null }),
  D915: card("D915", { name: "Nameless Crewman", characters: ["Crewman"], traits: ["Bardock's Crew"], colors: ["Yellow"], skill: null }),
  E915: card("E915", { name: "Seripa, Crew Medic", characters: ["Seripa"], traits: CREW, colors: ["Yellow"], skill: null }),
  // The same full name as A915 under another print id (manual 2-3: identity is the name, not the row).
  A915ALT: card("A915ALT", { name: "Gine, Crew Mother", characters: ["Gine"], traits: CREW, colors: ["Yellow"], skill: null }),
  // Saiyan only: a different name, but not a ≪Bardock's Crew≫ card.
  SAIYAN915: card("SAIYAN915", { name: "Plain Saiyan", characters: ["Saiyan"], traits: ["Saiyan"], colors: ["Yellow"], skill: null }),
  "L915-CREW": { ...DEFS["L-RED"], id: "L915-CREW", traits: CREW },
  "L915-NO": { ...DEFS["L-RED"], id: "L915-NO", traits: ["Saiyan"] },
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
for (const [id] of PRINTED) {
  const [row] = skillRecords(defs[id]);
  assert.equal(row.kind, "permanent");
  assert.deepEqual(row.unread, [], `${id}: the whole Permanent reads`);
  const leader = row.cond as { kind: string; filter: { traits: string[] } };
  assert.equal(leader.kind, "leaderMatches", `${id}: the Leader condition is kept`);
  assert.deepEqual(leader.filter.traits, ["bardock's crew"]);
  assert.equal(row.ops.length, 1, `${id}: and the count gates the one effect`);
  const gate = row.ops[0] as { op: string; cond: { kind: string; atLeast: number; sel: { side: string; areas: string[]; differentNames: boolean; filter: { traits: string[] } } }; then: unknown[] };
  assert.equal(gate.op, "if");
  assert.equal(gate.cond.kind, "count"); assert.equal(gate.cond.atLeast, 4);
  assert.equal(gate.cond.sel.side, "you");
  assert.deepEqual(gate.cond.sel.areas, ["energy", "zEnergy", "battle", "drop"], "the union of the four areas, not the first");
  assert.equal(gate.cond.sel.differentNames, true, "distinct full card names");
  assert.deepEqual(gate.cond.sel.filter.traits, ["bardock's crew"], "no Saiyan filter");
  assert.deepEqual(gate.then, [{ op: "power", target: { sel: { special: "self" } }, amount: 6000, until: "game" }]);
}
{
  // Wordings this must not newly accept: another measure, a union of two descriptions, a total across kinds.
  const refused = (skill: string) => skillRecords(card("R915", { skill }))[0].unread.length > 0;
  assert.ok(refused("[Permanent] If your Leader is a ≪Bardock's Crew≫ card and there are 4 or more ≪Bardock's Crew≫ cards with different character names in your energy, Z-Energy, Battle Area, and/or Drop, this card gets +6000 power."), "'different character names' is not 'different card names'");
  assert.ok(refused("[Permanent] If there are 3 or more blue and/or yellow cards in your Battle Area and/or Combo Area, this card gets +6000 power."), "a union of descriptions stays unread");
  assert.ok(refused("[Permanent] If you have a total of 7 or more cards with <GT> in their character names among all cards in your energy, Z-Energy, Battle Area, and/or Drop, this card gets +6000 power."), "P-616's total across kinds stays unread");
  assert.ok(refused("[Permanent] If your Leader is green or yellow and you have a total of 2 or more green and/or yellow cards in your Combo Area, this card gets +6000 power."), "and a compound that carries one stays unread whole");
  assert.deepEqual(skillRecords(card("R916", { skill: "[Permanent] If there are 5 or more {Infinite Multiplication Meta-Cooler} in your energy, Battle Area, and/or Drop, this card gets +6000 power." }))[0].unread, [], "a plain three-area list with and/or reads");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId, leader = "L915-CREW"): VmState {
  let s = RULES.createGame(ctx, { seed: 915, p1: { name: "First", leader, main: fifty("V1") }, p2: { name: "Second", leader, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  return s;
}
/** Put a fresh copy of `def` into `area` for `p`, straight from the deck. */
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.find((c) => !(s.cards[c].cardId in defs && defs[s.cards[c].cardId].skill)) ?? s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `${def} -> ${area}`);
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
const move = (s: VmState, p: PlayerId, id: string, area: string) => assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `${id} -> ${area}`);
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power;
const BASE = 4000, BONUS = 6000;

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  for (const [subject] of PRINTED) {
    // 1. Three names: nothing. The subject itself is one of the names (it is in the Battle Area).
    {
      const s = fresh(seat);
      const me = stage(s, seat, subject, "battle");
      stage(s, seat, "A915", "energy"); stage(s, seat, "B915", "drop");
      assert.equal(power(s, me), BASE, `${seat}/${subject}: self + 2 = three names`);
      // 2. The fourth name, spread over energy / Z-Energy / Battle / Drop: the union.
      const z = stage(s, seat, "C915", "zEnergy");
      assert.equal(power(s, me), BASE + BONUS, `${seat}/${subject}: energy, Z-Energy, Battle and Drop together make four`);
      // …five is no different.
      stage(s, seat, "E915", "battle");
      assert.equal(power(s, me), BASE + BONUS, "five names still +6000, not more");
      // 3. The power leaves with the fourth name, and returns with it.
      move(s, seat, z, "hand");
      assert.equal(power(s, me), BASE + BONUS, "five names minus one is still four");
      const e = s.sides[seat].zones.battle.find((c) => s.cards[c].cardId === "E915")!;
      move(s, seat, e, "hand");
      assert.equal(power(s, me), BASE, "back to three names: the bonus is gone");
      move(s, seat, e, "energy");
      assert.equal(power(s, me), BASE + BONUS, "and back");
      // reload: the state and the rules both come back from JSON.
      const reloaded = rulesFromRows(roundtrip(rows), defs);
      assert.equal(attrsNow({ ...ctx, scripts: reloaded }, game, roundtrip(s), me).power, BASE + BONUS, `${seat}/${subject}: reloaded`);
    }
  }

  const SUBJECT = "BT18-099";
  // 4. All four in one valid area.
  for (const area of ["energy", "zEnergy", "battle", "drop"] as const) {
    const s = fresh(seat);
    const me = stage(s, seat, SUBJECT, area === "battle" ? "battle" : "hand");
    if (area !== "battle") { for (const d of ["A915", "B915", "C915", "E915"]) stage(s, seat, d, area); }
    else for (const d of ["A915", "B915", "C915"]) stage(s, seat, d, area);
    assert.equal(power(s, me), area === "battle" ? BASE + BONUS : BASE, `${seat}/${area}: four names in one area${area === "battle" ? "" : " (the subject in hand has no bonus to read)"}`);
    if (area !== "battle") { move(s, seat, me, "battle"); assert.equal(power(s, me), BASE + BONUS, `${seat}/${area}: four in ${area} plus the subject`); }
  }
  // 5. Copies of one name count once, across areas and across print ids; same character, different names count apart.
  {
    const s = fresh(seat);
    const me = stage(s, seat, SUBJECT, "battle");
    stage(s, seat, "A915", "energy"); stage(s, seat, "A915", "drop"); stage(s, seat, "A915", "zEnergy"); stage(s, seat, "A915ALT", "battle");
    assert.equal(power(s, me), BASE, `${seat}: Tora + four copies of one name (two prints) is two names`);
    stage(s, seat, "B915", "energy");
    assert.equal(power(s, me), BASE, "three names");
    stage(s, seat, "C915", "drop");
    assert.equal(power(s, me), BASE + BONUS, "Tora, Tora Another Print, Fasha Another Face, Gine: four names, though two share a character");
    // The same name as the subject, elsewhere, is the subject's name again.
    const t = fresh(seat);
    const me2 = stage(t, seat, SUBJECT, "battle");
    stage(t, seat, SUBJECT, "drop"); stage(t, seat, SUBJECT, "energy"); stage(t, seat, "A915", "drop"); stage(t, seat, "B915", "drop");
    assert.equal(power(t, me2), BASE, "copies of the subject's own name add nothing");
  }
  // 6. Non-Saiyan Crew cards count; Saiyan-only cards do not; neither does a card of someone else's.
  {
    const s = fresh(seat);
    const me = stage(s, seat, SUBJECT, "battle");
    stage(s, seat, "A915", "energy"); stage(s, seat, "B915", "drop");
    stage(s, seat, "SAIYAN915", "battle");
    assert.equal(power(s, me), BASE, `${seat}: a Saiyan without Bardock's Crew is not a fourth name`);
    stage(s, seat, "D915", "zEnergy");
    assert.equal(power(s, me), BASE + BONUS, "a Bardock's Crew card that is not a Saiyan is");
  }
  // 7. Hand, deck, Warp, Life and the opponent's areas do not count.
  {
    const s = fresh(seat);
    const me = stage(s, seat, SUBJECT, "battle");
    stage(s, seat, "A915", "energy"); stage(s, seat, "B915", "drop");
    const hand = stage(s, seat, "C915", "hand");
    stage(s, seat, "D915", "warp"); stage(s, seat, "E915", "life");
    const deck = s.sides[seat].zones.deck[0]; s.cards[deck].cardId = "SAIYAN915";
    for (const [d, area] of [["C915", "battle"], ["D915", "drop"], ["E915", "energy"], ["B915", "zEnergy"]] as const) stage(s, foe, d, area);
    assert.equal(power(s, me), BASE, `${seat}: hand, Warp, Life and the opponent's four areas add nothing`);
    move(s, seat, hand, "energy");
    assert.equal(power(s, me), BASE + BONUS, "the same card in the energy does");
    move(s, seat, hand, "drop");
    assert.equal(power(s, me), BASE + BONUS, "moving it between listed areas does not count it twice, or drop the bonus");
    move(s, seat, hand, "battle");
    assert.equal(power(s, me), BASE + BONUS);
    move(s, seat, hand, "warp");
    assert.equal(power(s, me), BASE, "and out to the Warp");
  }
  // 8. The Leader: a Leader without the trait, or no longer having it.
  {
    const s = fresh(seat, "L915-NO");
    const me = stage(s, seat, SUBJECT, "battle");
    for (const d of ["A915", "B915", "C915"]) stage(s, seat, d, "drop");
    assert.equal(power(s, me), BASE, `${seat}: four names, wrong Leader`);
    const leader = s.sides[seat].zones.leader[0]; s.cards[leader].cardId = "L915-CREW";
    assert.equal(power(s, me), BASE + BONUS, "the right Leader and the bonus is on");
    // The opponent's Leader and board are not asked.
    const t = fresh(seat);
    const me2 = stage(t, seat, SUBJECT, "battle");
    for (const d of ["A915", "B915", "C915"]) stage(t, foe, d, "drop");
    assert.equal(power(t, me2), BASE, "the opponent's Crew cards do not count for me");
    const theirs = stage(t, foe, SUBJECT, "battle");
    assert.equal(power(t, theirs), BASE + BONUS, "…while the same cards are the opponent's own count for the opponent's card");
    assert.equal(power(t, me2), BASE, "and my card is still unmoved by it");
  }
  // 9. Stacks with unrelated power effects, base power kept; face-down cards have no name to count.
  {
    const s = fresh(seat);
    const me = stage(s, seat, SUBJECT, "battle");
    const a = stage(s, seat, "A915", "energy"); stage(s, seat, "B915", "drop"); stage(s, seat, "C915", "drop");
    addEffect(s, [], { target: me, kind: "power", value: 5000, until: "turn", source: me, master: seat });
    assert.equal(power(s, me), BASE + BONUS + 5000, `${seat}: +6000 stacks with an unrelated +5000`);
    s.cards[a].hidden = true;
    assert.equal(power(s, me), BASE + 5000, "a face-down energy card has no name or trait, and drops out of the count");
    s.cards[a].hidden = false;
    assert.equal(power(s, me), BASE + BONUS + 5000);
    // Two such cards each get their own bonus from the one count.
    const twin = stage(s, seat, "BT18-108", "battle");
    assert.equal(power(s, twin), BASE + BONUS, "a second Bardock sees five names and is +6000 too");
    assert.equal(power(s, me), BASE + BONUS + 5000, "and the first is unchanged by it, five names or four");
  }
  // 10. The legal menu is untouched by the count (no hidden identity leaks into what is offered).
  {
    const s = fresh(seat);
    stage(s, seat, SUBJECT, "hand");
    const before = JSON.stringify(RULES.legalActions(ctx, s).map((l) => l.action));
    stage(s, seat, "A915", "energy");
    assert.doesNotThrow(() => RULES.legalActions(ctx, s));
    assert.ok(before.length > 0);
  }
}
console.log("#915 Bardock's Crew distinct card names across energy, Z-Energy, Battle and Drop: reading, stored rows, union, distinct names, boundaries, dynamic power, both seats passed");

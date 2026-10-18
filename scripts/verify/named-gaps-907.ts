/**
 * #907, the named gaps of the 17 Oct handoff: "different character names"
 * (BT18-119), a colour said once before two names (BT31-087), a three-name
 * choice (BT20-007), "activate {Field Extra}" (BT10-052) and the eight
 * "compliment each other" promos.
 *
 * Printed text -> compile -> the real VM. The sentences are the catalog's
 * deckplanet text of 18 Oct 2026, abridged to what matters where the card
 * has more than the clause under test.
 *
 * Sources and the labelled guesses are in the comments beside each case and
 * in the PR. Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript, validateProgram, characterKey } from "../../src/lib/arena/vm/script";
import type { Op } from "../../src/lib/arena/vm/script";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";

const compile = (text: string, index = 0) => compileSkill(parseSkills(text)[index]!);
const opsOf = (text: string): Op[] => compile(text).ops;
const json = (v: unknown) => JSON.stringify(v);
const flat = (ops: Op[]): Op[] => ops.flatMap((o) => [o, ...("then" in o && o.then ? flat(o.then) : []), ...("else" in o && o.else ? flat(o.else) : [])]);

// ── the readings ────────────────────────────────────────────────────────────
// 1. "different character names" (BT18-119, BT18-107). Manual 2-10 keeps the
//    character name (the <> brackets) apart from the card name (2-3), and
//    2-10-1-1 says <Son Goku> and <Son Goku : Childhood> are different
//    character names, so the key is the whole name. The Q&A and errata pages
//    have no entry for these cards (read 18 Oct 2026).
{
  const BT18_119 = "[Permanent] If you have 4 or more non-<Bardock> ≪Bardock's Crew≫ cards with different character names in your energy, reduce the energy cost of this card in your hand by 1.";
  const c = compile(BT18_119);
  assert.deepEqual(c.unsupported, [], "BT18-119 reads whole");
  const text = json(c.ops);
  assert.ok(text.includes('"differentCharacters":true') && !text.includes('"differentNames"'), "counts character names, not card names");
  assert.ok(text.includes('"atLeast":4') && text.includes('"area":"energy"'), "four, in the Energy Area");
  assert.match(describeScript(c.ops, { permanent: true }), /with different character names/);
  assert.ok(validateProgram(c.ops));

  const BT18_107 = "[Auto] When this card is played from your hand, place up to 4 non-<Bardock> ≪Bardock's Crew≫ cards with different character names from your Drop under this card, and you can't play Battle Cards for the turn.";
  const choose = flat(opsOf(BT18_107)).find((o) => o.op === "choose") as Extract<Op, { op: "choose" }>;
  assert.equal(choose.sel.differentCharacters, true, "BT18-107's choice carried no 'different character names' at all before");
  assert.equal(choose.sel.count, 4);

  const gate = compile("[Activate: Main]{3}, if there are 4 or more ≪Bardock's Crew≫ cards with different character names in your energy, Z-Energy, Battle Area, and/or Drop: Play this card from your hand.");
  assert.deepEqual(gate.unsupported, [], "BT18-107's activation gate reads");
  assert.ok(json(gate.ops).includes('"differentCharacters":true'));
  // Not both measures at once, and a wording this cannot count stays unread.
  assert.ok(compile("[Permanent] If you have 4 or more ≪Bardock's Crew≫ cards with different card names and different character names in your energy, this card gets +1000 power.").unsupported.length > 0, "both measures at once are refused, not read as one");
  assert.equal(characterKey(["Tora"]), characterKey(["tora"]), "case-blind");
  assert.notEqual(characterKey(["Son Goku"]), characterKey(["Son Goku : Childhood"]), "2-10-1-1: a part of a name is another name");
  assert.equal(characterKey([]), null, "no character name, nothing to differ by");
}

// 2. A colour said once before two names (BT31-087, BT22-025). The manual and
//    the Q&A are silent on how an adjective carries across "or"; the three cards
//    that print the shape all say it once before two names and share the noun.
//    BT31-087 was checked against Bandai's official text in #907 (the "black"
//    is printed once). Labelled best guess: the colour holds for both names.
{
  const sources = [
    ["BT31-087", "[permanent] If you have a black <Vegito> or <Vegito: Xeno> card in play, your opponent can't attack this card."],
    ["BT22-025", "[Permanent] If you have a red <Gamma 1: SH> or <Gamma 2: SH> card in play, this card gets +1000 power."],
    ["BT12-002b", "[Permanent] If you have red ≪Namekian≫ or ≪Demon Clan≫ cards flipped face up in your life, this card gets +1000 power."],
  ] as const;
  for (const [id, text] of sources) {
    const c = compile(text);
    assert.deepEqual(c.unsupported, [], `${id} reads`);
    const colours = json(c.ops).match(/"colors":\["(?:Black|Red)"\]/g) ?? [];
    assert.equal(colours.length, 2, `${id}: the colour is on both halves of the 'or' (${json(c.ops)})`);
  }
  // A colour per name stays as printed; a lone name keeps no invented colour.
  const own = json(opsOf("[Permanent] If you have a black <Vegito> or a blue <Vegito: Xeno> card in play, this card gets +1000 power."));
  assert.ok(own.includes('"colors":["Black"]') && own.includes('"colors":["Blue"]'), "each name keeps its own colour");
  assert.ok(!json(opsOf("[Permanent] If you have a <Vegito> or <Vegito: Xeno> card in play, this card gets +1000 power.")).includes('"colors":["'), "no colour is made up");
}

// 3. The three-name choice (BT20-007, BT20-006). Labelled best guess: the
//    printed "up to 1" applies to each name (the same words without it, BT20-002b's
//    send, ask for all three), and "all red" is the colour of every card.
{
  const BT20_007 = "[auto] When this card is played, choose up to 1 <Koitsukai> card, 1 <Panchia> card, and 1 <Bollarator> card―all red―from your hand, Battle Area, and/or Drop and place them under this card. Until the end of your opponent's next turn, this card gains [barrier].";
  const c = compile(BT20_007);
  assert.deepEqual(c.unsupported, []);
  const chooses = c.ops.filter((o) => o.op === "choose") as Extract<Op, { op: "choose" }>[];
  assert.equal(chooses.length, 3, "one choice per name");
  for (const [i, ch] of chooses.entries()) {
    assert.equal(ch.sel.count, 1); assert.equal(ch.sel.upTo, true, "up to 1 of each");
    assert.deepEqual(ch.sel.filter?.colors, ["Red"], "all red");
    assert.deepEqual(ch.sel.areas, ["hand", "battle", "drop"]);
    assert.equal(ch.sel.side, "you");
    assert.deepEqual(ch.sel.notIn ?? [], chooses.slice(0, i).map((x) => x.as), "a card of its own for each name");
  }
  assert.deepEqual(chooses.map((x) => x.sel.filter?.traits.concat(x.sel.filter?.characters ?? []).join()), ["koitsukai", "panchia", "bollarator"]);
  assert.equal(c.ops.filter((o) => o.op === "moveTo" && o.to === "under").length, 3, "all three go under this card");
  const six = compile("[Auto] When this card is played, draw 1 card, place up to 1 <Paparoni> card, 1 <Koitsukai> card, 1 <Panchia> card, and 1 <Bollarator> card―all red―from your Battle Area and/or Drop under this card, and this card gains [Barrier] for the turn.");
  assert.deepEqual(six.unsupported, [], "BT20-006's four-name placement reads too");
  assert.equal(six.ops.filter((o) => o.op === "choose").length, 4);
}

// 4. "Activate {Tragedy Overground}" (BT10-052) is the activation of a [Field] skill (22-3-3).
{
  const c = compile("[Activate: Main/Battle] Place this card in its owner's Drop Area: Activate up to 1 {Tragedy Overground} from your hand, Drop Area, deck, or Energy Area, then shuffle your deck if you looked through it.");
  assert.deepEqual(c.unsupported, []);
  const play = c.ops.find((o) => o.op === "play") as Extract<Op, { op: "play" }>;
  assert.equal(play.activating, true);
  assert.match(describeScript(c.ops), /activate \(its \[Field\] skill, else play\)/);
  // Other things the word "activate" starts are not this.
  for (const other of [
    "[Activate: Main] Activate the [Activate: Main] skill of up to 1 {Big Bang Kamehameha} in your hand.",
    "[Permanent] If your <Son Goku: Childhood> card is in play, you may activate {Kamehameha Energy Release} from your hand without paying its energy cost.",
  ]) assert.ok(!json(opsOf(other)).includes('"activating"'), other);
}

// 5. "You and your opponent compliment each other." (eight promos). Owner's
//    ruling (15 Oct 2026, recorded with arena:rule on all eight records): show
//    a compliment, then acknowledge the instruction. Two log notes, in order.
{
  const c = compile("[activate: main] You and your opponent compliment each other.");
  assert.deepEqual(c.unsupported, []);
  assert.deepEqual(c.ops.map((o) => o.op), ["note", "note"]);
  const [shown, acknowledged] = c.ops as Extract<Op, { op: "note" }>[];
  assert.match(shown.text, /^Compliment: /);
  assert.match(acknowledged.text, /^Instruction acknowledged: /);
  assert.match(describeScript(c.ops), /Compliment: [\s\S]*Instruction acknowledged/, "the reading says it");
}

// ── in a game ───────────────────────────────────────────────────────────────
const leader = (id: string, skill: string) => card(id, { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, skill });
const CREW = ["Saiyan", "Bardock's Crew"];
const crew = (id: string, name: string, who: string, over: Partial<CardDef> = {}) => card(id, { name, characters: [who], traits: CREW, colors: ["Yellow"], skill: null, ...over });
const defs: Record<string, CardDef> = {
  ...DEFS,
  // 1. character names
  "L-COUNT": leader("L-COUNT", "[Permanent] If you have 4 or more non-<Bardock> ≪Bardock's Crew≫ cards with different character names in your energy, this card gets +6000 power."),
  "L-PICK": leader("L-PICK", "[Activate: Main] Choose up to 3 non-<Bardock> ≪Bardock's Crew≫ cards with different character names in your Drop Area and send them to your Warp."),
  "T-A": crew("T-A", "Tora, Feelings Bequeathed", "Tora"),
  "T-B": crew("T-B", "Tora, Another Print", "Tora"),
  "F-A": crew("F-A", "Fasha, Feelings Bequeathed", "Fasha"),
  "G-A": crew("G-A", "Gine, Crew Mother", "Gine"),
  "S-A": crew("S-A", "Seripa, Crew Medic", "Seripa"),
  "BAR-A": crew("BAR-A", "Bardock, Crew Leader", "Bardock"),
  "NAMELESS": card("NAMELESS", { name: "Nobody", characters: [], traits: CREW, colors: ["Yellow"], skill: null }),
  "SAIYAN-ONLY": card("SAIYAN-ONLY", { name: "Plain Saiyan", characters: ["Plain"], traits: ["Saiyan"], colors: ["Yellow"], skill: null }),
  // 2. a colour said once
  "L-VEGITO": leader("L-VEGITO", "[Permanent] If you have a black <Vegito> or <Vegito: Xeno> card in play, this card gets +1000 power."),
  "V-RED": card("V-RED", { name: "Vegito Red", characters: ["Vegito"], colors: ["Red"], skill: null }),
  "VX-BLUE": card("VX-BLUE", { name: "Vegito Xeno Blue", characters: ["Vegito: Xeno"], colors: ["Blue"], skill: null }),
  "VX-BLACK": card("VX-BLACK", { name: "Vegito Xeno Black", characters: ["Vegito: Xeno"], colors: ["Black"], skill: null }),
  "V-BLACK": card("V-BLACK", { name: "Vegito Black", characters: ["Vegito"], colors: ["Black"], skill: null }),
  // 3. the three names
  "L-NAMED": leader("L-NAMED", "[Activate: Main] Choose up to 1 <Koitsukai> card, 1 <Panchia> card, and 1 <Bollarator> card―all red―from your hand, Battle Area, and/or Drop and place them under this card."),
  "K-HAND": card("K-HAND", { name: "Koitsukai Hand", characters: ["Koitsukai"], colors: ["Red"], skill: null }),
  "K-DROP": card("K-DROP", { name: "Koitsukai Drop", characters: ["Koitsukai"], colors: ["Red"], skill: null }),
  "K-BLUE": card("K-BLUE", { name: "Koitsukai Blue", characters: ["Koitsukai"], colors: ["Blue"], skill: null }),
  "P-BATTLE": card("P-BATTLE", { name: "Panchia Battle", characters: ["Panchia"], colors: ["Red"], skill: null }),
  "PB-BOTH": card("PB-BOTH", { name: "Panchia and Bollarator", characters: ["Panchia", "Bollarator"], colors: ["Red"], skill: null }),
  "B-DROP": card("B-DROP", { name: "Bollarator Drop", characters: ["Bollarator"], colors: ["Red"], skill: null }),
  "B-BLUE": card("B-BLUE", { name: "Bollarator Blue", characters: ["Bollarator"], colors: ["Blue"], skill: null }),
  // 4. Field
  "L-FIELD": leader("L-FIELD", "[Activate: Main] Activate up to 1 {Tragedy Overground} from your hand, Drop Area, deck, or Energy Area, then shuffle your deck if you looked through it."),
  "L-RING": leader("L-RING", "[Activate: Main] Activate up to 1 {Broly's Ring} from your deck."),
  "FIELD-X": card("FIELD-X", { name: "Tragedy Overground", type: "EXTRA", energyCost: 3, colors: ["Red"], power: null, comboCost: null, comboPower: null, skill: "[Field]" }),
  "FIELD-OLD": card("FIELD-OLD", { name: "Old Planet", type: "EXTRA", energyCost: 1, colors: ["Red"], power: null, comboCost: null, comboPower: null, skill: "[Field]" }),
  "RING-X": card("RING-X", { name: "Broly's Ring", type: "EXTRA", energyCost: 1, colors: ["Green"], power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." }),
  // 5. the promos
  "L-COMPLIMENT": leader("L-COMPLIMENT", "[Activate: Main] You and your opponent compliment each other."),
};
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

function main(leaderId: string): VmState {
  let state = RULES.createGame(ctx, { seed: 907, p1: { name: "You", leader: leaderId, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = RULES.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = RULES.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: string, area: "hand" | "energy" | "battle" | "drop" | "deck", player: PlayerId = "p1"): string {
  const physical = state.sides[player].zones.deck[0];
  assert.ok(physical);
  state.cards[physical].cardId = id;
  if (area === "deck") return physical;
  assert.ok(moveCard(state, game, physical, area, { owner: player }).ok);
  if (area === "battle") state.cards[physical].mode = "active";
  return physical;
}
function step(state: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  assert.ok(RULES.legalActions(ctx, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), json({ prompt: state.prompt, action }));
  const r = RULES.apply(ctx, JSON.parse(json(state)), action);
  return { state: r.state as VmState, events: r.events as GameEvent[] };
}
const take = (state: VmState, action: Action): VmState => step(state, action).state;
const candidates = (state: VmState): string[] => (state.prompt.kind === "chooseCards" ? [...state.prompt.choice.candidates] : []);
const activate = (state: VmState) => step(state, { type: "activate", player: "p1", card: state.sides.p1.zones.leader[0], skill: 0 });
const power = (state: VmState) => attrsNow(ctx, game, state, state.sides.p1.zones.leader[0]).power as number;
const sorted = (xs: string[]) => [...xs].sort();

// 1. The count: four character names, not four card names (BT18-119, BT18-107).
{
  const s = main("L-COUNT");
  const base = power(s);
  stage(s, "T-A", "energy"); stage(s, "F-A", "energy"); stage(s, "G-A", "energy");
  assert.equal(power(s), base, "three character names");
  stage(s, "T-B", "energy");
  assert.equal(power(s), base, "a fourth CARD NAME but the same character <Tora>: still three (BT18-099's rule counts it as a fourth card name, this one does not)");
  stage(s, "BAR-A", "energy");
  assert.equal(power(s), base, "<Bardock> is excluded by 'non-<Bardock>'");
  stage(s, "NAMELESS", "energy");
  assert.equal(power(s), base, "a card with no character name has none to differ by");
  stage(s, "SAIYAN-ONLY", "energy");
  assert.equal(power(s), base, "and a Saiyan that is not Bardock's Crew does not count");
  const seripa = stage(s, "S-A", "energy");
  assert.equal(power(s), base + 6000, "the fourth character name");
  assert.equal(power(JSON.parse(json(s))), base + 6000, "reloaded from JSON");
  moveCard(s, game, seripa, "hand", { owner: "p1" });
  assert.equal(power(s), base, "and it leaves with it");
  const foe = fresh();
  for (const id of ["T-A", "F-A", "G-A", "S-A"]) stage(foe, id, "energy", "p2");
  assert.equal(power(foe), power(main("L-COUNT")), "the opponent's energy is not asked");
}
function fresh(): VmState { return main("L-COUNT"); }
{
  // The choice: after one <Tora>, the other <Tora> is no longer on offer.
  const s = main("L-PICK");
  const a = stage(s, "T-A", "drop"), b = stage(s, "T-B", "drop"), f = stage(s, "F-A", "drop"), g = stage(s, "G-A", "drop");
  const bar = stage(s, "BAR-A", "drop"), none = stage(s, "NAMELESS", "drop");
  let t = activate(s).state;
  assert.deepEqual(sorted(candidates(t)), sorted([a, b, f, g]), "non-Bardock Bardock's Crew cards with a character name; not <Bardock>, not nameless");
  t = take(t, { type: "choose", player: "p1", cards: [a] });
  assert.deepEqual(sorted(candidates(t)), sorted([f, g]), "the other <Tora> is not offered after the first");
  t = take(t, { type: "choose", player: "p1", cards: [f] });
  assert.deepEqual(candidates(t), [g]);
  t = take(t, { type: "choose", player: "p1", cards: [g] });
  assert.deepEqual(sorted(t.sides.p1.zones.warp.filter((id) => [a, b, f, g, bar, none].includes(id))), sorted([a, f, g]), "three different characters were sent; the second <Tora> stayed");
  assert.ok(t.sides.p1.zones.drop.includes(b) && t.sides.p1.zones.drop.includes(bar) && t.sides.p1.zones.drop.includes(none));
}

// 2. A colour said once: only black <Vegito> or black <Vegito : Xeno> counts.
{
  const s = main("L-VEGITO");
  const base = power(s);
  stage(s, "V-RED", "battle");
  assert.equal(power(s), base, "a red <Vegito> is no black one");
  stage(s, "VX-BLUE", "battle");
  assert.equal(power(s), base, "a blue <Vegito: Xeno> is no black one: the colour holds for the second name too");
  stage(s, "VX-BLACK", "battle");
  assert.equal(power(s), base + 1000, "a black <Vegito: Xeno> is");
  const t = main("L-VEGITO");
  stage(t, "V-BLACK", "battle");
  assert.equal(power(t), base + 1000, "and so is a black <Vegito>");
}

// 3. The three-name choice: one red card of each name, each a card of its own.
{
  const build = () => {
    const s = main("L-NAMED");
    const ids = {
      kHand: stage(s, "K-HAND", "hand"), kDrop: stage(s, "K-DROP", "drop"), kBlue: stage(s, "K-BLUE", "hand"),
      pBattle: stage(s, "P-BATTLE", "battle"), both: stage(s, "PB-BOTH", "hand"),
      bDrop: stage(s, "B-DROP", "drop"), bBlue: stage(s, "B-BLUE", "drop"),
      foeK: stage(s, "K-DROP", "drop", "p2"),
    };
    return { s, ids };
  };
  const { s, ids } = build();
  let t = activate(s).state;
  assert.deepEqual(sorted(candidates(t)), sorted([ids.kHand, ids.kDrop]), "<Koitsukai>, red, from hand or Battle Area or Drop; not the blue one, not the opponent's");
  t = take(t, { type: "choose", player: "p1", cards: [ids.kDrop] });
  assert.deepEqual(sorted(candidates(t)), sorted([ids.pBattle, ids.both]), "<Panchia>: the Battle Area card and the double-named card");
  t = take(t, { type: "choose", player: "p1", cards: [ids.both] });
  assert.deepEqual(candidates(t), [ids.bDrop], "<Bollarator>: the double-named card is spoken for by <Panchia>, the blue one is the wrong colour");
  t = take(t, { type: "choose", player: "p1", cards: [ids.bDrop] });
  const host = t.sides.p1.zones.leader[0];
  assert.deepEqual(sorted(t.cards[host].under), sorted([ids.kDrop, ids.both, ids.bDrop]), "all three are under this card");
  for (const id of [ids.kHand, ids.kBlue, ids.bBlue]) assert.ok(!t.cards[host].under.includes(id));
  assert.ok(t.sides.p2.zones.drop.includes(ids.foeK), "the opponent's card did not move");
  assert.deepEqual(sorted(JSON.parse(json(t)).cards[host].under), sorted([ids.kDrop, ids.both, ids.bDrop]), "reloaded");
  // "Up to": each name may be declined.
  let u = activate(build().s).state;
  u = take(u, { type: "choose", player: "p1", cards: [] });
  u = u.prompt.kind === "chooseCards" ? take(u, { type: "choose", player: "p1", cards: [candidates(u)[0]] }) : u;
  u = u.prompt.kind === "chooseCards" ? take(u, { type: "choose", player: "p1", cards: [] }) : u;
  assert.equal(u.cards[u.sides.p1.zones.leader[0]].under.length, 1, "taking one name only is allowed");
}

// 4. Activating a [Field] Extra is not playing it.
{
  const prep = () => {
    const s = main("L-FIELD");
    const old = stage(s, "FIELD-OLD", "battle");
    const field = stage(s, "FIELD-X", "deck");
    return { s, field, old };
  };
  const { s, field, old } = prep();
  const started = activate(s);
  let t = started.state;
  assert.deepEqual(candidates(t), [field], "the Extra named in braces, from the deck " + json(t.prompt).slice(0, 400));
  const chosen = step(t, { type: "choose", player: "p1", cards: [field] });
  t = chosen.state;
  for (let i = 0; i < 3 && t.prompt.kind === "chooseCards"; i++) t = take(t, { type: "choose", player: "p1", cards: candidates(t).includes(old) ? [old] : [candidates(t)[0]] });
  assert.ok(t.sides.p1.zones.battle.includes(field), "the [Field] skill placed it in the Battle Area");
  assert.equal(t.cards[field].mode, "active", "in Active Mode (22-3-2)");
  assert.ok(t.sides.p1.zones.drop.includes(old), "and the [Field] Extra already out went to the Drop (22-3-5)");
  const allEvents = [...started.events, ...chosen.events];
  assert.ok(allEvents.some((e) => e.type === "skill" && e.card === field), "the Extra's own skill was activated and announced (22-3-3), where a play announces none");
  assert.equal(t.sides.p1.zones.energy.filter((id) => t.cards[id].mode === "rest").length, s.sides.p1.zones.energy.filter((id) => s.cards[id].mode === "rest").length, "its energy cost was not paid (12-2-4)");

  // A [Field] skill that is switched off is not activated - and the card is not played in its place.
  const blocked = prep();
  blocked.s.effects.push({ id: 9001, target: blocked.field, kind: "negateSkills", value: 0, until: "game", source: blocked.s.sides.p1.zones.leader[0], createdTurn: blocked.s.turn, ownerTurn: "p1", master: "p1" } as never);
  let b = activate(blocked.s).state;
  for (let i = 0; i < 3 && b.prompt.kind === "chooseCards"; i++) b = take(b, { type: "choose", player: "p1", cards: candidates(b).includes(blocked.field) ? [blocked.field] : [] });
  assert.ok(!b.sides.p1.zones.battle.includes(blocked.field), "negated: not placed");
  assert.ok(b.sides.p1.zones.deck.includes(blocked.field), "and still in the deck");

  // A named Extra with no [Field] is played as it always was.
  const ring = main("L-RING");
  const r = stage(ring, "RING-X", "deck");
  let q = activate(ring).state;
  q = take(q, { type: "choose", player: "p1", cards: [r] });
  assert.ok(q.sides.p1.zones.battle.includes(r), "the fallback is unchanged: the non-[Field] Extra is played");
}

// 5. The promos: both notes, in the log, in order.
{
  const s = main("L-COMPLIMENT");
  const { events } = activate(s);
  const notes = events.filter((e): e is Extract<GameEvent, { type: "note" }> => e.type === "note").map((e) => e.text);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^Compliment: /);
  assert.match(notes[1], /^Instruction acknowledged: /);
}
console.log("  ok  #907 named gaps: character names, a shared colour, the three-name choice, [Field] activation, the compliment promos");

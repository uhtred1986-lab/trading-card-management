/**
 * #907, the third census round (18 Oct 2026). The families of the round-2 census comment that
 * #1039 left:
 *
 *  - a bare "once per turn" cut off from the replacement or prohibition it limits (BT21-040,
 *    BT22-117, P-638): a [Permanent] spends its own line for the turn, which is "once per turn".
 *  - "inflict N damage to your opponent" (BT1-011, BT2-006, EX03-03) is "deal N damage".
 *  - "evolve this card into it" (BT1-017, EX06-04, P-018, P-065): the explicit evolution of 22-5-2-3.
 *  - "you start the game with N life" (BT12-002, BT16-046, BT16-047, BT19-100): 6-2-2-1.
 *  - "place this card under it from its owner's Drop Area" (BT12-007, -037, -067, -107; BT18-042).
 *  - "you can only place up to N energy" (BT3-032, BT9-127, BT19-034): the Energy Area limit.
 *  - "gains power equal to the total combo power of the cards discarded by this skill"
 *    (BT20-090, -107, -108, -109).
 *  - "add it to its owner's Z-Energy" and "your opponent adds N card from their hand to their
 *    Z-Energy" (BT21-036 ... BT25-128, P-669).
 *
 * Not done, and why: "if ... this card was used in a combo from your deck or hand" (BT12-071,
 * -072, -074, -075) needs the engine to remember where a combo card came from.
 *
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { DEFS, IMPL, CTX, actsG, assertConsistentG, card, compileSkill, fifty, findG, parseSkills, playG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import { validateProgram, type Op } from "../../src/lib/arena/vm/script";
import { describeScript } from "../../src/lib/arena/vm/script-schema";
import { powerOfG } from "./harness";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
const def = (id: string, o: Parameters<typeof card>[1] & { skill?: string }) => {
  DEFS[id] = { ...card(id, o), ...o, id, name: id } as (typeof DEFS)[string];
};
function find<T extends Op["op"]>(node: unknown, kind: T, out: Extract<Op, { op: T }>[] = []): Extract<Op, { op: T }>[] {
  if (Array.isArray(node)) for (const x of node) find(x, kind, out);
  else if (node && typeof node === "object") {
    if ((node as { op?: string }).op === kind) out.push(node as Extract<Op, { op: T }>);
    for (const v of Object.values(node)) find(v, kind, out);
  }
  return out;
}
const pay = (s: EngineState) => (s.prompt.kind === "payCost" ? playG(s, { type: "payCost", player: "p1", option: 0 } as Action) : s);
/** Answers whatever the prompt asks with the first candidates, until the game is back at a Main Phase. */
const settle = (s: EngineState): EngineState => {
  for (let i = 0; i < 12 && s.prompt.kind === "chooseCards"; i++) {
    const p = s.prompt as { player: PlayerId; choice: { candidates: string[]; min?: number } };
    s = playG(s, { type: "choose", player: p.player, cards: p.choice.candidates.slice(0, Math.max(1, p.choice.min ?? 1)) } as Action);
  }
  return s;
};

/** p1's second-turn Main Phase with a Leader of our own and the named cards put into hand, energy and battle. */
function game(leaderId: string, o: { hand?: string[]; energy?: string[]; battle?: string[]; oppHand?: string[]; oppBattle?: string[]; atCharge?: boolean } = {}): EngineState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: leaderId, main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(CTX, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p2", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p2" }).state as VmState;
  if (!o.atCharge) r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  assert.equal(r.prompt.kind, o.atCharge ? "charge" : "main");
  const stage = (p: PlayerId, cardId: string, area: "hand" | "energy" | "battle") => {
    const filler = p === "p1" ? "V1" : "V-BLUE";
    const id = r.sides[p].zones.deck.find((x) => r.cards[x].cardId === filler);
    assert.ok(id, "the deck has a filler card to relabel");
    r.sides[p].zones.deck = r.sides[p].zones.deck.filter((x) => x !== id);
    r.cards[id!].cardId = cardId;
    r.sides[p].zones[area] = [...r.sides[p].zones[area], id!];
    if (area !== "hand") r.cards[id!].mode = "active";
  };
  for (const id of o.hand ?? []) stage("p1", id, "hand");
  for (const id of o.energy ?? []) stage("p1", id, "energy");
  for (const id of o.battle ?? []) stage("p1", id, "battle");
  for (const id of o.oppHand ?? []) stage("p2", id, "hand");
  for (const id of o.oppBattle ?? []) stage("p2", id, "battle");
  return r;
}
const playCard = (s: EngineState, id: string) => settle(pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", id) })));

// ── "inflict N damage to your opponent" ─────────────────────────────────────
{
  for (const text of [
    "[auto] When a card evolves into this card, inflict 2 damage to your opponent.",
    "[Auto] When this card KOs your opponent's Battle Card, inflict 2 damage to your opponent.",
    "[Auto] During your turn, when this card KOs an opponent's Battle Card, inflict 1 damage to your opponent.",
  ]) {
    const got = compile(text);
    assert.deepEqual(got.unsupported, [], text);
    assert.equal(find(got.ops, "damage")[0]?.side, "opponent", text);
  }
  // BT1-015 reads since "after the battle" is the Battle End Step (#907, battle-end-followups-907.ts).
  assert.deepEqual(compile("[auto] When this card attacks a Battle Card, KO that card after the battle. Then, if your opponent's Leader Card has 10000 or less power, inflict 1 damage to your opponent.").unsupported, [],
    "BT1-015: \"after the battle\" is a battleEnd delay");
  // What the exposure showed: an imperative "KO ..." first after the trigger was cut as the trigger's "and KOs ...".
  const ko = compile("[auto] When this card attacks, choose 1 of your opponent's Battle Cards and KO it. Then, draw 1 card.");
  assert.deepEqual(find(ko.ops, "ko").length, 1, "the KO is still there");
  const bare = compile("[auto] When this card attacks, KO your opponent's Battle Card in Rest Mode. Then, draw 1 card.");
  assert.deepEqual(find(bare.ops, "ko").length, 1, "an imperative KO is an effect, not the second half of the trigger");
  assert.deepEqual(find(compile("[auto] When this card attacks and KOs an opponent's Battle Card, draw 1 card.").ops, "ko"), [], "'and KOs ...' is still the trigger's");

  def("R3-HIT", { energyCost: 0, skill: "[Auto] When this card is played, inflict 2 damage to your opponent." });
  let s = game("L-RED", { hand: ["R3-HIT"] });
  const life = zoneOf(s, "p2", "life").length;
  s = settle(playCard(s, "R3-HIT"));
  assert.equal(zoneOf(s, "p2", "life").length, life - 2, "two life cards are taken as damage");
  assertConsistentG(s);
}

// ── "evolve this card into it" ──────────────────────────────────────────────
{
  const from = compile("[activate: main] {2}: Look at up to 7 cards from the top of your deck, choose one <Frost> with [evolve] among them and Evolve this card into it. Then, shuffle your deck.");
  assert.deepEqual(from.unsupported, [], "BT1-017");
  const [evolve] = find(from.ops, "play");
  assert.equal(evolve.using, "Evolve");
  assert.deepEqual(evolve.onto, { sel: { special: "self" } }, "on top of this card");
  assert.ok("var" in evolve.target, "the card chosen");
  for (const text of [
    "[activate: main] {r}{r}{1}: Choose up to 1 red <Hit> card in your Drop Area or Warp with an energy cost of 6, evolve this card into it, and you can't play red <Hit> cards with an energy cost of 6 for the duration of the turn.",
    "[Activate: Main] Place 2 of your yellow Battle Cards other than this card in the Drop Area: Choose up to 1 {Golden Frieza, The Resurrected Terror} from your hand and evolve this card into it. If you do so, draw 2 cards.",
    "[activate: main] If your Leader Card is {Going All In, SSB Vegito}, choose 1 <Vegito> with 25000 power in your hand and evolve this card into it.",
  ]) {
    const got = compile(text);
    assert.deepEqual(got.unsupported, [], text);
    assert.equal(find(got.ops, "play")[0]?.using, "Evolve", text);
  }
  assert.deepEqual(compile("[Activate: Main] Choose up to 1 <R3 Base> card in your Battle Area and evolve it into this card.").unsupported.length > 0, true, "the other direction is not this reading");

  // In a game: the card in hand is played on top of the base, which goes under it.
  def("R3-BASE", { energyCost: 1, characters: ["R3 Frost"], skill: "[Activate: Main] Choose up to 1 <R3 Frost> card in your hand and evolve this card into it." });
  def("R3-NEXT", { energyCost: 3, characters: ["R3 Frost"], power: 20000 });
  let s = game("L-RED", { hand: ["R3-NEXT"], battle: ["R3-BASE"], energy: ["V1", "V1", "V1"] });
  const base = findG(s, "p1", "battle", "R3-BASE");
  const act = actsG(s).find((a) => a.type === "activate" && a.card === base);
  assert.ok(act, "the base's Activate is on the menu");
  s = settle(pay(playG(s, act as Action)));
  const next = findG(s, "p1", "battle", "R3-NEXT");
  assert.ok(s.cards[next].under.includes(base), "the base is under the card it evolved into");
  assert.ok(!zoneOf(s, "p1", "battle").includes(base), "and no longer stands by itself");
  assert.equal(zoneOf(s, "p1", "hand").some((id) => s.cards[id].cardId === "R3-NEXT"), false, "it left the hand");
  assertConsistentG(s);
}

// ── "you start the game with N life" ────────────────────────────────────────
{
  const got = compile("[Permanent] You start the game with 6 life.");
  assert.deepEqual(got.unsupported, [], "BT12-002");
  assert.deepEqual(got.ops, [{ op: "permit", what: "startLife", n: 6, target: { sel: { special: "self" } }, until: "game" }]);
  assert.equal(validateProgram(got.ops), true);
  assert.equal(describeScript(got.ops, { permanent: true }), "you start the game with 6 life");
  for (const n of [4, 5, 6]) assert.deepEqual(compile(`[Permanent] You start the game with ${n} life.`).unsupported, []);
  assert.ok(compile("[Auto] When this card is played, you start the game with 6 life.").unsupported.length > 0, "only a [Permanent] is a pre-game line");

  for (const [n, id] of [[4, "R3-LIFE4"], [6, "R3-LIFE6"]] as const) {
    DEFS[id] = { ...DEFS["L-RED"], id, name: id, skill: `[Permanent] You start the game with ${n} life.` };
    const s = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: id, main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
    const first = (s.prompt as { player: PlayerId }).player;
    let r = IMPL.apply(CTX, s, { type: "chooseFirst", player: first, first: "p1" }).state as VmState;
    r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
    r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
    assert.equal(zoneOf(r, "p1", "life").length, n, `the Leader that starts the game with ${n} life`);
    assert.equal(zoneOf(r, "p2", "life").length, 8, "and the opponent keeps the 8 of the rule (6-2-1-10)");
    assert.equal(zoneOf(r, "p1", "deck").length, 50 - 6 - n, "the life cards came off the top of the deck");
    assertConsistentG(r);
  }
}

// ── "place this card under it from its owner's Drop Area" ───────────────────
{
  const got = compile("[Auto] If your Leader Card is red and you have a red Unison Card in play: When this card is used in a combo, draw 1 card, then at the end of the battle, choose up to 1 of your red Unison Cards with [Rejuvenate] in its skill text and place this card under it from its owner's Drop Area.");
  assert.deepEqual(got.unsupported, [], "BT12-007");
  const [delay] = find(got.ops, "delay");
  const [put] = find(delay.ops, "moveTo");
  assert.equal(put.to, "under");
  assert.deepEqual(put.target, { sel: { special: "self", area: "drop" } }, "this card, from the Drop where the combo left it");
  assert.ok(put.under && "var" in put.under, "under the Unison chosen");
  const act = compile("[Activate: Main][Limit 1] Choose up to 1 {Super Paikuhan, True Mastery} in your Unison Area and place this card under it from your Drop.");
  assert.deepEqual(act.unsupported, [], "BT18-042: the same words in an Activate");
}

// ── "you can only place up to N energy" ─────────────────────────────────────
{
  const got = compile("[Permanent] You can only place up to 6 energy in your Energy Area.");
  assert.deepEqual(got.unsupported, [], "BT9-127");
  assert.deepEqual(got.ops, [{ op: "forbid", what: "energyCap", side: "you", until: "game", unless: { kind: "count", sel: { side: "you", area: "energy" }, atMost: 5 } }]);
  assert.equal(validateProgram(got.ops), true);
  assert.deepEqual(compile("[Permanent] You can only place up to 3 energy.").unsupported, [], "BT19-034");
  assert.ok(compile("[Auto] When this card is played, you can only place up to 3 energy.").unsupported.length > 0, "only a standing limit");

  def("R3-CAP", { skill: "[Permanent] You can only place up to 3 energy." });
  def("R3-ADD", { energyCost: 0, skill: "[Auto] When this card is played, choose up to 3 cards in your hand and add them to your energy." });
  DEFS["L-CAP3"] = { ...DEFS["L-RED"], id: "L-CAP3", name: "L-CAP3", skill: "[Permanent] You can only place up to 3 energy." };
  // The Charge Phase: with 3 energy in the Energy Area no card in hand can be charged; with 2, one can.
  let s = game("L-CAP3", { energy: ["V1", "V1", "V1"], atCharge: true });
  assert.equal(zoneOf(s, "p1", "energy").length, 3);
  const charge = (g: EngineState) => IMPL.legalActions(CTX, g).filter((a) => a.action.type === "charge" && (a.action as { card: string | null }).card !== null);
  assert.equal(charge(s).length, 0, "no card can be placed in the Energy Area at the limit");
  const why = IMPL.rejectedActions(CTX, s, IMPL.legalActions(CTX, s)).filter((a) => a.action.type === "charge" && (a.action as { card: string | null }).card !== null);
  assert.ok(why.length > 0 && why.every((r) => r.why.some((w) => w.kind === "forbidden")), "and the menu says a rule in force forbids it");
  s = game("L-CAP3", { energy: ["V1", "V1"], atCharge: true });
  assert.ok(charge(s).length > 0, "one below the limit, a card can be");
  // …and a skill's placement: three cards asked for, one fits (2 energy, limit 3).
  s = game("L-CAP3", { energy: ["V1", "V1"], hand: ["R3-ADD", "V1", "V1"] });
  const before = zoneOf(s, "p1", "energy").length;
  s = settle(pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "R3-ADD") })));
  assert.equal(zoneOf(s, "p1", "energy").length, 3, `the skill stops at the limit (${before} -> 3)`);
  assertConsistentG(s);
  // The opponent is not bound by it.
  const t = game("L-RED", { energy: ["V1", "V1", "V1", "V1"], hand: ["R3-ADD", "V1"] });
  const t2 = settle(pay(playG(t, { type: "play", player: "p1", card: findG(t, "p1", "hand", "R3-ADD") })));
  assert.ok(zoneOf(t2, "p1", "energy").length > 4, "a Leader without the line places freely");
}

// ── "gains power equal to the total combo power of the cards discarded by this skill" ──
{
  const got = compile("[Activate: Main][Limit 1] Discard 1 or more ≪Majin≫ cards from your hand: Choose up to 1 of your opponent's Battle Cards in Rest Mode, KO it, and this card gains power equal to the total combo power of the cards discarded by this skill for the turn.");
  assert.deepEqual(got.unsupported, [], "BT20-109");
  const [gain] = find(got.ops, "power");
  assert.deepEqual(gain.amount, { sumOf: { fromVar: "c0" }, attr: "comboPower" }, "the combo powers of the price's discards, added up");
  assert.equal(gain.until, "turn");
  const mixed = compile("[Activate: Main][Limit 1] If there are 2 cards under this card and you discard 1 or more yellow ≪Majin≫ cards from your hand: This card gains power equal to the total combo power of the cards discarded by this skill for the turn. Additionally, if this card has 20000 power or more, draw 1 card.");
  assert.deepEqual(mixed.unsupported, [], "BT20-090");
  // A price that chose something else has no discarded cards.
  assert.ok(compile("[Activate: Main] Choose 1 of your Battle Cards and switch it to Rest Mode: This card gains power equal to the total combo power of the cards discarded by this skill for the turn.").unsupported.length > 0,
    "no discard, no 'cards discarded by this skill'");

  def("R3-MAJIN", { energyCost: 1, comboPower: 7000, traits: ["R3 Majin"] });
  def("R3-GAINER", { energyCost: 1, power: 10000, skill: "[Activate: Main][Limit 1] Discard 1 or more ≪R3 Majin≫ cards from your hand: This card gains power equal to the total combo power of the cards discarded by this skill for the turn." });
  let s = game("L-RED", { hand: ["R3-MAJIN"], battle: ["R3-GAINER"] });
  const gainer = findG(s, "p1", "battle", "R3-GAINER");
  const was = powerOfG(s, gainer);
  const act = actsG(s).find((a) => a.type === "activate" && a.card === gainer);
  assert.ok(act, "the Activate is on the menu");
  s = settle(pay(playG(s, act as Action)));
  assert.equal(powerOfG(s, gainer), was + 7000, "the discarded card's combo power is added for the turn");
  assert.equal(zoneOf(s, "p1", "hand").some((id) => s.cards[id].cardId === "R3-MAJIN"), false, "it was discarded");
  assertConsistentG(s);
}

// ── Z-Energy ────────────────────────────────────────────────────────────────
{
  for (const text of [
    "[auto][once per turn] When this card attacks, draw 1 card, choose up to 1 of your opponent's Battle Cards and add it to its owner's Z-Energy.",
    "[Auto][Limit 1] If your Leader is mono-blue and your opponent has 3 or more energy: When this card is played, draw 1 card, choose up to a total of 3 Battle Cards in your opponent's Battle Area or Drop and add them to its owner's Z-Energy.",
    "[Auto] Add this card to your Z-Energy: When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost of 7 or less, add it to its owner's Z-Energy, then choose up to 1 of your opponent's Unisons and remove 2 markers from it.",
    "[Auto][Once per turn] When this card attacks, choose up to 1 Battle Card in your opponent's Battle Area and up to 1 Battle Card in your opponent's Drop, add them to your opponent's Z-Energy, then your opponent adds 1 card from their hand to their Z-Energy.",
    "[auto] When this card is played, you and your opponent draw 1 card, then your opponent adds 1 card from their hand to their Z-Energy.",
    "[Auto] When this card is played, your opponent draws 1 card and adds 1 card from their hand to their Z-Energy.",
  ]) {
    const got = compile(text);
    assert.deepEqual(got.unsupported, [], text);
    assert.ok(find(got.ops, "moveTo").some((m) => m.to === "zEnergy"), text);
  }
  // Left unread on purpose: the effect's own choice has replaced "the chosen card" (P-504), and a life card is chosen unseen (BT23-103).
  assert.ok(compile("[Auto] When this card is played, add 1 of your opponent's life to its owner's Z-Energy.").unsupported.length > 0, "a life card is not read");
  const p504 = compile("[activate: main][limit 1]{u}, if your Leader is a blue <Uub>, you have 2 or more energy, and you choose 1 of your opponent's Battle Cards: Play this card from your hand and add the chosen card to your opponent's Z-Energy.");
  assert.ok(p504.unsupported.length > 0, "P-504: 'the chosen card' is the price's, which the effect's choice has replaced - unread");

  // In a game: the owner's Z-Energy takes the card the opponent's skill is made to give up…
  def("R3-TAKER", { energyCost: 0, skill: "[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and add it to its owner's Z-Energy." });
  def("R3-THEIRS", { energyCost: 1 });
  let s = game("L-RED", { hand: ["R3-TAKER"], oppBattle: ["R3-THEIRS"] });
  const theirs = findG(s, "p2", "battle", "R3-THEIRS");
  s = playCard(s, "R3-TAKER");
  assert.ok(zoneOf(s, "p2", "zEnergy").includes(theirs), "the card went to its owner's Z-Energy");
  assert.ok(!zoneOf(s, "p1", "zEnergy").includes(theirs), "not to ours");
  assertConsistentG(s);

  // …and the opponent's own choice from their own hand.
  def("R3-GIVER", { energyCost: 0, skill: "[Auto] When this card is played, your opponent adds 1 card from their hand to their Z-Energy." });
  s = game("L-RED", { hand: ["R3-GIVER"], oppHand: ["R3-THEIRS"] });
  const handBefore = zoneOf(s, "p2", "hand").length;
  const zBefore = zoneOf(s, "p2", "zEnergy").length;
  s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "R3-GIVER") });
  assert.equal(s.prompt.kind, "chooseCards", "the opponent is asked");
  assert.equal((s.prompt as { player: PlayerId }).player, "p2", "and it is their choice");
  s = settle(s);
  assert.equal(zoneOf(s, "p2", "hand").length, handBefore - 1);
  assert.equal(zoneOf(s, "p2", "zEnergy").length, zBefore + 1);
  assertConsistentG(s);
}

// ── "once per turn" ─────────────────────────────────────────────────────────
{
  const ko = compile("[Permanent] Once per turn, if this card would be KO'd by an opponent's skill, you may place 1 card from under a {Universal Tuffleization Plan} in your Battle Area into your Drop instead.");
  assert.deepEqual(ko.unsupported, [], "BT21-040");
  const [swap] = find(ko.ops, "replace");
  assert.equal(swap.event, "ko");
  assert.deepEqual(swap.with.at(-1), { op: "negateOwnSkill", until: "turn" }, "the replacement spends the line for the turn");
  assert.equal(swap.optional, true, "it stays an offer");

  const hold = compile("[Permanent] During your turn, once per turn, this card can't be removed from your Battle Area by your opponent's skills.");
  assert.deepEqual(hold.unsupported, [], "BT22-117");
  const [shield] = find(hold.ops, "replace");
  // Owner ruling, 26 Oct 2026: a skill's KO is a removal too (prohibition-catalog-2).
  assert.deepEqual([shield.event, shield.by, shield.bySide], ["leave", "skillOrKoBySkill", "opponent"]);
  assert.deepEqual(shield.with, [{ op: "negateOwnSkill", until: "turn" }]);
  assert.equal(hold.ops[0].op, "if", "during your turn only");

  const mixed = compile("[Permanent] Your yellow ≪Boujack Brigade≫ cards with energy costs of 2 or less other than this card gain [Barrier], and once per turn, this card can't be removed from a Battle Area by skills.");
  assert.deepEqual(mixed.unsupported, [], "P-638");
  assert.equal(find(mixed.ops, "replace")[0]?.bySide, undefined, "any skill");
  // Left unread: a KO in battle is not a moment the replacement table has (BT17-139), and a count of uses (BT28-078b).
  assert.ok(compile("[Permanent] Once per turn, if this card would be KO'd in battle, you may place 1 card from under this card in its owner's Drop Area instead.").unsupported.length > 0);
  assert.ok(compile("[Permanent] Once per turn, when you activate {Stop You Fiend!}'s skill from your hand, reduce the energy cost by {y}.").unsupported.length > 0);

  // In a game: the first removal by a skill in a turn fails, the second does not.
  def("R3-STAY", { energyCost: 1, skill: "[Permanent] Once per turn, this card can't be removed from a Battle Area by skills." });
  def("R3-BOUNCE", { energyCost: 0, skill: "[Auto] When this card is played, choose up to 1 {R3-STAY} in your Battle Area and return it to its owner's hand." });
  let s = game("L-RED", { hand: ["R3-BOUNCE", "R3-BOUNCE"], battle: ["R3-STAY"] });
  const stay = findG(s, "p1", "battle", "R3-STAY");
  const bounce = (g: EngineState) => settle(pay(playG(g, { type: "play", player: "p1", card: zoneOf(g, "p1", "hand").find((id) => g.cards[id].cardId === "R3-BOUNCE")! })));
  s = bounce(s);
  assert.ok(zoneOf(s, "p1", "battle").includes(stay), "the first attempt in the turn does not remove it");
  s = bounce(s);
  assert.ok(!zoneOf(s, "p1", "battle").includes(stay), "the second one does");
  assertConsistentG(s);
}

console.log("census-round3-907: ok");

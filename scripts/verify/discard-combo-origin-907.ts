/**
 * #907, the discard-count and combo-origin round (18 Oct 2026):
 *
 *  - a price "discard 1 or more ... cards from your hand" (BT20-090, -107, -108, -109) is a choice of at
 *    least that many and as many more as the player likes, bounded by the hand. It was read as exactly one.
 *    The total combo power "of the cards discarded by this skill" is therefore over all of them.
 *  - "N cards under this card" (BT20-090, -107, -108) is the pile under the card whose skill it is; the
 *    reading said "under your cards".
 *  - "this card was used in a combo from your deck or hand" (BT12-071, -072, -074, -075): the engine keeps the
 *    area a combo card came from (`VmBattle.comboOrigins`), `comboFrom` asks it, and the [Auto]'s
 *    "When this card would be placed in its owner's Drop Area from a Combo Area, you may play it (in Rest
 *    Mode) instead" is a standing replacement while the card is in a Combo Area.
 *
 * Not done: BT17-139's "if this card would be KO'd in battle" (a battle's KO is taken by the Damage Step and
 * has no point at which an optional replacement could be asked); see the PR.
 */
import assert from "node:assert/strict";
import { DEFS, IMPL, CTX, actsG, assertConsistentG, card, compileSkill, fifty, findG, parseSkills, playG, powerOfG, zoneOf, arenaG, leaderOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import type { GameEvent } from "../../src/lib/arena/types";
import { compileCostProgram } from "../../src/lib/arena/compile";
import { describeScript } from "../../src/lib/arena/vm/script-schema";
import { validateProgram, type Op } from "../../src/lib/arena/vm/script";

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

/** p1's second-turn Main Phase with a Leader of our own and the named cards put into hand, energy and battle. */
function game(leaderId: string, o: { hand?: string[]; energy?: string[]; battle?: string[] } = {}): EngineState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: leaderId, main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(CTX, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p2", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p2" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  assert.equal(r.prompt.kind, "main");
  const stage = (cardId: string, area: "hand" | "energy" | "battle") => {
    const id = r.sides.p1.zones.deck.find((x) => r.cards[x].cardId === "V1");
    assert.ok(id, "the deck has a filler card to relabel");
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((x) => x !== id);
    r.cards[id!].cardId = cardId;
    r.sides.p1.zones[area] = [...r.sides.p1.zones[area], id!];
    if (area !== "hand") r.cards[id!].mode = "active";
  };
  for (const id of o.hand ?? []) stage(id, "hand");
  for (const id of o.energy ?? []) stage(id, "energy");
  for (const id of o.battle ?? []) stage(id, "battle");
  return r;
}

// ── "discard 1 or more ... cards from your hand" ────────────────────────────
{
  const text = "[Activate: Main][Limit 1] If there are 2 cards under this card and you discard 1 or more yellow ≪Majin≫ cards from your hand: This card gains power equal to the total combo power of the cards discarded by this skill for the turn. Additionally, if this card has 20000 power or more, draw 1 card.";
  const price = compileCostProgram(parseSkills(text)[0]);
  assert.ok(price, "the price is a program");
  const [pick] = find(price.ops, "choose");
  assert.equal(pick.sel.minCount, 1, "at least one");
  assert.equal(pick.sel.count, 99, "and as many more as the hand holds");
  assert.ok(!pick.sel.upTo, "the first card is not optional");
  assert.equal(pick.sel.area, "hand");
  assert.deepEqual(find(price.ops, "moveTo").map((m) => m.to), ["drop"], "all of them are discarded");
  assert.match(describeScript(price.ops), /1 or more/);
  for (const bad of ["Discard 2 or more", "Discard 1 or more"]) {
    const alone = compileCostProgram(parseSkills(`[Activate: Main] ${bad} ≪R9 Majin≫ cards from your hand: Draw 1 card.`)[0]);
    assert.equal(find(alone?.ops ?? [], "choose")[0]?.sel.minCount, Number(bad.match(/\d/)![0]), bad);
  }
  // A plain count is still exactly that many.
  const exact = compileCostProgram(parseSkills("[Activate: Main] Discard 2 ≪R9 Majin≫ cards from your hand: Draw 1 card.")[0]);
  assert.equal(find(exact?.ops ?? [], "choose")[0]?.sel.minCount, undefined);
  assert.equal(find(exact?.ops ?? [], "choose")[0]?.sel.count, 2);

  def("D9-MAJIN", { energyCost: 1, comboPower: 7000, traits: ["D9 Majin"] });
  def("D9-GAINER", { energyCost: 1, power: 10000, skill: "[Activate: Main][Limit 1] Discard 1 or more ≪D9 Majin≫ cards from your hand: This card gains power equal to the total combo power of the cards discarded by this skill for the turn." });
  const start = () => game("L-RED", { hand: ["D9-MAJIN", "D9-MAJIN", "D9-MAJIN", "V1"], battle: ["D9-GAINER"] });
  const activate = (s: EngineState) => {
    const gainer = findG(s, "p1", "battle", "D9-GAINER");
    const act = actsG(s).find((a) => a.type === "activate" && a.card === gainer);
    assert.ok(act, "the Activate is on the menu");
    return { gainer, s: pay(playG(s, act as Action)) };
  };
  const ask = (s: EngineState) => {
    assert.equal(s.prompt.kind, "chooseCards", `asked at ${s.prompt.kind}`);
    return s.prompt as unknown as { player: PlayerId; choice: { candidates: string[]; min?: number; max?: number; reason: string } };
  };
  const majin = (s: EngineState) => zoneOf(s, "p1", "hand").filter((id) => s.cards[id].cardId === "D9-MAJIN");

  // Three Majin in hand: take two and stop. +14000, the third stays.
  {
    const { gainer, s: s0 } = activate(start());
    let s = s0;
    const was = powerOfG(s, gainer);
    let q = ask(s);
    assert.equal(q.choice.min, 1, "the first one is required");
    assert.equal(q.choice.candidates.length, 3, "only the Majin cards are on offer");
    assert.match(q.choice.reason, /1 or more/);
    s = playG(s, { type: "choose", player: q.player, cards: [q.choice.candidates[0]] } as Action);
    q = ask(s);
    assert.equal(q.choice.min, 0, "after the floor, the player may stop");
    assert.equal(q.choice.candidates.length, 2);
    s = playG(s, { type: "choose", player: q.player, cards: [q.choice.candidates[0]] } as Action);
    q = ask(s);
    assert.equal(q.choice.min, 0);
    s = playG(s, { type: "choose", player: q.player, cards: [] } as Action);
    assert.equal(s.prompt.kind, "main");
    assert.equal(powerOfG(s, gainer), was + 14000, "two cards discarded, both counted");
    assert.equal(majin(s).length, 1, "the third is still in hand");
    assertConsistentG(s);
  }
  // Take all three: the choice ends by itself when the hand has no more.
  {
    const { gainer, s: s0 } = activate(start());
    let s = s0;
    const was = powerOfG(s, gainer);
    for (let i = 0; i < 3; i++) {
      const q = ask(s);
      s = playG(s, { type: "choose", player: q.player, cards: [q.choice.candidates[0]] } as Action);
    }
    assert.equal(s.prompt.kind, "main", "asked three times, not a fourth");
    assert.equal(powerOfG(s, gainer), was + 21000);
    assert.equal(majin(s).length, 0);
  }
  // One is enough.
  {
    const { gainer, s: s0 } = activate(start());
    let s = s0;
    const was = powerOfG(s, gainer);
    let q = ask(s);
    s = playG(s, { type: "choose", player: q.player, cards: [q.choice.candidates[0]] } as Action);
    q = ask(s);
    s = playG(s, { type: "choose", player: q.player, cards: [] } as Action);
    assert.equal(powerOfG(s, gainer), was + 7000);
    assert.equal(majin(s).length, 2);
  }
  // No Majin card in hand: the price cannot be paid, so the skill is not offered.
  {
    const s = game("L-RED", { hand: ["V1", "V1"], battle: ["D9-GAINER"] });
    const gainer = findG(s, "p1", "battle", "D9-GAINER");
    assert.ok(!actsG(s).some((a) => a.type === "activate" && a.card === gainer), "no card to discard, no Activate");
  }
}

// ── "cards under this card" ─────────────────────────────────────────────────
{
  const got = compile("[Activate: Main][Limit 1] If there are 2 cards under this card and you discard 1 or more yellow ≪Majin≫ cards from your hand: This card gains power equal to the total combo power of the cards discarded by this skill for the turn.");
  assert.deepEqual(got.unsupported, []);
  const text = describeScript(got.ops);
  assert.match(text, /2 or more cards under this card/, text);
  assert.doesNotMatch(text, /under your cards/, text);

  // The pile it counts is this card's, not any card of ours.
  def("D9-HOST", { energyCost: 1, power: 10000, skill: "[Activate: Main] If there are 2 cards under this card: This card gains +5000 power for the turn." });
  const mk = () => game("L-RED", { battle: ["D9-HOST", "D9-HOST"] });
  const s = mk();
  const [first, second] = zoneOf(s, "p1", "battle").filter((id) => s.cards[id].cardId === "D9-HOST");
  const buried = zoneOf(s, "p1", "deck").slice(0, 2);
  s.sides.p1.zones.deck = s.sides.p1.zones.deck.filter((id) => !buried.includes(id));
  s.cards[first].under = [...buried];
  const actsOf = (st: EngineState, id: string) => actsG(st).filter((a) => a.type === "activate" && a.card === id);
  assert.equal(actsOf(s, first).length, 1, "two cards under it: the skill may be used");
  assert.equal(actsOf(s, second).length, 0, "two cards under its neighbour are nothing to it");
}

// ── "this card was used in a combo from your deck or hand" ──────────────────
const TURLES = "[Auto] If your Leader Card is a ≪Turles Crusher Corps≫ card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.";
{
  for (const text of [TURLES, TURLES.replace("in Rest Mode ", ""), TURLES.replace("your Leader Card is a ≪Turles Crusher Corps≫ card and ", "")]) {
    const got = compile(text);
    assert.deepEqual(got.unsupported, [], text);
    const [rep] = find(got.ops, "replace");
    assert.equal(rep.event, "leave");
    assert.deepEqual(rep.from, ["combo"], "an answer to the Combo Area's departure, not the Battle Area's");
    assert.ok(rep.optional, "you may");
    const [cond] = find(got.ops, "if").flatMap((i) => (i.cond.kind === "all" ? i.cond.conds : [i.cond]).filter((c) => c.kind === "comboFrom"));
    assert.deepEqual(cond && "areas" in cond ? cond.areas : null, ["deck", "hand"]);
    assert.equal(validateProgram(got.ops), true, "the program is valid language");
    assert.match(describeScript(got.ops), /used in a combo from the Deck or hand|used in a combo from the deck or hand/i);
  }
  // Areas the engine cannot say are refused, not widened.
  assert.ok(compile(TURLES.replace("your deck or hand", "your deck or somewhere")).unsupported.length > 0);

  // In a game.
  const LEADER = "D9-TURLES-L";
  DEFS[LEADER] = { ...DEFS["L-RED"], id: LEADER, name: LEADER, traits: ["Turles Crusher Corps"], type: "LEADER" } as (typeof DEFS)[string];
  def("D9-REP", { energyCost: 1, comboPower: 5000, power: 10000, skill: TURLES });

  const take = (s: EngineState, a: Action): { state: EngineState; events: GameEvent[] } => {
    assert.ok(IMPL.legalActions(CTX, s).some((row) => JSON.stringify(row.action) === JSON.stringify(a)), `expected legal ${JSON.stringify(a)} at ${s.prompt.kind}`);
    return IMPL.apply(CTX, s, a);
  };
  const stage = (s: EngineState, cardId: string, area: "hand" | "battle") => {
    const id = zoneOf(s, "p1", "deck").shift()!;
    s.cards[id].cardId = cardId;
    zoneOf(s, "p1", area).push(id);
    if (area !== "hand") s.cards[id].mode = "active";
    return id;
  };
  /** A battle in which D9-REP is used in a combo from `area`, played through to the end; `answer` is what the owner says to the offer. */
  const battleFrom = (area: "hand" | "battle", answer: "accept" | "decline", leader = true) => {
    let s = arenaG();
    if (leader) s.cards[leaderOf(s, "p1")!].cardId = LEADER;
    const combo = stage(s, "D9-REP", area);
    s = take(s, { type: "attack", player: "p1", attacker: leaderOf(s, "p1")!, target: leaderOf(s, "p2")! }).state;
    s = take(s, { type: "combo", player: "p1", card: combo }).state;
    const origin = (s as VmState).battle?.comboOrigins?.[combo];
    let offered = false;
    for (let i = 0; i < 12 && s.prompt.kind !== "main"; i++) {
      const p = s.prompt;
      const action: Action = p.kind === "combo" ? { type: "pass", player: p.player }
        : p.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: p.player, card: null }
        : p.kind === "replaceMove" ? (offered = true, { type: "chooseMode", player: p.player, index: answer === "accept" ? 0 : (p.options?.length ?? 1) - 1 } as Action)
        : (() => { throw Error(`battle stopped at ${p.kind}`); })();
      s = take(s, action).state;
    }
    assert.equal(s.prompt.kind, "main");
    return { s, combo, origin, offered };
  };

  // Used in a combo from the hand: the area is kept, and the offer is made.
  {
    const r = battleFrom("hand", "accept");
    assert.equal(r.origin, "hand", "the engine keeps the area the combo card came from");
    assert.ok(r.offered, "replaced by an offer");
    assert.ok(zoneOf(r.s, "p1", "battle").includes(r.combo), "played instead of placed in the Drop");
    assert.equal(r.s.cards[r.combo].mode, "rest", "in Rest Mode");
    assert.ok(!zoneOf(r.s, "p1", "drop").includes(r.combo));
    assertConsistentG(r.s);
  }
  // …and "you may": declining puts it in the Drop as usual.
  {
    const r = battleFrom("hand", "decline");
    assert.ok(r.offered);
    assert.ok(zoneOf(r.s, "p1", "drop").includes(r.combo), "declined, so the ordinary departure");
  }
  // Used in a combo from the Battle Area: neither deck nor hand, so no offer.
  {
    const r = battleFrom("battle", "accept");
    assert.equal(r.origin, "battle", "a combo from the Battle Area is recorded as such");
    assert.ok(!r.offered, "no offer");
    assert.ok(zoneOf(r.s, "p1", "drop").includes(r.combo));
  }
  // A Leader that is not a ≪Turles Crusher Corps≫ card: no offer either.
  {
    const r = battleFrom("hand", "accept", false);
    assert.ok(!r.offered, "the Leader condition is part of the standing rule");
    assert.ok(zoneOf(r.s, "p1", "drop").includes(r.combo));
  }
}
// ── what stays unread, and why ─────────────────────────────────────────────
{
  // BT1-015 (`battleEnd` delays run since #1042, "after the battle" is read since the #907 battle-end follow-ups):
  // see battle-end-followups-907.ts. It is no longer unread.
  assert.deepEqual(compile("[auto] When this card attacks a Battle Card, KO that card after the battle. Then, if your opponent's Leader Card has 10000 or less power, inflict 1 damage to your opponent.").unsupported, [], "BT1-015");
  // BT17-139: the Damage Step now stops to ask the owner of an optional replacement of the guard's KO (delayed/replacement
  // batch 1, `koGuard`), so it is read; the VM proof is delayed-replacement-1.ts.
  assert.deepEqual(compile("[Permanent] Once per turn, if this card would be KO'd in battle, you may place 1 card from under this card in its owner's Drop Area instead.").unsupported, [], "BT17-139");
}
console.log("discard-combo-origin-907: ok");

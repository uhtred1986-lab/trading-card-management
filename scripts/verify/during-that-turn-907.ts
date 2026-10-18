/**
 * #907: "during that turn" (the turn the sentence has been talking about) and
 * "ignoring [Barrier]" (22-16-2), and the neighbours the census of unread
 * clauses turned up around them.
 *
 * Catalog text: the deckplanet feed, 18 Oct 2026. Rulings (owner's guidance of
 * 18 Oct 2026: manual, FAQ, errata, neighbours, then a labelled best guess):
 *  - "that turn" is the turn the skill resolves in, i.e. this turn (a skill
 *    resolves inside the turn it names), so it is the duration and the timing
 *    of "this turn" / "the end of the turn" (9-6-2, 1-7-2-1-1).
 *  - "ignoring [Barrier]" lifts 22-16 for the choice it ends, printed with or
 *    without a comma before it.
 *  - "If your opponent activates a [Counter] skill during a battle with this
 *    card," on BT12-041 and BT12-140 is the trigger, printed with "If" (best
 *    guess: BT12-092, the same set and the same sentence, prints "When").
 */
import assert from "node:assert/strict";
import { DEFS, actsG, arenaG, assertConsistentG, autoTriggerMatches, card, compileCostProgram, compileSkill, describeScript, findG, leaderOf, parseFilter, parseSkills, playG, stagedG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId } from "./harness";
import type { ContinuousEffect } from "../../src/lib/arena/types";

const read = (text: string) => compileSkill(parseSkills(text)[0]);
type AnyOp = { op: string; [k: string]: unknown };
const ops = (text: string) => read(text).ops as unknown as AnyOp[];
const flat = (list: AnyOp[]): AnyOp[] =>
  list.flatMap((o) => [o, ...flat([...((o.then as AnyOp[]) ?? []), ...((o.ops as AnyOp[]) ?? []), ...((o.else as AnyOp[]) ?? [])])]);

// ── compile: the printed texts read whole ─────────────────────────────────────
const PRINTED = {
  "BT23-027": "[auto][limit 1] When this card is played, choose up to 1 of your opponent's Battle Cards or Unisons, and during that turn, that card gets -20000 power and this card gains [critical].",
  "BT22-133": "[Auto] When this card is played, this card gains [Critical] for the turn. Additionally, if you have 3 or more energy, you may choose up to 1 of your <Paragus> cards and place it in your Drop. If you do, during that turn, this card can attack a Battle Card in Active Mode.",
  "BT2-036": "[Activate: Main] [Once per turn] If you have 2 or more blue energy, choose 1 card in your life and place it in your Energy Area. At the end of that turn, choose 1of your energy and place it in your Drop Area.",
  "BT6-121": "[Auto] Activate this skill when you play this card from your hand or Warp. At the end of that turn, if it is your turn, choose up to 1 of your energy and switch it to Active Mode.",
  "BT22-054b": "[activate: battle][once per turn] If you discard 1 card from your hand: During that turn, the next time you activate [activate: battle] on a <Son Gohan: Adolescence> or <Son Goten> card―both green and with an energy cost of 6―from your hand, reduce that skill's skill cost by {g}.",
  "BT12-041": "[Auto][Once per turn] If your opponent activates a [Counter] skill during a battle with this card, choose all of your opponent's Battle Cards, ignoring [Barrier], return them to their owners' hands, then switch up to 2 of your mono-blue energy to Active Mode.",
  "BT12-140": "[auto][once per turn] If your opponent activates a [counter] skill during a battle with this card, send 1 card in your opponent's life to their Warp.",
  "EX20-02": "[Auto] If you discard 1 card from your hand: When this card is placed in a Drop Area from your Unison Area, your opponent discards 1 card from their hand.",
  "TB1-009": "[Activate: Main] Send this card to the Warp: At the beginning of your next turn, if your Leader Card is ≪Universe 6≫, play this card from the Warp in its owner's Battle Area.",
};
for (const [id, text] of Object.entries(PRINTED)) assert.deepEqual(read(text).unsupported, [], `${id} reads whole`);

{
  // BT23-027: both halves of "and during that turn, that card gets -20000 power and this card gains [critical]".
  const all = flat(ops(PRINTED["BT23-027"]));
  const power = all.find((o) => o.op === "power");
  assert.equal(power?.amount, -20000);
  assert.equal(power?.until, "turn", "\"that turn\" is the turn");
  assert.equal(all.find((o) => o.op === "grant")?.until, "turn");
  // "During this turn" said with the other pronoun is the same program.
  assert.deepEqual(ops(PRINTED["BT23-027"]), ops(PRINTED["BT23-027"].replace("during that turn", "during this turn")));
}
{
  // BT22-133: the permission was swallowed as the *condition* "this card attacks" and the clause vanished unread.
  const permit = flat(ops(PRINTED["BT22-133"])).find((o) => o.op === "permit");
  assert.equal(permit?.what, "attackActive");
  assert.equal(permit?.until, "turn");
  const gate = ops(PRINTED["BT22-133"]).find((o) => o.op === "if" && (o.then as AnyOp[]).some((t) => t.op === "permit"));
  assert.deepEqual((gate?.cond as { kind: string }).kind, "chose", "\"If you do\" hangs the permission on the Paragus actually placed");
  // And as a [Permanent] (DB3-011, EX03-03, P-063, EX16-06): a permission standing, not "if this card attacks".
  const standing = ops("[Permanent] If your Leader Card is red, this card can attack Battle Cards in Active Mode.");
  assert.equal(flat(standing).find((o) => o.op === "permit")?.what, "attackActive");
}
{
  // BT2-036: "1of" lost its count (the choice read as ALL of the energy), and the timing was unread.
  const o = ops(PRINTED["BT2-036"]);
  const delay = o.find((x) => x.op === "delay");
  assert.deepEqual([delay?.at, delay?.scope], ["turnEnd", "thisTurn"]);
  const choose = flat([delay!]).find((x) => x.op === "choose") as unknown as { sel: { count: number; area: string } };
  assert.deepEqual([choose.sel.count, choose.sel.area], [1, "energy"], "one energy, at the end of the turn");
  assert.equal(describeScript(read(PRINTED["BT2-036"]).ops).includes("choose all"), false);
  // The same typo on the others that print it.
  assert.match(describeScript(read("[+1] [Activate: Main] Choose up to 1of your opponent's Battle Cards and switch it to Rest Mode.").ops), /choose up to 1 Battle Card/);
}
{
  // BT6-121: the condition after the timing phrase is asked when the delay fires, and "Activate this skill when" is a trigger.
  const sk = parseSkills(PRINTED["BT6-121"])[0];
  assert.ok(autoTriggerMatches(sk, "played"), "\"Activate this skill when you play this card\" is the play trigger");
  const o = ops(PRINTED["BT6-121"]);
  assert.equal(o.length, 1);
  assert.equal(o[0].op, "delay", "the energy is switched at the end of the turn, not now");
  assert.equal((o[0].ops as AnyOp[])[0].op, "if");
  assert.deepEqual((o[0].ops as AnyOp[])[0].cond, { kind: "isTurnPlayer" });
  // TB1-009: "At the beginning of your next turn, if …, play this card" used to play it at once.
  const tb = ops(PRINTED["TB1-009"]);
  assert.ok(tb.some((x) => x.op === "delay"), "TB1-009: the play waits for the next turn");
  assert.ok(!tb.some((x) => x.op === "if"), "…and its Leader condition is asked then, inside the delay");
  // A condition before the timing phrase is still asked now.
  const early = ops("[Auto] When this card is played, if your Leader Card is red, at the end of the turn, draw 1 card.");
  assert.equal(early[0].op, "if");
  assert.equal((early[0].then as AnyOp[])[0].op, "delay");
  // Several conditions after it are all asked inside.
  const two = ops("[Auto] When this card is played, at the end of the turn, if it is your turn and you have 3 or more cards in your hand, draw 1 card.");
  const inner = (two[0].ops as AnyOp[])[0];
  assert.equal(inner.op, "if");
}
{
  // BT22-054b: a one-use cut of the skill cost of the cards in the hand.
  const sk = parseSkills(PRINTED["BT22-054b"])[0];
  assert.ok(compileCostProgram(sk), "\"If you discard 1 card from your hand:\" is the discard price");
  const cut = read(PRINTED["BT22-054b"]).ops[0] as unknown as AnyOp & { target: { sel: { area: string; count: number; filter: { colors: string[]; costMin: number } } } };
  assert.deepEqual([cut.op, cut.skillKind, cut.amount, cut.uses, cut.until], ["costReduction", "activate", 1, 1, "turn"]);
  assert.deepEqual([cut.target.sel.area, cut.target.sel.count, cut.target.sel.filter.colors, cut.target.sel.filter.costMin], ["hand", 99, ["Green"], 6]);
  // Not guessed past: two descriptions after a number, and the same words on cards in play.
  assert.ok(read("[activate: main][limit 1] If your leader is a <Bardock: Xeno> card: During that turn, the next time you activate [activate: main] on a <Gogeta: Xeno> card that is mono-black with an energy cost of 10 or multicolor with an energy cost of 8 in your hand, reduce the skill cost by {3}.").unsupported.length > 0, "EX23-45 stays unread");
  assert.ok(read("[activate: main/battle] Place 1 of your Z-Energy in your Drop: During this turn, the next time you activate [activate] on a red <Son Gohan: Future> or <Trunks: Future> card in your Battle Area and/or Combo Area, reduce the skill cost of that skill by {1}.").unsupported.length > 0, "BT23-003 stays unread");
  // Only the discard price: another "If you place …:" price keeps being refused whole.
  assert.ok(read("[Activate: Main] If you place 1 card from your hand in your drop: draw 1 card.").unsupported.length > 0);
}

// ── compile: ignoring [Barrier] ───────────────────────────────────────────────
{
  const chosen = (text: string) => flat(ops(text)).find((o) => o.op === "choose") as unknown as { sel: { ignoreBarrier?: boolean; side: string } };
  assert.equal(chosen("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and KO it.").sel.ignoreBarrier, true, "after a comma");
  assert.equal(chosen("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards ignoring [Barrier] and KO it.").sel.ignoreBarrier, true, "inline, no comma");
  assert.equal(chosen("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and KO it.").sel.ignoreBarrier, undefined, "and absent when not printed");
  assert.equal(chosen(PRINTED["BT12-041"]).sel.ignoreBarrier, true);
  // The reading says it, so a choice that reaches past [Barrier] no longer reads the same as one that does not.
  assert.match(describeScript(read("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and KO it.").ops), /ignoring \[Barrier\]/);
  assert.doesNotMatch(describeScript(read("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and KO it.").ops), /Barrier/);
  // The words must end a choice: "ignoring [Barrier]" after a clause that chooses nothing is refused, not dropped.
  assert.ok(read("[Auto] When this card is played, draw 1 card ignoring [Barrier].").unsupported.length > 0);
  // The BT12-041 trigger: the nine neighbours say "When", these two say "If".
  assert.ok(autoTriggerMatches(parseSkills(PRINTED["BT12-041"])[0], "opponentCounter"));
  assert.ok(autoTriggerMatches(parseSkills(PRINTED["BT12-140"])[0], "opponentCounter"));
  // …and an "If" that is a condition next to a trigger of its own is left alone.
  assert.ok(!autoTriggerMatches(parseSkills("[Auto] If your opponent activates a [Counter] skill: When this card attacks, draw 1 card.")[0], "opponentCounter"));
}
{
  // BT8-122: "non-multicolor" read as "multicolor" — the opposite card.
  const f = parseFilter("all of your opponent's non-multicolor energy");
  assert.deepEqual([f.monoColor, f.multiColor], [true, false]);
  const m = parseFilter("multicolor energy");
  assert.deepEqual([m.monoColor, m.multiColor], [false, true]);
  assert.match(describeScript(read("[Auto] When you play this card from your hand, choose all of your opponent's non-multicolor energy, negate their skills.").ops), /mono-colour/);
}
{
  // A cost compared with the energy count: refused by #1004 (not read as "in the Energy Area" or widened),
  // read since #1011 as a bound on the opponent's Battle Cards (scripts/verify/energy-relations-1011.ts proves it in play).
  for (const text of [
    "[auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy and place it at the bottom of its owner's deck.",
    "[Activate: Main] Choose 1 of your opponent's Battle Cards with an energy cost greater than or equal to your opponent's energy and return it to its owner's hand.",
    "[auto] When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost greater than their energy, ignoring [Barrier], switch it to Rest Mode.",
  ]) {
    const sk = read(text);
    const choose = flat(sk.ops as unknown as AnyOp[]).find((o) => o.op === "choose") as unknown as { sel: { area?: string; side?: string; filter?: { costAboveEnergy?: boolean; costAtLeastEnergy?: boolean; energyOfOpponent?: boolean } } } | undefined;
    assert.ok(sk.unsupported.length === 0 && choose, `read: ${text.slice(0, 60)}`);
    assert.deepEqual([choose.sel.area, choose.sel.side, choose.sel.filter?.energyOfOpponent, !!(choose.sel.filter?.costAboveEnergy || choose.sel.filter?.costAtLeastEnergy)], ["battle", "opponent", true, true], `bound kept: ${text.slice(0, 60)}`);
  }
  // A trigger's subject keeps being the kind of card it was (ground rule 6).
  const bt12132 = read("[Auto][Once per turn] When your opponent plays a Battle Card with an energy cost greater than their current energy using a skill, this card gets +10000 power until the end of your next turn.");
  assert.deepEqual(bt12132.unsupported, []);
}

// ── play: the rules engine ────────────────────────────────────────────────────
const TEMP: string[] = [];
const def = (id: string, o: Partial<(typeof DEFS)[string]>) => {
  DEFS[id] = { ...DEFS.V1, ...o, id, name: id } as (typeof DEFS)[string];
  TEMP.push(id);
};

{
  // 22-16-2: a choice that says "ignoring [Barrier]" is offered the Barrier card; the same choice without it is not.
  const variants: [string, string, boolean][] = [
    ["IGN907-COMMA", "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and KO it.", true],
    ["IGN907-INLINE", "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards ignoring [Barrier] and KO it.", true],
    ["IGN907-PLAIN", "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it.", false],
  ];
  for (const [id, skill] of variants) def(id, { energyCost: 1, skill });
  for (const [id, , offersBarrier] of variants) {
    let s = arenaG({ hand: [id], battle: ["V1"], energy: ["V1"], oppBattle: ["V-BLUE", "WALL"] });
    const wall = findG(s, "p2", "battle", "WALL");
    const plain = findG(s, "p2", "battle", "V-BLUE");
    s = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", id) });
    assert.equal(s.prompt.kind, "chooseCards", id);
    const candidates = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
    assert.ok(candidates.includes(plain), `${id}: the ordinary card is offered`);
    assert.equal(candidates.includes(wall), offersBarrier, `${id}: the [Barrier] card is ${offersBarrier ? "" : "not "}offered`);
    if (offersBarrier) {
      s = playG(s, { type: "choose", player: "p1", cards: [wall] });
      assert.ok(zoneOf(s, "p2", "drop").includes(wall), `${id}: it was KO'd`);
    }
    assertConsistentG(s);
  }
}

{
  // 1-7-2-1-1: "At the end of the turn, if it is your turn, draw 1 card" draws at the end, and only when the condition then holds.
  def("DLY907-OWN", { energyCost: 0, skill: "[Auto] When you play this card, at the end of the turn, if it is your turn, draw 1 card." });
  def("DLY907-OPP", { energyCost: 0, skill: "[Auto] When you play this card, at the end of the turn, if it is your opponent's turn, draw 1 card." });
  def("DLY907-NONE", { energyCost: 0, skill: null });
  const run = (cardId: string) => {
    let g = stagedG({ hand: [cardId], energy: ["V1"] });
    g = playG(g, { type: "play", player: "p1", card: findG(g, "p1", "hand", cardId) });
    const start = zoneOf(g, "p1", "hand").length;
    g = playG(g, { type: "endMain", player: "p1" });
    const own = zoneOf(g, "p1", "hand").length - start;
    g = playG(g, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
    assertConsistentG(g);
    return { start, own };
  };
  const none = run("DLY907-NONE");
  const mine = run("DLY907-OWN");
  const theirs = run("DLY907-OPP");
  assert.equal(mine.own - none.own, 1, "its own turn ends with the card drawn");
  assert.equal(theirs.own - none.own, 0, "the condition is asked at the end of the turn, and it is not the opponent's turn");
}

{
  // BT22-054b's cut, on the board: the first activation from the hand costs {g} less and spends the change.
  def("NT907-GREEN", { colors: ["Green"], energyCost: 0, skill: null });
  def("NT907-EXTRA", { type: "EXTRA", colors: ["Green"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] {g}{g}: Draw 1 card." });
  def("NT907-CUT", { colors: ["Green"], energyCost: 0, skill: "[Auto] When this card is played, during that turn, the next time you activate [activate: main] on a green Extra with an energy cost of 0 from your hand, reduce that skill's skill cost by {g}." });
  assert.deepEqual(read(DEFS["NT907-CUT"].skill!).unsupported, []);
  const act = (s: EngineState, id: string) => actsG(s).find((a) => a.type === "activate" && a.card === id) as Action | undefined;
  const pay = (s: EngineState) => (s.prompt.kind === "payCost" ? playG(s, { type: "payCost", player: "p1", option: 0 } as Action) : s);
  const rested = (s: EngineState, p: PlayerId) => zoneOf(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;
  const inForce = (s: EngineState, id: string) => (s as unknown as { effects: ContinuousEffect[] }).effects.filter((e) => e.kind === "skillCost" && e.target === id);
  const start = () => arenaG({ hand: ["NT907-CUT", "NT907-EXTRA"], energy: ["NT907-GREEN", "NT907-GREEN", "NT907-GREEN", "NT907-GREEN"] });
  {
    // Without the change: the whole {g}{g}.
    let s = start();
    const extra = findG(s, "p1", "hand", "NT907-EXTRA");
    s = pay(playG(s, act(s, extra)!));
    assert.equal(rested(s, "p1"), 2, "the printed price is {g}{g}");
  }
  {
    let s = start();
    const extra = findG(s, "p1", "hand", "NT907-EXTRA");
    s = pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "NT907-CUT") }));
    assert.equal(rested(s, "p1"), 0, "the card costs nothing");
    assert.deepEqual(inForce(s, extra).map((e) => e.uses), [1], "one use, on the card in the hand");
    s = pay(playG(s, act(s, extra)!));
    assert.equal(rested(s, "p1"), 1, "{g}{g} less {g}");
    assert.deepEqual(inForce(s, extra), [], "spent");
    assertConsistentG(s);
  }
  {
    // Unused, it ends with the turn.
    let s = start();
    const extra = findG(s, "p1", "hand", "NT907-EXTRA");
    s = pay(playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "NT907-CUT") }));
    assert.equal(inForce(s, extra).length, 1);
    s = playG(s, { type: "endMain", player: "p1" });
    assert.notEqual(s.turnPlayer, "p1");
    assert.deepEqual(inForce(s, extra), [], "bounded by the turn");
  }
  void leaderOf;
}

for (const id of TEMP) delete DEFS[id];
console.log("during-that-turn-907 ok");
// `card` is imported for the type of fixtures defined by neighbouring suites.
void card;

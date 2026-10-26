/**
 * #1005: the [Permanent]s that say "your opponent's Battle Cards can't attack
 * Leaders" — and their siblings — used to read as an EMPTY program with no
 * unread clause, so they played as blank. This proves, on the printed wordings:
 *
 * 1. the compiler reads each one (or says it cannot), never silently nothing;
 * 2. the VM's legal-attack list loses exactly the attacks the card names,
 *    and gets them back when the card's condition stops holding;
 * 3. the two pronouns the reading exposed — BT19-035b's "the card this card
 *    attacked" and BT24-130's "it" after a choice — land on the right card.
 *
 * Rulings (owner's guidance of 18 Oct 2026: rule manual, official FAQ, errata,
 * then similar cards, then a labelled best guess):
 * - Manual 8-1-1 lists what an attack may be declared against (a Leader, a
 *   Unison, a rested Battle Card); 20-14 makes "can't" beat the instruction
 *   that would let it. A ban on *attacking a kind of card* removes only the
 *   declarations against that kind — the same attacker keeps its others. That
 *   is how BT1-057's "cannot attack Battle Cards" already played (#937).
 * - "Battle Cards and Unisons can't attack your Leader" (BT24-090) names two
 *   kinds of attacker, so a Leader Card is not bound: manual 3-3 gives a Unison
 *   Card its own type, and the printed card does not list Leaders.
 * - "Players can't attack with Battle Cards with energy costs of 1" (P-074)
 *   binds both players — LABELLED BEST GUESS for the plural subject; the card
 *   has no FAQ entry.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import { compileSkill } from "../../src/lib/arena/compile";
import { readsAsNothingSilently } from "../../src/lib/arena/compile/silent";
import { parseConditionClause } from "../../src/lib/arena/compile/conditions";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const R = (id: string, skill: string) => card(id, { energyCost: 2, skill });
const defs = {
  ...DEFS,
  // The wordings, copied from the printed cards.
  BT21_077: R("BT21_077", "[Permanent] If this card is in Rest Mode, your opponent's Battle Cards can't attack Leaders."),
  BT18_115: R("BT18_115", "[Permanent] While this card is in Rest Mode, your opponent's Battle Cards can't attack your Leader."),
  BT24_090: R("BT24_090", "[Permanent] If this card is in Rest Mode, your opponent's Battle Cards and Unisons can't attack your Leader."),
  BT12_076: R("BT12_076", "[Permanent] While this card is in Rest Mode, your opponent can't attack Leader Cards or Unison Cards."),
  BT18_098: R("BT18_098", "[Permanent] If this card is in Rest Mode, your opponent can't attack your Leader with Battle Cards."),
  BT17_012: R("BT17_012", "[Permanent] While this card is in Rest Mode, your opponent can't attack your Unison Cards."),
  // (DB2-068 prints green; the staged Leader here is blue.)
  DB2_068: R("DB2_068", "[Permanent] If your Leader Card is blue and this card is in Rest Mode, your opponent can only attack this card."),
  TB1_035: R("TB1_035", "[Permanent] If this card is in Rest Mode, your opponent's Battle Cards can only attack this card."),
  P_074: R("P_074", "[Permanent] Players can't attack with Battle Cards with energy costs of 1."),
  BT19_035b: card("BT19_035b", { energyCost: 2, power: 10000, skill: "[Auto] When this card attacks a Battle Card with an energy cost of 8 or more, the card this card attacked can't attack during your opponent's next turn, and negate this skill for the game." }),
  EIGHT: card("EIGHT", { energyCost: 8, power: 10000 }),
  TWO: card("TWO", { energyCost: 2, power: 10000 }),
};

const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(rows, defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const leader = (s: VmState, p: PlayerId) => s.sides[p].zones.leader[0];
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, JSON.parse(JSON.stringify(s)), action).state as VmState;

function fresh(): VmState {
  let s = RULES.createGame(ctx, { seed: 1005, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: "battle" | "unison", mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); s.cards[id].mode = mode; return id;
}
/** attacker → the targets it may declare against, for player `p`. */
function menu(s: VmState, p: PlayerId): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of RULES.legalActions(ctx, s)) {
    const a = l.action;
    if (a.type !== "attack" || a.player !== p) continue;
    if (!out.has(a.attacker)) out.set(a.attacker, new Set());
    out.get(a.attacker)!.add(a.target);
  }
  return out;
}

// ── 1. compiler: every wording reads, or says it cannot ───────────────────
const reading = (text: string) => {
  const [sk] = parseSkills(text);
  const script = compileSkill(sk);
  return { sk, script, rec: skillRecords(card("X", { skill: text }))[0] };
};
const family: [string, string][] = [
  ["[permanent] If this card is in Rest Mode, your opponent's Battle Cards can't attack Leaders.", "if this card is in rest mode: all Battle Cards in your opponent's Battle Area can't attack leader card"],
  ["[Permanent] While this card is in Rest Mode, your opponent's Battle Cards can't attack your Leader.", "if this card is in rest mode: all Battle Cards in your opponent's Battle Area can't attack leader card"],
  ["[permanent] If this card is in Rest Mode, your opponent's Battle Cards and Unisons can't attack your Leader.", "if this card is in rest mode: all cards in your opponent's Battle Area or Unison Area can't attack leader card"],
  ["[Permanent] While this card is in Rest Mode, your opponent can't attack Leader Cards or Unison Cards.", "if this card is in rest mode: your opponent can't attack non-battle card"],
  ["[permanent] If this card is in Rest Mode, your opponent can't attack your Leader with Battle Cards.", "if this card is in rest mode: your opponent can't attack leader card with battle card"],
  ["[permanent] If this card is in Rest Mode, your opponent can't attack your Unisons with specified costs of 2.", "if this card is in rest mode: your opponent can't attack unison card with a specified cost of 2"],
  ["[Permanent] Your opponent can't attack your Z-Unisons.", "your opponent can't attack Z-card unison card"],
  ["[permanent] Your opponent can't attack {Krillin, Concerned for a God} card in a Unison Area.", "your opponent can't attack {krillin, concerned for a god} unison card"],
  ["[Permanent] Players can't attack with Battle Cards with energy costs of 1.", "each player can't attack with battle card with an energy cost of 1"],
  ["[Permanent] During your opponent's turn, if your Leader Card is red and this card is in Rest Mode, your opponent's cards can't attack Leader Cards, and this card gets -5000 power.", "if it is your opponent's turn: if your leader is Red: if this card is in rest mode: all cards your opponent has in play can't attack leader card, this card -5000 power"],
  ["[Permanent] If your Leader Card is green and this card is in Rest Mode, your opponent can only attack this card.", "if your leader is Green: if this card is in rest mode: your opponent can only attack this card"],
  ["[Permanent] If this card is in Rest Mode, your opponent's Battle Cards can only attack this card.", "if this card is in rest mode: all Battle Cards in your opponent's Battle Area can only attack this card"],
  ["[Permanent] This card can't attack if it has 3 or fewer markers on it.", "if this card has 3 or fewer markers: this card can't attack"],
  ["[Activate: Battle] Your opponent's Battle Cards and Unisons can't attack for the turn if they have 25000 power or more.", "all cards with 25000 power or more in your opponent's Battle Area or Unison Area can't attack for the turn"],
];
for (const [text, says] of family) {
  const { sk, script, rec } = reading(text);
  assert.deepEqual(script.unsupported, [], `reads whole: ${text}`);
  assert.ok(script.ops.length, `is not an empty program: ${text}`);
  assert.ok(!readsAsNothingSilently(sk, script));
  assert.equal(rec.reads, says, text);
}
// What cannot be said is reported, not dropped. These are all "unread" (and so
// counted by the tally and the rule review), none is silent. ("Your opponent
// cannot attack your other Battle Cards" and "…skill-less cards can't attack
// this card" are read since the prohibition catalog: `prohibition-catalog.ts`.)
for (const text of [
  "[permanent] When this card is in Rest Mode, your opponent's cards with 15000 power or more can only attack copies of this card.", // P-230: a name resolved per defender
  "[permanent] When this card is in Rest Mode, your opponent's Battle Cards with energy costs greater than or equal to their current energy can't attack Leader Cards.", // P-299: a measure the filter cannot say
  "[Permanent] While this card is in Rest Mode, your opponent can't attack your Leader Card unless they choose 2 cards in their hand and discard them each time.", // a price on a defender-qualified attack
  "[Permanent] This card can't attack if you have 3 or less energy and the moon is up.",
]) {
  const { sk, script } = reading(text);
  assert.ok(script.unsupported.length, `unread, and says so: ${text}`);
  assert.ok(!readsAsNothingSilently(sk, script));
}
// The check itself: an empty program with nothing unread is flagged, a
// keyword (the engine's own), a reminder and a deck rule are not.
{
  const [sk] = parseSkills("[Permanent] If this card is in Rest Mode, your opponent's Battle Cards can't attack Leaders.");
  assert.ok(readsAsNothingSilently(sk, { ops: [], unsupported: [] }), "the #1005 failure, as it was");
  assert.ok(!readsAsNothingSilently(sk, { ops: [], unsupported: ["a clause"] }));
  const [blocker] = parseSkills("[Blocker] (When one of your other cards is attacked, you may switch this card to Rest Mode and change the target of the attack to this card)");
  assert.ok(!readsAsNothingSilently(blocker, compileSkill(blocker)));
  const [deck] = parseSkills("[Permanent] You can include as many copies of this card in your deck as you like.");
  assert.ok(!readsAsNothingSilently(deck, compileSkill(deck)));
}
// The condition reader no longer takes a prohibition for a moment: with a
// modal in front of "attack" it is not "if your opponent's Battle Cards attack".
assert.equal(reading("[Permanent] If your Leader Card is red, your opponent's Battle Cards can't attack Leaders.").script.ops.length, 1);
assert.ok(parseConditionClause("when your opponent's battle cards attack your leader", true), "the moment 'attack' is still a condition");
assert.equal(parseConditionClause("your opponent's battle cards can't attack leaders", true), null, "…and 'can't attack' is not");
assert.equal(parseConditionClause("your opponent's battle cards can only attack this card", true), null);

// ── 2. VM: the legal-attack list, restriction on and off ──────────────────
const BOARD = (restrictor: string, mode: "active" | "rest") => {
  const s = fresh();
  s.cards[leader(s, "p2")].mode = "active";
  const guard = stage(s, "p2", restrictor, "battle", mode);        // p2's card carrying the permanent
  const resting = stage(s, "p2", "TWO", "battle", "rest");           // something that may always be hit
  const unison = stage(s, "p2", "U1", "unison", "rest");
  const attacker = stage(s, "p1", "TWO", "battle", "active");        // p1's Battle Card
  const myUnison = stage(s, "p1", "U1", "unison", "active");         // p1's Unison Card
  return { s, guard, resting, unison, attacker, myUnison, p1leader: leader(s, "p1"), p2leader: leader(s, "p2") };
};
{
  // "Your opponent's Battle Cards can't attack Leaders" (BT21-077, BT18-115): on
  // while the card rests, off when it is active; only Battle Cards are bound.
  for (const id of ["BT21_077", "BT18_115"]) {
    const on = BOARD(id, "rest"), off = BOARD(id, "active");
    const m = menu(on.s, "p1");
    assert.ok(m.get(on.attacker)?.has(on.resting), `${id}: a Battle Card may still hit a rested Battle Card`);
    assert.ok(!m.get(on.attacker)?.has(on.p2leader), `${id}: a Battle Card may not hit the Leader`);
    assert.ok(m.get(on.p1leader)?.has(on.p2leader), `${id}: the Leader is not a Battle Card, and may attack the Leader`);
    assert.ok(menu(off.s, "p1").get(off.attacker)?.has(off.p2leader), `${id}: with the card active the restriction is off`);
    // …and refused when forced, not just unlisted:
    assert.throws(() => take(on.s, { type: "attack", player: "p1", attacker: on.attacker, target: on.p2leader }));
    assert.equal(take(on.s, { type: "attack", player: "p1", attacker: on.attacker, target: on.resting }).battle?.guard, on.resting);
    // Blocker redirection is not a declaration (FAQ): the rule is read only when attacking.
    assert.ok(forbiddenBy(ctx, game, on.s, "attack", { player: "p1", card: on.attacker, attackTarget: on.p2leader }));
    assert.ok(!forbiddenBy(ctx, game, on.s, "attack", { player: "p1", card: on.attacker, attackTarget: on.resting }));
  }
  // The restriction binds the *opponent* of the card's controller, not its own controller.
  {
    const b = BOARD("BT21_077", "rest");
    const mine = stage(b.s, "p2", "TWO", "battle", "active");
    b.s.turnPlayer = "p2";
    b.s.prompt = { ...b.s.prompt, player: "p2" } as typeof b.s.prompt;
    assert.ok(!forbiddenBy(ctx, game, b.s, "attack", { player: "p2", card: mine, attackTarget: b.p1leader }), "its own controller's Battle Cards are not bound");
  }
  // "Battle Cards and Unisons can't attack your Leader" (BT24-090): both bound, Leader not.
  {
    const b = BOARD("BT24_090", "rest"), m = menu(b.s, "p1");
    assert.ok(!m.get(b.attacker)?.has(b.p2leader));
    assert.ok(!m.get(b.myUnison)?.has(b.p2leader), "a Unison Card is bound");
    assert.ok(m.get(b.myUnison)?.has(b.resting), "…and keeps its other targets");
    assert.ok(m.get(b.p1leader)?.has(b.p2leader), "a Leader Card is not named");
  }
  // "Your opponent can't attack Leader Cards or Unison Cards" (BT12-076): every
  // attacker, but only those two kinds of defender.
  {
    const b = BOARD("BT12_076", "rest"), m = menu(b.s, "p1");
    for (const a of [b.attacker, b.myUnison, b.p1leader]) {
      assert.ok(m.get(a)?.has(b.resting), "a rested Battle Card is still a target");
      assert.ok(!m.get(a)?.has(b.p2leader) && !m.get(a)?.has(b.unison), "Leader and Unison are not");
    }
    const off = menu(BOARD("BT12_076", "active").s, "p1");
    assert.ok([...off.values()].some((t) => t.size > 1), "off when the card is active");
  }
  // "…can't attack your Leader with Battle Cards" (BT18-098): attackers and defender together.
  {
    const b = BOARD("BT18_098", "rest"), m = menu(b.s, "p1");
    assert.ok(!m.get(b.attacker)?.has(b.p2leader), "a Battle Card may not hit the Leader");
    assert.ok(m.get(b.myUnison)?.has(b.p2leader) && m.get(b.p1leader)?.has(b.p2leader), "others may");
    assert.ok(m.get(b.attacker)?.has(b.unison), "and the Battle Card keeps its Unison target");
  }
  // "…can't attack your Unison Cards" (BT17-012) leaves everything else.
  {
    const b = BOARD("BT17_012", "rest"), m = menu(b.s, "p1");
    assert.ok(!m.get(b.attacker)?.has(b.unison) && m.get(b.attacker)?.has(b.p2leader) && m.get(b.attacker)?.has(b.resting));
  }
  // "…can only attack this card" (DB2-068 for the player, TB1-035 for their
  // Battle Cards): every declaration but the one against the card is refused.
  // A Blocker redirecting it afterwards is not a declaration (official FAQ).
  for (const [id, bound] of [["DB2_068", ["p1leader", "attacker", "myUnison"]], ["TB1_035", ["attacker"]]] as const) {
    const on = BOARD(id, "rest"), m = menu(on.s, "p1");
    for (const who of bound) {
      const a = on[who];
      assert.deepEqual([...(m.get(a) ?? [])], [on.guard], `${id}: ${who} may attack only the card`);
    }
    if (id === "TB1_035") assert.ok(m.get(on.p1leader)!.size > 1 && m.get(on.myUnison)!.size > 1, "TB1-035 names Battle Cards: a Leader and a Unison are free");
    const off = menu(BOARD(id, "active").s, "p1");
    assert.ok(off.get(on.attacker)!.size > 1, `${id}: with the card active nothing is held to it`);
    assert.equal(take(on.s, { type: "attack", player: "p1", attacker: on.attacker, target: on.guard }).battle?.guard, on.guard);
    assert.throws(() => take(on.s, { type: "attack", player: "p1", attacker: on.attacker, target: on.resting }));
  }
  // "Players can't attack with Battle Cards with energy costs of 1" (P-074): both players.
  {
    const s = fresh();
    stage(s, "p2", "P_074", "battle", "rest");
    stage(s, "p2", "TWO", "battle", "rest");
    const one = stage(s, "p1", "V1", "battle", "active");            // energy cost 1
    const two = stage(s, "p1", "TWO", "battle", "active");           // energy cost 2
    const m = menu(s, "p1");
    assert.ok(!m.has(one), "an energy-1 Battle Card cannot attack at all");
    assert.ok(m.get(two)?.size, "an energy-2 Battle Card can");
    assert.ok(m.get(leader(s, "p1"))?.size, "a Leader can");
    const theirs = stage(s, "p2", "V1", "battle", "active");
    assert.ok(forbiddenBy(ctx, game, s, "attack", { player: "p2", card: theirs, attackTarget: leader(s, "p1") }), "and the restriction binds its own controller too");
  }
}

// ── 3. pronouns ───────────────────────────────────────────────────────────
{
  // BT19-035b: "the card this card attacked" is the card attacked, not this card.
  const { script } = reading(defs.BT19_035b.skill!);
  const json = JSON.stringify(script.ops);
  assert.match(json, /"op":"forbid"/);
  assert.match(json, /"target":\{"sel":\{"special":"guard"\}\}/, "the ban lands on the guard card");
  assert.ok(!/"target":\{"sel":\{"special":"self"\}\}/.test(json), "…and not on this card");
  assert.match(json, /"costMin":8/, "only when the card attacked costs 8 or more");
  assert.match(json, /"until":"nextTurn"/, "for the opponent's next turn, bound now rather than looked up then");
  assert.match(json, /"op":"negateOwnSkill"/);
  // …and played: attack a cost-8 card, then a cost-2 card.
  for (const [victimDef, banned] of [["EIGHT", true], ["TWO", false]] as const) {
    const s = fresh();
    const a = stage(s, "p1", "BT19_035b", "battle", "active");
    const victim = stage(s, "p2", victimDef, "battle", "rest");
    let r = take(s, { type: "attack", player: "p1", attacker: a, target: victim });
    for (let n = 0; n < 12 && !["blocker", "counter"].includes(r.prompt.kind); n++) {
      const q = r.prompt;
      if (q.kind === "chooseCards") r = take(r, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, q.choice.min) });
      else if (q.kind === "orderPending") r = take(r, { type: "orderPending", player: q.player, index: 0 });
      else break;
    }
    assert.equal(!!forbiddenBy(ctx, game, r, "attack", { player: "p2", card: victim, attackTarget: leader(r, "p1") }), banned, `${victimDef}: the card attacked ${banned ? "may not" : "may"} attack`);
    assert.ok(!forbiddenBy(ctx, game, r, "attack", { player: "p1", card: a, attackTarget: victim }), `${victimDef}: this card is never the one banned`);
  }
  // BT24-130: "choose up to 1 of your opponent's Leaders or Battle Cards—both
  // in Rest Mode—and it can't attack": "it" is the choice.
  const bt24 = reading("[auto] When this card is played, if you have 2 or more red cards in your energy, choose up to 1 of your opponent's Leaders or Battle Cards—both in Rest Mode—and it can't attack until the end of your opponent's turn.").script;
  assert.deepEqual(bt24.unsupported, []);
  const cond = bt24.ops[0]; assert.equal(cond.op, "if");
  if (cond.op === "if") {
    const [pick, ban] = cond.then;
    assert.equal(pick.op, "choose");
    assert.equal(ban.op, "forbid");
    if (pick.op === "choose" && ban.op === "forbid") {
      assert.deepEqual(ban.target, { var: pick.as }, "the ban is on what was chosen");
      assert.deepEqual(pick.sel.areas, ["leader", "battle"], "a Leader can be chosen");
      assert.equal(pick.sel.side, "opponent");
      assert.equal(pick.sel.mode, "rest");
      assert.equal(pick.sel.upTo, true);
      assert.equal(ban.until, "nextTurn");
    }
  }
}
console.log("#1005 attack-restriction permanents: readings, legal-attack lists on/off, silent-empty check and both pronouns passed");

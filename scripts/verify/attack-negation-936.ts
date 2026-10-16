/**
 * #936: "When you play this card from your hand, if there are 9 or more
 * ≪Universe 7≫ in your Drop Area, for the duration of the turn, this card gains
 * +10000 power and [Triple Strike], and its attacks can't be negated" (EX03-14)
 * — printed text -> compile -> stored-row JSON round-trip -> the real VM.
 *
 * Two shared mechanics, neither named for a card:
 * - `playedFromHand`: "when this card is played from your hand" answers the
 *   play's captured origin (a normal play, or a skill that plays from the
 *   hand) and not a play from the Drop, Warp or deck;
 * - `permit attackUnnegatable`: a timed or [Permanent] "its attacks can't be
 *   negated", which makes `negateAttack` fail (so "if you negated" reports
 *   failure) while the rest of the negating effect resolves. An attack ban and
 *   removing the attacker are not negation and still work.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, hasKeyword, permissions } from "../../src/lib/arena/vm/program";
import { validateProgram } from "../../src/lib/arena/vm/script";
import { describeScript } from "../../src/lib/arena/vm/script";
import { describeTrigger } from "../../src/lib/arena/gaps";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

/** EX03-14 as printed (public catalog text, issue #936). */
const GOKU = "[Auto] When you play this card from your hand, if there are 9 or more ≪Universe 7≫ in your Drop Area, for the duration of the turn, this card gains +10000 power and [Triple Strike], and its attacks can't be negated.";
/** TB1-095's relevant line: it counts as ≪Universe 7≫ in every area. */
const ALL_AREAS = "[Permanent] This card gains ≪Universe 7≫ in all areas.";
const PLAYERS = {
  PLAYHAND936: "[Activate: Main] Play up to 1 <Last One Standing> card from your hand.",
  PLAYDROP936: "[Activate: Main] Play up to 1 <Last One Standing> card from your Drop.",
  PLAYWARP936: "[Activate: Main] Play up to 1 <Last One Standing> card from your Warp.",
  PLAYDECK936: "[Activate: Main] Play up to 1 <Last One Standing> card from your deck, then shuffle your deck.",
};
const defs: Record<string, CardDef> = { ...DEFS,
  GOKU936: card("GOKU936", { name: "Last One Standing Son Goku", energyCost: 0, power: 20000, characters: ["Last One Standing"], traits: ["Universe 7"], skill: GOKU }),
  // The same play, with the older wording, as the control: it answers every origin.
  CTRL936: card("CTRL936", { energyCost: 0, power: 20000, characters: ["Last One Standing"], skill: "[Auto] When this card is played, draw 1 card." }),
  U7936: card("U7936", { energyCost: 1, power: 5000, traits: ["Universe 7"] }),
  ALLU7936: card("ALLU7936", { energyCost: 1, power: 5000, skill: ALL_AREAS }),
  FOE936: card("FOE936", { colors: ["Blue"], power: 5000 }),
  // A [Counter: Attack] that negates and does more: before, and keyed on the negation.
  NEG936: card("NEG936", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Draw 1 card, and negate the attack. If you negated the attack with this skill, draw 2 cards." }),
  // …and one that removes the attacker first, then negates.
  REMOVE936: card("REMOVE936", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area. Negate the attack." }),
  PERM936: card("PERM936", { energyCost: 0, power: 20000, skill: "[Permanent] This card's attack cannot be negated." }),
  // A standing ban on attacking, said as a skill's timed effect.
  BAN936: card("BAN936", { energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it can't attack for the turn." }),
  ...Object.fromEntries(Object.entries(PLAYERS).map(([id, skill]) => [id, card(id, { energyCost: 0, power: 10000, skill })])),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const stored = roundtrip(rows);
assert.equal(JSON.stringify(stored), JSON.stringify(rows), "the drafted rows are plain JSON: a round trip changes nothing");
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(stored, defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
const gokuRow = skillRecords(defs.GOKU936).find((r) => r.kind === "auto")!;
assert.deepEqual(gokuRow.trigger, ["playedFromHand"], "the hand qualifier is the trigger, not an ordinary play");
assert.deepEqual(gokuRow.unread, [], "the whole Auto reads, attack protection included");
assert.deepEqual(gokuRow.ops.map((o) => o.op), ["power", "grant", "permit"]);
assert.deepEqual(gokuRow.ops[0], { op: "power", target: { sel: { special: "self" } }, amount: 10000, until: "turn" });
assert.deepEqual(gokuRow.ops[1], { op: "grant", target: { sel: { special: "self" } }, keyword: { name: "Strike", x: 3 }, until: "turn" });
assert.deepEqual(gokuRow.ops[2], { op: "permit", what: "attackUnnegatable", target: { sel: { special: "self" } }, until: "turn" });
{
  const c = gokuRow.cond as { kind: string; sel: { side: string; area: string; filter: { traits: string[] } }; atLeast: number };
  assert.equal(c.kind, "count"); assert.equal(c.atLeast, 9); assert.equal(c.sel.area, "drop"); assert.deepEqual(c.sel.filter.traits, ["universe 7"]);
}
assert.ok(validateProgram(gokuRow.ops), "the language accepts the new permission");
assert.ok(describeScript(gokuRow.ops).includes("attacks can't be negated"), describeScript(gokuRow.ops));
assert.equal(describeTrigger(["playedFromHand"]), "when this card is played from your hand");
assert.equal(validateProgram([{ op: "permit", what: "attackActive", target: { sel: { special: "self" } }, until: "turn" }]), true, "an older program stays valid");
assert.equal(validateProgram([{ op: "permit", what: "nonsense", target: { sel: { special: "self" } }, until: "turn" }] as never), false, "and an unknown permission still is not");

// The hand qualifier on its own, and what it must not swallow.
const triggersOf = (skill: string) => skillRecords(card("T936", { skill })).find((r) => r.kind === "auto")!.trigger;
assert.deepEqual(triggersOf("[Auto] When this card is played from your hand, draw 1 card."), ["playedFromHand"]);
assert.deepEqual(triggersOf("[Auto] When you play this card from your hand, draw 1 card."), ["playedFromHand"]);
assert.deepEqual(triggersOf("[Auto] When this card is played, draw 1 card."), ["played"], "a plain play is any origin");
assert.deepEqual(triggersOf("[Auto] When you play this card using [Over Realm], draw 1 card."), ["playedUsingOverRealm"]);
assert.deepEqual(triggersOf("[Auto] When this card is played from your deck or hand, draw 1 card."), ["played"], "a wider origin list stays a plain play, as before");

// The wording inventory (docs/arena-backlog/936.md): each reads as an unnegatable permit, timed or standing.
const permitOf = (skill: string) => {
  const rec = skillRecords(card("W936", { skill }))[0];
  assert.deepEqual(rec.unread, [], skill);
  return rec;
};
{
  const standing = permitOf("[Permanent] This card's attack cannot be negated.");
  assert.deepEqual(standing.ops, [{ op: "permit", what: "attackUnnegatable", target: { sel: { special: "self" } }, until: "game" }], "P-080: a [Permanent] holds for the game");
  const pair = permitOf("[permanent] This card's attack and skill cannot be negated.");
  assert.deepEqual(pair.ops.map((o) => o.op), ["permit", "forbid"], "BT1-043, TB1-097: the attack's rule and 9-1-5's");
  const conditional = permitOf("[Permanent] When your opponent has 4 or more Battle Cards in play, this card's attack can't be negated.");
  assert.equal((conditional.cond as { kind: string }).kind, "count"); assert.equal(conditional.ops[0].op, "permit");
  const chosen = permitOf("[Activate: Main][Limit 1] Choose up to 1 of your multicolor <Son Goku: GT> cards, it gets +10000 power for the turn, and that card's attack can't be negated for the turn.");
  const chosenPermit = chosen.ops.find((o) => o.op === "permit");
  assert.deepEqual(chosenPermit, { op: "permit", what: "attackUnnegatable", target: { var: "c0" }, until: "turn" }, "BT25-126: the chosen card, for the turn");
}

// ── the VM ───────────────────────────────────────────────────────────────────
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const r = RULES.apply(ctx, roundtrip(s), action);
  events = events.concat(r.events as GameEvent[]);
  return r.state as VmState;
}
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 936, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); if (area === "battle") s.cards[id].mode = mode; return id;
}
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power;
const protectedNow = (s: VmState, id: string) => permissions(ctx, game, s, "attackUnnegatable").some((p) => p.target === id);
const strike3 = (s: VmState, id: string) => hasKeyword(ctx, game, s, id, "Strike") && s.effects.some((e) => e.kind === "keyword" && e.target === id && (e.value as { name: string; x?: number }).name === "Strike" && (e.value as { x?: number }).x === 3);
const zoneOf = (s: VmState, p: PlayerId, zone: string) => s.sides[p].zones[zone];
const had = (type: string) => events.some((e) => e.type === type);

/** Answer prompts until `main`: pick `want` when asked, take the minimum otherwise, order Autos first-first. */
function settle(s: VmState, want: string | null = null): VmState {
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: want && q.choice.candidates.includes(want) ? [want] : q.choice.candidates.slice(0, q.choice.min) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main");
  return s;
}
const playAction = (s: VmState, card: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === card)?.action;
const activateAction = (s: VmState, card: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === card)?.action;
const dropOf = (s: VmState, p: PlayerId, n: number, withAllAreas = false) => {
  for (let i = 0; i < n; i++) stage(s, p, "U7936", "drop");
  if (withAllAreas) stage(s, p, "ALLU7936", "drop");
};

/** Run a battle to its end; the defender answers the first [Counter] window with `counter`, then passes. */
function fight(s: VmState, seat: PlayerId, attacker: string, target: string, counter: string | null): VmState {
  const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === attacker && l.action.target === target);
  assert.ok(atk, "the attack is offered");
  s = take(s, atk.action);
  let used = false;
  for (let i = 0; i < 40 && (s.battle || s.prompt.kind !== "main"); i++) {
    const q = s.prompt;
    if (q.kind === "counter") {
      const pick = !used && counter && q.player === other(seat) && q.candidates.includes(counter) ? counter : null;
      if (pick) used = true;
      s = take(s, { type: "counter", player: q.player, card: pick });
    } else if (q.kind === "blocker") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(counter === null || used, true, "the Counter was used");
  return s;
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // 1. A normal hand play with nine qualifying cards (TB1-095's trait counts in the Drop).
  for (const [label, plain, allAreas] of [["nine", 9, false], ["eight plus the all-area card", 8, true]] as const) {
    const s = fresh(seat);
    dropOf(s, seat, plain, allAreas);
    const goku = stage(s, seat, "GOKU936", "hand");
    const play = playAction(s, goku); assert.ok(play, "playable");
    const r = settle(take(s, play), null);
    assert.equal(power(r, goku), 30000, `${seat}/${label}: +10000 power`);
    assert.ok(strike3(r, goku), `${seat}/${label}: [Triple Strike]`);
    assert.ok(protectedNow(r, goku), `${seat}/${label}: its attacks can't be negated`);
    // The same state reloaded still has all three.
    const again = roundtrip(r);
    assert.equal(power(again, goku), 30000); assert.ok(protectedNow(again, goku)); assert.ok(strike3(again, goku));
  }
  // 2. Eight does not.
  for (const label of ["eight", "eight and the all-area card elsewhere"]) {
    const s = fresh(seat);
    dropOf(s, seat, 8);
    if (label !== "eight") stage(s, seat, "ALLU7936", "warp"); // in all areas, but not in the Drop
    const goku = stage(s, seat, "GOKU936", "hand");
    const r = settle(take(s, playAction(s, goku)!), null);
    assert.equal(power(r, goku), 20000, `${seat}/${label}: no bonus`);
    assert.ok(!strike3(r, goku)); assert.ok(!protectedNow(r, goku), `${seat}/${label}: not protected`);
  }
  // 3. The origin is the play's own: a skill that plays from the hand counts; Drop, Warp and deck do not.
  for (const [player, area, triggers] of [["PLAYHAND936", "hand", true], ["PLAYDROP936", "drop", false], ["PLAYWARP936", "warp", false], ["PLAYDECK936", "deck", false]] as const) {
    for (const name of ["GOKU936", "CTRL936"] as const) {
      const s = fresh(seat);
      dropOf(s, seat, 9);
      const subject = stage(s, seat, name, area), source = stage(s, seat, player, "battle");
      const hand = zoneOf(s, seat, "hand").length;
      const act = activateAction(s, source); assert.ok(act, `${player}: activatable`);
      const r = settle(take(s, act), subject);
      assert.ok(zoneOf(r, seat, "battle").includes(subject), `${seat}/${player}/${name}: the play happened`);
      if (name === "CTRL936") assert.equal(zoneOf(r, seat, "hand").length, hand + (area === "hand" ? 0 : 1), `${seat}/${player}: a plain "when played" answers any origin`);
      else {
        assert.equal(power(r, subject) === 30000, triggers, `${seat}/${player}: +10000 only when played from the hand`);
        assert.equal(protectedNow(r, subject), triggers, `${seat}/${player}: protection only when played from the hand`);
        assert.equal(strike3(r, subject), triggers);
      }
    }
  }
  // 4. A Counter that negates: the protected attack stays, the rest of the Counter resolves, "if you negated" fails.
  for (const mode of ["nine", "eight"] as const) {
    const s = fresh(seat);
    dropOf(s, seat, mode === "nine" ? 9 : 8);
    const goku = stage(s, seat, "GOKU936", "hand");
    const counter = stage(s, foe, "NEG936", "hand");
    let r = settle(take(s, playAction(s, goku)!), null);
    const life = zoneOf(r, foe, "life").length, deck = zoneOf(r, foe, "deck").length;
    events = [];
    r = fight(r, seat, goku, r.sides[foe].zones.leader[0], counter);
    assert.equal(deck - zoneOf(r, foe, "deck").length, mode === "nine" ? 1 : 3, `${seat}/${mode}: the Counter's own draw happens; the "if you negated" draw only if it did`);
    if (mode === "nine") {
      assert.ok(!had("attackNegated"), `${seat}: the attack was not negated`);
      assert.ok(zoneOf(r, foe, "life").length < life, `${seat}: the protected attack dealt its damage`);
    } else {
      assert.ok(had("attackNegated"), `${seat}: without the protection the same Counter negates`);
      assert.equal(zoneOf(r, foe, "life").length, life, `${seat}: and no damage is dealt`);
    }
  }
  // 5. Not attack prevention: a ban on attacking still stops it; removing the attacker still works.
  {
    const s = fresh(seat);
    dropOf(s, seat, 9);
    const goku = stage(s, seat, "GOKU936", "hand"), ban = stage(s, seat, "BAN936", "battle");
    let r = settle(take(s, playAction(s, goku)!), null);
    assert.ok(RULES.legalActions(ctx, r).some((l) => l.action.type === "attack" && l.action.attacker === goku), "protected, it can attack");
    r = settle(take(r, activateAction(r, ban)!), goku);
    assert.ok(protectedNow(r, goku), "the protection is still there");
    assert.ok(!RULES.legalActions(ctx, r).some((l) => l.action.type === "attack" && l.action.attacker === goku), "but 'can't attack' still stops it");
  }
  {
    const s = fresh(seat);
    dropOf(s, seat, 9);
    const goku = stage(s, seat, "GOKU936", "hand");
    const counter = stage(s, foe, "REMOVE936", "hand");
    let r = settle(take(s, playAction(s, goku)!), null);
    const life = zoneOf(r, foe, "life").length;
    events = [];
    r = fight(r, seat, goku, r.sides[foe].zones.leader[0], counter);
    assert.ok(zoneOf(r, seat, "drop").includes(goku), `${seat}: the Counter removed the protected attacker`);
    assert.equal(zoneOf(r, foe, "life").length, life, "and the battle dealt nothing");
  }
  // 6. It lasts the turn and no longer, with the power and the keyword.
  {
    const s = fresh(seat);
    dropOf(s, seat, 9);
    const goku = stage(s, seat, "GOKU936", "hand");
    let t = settle(take(s, playAction(s, goku)!), null);
    assert.ok(protectedNow(t, goku));
    t = take(t, { type: "endMain", player: seat });
    for (let i = 0; i < 8 && t.turnPlayer === seat; i++) {
      const q = t.prompt as { kind: string; player: PlayerId };
      t = take(t, q.kind === "main" ? { type: "endMain", player: q.player } : q.kind === "charge" ? { type: "charge", player: q.player, card: null } : { type: "pass", player: q.player } as Action);
    }
    assert.notEqual(t.turnPlayer, seat, "the turn passed");
    assert.ok(!protectedNow(t, goku), `${seat}: protection ended with the turn`);
    assert.equal(power(t, goku), 20000, "and so did the power");
    assert.ok(!strike3(t, goku));
  }
}
// A [Permanent] version stands in play for as long as the card does, and a negation of its attack fails.
for (const seat of ["p1", "p2"] as const) {
  {
    const foe = other(seat);
    const s = fresh(seat);
    const perm = stage(s, seat, "PERM936", "battle");
    const counter = stage(s, foe, "NEG936", "hand");
    assert.ok(protectedNow(s, perm), `${seat}: a [Permanent] protects while in play`);
    const deck = zoneOf(s, foe, "deck").length, life = zoneOf(s, foe, "life").length;
    events = [];
    const r = fight(s, seat, perm, s.sides[foe].zones.leader[0], counter);
    assert.ok(!had("attackNegated")); assert.ok(zoneOf(r, foe, "life").length < life);
    assert.equal(deck - zoneOf(r, foe, "deck").length, 1, "the Counter's draw happens, its \"if you negated\" draw does not");
    const inHand = fresh(seat); const held = stage(inHand, seat, "PERM936", "hand");
    assert.ok(!protectedNow(inHand, held), "and not in the hand");
  }
}
console.log("#936 attack-negation protection and hand-qualified plays: reading, stored rows, hand/skill/Drop/Warp/deck origins, Counter, ban, removal, expiry, reload, both seats passed");

/**
 * #1042: a skill's "at the end of the battle" effect (1-7-2-1-1) is written down as a `battleEnd` delay, and
 * until now nothing asked for it: `dueDelays` ran for the turn's four timings only, so about thirty skills
 * did their immediate half and silently never the rest. The Battle End Step (8-5-9, "skills that trigger at
 * the end of a battle enter pending") now takes them off the list, behind the step's own hooks.
 *
 *  - the effect waits for the Battle End Step: it has not happened at the counter window or the damage;
 *  - it runs for both seats, once, and a battle that ended early (the attack negated, 8-1-6-1) still pays it;
 *  - the state is plain JSON (every action here is applied to a reloaded copy), and one that asks a question
 *    stops for the answer;
 *  - a combo-entry Auto whose printed moment says more than the trigger can ask ("from your hand", "from an
 *    Energy Area using {X}'s skill", "with an <Android 18> card in battle") is refused instead of switched on.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, compileSkill, fifty, parseSkills } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const DROP_ME = "[Auto] When this card attacks, draw 1 card and place this card in its owner's Drop at the end of the battle.";
const SEND_BACK = "[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and return it to its owner's hand at the end of the battle.";
const defs: Record<string, CardDef> = { ...DEFS,
  DROP1042: card("DROP1042", { energyCost: 0, power: 20000, skill: DROP_ME }),
  BACK1042: card("BACK1042", { energyCost: 0, power: 20000, skill: SEND_BACK }),
  FOE1042: card("FOE1042", { colors: ["Blue"], energyCost: 2, power: 5000 }),
  NEG1042: card("NEG1042", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading: a battleEnd delay, nothing unread ───────────────────────────
for (const id of ["DROP1042", "BACK1042"]) {
  const row = skillRecords(defs[id]).find((r) => r.kind === "auto")!;
  assert.deepEqual(row.unread, [], id);
  assert.ok(JSON.stringify(row.ops).includes('"at":"battleEnd"'), `${id} schedules a battleEnd delay`);
}

// ── the refusals ─────────────────────────────────────────────────────────────
const unread = (text: string) => compileSkill(parseSkills(text)[0]).unsupported;
assert.ok(unread("[Auto] When you combo with this card from an Energy Area using {Meteoric Energy SSB Vegito}'s skill, play this card at the end of the battle.").length, "BT7-030: the origin and the skill are not asked");
assert.ok(unread("[auto]{u}, during your turn: When you combo with this card from your hand with an <Android 18> card in battle, play this card at the end of the battle.").length, "BT8-030: the company is not asked");
assert.ok(unread("[Auto][Limit 1] If your Leader's back side is a black <Vegito: Xeno> card, you have 2 or more energy, and you have a <Vegeta: Xeno> card in your Combo Area: When this card is used in a combo from your hand, add this card from your Drop to your Z-Energy at the end of the battle.").length, "BT24-116: 'used in a combo from your hand' is not asked");
// What the trigger does ask stays read: "this card in your hand", and a plain combo entry.
assert.deepEqual(unread("[auto][limit 1]{g}, if your Leader is a <Zamasu> or <Goku Black> card: When this card in your hand is used in a combo, play this card from your Drop at the end of the battle."), [], "BT23-134's wording asks the hand origin");
assert.deepEqual(unread("[Auto] If your Leader Card is red and you have a red Unison Card in play: When this card is used in a combo, draw 1 card, then at the end of the battle, place this card in its owner's Drop Area."), [], "BT12-007's wording is any combo");
// A combo-from-hand Auto with no end-of-battle half is not this guard's business.
assert.deepEqual(unread("[Auto] When this card is used in a combo from your hand, draw 1 card."), []);

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState {
  return RULES.apply(ctx, roundtrip(s), action).state as VmState; // every step runs on a reloaded copy
}
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 1042, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); if (area === "battle") s.cards[id].mode = "active"; return id;
}
const zoneOf = (s: VmState, p: PlayerId, zone: string) => s.sides[p].zones[zone];

/** Run a battle to its end, calling `seen` at every prompt while it lasts; the defender answers the counter window with `counter`. */
function fight(s: VmState, seat: PlayerId, attacker: string, target: string, counter: string | null, seen: (s: VmState) => void): VmState {
  const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === attacker && l.action.target === target);
  assert.ok(atk, "the attack is offered");
  s = take(s, atk.action);
  for (let i = 0; i < 40 && (s.battle || s.prompt.kind !== "main"); i++) {
    seen(s);
    const q = s.prompt;
    if (q.kind === "counter") {
      const pick = counter && q.player === other(seat) && q.candidates.includes(counter) ? counter : null;
      s = take(s, { type: "counter", player: q.player, card: pick });
    } else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main", "the battle is over and the turn player is back in the Main Phase");
  assert.equal(s.battle, null);
  return s;
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // 1. The card goes to the Drop after the battle, not before it, and the list is empty again.
  {
    const s = fresh(seat);
    const me = stage(s, seat, "DROP1042", "battle");
    let early = 0, sawDelay = false;
    const r = fight(s, seat, me, s.sides[foe].zones.leader[0], null, (st) => {
      if (st.battle && st.battle.step !== "battleEnd") {
        assert.ok(zoneOf(st, seat, "battle").includes(me), `${seat}: before the Battle End Step the card is still in the Battle Area`);
        early++;
        if (st.delayed.length) sawDelay = true;
      }
    });
    assert.ok(early > 0, "the loop watched the battle");
    assert.ok(sawDelay, `${seat}: the effect was written down while the battle lasted`);
    assert.ok(zoneOf(r, seat, "drop").includes(me), `${seat}: after the battle the card is in its owner's Drop Area`);
    assert.ok(!zoneOf(r, seat, "battle").includes(me));
    assert.equal(r.delayed.length, 0, "the effect was taken off the list");
  }
  // 2. A battle that ends early because the attack was negated still pays it.
  {
    const s = fresh(seat);
    const me = stage(s, seat, "DROP1042", "battle");
    const neg = stage(s, foe, "NEG1042", "hand");
    const life = zoneOf(s, foe, "life").length;
    const r = fight(s, seat, me, s.sides[foe].zones.leader[0], neg, () => undefined);
    assert.equal(zoneOf(r, foe, "life").length, life, `${seat}: the attack was negated, no damage`);
    assert.ok(zoneOf(r, seat, "drop").includes(me), `${seat}: and the delayed effect still ran`);
    assert.equal(r.delayed.length, 0);
  }
  // 3. An effect that chose its card at the attack returns it at the battle's end, not before.
  {
    const s = fresh(seat);
    const me = stage(s, seat, "BACK1042", "battle");
    const victim = stage(s, foe, "FOE1042", "battle");
    const r = fight(s, seat, me, s.sides[foe].zones.leader[0], null, (st) => {
      if (st.battle && st.battle.step !== "battleEnd") assert.ok(zoneOf(st, foe, "battle").includes(victim), `${seat}: the chosen card stays until the battle ends`);
    });
    assert.ok(zoneOf(r, foe, "hand").includes(victim), `${seat}: it went back to its owner's hand at the end of the battle`);
    assert.ok(!zoneOf(r, foe, "battle").includes(victim));
    assert.equal(r.delayed.length, 0);
  }
  // 4. It is once only: the next attack of the turn starts with nothing waiting.
  {
    const s = fresh(seat);
    const me = stage(s, seat, "DROP1042", "battle");
    const second = stage(s, seat, "BACK1042", "battle");
    const r = fight(s, seat, me, s.sides[foe].zones.leader[0], null, () => undefined);
    assert.equal(r.delayed.length, 0);
    assert.ok(zoneOf(r, seat, "battle").includes(second), `${seat}: the other attacker is untouched`);
  }
}
console.log("#1042 battleEnd delays: reading, refusals, after-not-before, negated battle, chosen card, once, reload, both seats passed");

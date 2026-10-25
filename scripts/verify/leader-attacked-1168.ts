/**
 * #1168 (rules review 25 Oct 2026, batch 7, SD15-02 front 20): "When your
 * mono-red ≪Saiyan≫ Leader Card is attacked" describes the Leader, and the
 * description is a condition of the trigger (8-1-3, 9-6). The `yourLeaderAttacked`
 * matcher used to swallow it, so the [-6][Auto] fired, asked its marker price
 * and dealt its damage for any Leader.
 *
 * The record now keeps the description as an IF on the attacked Leader
 * (`special: "subject"`) inside the price's own condition, and `pendAutos`
 * reads it before pending: no trigger, no price. A description the card
 * grammar cannot read whole leaves the skill unread, never firing for any
 * Leader.
 *
 * SD15-02 is the catalog's own text (the #649 audit snapshot,
 * docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json), played from
 * stored rows (`skillRecords` → JSON → `rulesFromRows`), with the Unison's
 * owner in either seat. Run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { cardDefFrom } from "../../src/lib/arena/load";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { other, type Action, type CardDef, type EngineContext, type GameEvent, type PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
};
const SD15_02 = printed("SD15-02");
const F20 = "[-6][Auto] If your opponent's life is at 3 or more: When your mono-red ≪Saiyan≫ Leader Card is attacked, deal 1 damage to your opponent.";
assert.ok(SD15_02.skill?.includes(F20), "SD15-02 front 20 is printed as the review quotes it");

const leader = (id: string, o: Partial<CardDef>): CardDef => card(id, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: null, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "SD15-02": SD15_02,
  L1168_SAIYAN: leader("L1168_SAIYAN", { colors: ["Red"], traits: ["Saiyan"] }),
  L1168_NAMEK: leader("L1168_NAMEK", { colors: ["Red"], traits: ["Namekian"] }),
  L1168_REDBLUE: leader("L1168_REDBLUE", { colors: ["Red", "Blue"], traits: ["Saiyan"] }),
  ATK1168: card("ATK1168", { colors: ["Blue"], energyCost: 0, power: 5000, skill: null }),
  // The plain wording, as a Battle Card watching: unchanged, any Leader.
  PLAIN1168: card("PLAIN1168", { energyCost: 0, power: 10000, skill: "[Auto] When your Leader Card is attacked, draw 1 card." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

// ── the record ───────────────────────────────────────────────────────────────
{
  const rec = skillRecords(SD15_02).find((r) => r.side === "front" && r.skillIndex === 20);
  assert.ok(rec);
  assert.deepEqual(rec.trigger, ["yourLeaderAttacked"]);
  assert.deepEqual(rec.unread, []);
  assert.deepEqual(rec.cond, { kind: "life", side: "opponent", atLeast: 3 }, "the price's own condition is hoisted as before");
  const inner = rec.ops[0];
  assert.equal(rec.ops.length, 1);
  assert.ok(inner.op === "if" && !inner.else, "the Leader description is an IF inside it");
  assert.ok(inner.cond.kind === "count" && inner.cond.sel.special === "subject");
  const f = inner.cond.sel.filter!;
  assert.deepEqual([f.colors, f.monoColor, f.traits, f.type], [["Red"], true, ["Saiyan"], "LEADER"], "mono-red ≪Saiyan≫ Leader Card");
  assert.deepEqual(inner.then, [{ op: "damage", n: 1, side: "opponent" }]);
  assert.equal(rec.reads, "if their life is 3 or more: if that card is a mono-colour red ≪Saiyan≫ Leader Card: deal 1 damage");
}

// ── the readings around it: names, card names, the plain wording, an unread description ──
{
  const read = (text: string) => skillRecords(card("R1168", { type: "UNISON", skill: text }))[0];
  const names = read("[Auto] When your red <Son Goku> Leader Card is attacked, draw 1 card.");
  assert.deepEqual(names.unread, []);
  assert.ok(names.cond?.kind === "count" && names.cond.sel.filter?.characters.includes("Son Goku") && names.cond.sel.filter.colors.includes("Red"), "<names> and a colour are read");
  const named = read("[Auto] When your {Son Goku, the Awakened Power} Leader Card is attacked, draw 1 card.");
  assert.ok(named.cond?.kind === "count" && named.cond.sel.filter?.names.includes("Son Goku, the Awakened Power"), "{card names} are read, comma and all");
  const plain = read("[Auto] When your Leader Card is attacked, draw 1 card.");
  assert.equal(plain.cond, null, "no description, no condition: any Leader");
  assert.deepEqual(plain.ops, [{ op: "draw", n: 1 }]);
  for (const text of ["[Auto] When your shiny Leader Card is attacked, draw 1 card.", "[Auto] When your opponent's Leader Card is attacked, draw 1 card."]) {
    const r = read(text);
    assert.ok(r.unread.length > 0, `unread, never any Leader: ${text}`);
    assert.deepEqual(r.ops, []);
  }
}

// ── the VM, both seats ──────────────────────────────────────────────────────
function take(s: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  const r = RULES.apply(ctx, roundtrip(s), action);
  return { state: r.state as VmState, events: r.events as GameEvent[] };
}
function stage(s: VmState, p: PlayerId, def: string, area: string, markers?: number): string {
  const id = s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `could not stage ${def}`);
  if (markers !== undefined) s.cards[id].markers = markers;
  if (area === "battle") { s.cards[id].mode = "active"; delete s.cards[id].placedThisTurn; }
  s.pending = [];
  return id;
}
/** The attacker's Main Phase on a turn it may attack, with the defender's Leader set to `leaderDef`. */
function attackerMain(defender: PlayerId, leaderDef: string): VmState {
  let s = RULES.createGame(ctx, { seed: 1168, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  // The first player cannot attack on turn 1 (7-3-4-4-1): p1 attacks on its second turn, p2 on its first.
  const script: Action[] = [
    { type: "chooseFirst", player: s.chooser!, first: "p1" } as Action,
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(defender === "p2" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] as Action[] : []),
  ];
  for (const a of script) s = take(s, a).state;
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, other(defender));
  s.cards[s.sides[defender].zones.leader[0]].cardId = leaderDef;
  return s;
}
interface Outcome { asked: number; damage: number; markers: number; drew: number }
/** Attack `target` (default the defender's Leader) and answer to the end of the battle: `pay` the Auto's price or not. */
function attack(defender: PlayerId, leaderDef: string, { pay = true, battleTarget = false, watcher = false } = {}): Outcome {
  let s = attackerMain(defender, leaderDef);
  const attacker = other(defender);
  const unison = stage(s, defender, "SD15-02", "unison", 7);
  const watch = watcher ? stage(s, defender, "PLAIN1168", "battle") : null;
  const guard = battleTarget ? stage(s, defender, "V1", "battle") : s.sides[defender].zones.leader[0];
  if (battleTarget) s.cards[guard].mode = "rest";
  const atk = stage(s, attacker, "ATK1168", "battle");
  const life = s.sides[attacker].zones.life.length;
  const hand = s.sides[defender].zones.hand.length;
  const offered = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === atk && l.action.target === guard);
  assert.ok(offered, "the attack is offered");
  let r = take(s, offered.action);
  let asked = 0;
  for (let i = 0; i < 60 && (r.state.battle || r.state.prompt.kind !== "main"); i++) {
    const q = r.state.prompt;
    let a: Action;
    if (q.kind === "chooseMode" && q.reason === "Pay this Auto skill's cost?") {
      asked++;
      assert.equal(q.player, defender, "the Unison's master is asked");
      assert.ok(q.options.some((o) => /6 markers?/i.test(o)), `the marker price is named: ${q.options.join(" / ")}`);
      assert.equal(q.options.at(-1), "Don't pay", "and it can be declined (9-6-4)");
      a = { type: "chooseMode", player: q.player, index: pay ? 0 : q.options.length - 1 } as Action;
    } else if (q.kind === "counter") a = { type: "counter", player: q.player, card: null } as Action;
    else if (q.kind === "blocker" || q.kind === "combo") a = { type: "pass", player: q.player } as Action;
    else if (q.kind === "orderPending") a = { type: "orderPending", player: q.player, index: 0 } as Action;
    else if (q.kind === "chooseCards") a = { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) } as Action;
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
    r = take(roundtrip(r.state), a);
  }
  assert.equal(r.state.prompt.kind, "main");
  return { asked, damage: life - r.state.sides[attacker].zones.life.length, markers: r.state.cards[unison].markers ?? 0, drew: r.state.sides[defender].zones.hand.length - hand };
}

for (const defender of ["p1", "p2"] as const) {
  const seat = `${defender} holds SD15-02`;
  // Mono-red ≪Saiyan≫: asked, paid, 1 damage, 7 → 1 markers.
  const paid = attack(defender, "L1168_SAIYAN");
  assert.deepEqual([paid.asked, paid.damage, paid.markers], [1, 1, 1], `${seat}: a mono-red ≪Saiyan≫ Leader attacked fires, asks the -6 and deals 1 damage`);
  // Declined: no damage, markers kept.
  const declined = attack(defender, "L1168_SAIYAN", { pay: false });
  assert.deepEqual([declined.asked, declined.damage, declined.markers], [1, 0, 7], `${seat}: declining the price does nothing`);
  // A red ≪Namekian≫ Leader: no trigger, no price.
  const namek = attack(defender, "L1168_NAMEK");
  assert.deepEqual([namek.asked, namek.damage, namek.markers], [0, 0, 7], `${seat}: a red ≪Namekian≫ Leader attacked is no trigger`);
  // A red/blue ≪Saiyan≫ Leader: not mono-colour, no trigger.
  const redBlue = attack(defender, "L1168_REDBLUE");
  assert.deepEqual([redBlue.asked, redBlue.damage, redBlue.markers], [0, 0, 7], `${seat}: a red/blue ≪Saiyan≫ Leader attacked is no trigger`);
  // A Battle Card attacked: not the Leader, no trigger.
  const battle = attack(defender, "L1168_SAIYAN", { battleTarget: true });
  assert.deepEqual([battle.asked, battle.damage, battle.markers], [0, 0, 7], `${seat}: a Battle Card attacked is not the Leader`);
  // The plain "When your Leader Card is attacked" still answers for any Leader.
  const plain = attack(defender, "L1168_NAMEK", { watcher: true });
  assert.equal(plain.drew, 1, `${seat}: the plain wording still draws for a ≪Namekian≫ Leader`);
  assert.equal(plain.asked, 0);
}

console.log("#1168 \"when your mono-red ≪Saiyan≫ Leader Card is attacked\": fires and asks its -6 only for that Leader, both seats; Namekian, red/blue and a Battle Card attacked are no trigger; unread descriptions stay unread");

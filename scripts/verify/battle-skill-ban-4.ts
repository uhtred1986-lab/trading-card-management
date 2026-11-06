/** R-403: P-093 scopes every activation prohibition to Battle Areas. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { forbiddenBy, attrsNow } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { run } from "../../src/lib/arena/vm/flow";
import { fire } from "../../src/lib/arena/vm/events";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTED = "[Auto] When a card evolves into this card, your opponent can't activate skills on Battle Cards for the duration of the turn.";
const defs: Record<string, CardDef> = {
  BS_LEADER: card("BS_LEADER", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  BS_FILLER: card("BS_FILLER", {}),
  BS_BAN: card("BS_BAN", { skill: PRINTED }),
  BS_ANY: card("BS_ANY", { skill: PRINTED.replace("Battle Cards for", "Battle Cards in any area for") }),
  BS_DIRECT: card("BS_DIRECT", { skill: "[Activate: Main] Your opponent can't activate [Counter] skills for the turn." }),
  BS_COUNTER: card("BS_COUNTER", { energyCost: 0, skill: "[Counter: Attack] Negate the attack, then play this card." }),
  BS_EXTRA: card("BS_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
  BS_AUTO: card("BS_AUTO", { skill: "[Auto] When you combo with this card, draw 1 card." }),
  BS_DROP: card("BS_DROP", { skill: "[Auto] When this card is KO'd, draw 1 card." }),
  BS_PERMANENT: card("BS_PERMANENT", { skill: "[Permanent] This card gets +5000 power." }),
};
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
const bans = (id: string) => records.find(r => r.cardId === id)!.ops;
assert.deepEqual(bans("BS_BAN").map(o => o.op === "forbid" ? [o.what, o.fromArea] : o.op), [["activateSkill", "battle"], ["activateCounter", "battle"], ["block", "battle"]]);
assert.ok(bans("BS_ANY").every(o => o.op === "forbid" && o.fromArea === undefined));
assert.ok(bans("BS_DIRECT").every(o => o.op === "forbid" && o.fromArea === undefined));
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(first: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 403, p1: { name: "First", leader: "BS_LEADER", main: fifty("BS_FILLER") }, p2: { name: "Second", leader: "BS_LEADER", main: fifty("BS_FILLER") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
  for (const a of [{ type: "endMain", player: first }, { type: "charge", player: other(first), card: null }, { type: "endMain", player: other(first) }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
  return s;
}
function stage(s: VmState, owner: PlayerId, def: string, area: string): string {
  const id = s.sides[owner].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner }).ok); s.pending = []; return id;
}
function impose(s: VmState, owner: PlayerId, id: string): VmState {
  const source = stage(s, owner, id, "battle");
  // Resolve the stored body of the Auto, after its trigger/cost. No runtime compiler.
  s.programs.push({ card: source, master: owner, ops: copy(ctx.scripts![id].bySkill[0].ops), ip: 0, vars: {} });
  run(ctx, game, s, []); return copy(s);
}
function settle(s: VmState): VmState {
  for (let n = 0; n < 30; n++) {
    const q = s.prompt;
    if (q.kind === "main" || q.kind === "charge") return s;
    const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "counter" ? a.card === null : a.type === "pass" || (a.type === "orderPending" && !a.decline));
    assert.ok(action, `settle ${q.kind}`); s = take(s, action);
  }
  throw new Error("did not settle");
}
let cases = 0;
for (const owner of ["p1", "p2"] as const) {
  const foe = other(owner);
  for (const ban of ["BS_BAN", "BS_ANY", "BS_DIRECT"]) {
    let s = impose(fresh(owner), owner, ban);
    const hand = stage(s, foe, "BS_COUNTER", "hand"), extra = stage(s, foe, "BS_EXTRA", "hand"), battle = stage(s, foe, "BS_COUNTER", "battle"), own = stage(s, owner, "BS_COUNTER", "hand");
    s = copy(s);
    const forbidden = (id: string, player = foe) => !!forbiddenBy(ctx, game, s, "activateCounter", { player, card: id, skillKind: "counter:attack" });
    assert.equal(forbidden(hand), ban !== "BS_BAN"); assert.equal(forbidden(extra), ban === "BS_DIRECT");
    assert.equal(forbidden(battle), true); assert.equal(forbidden(own, owner), false);
    const leader = s.sides[owner].zones.leader[0], target = s.sides[foe].zones.leader[0];
    s = take(s, { type: "attack", player: owner, attacker: leader, target });
    if (ban === "BS_DIRECT") { assert.notEqual(s.prompt.kind, "counter", "global Counter ban closes the window"); cases++; continue; }
    assert.equal(s.prompt.kind, "counter");
    const candidates = RULES.legalActions(ctx, s).map(x => x.action).filter(a => a.type === "counter").map(a => a.card);
    assert.equal(candidates.includes(hand), ban === "BS_BAN"); assert.equal(candidates.includes(extra), ban !== "BS_DIRECT");
    // Counter is hand-only (22-10-5), independently of this area's prohibition.
    assert.throws(() => take(s, { type: "counter", player: foe, card: battle }));
    if (ban === "BS_BAN") {
      const life = s.sides[foe].zones.life.length;
      s = settle(take(s, { type: "counter", player: foe, card: hand }));
      assert.equal(s.sides[foe].zones.life.length, life, "hand Counter really negated the attack");
      assert.ok(s.sides[foe].zones.battle.includes(hand), "the hand Counter continues resolving its play into the banned area");
    } else {
      const forged = copy(s); assert.ok(forged.prompt.kind === "counter"); forged.prompt.candidates.push(hand);
      assert.throws(() => take(forged, { type: "counter", player: foe, card: hand }), /prohibited/, "live any-area/direct ban defeats stale candidate");
    }
    cases++;
  }
  let s = impose(fresh(owner), owner, "BS_BAN");
  for (const area of ["battle", "hand", "drop", "combo"]) {
    const id = stage(s, foe, "BS_AUTO", area);
    assert.equal(!!forbiddenBy(ctx, game, s, "activateSkill", { player: foe, card: id, skillKind: "auto" }), area === "battle", `Auto ${area}`);
  }
  const perm = stage(s, foe, "BS_PERMANENT", "battle");
  assert.equal(attrsNow(ctx, game, s, perm).power, 15000, "Permanent remains applied");
  for (const [def, area, event, args] of [["BS_AUTO", "combo", "comboUsed", { to: "combo" }], ["BS_DROP", "drop", "ko", { role: "koed", to: "drop" }]] as const) {
    const id = stage(s, foe, def, area), handBefore = s.sides[foe].zones.hand.length;
    assert.equal(fire(ctx, game, s, { event, card: id, controller: foe, args }).length, 1); run(ctx, game, s, []);
    s = settle(s); assert.equal(s.sides[foe].zones.hand.length, handBefore + 1, `${area} Auto resolves`);
  }
  const blocked = stage(s, foe, "BS_COUNTER", "battle");
  assert.ok(forbiddenBy(ctx, game, s, "activateCounter", { player: foe, card: blocked }));
  s = settle(take(s, { type: "endMain", player: owner }));
  assert.ok(!forbiddenBy(ctx, game, s, "activateCounter", { player: foe, card: blocked }), "expires with turn");
  cases++;
}
console.log(`battle skill ban 4: ${cases} stored-rule scenarios passed, both seats and live counters`);

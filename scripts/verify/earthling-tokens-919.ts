/** Public BT23 text, reviewed against Bandai; no private game/deck data. */
import assert from "node:assert/strict";
import printed from "./fixtures/earthling-tokens-919.json";
import { CTX, DEFS, card, stagedG } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import { compileCard, compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseFilter, matches } from "../../src/lib/arena/text/filters";
import { RULES } from "../../src/lib/arena/vm";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { attrsNow, condHolds, hasKeyword, resolveSelector } from "../../src/lib/arena/vm/program";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
for (const def of printed) DEFS[def.id] = def as CardDef;
// Serialize drafted records, then load exactly the production row path.
const records = JSON.parse(JSON.stringify(printed.flatMap((def) => skillRecords(DEFS[def.id]).map((row) => ({ ...row, status: "draft", source: "compiler" }))))) as RuleRow[];
const stored = rulesFromRows(records, Object.fromEntries(printed.map((def) => [def.id, DEFS[def.id]])));
const ctx = withTokens({ ...CTX, scripts: new Proxy(CTX.scripts, { get: (base, key) => typeof key === "string" && stored[key] ? stored[key] : Reflect.get(base, key) }) });
const reducerIds = ["BT23-078", "BT23-080", "BT23-082", "BT23-096"];
const frame = (state: VmState, player: PlayerId, ops: Op[], source = state.sides[player].zones.leader[0]): ScriptFrame => ({ ops, ip: 0, vars: {}, card: source, master: player });
const make = (state: VmState, player: PlayerId, name = "Earthling Token", n = 1): string[] => {
  const events: GameEvent[] = [];
  stepScript(vmHost(ctx, game, state, events), frame(state, player, [{ op: "token", name, n, power: 1000, comboCost: 0, comboPower: 0, colors: [] }]));
  return events.flatMap((e) => e.type === "token" ? [e.card] : []);
};
const fresh = (): VmState => stagedG({}) as VmState;
function stageOnRules(state: VmState, player: PlayerId, cardId: string, area: "hand" | "battle"): string {
  const id = state.sides[player].zones.deck[0];
  state.cards[id].cardId = cardId;
  state.cards[id].mode = "active";
  moveCard(state, game, id, area);
  return id;
}

for (const id of reducerIds) {
  const s = fresh();
  const target = stageOnRules(s, "p1", id, "hand");
  const sc = stored[id];
  const permanent = sc.bySkill[id === "BT23-096" ? 10 : 0];
  assert.deepEqual(permanent.unsupported, [], id);
  assert.equal(permanent.ops.length, 1);
  const reduction = permanent.ops[0];
  assert.equal(reduction.op, "costReduction");
  if (reduction.op !== "costReduction") throw new Error(id);
  assert.deepEqual(reduction.target, { sel: { special: "self", area: "hand" } });
  assert.ok(typeof reduction.amount === "object" && "count" in reduction.amount);
  const price = () => Number(attrsNow(ctx, game, s, target).costOf);
  assert.equal(price(), 4, `${id}: zero tokens gives no reduction`);
  assert.deepEqual(cardPrice(ctx, game, s, target), { total: 4, orbs: { Green: 1 } }, "catalog fallback orb convention retained; printed orbs unknown");
  make(s, "p2", "Earthling Token", 3);
  make(s, "p1", "Ghost Token", 2);
  DEFS["R919-IMPOSTOR"] = card("R919-IMPOSTOR", { name: "Earthling", traits: ["Earthling"] });
  stageOnRules(s, "p1", "R919-IMPOSTOR", "battle");
  assert.equal(price(), 4, `${id}: opponents, another token kind, and ordinary Earthlings excluded`);
  const own = make(s, "p1", "Earthling Token", 3);
  assert.equal(price(), 1, `${id}: three tokens reduce by three`);
  assert.deepEqual(cardPrice(ctx, game, s, target), { total: 1, orbs: {} }, "ordinary cost layer applies total and specified reductions");
  s.cards[own[0]].mode = "rest";
  assert.equal(price(), 1, `${id}: Rest tokens still count`);
  moveCard(s, game, own[1], "combo");
  assert.equal(price(), 2, `${id}: Combo token is outside Battle`);
  moveCard(s, game, own[2], "removed");
  assert.equal(price(), 3, `${id}: removal updates the amount`);
  const reloaded = JSON.parse(JSON.stringify(s)) as VmState;
  assert.equal(attrsNow(ctx, game, reloaded, target).costOf, 3, `${id}: reload retains identity/count`);
  const view = RULES.boardView(CTX, reloaded, "p1", {});
  assert.equal(view.you.battle.find((c) => c.id === own[0])?.isToken, true);
  assert.equal(view.you.battle.find((c) => c.id === own[0])?.mode, "rest");
  assert.equal(view.you.battle.find((c) => c.id === own[0])?.power, 1000);
  make(s, "p1", "Earthling Token", 5);
  assert.equal(price(), 0, `${id}: standard cost floor`);
  if (id !== "BT23-096") {
    const option = RULES.legalActions(ctx, s).find((entry) => entry.action.type === "play" && entry.action.card === target);
    assert.ok(option, `${id}: legal with zero energy after reduction`);
    const played = RULES.apply(ctx, s, option.action).state as VmState;
    assert.ok(played.sides.p1.zones.battle.includes(target), `${id}: actual play pays reduced cost`);
  }
  moveCard(s, game, target, "battle");
  assert.equal(price(), 4, `${id}: reducer only holds in hand`);
}

// Invalid/unread heads may never become a flat unconditional reduction.
for (const text of [
  "For each of your Earthling Tokens with impossible wording, reduce the energy cost of this card in your hand by 1.",
  "For each of your Earthling Tokens, bend the fabric of reality.",
  "For each of your Earthling Tokens, reduce the energy cost of this card in your hand by X.",
]) {
  const sc = compileSkill(parseSkills(`[Permanent] ${text}`)[0]);
  assert.ok(sc.unsupported.length);
  assert.deepEqual(sc.ops, []);
}

// The same stored token-kind filter works for other Leaders' actual token
// names, while a bare named-card reference stays exact (19-1-4).
for (const name of ["Earthling", "Ghost", "Chilled's Army", "Clone", "Cell Jr.", "Multi-Form"]) {
  const s = fresh();
  const [token] = make(s, "p1", `${name} Token`);
  const filter = parseFilter(`${name} Tokens`);
  assert.equal(matches(ctx.defs[s.cards[token].cardId], filter), true, name);
  assert.deepEqual(resolveSelector(ctx, game, s, frame(s, "p1", []), { side: "you", area: "battle", filter }), [token], name);
  assert.equal(matches(ctx.defs[s.cards[token].cardId], parseFilter(`{${name}}`)), false, `${name}: ordinary full names remain exact`);
}

// Existing Mai creation programs require BOTH Leader characters and Green.
for (const id of ["BT23-074", "BT23-087", "BT23-088"]) {
  for (const variant of ["matching", "wrong", "one-character", "wrong-color"]) {
    const valid = variant === "matching";
    const s = fresh();
    const leader = s.sides.p1.zones.leader[0];
    DEFS["R919-SINGLE"] = { ...DEFS["BT23-071"], id: "R919-SINGLE", characters: ["Trunks: Future"] };
    DEFS["R919-BLUE"] = { ...DEFS["BT23-071"], id: "R919-BLUE", colors: ["Blue"] };
    s.cards[leader].cardId = valid ? "BT23-071" : variant === "one-character" ? "R919-SINGLE" : variant === "wrong-color" ? "R919-BLUE" : "L-RED";
    const source = stageOnRules(s, "p1", id, "battle");
    const sc = stored[id].bySkill[id === "BT23-074" ? 0 : 10];
    assert.deepEqual(sc.unsupported, []);
    const events: GameEvent[] = [];
    stepScript(vmHost(ctx, game, s, events), frame(s, "p1", sc.ops, source));
    assert.equal(events.filter((e) => e.type === "token").length, valid ? 1 : 0, id);
    if (valid) {
      const token = events.find((e) => e.type === "token")!;
      assert.equal(token.type, "token");
      if (token.type === "token") {
        const def = ctx.defs[s.cards[token.card].cardId];
        assert.deepEqual([def.name, def.power, def.comboCost, def.comboPower], ["Earthling Token", 1000, 0, 0]);
      }
    }
  }
}

{
  const s = fresh();
  const leader = s.sides.p1.zones.leader[0];
  s.cards[leader].cardId = "BT23-071";
  const awaken = compileCard(DEFS["BT23-071"]).bySkill[10].price!.condition!;
  const f = frame(s, "p1", []);
  assert.equal(s.sides.p1.zones.life.length, 8);
  make(s, "p1", "Earthling Token", 2);
  assert.equal(condHolds(ctx, game, s, f, awaken), false, "two tokens do not enable the alternative");
  const [third] = make(s, "p1");
  s.cards[third].mode = "rest";
  assert.equal(condHolds(ctx, game, s, f, awaken), true, "three including Rest enables Awaken at eight life");
  s.cards[leader].flipped = true;
  assert.equal(hasKeyword(ctx, game, s, third, "Barrier"), true, "awakened green Saiyan Leader itself meets in-play requirement");
  s.cards[leader].cardId = "R919-BLUE";
  assert.equal(hasKeyword(ctx, game, s, third, "Barrier"), false, "no green Saiyan in play means no Barrier");
  s.cards[leader].cardId = "BT23-071";
  moveCard(s, game, third, "removed");
  s.cards[leader].flipped = false;
  assert.equal(condHolds(ctx, game, s, f, awaken), false, "losing third token disables the alternative");
}
// Actual Main activation pays the printed rest cost and creates one instance.
{
  let s = fresh();
  s.cards[s.sides.p1.zones.leader[0]].cardId = "BT23-071";
  const mai = stageOnRules(s, "p1", "BT23-087", "battle");
  const activate = RULES.legalActions(ctx, s).find((entry) => entry.action.type === "activate" && entry.action.card === mai && entry.action.skill === 10);
  assert.ok(activate, "matching Leader offers Mai's token activation");
  s = RULES.apply(ctx, s, activate.action).state as VmState;
  assert.equal(s.cards[mai].mode, "rest", "printed rest cost is paid");
  assert.equal(s.sides.p1.zones.battle.filter((id) => s.cards[id].cardId.startsWith("TOKEN:")).length, 1);
  assert.equal(RULES.legalActions(ctx, s).some((entry) => entry.action.type === "activate" && entry.action.card === mai && entry.action.skill === 10), false, "rested/Limit1 Mai cannot create another token");
}

// The Extra's Counter uses the same reduced price during an actual battle.
{
  let s = fresh();
  const extra = stageOnRules(s, "p2", "BT23-096", "hand");
  make(s, "p2", "Earthling Token", 4);
  const attacker = stageOnRules(s, "p1", "V1", "battle");
  s = RULES.apply(ctx, s, { type: "attack", player: "p1", attacker, target: s.sides.p2.zones.leader[0] }).state as VmState;
  const counter = RULES.legalActions(ctx, s).find((entry) => entry.action.type === "counter" && entry.action.card === extra);
  assert.ok(counter, "Surprise Attack Counter is payable with no energy and four tokens");
  s = RULES.apply(ctx, s, counter.action).state as VmState;
  assert.ok(s.sides.p2.zones.drop.includes(extra), "Counter paid the reduced cost and activated");
}
console.log("Earthling Token reducers, identities, Leader conditions and reload passed (#919)");

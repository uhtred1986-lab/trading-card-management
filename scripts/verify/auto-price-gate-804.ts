/**
 * #804: the readiness gate (`runtimeSupportOfRow`) no longer refuses every
 * [Auto] with an action or X price. Since #549 the VM pays them
 * (`vm/auto-costs.ts`); the gate now refuses only what that planner refuses
 * statically (`readableAutomaticPrice`, the X bounds), in the planner's words.
 *
 * On the catalog's own texts (the committed snapshot of 13 Oct 2026) of the two
 * SD15 starter cards the old gate refused:
 *   - BT9-031 "Choose 1 Extra Card in your hand and place it in your Drop Area:
 *     When you combo with this card, it gets +6000 combo power …"
 *   - DB2-004 "Choose 1 card in your life and add it to your hand: When this card
 *     attacks, switch this card to Active Mode, then it gets +10000 power and
 *     can't attack for the turn."
 * the drafted records are reported supported, a confirmed record loads with no
 * unsupported reason (`rulesFromRows`, the online path), and in a game the price
 * is offered, paid or declined (9-6-4: all costs of an [Auto] are optional) and
 * the effect resolves only once it is paid; with nothing to pay it is not
 * offered (5-8-2-2). Neighbouring prices the planner cannot plan stay refused.
 *
 *   npx tsx scripts/verify/auto-price-gate-804.ts      (a `verify-arena` suite)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { typedRecords } from "./records";
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";

// ── the catalog's own texts ─────────────────────────────────────────────────
const SUBSET = "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json";
type CatalogCard = { id: string; cardType: string; colors: string[]; energyCost: string | null; power: number | null; comboCost: number | null; comboPower: number | null; skill: string | null; characters: string[]; traits: string[] };
const catalog = (JSON.parse(fs.readFileSync(SUBSET, "utf8")) as { cards: CatalogCard[] }).cards;
const real = (id: string): CardDef => {
  const c = catalog.find((x) => x.id === id);
  assert.ok(c, `${id} is in the committed catalog snapshot`);
  return card(id, { type: c.cardType as CardDef["type"], colors: c.colors as CardDef["colors"], energyCost: Number(c.energyCost), power: c.power, comboCost: c.comboCost, comboPower: c.comboPower, skill: c.skill, characters: c.characters, traits: c.traits });
};
const defs: Record<string, CardDef> = { ...DEFS, "BT9-031": real("BT9-031"), "DB2-004": real("DB2-004"),
  EXTRA804: card("EXTRA804", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null }) };
assert.match(defs["BT9-031"].skill!, /^\[Auto\] Choose 1 Extra Card in your hand and place it in your Drop Area: When you combo with this card/);
assert.match(defs["DB2-004"].skill!, /^\[Auto\] Choose 1 card in your life and add it to your hand: When this card attacks/);

// ── 1. the gate: the drafted records are supported ──────────────────────────
const OLD_REASON = /cannot resolve an Auto action or X price/;
for (const id of ["BT9-031", "DB2-004"]) {
  const records = skillRecords(defs[id]);
  assert.equal(records.length, 1, `${id}: one [Auto] line`);
  const [r] = records;
  assert.equal(r.kind, "auto");
  assert.ok((r.cost as { program?: unknown[] } | null)?.program?.length, `${id}: the record carries its action price`);
  assert.deepEqual(r.unread, [], `${id}: the compiler read the whole line`);
  const support = runtimeSupportOfRow(r as unknown as RuleRow);
  assert.deepEqual(support.unsupported, [], `${id}: the gate reports the priced Auto supported (${support.unsupported.join("; ")})`);
  assert.ok(!support.unsupported.some((reason) => OLD_REASON.test(reason)));
  // The online path: a confirmed record loads with no unsupported reason, price and effect intact.
  const row = { ...r, status: "confirmed", source: "compiler" } as unknown as RuleRow;
  const loaded = rulesFromRows([row], { [id]: defs[id] })[id];
  assert.equal(loaded.complete, true, `${id}: the confirmed record is complete`);
  assert.deepEqual(loaded.unsupported, []);
  assert.deepEqual(loaded.bySkill[0].unsupported, [], `${id}: the confirmed record executes`);
  assert.ok(loaded.bySkill[0].price?.ops?.length, `${id}: the engine charges the record's price`);
  assert.ok(loaded.bySkill[0].ops.length, `${id}: the effect is the record's`);
}

// ── 2. what the planner cannot plan stays refused, with its reason ──────────
{
  // #1066/#1071: a stored row carries the typed payment, usage and validity records; the cases below vary only the price.
  const auto = (cost: unknown) => runtimeSupportOfRow({ kind: "auto", unread: [], ops: [], cost: { ...zeroCostRecord(), ...(cost as object | null) }, ...typedRecords(), trigger: ["attacks"], printed: "" } as never).unsupported;
  assert.deepEqual(auto({ program: [{ op: "draw", n: 1 }] }), ["the rules engine cannot pay Auto action price containing draw yet — #549 builds it"], "an unplannable action stays refused, in the planner's words");
  assert.match(auto({ program: [{ op: "choose", sel: { side: "you", area: "life", count: 1 }, as: "c0" }, { op: "moveTo", target: { var: "c0" }, to: "play" }] }).join(), /containing moveTo/, "a price that plays a card is not a payment");
  assert.match(auto({ program: [{ op: "faceUp", target: { sel: { special: "self" } } }] }).join(), /face-up action price outside the verified Life choice/);
  assert.match(auto({ x: { min: 2, max: 1 } }).join(), /bounds of this Auto's X cost/, "unreadable X bounds stay refused");
  assert.match(auto({ x: { min: -1 } }).join(), /bounds of this Auto's X cost/);
  assert.deepEqual(auto({ x: { min: 0 } }), [], "a readable X price is supported");
  assert.deepEqual(auto(null), [], "a free Auto is unaffected");
  // Activate lines never were in this check.
  assert.deepEqual(runtimeSupportOfRow({ kind: "activate:main", unread: [], ops: [], cost: { ...zeroCostRecord(), program: [{ op: "draw", n: 1 }] }, ...typedRecords(), trigger: [] } as never).unsupported, []);
}

// ── 3. in a game: offered, paid or declined, effect only once paid ──────────
const loadedDbs = rulesetFor("dbs");
assert.ok(loadedDbs.ok);
const dbs = loadedDbs.definition;
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const rules = RULES;
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => rules.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const answer = (s: VmState, index: number) => apply(s, { type: "chooseMode", player: "p1", index });
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id).length;
const skillAt = (ev: GameEvent[], id: string) => ev.findIndex((e) => e.type === "skill" && e.card === id);
const effectsOn = (s: VmState, id: string, kind: string) => s.effects.filter((e) => e.target === id && e.kind === kind);
const offered = (s: VmState, words: RegExp): number => {
  assert.equal(s.prompt.kind, "chooseMode", "the price is offered");
  if (s.prompt.kind !== "chooseMode") return -1;
  assert.equal(s.prompt.player, "p1");
  assert.match(s.prompt.options[0], /^Pay/); assert.match(s.prompt.options[0], words, "the price names itself");
  return s.prompt.options.length - 1; // the decline
};

/** p1's second turn, in its Main Phase: the first player's first turn has no attack. */
function laterTurn(): VmState {
  let s = rules.createGame(ctx, { seed: 8041, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  s = apply(s, { type: "endMain", player: "p1" }).state;
  for (let i = 0; i < 40 && !(s.prompt.kind === "main" && s.turnPlayer === "p1"); i++) {
    const p = (s.prompt as { player: PlayerId }).player;
    s = apply(s, s.prompt.kind === "main" ? { type: "endMain", player: p } : s.prompt.kind === "charge" ? { type: "charge", player: p, card: null } : { type: "pass", player: p }).state;
  }
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, "p1");
  return s;
}
function stage(s: VmState, id: string, area: "hand" | "battle"): string {
  const physical = s.sides.p1.zones.deck[0];
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, dbs, physical, area, { owner: "p1" }).ok);
  return physical;
}

// DB2-004: it attacks; the price takes a Life card into the hand.
{
  const s = laterTurn();
  const source = stage(s, "DB2-004", "battle");
  const life = [...s.sides.p1.zones.life];
  const hand = s.sides.p1.zones.hand.length;
  const attacked = apply(s, { type: "attack", player: "p1", attacker: source, target: s.sides.p2.zones.leader[0] });
  const decline = offered(attacked.state, /Life Area/);
  assert.equal(skills(attacked.events, source), 0, "nothing resolves before the decision");

  const declined = answer(attacked.state, decline);
  assert.deepEqual(declined.state.sides.p1.zones.life, life, "declining takes no Life card");
  assert.equal(declined.state.sides.p1.zones.hand.length, hand);
  assert.equal(declined.state.cards[source].mode, "rest", "declined: the attacker stays rested");
  assert.equal(effectsOn(declined.state, source, "power").length, 0); assert.equal(skills(declined.events, source), 0);

  const opened = answer(attacked.state, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  assert.ok(opened.state.prompt.kind === "chooseCards" && opened.state.prompt.choice.candidates.length === life.length, "any Life card can pay");
  const pick = life[0];
  const paid = apply(opened.state, { type: "choose", player: "p1", cards: [pick] });
  assert.ok(paid.state.sides.p1.zones.hand.includes(pick), "the chosen Life card is in the hand");
  assert.equal(paid.state.sides.p1.zones.life.length, life.length - 1, "exactly one Life card paid");
  const moved = paid.events.findIndex((e) => e.type === "move" && e.card === pick && e.to === "hand");
  assert.ok(moved >= 0 && moved < skillAt(paid.events, source), "the price, then the skill");
  assert.equal(skills(paid.events, source), 1);
  assert.equal(paid.state.cards[source].mode, "active", "the effect: switched to Active Mode");
  assert.deepEqual(effectsOn(paid.state, source, "power").map((e) => [e.value, e.until]), [[10000, "turn"]], "the effect: +10000 power for the turn");
  assert.ok(paid.state.effects.some((e) => e.kind === "forbid" && e.forbid?.what === "attack"), "the effect: it can't attack for the turn");
}

// BT9-031: you combo with it; the price places an Extra Card from the hand in the Drop.
function comboWith(extras: number) {
  const s = laterTurn();
  const source = stage(s, "BT9-031", "hand");
  const extra = Array.from({ length: extras }, () => stage(s, "EXTRA804", "hand"));
  const attacked = apply(s, { type: "attack", player: "p1", attacker: s.sides.p1.zones.leader[0], target: s.sides.p2.zones.leader[0] });
  assert.equal(attacked.state.prompt.kind, "combo");
  const comboed = apply(attacked.state, { type: "combo", player: "p1", card: source });
  assert.deepEqual(comboed.state.sides.p1.zones.combo, [source]);
  return { s: comboed.state, events: comboed.events, source, extra };
}
{
  const a = comboWith(1);
  const decline = offered(a.s, /Extra Card/);
  assert.equal(skills(a.events, a.source), 0);
  const declined = answer(a.s, decline);
  assert.ok(declined.state.sides.p1.zones.hand.includes(a.extra[0]), "declining keeps the Extra Card");
  assert.equal(effectsOn(declined.state, a.source, "comboPower").length, 0); assert.equal(skills(declined.events, a.source), 0);
  assert.equal(declined.state.prompt.kind, "combo", "the battle goes on");

  const paid = answer(a.s, 0); // the lone Extra Card is the whole choice
  assert.ok(paid.state.sides.p1.zones.drop.includes(a.extra[0]), "the Extra Card is in the Drop");
  const moved = paid.events.findIndex((e) => e.type === "move" && e.card === a.extra[0] && e.to === "drop");
  assert.ok(moved >= 0 && moved < skillAt(paid.events, a.source), "the price, then the skill");
  assert.equal(skills(paid.events, a.source), 1);
  assert.deepEqual(effectsOn(paid.state, a.source, "comboPower").map((e) => [e.value, e.until]), [[6000, "turn"]], "the effect: +6000 combo power for the turn");
  assert.equal(paid.state.prompt.kind, "combo");
}
// Two Extra Cards: the player chooses which pays.
{
  const a = comboWith(2);
  const opened = answer(a.s, 0);
  assert.ok(opened.state.prompt.kind === "chooseCards");
  assert.deepEqual(opened.state.prompt.kind === "chooseCards" ? [...opened.state.prompt.choice.candidates].sort() : [], [...a.extra].sort(), "only Extra Cards are offered");
  const paid = apply(opened.state, { type: "choose", player: "p1", cards: [a.extra[1]] });
  assert.ok(paid.state.sides.p1.zones.drop.includes(a.extra[1])); assert.ok(paid.state.sides.p1.zones.hand.includes(a.extra[0]));
  assert.equal(effectsOn(paid.state, a.source, "comboPower").length, 1);
}
// No Extra Card in hand: the price cannot be paid in its entirety, so it is not offered (5-8-2-2).
{
  const a = comboWith(0);
  assert.notEqual(a.s.prompt.kind, "chooseMode", "no payment is offered");
  assert.equal(skills(a.events, a.source), 0);
  assert.equal(effectsOn(a.s, a.source, "comboPower").length, 0);
  assert.ok(a.events.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
}

console.log("auto-price-gate-804: BT9-031 and DB2-004 are supported by the gate and pay, decline or refuse their Auto prices in a game");

import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import { fusionMaterialsProblem } from "../../src/lib/arena/vm/fusion-materials";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";
import { parseRule } from "../../src/lib/arena/lang/parse";
import { printRule } from "../../src/lib/arena/lang/print";
/** #907: stored Fusion materials own offers, choices and saved continuations.
 * BT11-013 source: #923 inventory, also frozen in keyword-action-costs-926.ts.
 * Current official cardlist power is 20000 (19 Oct online check); #926 retains
 * its historical 35000 fixture. This source correction changes no payment expectation.
 * Generic resource mutations deliberately leave the printed skill unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardDefFrom } from "../../src/lib/arena/load";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, saveRule, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction, GRANTED_LINE_BASE } from "../../src/lib/arena/vm/common";
import type { CostRecord, FusionMaterials, Op } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const FUSION = "[deflect]<br>[union-fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and red <Vegeta: Br>.<br>[permanent] This card can't be KO'd.<br>[auto] If your Leader Card is red: When this card is played, choose up to 1 of your red Unison Cards, add a marker to it, then choose all of your opponent's Battle Cards and they get -15000 power for the turn.";
const GRANT = "[permanent] Red <Gogeta: Br> cards in your hand gain the following skill: ・[union-fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>.";
const defs: Record<string, CardDef> = { ...DEFS,
  "BT11-013": card("BT11-013", { name: "Gogeta, Fusion of the Gods", colors: ["Red"], characters: ["Gogeta: Br"], power: 20000, energyCost: 5, specifiedCost: { Red: 3 }, traits: ["Saiyan"], skill: FUSION }),
  GOKU907: card("GOKU907", { characters: ["Son Goku: Br"] }),
  VEG907: card("VEG907", { characters: ["Vegeta: Br"] }),
  MULTI907: card("MULTI907", { colors: ["Red", "Blue"] }),
  BLUE907: card("BLUE907", { colors: ["Blue"] }),
  RESOURCE907: card("RESOURCE907", { skill: "[Activate: Main] Draw 1 card." }),
  MARKER907: card("MARKER907", { type: "UNISON", skill: "[Activate: Main] Draw 1 card." }),
  UNISON907: card("UNISON907", { type: "UNISON" }),
  GRANT907: card("GRANT907", { type: "LEADER", skill: GRANT }),
  GAIN907: card("GAIN907", { type: "LEADER", skill: "[Permanent] If you have 2 or more cards in your Drop Area, reduce the skill cost of [union] skills on red <Gogeta: Br> cards in your hand by {r}." }),
  LOSE907: card("LOSE907", { type: "LEADER", skill: "[Permanent] If you have 3 or more cards in your hand, reduce the skill cost of [union] skills on red <Gogeta: Br> cards in your hand by {r}." }),
  AUTOGOKU907: card("AUTOGOKU907", { characters: ["Son Goku: Br"], skill: "[Auto] When this card is placed in your Drop Area from your hand by a skill, draw 1 card." }),
  GOG907: card("GOG907", { characters: ["Gogeta: Br"] }),
};
defs.ALTGOKU = card("ALTGOKU", { characters: ["Alternate Goku"], colors: ["Blue"], power: 15000 });
defs.ALTVEG = card("ALTVEG", { characters: ["Alternate Vegeta"], colors: ["Blue"], power: 15000 });
defs.UNEQUAL = card("UNEQUAL", { characters: ["Vegeta: Br"], power: 15000 });
defs.ZGOKU = card("ZGOKU", { type: "Z-BATTLE", characters: ["Son Goku: Br"] });
defs.WARPFUS = card("WARPFUS", { characters: ["Gogeta: Br"], skill: "[Union-Fusion]{r}: <Son Goku: Br> and <Vegeta: Br>.\n[Permanent] You can choose Battle Cards in your Warp when choosing cards to use with this card's [Union] skill from your hand." });
defs.AREAS = card("AREAS", { type: "LEADER", skill: "[Permanent] You can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [Union] skill of a red <Veku> or <Gogeta: Br> card from your hand. If you do, send the chosen cards to their owner's Warp." });
for (const type of ["EXTRA", "LEADER", "UNISON", "Z-UNISON", "TOKEN"] as const) defs[type] = card(type, { type, characters: ["Son Goku: Br"] });
const referencePath = process.argv.includes("--reference-records") ? process.argv[process.argv.indexOf("--reference-records") + 1] : undefined;
const reference = referencePath ? JSON.parse(readFileSync(referencePath, "utf8")) : undefined;
if (reference) for (const source of reference.catalog) defs[source.id] = cardDefFrom(source);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const rows = Object.values(defs).flatMap((def) => skillRecords(def).map((row, id) => ({ ...row, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
if (reference) {
  const stored = normalizeRows(reference.after).rows.filter((row) => ["BT11-013", "P-360"].includes(row.cardId));
  assert.equal(stored.length, 9, "exact exported BT11-013 and P-360 skill sets");
  for (let i = rows.length - 1; i >= 0; i--) if (["BT11-013", "P-360"].includes(rows[i].cardId)) rows.splice(i, 1);
  rows.push(...stored);
}
const fusionRow = rows.find((row) => row.cardId === "BT11-013" && row.kind === "keyword")!;
assert.ok(fusionRow);
const original = fusionRow.cost as CostRecord;
assert.equal(original.version, 1);
assert.deepEqual(original.orbs, { Red: 3 });
assert.deepEqual(original.program, [{ op: "draw", n: 2 }]);

function context(change?: (saved: RuleRow[]) => void): EngineContext {
  const saved = clone(rows); change?.(saved);
  return clone({ ...CTX, defs, scripts: rulesFromRows(saved, defs) });
}
function withCost(id: string, edit: (cost: CostRecord) => void): EngineContext {
  return context((saved) => edit(saved.find((r) => r.cardId === id && r.skillIndex === (id === "BT11-013" ? fusionRow.skillIndex : 0))!.cost as CostRecord));
}
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): { saved: Saved; events: GameEvent[] } {
  const restored = clone(saved); // The executable context and the pending VM are both persisted.
  const result = RULES.apply(restored.ctx, restored.state, clone(action));
  return { saved: clone({ ctx: restored.ctx, state: result.state as VmState }), events: result.events };
}
function fresh(ctx: EngineContext, seat: PlayerId = "p1", leader = "L-RED"): Saved {
  let saved: Saved = { ctx, state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: seat === "p1" ? leader : "L-BLUE", main: fifty("V1") }, p2: { name: "Two", leader: seat === "p2" ? leader : "L-BLUE", main: fifty("V1") } }).state as VmState };
  const first: Action[] = [
    { type: "chooseFirst", player: saved.state.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    ...(seat === "p2" ? [{ type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }] as Action[] : []),
  ];
  for (const action of first) saved = take(saved, action).saved;
  assert.equal(saved.state.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) {
    for (const area of ["hand", "energy"] as const) for (const id of saved.state.sides[p].zones[area].slice()) assert.ok(moveCard(saved.state, game, id, "deck", { owner: p }).ok);
    saved.state.sides[p].attrs.energyMarkers = 0;
  }
  return saved;
}
function stage(saved: Saved, seat: PlayerId, def: string, area: string): string {
  const id = saved.state.sides[seat].zones.deck.at(-1)!;
  saved.state.cards[id].cardId = def;
  assert.ok(moveCard(saved.state, game, id, area, { owner: seat }).ok);
  return id;
}
const offer = (saved: Saved, id: string, skill?: number) => RULES.legalActions(saved.ctx, saved.state).find((l) => l.action.type === "activate" && l.action.card === id && (skill === undefined || l.action.skill === skill));
function finish(start: Saved, first: Action): { saved: Saved; events: GameEvent[]; actions: Action[] } {
  let saved = clone(start); const events: GameEvent[] = [], actions: Action[] = [];
  const apply = (action: Action) => { actions.push(action); const next = take(saved, action); saved = next.saved; events.push(...next.events); };
  apply(first);
  for (let i = 0; i < 30 && saved.state.prompt.kind !== "main"; i++) {
    const prompt = saved.state.prompt;
    if (prompt.kind === "chooseMode" || prompt.kind === "replaceMove") apply({ type: "chooseMode", player: prompt.player, index: 0 } as Action);
    else if (prompt.kind === "payCost") apply({ type: "payCost", player: prompt.player, option: 0 } as Action);
    else if (prompt.kind === "chooseCards") apply({ type: "choose", player: prompt.player, cards: prompt.choice.candidates.slice(0, prompt.choice.min) });
    else if (prompt.kind === "orderPending") apply({ type: "orderPending", player: prompt.player, index: prompt.candidates[0] } as Action);
    else apply({ type: "pass", player: (prompt as { player: PlayerId }).player });
  }
  assert.equal(saved.state.prompt.kind, "main", "saved continuation finishes");
  let replay = clone(start); const replayEvents: GameEvent[] = [];
  for (const action of actions) { const next = take(replay, action); replay = next.saved; replayEvents.push(...next.events); }
  assert.deepEqual(replay, saved, "persisted action replay has identical state and executable context");
  assert.deepEqual(replayEvents, events, "persisted action replay emits identical events");
  return { saved, events, actions };
}
function fusionBoard(ctx: EngineContext, energy: number, seat: PlayerId = "p1"): { saved: Saved; fusion: string } {
  const saved = fresh(ctx, seat);
  const fusion = stage(saved, seat, "BT11-013", "hand");
  stage(saved, seat, "GOKU907", "hand"); stage(saved, seat, "VEG907", "hand");
  for (let i = 0; i < energy; i++) stage(saved, seat, "V1", "energy");
  return { saved, fusion };
}
const rested = (saved: Saved, seat: PlayerId) => saved.state.sides[seat].zones.energy.filter((id) => saved.state.cards[id].mode === "rest").length;

const material = original.fusion!;
assert.equal(fusionMaterialsProblem(material), null);
assert.deepEqual(material.needs.map((n) => n.name), ["Son Goku: Br", "Vegeta: Br"]);
assert.ok(material.samePower);
const rule = { kind: "keyword", trigger: [], cost: clone(original), cond: null, ops: [] };
assert.deepEqual(ruleFromBlocks(blocksOf(rule)), rule, "Fusion material COST survives block authoring roundtrip");
const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok); assert.deepEqual(parsed.value, rule, "material COST survives authoring roundtrip");
const alter = (edit: (f: FusionMaterials) => void) => withCost("BT11-013", (cost) => edit(cost.fusion!));

for (const seat of ["p1", "p2"] as const) {
  const ctx = alter((f) => { f.needs = [{ name: "Alternate Goku", filter: { ...f.needs[0].filter, colors: ["Blue"] } }, { name: "Alternate Vegeta", filter: { ...f.needs[1].filter, colors: ["Blue"] } }]; });
  const board = fusionBoard(ctx, 3, seat);
  assert.equal(offer(board.saved, board.fusion), undefined, "unchanged compiler materials cannot satisfy the stored alternate set");
  const a = stage(board.saved, seat, "ALTGOKU", "hand"), b = stage(board.saved, seat, "ALTVEG", "hand");
  const before = clone(board.saved);
  const act = offer(board.saved, board.fusion)!.action;
  assert.deepEqual(board.saved, before, "material affordability preview is pure");
  const pending = take(board.saved, act).saved;
  assert.equal(rested(pending, seat), 0, "resources follow materials");
  assert.ok(pending.state.prompt.kind === "chooseCards");
  assert.deepEqual(new Set(pending.state.prompt.choice.candidates), new Set([a, b]), "stored alternate selectors own actual material prompts");
  const wrong = board.saved.state.sides[seat].zones.hand.find((id) => board.saved.state.cards[id].cardId === "GOKU907")!;
  assert.throws(() => take(pending, { type: "choose", player: seat, cards: [wrong] }), IllegalAction);
  const done = finish(board.saved, act).saved;
  assert.ok([a, b].every((id) => done.state.sides[seat].zones.drop.includes(id)));
  assert.ok(done.state.sides[seat].zones.hand.includes(wrong), "printed materials remain untouched");
  assert.ok(done.state.sides[seat].zones.battle.includes(board.fusion));
  assert.equal(rested(done, seat), 3);

  // Captured contract controls the saved continuation even if the loaded live
  // script is edited later. The old display words cannot rescue missing data.
  const stale = clone(pending);
  assert.ok(moveCard(stale.state, game, a, "energy", { owner: seat }).ok);
  const staleBefore = clone(stale);
  assert.throws(() => take(stale, { type: "choose", player: seat, cards: [a] }), IllegalAction, "a stale typed material answer is rejected");
  assert.deepEqual(stale, staleBefore);
  const captured = clone(pending);
  captured.ctx.scripts!["BT11-013"].bySkill[fusionRow.skillIndex].price!.fusion!.needs[0].name = "Never";
  const question = captured.state.prompt; assert.ok(question.kind === "chooseCards");
  const progressed = take(captured, { type: "choose", player: seat, cards: [a] }).saved;
  assert.ok(progressed.state.prompt.kind === "chooseCards" && progressed.state.prompt.choice.candidates.includes(b));
  for (const value of [undefined, { ...material, version: 0 }, { ...material, samePower: "true" }]) {
    const obsolete = clone(pending);
    const cursor = obsolete.state.programs.find((f) => f.keywordPrice)!.keywordPrice!;
    cursor.line.script!.price!.fusion = value as FusionMaterials;
    const zones = clone(obsolete.state.sides[seat].zones);
    const result = take(obsolete, { type: "choose", player: seat, cards: [a] });
    assert.equal(result.saved.state.outcome?.kind, "interrupted", "obsolete saved material contract explicitly interrupts");
    assert.deepEqual(result.saved.state.sides[seat].zones, zones, "obsolete save moves no cards");
  }

  const eq = fusionBoard(context(), 3, seat);
  const v = eq.saved.state.sides[seat].zones.hand.find((id) => eq.saved.state.cards[id].cardId === "VEG907")!;
  eq.saved.state.cards[v].cardId = "UNEQUAL";
  assert.equal(offer(eq.saved, eq.fusion), undefined, "default equality is enforced");
  eq.saved.ctx = alter((f) => { f.samePower = false; });
  assert.ok(offer(eq.saved, eq.fusion), "stored explicit equality override controls both offers and picks");
  assert.ok(finish(eq.saved, offer(eq.saved, eq.fusion)!.action).saved.state.sides[seat].zones.battle.includes(eq.fusion));

  const display = fusionBoard(context(), 3, seat);
  display.saved.ctx.defs["BT11-013"].skill = FUSION.replace("Red <Son Goku: Br> and red <Vegeta: Br>", "Blue <Unrelated> and black <Other>");
  assert.ok(offer(display.saved, display.fusion), "material display text cannot override stored contract");
  assert.ok(finish(display.saved, offer(display.saved, display.fusion)!.action).saved.state.sides[seat].zones.battle.includes(display.fusion));

  for (const type of ["EXTRA", "LEADER", "UNISON", "Z-UNISON", "TOKEN"] as const) {
    const bad = fusionBoard(context(), 3, seat);
    const g = bad.saved.state.sides[seat].zones.hand.find((id) => bad.saved.state.cards[id].cardId === "GOKU907")!;
    bad.saved.state.cards[g].cardId = type;
    assert.equal(offer(bad.saved, bad.fusion), undefined, `${type} cannot stand in for a Fusion Battle Card`);
  }
  const z = fusionBoard(context(), 3, seat);
  z.saved.state.cards[z.saved.state.sides[seat].zones.hand.find((id) => z.saved.state.cards[id].cardId === "GOKU907")!].cardId = "ZGOKU";
  assert.ok(offer(z.saved, z.fusion), "Z-Battle Cards remain valid Fusion materials");

  const sourceBoard = (leader = "L-RED", cardId = "WARPFUS", area = "warp") => {
    const saved = fresh(context(), seat, leader), fusion = stage(saved, seat, cardId, "hand");
    const goku = stage(saved, seat, "GOKU907", "hand"), vegeta = stage(saved, seat, "VEG907", area);
    for (let i = 0; i < 3; i++) stage(saved, seat, "V1", "energy");
    return { saved, fusion, goku, vegeta };
  };
  const warp = sourceBoard();
  assert.ok(offer(warp.saved, warp.fusion));
  const warpDone = finish(warp.saved, offer(warp.saved, warp.fusion)!.action).saved;
  assert.ok([warp.goku, warp.vegeta].every((id) => warpDone.state.sides[seat].zones.drop.includes(id)), "hand/Warp permission still pays both to Drop");
  const disabled = sourceBoard();
  disabled.saved.ctx = context((saved) => { (saved.find((r) => r.cardId === "WARPFUS" && r.skillIndex === 0)!.cost as CostRecord).fusion!.extensions = []; });
  assert.equal(offer(disabled.saved, disabled.fusion), undefined, "stored allowed extensions can disable an otherwise live Warp permission");
  const ungranted = sourceBoard("L-RED", "BT11-013");
  assert.equal(offer(ungranted.saved, ungranted.fusion), undefined, "contract extensions never grant permission themselves");
  const areas = sourceBoard("AREAS", "BT11-013", "battle");
  assert.ok(offer(areas.saved, areas.fusion), "standing areas permission survives stored/reloaded records");
  assert.ok(moveCard(areas.saved.state, game, areas.goku, "drop", { owner: seat }).ok);
  const areasDone = finish(areas.saved, offer(areas.saved, areas.fusion)!.action).saved;
  assert.ok(areasDone.state.sides[seat].zones.warp.includes(areas.goku), "both outside materials are still payable; empty hand partition is not an empty cost");
  assert.ok(areasDone.state.sides[seat].zones.warp.includes(areas.vegeta));
  const combined = sourceBoard("AREAS", "WARPFUS", "battle");
  assert.equal(offer(combined.saved, combined.fusion), undefined, "combined permissions do not offer an area set the selected Warp procedure cannot pay");
  assert.ok(moveCard(combined.saved.state, game, combined.vegeta, "warp", { owner: seat }).ok);
  assert.ok(offer(combined.saved, combined.fusion), "the existing Warp procedure retains priority when both permissions stand");
  const combinedDone = finish(combined.saved, offer(combined.saved, combined.fusion)!.action).saved;
  assert.ok([combined.goku, combined.vegeta].every((id) => combinedDone.state.sides[seat].zones.drop.includes(id)));
  const outOfSource = sourceBoard("L-RED", "BT11-013", "drop");
  assert.equal(offer(outOfSource.saved, outOfSource.fusion), undefined);

  // The exact P-360 back record can replace this synthetic grant fixture.
  const leader = reference ? "P-360" : "GRANT907";
  const grantRow = rows.find((r) => r.cardId === leader && (reference ? r.side === "back" && r.skillIndex === 0 : true))!;
  const grant = (row: RuleRow) => (row.ops as Op[]).find((op) => op.op === "permit" && op.what === "unionLine") as Extract<Op, { op: "permit" }>;
  assert.ok(grant(grantRow)?.price?.fusion, "P-360 grant persists material contract");
  const grantCtx = context((saved) => { const p = grant(saved.find((r) => r.cardId === leader && r.side === grantRow.side && r.skillIndex === grantRow.skillIndex)!); p.line = "display deliberately differs from compiler material text"; p.price!.payment.orbs = { Red: 1 }; p.price!.fusion!.needs = [{ name: "Alternate Goku", filter: {} as FusionMaterials["needs"][number]["filter"] }, { name: "Alternate Vegeta", filter: {} as FusionMaterials["needs"][number]["filter"] }]; });
  const saved = fresh(grantCtx, seat, leader);
  if (reference) saved.state.cards[saved.state.sides[seat].zones.leader[0]].flipped = true;
  const gog = stage(saved, seat, "GOG907", "hand");
  stage(saved, seat, "GOKU907", "hand"); stage(saved, seat, "VEG907", "hand"); stage(saved, seat, "V1", "energy");
  assert.equal(offer(saved, gog, GRANTED_LINE_BASE), undefined, "grant compiler material text does not override stored selectors");
  const ag = stage(saved, seat, "ALTGOKU", "hand"), av = stage(saved, seat, "ALTVEG", "hand");
  const grantDone = finish(saved, offer(saved, gog, GRANTED_LINE_BASE)!.action).saved;
  assert.ok([ag, av].every((id) => grantDone.state.sides[seat].zones.drop.includes(id)));
  assert.ok(grantDone.state.sides[seat].zones.battle.includes(gog));
}

for (const edit of [
  (c: CostRecord) => { delete c.fusion; },
  (c: CostRecord) => { (c.fusion as unknown as { version: number }).version = 0; },
  (c: CostRecord) => { c.fusion!.needs.pop(); },
  (c: CostRecord) => { (c.fusion as unknown as { samePower: unknown }).samePower = "true"; },
  (c: CostRecord) => { (c.fusion as unknown as { obsolete: boolean }).obsolete = true; },
  (c: CostRecord) => { c.fusion!.needs[0].filter = { imaginary: true } as unknown as FusionMaterials["needs"][number]["filter"]; },
]) {
  const ctx = withCost("BT11-013", edit), board = fusionBoard(ctx, 3);
  assert.match(ctx.scripts!["BT11-013"].unsupported.join("|"), /Fusion material contract/);
  assert.equal(offer(board.saved, board.fusion), undefined, "missing/malformed stored materials never fall back");
  const before = clone(board.saved);
  assert.throws(() => take(board.saved, { type: "activate", player: "p1", card: board.fusion, skill: fusionRow.skillIndex }), IllegalAction);
  assert.deepEqual(board.saved, before);
}
for (const edit of [
  (p: Extract<Op, { op: "permit" }>) => { delete p.price!.fusion; },
  (p: Extract<Op, { op: "permit" }>) => { delete p.unionVariant; },
  (p: Extract<Op, { op: "permit" }>) => { p.price!.fusion!.extensions = ["unknown" as "unionFusionWarp"]; },
]) {
  const ctx = context((saved) => { const row = saved.find((r) => r.cardId === "GRANT907")!; const p = (row.ops as Op[])[0] as Extract<Op, { op: "permit" }>; edit(p); });
  assert.match(ctx.scripts!.GRANT907.unsupported.join("|"), /typed.*(?:Fusion|Union)/);
  const saved = fresh(ctx, "p1", "GRANT907"), gog = stage(saved, "p1", "GOG907", "hand");
  stage(saved, "p1", "GOKU907", "hand"); stage(saved, "p1", "VEG907", "hand");
  for (let i = 0; i < 4; i++) stage(saved, "p1", i === 1 ? "BLUE907" : "V1", "energy");
  assert.equal(offer(saved, gog, GRANTED_LINE_BASE), undefined, "malformed grant is blocked with rebuild diagnostic");
}
const nested = clone(rows.find((r) => r.cardId === "GRANT907")!);
const badGrant = (nested.ops as Op[])[0] as Extract<Op, { op: "permit" }>; delete badGrant.price!.fusion;
nested.ops = [{ op: "may", ops: [badGrant] }] as unknown as Op[];
assert.match(runtimeSupportOfRow(nested).unsupported.join("|"), /Fusion material contract/, "nested grants are validated by direct loader support");
for (const description of ["<A>", "<A> and <B> and <C>", "<A> or <B>", "<A> and <B>, draw 1 card", "<A> with glittering power and <B>"]) {
  assert.ok(skillRecords(card("UNREAD", { skill: `[Union-Fusion]{r}: ${description}.` }))[0].unread.length, `unconsumed material wording remains unread: ${description}`);
}
assert.deepEqual(skillRecords(card("READ", { skill: "[Union-Fusion]{r}: <A> card with an energy cost of 3 or more and <B> card." }))[0].unread, [], "or-more qualifier remains supported");
assert.deepEqual(skillRecords(card("REPEAT", { skill: "[Union-Fusion]{r}: <A> and <A>." }))[0].unread, [], "duplicate names still mean two distinct physical cards");
console.log("fusion-materials-907: authoritative native/granted materials, source permissions, equality, saved capture/rebuild refusal, both seats and deterministic replay passed");

for (const tag of ["[Once per turn]", "[Limit 1]", "[Counter: Play]"]) {
  const unsupported = skillRecords(card("GRANT-UNREAD", { type: "LEADER", skill: GRANT.replace("[union-fusion]", `[union-fusion]${tag}`) }))[0];
  assert.ok(unsupported.unread.length, `untyped granted identity/use limit remains unread: ${tag}`);
}

async function authoringProof() {
  const obsolete = clone(fusionRow); delete (obsolete.cost as CostRecord).fusion;
  let wrote = false;
  const db = { query: { cardRules: { findFirst: async () => obsolete } }, update: () => { wrote = true; throw new Error("unexpected write"); } };
  await assert.rejects(() => saveRule(db as unknown as Parameters<typeof saveRule>[0], { cardId: obsolete.cardId, side: "front", skillIndex: obsolete.skillIndex, source: "user", status: "corrected", ops: [] }), /Fusion material contract/);
  assert.equal(wrote, false, "authoring an obsolete native Fusion refuses before a write");
}
void authoringProof().catch((error) => { console.error(error); process.exitCode = 1; });

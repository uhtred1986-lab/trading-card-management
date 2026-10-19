/** #907: frozen BT6 Sparking records govern event validity, pending activation and manual offers.
 * Rule-level play arrivals are staged; these are targeted scenarios, never recipe qualification.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { deepEqual, parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import { validityProblem, type ValidityRecord } from "../../src/lib/arena/vm/validity";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const root = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/";
const catalogPath = root + "catalog.json", physicalPath = root + "stored-rules.json";
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")).cards;
const physical = JSON.parse(readFileSync(physicalPath, "utf8"));
const targets = ["BT6-003", "BT6-004", "BT6-007", "BT6-008"];
const defs: Record<string, CardDef> = { ...DEFS,
  VEG907: card("VEG907", { characters: ["Vegeta: Br"], colors: ["Red"] }),
  GOKU907: card("GOKU907", { characters: ["Son Goku: Br"], colors: ["Red"] }),
  WRONG907: card("WRONG907", { characters: ["Vegeta: Br", "Son Goku: Br"], colors: ["Blue"] }),
  SPARKPERM907: card("SPARKPERM907", { skill: "[Permanent][Sparking 2] This card gets +5000 power." }),
};
for (const id of targets) defs[id] = cardDefFrom(catalog.find((c: CardDef) => c.id === id));
const rows = Object.values(defs).flatMap((def) => skillRecords(def).map((r) => ({ ...r, source: "compiler", status: "draft" } as RuleRow)));
const actualFlag = process.argv.indexOf("--stored-rules"), actualPath = actualFlag < 0 ? null : process.argv[actualFlag + 1];
if (actualFlag >= 0) assert.ok(actualPath && !actualPath.startsWith("--"), "--stored-rules requires an actual export path");
if (actualPath) {
  const exported = JSON.parse(readFileSync(actualPath, "utf8"));
  const matching = exported.filter((r: Record<string, unknown>) => targets.includes(String(r.cardId ?? r.card_id)) && r.side === "front" && (r.skillIndex ?? r.skill_index) === 0);
  const actual = normalizeRows(matching); assert.deepEqual(actual.malformed, []);
  assert.deepEqual(actual.rows.map((r) => r.cardId).sort(), [...targets].sort(), "every exact target occurs once");
  for (const row of actual.rows) { assert.equal(validityProblem(row.validity), null); rows[rows.findIndex((r) => r.cardId === row.cardId && r.side === "front" && r.skillIndex === 0)] = row; }
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const rowOf = (id: string) => rows.find((r) => r.cardId === id && r.side === "front" && r.skillIndex === 0)!;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function context(edit?: (rows: RuleRow[]) => void): EngineContext { const saved = clone(rows); edit?.(saved); return clone({ ...CTX, defs, scripts: rulesFromRows(saved, defs) }); }
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): { saved: Saved; events: GameEvent[] } {
  const a = clone(saved), b = clone(saved); const one = RULES.apply(a.ctx, a.state, clone(action)), two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "deterministic action replay from saved executable context and continuation");
  return { saved: clone({ ctx: a.ctx, state: one.state as VmState }), events: one.events };
}
function fresh(owner: PlayerId, ctx = context()): Saved {
  let saved: Saved = { ctx, state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-RED", main: fifty("V1") } }).state as VmState };
  const other = owner === "p1" ? "p2" : "p1";
  for (const action of [{ type: "chooseFirst", player: saved.state.chooser, first: owner }, { type: "mulligan", player: owner, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player: owner, card: null }] as Action[]) saved = take(saved, action).saved;
  assert.equal(saved.state.prompt.kind, "main"); return saved;
}
function stage(saved: Saved, owner: PlayerId, id: string, area: string): string {
  const iid = saved.state.sides[owner].zones.deck.find((id) => saved.state.cards[id].cardId === "V1"); assert.ok(iid); saved.state.cards[iid].cardId = id;
  assert.ok(moveCard(saved.state, game, iid, area, { owner }).ok); saved.state.cards[iid].mode = "active"; return iid;
}
function drops(saved: Saved, owner: PlayerId, count: number): void {
  for (const iid of saved.state.sides[owner].zones.drop.slice()) assert.ok(moveCard(saved.state, game, iid, "deck", { owner }).ok);
  for (let n = 0; n < count; n++) stage(saved, owner, "V1", "drop");
}
function board(owner: PlayerId, id: string, count: number, from: "hand" | "drop" = "hand", ctx = context()) {
  const saved = fresh(owner, ctx); drops(saved, owner, count);
  const source = stage(saved, owner, id, from);
  const candidate = stage(saved, owner, id === "BT6-003" || id === "BT6-004" ? "VEG907" : "GOKU907", "hand");
  assert.ok(moveCard(saved.state, game, candidate, "deck", { owner, position: "top" }).ok);
  return { saved, source, candidate };
}
/** The real move emits the same play-arrival declarations as ordinary/skill play. */
function arrive(start: Saved, source: string, resolve = true) {
  const apply = (saved: Saved) => { const events: GameEvent[] = []; moved(saved.ctx, game, saved.state, events, source, "battle", { owner: saved.state.cards[source].owner, asPlay: true }); if (resolve) run(saved.ctx, game, saved.state, events); return { saved, events }; };
  const one = apply(clone(start)), two = apply(clone(start)); assert.deepEqual(one, two, "arrival/pending checkpoint deterministically replays"); return one;
}
function finish(start: Saved, candidate?: string) {
  let saved = clone(start); const events: GameEvent[] = [];
  for (let n = 0; n < 25 && saved.state.prompt.kind !== "main" && saved.state.prompt.kind !== "gameOver"; n++) {
    const q = saved.state.prompt;
    const action: Action = q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: candidate && q.choice.min === 0 && q.choice.candidates.includes(candidate) ? [candidate] : q.choice.candidates.slice(0, q.choice.min) }
      : q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: q.candidates[0] }
      : q.kind === "chooseMode" ? { type: "chooseMode", player: q.player, index: 0 }
      : q.kind === "counter" ? { type: "counter", player: q.player, card: null }
      : (() => { throw Error(`unexpected ${q.kind}`); })();
    const next = take(saved, action); saved = next.saved; events.push(...next.events);
  }
  return { saved, events };
}
const offer = (saved: Saved, source: string) => RULES.legalActions(saved.ctx, saved.state).find((r) => r.action.type === "activate" && r.action.card === source && r.action.skill === 0);
const checks: string[] = [];
for (const id of targets) {
  const r = rowOf(id); assert.deepEqual(r.unread, []); assert.deepEqual(r.validity, { version: 1, sparking: id === "BT6-003" || id === "BT6-007" ? 3 : 2 });
  const rule: Rule = { kind: r.kind, trigger: r.trigger as Rule["trigger"], usage: r.usage as Rule["usage"], validity: r.validity as ValidityRecord, cost: r.cost as Rule["cost"], cond: r.cond as Rule["cond"], ops: r.ops as Rule["ops"] };
  const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok); assert.ok(deepEqual(parsed.value, rule)); assert.ok(deepEqual(ruleFromBlocks(blocksOf(rule)), rule)); assert.equal(validateRule(rule, r.kind), null);
}
assert.deepEqual(rowOf("BT6-003").trigger, ["playedFromHand"]); assert.deepEqual(rowOf("BT6-004").trigger, ["played"]); assert.deepEqual(rowOf("BT6-008").trigger, ["played"]);
for (const invalid of [undefined, null, {}, { version: 2, sparking: 3 }, { version: 1, sparking: [3] }, { version: 1, sparking: "3" }, { version: 1, sparking: -1 }, { version: 1, sparking: 1.5 }, { version: 1, sparking: 3, future: true }]) {
  assert.ok(validityProblem(invalid)); assert.ok(runtimeSupportOfRow({ ...rowOf("BT6-003"), validity: invalid }).unsupported.some((s) => s.includes("Sparking validity")));
}
for (const owner of ["p1", "p2"] as const) {
  for (const id of ["BT6-003", "BT6-004", "BT6-008"]) {
    const threshold = id === "BT6-003" ? 3 : 2;
    for (const count of [threshold - 1, threshold]) for (const from of ["hand", "drop"] as const) {
      const b = board(owner, id, count, from); const rng = b.saved.state.rngState; const joined = arrive(b.saved, b.source);
      const qualifies = count >= threshold && (id !== "BT6-003" || from === "hand");
      assert.equal(joined.events.filter((e) => e.type === "skill" && e.card === b.source && e.skill === 0).length, Number(qualifies));
      if (qualifies) {
        const q = joined.saved.state.prompt; assert.ok(q.kind === "chooseCards"); assert.ok(q.choice.candidates.includes(b.candidate));
        const result = finish(joined.saved, b.candidate); assert.ok(!result.saved.state.outcome);
        assert.ok(result.saved.state.sides[owner].zones[id === "BT6-003" ? "battle" : "hand"].includes(b.candidate), "full frozen search payoff keeps its real destination");
        if (id === "BT6-003") assert.equal(result.saved.state.cards[b.candidate].mode, "rest");
        assert.notEqual(result.saved.state.rngState, rng, "resolved search shuffles");
        assert.equal(result.saved.state.sides[owner].zones.drop.length, count + Number(id !== "BT6-003"), "validity does not consume Drop cards; only the printed post-search discard adds one");
      } else { assert.equal(joined.saved.state.rngState, rng, "invalid Auto never looks/shuffles"); assert.ok(joined.saved.state.sides[owner].zones.deck.includes(b.candidate)); }
      checks.push(`${owner} ${id} Drop=${count} from=${from} qualifies=${qualifies}`);
    }
    // A valid event cannot activate after a different pending effect lowers the Drop count.
    {
      const b = board(owner, id, threshold); let result = arrive(b.saved, b.source, false); assert.equal(result.saved.state.pending.length, 1);
      drops(result.saved, owner, threshold - 1); const events: GameEvent[] = []; run(result.saved.ctx, game, result.saved.state, events);
      assert.ok(!events.some((e) => e.type === "skill" && e.card === b.source)); assert.ok(result.saved.state.sides[owner].zones.deck.includes(b.candidate));
      checks.push(`${owner} ${id} pending validity falls below threshold`);
    }
    {
      const b = board(owner, id, threshold - 1); const result = arrive(b.saved, b.source, false); assert.equal(result.saved.state.pending.length, 0);
      stage(result.saved, owner, "V1", "drop"); run(result.saved.ctx, game, result.saved.state, []);
      assert.ok(result.saved.state.sides[owner].zones.deck.includes(b.candidate), "no retroactive trigger after crossing threshold");
      checks.push(`${owner} ${id} below-to-above has no retroactive trigger`);
    }
    {
      const b = board(owner, id, threshold); const joined = arrive(b.saved, b.source); assert.equal(joined.saved.state.prompt.kind, "chooseCards");
      drops(joined.saved, owner, 0); const result = finish(joined.saved, b.candidate);
      assert.ok(!result.saved.state.outcome); assert.ok(result.saved.state.sides[owner].zones[id === "BT6-003" ? "battle" : "hand"].includes(b.candidate), "activated effect survives count loss through saved choices");
      checks.push(`${owner} ${id} activated effect independent of later Drop count`);
    }
  }
  for (const count of [2, 3]) {
    const b = board(owner, "BT6-007", count); assert.ok(moveCard(b.saved.state, game, b.source, "battle", { owner }).ok);
    assert.equal(!!offer(b.saved, b.source), count >= 3);
    if (count >= 3) {
      b.saved.state.cards[b.source].mode = "rest"; assert.equal(offer(b.saved, b.source), undefined, "Sparking does not waive the Rest Mode action cost"); b.saved.state.cards[b.source].mode = "active";
      const started = take(b.saved, offer(b.saved, b.source)!.action); assert.equal(started.saved.state.cards[b.source].mode, "rest", "printed action cost still paid");
      const result = finish(started.saved, b.candidate); assert.ok(result.saved.state.sides[owner].zones.battle.includes(b.candidate)); assert.equal(result.saved.state.cards[b.candidate].mode, "active"); assert.equal(result.saved.state.sides[owner].zones.drop.length, count);
    } else assert.equal(b.saved.state.cards[b.source].mode, "active", "invalid offer spends no action cost");
    checks.push(`${owner} BT6-007 manual Drop=${count}, Rest Mode cost preserved`);
  }
  for (const threshold of [1, null]) {
    const ctx = context((saved) => { saved.find((r) => r.cardId === "BT6-003" && r.skillIndex === 0)!.validity = { version: 1, sparking: threshold }; });
    const b = board(owner, "BT6-003", threshold ?? 0, "hand", ctx); const joined = arrive(b.saved, b.source); assert.equal(joined.saved.state.prompt.kind, "chooseCards");
    const result = finish(joined.saved, b.candidate); assert.ok(result.saved.state.sides[owner].zones.battle.includes(b.candidate), "stored threshold overrides printed Sparking3");
    checks.push(`${owner} actual stored validity mutation sparking=${threshold}`);
  }
  {
    const saved = fresh(owner); drops(saved, owner, 1); const source = stage(saved, owner, "SPARKPERM907", "battle");
    assert.equal(attrsNow(saved.ctx, game, saved.state, source).power, 10000); stage(saved, owner, "V1", "drop"); assert.equal(attrsNow(saved.ctx, game, saved.state, source).power, 15000);
    checks.push(`${owner} typed Sparking static validity control`);
  }
}
// Missing metadata in saved event, pending, manual-offer and activated-frame contexts fails closed.
for (const mode of ["event", "pending", "frame", "manual"] as const) {
  const b = board("p1", mode === "manual" ? "BT6-007" : "BT6-003", 3);
  if (mode === "frame") {
    const active = arrive(b.saved, b.source); const frame = active.saved.state.programs.find((f) => f.skillIndex === 0 && f.card === b.source); assert.ok(frame); delete frame.validity;
    const result = take(active.saved, { type: "choose", player: "p1", cards: [b.candidate] }); assert.equal(result.saved.state.outcome?.kind, "interrupted"); assert.equal(result.saved.state.outcome?.privateContext?.issue, "#907");
  } else {
    if (mode === "pending") { const pending = arrive(b.saved, b.source, false); b.saved = pending.saved; }
    delete b.saved.ctx.scripts![mode === "manual" ? "BT6-007" : "BT6-003"].bySkill[0].validity;
    if (mode === "event") assert.throws(() => arrive(b.saved, b.source), /Sparking validity/);
    else if (mode === "manual") { assert.ok(moveCard(b.saved.state, game, b.source, "battle", { owner: "p1" }).ok); assert.throws(() => RULES.legalActions(b.saved.ctx, b.saved.state), /Sparking validity/); }
    else { run(b.saved.ctx, game, b.saved.state, []); assert.equal(b.saved.state.outcome?.kind, "interrupted"); assert.equal(b.saved.state.outcome?.privateContext?.issue, "#907"); }
  }
}
const receipt = { recordMode: actualPath ? "actual-stored-readback" : "offline-rebuilt-fixture", inputHashes: { catalog: createHash("sha256").update(readFileSync(catalogPath)).digest("hex"), physical: createHash("sha256").update(readFileSync(physicalPath)).digest("hex"), actualExport: actualPath ? createHash("sha256").update(readFileSync(actualPath)).digest("hex") : null }, parsed: 4, executable: 4, reviewed: false, qualified: false, pairGames: 0, scenarios: checks, targets: targets.map((id) => { const old = physical.find((r: { card_id: string; side: string; skill_index: number }) => r.card_id === id && r.side === "front" && r.skill_index === 0)!; return { cardId: id, side: "front", skillIndex: 0, old: { id: old.id, version: old.version, source: old.source, status: old.status, rowHash: sha(old), printedHash: sha(old.printed) }, rebuilt: rowOf(id), appliedToDatabase: false }; }) };
const out = process.argv.indexOf("--out"); if (out >= 0) writeFileSync(process.argv[out + 1], JSON.stringify(receipt, null, 2) + "\n");
console.log(`#907 typed Sparking: ${checks.length} both-seat scenarios, four frozen payoffs, stored mutations, saved validity boundaries and language/blocks passed`);

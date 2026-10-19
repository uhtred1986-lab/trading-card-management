/** #907: frozen BT6-059 must select a Barrier card while ignoring its protection. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { moved, run } from "../../src/lib/arena/vm/flow";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const catalogPath = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json";
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")).cards;
const defs: Record<string, CardDef> = { ...DEFS,
  "BT6-059": cardDefFrom(catalog.find((c: CardDef) => c.id === "BT6-059")),
  BARRIER907: card("BARRIER907", { skill: "[Barrier]" }),
};
const rows = Object.values(defs).flatMap(d => skillRecords(d).map(r => ({ ...r, status: "draft", source: "compiler" } as RuleRow)));
const freshRow = rows.find(r => r.cardId === "BT6-059" && r.skillIndex === 20)!;
const actualFlag = process.argv.indexOf("--stored-rules"), actualPath = actualFlag < 0 ? null : process.argv[actualFlag + 1];
if (actualFlag >= 0) assert.ok(actualPath && !actualPath.startsWith("--"));
if (actualPath) {
  const input = JSON.parse(readFileSync(actualPath, "utf8"));
  const parsed = normalizeRows(input.filter((r: Record<string, unknown>) => (r.cardId ?? r.card_id) === "BT6-059" && r.side === "front" && (r.skillIndex ?? r.skill_index) === 20));
  assert.deepEqual(parsed.malformed, []); assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].printed, freshRow.printed, "actual record source is current");
  rows[rows.indexOf(freshRow)] = parsed.rows[0];
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = clone({ ...CTX, defs, scripts: rulesFromRows(rows, defs) });
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): Saved {
  const a = clone(saved), b = clone(saved);
  const one = RULES.apply(a.ctx, a.state, clone(action)), two = RULES.apply(b.ctx, b.state, clone(action));
  assert.deepEqual(one, two, "saved-context action deterministically replays");
  return clone({ ctx: a.ctx, state: one.state as VmState });
}
const checks: string[] = [];
for (const owner of ["p1", "p2"] as const) for (const pick of [true, false]) {
  const other = owner === "p1" ? "p2" : "p1";
  let saved: Saved = { ctx: clone(ctx), state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-RED", main: fifty("V1") } }).state as VmState };
  for (const action of [{ type: "chooseFirst", player: saved.state.chooser, first: owner }, { type: "mulligan", player: owner, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player: owner, card: null }] as Action[]) saved = take(saved, action);
  const stage = (player: PlayerId, def: string, area: string) => {
    const id = saved.state.sides[player].zones.deck.find(i => saved.state.cards[i].cardId === "V1"); assert.ok(id);
    saved.state.cards[id].cardId = def; assert.ok(moveCard(saved.state, game, id, area, { owner: player }).ok); return id;
  };
  const source = stage(owner, "BT6-059", "hand"), barrier = stage(other, "BARRIER907", "battle"), plain = stage(other, "V1", "battle");
  const events: GameEvent[] = []; moved(saved.ctx, game, saved.state, events, source, "battle", { owner, asPlay: true }); run(saved.ctx, game, saved.state, events);
  assert.equal(saved.state.prompt.kind, "chooseCards");
  if (saved.state.prompt.kind !== "chooseCards") throw Error("expected choice");
  assert.deepEqual(saved.state.prompt.choice.candidates, [barrier], "Barrier is ignored as protection, retained as a required target property");
  assert.throws(() => take(saved, { type: "choose", player: owner, cards: [plain] }), IllegalAction, "plain Battle Card cannot be forged into this choice");
  saved = take(saved, { type: "choose", player: owner, cards: pick ? [barrier] : [] });
  assert.equal(saved.state.sides[other].zones.drop.includes(barrier), pick);
  assert.ok(saved.state.sides[other].zones.battle.includes(plain));
  checks.push(`${owner} exact Barrier target pick=${pick}`);
}
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1], JSON.stringify({ recordMode: actualPath ? "actual-stored-readback" : "offline-rebuilt-fixture", actualExportHash: actualPath ? createHash("sha256").update(readFileSync(actualPath)).digest("hex") : null, targets: ["BT6-059/front/20"], checks, qualified: false, pairGames: 0 }, null, 2) + "\n");
console.log("barrier-ko-907: four both-seat exact Barrier target, decline and forged-choice checks passed");

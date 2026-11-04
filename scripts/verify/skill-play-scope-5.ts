/** R-421: immediate skill lifetime; Counter window integration follows separately. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { immediatePlayProfile, startSkillPlayScope } from "../../src/lib/arena/vm/skill-play-scope";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const self = { sel: { special: "self" as const } };
const play: Op = { op: "play", target: self };
assert.equal(immediatePlayProfile([play]).arrivals, 1);
assert.equal(immediatePlayProfile([play, play]).arrivals, "many");
assert.equal(immediatePlayProfile([{ op: "play", target: self, activating: true }]).arrivals, 0);
assert.equal(immediatePlayProfile([{ op: "delay", at: "turnEnd", ops: [play] }]).arrivals, 0);
assert.equal(immediatePlayProfile([{ op: "may", ops: [play] }]).arrivals, 1);
assert.equal(immediatePlayProfile([{ op: "chooseMode", modes: [{ label: "one", ops: [play] }, { label: "two", ops: [play] }] }]).arrivals, 1);
assert.equal(immediatePlayProfile([{ op: "play", target: { sel: { area: "hand", count: 1 } } }]).arrivals, "many", "Ref does not enforce a choice count");
assert.equal(immediatePlayProfile([{ op: "choose", sel: { area: "hand", count: 1 }, as: "one" }, { op: "play", target: { var: "one" } }]).arrivals, 1);
assert.equal(immediatePlayProfile([{ op: "token", name: "Ghost Token", power: 15000, comboCost: null, comboPower: null, colors: [], n: 3 }]).arrivals, "many");
assert.equal(immediatePlayProfile([{ ...play, counterWindow: true }]).explicitWindow, true);
const defs: Record<string, CardDef> = {
 SPS5_LEADER: card("SPS5_LEADER", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
 SPS5_FILLER: card("SPS5_FILLER", {}),
 SPS5_MAIN: card("SPS5_MAIN", { skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it." }),
 SPS5_EXTRA: card("SPS5_EXTRA", { name: "Scope Extra", type: "EXTRA", power: null, comboCost: null, comboPower: null, energyCost: 0, skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it." }),
 SPS5_PARENT: card("SPS5_PARENT", { skill: "[Activate: Main] Choose up to 1 {Scope Extra} from your Drop, activate it, then choose up to 1 Battle Card from your hand and play it." }),
 SPS5_COUNTER: card("SPS5_COUNTER", { energyCost: 0, skill: "[Counter: Play] Play this card." }),
 SPS5_AUTO: card("SPS5_AUTO", { skill: "[Auto] When this card is played, choose up to 1 Battle Card from your hand and play it." }),
};
const records = Object.values(defs).flatMap(skillRecords);
assert.deepEqual(records.flatMap(r => r.unread), []);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action): VmState => copy(RULES.apply(ctx, copy(s), a).state as VmState);
function fresh(first: PlayerId): VmState {
 let s = RULES.createGame(ctx, { seed: 421, p1: { name: "A", leader: "SPS5_LEADER", main: fifty("SPS5_FILLER") }, p2: { name: "B", leader: "SPS5_LEADER", main: fifty("SPS5_FILLER") } }).state as VmState;
 for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
 return s;
}
function stage(s: VmState, p: PlayerId, def: string, zone: string): string {
 const id = s.sides[p].zones.deck.findLast(id => s.cards[id].cardId === "SPS5_FILLER")!;
 s.cards[id].cardId = def; assert.ok(moveCard(s, game, id, zone, { owner: p }).ok); return id;
}
function activate(s: VmState, id: string): VmState {
 const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === id);
 assert.ok(action); return take(s, action);
}
function choose(s: VmState, cards: string[]): VmState {
 assert.equal(s.prompt.kind, "chooseCards"); return take(s, { type: "choose", player: s.prompt.player!, cards });
}
let cases = 10;
for (const seat of ["p1", "p2"] as const) {
 let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const target = stage(s, seat, "SPS5_FILLER", "hand");
 s = activate(s, source); assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].source, source);
 const scope = s.skillPlayScopes![0].id; assert.ok(s.programs.some(f => f.skillPlayFinish?.scope === scope));
 const malformed = copy(s); malformed.skillPlayScopes![0].parent = scope;
 assert.throws(() => startSkillPlayScope(malformed, malformed.programs.find(f => f.skillEffectOrigin)!), /rebuild this saved skill-play ancestry/);
 const missing = copy(s); delete missing.skillPlayScopes;
 assert.throws(() => startSkillPlayScope(missing, missing.programs.find(f => f.skillEffectOrigin)!), /rebuild this saved skill-play continuation/);
 cases += 2;
 // A departed source does not cancel an already activated effect; JSON replay keeps its boundary.
 assert.ok(moveCard(s, game, source, "drop", { owner: seat }).ok); s = choose(copy(s), [target]);
 assert.ok(s.sides[seat].zones.battle.includes(target)); assert.equal(s.skillPlayScopes, undefined); assert.equal(s.prompt.kind, "main"); cases++;
 s = fresh(seat); const parent = stage(s, seat, "SPS5_PARENT", "battle"); const extra = stage(s, seat, "SPS5_EXTRA", "drop"); stage(s, seat, "SPS5_FILLER", "hand");
 s = activate(s, parent); assert.equal(s.skillPlayScopes?.length, 1); const outer = s.skillPlayScopes![0].id;
 s = choose(s, [extra]);
 if (s.prompt.kind === "chooseCards" && s.prompt.choice.continuation === "invokeCard") s = choose(s, [extra]);
 if (s.prompt.kind === "chooseMode") s = take(s, { type: "chooseMode", player: seat, index: 0 });
 assert.equal(s.skillPlayScopes?.length, 2); assert.equal(s.skillPlayScopes![1].parent, outer); assert.equal(s.skillPlayScopes![1].source, extra);
 s = choose(copy(s), []); assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].id, outer);
 s = choose(s, []); assert.equal(s.skillPlayScopes, undefined); assert.equal(s.prompt.kind, "main"); cases++;
 s = fresh(seat); const autoSource = stage(s, seat, "SPS5_MAIN", "battle"); const autoTarget = stage(s, seat, "SPS5_AUTO", "hand");
 s = activate(s, autoSource); const root = s.skillPlayScopes![0].id; s = choose(s, [autoTarget]);
 assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].source, autoTarget); assert.notEqual(s.skillPlayScopes![0].id, root);
 assert.equal(s.skillPlayScopes![0].parent, undefined, "played Auto activates only after outer effect's boundary");
 s = choose(s, []); assert.equal(s.skillPlayScopes, undefined); cases++;
 s = fresh(seat); const declared = stage(s, seat, "SPS5_FILLER", "hand"); const counter = stage(s, other(seat), "SPS5_COUNTER", "hand");
 s.cards[declared].cardId = "SPS5_COUNTER"; // zero energy printed Battle Card to declare
 const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "play" && a.card === declared); assert.ok(action);
 s = take(s, action); assert.equal(s.prompt.kind, "counter");
 s = take(s, { type: "counter", player: other(seat), card: counter });
 assert.ok(s.sides[other(seat)].zones.battle.includes(counter)); assert.ok(s.sides[seat].zones.battle.includes(declared));
 assert.equal(s.skillPlayScopes, undefined); assert.equal(s.nextSkillPlayScope, 1, "only Counter effect, not declared play, owns a scope"); cases++;
}
console.log(`skill-play-scope-5: ${cases} cases passed`);

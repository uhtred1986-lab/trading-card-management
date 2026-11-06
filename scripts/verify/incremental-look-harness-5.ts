/** Full source cards and exact compiler admission against frozen prior records. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { card } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { describeScript } from "../../src/lib/arena/vm/script";
import { skillRecords, patternKey } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { CardDef, EngineContext, Action, PlayerId, GameEvent } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { LookOp } from "../../src/lib/arena/vm/incremental-look";
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const sources = JSON.parse(fs.readFileSync(new URL("./fixtures/incremental-look-5.json", import.meta.url), "utf8"));
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
export const game = loaded.definition;
export const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
export function context(id: "BT1-061" | "EX02-01", patch: Partial<LookOp> = {}): EngineContext {
    const c = sources[id].card;
    const defs: Record<string, CardDef> = {
        L: card("L", { type: "LEADER", skill: null }),
        F: card("F", { colors: ["Green"], skill: null }),
        N: card("N", { name: "Inspected nonmatching card", characters: [], skill: null }),
        [id]: card(id, { name: c.name, type: c.type, colors: c.colors, energyCost: Number(c.cost), specifiedCost: id === "BT1-061" ? { Green: 1 } : {}, power: c.power, characters: c.characters, traits: c.traits, skill: correctSkillText(id, c.skill) }),
    };
    for (let i = 0; i < 150; i++)
        defs[`P${i}`] = card(`P${i}`, { name: `Inspected match ${i + 1}`, characters: ["Krillin"], skill: null });
    const rows = Object.values(defs).flatMap(skillRecords);
    const expected = clone(Object.values(sources[id].records)) as ReturnType<typeof skillRecords>;
    const admitted = expected.find(r => r.kind === "auto")!;
    admitted.ops[0] = { ...admitted.ops[0], upTo: true } as LookOp;
    if (id === "EX02-01") {
        const tail = admitted.ops[3];
        assert.equal(tail.op, "chooseMode");
        if (tail.op === "chooseMode") for (const mode of tail.modes) {
            const move = mode.ops[0];
            assert.equal(move.op, "moveTo");
            if (move.op === "moveTo") mode.ops[0] = { op: "arrange", target: move.target, position: move.position };
        }
        admitted.pattern = patternKey({ keyword: null }, [], admitted.ops);
    }
    admitted.reads = describeScript(admitted.ops);
    assert.deepEqual(clone(rows.filter(r => r.cardId === id)), expected, "only reviewed complete-record differences");
    const row = rows.find(r => r.cardId === id && r.kind === "auto")!;
    // Primitive variants override only the already-admitted look operation.
    row.ops[0] = { ...row.ops[0], ...patch } as LookOp;
    return { defs, scripts: rulesFromRows(rows.map((r, rowId) => ({ ...r, id: rowId, status: r.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
}
export interface Fixture {
    ctx: EngineContext;
    state: VmState;
    p: PlayerId;
    q: PlayerId;
    source: string;
    top: string[];
    events: GameEvent[];
    take: (a: Action) => void;
}
export function fresh(p: PlayerId, id: "BT1-061" | "EX02-01" = "BT1-061", patch: Partial<LookOp> = {}, size = 50): Fixture {
    const ctx = context(id, patch), q = other(p);
    const f: Fixture = { ctx, state: RULES.createGame(ctx, { seed: 527, p1: { name: "One", leader: "L", main: Array(size).fill("F") }, p2: { name: "Two", leader: "L", main: Array(size).fill("F") } }).state as VmState, p, q, source: "", top: [], events: [], take: () => { } };
    f.take = action => {
        const saved = clone(f.state), before = JSON.stringify(saved);
        const result = RULES.apply(ctx, saved, action);
        assert.deepEqual(RULES.apply(ctx, clone(saved), action), result, "JSON replay is deterministic");
        assert.equal(JSON.stringify(saved), before, "apply does not mutate its input");
        f.state = result.state as VmState;
        f.events.push(...result.events);
        assert.equal(f.state.outcome, undefined, JSON.stringify(f.state.outcome));
    };
    for (const a of [{ type: "chooseFirst", player: f.state.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: q, redraw: false }, { type: "charge", player: p, card: null }] as Action[])
        f.take(a);
    // Explicit mechanism setup: replace a filler Hand definition and stage the
    // energy/Drop resources. The following payment/play/Auto are native actions.
    f.source = f.state.sides[p].zones.hand[0];
    f.state.cards[f.source].cardId = id;
    if (id === "BT1-061")
        for (let i = 0; i < 2; i++) {
            const target = f.state.sides[p].zones.deck.at(-1)!;
            moveCard(f.state, game, target, "energy", { owner: p });
            f.state.cards[target].mode = "active";
        }
    else
        for (let i = 0; i < 3; i++)
            moveCard(f.state, game, f.state.sides[p].zones.deck.at(-1)!, "drop", { owner: p });
    const deckOwner = patch.side === "opponent" ? q : p;
    f.top = [...f.state.sides[deckOwner].zones.deck];
    f.top.forEach((target, i) => { f.state.cards[target].cardId = i === 6 ? "N" : `P${i}`; });
    return f;
}
export function begin(f: Fixture) {
    const id = f.state.cards[f.source].cardId;
    const act = RULES.legalActions(f.ctx, f.state).map(x => x.action).find(a => id === "BT1-061" ? a.type === "play" && a.card === f.source : a.type === "activate" && a.card === f.source && a.skill === 0);
    assert.ok(act, `native ${id} declaration`);
    f.take(act);
    for (let i = 0; i < 20 && !(f.state.prompt.kind === "chooseMode" && f.state.prompt.inspection); i++) {
        const pass = RULES.legalActions(f.ctx, f.state).map(x => x.action).find(a => a.type === "counter" && a.card === null);
        assert.ok(pass, JSON.stringify(f.state.prompt));
        f.take(pass);
    }
    assert.equal(f.state.prompt.kind, "chooseMode");
    if (id === "BT1-061")
        assert.equal(f.state.sides[f.p].zones.energy.filter(id => f.state.cards[id].mode === "rest" && f.ctx.defs[f.state.cards[id].cardId].colors.includes("Green")).length, 2);
    else {
        assert.equal(f.state.sides[f.p].zones.drop.length, 0);
        assert.equal(f.state.sides[f.p].zones.warp.length, 3);
        assert.equal(f.state.cards[f.source].playedUsing, "Over Realm");
    }
}
export function tap(f: Fixture, index: number) { f.take({ type: "chooseMode", player: f.p, index }); }

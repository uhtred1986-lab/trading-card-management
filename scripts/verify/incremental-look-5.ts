/** R527 staged admission: native declaration, private prefix, and original tail. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { RULES } from "../../src/lib/arena/vm";
import { fresh, begin, tap, game } from "./incremental-look-harness-5";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import type { PlayerId } from "../../src/lib/arena/types";
import type { Fixture } from "./incremental-look-harness-5";
function snapshot(f: Fixture, viewer: PlayerId) { return buildSnapshot({ id: 527, revision: 1, mode: "hotseat", status: "playing", p1Name: "One", p2Name: "Two", ctx: f.ctx, state: f.state, legal: RULES.legalActions(f.ctx, f.state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }); }
let cases = 0;
for (const p of ["p1", "p2"] as const)
    for (const n of [0, 1, 7])
        for (const choose of [false, true]) {
            const f = fresh(p);
            begin(f);
            const deck = [...f.state.sides[p].zones.deck], rng = f.state.rngState;
            for (let i = 0; i <= n; i++) {
                const before = JSON.stringify(f.state), own = RULES.boardView(f.ctx, f.state, p, {}), opp = RULES.boardView(f.ctx, f.state, f.q, {});
                assert.equal(JSON.stringify(f.state), before);
                assert.equal(own.prompt.inspection?.cards.length, i);
                assert.equal(opp.prompt.kind, "waiting");
                assert.equal(opp.prompt.inspection, undefined);
                assert.deepEqual(own.prompt.inspection?.cards.map(c => c.id), f.top.slice(0, i));
                assert.deepEqual(f.state.sides[p].zones.deck, deck);
                assert.equal(f.state.rngState, rng);
                const mine = JSON.stringify(snapshot(f, p)), theirs = JSON.stringify(snapshot(f, f.q));
                assert.ok(!theirs.includes("Inspected match"));
                assert.ok(!theirs.includes("Inspected nonmatching"));
                assert.ok(!mine.includes("Inspected match 8"));
                if (i === 7)
                    assert.ok(mine.includes("Inspected nonmatching"));
                if (i < n)
                    tap(f, 0);
            }
            const beforeEvents = f.events.length;
            tap(f, n === 7 ? 0 : 1);
            if (n) {
                assert.equal(f.state.prompt.kind, "chooseCards");
                f.take({ type: "choose", player: p, cards: choose ? [f.top[0]] : [] });
            }
            assert.equal(f.state.prompt.kind, "main");
            assert.notEqual(f.state.rngState, rng, "even stop0 runs printed shuffle");
            assert.equal(f.state.sides[p].zones.hand.includes(f.top[0]), choose && n > 0);
            assert.ok(f.events.length >= beforeEvents);
            cases++;
        }
for (const p of ["p1", "p2"] as const)
    for (const from of ["top", "bottom"] as const)
        for (const side of ["you", "opponent"] as const) {
            const f = fresh(p, "BT1-061", { from, side });
            begin(f);
            const owner = side === "opponent" ? f.q : p, deck = [...f.state.sides[owner].zones.deck], rng = f.state.rngState;
            tap(f, 0);
            assert.deepEqual(RULES.boardView(f.ctx, f.state, p, {}).prompt.inspection?.cards.map(c => c.id), [from === "top" ? deck[0] : deck.at(-1)]);
            assert.deepEqual(f.state.sides[owner].zones.deck, deck);
            assert.equal(f.state.rngState, rng);
            cases++;
        }
for (const p of ["p1", "p2"] as const) {
    const f = fresh(p, "BT1-061", { n: 110 }, 160);
    begin(f);
    for (let i = 0; i < 110; i++)
        tap(f, 0);
    assert.equal(RULES.boardView(f.ctx, f.state, p, {}).prompt.inspection?.cards.length, 110);
    assert.deepEqual(f.state.prompt.kind === "chooseMode" && f.state.prompt.options, ["Continue"]);
    cases++;
    const short = fresh(p);
    for (const id of short.state.sides[p].zones.deck.slice(2))
        moveCard(short.state, game, id, "warp", { owner: p });
    begin(short);
    tap(short, 0);
    tap(short, 0);
    assert.equal(RULES.boardView(short.ctx, short.state, p, {}).prompt.inspection?.maximum, 2);
    tap(short, 0);
    short.take({ type: "choose", player: p, cards: [] });
    assert.equal(short.state.prompt.kind, "main");
    cases++;
    const departed = fresh(p);
    begin(departed);
    tap(departed, 0);
    moveCard(departed.state, game, departed.source, "drop", { owner: p });
    tap(departed, 1);
    departed.take({ type: "choose", player: p, cards: [departed.top[0]] });
    assert.ok(departed.state.sides[p].zones.hand.includes(departed.top[0]));
    cases++;
    const hidden = fresh(p), changed = fresh(p);
    changed.state.cards[changed.top[9]].cardId = "N";
    begin(hidden);
    begin(changed);
    tap(hidden, 0);
    tap(changed, 0);
    assert.deepEqual(snapshot(hidden, p), snapshot(changed, p), "uninspected suffix does not change acting Snapshot");
    assert.deepEqual(snapshot(hidden, hidden.q), snapshot(changed, changed.q), "uninspected suffix does not change opposing Snapshot");
    cases++;
}
for (const p of ["p1", "p2"] as const)
    for (const end of [0, 1])
        for (const first of [0, 1]) {
            const f = fresh(p, "EX02-01");
            begin(f);
            const deck = [...f.state.sides[p].zones.deck];
            tap(f, 0);
            tap(f, 0);
            tap(f, 0);
            assert.equal(f.state.prompt.kind, "chooseCards");
            f.take({ type: "choose", player: p, cards: [] });
            tap(f, end);
            assert.equal(f.state.prompt.kind, "chooseCards");
            f.take({ type: "choose", player: p, cards: [f.top[first]] });
            assert.equal(f.state.prompt.kind, "main");
            const order = [f.top[first], f.top[1 - first]], expected = end === 0 ? [...order, ...deck.slice(2)] : [...deck.slice(2), ...order.reverse()];
            assert.deepEqual(f.state.sides[p].zones.deck, expected);
            f.take({ type: "endMain", player: p });
            assert.ok(f.state.sides[p].zones.warp.includes(f.source), "native Over Realm turn-end cleanup");
            cases++;
        }
if (process.argv.includes("--emit-inspection") || process.argv.includes("--emit")) {
    const f = fresh("p1");
    begin(f);
    fs.writeFileSync("contract/fixtures/inspection-empty.json", JSON.stringify(snapshot(f, f.p), null, 2) + "\n");
    for (let i = 0; i < 7; i++)
        tap(f, 0);
    fs.writeFileSync("contract/fixtures/inspection-prefix.json", JSON.stringify(snapshot(f, f.p), null, 2) + "\n");
}
console.log(`${cases} incremental look native/visibility cases (upTo staged before compiler adoption)`);

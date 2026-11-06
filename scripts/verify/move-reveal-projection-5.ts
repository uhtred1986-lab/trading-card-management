/** R529 projection boundary: trusted conversion receipts never identify hidden occurrences. */
import assert from "node:assert/strict";
import { card } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { appendBeats, maskBeats, BEAT_CAP } from "../../src/lib/arena/beats-core";
import { concealBeats, hiddenAliases, secretAreasFor, resolveAliased } from "../../src/lib/arena/conceal";
import { vmHost } from "../../src/lib/arena/vm/host";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { clone, game } from "./incremental-look-harness-5";
import type { Beats } from "../../src/lib/arena/beats";
import type { GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const ctx = { defs: { L: card("L", { type: "LEADER", skill: null }), A: card("A", { name: "Originally shown", skill: null }), B: card("B", { name: "Later identity", skill: null }) } };
let cases = 0;
for (const p of ["p1", "p2"] as const) {
    const q: PlayerId = p === "p1" ? "p2" : "p1";
    const state = RULES.createGame(ctx, { seed: 529, p1: { name: "One", leader: "L", main: Array(50).fill("A") }, p2: { name: "Two", leader: "L", main: Array(50).fill("A") } }).state as VmState;
    const id = state.sides[p].zones.deck[0], other = state.sides[p].zones.deck[1];
    moveCard(state, game, id, "hand", { owner: p });
    // Controlled events at the trusted conversion seam. Actual Babidi native
    // event production is proved independently by incremental-look-babidi-5.
    const reveal = (): GameEvent => ({ type: "move", card: id, owner: p, from: "deck", to: "hand", reveal: true });
    const older = RULES.toBeats(ctx, state, [{ type: "draw", player: p, card: id }]);
    older.list.push({ t: "skill", card: id, label: "Private skill", text: "Private old text", unread: false, owner: p, inBattle: false, n: ++older.seq });
    const first = RULES.toBeats(ctx, state, [reveal()], older.seq);
    const originalFace = clone(first.revealedMoves![first.seq].art);
    let history = appendBeats(older, first);
    const project = (viewer: PlayerId, beats = history) => concealBeats(maskBeats(state, clone(beats), viewer, ctx), hiddenAliases(state, viewer), secretAreasFor(state, viewer))!;
    for (const viewer of [p, q] as PlayerId[]) {
        const projected = project(viewer);
        assert.equal(projected.art[`?revealed:${first.seq}`].name, "Originally shown");
        assert.ok(!("revealedMoves" in projected));
        assert.equal(projected.list[2].t === "move" && projected.list[2].card, `?revealed:${first.seq}`);
        assert.equal(resolveAliased({ type: "choose", cards: [`?revealed:${first.seq}`] }, state, viewer).ok, false);
        cases++;
    }
    const initial = project(q);
    assert.equal(initial.list[0].t === "draw" && initial.list[0].card, "?");
    assert.ok(!JSON.stringify(initial).includes("Private old text"));
    assert.ok(!JSON.stringify(project(q)).includes(JSON.stringify(id)));
    // Later art/identity changes must never overwrite the already shown face.
    state.cards[id].cardId = "B";
    moveCard(state, game, id, "deck", { owner: p });
    vmHost(ctx, game, state, []).shuffleDecks([p]);
    moveCard(state, game, id, "hand", { owner: p });
    const second = RULES.toBeats(ctx, state, [reveal(), { type: "draw", player: p, card: id }], history.seq);
    history = clone(appendBeats(history, second));
    history.art[other] = { cardId: "B", name: "Unrelated private art", imageUrl: null };
    const result = project(q);
    assert.equal(result.art[`?revealed:${first.seq}`].name, "Originally shown");
    assert.equal(result.art[`?revealed:${second.seq - 1}`].name, "Later identity");
    assert.notEqual(result.list[2].t === "move" && result.list[2].card, result.list[3].t === "move" && result.list[3].card);
    assert.equal(result.list[4].t === "draw" && result.list[4].card, "?");
    assert.ok(!JSON.stringify(result).includes("Unrelated private art"));
    assert.deepEqual(first.revealedMoves![first.seq].art, originalFace, "append never mutates earlier receipt");
    cases++;
    for (const mutate of [
        (b: Beats) => { delete b.revealedMoves; },
        (b: Beats) => { b.revealedMoves![first.seq].card = other; },
        (b: Beats) => { b.revealedMoves![first.seq].n++; },
        (b: Beats) => { b.revealedMoves![first.seq].from = "drop"; },
        (b: Beats) => { b.revealedMoves![first.seq].to = "deck"; },
        (b: Beats) => { b.revealedMoves![first.seq].owner = q; },
        (b: Beats) => { b.revealedMoves![first.seq].art = null as never; },
    ]) {
        const bad = clone(first); mutate(bad);
        bad.art[id] = { cardId: "B", name: "Later shared art must not authorize reveal", imageUrl: null };
        const hidden = project(q, bad);
        assert.equal(hidden.list[0].t === "move" && hidden.list[0].card, "?");
        assert.ok(!Object.keys(hidden.art).length);
        assert.ok(!("revealedMoves" in hidden)); cases++;
    }
    const duplicate = clone(first);
    duplicate.list.push(clone(duplicate.list[0]));
    const maskedDuplicate = project(q, duplicate);
    assert.ok(maskedDuplicate.list.every(b => b.t === "move" && b.card === "?"));
    assert.deepEqual(maskedDuplicate.art, {}); cases++;
    const appendedDuplicate = appendBeats(first, clone(first));
    assert.equal(appendedDuplicate.revealedMoves, undefined);
    assert.ok(project(q, appendedDuplicate).list.every(b => b.t === "move" && b.card === "?")); cases++;
    const notRevealed = RULES.toBeats(ctx, state, [{ ...reveal(), reveal: undefined } as GameEvent]);
    assert.equal(notRevealed.revealedMoves, undefined);
    const privateOrder = RULES.toBeats(ctx, state, [{ ...reveal(), privateOrder: true } as GameEvent]);
    assert.equal(privateOrder.list.length, 0); assert.equal(privateOrder.revealedMoves, undefined); cases++;
    const tail: Beats = { seq: history.seq + BEAT_CAP, list: Array.from({ length: BEAT_CAP }, (_, i) => ({ t: "phase", phase: "main", player: p, turn: 1, n: history.seq + i + 1 })), art: {} };
    const capped = appendBeats(history, tail);
    assert.equal(capped.revealedMoves, undefined); assert.equal(capped.list.length, BEAT_CAP); cases++;
}
console.log(`${cases} public move receipt/projection cases`);

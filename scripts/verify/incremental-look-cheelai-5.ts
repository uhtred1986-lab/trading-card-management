/** R530: whole-source Cheelai admission and native filtered reveal/privacy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { requireInspectionPrompt, requireIncrementalLook, captureLookSource } from "../../src/lib/arena/vm/incremental-look";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import { clone, game, fresh as gohanFresh, begin as gohanBegin, tap as gohanTap, type Fixture } from "./incremental-look-harness-5";
import type { Action, CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const source = JSON.parse(fs.readFileSync(new URL("./fixtures/incremental-look-cheelai-5.json", import.meta.url), "utf8"));
const raw = source.card;
const defs: Record<string, CardDef> = {
    L: card("L", { type: "LEADER", skill: null }),
    F: card("F", { colors: ["Blue"], skill: null }),
    B: card("EX24-13", { name: raw.name, type: raw.type, colors: raw.colors, energyCost: Number(raw.cost), specifiedCost: {}, power: raw.power, characters: raw.characters, traits: raw.traits, skill: raw.skill }),
};
defs[defs.B.id] = defs.B;
delete defs.B;
for (let i = 0; i < 50; i++) defs[`M${i}`] = card(`M${i}`, { name: `Cheelai private card ${i}`, type: i === 1 ? "EXTRA" : "BATTLE", traits: i === 4 ? ["Power Wishful"] : ["Frieza’s Army", "Power Wish"], skill: null });
const rows = Object.values(defs).flatMap(skillRecords);
assert.equal(raw.backSkill, null);
const expected = clone(Object.values(source.allRecords)) as ReturnType<typeof skillRecords>;
assert.equal(expected.length, 2, "complete Auto plus unchanged Main record, no back");
assert.equal(expected[0].ops[0].op, "look");
expected[0].ops[0] = { ...expected[0].ops[0], upTo: true } as typeof expected[0]["ops"][number];
expected[0].reads = expected[0].reads.replace("look at the top 5", "look at up to 5 cards from the top of your deck");
assert.deepEqual(clone(rows.filter(r => r.cardId === "EX24-13")), expected, "exactly optional flag and narration differ");
const ctx = { defs, scripts: rulesFromRows(rows.map((r, id) => ({ ...r, id, status: "confirmed", source: "compiler" }) as RuleRow), defs) };
function fresh(p: PlayerId): Fixture {
    const q = p === "p1" ? "p2" : "p1";
    const f: Fixture = { ctx, p, q, source: "", top: [], events: [], state: RULES.createGame(ctx, { seed: 530, p1: { name: "One", leader: "L", main: Array(50).fill("F") }, p2: { name: "Two", leader: "L", main: Array(50).fill("F") } }).state as VmState, take: () => {} };
    f.take = action => {
        const saved = clone(f.state), before = JSON.stringify(saved), result = RULES.apply(ctx, saved, action);
        assert.deepEqual(RULES.apply(ctx, clone(saved), action), result, "saved replay");
        assert.equal(JSON.stringify(saved), before, "input purity");
        f.state = result.state as VmState;
        f.events.push(...result.events);
        assert.equal(f.state.outcome, undefined);
    };
    for (const a of [{ type: "chooseFirst", player: f.state.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: q, redraw: false }, { type: "charge", player: p, card: null }] as Action[]) f.take(a);
    // Fixture setup supplies the complete source and one non-Black (Blue) energy. Payment,
    // play, counter windows and the original Auto are native thereafter.
    f.source = f.state.sides[p].zones.hand[0]; f.state.cards[f.source].cardId = "EX24-13";
    const energy = f.state.sides[p].zones.deck.at(-1)!;
    moveCard(f.state, game, energy, "energy", { owner: p }); f.state.cards[energy].mode = "active";
    f.top = [...f.state.sides[p].zones.deck];
    f.top.forEach((id, i) => { f.state.cards[id].cardId = `M${i}`; });
    return f;
}
function begin(f: Fixture) {
    const play = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "play" && a.card === f.source);
    assert.ok(play); f.take(play);
    for (let i = 0; i < 20 && !(f.state.prompt.kind === "chooseMode" && f.state.prompt.inspection); i++) {
        const pass = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "counter" && a.card === null);
        assert.ok(pass); f.take(pass);
    }
    assert.equal(f.state.prompt.kind, "chooseMode");
    assert.equal(f.state.sides[f.p].zones.hand.length, 5, "play does not trigger Hand-only Main draw");
    assert.equal(f.state.sides[f.p].zones.energy.length, 1);
    assert.deepEqual(ctx.defs[f.state.cards[f.state.sides[f.p].zones.energy[0]].cardId].colors, ["Blue"]);
    assert.equal(f.state.cards[f.state.sides[f.p].zones.energy[0]].mode, "rest");
}
const tap = (f: Fixture, index: number) => f.take({ type: "chooseMode", player: f.p, index });
function snapshot(f: Fixture, viewer: PlayerId, events: GameEvent[] = []) {
    return buildSnapshot({ id: 530, revision: 1, mode: "hotseat", status: "playing", p1Name: "One", p2Name: "Two", ctx, state: f.state, legal: RULES.legalActions(ctx, f.state), log: [], beats: events.length ? RULES.toBeats(ctx, f.state, events) : null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
let cases = 0;
const disclosureFailures: string[] = [];
for (const p of ["p1", "p2"] as const) for (const n of [0, 1, 5]) for (const pick of [false, true]) {
    const f = fresh(p); begin(f);
    const deck = [...f.state.sides[p].zones.deck], rng = f.state.rngState;
    for (let i = 0; i <= n; i++) {
        assert.deepEqual(RULES.boardView(ctx, f.state, p, {}).prompt.inspection?.cards.map(c => c.id), f.top.slice(0, i));
        assert.deepEqual(f.state.sides[p].zones.deck, deck); assert.equal(f.state.rngState, rng);
        const opposing = JSON.stringify(snapshot(f, f.q));
        assert.ok(!opposing.includes("Cheelai private card"));
        for (const id of f.top) assert.ok(!opposing.includes(JSON.stringify(id)));
        if (i === 5) assert.ok(JSON.stringify(snapshot(f, p)).includes("Cheelai private card 4"), "final nonmatch shown");
        if (i < n) {
            const start = f.events.length; tap(f, 0);
            const events = f.events.slice(start);
            assert.ok(!JSON.stringify(snapshot(f, f.q, events)).includes("Cheelai private card"));
            for (const id of f.top) assert.ok(!JSON.stringify(events).includes(JSON.stringify(id)));
        }
    }
    tap(f, n === 5 ? 0 : 1);
    const start = f.events.length;
    if (n) f.take({ type: "choose", player: p, cards: pick ? [f.top[0]] : [] });
    assert.equal(f.state.prompt.kind, "main"); assert.notEqual(f.state.rngState, rng);
    assert.equal(f.state.sides[p].zones.hand.includes(f.top[0]), pick && n > 0);
    const projected = JSON.stringify(snapshot(f, f.q, f.events.slice(start)));
    for (const id of f.top) assert.ok(!projected.includes(JSON.stringify(id)), "no hidden physical ID in public reveal projection");
    if (pick && n && !projected.includes("Cheelai private card 0")) disclosureFailures.push(`${p} stop${n}: selected Power Wish masked in opponent beats`);
    for (let i = 1; i < 7; i++) assert.ok(!projected.includes(`Cheelai private card ${i}`), "other prefix and unseen cards remain private");
    cases++;
}

for (const p of ["p1", "p2"] as const) {
    // Matching second card, or no matches: actual full-source native play.
    for (const matches of [true, false]) {
        const f = fresh(p);
        f.state.cards[f.top[0]].cardId = "M4";
        if (!matches) for (const id of f.top.slice(0, 5)) f.state.cards[id].cardId = "M4";
        begin(f); for (let i = 0; i < 6; i++) tap(f, 0);
        if (matches) {
            assert.equal(f.state.prompt.kind, "chooseCards");
            if (f.state.prompt.kind === "chooseCards") assert.deepEqual(f.state.prompt.choice.candidates, [f.top[1], f.top[2], f.top[3]]);
            f.take({ type: "choose", player: p, cards: [f.top[1]] });
            assert.ok(f.state.sides[p].zones.hand.includes(f.top[1]));
        }
        assert.equal(f.state.prompt.kind, "main"); cases++;
    }
    const f = fresh(p); begin(f); for (let i = 0; i < 6; i++) tap(f, 0);
    for (const forged of [f.top[4], f.top[5]]) {
        const saved = clone(f.state);
        assert.equal(saved.prompt.kind, "chooseCards");
        if (saved.prompt.kind === "chooseCards") saved.prompt.choice.candidates.push(forged);
        const before = JSON.stringify(saved);
        assert.throws(() => requireInspectionPrompt(ctx, game, saved), /R527|rebuild/);
        assert.equal(JSON.stringify(saved), before); cases++;
    }
    for (const wrong of [f.top[4], f.top[5]]) {
        const saved = clone(f.state), before = JSON.stringify(saved);
        assert.throws(() => RULES.apply(ctx, saved, { type: "choose", player: p, cards: [wrong] }), /invalid choice/);
        assert.equal(JSON.stringify(saved), before); cases++;
    }
    // Receipt persistence contract: start from the actual native played Auto,
    // then perform a zone departure through the movement primitive while the
    // inspection is saved. This is not an additional legal user action during
    // the inspection prompt, which exclusively owns the next decision.
    const departed = fresh(p); begin(departed); tap(departed, 0);
    moveCard(departed.state, game, departed.source, "drop", { owner: p });
    departed.state = clone(departed.state);
    requireInspectionPrompt(ctx, game, departed.state);
    const corrupt = clone(departed.state);
    delete corrupt.programs.find(frame => frame.lookExecution)!.lookExecution;
    assert.throws(() => requireInspectionPrompt(ctx, game, corrupt), /R527|rebuild/);
    tap(departed, 1); departed.take({ type: "choose", player: p, cards: [departed.top[0]] });
    assert.ok(departed.state.sides[p].zones.hand.includes(departed.top[0])); cases++;
}
for (const [before, after] of [["up to 5", "up to 4"], ["Power Wish", "Saiyan"], ["shuffle your deck", "draw 1 card"]]) {
    const changed = { ...defs["EX24-13"], skill: raw.skill.replace(before, after) };
    for (const record of skillRecords(changed)) for (const op of record.ops) if (op.op === "look") assert.equal(op.upTo, undefined);
    cases++;
}
function gain(f: Fixture, target: string, traits: string[], characters: string[] = []) {
    addEffect(f.state, [], { source: f.source, target, master: f.p, kind: "gains", value: { traits, characters, colors: [], names: [] }, until: "turn" });
}
for (const p of ["p1", "p2"] as const) {
    const f = fresh(p); begin(f); for (let i = 0; i < 5; i++) tap(f, 0);
    gain(f, f.top[4], ["Power Wish"]);
    const before = JSON.stringify(f.state), rng = f.state.rngState, zones = clone(f.state.sides);
    const result = RULES.apply(ctx, f.state, { type: "chooseMode", player: p, index: 0 });
    assert.equal(JSON.stringify(f.state), before);
    assert.equal(result.state.outcome?.kind, "interrupted");
    assert.notEqual(result.state.prompt.kind, "chooseCards", "changed eligibility never publishes a chooser");
    assert.deepEqual(result.state.sides, zones); assert.equal((result.state as VmState).rngState, rng);
    assert.ok(!result.events.some(e => e.type === "move" || e.type === "draw" || e.type === "note" && /shuffle/.test(e.text)));
    const terminal = { ...f, state: clone(result.state) as VmState };
    for (const viewer of [p, f.q]) {
        const board = RULES.boardView(ctx, terminal.state, viewer, {});
        assert.equal(board.prompt.kind, "gameOver"); assert.equal(board.prompt.inspection, undefined);
        const projected = snapshot(terminal, viewer, result.events);
        assert.equal(projected.view.prompt.kind, "gameOver");
        const text = JSON.stringify(projected);
        assert.ok(!text.includes("Cheelai private card"));
        for (const id of f.top) assert.ok(!text.includes(JSON.stringify(id)), "terminal projection retains prefix secrecy");
    }
    cases++;
    const saved = fresh(p); begin(saved); for (let i = 0; i < 6; i++) tap(saved, 0);
    gain(saved, saved.top[4], ["Power Wish"]);
    const frozen = JSON.stringify(saved.state);
    assert.throws(() => requireInspectionPrompt(ctx, game, saved.state), /changed private-card/);
    assert.throws(() => RULES.boardView(ctx, saved.state, p, {}), /changed private-card/);
    assert.throws(() => RULES.apply(ctx, saved.state, { type: "choose", player: p, cards: [saved.top[0]] }), /changed private-card/);
    assert.equal(JSON.stringify(saved.state), frozen);
    const preAsk = clone(saved.state), frame = preAsk.programs.find(f => f.incrementalLook)!;
    delete frame.awaiting;
    assert.throws(() => requireIncrementalLook(ctx, game, preAsk, frame), /changed private-card/);
    cases++;
    const same = fresh(p); begin(same); tap(same, 0);
    gain(same, same.top[0], ["Unrelated gained trait"]);
    tap(same, 1); same.take({ type: "choose", player: p, cards: [same.top[0]] });
    assert.ok(same.state.sides[p].zones.hand.includes(same.top[0])); cases++;
    const intact = fresh(p); begin(intact); tap(intact, 0);
    const changedCtx = clone(ctx); changedCtx.defs.M0.traits = [];
    assert.throws(() => requireInspectionPrompt(changedCtx, game, intact.state), /R527|rebuild/); cases++;
    for (const mutate of [
        (state: VmState) => { state.programs.find(f => f.incrementalLook)!.ops[0] = { op: "draw", n: 5 }; },
        (state: VmState) => { state.programs.find(f => f.incrementalLook)!.lookExecution!.source.cardId = "M0"; },
        (state: VmState) => { state.cards[intact.top[0]].zoneEpoch = (state.cards[intact.top[0]].zoneEpoch ?? 0) + 1; },
    ]) {
        const bad = clone(intact.state); mutate(bad);
        assert.throws(() => requireInspectionPrompt(ctx, game, bad), /R527|rebuild/); cases++;
    }
    const ordered = fresh(p); begin(ordered); for (let i = 0; i < 6; i++) tap(ordered, 0);
    if (ordered.state.prompt.kind === "chooseCards") ordered.state.prompt.choice.candidates.reverse();
    assert.throws(() => requireInspectionPrompt(ctx, game, ordered.state), /R527|rebuild/); cases++;
    // Regression: the existing character-only producer must also refuse before
    // publishing a newly gained match, not only when an answer is recorded.
    const g = gohanFresh(p); gohanBegin(g); for (let i = 0; i < 7; i++) gohanTap(g, 0);
    gain(g, g.top[6], [], ["Krillin"]);
    const stopped = RULES.apply(g.ctx, g.state, { type: "chooseMode", player: p, index: 0 });
    assert.equal(stopped.state.outcome?.kind, "interrupted"); assert.notEqual(stopped.state.prompt.kind, "chooseCards"); cases++;
}
const bounded = fresh("p1"), showing = skillsShowing(ctx, bounded.state, bounded.source), original = showing.scripts.bySkill[0], skill = showing.skills.find(s => s.index === 0)!;
// R534 admits one color plus one trait; two colors remains outside the reviewed shape.
for (const patch of [
    { characters: ["Cheelai: Br"] }, { traits: ["Power Wish", "Saiyan"] }, { traitsIncluding: ["Power"] },
    { notTraits: ["Saiyan"] }, { colors: ["Black", "Blue"] }, { anyOf: [{ ...emptyFilter(), traits: ["Power Wish"] }, { ...emptyFilter(), traits: ["Saiyan"] }] },
]) {
    const script = clone(original), op = script.ops[1]; assert.equal(op.op, "choose");
    if (op.op === "choose") op.sel.filter = { ...op.sel.filter!, ...patch } as typeof op.sel.filter;
    assert.throws(() => captureLookSource(ctx, bounded.state, bounded.source, "p1", skill, script), /historical identity filter/, JSON.stringify(patch)); cases++;
}
console.log(`${cases} Cheelai native admission/receipt cases; ${disclosureFailures.length} filtered projection failures`);
assert.deepEqual(disclosureFailures, [], "RM 3-1-7 requires selected Power Wish reveal in opponent projection");

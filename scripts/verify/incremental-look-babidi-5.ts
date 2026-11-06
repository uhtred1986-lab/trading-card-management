/** R529: whole-source Babidi admission and native FAQ reveal/privacy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { requireInspectionPrompt } from "../../src/lib/arena/vm/incremental-look";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import { clone, game, type Fixture } from "./incremental-look-harness-5";
import type { Action, CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const source = JSON.parse(fs.readFileSync(new URL("./fixtures/incremental-look-babidi-5.json", import.meta.url), "utf8"));
const raw = source.card;
const defs: Record<string, CardDef> = {
    L: card("L", { type: "LEADER", skill: null }),
    F: card("F", { colors: ["Blue"], skill: null }),
    B: card("BT3-045", { name: raw.name, type: raw.type, colors: raw.colors, energyCost: Number(raw.cost), specifiedCost: { Blue: 1 }, power: raw.power, characters: raw.characters, traits: raw.traits, skill: raw.skill }),
};
defs[defs.B.id] = defs.B;
delete defs.B;
for (let i = 0; i < 50; i++) defs[`M${i}`] = card(`M${i}`, { name: `Babidi private card ${i}`, characters: i === 2 ? [] : ["Majin Buu"], skill: null });
const rows = Object.values(defs).flatMap(skillRecords);
const expected = clone(Object.values(source.allRecords)) as ReturnType<typeof skillRecords>;
assert.equal(expected.length, 1, "complete card has no siblings or back");
assert.equal(expected[0].ops[0].op, "look");
expected[0].ops[0] = { ...expected[0].ops[0], upTo: true } as typeof expected[0]["ops"][number];
expected[0].reads = expected[0].reads.replace("look at the top 3", "look at up to 3 cards from the top of your deck");
assert.deepEqual(clone(rows.filter(r => r.cardId === "BT3-045")), expected, "exactly optional flag and narration differ");
const ctx = { defs, scripts: rulesFromRows(rows.map((r, id) => ({ ...r, id, status: "confirmed", source: "compiler" }) as RuleRow), defs) };
function fresh(p: PlayerId): Fixture {
    const q = p === "p1" ? "p2" : "p1";
    const f: Fixture = { ctx, p, q, source: "", top: [], events: [], state: RULES.createGame(ctx, { seed: 529, p1: { name: "One", leader: "L", main: Array(50).fill("F") }, p2: { name: "Two", leader: "L", main: Array(50).fill("F") } }).state as VmState, take: () => {} };
    f.take = action => {
        const saved = clone(f.state), before = JSON.stringify(saved), result = RULES.apply(ctx, saved, action);
        assert.deepEqual(RULES.apply(ctx, clone(saved), action), result, "saved replay");
        assert.equal(JSON.stringify(saved), before, "input purity");
        f.state = result.state as VmState;
        f.events.push(...result.events);
        assert.equal(f.state.outcome, undefined);
    };
    for (const a of [{ type: "chooseFirst", player: f.state.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: q, redraw: false }, { type: "charge", player: p, card: null }] as Action[]) f.take(a);
    // Fixture setup supplies the complete source and one Blue energy. Payment,
    // play, counter windows and the original Auto are native thereafter.
    f.source = f.state.sides[p].zones.hand[0]; f.state.cards[f.source].cardId = "BT3-045";
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
    assert.equal(f.state.sides[f.p].zones.energy.length, 1);
    assert.deepEqual(ctx.defs[f.state.cards[f.state.sides[f.p].zones.energy[0]].cardId].colors, ["Blue"]);
    assert.equal(f.state.cards[f.state.sides[f.p].zones.energy[0]].mode, "rest");
}
const tap = (f: Fixture, index: number) => f.take({ type: "chooseMode", player: f.p, index });
function snapshot(f: Fixture, viewer: PlayerId, events: GameEvent[] = []) {
    return buildSnapshot({ id: 529, revision: 1, mode: "hotseat", status: "playing", p1Name: "One", p2Name: "Two", ctx, state: f.state, legal: RULES.legalActions(ctx, f.state), log: [], beats: events.length ? RULES.toBeats(ctx, f.state, events) : null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
let cases = 0;
const faqFailures: string[] = [];
for (const p of ["p1", "p2"] as const) for (const n of [0, 1, 3]) for (const pick of [false, true]) {
    const f = fresh(p); begin(f);
    const deck = [...f.state.sides[p].zones.deck], rng = f.state.rngState;
    for (let i = 0; i <= n; i++) {
        assert.deepEqual(RULES.boardView(ctx, f.state, p, {}).prompt.inspection?.cards.map(c => c.id), f.top.slice(0, i));
        assert.deepEqual(f.state.sides[p].zones.deck, deck); assert.equal(f.state.rngState, rng);
        assert.ok(!JSON.stringify(snapshot(f, f.q)).includes("Babidi private card"));
        if (i === 3) assert.ok(JSON.stringify(snapshot(f, p)).includes("Babidi private card 2"), "final nonmatch shown");
        if (i < n) {
            const start = f.events.length; tap(f, 0);
            const events = f.events.slice(start);
            assert.ok(!JSON.stringify(snapshot(f, f.q, events)).includes("Babidi private card"));
            for (const id of f.top) assert.ok(!JSON.stringify(events).includes(JSON.stringify(id)));
        }
    }
    tap(f, n === 3 ? 0 : 1);
    const start = f.events.length;
    if (n) f.take({ type: "choose", player: p, cards: pick ? [f.top[0]] : [] });
    assert.equal(f.state.prompt.kind, "main"); assert.notEqual(f.state.rngState, rng);
    assert.equal(f.state.sides[p].zones.hand.includes(f.top[0]), pick && n > 0);
    const projected = JSON.stringify(snapshot(f, f.q, f.events.slice(start)));
    if (pick && n && !projected.includes("Babidi private card 0")) faqFailures.push(`${p} stop${n}: selected Majin Buu masked in opponent beats`);
    for (let i = 1; i < 5; i++) assert.ok(!projected.includes(`Babidi private card ${i}`), "other prefix and unseen cards remain private");
    cases++;
}

for (const p of ["p1", "p2"] as const) {
    // Matching second card, or no matches: actual full-source native play.
    for (const matches of [true, false]) {
        const f = fresh(p);
        f.state.cards[f.top[0]].cardId = "M2";
        if (!matches) f.state.cards[f.top[1]].cardId = "M2";
        begin(f); tap(f, 0); tap(f, 0); tap(f, 0); tap(f, 0);
        if (matches) {
            assert.equal(f.state.prompt.kind, "chooseCards");
            if (f.state.prompt.kind === "chooseCards") assert.deepEqual(f.state.prompt.choice.candidates, [f.top[1]]);
            f.take({ type: "choose", player: p, cards: [f.top[1]] });
            assert.ok(f.state.sides[p].zones.hand.includes(f.top[1]));
        }
        assert.equal(f.state.prompt.kind, "main"); cases++;
    }
    const f = fresh(p); begin(f); tap(f, 0); tap(f, 0); tap(f, 0); tap(f, 0);
    for (const forged of [f.top[2], f.top[3]]) {
        const saved = clone(f.state);
        assert.equal(saved.prompt.kind, "chooseCards");
        if (saved.prompt.kind === "chooseCards") saved.prompt.choice.candidates.push(forged);
        const before = JSON.stringify(saved);
        assert.throws(() => requireInspectionPrompt(ctx, game, saved), /R527|rebuild/);
        assert.equal(JSON.stringify(saved), before); cases++;
    }
    for (const wrong of [f.top[2], f.top[3]]) {
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
for (const [before, after] of [["up to 3", "up to 4"], ["Majin Buu", "Krillin"], ["shuffle your deck", "draw 1 card"]]) {
    const changed = { ...defs["BT3-045"], skill: raw.skill.replace(before, after) };
    for (const record of skillRecords(changed)) for (const op of record.ops) if (op.op === "look") assert.equal(op.upTo, undefined);
    cases++;
}
console.log(`${cases} Babidi native admission/receipt cases; ${faqFailures.length} FAQ projection failures`);
assert.deepEqual(faqFailures, [], "official FAQ requires selected Majin Buu reveal in opponent projection");

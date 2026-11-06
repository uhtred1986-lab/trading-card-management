/** R531: fourteen exact original ordinary played Autos, no runtime extension. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { describeScript } from "../../src/lib/arena/vm/script";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { requireInspectionPrompt } from "../../src/lib/arena/vm/incremental-look";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import { clone, game, type Fixture } from "./incremental-look-harness-5";
import type { Action, CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
type SourceCard = { id: string; name: string; type: CardDef["type"]; colors: CardDef["colors"]; cost: string; power: number; characters: string[]; traits: string[]; skill: string | null; backName: string | null; backSkill: string | null };
type Source = { card: SourceCard; candidateKeys: string[]; allRecords: Record<string, ReturnType<typeof skillRecords>[number]>; matchingCards: SourceCard[] };
const sources: Record<string, Source> = JSON.parse(fs.readFileSync(new URL("./fixtures/incremental-look-played-5.json", import.meta.url), "utf8"));
assert.equal(Object.keys(sources).length, 14);
assert.equal(sources["BT8-061"], undefined, "Bio-Man awaits source identity spacing review");
assert.equal(sources["BT4-089"], undefined, "Chi-Chi awaits separate Earthling source correction review");
const toDef = (c: SourceCard, sourcePrice = false) => card(c.id, { name: c.name, type: c.type, colors: c.colors, energyCost: Number(c.cost), specifiedCost: !sourcePrice || c.colors[0] === "Black" ? {} : { [c.colors[0]]: 1 }, power: c.power, characters: c.characters, traits: c.traits, skill: c.skill });
let cases = 0;
const perCard: Record<string, number> = {};
for (const [id, source] of Object.entries(sources)) {
    const startCases = cases, raw = source.card, original = source.allRecords[source.candidateKeys[0]], first = original.ops[0];
    assert.equal(first.op, "look"); if (first.op !== "look") throw Error("look required");
    assert.equal(typeof first.n, "number");
    const maximum = Number(first.n), index = original.skillIndex;
    const filterOp = original.ops[1]; assert.equal(filterOp.op, "choose"); if (filterOp.op !== "choose") throw Error("choose required");
    const filter = filterOp.sel.filter!, traits = filter.traits.length > 0;
    const defs: Record<string, CardDef> = {
        L: card("L", { type: "LEADER", skill: null }),
        F: card("F", { colors: [raw.colors[0] === "Black" ? "Blue" : raw.colors[0]], skill: null }),
        [id]: toDef(raw, true),
    };
    for (const match of source.matchingCards) defs[match.id] = toDef(match);
    // Synthetic negative definitions are explicitly mechanism controls; matching
    // native branches below use complete unmodified catalog target definitions.
    for (let i = 0; i < 50; i++) defs[`N${i}`] = card(`N${i}`, { name: `${id} private nonmatch ${i}`, characters: [], traits: [], skill: null });
    defs.SIMILAR = card("SIMILAR", { name: `${id} similar identity control`, traits: traits ? [`${filter.traits[0]}ish`] : [], characters: traits ? [] : [`${filter.characters[0]}ish`], skill: null });
    defs.CASE = card("CASE", { name: `${id} case normalization control`, type: traits ? "EXTRA" : "BATTLE", traits: traits ? [filter.traits[0].toUpperCase()] : [], characters: traits ? [] : [filter.characters[0].toUpperCase()], skill: null });
    const rows = Object.values(defs).flatMap(skillRecords), expected = clone(Object.values(source.allRecords));
    const changed = expected.find(r => r.skillIndex === index)!;
    changed.ops[0] = { ...changed.ops[0], upTo: true } as typeof changed.ops[number];
    changed.reads = describeScript(changed.ops);
    assert.deepEqual(clone(rows.filter(r => r.cardId === id)), expected, `${id}: whole rows differ only in optional look and narration; all siblings preserved`);
    assert.equal(raw.backName, null); assert.equal(raw.backSkill, null);
    const ctx = { defs, scripts: rulesFromRows(rows.map((r, n) => ({ ...r, id: n, status: r.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
    function fresh(p: PlayerId, size = 30): Fixture {
        const q = p === "p1" ? "p2" : "p1";
        const f: Fixture = { ctx, p, q, source: "", top: [], events: [], state: RULES.createGame(ctx, { seed: 531, p1: { name: "One", leader: "L", main: Array(50).fill("F") }, p2: { name: "Two", leader: "L", main: Array(50).fill("F") } }).state as VmState, take: () => {} };
        f.take = action => {
            const saved = clone(f.state), before = JSON.stringify(saved), result = RULES.apply(ctx, saved, action);
            assert.deepEqual(RULES.apply(ctx, clone(saved), action), result, "JSON replay");
            assert.equal(JSON.stringify(saved), before, "input purity");
            f.state = result.state as VmState; f.events.push(...result.events);
            assert.equal(f.state.outcome, undefined, JSON.stringify(f.state.outcome));
        };
        for (const a of [{ type: "chooseFirst", player: f.state.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: q, redraw: false }, { type: "charge", player: p, card: null }] as Action[]) f.take(a);
        // Explicit fixture setup: stage actual source definition in Hand, printed
        // energy resources and ordered Deck. Play/payment/pending Auto are native.
        f.source = f.state.sides[p].zones.hand[0]; f.state.cards[f.source].cardId = id;
        for (let i = 0; i < Number(raw.cost); i++) {
            const energy = f.state.sides[p].zones.deck.at(-1)!;
            moveCard(f.state, game, energy, "energy", { owner: p }); f.state.cards[energy].mode = "active";
        }
        while (f.state.sides[p].zones.deck.length > size) moveCard(f.state, game, f.state.sides[p].zones.deck.at(-1)!, "warp", { owner: p });
        f.top = [...f.state.sides[p].zones.deck];
        f.top.forEach((iid, i) => { f.state.cards[iid].cardId = `N${i}`; });
        source.matchingCards.forEach((c, i) => { if (f.top[i]) f.state.cards[f.top[i]].cardId = c.id; });
        return f;
    }
    function begin(f: Fixture) {
        const play = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "play" && a.card === f.source);
        assert.ok(play, `${id}: native paid play`); f.take(play);
        for (let i = 0; i < 20 && !(f.state.prompt.kind === "chooseMode" && f.state.prompt.inspection); i++) {
            const pass = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "counter" && a.card === null);
            assert.ok(pass, `${id}: original pending Auto reaches inspection`); f.take(pass);
        }
        assert.equal(f.state.prompt.kind, "chooseMode");
        const frame = f.state.programs.find(frame => frame.lookExecution)!;
        assert.ok(frame); assert.equal(frame.skillIndex, index); assert.equal(frame.lookExecution!.source.cardId, id);
        assert.deepEqual(clone(frame.lookExecution!.source.script.ops), changed.ops, "original compiled Auto, no test op insertion");
        assert.equal(frame.lookExecution!.source.skill.cost, "");
        assert.equal(f.state.sides[f.p].zones.energy.length, Number(raw.cost));
        for (const payer of f.state.sides[f.p].zones.energy) {
            assert.equal(f.state.cards[payer].mode, "rest", "actual printed cost exhausted");
            assert.deepEqual(defs[f.state.cards[payer].cardId].colors, [raw.colors[0] === "Black" ? "Blue" : raw.colors[0]]);
        }
        if (id === "BT12-072") {
            assert.ok(f.state.programs.every(frame => frame.card !== f.source || frame.skillIndex !== 10), "Daiz replacement not running during ordinary play");
            assert.ok(!JSON.stringify(f.state.pending).includes('"skillIndex":10'), "Daiz replacement not pending");
        }
    }
    const tap = (f: Fixture, n: number) => f.take({ type: "chooseMode", player: f.p, index: n });
    const snap = (f: Fixture, viewer: PlayerId, events: GameEvent[] = []) => buildSnapshot({ id: 531, revision: 1, mode: "hotseat", status: "playing", p1Name: "One", p2Name: "Two", ctx, state: f.state, legal: RULES.legalActions(ctx, f.state), log: [], beats: events.length ? RULES.toBeats(ctx, f.state, events) : null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
    function privatePrefix(f: Fixture, count: number, events: GameEvent[] = []) {
        assert.deepEqual(RULES.boardView(ctx, f.state, f.p, {}).prompt.inspection?.cards.map(c => c.id), f.top.slice(0, count));
        assert.equal(RULES.boardView(ctx, f.state, f.q, {}).prompt.inspection, undefined);
        const opponent = JSON.stringify(snap(f, f.q, events)), own = JSON.stringify(snap(f, f.p, events));
        for (const iid of f.top) {
            assert.ok(!opponent.includes(JSON.stringify(iid)), "no raw Deck occurrence in opponent Snapshot");
            assert.ok(!JSON.stringify(events).includes(JSON.stringify(iid)), "no public inspection event occurrence");
            assert.ok(!opponent.includes(JSON.stringify(defs[f.state.cards[iid].cardId].name)), "no private face in opponent Snapshot/beats");
            assert.ok(!JSON.stringify(events).includes(JSON.stringify(defs[f.state.cards[iid].cardId].name)), "no private face in inspection events");
        }
        for (const iid of f.top.slice(0, count)) assert.ok(own.includes(JSON.stringify(defs[f.state.cards[iid].cardId].name)));
        for (const iid of f.top.slice(count)) assert.ok(!own.includes(JSON.stringify(defs[f.state.cards[iid].cardId].name)), "own Snapshot never shows uninspected faces");
    }
    function finish(f: Fixture, chosen: string | undefined, rng: number, start: number) {
        assert.equal(f.state.prompt.kind, "main");
        if (f.state.sides[f.p].zones.deck.length > 1) assert.notEqual(f.state.rngState, rng, "shuffle after every stop/choice");
        assert.ok(f.events.slice(start).some(e => e.type === "note" && /shuffl/i.test(e.text)), "shuffle executes even if one remaining card consumes no RNG");
        const projected = JSON.stringify(snap(f, f.q, f.events.slice(start)));
        for (const iid of f.top) {
            assert.ok(!projected.includes(JSON.stringify(iid)), "selected public reveal never exposes physical Deck/Hand ID");
            const name = defs[f.state.cards[iid].cardId].name;
            assert.equal(projected.includes(JSON.stringify(name)), iid === chosen, "only selected filtered Hand face publicly revealed");
        }
        if (chosen) {
            assert.ok(f.state.sides[f.p].zones.hand.includes(chosen));
            assert.ok(JSON.stringify(snap(f, f.p)).includes(JSON.stringify(defs[f.state.cards[chosen].cardId].name)));
            assert.ok(!JSON.stringify(snap(f, f.q)).includes(JSON.stringify(defs[f.state.cards[chosen].cardId].name)), "opponent Hand hidden without event-scoped reveal");
            assert.ok(projected.includes("?revealed:"), "authenticated event-scoped public face");
        }
    }
    for (const p of ["p1", "p2"] as const) {
        for (const n of [0, 1, maximum]) for (const pick of [false, true]) {
            const f = fresh(p); begin(f);
            const deck = [...f.top], rng = f.state.rngState;
            for (let i = 0; i <= n; i++) {
                privatePrefix(f, i); assert.deepEqual(f.state.sides[p].zones.deck, deck); assert.equal(f.state.rngState, rng);
                if (i < n) { const before = f.events.length; tap(f, 0); privatePrefix(f, i + 1, f.events.slice(before)); }
            }
            if (n === maximum) assert.ok(JSON.stringify(snap(f, p)).includes(`${id} private nonmatch ${maximum - 1}`), "final nonmatch shown before Continue");
            const start = f.events.length; tap(f, n === maximum ? 0 : 1);
            if (n) {
                assert.equal(f.state.prompt.kind, "chooseCards");
                if (f.state.prompt.kind === "chooseCards") assert.deepEqual(f.state.prompt.choice.candidates, f.top.slice(0, Math.min(n, source.matchingCards.length)));
                f.take({ type: "choose", player: p, cards: pick ? [f.top[0]] : [] });
            }
            finish(f, pick && n ? f.top[0] : undefined, rng, start); cases++;
        }
        for (const size of [2]) {
            const f = fresh(p, size); if (size) f.state.cards[f.top[1]].cardId = "N1";
            begin(f); const rng = f.state.rngState, start = f.events.length;
            for (let i = 0; i < size; i++) { tap(f, 0); privatePrefix(f, i + 1); }
            tap(f, 0); if (size) f.take({ type: "choose", player: p, cards: [f.top[0]] });
            finish(f, size ? f.top[0] : undefined, rng, start); cases++;
        }
        const empty = fresh(p, 0), emptyBefore = JSON.stringify(empty.state);
        const emptyPlay = RULES.legalActions(ctx, empty.state).map(x => x.action).find(a => a.type === "play" && a.card === empty.source)!;
        assert.ok(emptyPlay);
        const lost = RULES.apply(ctx, empty.state, emptyPlay);
        assert.deepEqual(RULES.apply(ctx, clone(empty.state), emptyPlay), lost);
        assert.equal(JSON.stringify(empty.state), emptyBefore);
        assert.equal(lost.state.outcome?.kind, "win");
        assert.match(lost.state.outcome?.reason ?? "", /no cards.*Deck Area/);
        assert.equal(lost.state.prompt.kind, "gameOver"); cases++;
        const rejected = fresh(p); begin(rejected); for (let i = 0; i <= maximum; i++) tap(rejected, 0);
        for (const wrong of [rejected.top[maximum - 1], rejected.top[maximum]]) {
            const saved = clone(rejected.state), before = JSON.stringify(saved);
            assert.throws(() => RULES.apply(ctx, saved, { type: "choose", player: p, cards: [wrong] }), /invalid choice/);
            assert.equal(JSON.stringify(saved), before);
            if (saved.prompt.kind === "chooseCards") saved.prompt.choice.candidates.push(wrong);
            assert.throws(() => requireInspectionPrompt(ctx, game, saved), /R527|rebuild/); cases++;
        }
        // Saved receipt primitive control, not a concurrent legal player action.
        const departed = fresh(p); begin(departed); tap(departed, 0);
        moveCard(departed.state, game, departed.source, "drop", { owner: p }); departed.state = clone(departed.state);
        requireInspectionPrompt(ctx, game, departed.state); tap(departed, 1);
        departed.take({ type: "choose", player: p, cards: [departed.top[0]] });
        assert.ok(departed.state.sides[p].zones.hand.includes(departed.top[0])); cases++;
        // Synthetic identity contract: whole match/case and nonmatching suffix;
        // traits also demonstrate no invented Battle-only restriction.
        const normalized = fresh(p); normalized.state.cards[normalized.top[0]].cardId = "CASE"; normalized.state.cards[normalized.top[1]].cardId = "SIMILAR";
        begin(normalized); tap(normalized, 0); tap(normalized, 0); tap(normalized, 1);
        assert.equal(normalized.state.prompt.kind, "chooseCards");
        if (normalized.state.prompt.kind === "chooseCards") assert.deepEqual(normalized.state.prompt.choice.candidates, [normalized.top[0]]);
        normalized.take({ type: "choose", player: p, cards: [normalized.top[0]] }); cases++;
        if (!traits) {
            const alternate = fresh(p); begin(alternate); tap(alternate, 0); tap(alternate, 0); tap(alternate, 1);
            assert.throws(() => RULES.apply(ctx, clone(alternate.state), { type: "choose", player: p, cards: alternate.top.slice(0, 2) }), /choose at most 1/);
            const rng = alternate.state.rngState, start = alternate.events.length;
            alternate.take({ type: "choose", player: p, cards: [alternate.top[1]] });
            finish(alternate, alternate.top[1], rng, start); cases++;
        }
    }
    for (const [before, after] of [[`up to ${maximum}`, `up to ${maximum + 1}`], [traits ? filter.traits[0] : filter.characters[0], "Unreviewed Identity"], ["shuffle your deck", "draw 1 card"]]) {
        const boundary = raw.skill!.toLowerCase().lastIndexOf("look at");
        const changedRaw = raw.skill!.slice(0, boundary) + raw.skill!.slice(boundary).replace(new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), after);
        assert.notEqual(changedRaw, raw.skill);
        for (const row of skillRecords({ ...defs[id], skill: changedRaw })) for (const op of row.ops) if (op.op === "look") assert.equal(op.upTo, undefined);
        cases++;
    }
    const attacks = raw.skill!.replace(/When (?:you play this card|this card is played),/, "When this card attacks,");
    assert.notEqual(attacks, raw.skill, "producer near-match changes the reviewed Auto");
    for (const row of skillRecords({ ...defs[id], skill: attacks })) for (const op of row.ops) if (op.op === "look") assert.equal(op.upTo, undefined, "attack producer is not admitted");
    cases++;
    perCard[id] = cases - startCases;
}
console.log(`${cases} R531 ordinary-play inspection cases across ${Object.keys(sources).length} exact cards: ${JSON.stringify(perCard)}`);

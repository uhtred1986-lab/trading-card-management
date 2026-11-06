/** R533: six exact original ordinary attack Autos, no runtime extension. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { card } from "./harness";
import { correctCardFields, correctSkillText } from "../../src/lib/catalog/errata";
import { parseDeckBuilding, matchesCardFilter } from "../../src/lib/decks/cardRules";
import { skillRecords } from "../../src/lib/arena/draft";
import { describeScript } from "../../src/lib/arena/vm/script";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { IllegalAction } from "../../src/lib/arena/vm/illegal-action";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { requireInspectionPrompt } from "../../src/lib/arena/vm/incremental-look";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import { clone, game, type Fixture } from "./incremental-look-harness-5";
import type { Action, CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
type SourceCard = {
    id: string;
    name: string;
    type: CardDef["type"];
    colors: CardDef["colors"];
    cost: string | null;
    power: number | null;
    characters: string[];
    traits: string[];
    skill: string | null;
    backName: string | null;
    backSkill: string | null;
};
type Source = {
    card: SourceCard;
    candidateKeys: string[];
    allRecords: Record<string, ReturnType<typeof skillRecords>[number]>;
    matchingCards: SourceCard[];
};
const fixture: {
    sources: Record<string, Source>;
    fillers: SourceCard[];
} = JSON.parse(fs.readFileSync(new URL("./fixtures/incremental-look-attacks-5.json", import.meta.url), "utf8"));
const { sources, fillers } = fixture;
assert.equal(Object.keys(sources).length, 6);
const toDef = (c: SourceCard) => {
    c = correctCardFields(c.id, c);
    return card(c.id, { name: c.name, type: c.type, colors: c.colors, energyCost: c.cost === null ? null : Number(c.cost), specifiedCost: c.id === "P-077" ? { Red: 2 } : {}, power: c.power, comboCost: c.type === "LEADER" || c.type === "EXTRA" ? null : 0, comboPower: c.type === "LEADER" || c.type === "EXTRA" ? null : 5000, characters: c.characters, traits: c.traits, skill: correctSkillText(c.id, c.skill), back: c.backName ? { name: c.backName, power: 15000, skill: correctSkillText(c.id, c.backSkill) } : null });
};
let cases = 0;
const perCard: Record<string, number> = {};
for (const [id, source] of Object.entries(sources)) {
    const only = process.argv.find(a => a.startsWith("--card="))?.slice(7);
    if (only && only !== id)
        continue;
    const startCases = cases, raw = source.card, original = source.allRecords[source.candidateKeys[0]], first = original.ops[0];
    assert.equal(first.op, "look");
    if (first.op !== "look")
        throw Error("look required");
    assert.equal(typeof first.n, "number");
    const maximum = Number(first.n), index = original.skillIndex;
    const filterOp = original.ops[1];
    assert.equal(filterOp.op, "choose");
    if (filterOp.op !== "choose")
        throw Error("choose required");
    const filter = filterOp.sel.filter!, traits = filter.traits.length > 0;
    const defs: Record<string, CardDef> = {
        L: card("L", { type: "LEADER", skill: null }),
        F: card("F", { type: "EXTRA", colors: ["Red"], skill: null }),
        BLUE: card("BLUE", { colors: ["Blue"], skill: null }),
        CANCEL: card("CANCEL", { type: "EXTRA", energyCost: 0, specifiedCost: {}, skill: "[Counter: Attack] Negate the attack." }),
        [id]: toDef(raw),
    };
    for (const match of source.matchingCards)
        defs[match.id] = toDef(match);
    // Synthetic negative definitions are explicitly mechanism controls; matching
    // native branches below use complete unmodified catalog target definitions.
    for (const filler of fillers)
        defs[filler.id] = toDef(filler);
    defs.SIMILAR = card("SIMILAR", { name: `${id} similar identity control`, traits: traits ? [`${filter.traits[0]}ish`] : [], characters: traits ? [] : [`${filter.characters[0]}ish`], skill: null });
    defs.CASE = card("CASE", { name: `${id} case normalization control`, type: traits ? "EXTRA" : "BATTLE", traits: traits ? [filter.traits[0].toUpperCase()] : [], characters: traits ? [] : [filter.characters[0].toUpperCase()], skill: null });
    const rows = Object.values(defs).flatMap(skillRecords), expected = clone(Object.values(source.allRecords));
    const changed = expected.find(r => r.skillIndex === index && r.side === original.side)!;
    changed.ops[0] = { ...changed.ops[0], upTo: true } as typeof changed.ops[number];
    changed.reads = describeScript(changed.ops);
    assert.deepEqual(clone(rows.filter(r => r.cardId === id)), expected, `${id}: whole rows differ only in optional look and narration; all siblings preserved`);
    if (raw.type === "LEADER") {
        assert.ok(defs[id].back);
        assert.equal(defs[id].back!.power, 15000);
        assert.equal(defs[id].energyCost, null);
    }
    if (id === "P-434") {
        const restriction = parseDeckBuilding(defs[id].skill).rules.find(r => r.kind === "exclude");
        assert.ok(restriction && restriction.kind === "exclude");
        for (const def of [defs.F, ...fillers.map(x => defs[x.id]), ...source.matchingCards.map(x => defs[x.id])])
            assert.ok(!restriction.filters.some(filter => matchesCardFilter({ ...def, cardType: def.type }, filter)), "Magenta filler/target obeys corrected Battle-only restriction");
        assert.match(defs[id].skill!, /non-≪Villainous≫ Battle Cards/);
        assert.ok(restriction.filters.some(filter => matchesCardFilter({ ...defs.F, cardType: "BATTLE" }, filter)), "non-Villainous Battle filler is forbidden");
    }
    const ctx = { defs, scripts: rulesFromRows(rows.map((r, n) => ({ ...r, id: n, status: r.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
    function fresh(p: PlayerId, size = 30): Fixture {
        const q = p === "p1" ? "p2" : "p1";
        const f: Fixture = { ctx, p, q, source: "", top: [], events: [], state: RULES.createGame(ctx, { seed: 533, p1: { name: "One", leader: p === "p1" && raw.type === "LEADER" ? id : "L", main: Array(50).fill("F") }, p2: { name: "Two", leader: p === "p2" && raw.type === "LEADER" ? id : "L", main: Array(50).fill("F") } }).state as VmState, take: () => { } };
        f.take = action => {
            const saved = clone(f.state), before = JSON.stringify(saved), result = RULES.apply(ctx, saved, action);
            assert.deepEqual(RULES.apply(ctx, clone(saved), action), result, "JSON replay");
            assert.equal(JSON.stringify(saved), before, "input purity");
            f.state = result.state as VmState;
            f.events.push(...result.events);
            assert.equal(f.state.outcome, undefined, JSON.stringify(f.state.outcome));
        };
        for (const a of [{ type: "chooseFirst", player: f.state.chooser, first: q }, { type: "mulligan", player: q, redraw: false }, { type: "mulligan", player: p, redraw: false }, { type: "charge", player: q, card: null }] as Action[])
            f.take(a);
        assert.ok(!RULES.legalActions(ctx, f.state).some(x => x.action.type === "attack"), "first player's first turn cannot attack");
        f.take({ type: "pass", player: q });
        f.take({ type: "charge", player: p, card: null });
        assert.equal(f.state.turnPlayer, p);
        assert.ok(f.state.turn > 1);
        // Explicit resource/ordered-Deck fixture setup. Initial 50-copy synthetic
        // Extra list is NOT a tournament-legal deck claim. Its card type obeys
        // Magenta's deck restriction; all actual inspected faces below are frozen
        // real catalog targets/Extras, except labeled identity-negative controls.
        if (raw.type === "LEADER")
            f.source = f.state.sides[p].zones.leader[0];
        else {
            f.source = f.state.sides[p].zones.hand[0];
            f.state.cards[f.source].cardId = id;
            for (let i = 0; i < 2; i++) {
                const energy = f.state.sides[p].zones.deck.at(-1)!;
                moveCard(f.state, game, energy, "energy", { owner: p });
                f.state.cards[energy].mode = "active";
            }
        }
        while (f.state.sides[p].zones.deck.length > size)
            moveCard(f.state, game, f.state.sides[p].zones.deck.at(-1)!, "warp", { owner: p });
        f.top = [...f.state.sides[p].zones.deck];
        f.top.forEach((iid, i) => { f.state.cards[iid].cardId = fillers[i].id; });
        source.matchingCards.forEach((c, i) => {
            if (f.top[i])
                f.state.cards[f.top[i]].cardId = c.id;
        });
        if (id === "BT23-072" && size >= 2)
            for (const iid of f.top.slice(0, 2)) {
                const def = defs[f.state.cards[iid].cardId];
                assert.equal(attrsNow(ctx, game, f.state, iid).comboPower, Math.max(0, (def.comboPower ?? 0) - 5000), "actual standing combo modifier in Deck preserves identity eligibility");
            }
        f.state.cards[f.state.sides[q].zones.hand[0]].cardId = "CANCEL"; // synthetic priced-zero Counter keeps the native window observable
        return f;
    }
    function playSource(f: Fixture) {
        if (raw.type === "BATTLE") {
            const play = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "play" && a.card === f.source);
            assert.ok(play, "Yamcha actual paid play");
            f.take(play);
            if (f.state.prompt.kind === "payCost") {
                const option = f.state.prompt.options.findIndex(o => o.markers === 0 && o.rest.length === 2);
                assert.ok(option >= 0, "pay both printed Red energy without substituting the second-player energy marker");
                f.take({ type: "payCost", player: f.p, option });
            }
            for (let i = 0; i < 20 && f.state.prompt.kind !== "main"; i++) {
                const pass = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "counter" && a.card === null);
                assert.ok(pass, JSON.stringify({ id, prompt: f.state.prompt, legal: RULES.legalActions(ctx, f.state).map(x => x.action) }));
                f.take(pass);
            }
            assert.equal(f.state.prompt.kind, "main");
            assert.ok(!f.state.pending.some(x => x.card === f.source));
            assert.equal(f.state.sides[f.p].zones.energy.length, 2);
            assert.equal(f.state.sides[f.p].attrs.energyMarkers, 1, "ordinary second-player marker was not substituted for either Red payer");
            for (const e of f.state.sides[f.p].zones.energy) {
                assert.equal(f.state.cards[e].mode, "rest");
                assert.deepEqual(defs[f.state.cards[e].cardId].colors, ["Red"]);
            }
        }
    }
    function pendingAttack(f: Fixture) {
        playSource(f);
        const attack = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "attack" && a.attacker === f.source && a.target === f.state.sides[f.q].zones.leader[0]);
        assert.ok(attack, "real legal attack");
        const deck = clone(f.state.sides[f.p].zones.deck), rng = f.state.rngState;
        f.take(attack);
        assert.equal(f.state.cards[f.source].mode, "rest");
        assert.equal(f.state.battle?.attacker, f.source);
        assert.equal(f.state.prompt.kind, "counter");
        const pending = f.state.pending.filter(x => x.card === f.source && x.skillIndex === index);
        assert.equal(pending.length, 1);
        assert.equal(pending[0].trigger, "attacks");
        assert.deepEqual(clone(pending[0].lookSource!.script.ops), changed.ops);
        assert.deepEqual(f.state.sides[f.p].zones.deck, deck);
        assert.equal(f.state.rngState, rng);
        assert.ok(!f.state.programs.some(x => x.lookExecution));
        f.state = clone(f.state);
    }
    function begin(f: Fixture, negate = false) {
        if (negate)
            f.state.cards[f.state.sides[f.q].zones.hand[0]].cardId = "CANCEL";
        pendingAttack(f);
        if (negate) {
            const counter = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "counter" && a.card !== null);
            assert.ok(counter);
            f.take(counter);
        }
        for (let i = 0; i < 20 && !(f.state.prompt.kind === "chooseMode" && f.state.prompt.inspection); i++) {
            const pass = RULES.legalActions(ctx, f.state).map(x => x.action).find(a => a.type === "counter" && a.card === null);
            assert.ok(pass, `${id}: original pending reaches inspection`);
            f.take(pass);
        }
        assert.equal(f.state.prompt.kind, "chooseMode");
        const frame = f.state.programs.find(x => x.lookExecution)!;
        assert.ok(frame);
        assert.equal(frame.skillIndex, index);
        assert.equal(frame.trigger, "attacks");
        assert.equal(frame.lookExecution!.source.cardId, id);
        assert.deepEqual(clone(frame.lookExecution!.source.script.ops), changed.ops);
        assert.equal(frame.lookExecution!.source.skill.cost, "");
        if (negate)
            assert.ok(f.events.some(e => e.type === "attackNegated"), "negated attack preserves pending Auto");
    }
    const tap = (f: Fixture, n: number) => f.take({ type: "chooseMode", player: f.p, index: n });
    const snap = (f: Fixture, viewer: PlayerId, events: GameEvent[] = []) => buildSnapshot({ id: 533, revision: 1, mode: "hotseat", status: "playing", p1Name: "One", p2Name: "Two", ctx, state: f.state, legal: RULES.legalActions(ctx, f.state), log: [], beats: events.length ? RULES.toBeats(ctx, f.state, events) : null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
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
        for (const iid of f.top.slice(0, count))
            assert.ok(own.includes(JSON.stringify(defs[f.state.cards[iid].cardId].name)));
        for (const iid of f.top.slice(count))
            assert.ok(!own.includes(JSON.stringify(defs[f.state.cards[iid].cardId].name)), "own Snapshot never shows uninspected faces");
    }
    function finish(f: Fixture, chosen: string | undefined, rng: number, start: number) {
        assert.ok(!f.state.programs.some(x => x.lookExecution));
        assert.ok(["combo", "blocker", "main"].includes(f.state.prompt.kind));
        if (f.state.sides[f.p].zones.deck.length > 1)
            assert.notEqual(f.state.rngState, rng, "shuffle after every stop/choice");
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
        for (const n of [0, 1, maximum])
            for (const pick of [false, true]) {
                const f = fresh(p);
                begin(f);
                const deck = [...f.top], rng = f.state.rngState;
                for (let i = 0; i <= n; i++) {
                    privatePrefix(f, i);
                    assert.deepEqual(f.state.sides[p].zones.deck, deck);
                    assert.equal(f.state.rngState, rng);
                    if (i < n) {
                        const before = f.events.length;
                        tap(f, 0);
                        privatePrefix(f, i + 1, f.events.slice(before));
                    }
                }
                if (n === maximum)
                    assert.ok(JSON.stringify(snap(f, p)).includes(JSON.stringify(defs[f.state.cards[f.top[maximum - 1]].cardId].name)), "final nonmatch shown before Continue");
                const start = f.events.length;
                tap(f, n === maximum ? 0 : 1);
                if (n) {
                    assert.equal(f.state.prompt.kind, "chooseCards");
                    if (f.state.prompt.kind === "chooseCards")
                        assert.deepEqual(f.state.prompt.choice.candidates, f.top.slice(0, Math.min(n, source.matchingCards.length)));
                    f.take({ type: "choose", player: p, cards: pick ? [f.top[0]] : [] });
                }
                finish(f, pick && n ? f.top[0] : undefined, rng, start);
                cases++;
            }
        for (const size of [2]) {
            const f = fresh(p, size);
            if (size)
                f.state.cards[f.top[1]].cardId = fillers[1].id;
            begin(f);
            const rng = f.state.rngState, start = f.events.length;
            for (let i = 0; i < size; i++) {
                tap(f, 0);
                privatePrefix(f, i + 1);
            }
            tap(f, 0);
            if (size)
                f.take({ type: "choose", player: p, cards: [f.top[0]] });
            finish(f, size ? f.top[0] : undefined, rng, start);
            cases++;
        }
        const empty = fresh(p);
        playSource(empty);
        // Empty-Deck boundary setup AFTER genuine paid play, so no impossible
        // pre-play empty Deck is parked at a payment chooser.
        for (const iid of [...empty.state.sides[p].zones.deck])
            moveCard(empty.state, game, iid, "warp", { owner: p });
        const emptyBefore = JSON.stringify(empty.state);
        const emptyAttack = RULES.legalActions(ctx, empty.state).map(x => x.action).find(a => a.type === "attack" && a.attacker === empty.source)!;
        assert.ok(emptyAttack);
        const lost = RULES.apply(ctx, empty.state, emptyAttack);
        assert.deepEqual(RULES.apply(ctx, clone(empty.state), emptyAttack), lost);
        assert.equal(JSON.stringify(empty.state), emptyBefore);
        assert.equal(lost.state.outcome?.kind, "win");
        assert.match(lost.state.outcome?.reason ?? "", /no cards.*Deck Area/);
        assert.equal(lost.state.prompt.kind, "gameOver");
        cases++;
        const negated = fresh(p);
        begin(negated, true);
        privatePrefix(negated, 0);
        const nr = negated.state.rngState, ne = negated.events.length;
        tap(negated, 1);
        finish(negated, undefined, nr, ne);
        cases++;
        for (const corrupt of ["missing", "script", "transition", ...(raw.type === "LEADER" ? ["face"] : [])]) {
            const bad = fresh(p);
            pendingAttack(bad);
            const pending = bad.state.pending.find(x => x.card === bad.source && x.skillIndex === index)!;
            assert.ok(pending.kind !== "hook");
            if (corrupt === "missing")
                delete pending.lookSource;
            else if (corrupt === "script")
                pending.lookSource!.script.ops = [];
            else if (corrupt === "face")
                bad.state.cards[bad.source].flipped = true;
            else
                bad.state.cards[bad.source].zoneEpoch = (bad.state.cards[bad.source].zoneEpoch ?? 0) + 1;
            const saved = clone(bad.state), before = JSON.stringify(saved), pass = RULES.legalActions(ctx, saved).map(x => x.action).find(a => a.type === "counter" && a.card === null)!;
            assert.ok(pass);
            let refused = false;
            try {
                const r = RULES.apply(ctx, saved, pass);
                assert.equal(r.state.outcome?.kind, "interrupted", "pending source corruption must never be mistaken for a win or draw");
                refused = true;
                if (refused) {
                    bad.state = r.state as VmState;
                    assert.equal(bad.state.prompt.kind, "gameOver");
                    assert.equal(RULES.boardView(ctx, bad.state, p, {}).prompt.inspection, undefined);
                    assert.equal(RULES.boardView(ctx, bad.state, bad.q, {}).prompt.inspection, undefined);
                    for (const viewer of [p, bad.q]) {
                        const projected = JSON.stringify(snap(bad, viewer));
                        for (const iid of bad.top) {
                            assert.ok(!projected.includes(JSON.stringify(iid)));
                            assert.ok(!projected.includes(JSON.stringify(defs[bad.state.cards[iid].cardId].name)));
                        }
                    }
                }
            }
            catch (error) {
                assert.ok(error instanceof IllegalAction);
                assert.match(String(error), /R527|rebuild/);
                refused = true;
            }
            assert.ok(refused, "invalid original pending source refuses");
            assert.equal(JSON.stringify(saved), before);
            cases++;
        }
        if (id === "P-077") {
            const unpaid = fresh(p);
            unpaid.state.sides[p].attrs.energyMarkers = 0; // explicit no-marker resource control
            unpaid.state.cards[unpaid.state.sides[p].zones.energy[1]].cardId = "BLUE";
            assert.ok(!RULES.legalActions(ctx, unpaid.state).some(x => x.action.type === "play" && x.action.card === unpaid.source), "one Red plus one Blue cannot pay two Red");
            const saved = clone(unpaid.state), before = JSON.stringify(saved);
            assert.throws(() => RULES.apply(ctx, saved, { type: "play", player: p, card: unpaid.source }), IllegalAction);
            assert.equal(JSON.stringify(saved), before);
            cases++;
        }
        const rejected = fresh(p);
        begin(rejected);
        for (let i = 0; i <= maximum; i++)
            tap(rejected, 0);
        assert.throws(() => RULES.apply(ctx, clone(rejected.state), { type: "choose", player: p, cards: [rejected.top[0], rejected.top[0]] }), /choose at most 1|duplicate|invalid choice/);
        for (const wrong of [rejected.top[maximum - 1], rejected.top[maximum]]) {
            const saved = clone(rejected.state), before = JSON.stringify(saved);
            assert.throws(() => RULES.apply(ctx, saved, { type: "choose", player: p, cards: [wrong] }), /invalid choice/);
            assert.equal(JSON.stringify(saved), before);
            if (saved.prompt.kind === "chooseCards")
                saved.prompt.choice.candidates.push(wrong);
            assert.throws(() => requireInspectionPrompt(ctx, game, saved), /R527|rebuild/);
            cases++;
        }
        // Saved receipt primitive control, not a concurrent legal player action.
        const departed = fresh(p);
        begin(departed);
        tap(departed, 0);
        moveCard(departed.state, game, departed.source, "drop", { owner: p });
        departed.state = clone(departed.state);
        requireInspectionPrompt(ctx, game, departed.state);
        tap(departed, 1);
        departed.take({ type: "choose", player: p, cards: [departed.top[0]] });
        assert.ok(departed.state.sides[p].zones.hand.includes(departed.top[0]));
        cases++;
        // Synthetic identity contract: whole match/case and nonmatching suffix;
        // traits also demonstrate no invented Battle-only restriction.
        const normalized = fresh(p);
        normalized.state.cards[normalized.top[0]].cardId = "CASE";
        normalized.state.cards[normalized.top[1]].cardId = "SIMILAR";
        begin(normalized);
        tap(normalized, 0);
        tap(normalized, 0);
        tap(normalized, 1);
        assert.equal(normalized.state.prompt.kind, "chooseCards");
        if (normalized.state.prompt.kind === "chooseCards")
            assert.deepEqual(normalized.state.prompt.choice.candidates, [normalized.top[0]]);
        normalized.take({ type: "choose", player: p, cards: [normalized.top[0]] });
        cases++;
        if (!traits) {
            const alternate = fresh(p);
            begin(alternate);
            tap(alternate, 0);
            tap(alternate, 0);
            tap(alternate, 1);
            assert.throws(() => RULES.apply(ctx, clone(alternate.state), { type: "choose", player: p, cards: alternate.top.slice(0, 2) }), /choose at most 1/);
            const rng = alternate.state.rngState, start = alternate.events.length;
            alternate.take({ type: "choose", player: p, cards: [alternate.top[1]] });
            finish(alternate, alternate.top[1], rng, start);
            cases++;
        }
    }
    for (const [before, after] of [[`up to ${maximum}`, `up to ${maximum + 1}`], [traits ? filter.traits[0] : filter.characters[0], "Unreviewed Identity"], ["shuffle your deck", "draw 1 card"]]) {
        const boundary = raw.skill!.toLowerCase().lastIndexOf("look at");
        const changedRaw = raw.skill!.slice(0, boundary) + raw.skill!.slice(boundary).replace(new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), after);
        assert.notEqual(changedRaw, raw.skill);
        for (const row of skillRecords({ ...defs[id], skill: changedRaw }))
            for (const op of row.ops)
                if (op.op === "look")
                    assert.equal(op.upTo, undefined);
        cases++;
    }
    const attacks = raw.skill!.replace(/When this card attacks,/, "When this card is attacked,");
    assert.notEqual(attacks, raw.skill, "producer near-match changes the reviewed Auto");
    for (const row of skillRecords({ ...defs[id], skill: attacks }))
        for (const op of row.ops)
            if (op.op === "look")
                assert.equal(op.upTo, undefined, "attacked producer is not admitted");
    cases++;
    perCard[id] = cases - startCases;
    console.log(`R533 ${id}: ${perCard[id]} cases complete`);
}
console.log(`${cases} R533 ordinary-attack inspection cases across ${Object.keys(perCard).length} exact cards: ${JSON.stringify(perCard)}`);

/** R450: native Counter Spirit Boost X payments and historical effects. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { counterAlt } from "../../src/lib/arena/vm/battle";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { resolveSelector, attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs: Record<string, CardDef> = {
    BASE: card("BASE", { type: "LEADER", colors: ["Red"], traits: ["Universe 11"] }),
    FILLER: card("FILLER", { power: 10000 }),
    RED: card("RED", { colors: ["Red"] }),
    GREEN: card("GREEN", { colors: ["Green"] }),
    RED3: card("RED3", { type: "UNISON", colors: ["Red"], energyCost: 3, specifiedCost: { Red: 3 }, power: 20000 }),
    GREEN3: card("GREEN3", { type: "UNISON", colors: ["Green"], energyCost: 3, specifiedCost: { Green: 3 }, power: 20000 }),
};
defs["BT14-029"] = card("BT14-029", { type: "EXTRA", colors: ["Red"], energyCost: 0, skill: "[Counter: Attack][Spirit Boost X] If your Leader Card is mono-red: Choose up to 1 of your opponent's cards and it gets -5000 power for the turn. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 of your opponent's cards and it gets -5000 power for the turn for each marker you removed using this skill." });
defs["BT14-030"] = card("BT14-030", { type: "EXTRA", colors: ["Red"], energyCost: 1, skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) If your Leader Card is a red \u226aUniverse 11\u226b card: Negate the attack, add up to 1 red &lt;Jiren&gt; card with an [Evolve] skill and an energy cost of 5 or less from your deck to your hand, then shuffle your deck. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 red \u226aUniverse 11\u226b card with an energy cost of 1 in your Drop Area and play it in Rest Mode with its skills negated for the turn." });
defs["BT14-090"] = card("BT14-090", { type: "EXTRA", colors: ["Green"], energyCost: 1, skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) Negate the attack; if you removed a marker from your green Unison Card using this skill, play 1 Majin Token in Rest Mode. (Majin Tokens have 15000 power, 0 combo cost, and 5000 combo power.)<br>[Permanent] If one of your green Unison Cards is attacked, you may activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 card in your hand and discarding it." });
// Specified costs read from the official BT14-030/090 card images.
defs["BT14-030"].specifiedCost = { Red: 1 };
defs["BT14-090"].specifiedCost = { Green: 1 };
defs["BT7-024"] = card("BT7-024", { "type": "EXTRA", "name": "The Final Guardian", "colors": ["Red"], "specifiedCost": { "Red": 1 }, "energyCost": 1, "skill": "[Counter: Attack] If your Leader Card is red: Negate the attack, then choose up to 1 of your Battle Cards and it gets +5000 power for the duration of the turn.<br>[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 red card in your hand from the game.<br>[Auto] When you activate this card, you can't activate {The Final Guardian} for the duration of the turn." });
defs.GREENLEADER = card("GREENLEADER", { type: "LEADER", colors: ["Green"] });
defs.ANSWER = card("ANSWER", { type: "EXTRA", energyCost: 0, skill: "[Counter: Counter] Choose 1 of your opponent’s Unison Cards and place it in its owner’s Drop Area." });
defs.JIREN = card("JIREN", { colors: ["Red"], characters: ["Jiren"], energyCost: 5, skill: "[Evolve] {r}: <Jiren>." });
defs.U11 = card("U11", { colors: ["Red"], traits: ["Universe 11"], energyCost: 1, skill: "[Double Strike]" });
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const records = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(p: PlayerId) {
    let s = RULES.createGame(ctx, { seed: 450, p1: { name: "One", leader: "BASE", main: fifty("FILLER") }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER") } }).state as VmState;
    for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
        s = take(s, a);
    s.turn = 2;
    s.sides.p1.attrs.energyMarkers = 0;
    s.sides.p2.attrs.energyMarkers = 0;
    return s;
}
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
function setup(p: PlayerId, id: string, markers: number) {
    let s = fresh(other(p));
    const source = stage(s, p, id, "hand");
    const payer = markers ? stage(s, p, id === "BT14-090" ? "GREEN3" : "RED3", "unison") : undefined;
    if (payer)
        s.cards[payer].markers = markers;
    const energy = stage(s, p, id === "BT14-090" ? "GREEN" : "RED", "energy");
    s.cards[energy].mode = "active";
    s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
    return { s, source, payer, energy };
}
let cases = 0;
for (const p of ["p1", "p2"] as const)
    for (const id of ["BT14-029", "BT14-030", "BT14-090"])
        for (const markers of [0, 1, 3]) {
            const { s, source } = setup(p, id, markers);
            const offered = RULES.legalActions(ctx, s).map(row => row.action).filter((a): a is Extract<Action, {
                type: "counter";
            }> => a.type === "counter" && a.card === source && !a.alt);
            assert.deepEqual(offered.map(a => a.x), Array.from({ length: markers + 1 }, (_, i) => i), `${p}/${id}/${markers}: exact payable X including no-Unison zero`);
            cases++;
        }
// Payment is observable before optional effect targets are selected. Each X
// is replayed from the same saved Counter position, not a mutated predecessor.
for (const p of ["p1", "p2"] as const)
    for (const id of ["BT14-029", "BT14-030", "BT14-090"])
        for (const x of [0, 1, 3]) {
            const start = setup(p, id, 3);
            let s = take(copy(start.s), { type: "counter", player: p, card: start.source, skill: 0, x });
            assert.equal(s.outcome?.kind === "interrupted", false);
            assert.equal(s.cards[start.payer!].markers, 3 - x);
            assert.equal(s.sides[p].zones.drop.includes(start.payer!), x === 3, "last marker invokes Unison removal");
            assert.ok(s.sides[p].zones.drop.includes(start.source), JSON.stringify({ id, x, p, prompt: s.prompt, outcome: s.outcome, programs: s.programs }));
            assert.equal(s.cards[start.energy].mode, id === "BT14-029" ? "active" : "rest", "card energy is separate from X");
            // The optional searches/targets can be declined. Token creation is mandatory.
            for (let step = 0; step < 6 && s.prompt?.kind === "chooseCards"; step++)
                s = take(copy(s), { type: "choose", player: p, cards: [] });
            if (id === "BT14-090") {
                const tokens = s.sides[p].zones.battle.filter(cid => cid.includes("#token"));
                assert.equal(tokens.length, x > 0 ? 1 : 0, "historical positive marker payment creates the token");
                for (const token of tokens)
                    assert.equal(s.cards[token].mode, "rest");
            }
            cases++;
        }
for (const p of ["p1", "p2"] as const) {
    const { s, source } = setup(p, "BT14-029", 1);
    for (const x of [undefined, null, -1, 1.5, 2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const before = copy(s);
        assert.throws(() => RULES.apply(ctx, s, { type: "counter", player: p, card: source, skill: 0, x } as Action));
        assert.deepEqual(s, before, "invalid or unaffordable X refuses before mutation");
        cases++;
    }
}
for (const p of ["p1", "p2"] as const)
    for (const protection of [false, true]) {
        let s = fresh(other(p));
        const source = stage(s, p, "BT14-090", "hand"), payer = stage(s, p, "GREEN3", "unison");
        s.cards[payer].markers = 3;
        if (protection)
            addEffect(s, [], { target: payer, kind: "immune", value: 0, until: "game", immune: { from: p } });
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: payer });
        assert.equal(counterAlt(ctx, game, s, source, p)?.pay, "program", "guard observation includes protected green Unison");
        const frame = { ops: [], ip: 0, vars: {}, card: source, master: p };
        assert.equal(resolveSelector(ctx, game, s, frame, { side: "you", area: "unison" }).includes(payer), !protection, "actual target choice keeps protection");
        const before = copy(s);
        s.battle!.guard = s.sides[p].zones.leader[0];
        assert.equal(counterAlt(ctx, game, s, source, p), null, "Leader attacked is not matching Unison");
        s = before;
        s.cards[payer].cardId = "RED3";
        assert.equal(counterAlt(ctx, game, s, source, p), null, "wrong-color guard does not grant alternative");
        cases++;
    }
for (const p of ["p1", "p2"] as const)
    for (const markers of [1, 3])
        for (const x of [0, 1]) {
            let s = fresh(other(p));
            const source = stage(s, p, "BT14-090", "hand"), payer = stage(s, p, "GREEN3", "unison");
            s.cards[payer].markers = markers;
            s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: payer });
            const action = RULES.legalActions(ctx, s).map(r => r.action).find(a => a.type === "counter" && a.card === source && a.alt && a.x === x);
            assert.ok(action);
            s = take(copy(s), action);
            assert.equal(s.prompt.kind, "chooseCards");
            assert.equal(s.cards[payer].markers, markers - x);
            assert.ok(s.sides[p].zones.hand.includes(source));
            assert.equal(s.pending.length, 0, "strict discard precedes activation");
            if (s.prompt.kind !== "chooseCards")
                throw new Error("discard prompt");
            assert.ok(!s.prompt.choice.candidates.includes(source), "activating Extra cannot discard itself");
            const discard = s.prompt.choice.candidates[0];
            for (const damage of ["missingX", "changedX", "missingReceipt"]) {
                const stale = copy(s);
                const frame = stale.programs.find(f => f.counterCost)!;
                if (damage === "missingX")
                    delete frame.x;
                else if (damage === "changedX")
                    frame.x = x + 1;
                else
                    delete frame.paidMarkers;
                let result = stale;
                try {
                    result = RULES.apply(ctx, stale, { type: "choose", player: p, cards: [discard] }).state as VmState;
                }
                catch (error) {
                    assert.match(String(error), /Spirit Boost|saved Counter/);
                }
                assert.ok(result.sides[p].zones.hand.includes(discard), "obsolete saved cost cannot discard then reinterpret X");
            }
            s = take(copy(s), { type: "choose", player: p, cards: [discard] });
            assert.ok(s.sides[p].zones.drop.includes(discard));
            assert.ok(s.sides[p].zones.drop.includes(source));
            assert.equal(s.sides[p].zones.battle.filter(cid => cid.includes("#token")).length, x > 0 ? 1 : 0, "last-marker removal does not cancel declared alternative");
            cases++;
        }
for (const p of ["p1", "p2"] as const)
    for (const variant of ["reload", "reentry", "missing", "changedX"]) {
        const initial = setup(p, "BT14-030", 3);
            let { s } = initial;
            const { source, payer } = initial;
        s.sides[p].attrs.energyMarkers = 1;
        s = take(s, { type: "counter", player: p, card: source, skill: 0, x: 2 });
        assert.equal(s.prompt.kind, "payCost");
        s = copy(s);
        if (variant === "reentry") {
            moveCard(s, game, payer!, "hand", { owner: p });
            moveCard(s, game, payer!, "unison", { owner: p });
            s.cards[payer!].markers = 3;
        }
        if (s.prompt.kind !== "payCost")
            throw new Error("energy prompt");
        if (variant === "missing")
            delete s.prompt.markerPayers;
        if (variant === "changedX" && s.prompt.action.type === "counter")
            s.prompt.action.x = 1;
        const before = copy(s);
        if (variant === "reload") {
            s = take(s, { type: "payCost", player: p, option: 0 });
            assert.equal(s.cards[payer!].markers, 1);
            assert.ok(s.sides[p].zones.drop.includes(source));
        }
        else {
            assert.throws(() => take(s, { type: "payCost", player: p, option: 0 }));
            assert.deepEqual(s, before);
        }
        cases++;
    }
// A payer departure after native marker payment prevents completing the
// ordinary discard. The already-paid markers remain paid; no effect runs.
for (const p of ["p1", "p2"] as const) {
    let s = fresh(other(p));
    const source = stage(s, p, "BT14-090", "hand"), payer = stage(s, p, "GREEN3", "unison");
    s.cards[payer].markers = 3;
    s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: payer });
    s = take(s, { type: "counter", player: p, card: source, skill: 0, alt: true, x: 2 });
    assert.equal(s.prompt.kind, "chooseCards");
    if (s.prompt.kind !== "chooseCards")
        throw new Error("discard prompt");
    const cards = [...s.prompt.choice.candidates];
    for (const id of cards) assert.ok(moveCard(s, game, id, "warp", { owner: p }).ok);
    assert.throws(() => take(copy(s), { type: "choose", player: p, cards: [cards[0]] }));
    assert.equal(s.cards[payer].markers, 1);
    assert.ok(s.sides[p].zones.hand.includes(source));
    assert.equal(s.pending.length, 0);
    assert.equal(s.sides[p].zones.battle.length, 0);
    cases++;
}
for (const p of ["p1", "p2"] as const)
    for (const x of [0, 1, 2])
        for (const color of ["Red", "Green"]) {
            const initial = setup(p, "BT14-029", 2);
            let { s } = initial;
            const { source, payer } = initial;
            s.cards[payer!].cardId = color === "Red" ? "RED3" : "GREEN3";
            const attacker = s.battle!.attacker;
            const power = attrsNow(ctx, game, s, attacker).power;
            s = take(s, { type: "counter", player: p, card: source, skill: 0, x });
            s = take(copy(s), { type: "choose", player: p, cards: [attacker] });
            if (x > 0 && color === "Red")
                s = take(copy(s), { type: "choose", player: p, cards: [attacker] });
            assert.equal(attrsNow(ctx, game, s, attacker).power, Number(power) - 5000 - (color === "Red" ? 5000 * x : 0), "native historical amount and payer color");
            cases++;
        }
for (const p of ["p1", "p2"] as const)
    for (const x of [0, 1]) {
        const initial = setup(p, "BT14-030", 1);
            let { s } = initial;
            const { source } = initial;
        const target = stage(s, p, "U11", "drop"), jiren = s.sides[p].zones.deck[0];
        s.cards[jiren].cardId = "JIREN";
        s = take(s, { type: "counter", player: p, card: source, skill: 0, x });
        if (s.prompt.kind === "chooseCards")
            s = take(copy(s), { type: "choose", player: p, cards: [jiren] });
        assert.ok(s.sides[p].zones.hand.includes(jiren), "native deck search after negating attack");
        if (x > 0) {
            s = take(copy(s), { type: "choose", player: p, cards: [target] });
            assert.ok(s.sides[p].zones.battle.includes(target));
            assert.equal(s.cards[target].mode, "rest");
            assert.equal(hasKeyword(ctx, game, s, target, "Strike"), false);
        }
        else
            assert.ok(s.sides[p].zones.drop.includes(target));
        cases++;
    }
for (const p of ["p1", "p2"] as const) {
    // Native response moves the payer after payment; the source then reads the
    // receipt after a JSON reload, including the actual selected quantity.
    const initial = setup(p, "BT14-029", 3);
            let { s } = initial;
            const { source, payer } = initial;
    const answer = stage(s, other(p), "ANSWER", "hand"), attacker = s.battle!.attacker;
    s = take(s, { type: "counter", player: p, card: source, skill: 0, x: 2 });
    assert.equal(s.prompt.kind, "counter");
    s = take(copy(s), { type: "counter", player: other(p), card: answer });
    if (s.prompt.kind === "chooseCards" && s.prompt.player === other(p))
        s = take(copy(s), { type: "choose", player: other(p), cards: [payer!] });
    assert.ok(s.sides[p].zones.drop.includes(payer!));
    s = take(copy(s), { type: "choose", player: p, cards: [attacker] });
    s = take(copy(s), { type: "choose", player: p, cards: [attacker] });
    assert.equal(attrsNow(ctx, game, s, attacker).power, -5000);
    cases++;
}
for (const p of ["p1", "p2"] as const)
    for (const id of ["BT14-029", "BT14-030", "BT14-090"]) {
        const initial = setup(p, id, 0);
            let { s } = initial;
            const { source } = initial;
        s = take(copy(s), { type: "counter", player: p, card: source, skill: 0, x: 0 });
        assert.ok(s.sides[p].zones.drop.includes(source));
        assert.notEqual(s.outcome?.kind, "interrupted");
        cases++;
        const base = setup(p, id, 2);
        s = base.s;
        stepScript(vmHost(ctx, game, s, []), { ops: [{ op: "negateSkillsOfKind", kind: "keyword", target: { var: "source" }, until: "turn" }, { op: "negateSkillsOfKind", kind: "counter", target: { var: "source" }, until: "turn" }], ip: 0, vars: { source: [base.source] }, card: s.sides[other(p)].zones.leader[0], master: other(p) });
        assert.ok(!RULES.legalActions(ctx, s).some(r => r.action.type === "counter" && r.action.card === base.source), "keyword negation disables Counter");
        assert.throws(() => take(s, { type: "counter", player: p, card: base.source, skill: 0, x: 0 }));
        cases++;
    }
for (const p of ["p1", "p2"] as const)
    for (const id of ["BT14-029", "BT14-030"]) {
        const initial = setup(p, id, 2);
            const { s } = initial;
            const { source } = initial;
        s.cards[s.sides[p].zones.leader[0]].cardId = "GREENLEADER";
        assert.ok(!RULES.legalActions(ctx, s).some(r => r.action.type === "counter" && r.action.card === source), "independent Leader condition survives X admission");
        assert.throws(() => take(s, { type: "counter", player: p, card: source, skill: 0, x: 1 }));
        cases++;
    }
// Existing Counter lines use the same source-aware negation admission as
// Activate. These are ordinary fixed-price hand/Drop controls, not X grammar.
for (const p of ["p1", "p2"] as const)
    for (const area of ["hand", "drop"])
        for (const mode of ["normal", "all", "counter", "index", "wrongIndex", "protected"]) {
            let s = fresh(other(p));
            const source = stage(s, p, "BT7-024", area);
            stage(s, p, "RED", "hand");
            stage(s, p, "RED", "hand");
            const energy = stage(s, p, "RED", "energy");
            s.cards[energy].mode = "active";
            s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
            assert.ok(RULES.legalActions(ctx, s).some(r => r.action.type === "counter" && r.action.card === source), "unnegated ordinary source is offered");
            if (mode === "protected")
                addEffect(s, [], { target: source, kind: "forbid", value: 0, until: "turn", forbid: { what: "beNegated", player: other(p) } });
            if (mode === "all" || mode === "protected")
                stepScript(vmHost(ctx, game, s, []), { ops: [{ op: "negateSkills", target: { var: "source" }, until: "turn" }], ip: 0, vars: { source: [source] }, card: s.sides[other(p)].zones.leader[0], master: other(p) });
            if (mode === "counter")
                stepScript(vmHost(ctx, game, s, []), { ops: [{ op: "negateSkillsOfKind", kind: "counter", target: { var: "source" }, until: "turn" }], ip: 0, vars: { source: [source] }, card: s.sides[other(p)].zones.leader[0], master: other(p) });
            if (mode === "index" || mode === "wrongIndex")
                addEffect(s, [], { target: source, kind: "negateSkill", value: mode === "index" ? 0 : 20, until: "turn" });
            const enabled = ["normal", "wrongIndex", "protected"].includes(mode);
            assert.equal(RULES.legalActions(ctx, s).some(r => r.action.type === "counter" && r.action.card === source), enabled, `${area}/${mode}: cached candidate rechecks negation`);
            if (enabled) {
                const result = take(copy(s), { type: "counter", player: p, card: source, skill: 0 });
                assert.notEqual(result.outcome?.kind, "interrupted");
            }
            else {
                const before = copy(s);
                assert.throws(() => RULES.apply(ctx, s, { type: "counter", player: p, card: source, skill: 0 }), /negated|permission/);
                assert.deepEqual(s, before);
            }
            cases++;
        }
console.log(`Counter Spirit Boost X5: ${cases} cases passed`);

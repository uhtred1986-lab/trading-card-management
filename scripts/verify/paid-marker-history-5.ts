/** R449: actual Spirit Boost payment survives last-marker departure and reload. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { activationsOf, resolveActivation } from "../../src/lib/arena/vm/activate";
import { run } from "../../src/lib/arena/vm/flow";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { hasKeyword, attrsNow, amount, condHolds } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const printed = { "id": "BT15-001", "type": "LEADER", "colors": ["Red"], "cost": null, "specified": null, "z": null, "power": 10000, "name": "Son Goten", "characters": ["Son Goten"], "traits": ["Saiyan", "Earthling"], "skill": "[Auto] When this card attacks, draw 1 card.<br>[Awaken] When your life is at 4 or less or you have a red Unison Card with a specified cost of 3 in play: You may draw 2 cards, add cards from your life to your hand until you have 6 life left, and flip this card over.", "backName": "SS Son Goten, Kamehameha Miracle", "backSkill": "[Auto] When this card attacks, draw 1 card.<br>[Activate: Main][Once per turn][Spirit Boost 1] This card gets +10000 power until the end of a battle or the end of the turn, whichever comes first, and if you removed a marker from a red Unison Card with a specified cost of 3 or more using this skill, choose up to 1 of your opponent's Battle Cards with 15000 power or less and KO it.<br>[Activate: Main] If your life is at 3 or less: Play up to 1 red &lt;Son Goku&gt; card with an energy cost of 1 from your Drop Area, then negate this skill for the game." };
const defs: Record<string, CardDef> = {
    BASE: card("BASE", { type: "LEADER", colors: ["Red"] }),
    FILLER: card("FILLER", { power: 10000 }),
    "BT15-001": card("BT15-001", { type: "LEADER", colors: ["Red"], skill: printed.skill, back: { name: printed.backName!, power: 15000, skill: printed.backSkill! } }),
    RED3: card("RED3", { type: "UNISON", colors: ["Red"], energyCost: 3, specifiedCost: { Red: 3 }, power: 20000 }),
    RED2: card("RED2", { type: "UNISON", colors: ["Red"], energyCost: 3, specifiedCost: { Red: 2 }, power: 20000 }),
    GREEN3: card("GREEN3", { type: "UNISON", colors: ["Green"], energyCost: 3, specifiedCost: { Green: 3 }, power: 20000 }),
};
defs["BT14-071"] = card("BT14-071", { type: "BATTLE", colors: ["Green"], energyCost: 3, power: 15000, skill: "[activate: main][limit 1] {g}, if you have 3 or more energy and a green Unison Card in play: Play this card from your hand; if you do, choose up to 1 of your opponent's Unison Cards and remove a marker from it.<br>[activate: main][once per turn][spirit boost x] Green Unison Card: This card gets +5000 power for the turn for each marker you removed from your Unison Card with this skill; if you removed 2 or more markers, this card gains [double strike] for the turn." });
defs["BT17-081"] = card("BT17-081", { type: "LEADER", colors: ["Yellow"], energyCost: 0, power: 10000, skill: "[Auto] Add 1 card from your life to your hand: When this card attacks, look at up to 5 cards from the top of your deck, play up to 1 yellow Unison Card with a specified cost of 1 among them with a marker on it in Rest Mode, then shuffle your deck.\r\n[Awaken] When your life is at 4 or less: You may draw 1 card, switch up to 1 of your energy to Active Mode, and flip this card over.", back: { name: "SS Son Goku, Fearless Fighter", power: 15000, skill: "[auto][once per turn] When this card attacks, draw 1 card, then play up to 1 yellow Unison card with a specified cost of 1 from your hand with a marker on it in Rest Mode.\r [activate: main][once per turn]{y}{y}, place 8 yellow Unison Cards from your Drop Area at the bottom of your deck in any order: Switch this card to Active Mode, and it gets +10000 power and [double strike] for the turn.\r [activate: battle][once per turn][spirit boost x] If it's your opponent's turn: For each marker you remove using this skill, this card gets +5000 power for the battle." } });
defs.STANDING = card("STANDING", { type: "LEADER", skill: "[Permanent] Negate the keyword skills of all your Battle Cards." });
defs.AUTO = card("AUTO", { energyCost: 0, skill: "[Auto][Spirit Boost 1] When this card is played, draw 1 card." });
defs.COUNTER = card("COUNTER", { type: "EXTRA", energyCost: 0, skill: "[Counter: Attack][Spirit Boost 1] Negate the attack, and if you removed a marker from a red Unison Card using this skill, draw 1 card." });
defs["BT14-029"] = card("BT14-029", { type: "EXTRA", colors: ["Red"], energyCost: 0, skill: "[Counter: Attack][Spirit Boost X] If your Leader Card is mono-red: Choose up to 1 of your opponent's cards and it gets -5000 power for the turn. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 of your opponent's cards and it gets -5000 power for the turn for each marker you removed using this skill." });
defs["BT14-030"] = card("BT14-030", { type: "EXTRA", colors: ["Red"], energyCost: 1, skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) If your Leader Card is a red \u226aUniverse 11\u226b card: Negate the attack, add up to 1 red &lt;Jiren&gt; card with an [Evolve] skill and an energy cost of 5 or less from your deck to your hand, then shuffle your deck. If you removed a marker from one of your red Unison Cards using this skill, choose up to 1 red \u226aUniverse 11\u226b card with an energy cost of 1 in your Drop Area and play it in Rest Mode with its skills negated for the turn." });
defs["BT14-090"] = card("BT14-090", { type: "EXTRA", colors: ["Green"], energyCost: 1, skill: "[Counter: Attack][Spirit Boost X] (Remove X markers from your Unison Card to activate this skill.) Negate the attack; if you removed a marker from your green Unison Card using this skill, play 1 Majin Token in Rest Mode. (Majin Tokens have 15000 power, 0 combo cost, and 5000 combo power.)<br>[Permanent] If one of your green Unison Cards is attacked, you may activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 card in your hand and discarding it." });
defs.RESPONSE = card("RESPONSE", { type: "EXTRA", energyCost: 0, skill: "[Counter: Counter] Choose 1 of your opponent's Unison Cards and place it in its owner's Drop Area." });
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const records = Object.values(defs).flatMap(skillRecords);
// Typed Auto protocol control; no printed Auto history-family admission is claimed.
const historical = records.find(r => r.cardId === "BT15-001" && r.side === "back" && r.skillIndex === 10)!.ops.find(op => op.op === "if")!;
assert.equal(historical.op, "if");
if (historical.op === "if")
    records.find(r => r.cardId === "AUTO")!.ops = [{ op: "if", cond: copy(historical.cond), then: [{ op: "draw", n: 1 }] }];
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(p: PlayerId) {
    let s = RULES.createGame(ctx, { seed: 449, p1: { name: "One", leader: "BASE", main: fifty("FILLER") }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER") } }).state as VmState;
    for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
        s = take(s, a);
    return s;
}
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
let cases = 0;
for (const p of ["p1", "p2"] as const)
    for (const payerDef of ["RED3", "RED2", "GREEN3"])
        for (const markers of [1, 2])
            for (const negated of [false, true]) {
                let s = fresh(p);
                const source = s.sides[p].zones.leader[0];
                s.cards[source].cardId = "BT15-001";
                s.cards[source].flipped = true;
                const payer = stage(s, p, payerDef, "unison"), target = stage(s, other(p), "FILLER", "battle");
                s.cards[payer].markers = markers;
                if (negated)
                    addEffect(s, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "turn" });
                const action = RULES.legalActions(ctx, s).map(r => r.action).find(a => a.type === "activate" && a.card === source && a.skill === 10);
                assert.ok(action);
                s = take(s, action);
                assert.equal(s.cards[payer].markers, markers - (negated ? 0 : 1));
                assert.equal(s.sides[p].zones.drop.includes(payer), !negated && markers === 1);
                const qualifies = !negated && payerDef === "RED3";
                assert.equal(s.prompt.kind === "chooseCards", qualifies, JSON.stringify({ p, payerDef, markers, negated, outcome: s.outcome }));
                if (qualifies) {
                    const frame = copy(s.programs.find(f => f.card === source && f.paidMarkers)!);
                    assert.ok(frame);
                    frame.x = 99;
                    assert.equal(amount(ctx, game, s, frame, { paidMarkers: "spiritBoost" }), 1, "selected X cannot replace actual quantity");
                    const receipt = frame.paidMarkers!.spiritBoost;
                    assert.ok(Array.isArray(receipt.payers[0].info.colors));
                    assert.equal(receipt.payers[0].info.colors.includes("Red"), true);
                    // Saved history remains Red/specified3 after the live card is replaced or changes color.
                    s.cards[payer].cardId = "GREEN3";
                    const conditional = records.find(r => r.cardId === "BT15-001" && r.side === "back" && r.skillIndex === 10)!.ops.find(op => op.op === "if")!;
                    assert.equal(conditional.op, "if");
                    if (conditional.op === "if")
                        assert.equal(condHolds(ctx, game, s, frame, conditional.cond), true);
                    for (const bad of ["missing", "count", "source", "skill"]) {
                        const broken = copy(frame);
                        if (bad === "missing")
                            delete broken.paidMarkers;
                        else if (bad === "count")
                            broken.paidMarkers!.spiritBoost.amount = 2;
                        else if (bad === "source")
                            broken.paidMarkers!.spiritBoost.source = "other";
                        else
                            broken.paidMarkers!.spiritBoost.skillIndex = 999;
                        assert.throws(() => amount(ctx, game, s, broken, { paidMarkers: "spiritBoost" }), /historical marker/);
                    }
                    s = take(s, { type: "choose", player: p, cards: [target] });
                    assert.ok(s.sides[other(p)].zones.drop.includes(target));
                }
                else
                    assert.ok(s.sides[other(p)].zones.battle.includes(target));
                cases++;
            }
for (const p of ["p1", "p2"] as const)
    for (const x of [0, 1, 2]) {
        let s = fresh(p);
        const source = stage(s, p, "BT14-071", "battle"), payer = stage(s, p, "GREEN3", "unison");
        s.cards[payer].markers = 2;
        const actions = RULES.legalActions(ctx, s).map(r => r.action).filter(a => a.type === "activate" && a.card === source && a.skill === 10);
        const action = actions.find(a => a.type === "activate" && a.x === x);
        assert.ok(action, JSON.stringify({ x, actions }));
        s = take(s, action);
        assert.equal(s.cards[payer].markers, 2 - x);
        assert.equal(s.sides[p].zones.drop.includes(payer), x === 2);
        assert.equal(attrsNow(ctx, game, s, source).power, 15000 + 5000 * x);
        assert.equal(hasKeyword(ctx, game, s, source, "Strike"), x >= 2);
        cases++;
    }
for (const p of ["p1", "p2"] as const) {
    for (const mode of ["zero", "negated", "waived"]) {
        let s = fresh(p);
        const source = stage(s, p, "BT14-071", "battle");
        if (mode === "negated")
            addEffect(s, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "turn" });
        if (mode === "waived") {
            const line = activationsOf(ctx, s, game.actions.activate, source, game).find(l => l.card === source && l.skillIndex === 10)!;
            assert.ok(line);
            resolveActivation(ctx, game, s, [], p, line, 2, undefined, undefined, true);
            run(ctx, game, s, []);
        }
        else {
            const action = RULES.legalActions(ctx, s).map(r => r.action).find(a => a.type === "activate" && a.card === source && a.skill === 10 && a.x === 0);
            assert.ok(action, mode);
            s = take(s, action);
        }
        assert.equal(attrsNow(ctx, game, s, source).power, 15000, mode);
        assert.equal(hasKeyword(ctx, game, s, source, "Strike"), false, mode);
        cases++;
    }
    for (const mode of ["paid", "negated", "declined"]) {
        let s = fresh(p);
        const source = stage(s, p, "AUTO", "hand"), payer = stage(s, p, "RED3", "unison");
        s.cards[payer].markers = 1;
        if (mode === "negated")
            s.cards[s.sides[p].zones.leader[0]].cardId = "STANDING";
        const before = s.sides[p].zones.hand.length;
        s = take(s, { type: "play", player: p, card: source });
        if (s.prompt.kind === "chooseMode" && mode === "paid") {
            for (const fill of [false, true]) {
                const obsolete = copy(s);
                const frame = obsolete.programs.find(f => f.autoCost)!;
                assert.ok(frame);
                delete frame.markerHistoryContract;
                if (fill)
                    frame.paidMarkers = {};
                // Old saved Auto resumes a former live-board effect after resource payment.
                frame.autoCost!.effect = [{ op: "draw", n: 1 }];
                const refused = take(obsolete, { type: "chooseMode", player: p, index: 0 });
                assert.equal(refused.outcome?.kind, "interrupted");
                assert.equal(refused.cards[payer].markers, 1, "obsolete effect refused before payment");
            }
        }
        if (s.prompt.kind === "chooseMode")
            s = take(s, { type: "chooseMode", player: p, index: mode === "declined" ? 1 : 0 });
        assert.equal(s.sides[p].zones.hand.length, before - 1 + (mode === "paid" ? 1 : 0), JSON.stringify({ mode, outcome: s.outcome, prompt: s.prompt }));
        assert.equal(s.cards[payer].markers, mode === "paid" ? 0 : 1);
        cases++;
    }
    {
        let s = fresh(other(p));
        s.turn = 2;
        const source = stage(s, p, "COUNTER", "hand"), payer = stage(s, p, "RED3", "unison");
        s.cards[payer].markers = 1;
        const before = s.sides[p].zones.hand.length;
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
        const action = RULES.legalActions(ctx, s).map(r => r.action).find(a => a.type === "counter" && a.card === source);
        assert.ok(action);
        s = take(s, action);
        assert.ok(s.sides[p].zones.drop.includes(payer));
        assert.equal(s.sides[p].zones.hand.length, before);
        cases++;
    }
}
for (const p of ["p1", "p2"] as const)
    for (const x of [0, 2]) {
        let s = fresh(other(p));
        s.turn = 2;
        const source = s.sides[p].zones.leader[0];
        s.cards[source].cardId = "BT17-081";
        s.cards[source].flipped = true;
        const payer = stage(s, p, "RED3", "unison");
        s.cards[payer].markers = 2;
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: source });
        let action: Action | undefined;
        for (let n = 0; n < 4; n++) {
            const legal = RULES.legalActions(ctx, s).map(r => r.action);
            action = legal.find(a => a.type === "activate" && a.card === source && a.skill === 20 && a.x === x);
            if (action)
                break;
            const pass = legal.find(a => a.type === "pass");
            assert.ok(pass, JSON.stringify({ prompt: s.prompt, legal }));
            s = take(s, pass);
        }
        assert.ok(action);
        s = take(s, action);
        assert.equal(s.cards[payer].markers, 2 - x);
        assert.equal(attrsNow(ctx, game, s, source).power, 15000 + 5000 * x);
        cases++;
    }
for (const id of ["BT14-029", "BT14-030", "BT14-090"]) {
    const row = records.find(r => r.cardId === id && r.skillIndex === 0)!;
    assert.ok(runtimeSupportOfRow(row as unknown as RuleRow).unsupported.some(x => x.includes("X payment")), "Counter X remains an explicit gap");
}
const both = records.find(r => r.cardId === "BT14-029" && r.skillIndex === 0)!;
for (const missing of ["condition", "amount"]) {
    const stale = copy(both);
    const rewrite = (value: unknown): unknown => {
        if (Array.isArray(value))
            return value.map(rewrite);
        if (!value || typeof value !== "object")
            return value;
        const obj = value as Record<string, unknown>;
        if (missing === "condition" && obj.kind === "paidMarkers")
            return { kind: "count", sel: { side: "you", area: "unison", filter: obj.filter }, atLeast: 1 };
        if (missing === "amount" && obj.paidMarkers)
            return { x: true, ...(obj.times !== undefined ? { times: obj.times } : {}) };
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, rewrite(v)]));
    };
    stale.ops = rewrite(stale.ops) as typeof stale.ops;
    assert.ok(runtimeSupportOfRow(stale as unknown as RuleRow).unsupported.some(x => x.includes("historical Spirit Boost")), missing);
    for (const status of ["draft", "confirmed", "corrected"]) {
        const loaded = rulesFromRows([{ ...stale, id: 0, status, source: "compiler" } as unknown as RuleRow], defs);
        assert.ok(loaded["BT14-029"].bySkill[0].unsupported?.some(x => x.includes("historical Spirit Boost")), `${missing}/${status}`);
    }
}
// A real Counter:Counter response moves the payer after payment, then the
// original Counter reads its saved attributes after reload.
for (const p of ["p1", "p2"] as const)
    for (const payerDef of ["RED3", "GREEN3"]) {
        let s = fresh(other(p));
        s.turn = 2;
        const source = stage(s, p, "COUNTER", "hand"), payer = stage(s, p, payerDef, "unison"), response = stage(s, other(p), "RESPONSE", "hand");
        s.cards[payer].markers = 2;
        const before = s.sides[p].zones.hand.length;
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
        let action = RULES.legalActions(ctx, s).map(r => r.action).find(a => a.type === "counter" && a.card === source);
        assert.ok(action);
        s = take(s, action);
        assert.equal(s.cards[payer].markers, 1);
        action = RULES.legalActions(ctx, s).map(r => r.action).find(a => a.type === "counter" && a.card === response);
        assert.ok(action);
        s = take(copy(s), action);
        if (s.prompt.kind === "chooseCards")
            s = take(s, { type: "choose", player: other(p), cards: [payer] });
        assert.ok(s.sides[p].zones.drop.includes(payer), JSON.stringify(s.outcome));
        assert.equal(s.sides[p].zones.hand.length, before - 1 + (payerDef === "RED3" ? 1 : 0));
        cases++;
    }
console.log(`Paid marker history5: ${cases} cases passed`);

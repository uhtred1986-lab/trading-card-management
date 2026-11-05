/** R-445: specified Spirit Boost payer and native supplementary payment. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import { activationsOf } from "../../src/lib/arena/vm/activate";
import { queueDropCost, stepDropCost } from "../../src/lib/arena/vm/drop-costs";
import { counterAbilityAvailability } from "../../src/lib/arena/vm/battle";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const PRINT = [{ "id": "BT14-050", "type": "BATTLE", "colors": ["Blue"], "cost": "4", "z": null, "power": 20000, "name": "Tapion, Calamity Challenger", "characters": ["Tapion"], "traits": ["Hero"], "skill": "[double strike]<br>[ex-evolve]{u}{u}: Blue <Tapion> card with an energy cost of 2 or less.<br>[auto] When this card is played, draw 1 card.<br>[activate: main][limit 1][spirit boost 1]{u}, blue Unison Card with 15000 power or more, you have 3 or more energy: Play this card from your hand.", "backName": null, "backSkill": null }, { "id": "BT17-110", "type": "LEADER", "colors": ["Black"], "cost": null, "z": null, "power": 10000, "name": "Towa", "characters": ["Towa"], "traits": ["Demon Realm Race", "Demon God"], "skill": "[Auto] When this card attacks, play up to 1 Demon Realm Soldier Token. (Demon Realm Soldier Tokens have 5000 power, 0 combo cost, and 5000 combo power.)\r\n[Awaken] When your life is at 3 or less or you have a black Unison Card with a specified cost of 3 in play: You may switch up to 2 of your energy to Active Mode, play up to 1 Demon Realm Soldier Token, and flip this card over.", "backName": "Demon God Towa, Dark Leader", "backSkill": "[auto] When this card attacks, draw 1 card, then play up to 1 Demon Realm Soldier Token. (Demon Realm Soldier Tokens have 5000 power, 0 combo cost, and 5000 combo power.)\r [activate: main][once per turn] Discard 1 card from your hand: Play up to 2 Demon Realm Soldier Tokens in Rest Mode.\r [activate: battle][once per turn][spirit boost 1]{b}, black Unison Card with a specified cost of 3 or more: Choose up to 1 of your Unison Cards and it gets +10000 power and [double strike] for the battle." }, { "id": "BT31-002", "type": "LEADER", "colors": ["Red"], "cost": null, "z": null, "power": 10000, "name": "Janemba", "characters": ["Janemba"], "traits": ["Evil Incarnate"], "skill": "[auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 red \u226aEvil Incarnate\u226b card to your hand, then shuffle your deck.\n[br]\n[awaken] When your life is at 4 or less, or you have 2 or more energy and you have a red Z-Extra in your Battle Area: Draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.", "backName": "Janemba, Blade of Hatred", "backSkill": "[permanent] Negate the keyword skills of all your Battle Cards.\n[br]\n[permanent] During the turn your \u226aEvil Incarnate\u226b card was played, if that card's skill would reduce the power of your opponent's cards or the combo power of your opponent's cards in their Combo Area, reduce it by double that amount instead.\n[br]\n[activate: main] [once per turn] Discard 1 \u226aEvil Incarnate\u226b card from your hand: Draw 2 cards." }, { "id": "EX17-04", "type": "EXTRA", "colors": ["Black"], "cost": "1", "z": null, "power": null, "name": "Hunt of the Demon God", "characters": [], "traits": [], "skill": "[counter: counter] If your Leader Card and energy are all the same color and your opponent has 4 or more energy: Negate the [counter: attack] skill of an Extra Card with an original energy cost of 1 that was activated without paying its energy cost.<br>[activate: main][spirit boost 1] (You must remove a marker from your Unison Card to activate this skill.) {1}, Unison Card with a specified cost, remove this card in your Drop Area from the game: Choose up to 1 of your opponent's Battle Cards with an energy cost greater than their current energy, and until the end of your opponent's next turn, its skills are negated and it can't attack.", "backName": null, "backSkill": null }, { "id": "BT14-071", "type": "BATTLE", "colors": ["Green"], "cost": "3", "z": null, "power": 15000, "name": "Son Goku, Spirit Bomb Unleashed", "characters": ["Son Goku"], "traits": ["Saiyan"], "skill": "[activate: main][limit 1] {g}, if you have 3 or more energy and a green Unison Card in play: Play this card from your hand; if you do, choose up to 1 of your opponent's Unison Cards and remove a marker from it.<br>[activate: main][once per turn][spirit boost x] Green Unison Card: This card gets +5000 power for the turn for each marker you removed from your Unison Card with this skill; if you removed 2 or more markers, this card gains [double strike] for the turn.", "backName": null, "backSkill": null }, { "id": "P-524", "type": "BATTLE", "colors": ["Blue"], "cost": "1", "z": null, "power": 4000, "name": "Android 18, Rebellious Fighter", "characters": ["Android 18"], "traits": ["Android"], "skill": "[auto] When this card is played, look at up to 7 cards from the top of your deck, add up to 1 blue Extra with an energy cost of 1 to your hand, then shuffle your deck.<br>[activate: main][limit 1][spirit boost 1] Blue Unison with 15000 power or more: During that turn, the next time you activate the [activate: main] skill on a blue Extra with an energy cost of 1 from your hand, reduce the energy cost by {u}.", "backName": null, "backSkill": null }, { "id": "P-686", "type": "BATTLE", "colors": ["Black"], "cost": "1", "z": null, "power": 4000, "name": "Trunks, Protector of Discipline", "characters": ["Trunks: Xeno"], "traits": ["Saiyan", "Earthling"], "skill": "[Counter: Attack][Burst 2][Spirit Boost 1] Negate the attack and play this card.\n[br]\n[Auto][Limit 1] If your Leader's back side is a <Vegeks: Xeno> card and you discard 1 card from your hand: When this card is placed in your Drop from your deck by a skill, play this card from its owner's Drop.\n[br]\n[Auto] When this card is played, draw 1 card.", "backName": null, "backSkill": null }, { "id": "BT16-035", "type": "BATTLE", "colors": ["Blue"], "cost": "1", "z": null, "power": 1000, "name": "Videl, Harnessed Power", "characters": ["Videl"], "traits": ["Earthling"], "skill": "[Counter: Attack][Burst 1] Negate the attack and play this card.\r\n[Permanent] This card gains \u226aSaiyan\u226b in all areas.\r\n[Auto] If your {SSG Son Goku, Crimson Warrior} is in a battle and there are no cards in your Combo Area: When your Leader Card's skill places this card in a Drop Area from under your Leader Card, use this card in a combo from your Drop Area.", "backName": null, "backSkill": null }, { "id": "BT27-025", "type": "EXTRA", "colors": ["Red"], "cost": "1", "z": null, "power": null, "name": "Final Battle", "characters": [], "traits": [], "skill": "[Counter: Attack][Limit 1][Spirit Boost 1] Red Z-Unison: Negate the attack, draw 1 card, then choose up to 1 of your red \u226aFierce Foe\u226b cards and it gets +5000 power for the turn.\n[br]\n[Permanent] You can activate this card's [Counter] skill from your hand by adding 1 card from your life to your hand instead of paying its energy cost.", "backName": null, "backSkill": null }, { "id": "BT16-121", "type": "BATTLE", "colors": ["Black"], "cost": "2", "z": null, "power": 5000, "name": "Fin, Evolutionary Premonition", "characters": ["Fin"], "traits": ["Android"], "skill": "[Deflect][Barrier]\r\n[Auto] When this card is played, draw 1 card.\r\n[Activate: Main][Once per turn][Spirit Boost 1] Black Unison Card with a specified cost of 2 or more, you have 4 or more energy: Choose up to 1 black &lt;Fin&gt; card with an energy cost of 8 in your hand and play it on top of this card.", "backName": null, "backSkill": null }, { "id": "EX19-06", "type": "UNISON", "colors": ["Blue"], "cost": "X", "z": null, "power": 19000, "name": "Zamasu, Teamwork Undying", "characters": [], "traits": [], "skill": "[blocker]<br>[counter: attack][spirit boost 2] Blue Unison Card: Negate the attack, then play this card with 4 markers on it.<br>[activate: main]{u}{u}, if there's a <Goku Black> card under this card and you remove 7 markers from this card and place it in its owner's Drop Area: Choose up to 1 {Infinite Force Fused Zamasu} in your hand or Energy Area and play it.<br>[+1][auto] When a card in your Energy Area is placed in its owner's Drop Area, draw 1 card, then switch this card to Active Mode.", "backName": null, "backSkill": null }, { "id": "BT14-046", "type": "BATTLE", "colors": ["Blue"], "cost": "4", "z": null, "power": 20000, "name": "SS3 Gotenks, Calamity Challenger", "characters": ["Gotenks"], "traits": ["Saiyan", "Earthling"], "skill": "[Activate: Main] Choose 1 of your Ghost Tokens and remove it from the game: Choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and return it to its owner's hand.<br>[Activate: Main][Once per turn][Spirit Boost 1] Blue Unison Card with a specified cost of 2 or more: Play 1 Ghost Token with 15000 power.", "backName": null, "backSkill": null }];
PRINT.push(...[{ "id": "BT16-019", "type": "EXTRA", "colors": ["Red"], "cost": "1", "z": null, "power": null, "name": "Universe 7 Unified", "characters": [], "traits": [], "skill": "[Counter: Attack][Burst 1] Negate the attack, then choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn.\r\n[Permanent] If your Leader Card is a mono-red \u226aUniverse 7\u226b card, you can activate this card's [Activate: Battle] skill from your hand without paying its energy cost.\r\n[Activate: Battle][Limit 1][Spirit Boost 1] Choose up to 1 of your Leader Cards or Unison Cards and it gets +10000 power for the battle.", "backName": null, "backSkill": null }, { "id": "P-686", "type": "BATTLE", "colors": ["Black"], "cost": "1", "z": null, "power": 4000, "name": "Trunks, Protector of Discipline", "characters": ["Trunks: Xeno"], "traits": ["Saiyan", "Earthling"], "skill": "[Counter: Attack][Burst 2][Spirit Boost 1] Negate the attack and play this card.\n[br]\n[Auto][Limit 1] If your Leader's back side is a <Vegeks: Xeno> card and you discard 1 card from your hand: When this card is placed in your Drop from your deck by a skill, play this card from its owner's Drop.\n[br]\n[Auto] When this card is played, draw 1 card.", "backName": null, "backSkill": null }, { "id": "BT11-085", "type": "BATTLE", "colors": ["Green"], "cost": "2", "z": null, "power": 15000, "name": "Demon God Dabura, Dark Dominion", "characters": ["Dabura: Xeno"], "traits": ["Demon Realm Race", "Demon God"], "skill": "[Activate: Main] If your Leader Card is green, you discard this card from your hand, and choose 1 of your Unison Cards and remove a marker from it: Add up to 1 green \u226aDark Dragon Ball\u226b card from your deck or Drop Area to your hand, then shuffle your deck if you looked through it.", "backName": null, "backSkill": null }]);
const defs: Record<string, CardDef> = { BASE: card("BASE", { type: "LEADER", colors: ["Blue"] }), FILLER: card("FILLER", { colors: ["Blue"] }), RED: card("RED", { colors: ["Red"] }), BLACK: card("BLACK", { colors: ["Black"] }) };
for (const p of PRINT)
    defs[p.id] = card(p.id, { name: p.name, type: p.type as CardDef["type"], colors: p.colors as CardDef["colors"], characters: p.characters, traits: p.traits, power: p.power ?? 0, energyCost: p.cost === "X" ? "X" : p.cost === null ? 0 : Number(p.cost), zEnergyCost: p.z ? Number(p.z) : 0, skill: p.skill, ...(p.backName ? { back: { name: p.backName, power: 15000, skill: p.backSkill } } : {}) });
for (const [id, color, n, type] of [["BLUE2", "Blue", 2, "UNISON"], ["BLUE1", "Blue", 1, "UNISON"], ["RED2", "Red", 2, "UNISON"], ["BLACK3", "Black", 3, "UNISON"], ["REDZ", "Red", 2, "Z-UNISON"]] as const)
    defs[id] = card(id, { type, colors: [color], energyCost: "X", specifiedCost: parseSpecifiedCost(Array(n).fill(color === "Blue" ? "{u}" : color === "Black" ? "{b}" : "{r}").join(""))!, power: 15000 });
defs["EX19-06"].specifiedCost = parseSpecifiedCost("{u}{u}{u}")!;
defs.MENU = card("MENU", { skill: "[Activate: Main][Spirit Boost 1]{1}, Blue Unison with 15000 power or more: Draw 1 card." });
defs.MENUX = card("MENUX", { skill: "[Activate: Main][Spirit Boost X]{1}, Blue Unison with 15000 power or more: Draw 1 card." });
defs.NOSPEC = card("NOSPEC", { type: "UNISON", colors: ["Black"], energyCost: 0, specifiedCost: {} });
defs.GREENBASE = card("GREENBASE", { type: "LEADER", colors: ["Green"] });
defs.DRAGONBALL = card("DRAGONBALL", { colors: ["Green"], traits: ["Dark Dragon Ball"] });
defs.GOKUBLACK = card("GOKUBLACK", { characters: ["Goku Black"] });
defs.INFINITE = card("INFINITE", { name: "Infinite Force Fused Zamasu", colors: ["Blue"], energyCost: 8, power: 30000 });
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const records = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
function fresh(p: PlayerId) { let s = RULES.createGame(ctx, { seed: 445, p1: { name: "One", leader: "BASE", main: fifty("FILLER") }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER") } }).state as VmState; for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
    s = take(s, a); s.sides.p1.attrs.energyMarkers = 0; s.sides.p2.attrs.energyMarkers = 0; return s; }
let cases = 0;
for (const p of ["p1", "p2"] as const) {
    for (const [id, index, area, payerDef, wrongDef, energyCount] of [
        ["BT14-050", 30, "hand", "BLUE2", "RED2", 3],
        ["BT16-121", 20, "battle", "BLACK3", "BLUE2", 4],
        ["EX17-04", 10, "drop", "BLACK3", "NOSPEC", 1],
    ] as const) for (const valid of [false, true]) {
        let s = fresh(p);
        const source = stage(s, p, id, area), payer = stage(s, p, valid ? payerDef : wrongDef, "unison");
        s.cards[payer].markers = 2;
        for (let i = 0; i < energyCount; i++) stage(s, p, id === "EX17-04" ? "BLACK" : "FILLER", "energy");
        stage(s, p, "FILLER", "drop");
        const action = RULES.legalActions(ctx, s).map(row => row.action).find(action => action.type === "activate" && action.card === source && action.skill === index);
        assert.equal(!!action, valid, `${id} specified payer`);
        if (action) {
            s = take(s, action);
            for (let n = 0; n < 4 && s.prompt.kind === "chooseCards"; n++) s = take(s, { type: "choose", player: p, cards: s.prompt.choice.min ? s.prompt.choice.candidates.slice(0, s.prompt.choice.min) : [] });
            assert.equal(s.cards[payer].markers, 1, `${id} actual payment`);
        }
        cases++;
    }

    for (const marker of [0, 1]) {
        let s = fresh(p);
        s.cards[s.sides[p].zones.leader[0]].cardId = "GREENBASE";
        const source = stage(s, p, "BT11-085", "hand"), payer = stage(s, p, "BLUE2", "unison"), target = stage(s, p, "DRAGONBALL", "drop");
        s.cards[payer].markers = marker;
        const a = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === source);
        assert.equal(!!a, marker === 1, "BT11-085 complete marker action price");
        if (a) {
            s = take(s, a);
            for (let i = 0; i < 4 && s.prompt.kind === "chooseCards"; i++) {
                const candidates = s.prompt.choice.candidates;
                const selected = candidates.includes(payer) ? payer : candidates.includes(target) ? target : null;
                s = take(s, { type: "choose", player: p, cards: selected ? [selected] : [] });
            }
            assert.ok(s.sides[p].zones.drop.includes(source));
            assert.ok(s.sides[p].zones.drop.includes(payer));
            assert.ok(s.sides[p].zones.hand.includes(target));
        }
        cases++;
    }
    for (const id of ["BT16-019", "P-686"]) {
        let s = fresh(other(p));
        s.turn = 2;
        const source = stage(s, p, id, "hand"), payer = stage(s, p, "BLUE2", "unison");
        s.cards[payer].markers = 2;
        const energy = stage(s, p, id === "BT16-019" ? "RED" : "BLACK", "energy");
        const beforeDeck = [...s.sides[p].zones.deck];
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
        const a = RULES.legalActions(ctx, s).map(a => a.action).find(a => a.type === "counter" && a.card === source);
        assert.ok(a, id);
        s = take(s, { ...a, pay: [energy] } as Action);
        assert.equal(s.sides[p].zones.drop.filter(cid => beforeDeck.includes(cid)).length, id === "P-686" ? 2 : 1, `${id} real Burst payment`);
        assert.equal(s.cards[payer].markers, id === "P-686" ? 1 : 2);
        cases++;
    }
    for (const variant of ["reload", "missingBoth", "missingWitness", "badEpoch"]) {
        let s = fresh(p);
        const source = stage(s, p, "EX19-06", "unison"), under = stage(s, p, "GOKUBLACK", "hand");
        moveCard(s, game, under, "under", { owner: p, under: source });
        s.cards[source].markers = 8;
        const line = activationsOf(ctx, s, game.actions.activate, source, game).find(line => line.skillIndex === 20)!;
        assert.ok(line);
        queueDropCost(ctx, game, s, p, line);
        s = copy(s);
        const frame = s.programs[0];
        assert.ok(frame.dropCost?.admission);
        if (variant === "missingBoth")
            delete frame.dropCost!.line.script!.paidAdmission;
        if (variant.startsWith("missing"))
            delete frame.dropCost!.admission;
        if (variant === "badEpoch")
            frame.dropCost!.sourceEpoch = -1;
        const before = copy(s);
        if (variant === "reload") {
            assert.equal(stepDropCost(ctx, game, s, [], frame), "done");
            assert.ok(s.sides[p].zones.drop.includes(source));
        }
        else {
            assert.throws(() => stepDropCost(ctx, game, s, [], frame));
            assert.deepEqual(s, before);
        }
        cases++;
    }
    for (const n of [0, 1, 2]) {
        let s = fresh(p);
        const source = stage(s, p, "MENUX", "battle"), payer = stage(s, p, "BLUE2", "unison");
        s.cards[payer].markers = 3;
        stage(s, p, "FILLER", "energy");
        stage(s, p, "RED", "energy");
        assert.ok(RULES.legalActions(ctx, s).some(x => x.action.type === "activate" && x.action.card === source && x.action.x === n), `X=${n} offered`);
        s = take(s, { type: "activate", player: p, card: source, skill: 0, x: n });
        assert.equal(s.prompt.kind, "payCost");
        s = take(copy(s), { type: "payCost", player: p, option: 0 });
        assert.equal(s.cards[payer].markers, 3 - n);
        cases++;
    }
    for (const variant of ["reload", "reentry", "wrongArea", "lowerPower", "missing", "malformed"]) {
        let s = fresh(p);
        const source = stage(s, p, "MENU", "battle"), payer = stage(s, p, "BLUE2", "unison");
        s.cards[payer].markers = 2;
        stage(s, p, "FILLER", "energy");
        stage(s, p, "RED", "energy");
        s = take(s, { type: "activate", player: p, card: source, skill: 0 });
        assert.equal(s.prompt.kind, "payCost");
        assert.ok(s.prompt.kind === "payCost" && s.prompt.markerPayers?.[0].payer);
        s = copy(s);
        if (variant === "reentry") {
            moveCard(s, game, payer, "hand", { owner: p });
            moveCard(s, game, payer, "unison", { owner: p });
            s.cards[payer].markers = 2;
        }
        if (variant === "wrongArea")
            moveCard(s, game, payer, "hand", { owner: p });
        if (variant === "lowerPower")
            addEffect(s, [], { target: payer, kind: "power", value: -5000, until: "turn" });
        if (s.prompt.kind === "payCost") {
            if (variant === "missing")
                delete s.prompt.markerPayers;
            if (variant === "malformed")
                s.prompt.markerPayers![0].n = 0;
        }
        const before = copy(s);
        if (variant === "reload") {
            s = take(s, { type: "payCost", player: p, option: 0 });
            assert.equal(s.cards[payer].markers, 1);
        }
        else {
            assert.throws(() => take(s, { type: "payCost", player: p, option: 0 }));
            assert.deepEqual(s, before, "failed resume must not mutate resources");
        }
        cases++;
    }
    for (const n of [7, 8]) {
        let s = fresh(p);
        const source = stage(s, p, "EX19-06", "unison"), under = stage(s, p, "GOKUBLACK", "hand"), target = stage(s, p, "INFINITE", "hand");
        assert.ok(moveCard(s, game, under, "under", { owner: p, under: source }).ok);
        s.cards[source].markers = n;
        const energy = [stage(s, p, "FILLER", "energy"), stage(s, p, "FILLER", "energy")];
        const a = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === source && a.skill === 20);
        assert.equal(!!a, n === 8, "EX19 own FAQ:7 markers is not complete payment");
        if (a) {
            s = take(s, { ...a, pay: energy } as Action);
            if (s.prompt.kind === "chooseCards")
                s = take(s, { type: "choose", player: p, cards: [target] });
            assert.ok(s.sides[p].zones.battle.includes(target), JSON.stringify({ prompt: s.prompt, programs: s.programs, source: s.cards[source] }));
            assert.ok(s.sides[p].zones.drop.includes(source));
        }
        cases++;
    }
    for (const variant of ["yes", "wrongColor", "lowSpecified", "wrongSide", "wrongArea", "zero", "negated"]) {
        let s = fresh(p);
        const source = stage(s, p, "BT14-046", "battle"), payer = stage(s, variant === "wrongSide" ? other(p) : p, variant === "wrongColor" ? "RED2" : variant === "lowSpecified" ? "BLUE1" : "BLUE2", variant === "wrongArea" ? "hand" : "unison");
        s.cards[payer].markers = variant === "zero" ? 0 : 2;
        if (variant === "negated") {
            moveCard(s, game, payer, "drop", { owner: p });
            addEffect(s, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "turn" });
        }
        const a = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === source && a.skill === 10);
        assert.equal(!!a, ["yes", "negated"].includes(variant), variant);
        if (a) {
            s = take(s, a);
            assert.equal(s.sides[p].zones.battle.length, 2, JSON.stringify({ variant, prompt: s.prompt, battle: s.sides[p].zones.battle }));
            if (variant === "yes")
                assert.equal(s.cards[payer].markers, 1);
        }
        cases++;
    }
    for (const variant of ["yes", "wrongColor", "short", "shortEnergy", "alt", "altWrong"]) {
        let s = fresh(other(p));
        s.turn = 2;
        const source = stage(s, p, variant.startsWith("alt") ? "BT27-025" : "EX19-06", "hand"), payer = stage(s, p, variant === "alt" ? "REDZ" : variant === "altWrong" ? "RED2" : variant === "wrongColor" ? "RED2" : "BLUE2", "unison");
        s.cards[payer].markers = variant === "short" ? 1 : 3;
        const energy: string[] = [];
        if (!variant.startsWith("alt"))
            for (let i = 0; i < (variant === "shortEnergy" ? 2 : 3); i++)
                energy.push(stage(s, p, "FILLER", "energy"));
        const life = s.sides[p].zones.life.length;
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
        const a = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "counter" && a.card === source && !!a.alt === variant.startsWith("alt"));
        assert.equal(!!a, ["yes", "alt"].includes(variant), variant + " Counter " + JSON.stringify({ cardPrice:cardPrice(ctx,game,s,source),energy:s.sides[p].zones.energy, prompt: s.prompt, availability: counterAbilityAvailability(ctx, game, { ...s, prompt: { kind: "counter", player: p, window: "attack", candidates: [] } }, p, [], []), records: records.filter(r => r.cardId === s.cards[source].cardId).map(r => ({ i: r.skillIndex, unread: r.unread, cost: r.cost?.readable })) }));
        if (a) {
            const result = RULES.apply(ctx, copy(s), { ...a, ...(!variant.startsWith("alt") ? { pay: energy } : {}) } as Action);
            assert.ok(result.events.some(e => e.type === "markers" && e.card === payer && e.delta === (variant === "alt" ? -1 : -2)), "actual supplementary marker payment");
            s = result.state as VmState;
            if (s.prompt.kind === "chooseCards")
                s = take(s, { type: "choose", player: p, cards: [] });
            assert.equal(s.cards[payer].markers, variant === "alt" ? 2 : 0);
            if (variant === "alt")
                assert.equal(s.sides[p].zones.life.length, life - 1);
            else {
                assert.ok(s.sides[p].zones.unison.includes(source));
                assert.equal(s.cards[source].markers, 4);
            }
        }
        cases++;
    }
}
console.log(`Qualified Spirit Boost5: ${cases} scenarios passed`);

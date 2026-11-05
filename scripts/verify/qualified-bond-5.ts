/** R-444: qualified Bond observes Battle Cards and follows supplementary applicability. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { fire } from "../../src/lib/arena/vm/events";
import { run } from "../../src/lib/arena/vm/flow";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const PRINT: {
    id: string;
    type: string;
    colors: string[];
    cost: string | null;
    specified: unknown;
    z: string | null;
    power: number | null;
    name: string;
    characters: string[];
    traits: string[];
    skill: string;
    backName: string | null;
    backSkill: string | null;
}[] = [{ "id": "BT27-048", "type": "Z-BATTLE", "colors": ["Green"], "cost": "1", "specified": null, "z": "2", "power": 10000, "name": "Piccolo, Power-Up", "characters": ["Piccolo"], "traits": ["Namekian", "God"], "skill": "[Dual Attack]\n[br]\n[Permanent][Bond 3] This card gets +10000 power.\n[br]\n[Auto][Bond 5] Green Battle Card: When this card is played, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and KO it.", "backName": null, "backSkill": null }, { "id": "BT31-002", "type": "LEADER", "colors": ["Red"], "cost": null, "specified": null, "z": null, "power": 10000, "name": "Janemba", "characters": ["Janemba"], "traits": ["Evil Incarnate"], "skill": "[auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 red \u226aEvil Incarnate\u226b card to your hand, then shuffle your deck.\n[br]\n[awaken] When your life is at 4 or less, or you have 2 or more energy and you have a red Z-Extra in your Battle Area: Draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.", "backName": "Janemba, Blade of Hatred", "backSkill": "[permanent] Negate the keyword skills of all your Battle Cards.\n[br]\n[permanent] During the turn your \u226aEvil Incarnate\u226b card was played, if that card's skill would reduce the power of your opponent's cards or the combo power of your opponent's cards in their Combo Area, reduce it by double that amount instead.\n[br]\n[activate: main] [once per turn] Discard 1 \u226aEvil Incarnate\u226b card from your hand: Draw 2 cards." }, { "id": "P-470", "type": "Z-BATTLE", "colors": ["Black"], "cost": "1", "specified": null, "z": "2", "power": 15000, "name": "Pan, Search for Another World", "characters": ["Pan: Xeno"], "traits": ["Saiyan", "Earthling"], "skill": "[Auto][Limit 1] If your Leader is a black &lt;Supreme Kai of Time&gt;: When a card is placed from your life in your Drop by one of your Leader skills, add the top card of your deck to your life.<br>[Activate: Main][Limit 1][Bond 3] Card with &lt;Xeno&gt; in its character name: Choose 1 of your opponent's Battle Cards and send it to its owner's Warp.", "backName": null, "backSkill": null }];
const defs: Record<string, CardDef> = { BASE: card("BASE", { type: "LEADER", colors: ["Black"] }), FILLER: card("FILLER", { colors: ["Green"] }), XENO: card("XENO", { characters: ["Son Goku: Xeno"] }), ZXENO: card("ZXENO", { type: "Z-BATTLE", characters: ["Vegeta: Xeno"], colors: ["Green"] }), FIELD: card("FIELD", { skill: "[Field]", type: "EXTRA", characters: ["Son Goku: Xeno"], colors: ["Green"] }), WRONG: card("WRONG", { characters: ["Son Goku"], colors: ["Red"] }), COND: card("COND", { skill: "[Activate: Main][Bond 3] If your Leader is green: Draw 1 card." }), BRACKET: card("BRACKET", { traits: ["Universe 6"], skill: "[Activate: Main][Bond 2] ≪Universe 6≫: Draw 1 card." }), U6: card("U6", { traits: ["Universe 6"] }), COUNTER: card("COUNTER", { energyCost: 0, skill: "[Counter: Attack][Bond 2] ≪Universe 6≫: Negate the attack." }), PROTECTED: card("PROTECTED", { type: "BATTLE", colors: ["Green"], power: 5000, skill: "[Permanent] The skills of this card can't be negated in any area. [Permanent][Bond 3] This card gets +10000 power." }) };
PRINT.push(...[{ "id": "BT2-001", "type": "LEADER", "colors": ["Red"], "cost": null, "specified": null, "z": null, "power": 10000, "name": "Vegito", "characters": ["Vegito"], "traits": ["Saiyan"], "skill": "[Permanent] Each &lt;Son Goku&gt; and &lt;Vegeta&gt; in all of your areas gain red, blue, and green colors.<br>[Auto] When this card attacks, place up to 1 card from the top of your deck in the Drop Area. If that card is red, this card gains +5000 power for the duration of the turn.<br>[Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over.", "backName": "Fusion Warrior Super Saiyan Vegito", "backSkill": "[Permanent] Each &lt;Son Goku&gt; and &lt;Vegeta&gt; in all of your areas gain red, blue, and green colors.<br>[Auto] When this card attacks, draw 1 card, and if there are 10 or more total &lt;Son Goku&gt; or &lt;Vegeta&gt; in your Drop Area, this card gains +5000 power and [Double Strike] for the duration of the turn." }, { "id": "BT17-054", "type": "BATTLE", "colors": ["Blue"], "cost": "2", "specified": null, "z": null, "power": 10000, "name": "Android 14 & Android 15, the Ravagers", "characters": ["Android 14", "Android 15"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Permanent][Bond 3] Blue \u226aAndroid\u226b: This card gets +5000 power.\r\n[Activate: Main][Limit 1] If your Leader Card is a blue \u226aRed Ribbon Army\u226b card and you discard this card from your hand: Look at up to 5 cards from the top of your deck, add up to 1 blue \u226aRed Ribbon Army\u226b card with an energy cost of 5 or less, or 1 {Android 17 & Android 18, Teaming Up} among them to your hand, then shuffle your deck.", "backName": null, "backSkill": null }, { "id": "BT13-015", "type": "BATTLE", "colors": ["Red"], "cost": "2", "specified": null, "z": null, "power": 10000, "name": "Son Gohan, Saiyan Combo", "characters": ["Son Gohan: Adolescence"], "traits": ["Saiyan", "Earthling", "Universe 7"], "skill": "[Deflect]<br>[Permanent][Bond 3] Red \u226aSaiyan\u226b cards: This card gets +10000 power and [Blocker].<br>[Auto] When this card is played from your hand, look at up to 7 cards from the top of your deck, play up to 1 red \u226aSaiyan\u226b card with an energy cost of 1 among them, then shuffle your deck.", "backName": null, "backSkill": null }, { "id": "P-698", "type": "BATTLE", "colors": ["Red"], "cost": "5", "specified": null, "z": null, "power": 20000, "name": "SS Bardock, Burning Fighting Spirit", "characters": ["Bardock"], "traits": ["Saiyan", "Bardock's Crew"], "skill": "[permanent] All your red \u226aBardock's Crew\u226b cards with original energy costs of 1 gain [barrier].<br>[permanent][bond 3] Red \u226aSaiyan\u226b or \u226aBardock's Crew\u226b card: Your Leader gets +10000 power.<br>[activate: main][limit 1]{r}, if your Leader is a red <Bardock> card and your opponent has 2 or more energy: Draw 1 card and play this card from your hand.", "backName": null, "backSkill": null }, { "id": "BT17-055", "type": "BATTLE", "colors": ["Blue"], "cost": "2", "specified": null, "z": null, "power": 5000, "name": "Android 15, Inorganic Horror", "characters": ["Android 15"], "traits": ["Android", "Red Ribbon Army"], "skill": "[Deflect]\r\n[Counter: Play] Play this card, and if the Battle Card being played has an energy cost of 3 or less, return it to its owner's hand instead.\r\n[Permanent] If your Leader Card is a blue \u226aRed Ribbon Army\u226b card, you can activate this card's [Counter] skill from your energy by paying its energy cost.\r\n[Permanent][Bond 3] Blue \u226aAndroid\u226b: This card gets +10000 power.", "backName": null, "backSkill": null }]);
for (const p of PRINT)
    defs[p.id] = card(p.id, { type: p.type as CardDef["type"], colors: p.colors as CardDef["colors"], characters: p.characters, traits: p.traits, power: p.power ?? 0, energyCost: p.cost === null ? 0 : Number(p.cost), zEnergyCost: p.z ? Number(p.z) : 0, skill: p.skill, ...(p.backName ? { back: { name: p.backName, power: 15000, skill: p.backSkill } } : {}) });
defs.UNDER = card("UNDER", { skill: "[Permanent][Bond 2] Green Battle Cards: When this card is under a card, the <Majin Buu> on top of this card gains [Barrier]." });
defs.BUU = card("BUU", { colors: ["Green"], characters: ["Majin Buu"] });
defs.CYCLE = card("CYCLE", { skill: "[Permanent][Bond 2] Negate the keyword skills of all your Battle Cards." });
defs.CYCLEIDENTITY = card("CYCLEIDENTITY", { skill: "[Permanent][Bond 2] This card gains ≪Saiyan≫ in all areas." });
defs.CYCLEPROTECT = card("CYCLEPROTECT", { skill: "[Permanent][Bond 2] The skills of this card can't be negated in any area." });
defs.PROTECTOR = card("PROTECTOR", { skill: "[Permanent] The skills of your Battle Cards can't be negated." });
defs.ANDROID = card("ANDROID", { colors: ["Blue"], traits: ["Android"] });
defs.REDANDROID = card("REDANDROID", { colors: ["Red"], traits: ["Android"] });
defs.GOKU = card("GOKU", { colors: ["Yellow"], characters: ["Son Goku"], traits: ["Saiyan"] });
defs.TARGET = card("TARGET", { skill: "[Barrier]" });
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const records = Object.values(defs).flatMap(skillRecords);
for (const id of ["BT27-048", "P-470"]) {
    const r = records.find(r => r.cardId === id && r.printed.toLowerCase().includes("[bond") && r.kind !== "permanent")!;
    assert.equal(r.cost?.readable, true, id);
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
function fresh(p: PlayerId) { let s = RULES.createGame(ctx, { seed: 444, p1: { name: "One", leader: "BASE", main: fifty("FILLER"), z: ["BT27-048"] }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER"), z: ["BT27-048"] } }).state as VmState; for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
    s = take(s, a); return s; }
const offered = (s: VmState, id: string) => RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === id);
let cases = 0;
for (const p of ["p1", "p2"] as const) {
    {
        const s = fresh(p), source = stage(s, p, "BT13-015", "battle");
        stage(s, p, "GOKU", "battle");
        stage(s, p, "GOKU", "battle");
        assert.equal(Number(attrsNow(ctx, game, s, source).power), Number(defs["BT13-015"].power));
        s.cards[s.sides[p].zones.leader[0]].cardId = "BT2-001";
        assert.equal(Number(attrsNow(ctx, game, s, source).power), Number(defs["BT13-015"].power) + 10000, "Bond sees standing gained red");
        cases++;
    }
    for (const id of ["BT17-054", "BT17-055"])
        for (const extra of ["ANDROID", "REDANDROID", "FIELD"]) {
            const s = fresh(p), source = stage(s, p, id, "battle");
            stage(s, p, "ANDROID", "battle");
            stage(s, p, extra, "battle");
            assert.equal(Number(attrsNow(ctx, game, s, source).power), Number(defs[id].power) + (extra === "ANDROID" ? (id === "BT17-054" ? 5000 : 10000) : 0), id + " colored single qualifier");
            cases++;
        }
    {
        const row = records.find(r => r.cardId === "P-698" && r.skillIndex === 10)!;
        assert.ok(runtimeSupportOfRow(row).unsupported.some(x => x.includes("Bond Permanent selector")));
        const draft = { ...ctx, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
        const s = fresh(p), source = stage(s, p, "P-698", "battle");
        assert.throws(() => attrsNow(draft, game, s, source), NotYet, "unknown P698 is explicit in draft runtime");
        cases++;
    }
    for (const match of ["FILLER", "FIELD"]) {
        const s = fresh(p), top = stage(s, p, "BUU", "battle"), under = stage(s, p, "UNDER", "hand");
        assert.ok(moveCard(s, game, under, "under", { owner: p, under: top }).ok);
        stage(s, p, match, "battle");
        assert.equal(hasKeyword(ctx, game, s, top, "Barrier"), match === "FILLER", "under-pile specified Bond");
        cases++;
    }
    for (const mode of ["falls", "negated", "late"]) {
        const s = fresh(p), source = stage(s, p, "BT27-048", "battle"), foe = stage(s, other(p), "TARGET", "battle"), matches: string[] = [];
        if (mode !== "late")
            for (let i = 0; i < 4; i++)
                matches.push(stage(s, p, "FILLER", "battle"));
        fire(ctx, game, s, { event: "moved", card: source, controller: p, args: { asPlay: true, to: "battle", from: "zDeck" } });
        assert.equal(s.pending.some(x => x.card === source), mode !== "late");
        if (mode === "late")
            for (let i = 0; i < 4; i++)
                stage(s, p, "FILLER", "battle");
        else {
            moveCard(s, game, matches[0], "hand", { owner: p });
            if (mode === "negated")
                addEffect(s, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "turn" });
        }
        run(ctx, game, s, []);
        let next = s;
        if (s.prompt.kind === "chooseCards")
            next = take(s, { type: "choose", player: p, cards: [foe] });
        assert.equal(next.sides[other(p)].zones.drop.includes(foe), mode === "negated", mode + " pending Bond recheck");
        cases++;
    }
    for (const name of ["CYCLE", "CYCLEPROTECT", "CYCLEIDENTITY"]) {
        const s = fresh(p), source = stage(s, p, name, "battle");
        assert.throws(() => attrsNow(ctx, game, s, source), NotYet);
        cases++;
    }
    {
        const s = fresh(p), source = stage(s, p, "BT27-048", "battle");
        stage(s, p, "PROTECTOR", "battle");
        s.cards[s.sides[p].zones.leader[0]].cardId = "BT31-002";
        s.cards[s.sides[p].zones.leader[0]].flipped = true;
        assert.equal(Number(attrsNow(ctx, game, s, source).power), Number(defs["BT27-048"].power), "standing beNegated keeps Bond active below three");
        cases++;
    }
    for (const variant of ["five", "four", "field", "wrongColor", "wrongSide", "wrongArea", "zBattle", "protected", "timed", "standing"]) {
        let s = fresh(p);
        const z = s.sides[p].zones.zDeck[0], foe = stage(s, other(p), "TARGET", "battle");
        stage(s, p, "FILLER", "energy");
        for (let n = 0; n < defs["BT27-048"].zEnergyCost!; n++)
            stage(s, p, "FILLER", "zEnergy");
        if (variant !== "timed" && variant !== "standing") {
            for (let i = 0; i < 3; i++)
                stage(s, p, "FILLER", "battle");
            if (variant !== "four") {
                const id = stage(s, variant === "wrongSide" ? other(p) : p, variant === "field" ? "FIELD" : variant === "wrongColor" ? "WRONG" : variant === "zBattle" ? "ZXENO" : "FILLER", variant === "wrongArea" ? "hand" : "battle");
                if (variant === "protected")
                    addEffect(s, [], { target: id, kind: "immune", value: 0, until: "game", immune: {} });
            }
        }
        if (variant === "timed")
            addEffect(s, [], { target: z, kind: "negateSkillKind", value: "keyword", until: "game" });
        if (variant === "standing") {
            s.cards[s.sides[p].zones.leader[0]].cardId = "BT31-002";
            s.cards[s.sides[p].zones.leader[0]].flipped = true;
        }
        s = take(s, { type: "playZ", player: p, card: z });
        if (s.prompt.kind === "chooseCards")
            s = take(s, { type: "choose", player: p, cards: [foe] });
        const yes = ["five", "zBattle", "protected", "timed", "standing"].includes(variant);
        assert.equal(s.sides[other(p)].zones.drop.includes(foe), yes, variant + " native Auto");
        cases++;
    }
    for (const variant of ["yes", "wrong", "field"]) {
        let s = fresh(other(p));
        s.turn = 2;
        const source = stage(s, p, "COUNTER", "hand");
        stage(s, p, "U6", "battle");
        stage(s, p, variant === "wrong" ? "WRONG" : variant === "field" ? "FIELD" : "U6", "battle");
        s = take(s, { type: "attack", player: other(p), attacker: s.sides[other(p)].zones.leader[0], target: s.sides[p].zones.leader[0] });
        const a = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "counter" && a.card === source);
        assert.equal(!!a, variant === "yes", variant + " Counter Bond");
        if (a) {
            s = take(s, a);
            assert.ok(s.sides[p].zones.drop.includes(source));
            assert.equal(s.battle?.negated ?? true, true);
        }
        cases++;
    }
    for (const variant of ["yes", "short", "wrongName", "field", "wrongArea", "wrongSide", "zBattle", "protected", "timed", "standing"]) {
        let s = fresh(p);
        const source = stage(s, p, "P-470", "battle"), foe = stage(s, other(p), "FILLER", "battle");
        if (variant !== "timed" && variant !== "standing") {
            stage(s, p, "XENO", "battle");
            if (variant !== "short") {
                const match = stage(s, variant === "wrongSide" ? other(p) : p, variant === "wrongName" ? "WRONG" : variant === "field" ? "FIELD" : variant === "zBattle" ? "ZXENO" : "XENO", variant === "wrongArea" ? "hand" : "battle");
                if (variant === "protected")
                    addEffect(s, [], { target: match, kind: "immune", value: 0, until: "game", immune: {} });
            }
        }
        if (variant === "timed")
            addEffect(s, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "turn" });
        if (variant === "standing") {
            s.cards[s.sides[p].zones.leader[0]].cardId = "BT31-002";
            s.cards[s.sides[p].zones.leader[0]].flipped = true;
        }
        const a = offered(s, source), yes = ["yes", "zBattle", "protected", "timed", "standing"].includes(variant);
        assert.equal(!!a, yes, variant);
        if (a) {
            s = take(s, a);
            if (s.prompt.kind === "chooseCards")
                s = take(s, { type: "choose", player: p, cards: [foe] });
            assert.ok(s.sides[other(p)].zones.warp.includes(foe));
        }
        cases++;
    }
    for (const negated of [false, true]) {
        const s = fresh(p), source = stage(s, p, "COND", "battle");
        if (negated)
            addEffect(s, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "turn" });
        assert.equal(!!offered(s, source), false, "ordinary Leader condition survives Bond suppression");
        cases++;
    }
    for (const extra of ["U6", "WRONG", "FIELD"]) {
        const s = fresh(p), source = stage(s, p, "BRACKET", "battle");
        stage(s, p, extra, "battle");
        assert.equal(!!offered(s, source), extra === "U6", "existing bracketed Activate qualifier");
        cases++;
    }
    for (const variant of ["active", "twoFields", "zBattle", "timed", "standing", "protected"]) {
        const s = fresh(p), id = stage(s, p, variant === "protected" ? "PROTECTED" : "BT27-048", "battle");
        if (variant === "twoFields") {
            stage(s, p, "FIELD", "battle");
            stage(s, p, "FIELD", "battle");
        }
        if (variant === "zBattle") {
            stage(s, p, "ZXENO", "battle");
            stage(s, p, "FILLER", "battle");
        }
        if (variant === "timed")
            addEffect(s, [], { target: id, kind: "negateSkillKind", value: "keyword", until: "turn" });
        if (variant === "standing" || variant === "protected") {
            s.cards[s.sides[p].zones.leader[0]].cardId = "BT31-002";
            s.cards[s.sides[p].zones.leader[0]].flipped = true;
        }
        const expected = Number(defs[s.cards[id].cardId].power) + (["zBattle", "timed", "standing"].includes(variant) ? 10000 : 0);
        assert.equal(Number(attrsNow(ctx, game, s, id).power), expected, variant);
        cases++;
    }
}
console.log(`Qualified Bond 5: ${cases} stored/native scenarios passed`);

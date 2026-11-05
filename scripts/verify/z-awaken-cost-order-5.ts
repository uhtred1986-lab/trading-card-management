/** R-443: stored Z-Awaken competing costs, both player-selected orders. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { poolSelection } from "../../src/lib/arena/vm/pooled-costs";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const PRINT = [{ "id": "EX21-28", "type": "Z-LEADER", "colors": ["Yellow"], "cost": null, "specified": null, "z": "1", "power": 15000, "name": "Fused Zamasu, Righteous Iniquity", "characters": ["Zamasu"], "traits": ["God"], "skill": "[z-awaken]{y}, if your life is at 4 or less and you send 1 <Zamasu> card and 1 <Goku Black> card from your Z-Energy to your Warp: Yellow <Goku Black>.<br>[auto] When this card attacks, draw 1 card.<br>[activate: battle][once per turn] Place 2 non-[super combo] <Zamasu> and/or <Goku Black> cards from your Drop at the bottom of your deck in any order: This card gets +5000 power and [double strike] for the battle, then choose up to 1 of your <Zamasu> cards and switch it to Active Mode at the end of the turn.", "backName": null, "backSkill": null }, { "id": "BT19-003", "type": "Z-LEADER", "colors": ["Red"], "cost": null, "specified": null, "z": "1", "power": 15000, "name": "SS Son Goku, United Onslaught", "characters": ["Son Goku"], "traits": ["Saiyan"], "skill": "[double strike]<br>[z-awaken]{r}, place up to 3 of your Z-Energy under your Leader: Red <Son Goku> <Vegeta> <Trunks: Future>.<br>[auto] When this card attacks, for each non-Leader card under this card, this card gets +10000 power for the battle.<br>[auto] Place all non-Leader cards from under this card in their owners' Drops: At the end of your turn, choose all of your opponent's Battle Cards, they get -10000 power for the turn for each card placed in a Drop by this skill, and remove this card from the game.", "backName": null, "backSkill": null }];
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const defs: Record<string, CardDef> = { BASE: card("BASE", { type: "LEADER", colors: ["Yellow", "Red"], characters: ["Goku Black", "Son Goku", "Vegeta", "Trunks: Future"], back: { name: "Awakened Test Leader", power: 15000, skill: null } }), FILLER: card("FILLER", { colors: ["Yellow", "Red"] }), ZAMASU: card("ZAMASU", { characters: ["Zamasu"] }), BLACK: card("BLACK", { characters: ["Goku Black"] }), DUAL: card("DUAL", { characters: ["Zamasu", "Goku Black"] }) };
for (const p of PRINT)
    defs[p.id] = card(p.id, { type: "Z-LEADER", colors: p.colors as CardDef["colors"], characters: p.characters, traits: p.traits, zEnergyCost: Number(p.z), power: p.power, skill: p.skill });
const records = Object.values(defs).flatMap(skillRecords), rows = PRINT.map(p => records.find(r => r.cardId === p.id && r.printed.toLowerCase().includes("[z-awaken]"))!);
for (const r of rows) {
    assert.equal(r.cost?.readable, true, r.cardId);
    assert.deepEqual(runtimeSupportOfRow(r).unsupported, []);
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function stage(s: VmState, p: PlayerId, id: string, area: string) { const cid = s.sides[p].zones.deck.at(-1)!; s.cards[cid].cardId = id; assert.ok(moveCard(s, game, cid, area, { owner: p }).ok); s.pending = []; return cid; }
function fresh(p: PlayerId, id: string, pool: string[]) { let s = RULES.createGame(ctx, { seed: 443, p1: { name: "One", leader: "BASE", main: fifty("FILLER"), z: [id] }, p2: { name: "Two", leader: "BASE", main: fifty("FILLER"), z: [id] } }).state as VmState; for (const a of [{ type: "chooseFirst", player: s.chooser, first: p }, { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false }, { type: "charge", player: p, card: null }] as Action[])
    s = take(s, a); s.cards[s.sides[p].zones.leader[0]].flipped = true; while (s.sides[p].zones.life.length > 4)
    moveCard(s, game, s.sides[p].zones.life.at(-1)!, "hand", { owner: p }); for (const id of pool)
    stage(s, p, id, "zEnergy"); stage(s, p, "FILLER", "energy"); return s; }
function offer(s: VmState) { return RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === s.sides[s.turnPlayer].zones.zDeck[0]); }
let cases = 0;
for (const p of ["p1", "p2"] as const) {
    for(const order of [0,1]){
      const cx={...ctx,defs:{...defs,"EX21-28":{...defs["EX21-28"],zEnergyCost:2}}};const apply=(s:VmState,a:Action)=>RULES.apply(cx,copy(s),a).state as VmState;
      let s=fresh(p,"EX21-28",["FILLER","ZAMASU","BLACK","FILLER"]);const z=s.sides[p].zones.zDeck[0],pool=s.sides[p].zones.zEnergy.slice(),selection=poolSelection(s,z);selection.pools=[{cost:"zEnergy",n:2,cards:[{card:pool[0],epoch:s.cards[pool[0]].zoneEpoch??0}]}];const a=RULES.legalActions(cx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===z)!;s=apply(s,{...a,payPools:selection} as Action);s=apply(s,{type:"chooseMode",player:p,index:order});while(s.prompt.kind==="chooseCards"){assert.ok(!s.prompt.choice.candidates.includes(pool[0]),"prefix remains selected");s=apply(copy(s),{type:"choose",player:p,cards:[s.prompt.choice.candidates[0]]});}assert.equal(s.sides[p].zones.leader[0],z);assert.deepEqual(new Set(s.sides[p].zones.drop),new Set([pool[0],pool[3]]));cases++;
    }
    {const s=fresh(p,"EX21-28",["ZAMASU","BLACK","FILLER"]),before=copy(s);assert.throws(()=>take(s,{...offer(s)!,payPools:null} as unknown as Action));assert.deepEqual(copy(s),before);cases++;}

    for(const order of [0,1])for(const bad of [false,true]){
      let s=fresh(p,"EX21-28",["ZAMASU","BLACK","FILLER","FILLER"]);const z=s.sides[p].zones.zDeck[0],pool=s.sides[p].zones.zEnergy.slice(),firstEnergy=s.sides[p].zones.energy[0],pickedEnergy=stage(s,p,"FILLER","energy"),selection=poolSelection(s,z);selection.pools=[{cost:"zEnergy",n:1,cards:[{card:pool[bad?0:3],epoch:s.cards[pool[bad?0:3]].zoneEpoch??0}]}];const action={...offer(s)!,pay:[pickedEnergy],payPools:selection} as Action;
      if(bad){const before=copy(s);assert.throws(()=>take(s,action));assert.deepEqual(copy(s),before);cases++;continue;}
      s=take(s,action);s=take(s,{type:"chooseMode",player:p,index:order});while(s.prompt.kind==="chooseCards")s=take(copy(s),{type:"choose",player:p,cards:[s.prompt.choice.candidates[0]]});assert.equal(s.sides[p].zones.leader[0],z);assert.ok(s.sides[p].zones.drop.includes(pool[3]));assert.ok(s.sides[p].zones.zEnergy.includes(pool[2]));assert.equal(s.cards[pickedEnergy].mode,"rest");assert.equal(s.cards[firstEnergy].mode,"active");cases++;
    }
    {let s=fresh(p,"EX21-28",["ZAMASU","BLACK","FILLER"]);s=take(s,offer(s)!);const f=s.programs.find(f=>f.keywordCost?.zAwaken)!;delete f.keywordCost!.zAwaken;const before=copy(s);assert.throws(()=>take(copy(s),{type:"chooseMode",player:p,index:0}),/rebuild this saved Z-Awaken/);assert.deepEqual(copy(s),before);cases++;}

    for (const fault of ["oneName", "sameDual", "wrongArea", "wrongSide", "life", "energy", "replacedNative", "replacedSkill"]) {
        const s = fresh(p, "EX21-28", fault === "sameDual" ? ["DUAL", "FILLER"] : ["ZAMASU", "BLACK", "FILLER"]), pool = s.sides[p].zones.zEnergy.slice();
        if (fault === "oneName")
            s.cards[pool[1]].cardId = "FILLER";
        if (fault === "wrongArea")
            moveCard(s, game, pool[1], "drop", { owner: p });
        if (fault === "wrongSide") {
            s.cards[pool[1]].cardId = "FILLER";
            stage(s, other(p), "BLACK", "zEnergy");
        }
        if (fault === "life")
            stage(s, p, "FILLER", "life");
        if (fault === "energy")
            s.cards[s.sides[p].zones.energy[0]].mode = "rest";
        if (fault === "replacedNative" || fault === "replacedSkill") {
            const id = pool[fault === "replacedNative" ? 2 : 0];
            addEffect(s, [], { target: id, kind: "replaceLeave", value: { to: fault === "replacedNative" ? "drop" : "warp", target: { special: "self" } }, until: "turn", source: id, master: p });
        }
        const before = copy(s);
        assert.equal(!!offer(s), false, fault);
        assert.deepEqual(copy(s), before);
        cases++;
    }
    for (const order of [0, 1]) {
        let s = fresh(p, "EX21-28", ["DUAL", "ZAMASU", "FILLER"]);
        const z = s.sides[p].zones.zDeck[0], pool = s.sides[p].zones.zEnergy.slice();
        s = take(s, offer(s)!);
        s = take(s, { type: "chooseMode", player: p, index: order });
        for (let i = 0; i < 8 && s.sides[p].zones.leader[0] !== z; i++) {
            assert.equal(s.prompt.kind, "chooseCards");
            if (s.prompt.kind !== "chooseCards")
                throw Error("choice");
            const ids = s.prompt.choice.candidates;
            const picked = ids.includes(pool[2]) ? pool[2] : ids.includes(pool[1]) ? pool[1] : pool[0];
            s = take(s, { type: "choose", player: p, cards: [picked] });
        }
        assert.equal(s.sides[p].zones.leader[0], z);
        assert.ok(s.sides[p].zones.warp.includes(pool[0]) && s.sides[p].zones.warp.includes(pool[1]));
        cases++;
    }
    for (const order of [0, 1]) {
        let s = fresh(p, "BT19-003", ["FILLER"]);
        const z = s.sides[p].zones.zDeck[0];
        s = take(s, offer(s)!);
        s = take(s, { type: "chooseMode", player: p, index: order });
        if (s.prompt.kind === "chooseCards") {
            assert.equal(s.prompt.choice.min, 0);
            assert.deepEqual(s.prompt.choice.candidates, []);
            s = take(s, { type: "choose", player: p, cards: [] });
        }
        assert.equal(s.sides[p].zones.leader[0], z);
        assert.equal(s.cards[z].under.length, 1);
        cases++;
    }
    for (const fault of ["source", "base"]) {
        let s = fresh(p, "EX21-28", ["ZAMASU", "BLACK", "FILLER"]);
        const z = s.sides[p].zones.zDeck[0], base = s.sides[p].zones.leader[0];
        s = take(s, offer(s)!);
        const id = fault === "source" ? z : base;
        s.cards[id].zoneEpoch = (s.cards[id].zoneEpoch ?? 0) + 2;
        s = take(copy(s), { type: "chooseMode", player: p, index: 0 });
        assert.equal(s.sides[p].zones.leader[0], base);
        assert.equal(s.sides[p].zones.zEnergy.length, 3);
        assert.equal(s.cards[s.sides[p].zones.energy[0]].mode, "active");
        assert.equal(s.sides[p].attrs.zAwakens ?? 0, 0);
        cases++;
    }
    {
        let s = fresh(p, "BT19-003", ["FILLER", "FILLER", "FILLER", "FILLER"]);
        const z = s.sides[p].zones.zDeck[0], base = s.sides[p].zones.leader[0], id = s.sides[p].zones.zEnergy[0];
        s = take(s, offer(s)!);
        s = take(s, { type: "chooseMode", player: p, index: 1 });
        s = take(s, { type: "choose", player: p, cards: [id] });
        s.cards[id].zoneEpoch = (s.cards[id].zoneEpoch ?? 0) + 2;
        s = take(copy(s), { type: "choose", player: p, cards: [] });
        assert.equal(s.sides[p].zones.leader[0], base);
        assert.equal(s.sides[p].zones.zEnergy.length, 4);
        assert.equal(s.sides[p].attrs.zAwakens ?? 0, 0);
        assert.equal(s.cards[z].under.length, 0);
        cases++;
    }
    // Protocol scaling: two native payers suspend independently; the second
    // occurrence cannot be replaced after the first has already paid.
    for (const fault of ["none", "staleSecond", "replaceFirst"]) {
        const cx = { ...ctx, defs: { ...defs, "EX21-28": { ...defs["EX21-28"], zEnergyCost: 2 } } };
        const apply = (s: VmState, a: Action) => RULES.apply(cx, copy(s), a).state as VmState;
        let s = fresh(p, "EX21-28", ["ZAMASU", "BLACK", "FILLER", "FILLER"]);
        const z = s.sides[p].zones.zDeck[0], base = s.sides[p].zones.leader[0], pool = s.sides[p].zones.zEnergy.slice();
        for (const id of pool.slice(2))
            addEffect(s, [], { target: id, kind: "replaceLeave", value: { to: "warp", optional: true, target: { special: "self" } }, until: "turn", source: id, master: p });
        const a = RULES.legalActions(cx, s).map(x => x.action).find(a => a.type === "activate" && a.card === z);
        assert.ok(a);
        s = apply(s, a);
        s = apply(s, { type: "chooseMode", player: p, index: 0 });
        while (s.prompt.kind === "chooseCards") {
            const id = s.prompt.choice.candidates.find(id => pool.slice(2).includes(id));
            assert.ok(id);
            s = apply(s, { type: "choose", player: p, cards: [id] });
        }
        assert.equal(s.prompt.kind, "replaceMove");
        s = apply(s, { type: "chooseMode", player: p, index: fault === "replaceFirst" ? 0 : 1 });
        if (fault === "replaceFirst") {
            assert.equal(s.sides[p].zones.leader[0], base);
            assert.equal(s.sides[p].attrs.zAwakens ?? 0, 0);
            assert.ok(s.sides[p].zones.warp.includes(pool[2]));
            cases++;
            continue;
        }
        assert.equal(s.prompt.kind, "replaceMove");
        assert.ok(s.sides[p].zones.drop.includes(pool[2]));
        if (fault === "staleSecond") {
            s.cards[pool[3]].zoneEpoch = (s.cards[pool[3]].zoneEpoch ?? 0) + 2;
            const before = copy(s);
            assert.throws(() => apply(s, { type: "chooseMode", player: p, index: 1 }));
            assert.deepEqual(copy(s), before);
            assert.equal(s.sides[p].zones.leader[0], base);
            assert.equal(s.sides[p].attrs.zAwakens ?? 0, 0);
            cases++;
            continue;
        }
        s = apply(copy(s), { type: "chooseMode", player: p, index: 1 });
        while (s.prompt.kind === "chooseCards")
            s = apply(s, { type: "choose", player: p, cards: [s.prompt.choice.candidates[0]] });
        assert.equal(s.sides[p].zones.leader[0], z);
        assert.ok(s.sides[p].zones.drop.includes(pool[3]));
        cases++;
    }
    for (const order of [0, 1]) {
        let s = fresh(p, "EX21-28", ["ZAMASU", "BLACK", "FILLER"]);
        const z = s.sides[p].zones.zDeck[0], base = s.sides[p].zones.leader[0], pool = s.sides[p].zones.zEnergy.slice(), before = copy(s), a = offer(s);
        assert.ok(a);
        assert.deepEqual(copy(s), before);
        s = take(s, a);
        assert.equal(s.prompt.kind, "chooseMode");
        s = take(s, { type: "chooseMode", player: p, index: order });
        for (let i = 0; i < 8 && s.sides[p].zones.leader[0] !== z; i++) {
            assert.equal(s.prompt.kind, "chooseCards", JSON.stringify(s.prompt));
            if (s.prompt.kind !== "chooseCards")
                throw Error("choice");
            const candidates = s.prompt.choice.candidates;
            const chosen = candidates.includes(pool[2]) ? pool[2] : candidates[0];
            s = take(copy(s), { type: "choose", player: p, cards: [chosen] });
        }
        assert.equal(s.sides[p].zones.leader[0], z);
        assert.deepEqual(new Set(s.sides[p].zones.warp), new Set(pool.slice(0, 2)));
        assert.ok(s.sides[p].zones.drop.includes(pool[2]));
        assert.deepEqual(s.cards[z].under, [base]);
        assert.equal(s.sides[p].attrs.zAwakens, 1);
        cases++;
    }
    for (const order of [0, 1])
        for (const n of [0, 1, 2, 3]) {
            let s = fresh(p, "BT19-003", ["FILLER", "FILLER", "FILLER", "FILLER"]);
            const z = s.sides[p].zones.zDeck[0], base = s.sides[p].zones.leader[0], a = offer(s);
            assert.ok(a);
            s = take(s, a);
            s = take(s, { type: "chooseMode", player: p, index: order });
            let selected = 0;
            for (let i = 0; i < 12 && s.sides[p].zones.leader[0] !== z; i++) {
                assert.equal(s.prompt.kind, "chooseCards", JSON.stringify({ order, n, prompt: s.prompt, programs: s.programs }));
                if (s.prompt.kind !== "chooseCards")
                    throw Error("choice");
                const optional = s.prompt.choice.min === 0;
                const chosen = optional && selected >= n ? [] : [s.prompt.choice.candidates[0]];
                if (optional && chosen.length)
                    selected++;
                s = take(copy(s), { type: "choose", player: p, cards: chosen });
            }
            assert.equal(s.sides[p].zones.leader[0], z);
            assert.equal(s.cards[z].under.length, n + 1);
            assert.equal(s.cards[z].under[0], base);
            assert.equal(s.sides[p].zones.zEnergy.length, 3 - n);
            assert.equal(s.sides[p].attrs.zAwakens, 1);
            cases++;
        }
}
console.log(`Z-Awaken cost order 5: ${cases} stored/native scenarios passed`);

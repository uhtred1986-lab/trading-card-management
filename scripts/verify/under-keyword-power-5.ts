/** R468: under-card negation suppresses effective keyword power, not printed identity. */
import assert from "node:assert/strict";
import { RULES } from "../../src/lib/arena/vm";
import { card, fifty } from "./harness";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, resolveSelector } from "../../src/lib/arena/vm/program";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import type { EngineContext } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs={L:card("L",{type:"LEADER"}),F:card("F",{}),HOST:card("HOST",{}),TRUNKS:card("TRUNKS",{name:"Trunks, Domination Complete",power:5000,skill:"[Servant]"})};
const ctx:EngineContext={defs};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
assert.deepEqual(Object.entries(game.keywords).filter(([,definition])=>definition.hooks?.some(h=>h.at==="attrBonus")).map(([name])=>name),["Servant"],"complete current attrBonus keyword census");
let cases=1;
for(const owner of ["p1","p2"] as const){
 let s=RULES.createGame(ctx,{seed:468,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const stage=(def:string)=>{const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,"battle",{owner}).ok);return id;};
 const host=stage("HOST"),source=stage("TRUNKS");
 assert.equal(attrsNow(ctx,game,s,source).power,15000);assert.equal(attrsNow(ctx,game,s,source).originalPower,5000);
 assert.ok(moveCard(s,game,source,"battle",{owner,under:host}).ok);s=JSON.parse(JSON.stringify(s));
 const buried=attrsNow(ctx,game,s,source);
 assert.equal(buried.power,5000,"Servant's Permanent power bonus is negated under a card");assert.equal(buried.originalPower,5000);
 assert.deepEqual(resolveSelector(ctx,game,s,{ops:[],ip:0,vars:{},card:host,master:owner},{side:"you",area:"under",underHost:{special:"self"},filter:{...emptyFilter(),keywords:["Servant"]}}),[source],"explicit under-card selector retains printed Servant identity");
 assert.ok(moveCard(s,game,source,"battle",{owner}).ok);s=JSON.parse(JSON.stringify(s));
 assert.equal(attrsNow(ctx,game,s,source).power,15000);assert.equal(attrsNow(ctx,game,s,source).originalPower,5000);cases++;
}
console.log(`under-keyword-power-5: ${cases} census/native-query cases passed`);

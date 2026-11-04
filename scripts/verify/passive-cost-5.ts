/** R-441: possessive passive cost modifiers retain original-cost and Battle Area scope. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moved } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const print="[Permanent] All of your red ≪Bardock's Crew≫ cards in your Battle Area with original energy costs of 1 have their energy costs increased by 2.";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={
 PC5_LEADER:card("PC5_LEADER",{type:"LEADER",skill:print,back:{name:"Back",power:15000,skill:print}}),
 PC5_FILLER:card("PC5_FILLER",{}),
 PC5_GOOD:card("PC5_GOOD",{colors:["Red"],traits:["Bardock's Crew"],energyCost:1,skill:"[Barrier]"}),
 PC5_TWO:card("PC5_TWO",{colors:["Red"],traits:["Bardock's Crew"],energyCost:2}),
 PC5_BLUE:card("PC5_BLUE",{colors:["Blue"],traits:["Bardock's Crew"],energyCost:1}),
 PC5_OTHER:card("PC5_OTHER",{colors:["Red"],traits:["Saiyan"],energyCost:1}),
};
const records=Object.values(defs).flatMap(skillRecords);for(const r of records){assert.deepEqual(r.unread,[]);assert.deepEqual(runtimeSupportOfRow(r).unsupported,[]);}
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>copy(RULES.apply(ctx,copy(s),a).state as VmState);
let cases=0;
for(const seat of ["p1","p2"] as const)for(const back of [false,true]){
 let s=RULES.createGame(ctx,{seed:441,p1:{name:"A",leader:"PC5_LEADER",main:fifty("PC5_FILLER")},p2:{name:"B",leader:"PC5_LEADER",main:fifty("PC5_FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:seat},{type:"mulligan",player:seat,redraw:false},{type:"mulligan",player:other(seat),redraw:false},{type:"charge",player:seat,card:null}] as Action[])s=take(s,a);
 const leader=s.sides[seat].zones.leader[0];s.cards[leader].flipped=back;
 // The opposing Leader has no live modifier, so its cards distinguish ownership.
 addEffect(s,[],{target:s.sides[other(seat)].zones.leader[0],kind:"negateSkills",value:0,until:"game"});
 const stage=(p:PlayerId,def:string,area:string)=>{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;};
 const good=stage(seat,"PC5_GOOD","battle"),two=stage(seat,"PC5_TWO","battle"),blue=stage(seat,"PC5_BLUE","battle"),wrongTrait=stage(seat,"PC5_OTHER","battle"),held=stage(seat,"PC5_GOOD","hand"),foe=stage(other(seat),"PC5_GOOD","battle");
 const cost=(id:string)=>attrsNow(ctx,game,copy(s),id).costOf;
 assert.equal(cost(good),3,"every matching Battle card gets the increase");cases++;
 assert.deepEqual([cost(two),cost(blue),cost(wrongTrait),cost(held),cost(foe)],[2,1,1,1,1],"original cost, color, trait, area and controller remain scoped");cases++;
 addEffect(s,[],{target:good,kind:"cost",value:-4,until:"turn"});
 addEffect(s,[],{target:two,kind:"cost",value:1,until:"turn"});
 assert.equal(cost(good),7,"printed one still qualifies after another current-cost increase");
 assert.equal(cost(two),1,"current one does not replace original two");cases++;
 const moving=stage(seat,"PC5_GOOD","battle");
 moved(ctx,game,s,[],moving,"drop",{owner:seat,reason:"effect"});assert.equal(cost(moving),1,"the Battle Area scope stops at departure");
 moved(ctx,game,s,[],moving,"battle",{owner:seat,reason:"effect"});assert.equal(cost(moving),3,"a new matching arrival gets the standing increase");cases++;
 addEffect(s,[],{target:leader,kind:"negateSkills",value:0,until:"turn"});assert.equal(cost(moving),1,"negating the source removes the standing modifier");cases++;
}
console.log(`passive cost 5: ${cases} stored static scenarios passed across both seats and faces`);

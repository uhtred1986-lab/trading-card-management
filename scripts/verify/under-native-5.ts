/** R528 actual loader/factory/actions. Resource staging and #0 attachment are
 * explicit fixtures, not claims that Abducted #10/#20 or Z-Awaken were paid.
 * BT20-086 is deliberately supplied as the factory Leader for Combo-policy
 * coverage; this skips its normal Z-Awaken procedure and payment. */
import assert from "node:assert/strict";
import areaSources from "./fixtures/combo-standing-source.json";
import underSources from "./fixtures/under-standing-observer-5.json";
import printedCosts from "./fixtures/under-native-printed-costs-5.json";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import beforeLoader from "./fixtures/under-native-loader-before-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { moved } from "../../src/lib/arena/vm/flow";
import { vmHost } from "../../src/lib/arena/vm/host";
import { issueNativeUnderRead } from "../../src/lib/arena/vm/under-native-read";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { NotYet } from "../../src/lib/arena/vm/errors";
const defs: EngineContext["defs"] = { L:card("L",{type:"LEADER",skill:null}), F:card("F",{colors:["Yellow"],skill:null}), Y:card("Y",{colors:["Yellow"],skill:null}), B:card("B",{colors:["Blue"],skill:null}) };
for (const [id,{card:c}] of Object.entries({...areaSources,...underSources})) defs[id]=card(id,{
    name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],energyCost:c.cost===null?null:Number(c.cost),
    power:c.power,characters:c.characters,traits:c.traits,skill:c.skill,
});
// The source extract has null specified fields. These printed values were
// independently read from the official images; do not use fixed-cost defaults.
for(const [id,price] of Object.entries(printedCosts)){
    assert.equal(defs[id].name,price.name);assert.equal(defs[id].energyCost,price.energyCost);
    defs[id].specifiedCost=price.specifiedCost;
}
// Official DB2-086 image: https://www.dbs-cardgame.com/images/cardlist/cardimg/DB2-086.png
// Prum's printed Combo0 +5000 agrees with the fixture values; the eight F
// Combo resources remain explicitly synthetic cards.
assert.equal(defs["DB2-086"].comboCost,0);assert.equal(defs["DB2-086"].comboPower,5000);
const records=Object.values(defs).flatMap(skillRecords), rows=records.map((row,id)=>({...row,id,status:row.unread.length?"open":"confirmed",source:"compiler"}) as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const caseArgument=process.argv.indexOf("--under-native-case");
const selectedCase=caseArgument<0?undefined:process.argv[caseArgument+1];
if(caseArgument>=0)assert.ok(selectedCase,"--under-native-case needs a label substring");
let cases=0;
function test(label:string,fn:()=>void){if(selectedCase&&!label.includes(selectedCase))return;fn();cases++;console.log(`PASS ${label}`);}
function take(state:VmState,action:Action,events:GameEvent[]=[]):VmState{
    const saved=clone(state),original=JSON.stringify(saved),result=RULES.apply(ctx,saved,action);
    assert.equal(JSON.stringify(saved),original,"saved action input remains unchanged");
    assert.equal(result.state.outcome,undefined,JSON.stringify(result.state.outcome));events.push(...result.events);
    return result.state;
}
function fresh(p:PlayerId,leader="L",allAbducted=false):VmState{
    const main=allAbducted?fifty("BT23-070"):["BT23-070",...fifty("F").slice(1)];
    let s=RULES.createGame(ctx,{seed:528,p1:{name:"One",leader:p==="p1"?leader:"L",main,z:[]},p2:{name:"Two",leader:p==="p2"?leader:"L",main,z:[]}}).state;
    assert.equal(s.underStandingNegationHistory?.version,3);assert.equal(s.mixedStandingNegationHistory,undefined);assert.equal(s.standingNegationHistory,undefined);
    for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},
        {type:"charge",player:p,card:allAbducted?s.sides[p].zones.hand[0]??null:null}] as Action[]) {
        const action=a.type==="charge"&&allAbducted?{...a,card:s.sides[p].zones.hand[0]}:a;s=take(s,action);
    }
    if(!allAbducted)for(const a of [{type:"endMain",player:p},{type:"charge",player:other(p),card:null},{type:"endMain",player:other(p)},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
    assert.equal(s.prompt.kind,"main");return s;
}
/** Explicit resource fixture only: policy-relevant arrivals below use real writers. */
function stage(s:VmState,p:PlayerId,definition:string,area:"hand"|"energy"|"drop"){
    const id=[...s.sides[p].zones.deck].reverse().find(id=>s.cards[id].cardId==="F")!;assert.ok(id);
    s.cards[id].cardId=definition;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);issueNativeUnderRead(ctx,game,s);return id;
}
function drive(s:VmState,events:GameEvent[]=[],stopCombo=false):VmState{
    for(let i=0;i<60;i++){
        if(s.prompt.kind==="main"||s.prompt.kind==="charge"||stopCombo&&s.prompt.kind==="combo")return s;
        const prompt=s.prompt,legal=RULES.legalActions(ctx,s).map(entry=>entry.action);
        const action:Action|undefined=prompt.kind==="chooseCards"?{type:"choose",player:prompt.player,cards:prompt.choice.candidates.slice(0,prompt.choice.min??0)}
            :prompt.kind==="orderPending"?{type:"orderPending",player:prompt.player,index:s.pendingOrder!.candidates[0]}
            :prompt.kind==="zEnergyFromCombo"?{type:"zEnergyFromCombo",player:prompt.player,card:null}
            :legal.find(a=>a.type==="counter"&&a.card===null||a.type==="block"&&a.card===null||a.type==="payCost")??legal.find(a=>a.type==="pass");
        assert.ok(action,JSON.stringify(prompt));s=take(s,action,events);
    }throw Error("native drive limit");
}
test("exact loader admits only #0 and preserves every complete original row and sibling",()=>{
    assert.deepEqual(clone(skillRecords(defs["BT23-070"])),beforeLoader.records);
    assert.deepEqual(ctx.scripts!["BT23-070"].bySkill[0].unsupported,[]);
    for(const index of [10,20] as const)assert.deepEqual(clone(ctx.scripts!["BT23-070"].bySkill[index]),beforeLoader.scripts.bySkill[index]);
    const row=records.find(row=>row.cardId==="BT23-070"&&row.skillIndex===0)!;
    assert.deepEqual(runtimeSupportOfRow(row).unsupported,[]);assert.ok(runtimeSupportOfRow(row).unknown.length);
});
test("factory ignores unused under definitions and old admitted physical sources never acquire inferred history",()=>{
    const s=RULES.createGame(ctx,{seed:528,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state;
    assert.equal(s.underStandingNegationHistory,undefined);assert.equal(s.mixedStandingNegationHistory,undefined);
    const id=s.sides.p1.zones.deck[0];s.cards[id].cardId="BT23-070";const original=JSON.stringify(s);
    assert.throws(()=>RULES.legalActions(ctx,s),NotYet);assert.equal(JSON.stringify(s),original);
});
for(const p of ["p1","p2"] as const){
    test(`${p} actual fresh saved setup/charge and private views with full Abducted decks`,()=>{
        const s=fresh(p,"L",true);assert.equal(s.sides[p].zones.energy.length,1);
        for(const viewer of ["p1","p2"] as const)assert.doesNotMatch(JSON.stringify(RULES.boardView(ctx,clone(s),viewer,{})),/underStandingNegationHistory|underAwareWholeV1|definitionIdentity|attackBans/);
        const old=clone(s);delete old.underStandingNegationHistory;const original=JSON.stringify(old);
        assert.throws(()=>RULES.legalActions(ctx,old),NotYet);assert.equal(JSON.stringify(old),original);
    });
    for(const source of ["DB1-066","BT10-153"] as const)test(`${p} actual paid ${source} arrival then staged #0 attachment retires its source`,()=>{
        let s=fresh(p);const id=stage(s,p,source,"hand"),victim=stage(s,other(p),"BT1-034","hand"),buried=stage(s,p,"BT23-070","drop");
        moved(ctx,game,s,[],victim,"battle",{owner:other(p)});
        const printed=printedCosts[source],cost=printed.energyCost;
        assert.deepEqual(cardPrice(ctx,game,s,id),{total:cost,orbs:printed.specifiedCost},"full printed price; Drop has no 15000-power Battle for Gotenks reduction");
        const energy=Array.from({length:cost},(_,i)=>stage(s,p,i<printed.specifiedCost.Yellow?"Y":"B","energy"));
        const action=RULES.legalActions(ctx,s).map(entry=>entry.action).find(a=>a.type==="play"&&a.card===id);assert.ok(action);
        const short=clone(s);short.cards[energy[0]].cardId="B";issueNativeUnderRead(ctx,game,short);
        const unchanged=JSON.stringify(short);assert.throws(()=>RULES.apply(ctx,short,action),"one fewer printed Yellow orb must not pay");assert.equal(JSON.stringify(short),unchanged);
        s=drive(take(s,action));assert.ok(s.sides[p].zones.battle.includes(id));assert.equal(s.sides[p].zones.energy.filter(id=>s.cards[id].mode==="rest").length,cost);
        assert.equal(skillsNegated(s,victim),true);const serial=s.underStandingNegationHistory!.active[0].serial;
        assert.equal(vmHost(ctx,game,s,[]).placeUnder(buried,id),true);
        assert.equal(skillsNegated(s,id),true);assert.equal(skillsNegated(s,victim),false);
        assert.ok(s.underStandingNegationHistory!.active[0].serial>serial);
    });
    for(const definition of ["BT1-034","BT1-043","TB1-097"])test(`${p} ${definition} attack menu and direct apply enforce independent #0 ban`,()=>{
        let s=fresh(p);const target=stage(s,p,definition,"hand"),buried=stage(s,other(p),"BT23-070","drop");
        moved(ctx,game,s,[],target,"battle",{owner:p});
        const attack=RULES.legalActions(ctx,s).map(entry=>entry.action).find(a=>a.type==="attack"&&a.attacker===target);assert.ok(attack,"unattached target can attack");
        assert.equal(vmHost(ctx,game,s,[]).placeUnder(buried,target),true);
        assert.equal(skillsNegated(s,target),definition==="BT1-034");
        assert.ok(!RULES.legalActions(ctx,s).some(entry=>entry.action.type==="attack"&&entry.action.attacker===target));
        const saved=clone(s),original=JSON.stringify(saved);assert.throws(()=>RULES.apply(ctx,saved,attack));assert.equal(JSON.stringify(saved),original);
        for(const viewer of ["p1","p2"] as const)assert.doesNotMatch(JSON.stringify(RULES.boardView(ctx,s,viewer,{})),/underStandingNegationHistory|underAwareWholeV1|definitionIdentity|attackBans/);
        vmHost(ctx,game,s,[]).move(buried,"drop",other(p));
        assert.ok(RULES.legalActions(ctx,s).some(entry=>entry.action.type==="attack"&&entry.action.attacker===target));
        s=take(s,attack);assert.ok(s.battle);
    });
    test(`${p} actual Goku attack and 6/7/8 Combo writes then simultaneous native cleanup`,()=>{
        let s=fresh(p,"BT20-086");const events:GameEvent[]=[],q=other(p),goku=s.sides[p].zones.leader[0],guard=s.sides[q].zones.leader[0];
        const prum=stage(s,q,"DB2-086","hand");moved(ctx,game,s,events,prum,"battle",{owner:q});
        const own=Array.from({length:8},()=>stage(s,p,"F","hand"));
        s=drive(take(s,{type:"attack",player:p,attacker:goku,target:guard},events),events,true);
        for(let i=0;i<8;i++){
            const action=RULES.legalActions(ctx,s).map(entry=>entry.action).find(a=>a.type==="combo"&&a.card===own[i]);assert.ok(action);
            s=drive(take(s,action,events),events,true);assert.equal(s.underStandingNegationHistory!.active.length,i>=6?1:0);
        }
        s=drive(take(s,{type:"pass",player:p},events),events,true);
        const combo=RULES.legalActions(ctx,s).map(entry=>entry.action).find(a=>a.type==="combo"&&a.card===prum);assert.ok(combo);
        const draws=events.filter(event=>event.type==="draw"&&event.player===q).length;
        s=drive(take(s,combo,events),events,true);assert.equal(skillsNegated(s,prum),true);
        assert.equal(events.filter(event=>event.type==="draw"&&event.player===q).length,draws,"arrival Auto sees v3 suppression");
        s=drive(take(s,{type:"pass",player:q},events),events);
        for(const id of [...own,prum])assert.equal(events.filter(event=>event.type==="move"&&event.card===id&&event.from==="combo"&&event.to==="drop").length,1);
        assert.equal(s.underStandingNegationHistory!.active.length,0);assert.equal(skillsNegated(s,prum),false);
    });
}
assert.ok(cases,"at least one native case must match");
console.log(`under-native-5${selectedCase?` [selected: ${selectedCase}]`:""}: ${cases} actual loader/native action cases PASS (staged resources, attachments and starting Z-Leader labeled)`);

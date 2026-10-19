/** Actual engine-offered defensive power, masked contract and target followthrough. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { realTacticalCases, zones, takeLegal } from "./arena-real-card-tactics-fixture";
import { applyMove, legalMoves } from "../../src/lib/arena/browser";
import { policyTurn, localStep } from "../../src/lib/arena/policy/boundary";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { makeReplayBundle } from "../../src/lib/arena/replay-core";
import { mainPhaseMatch,stage } from "./arena-policy-main-fixture";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import type { CardDef } from "../../src/lib/arena/types";
import type { PolicyInput } from "../../src/lib/arena/policy/contract";
const copy = <T,>(x:T):T => JSON.parse(JSON.stringify(x));
const initial = (await realTacticalCases()).cases[0];
let checks=0;
for (const variant of ["white", "niagara-battle", "niagara-leader"] as const) {
  let match=copy(initial.match); const owner=initial.seat;
  let extra=zones(match,owner,"hand").find(id=>match.state.cards[id].cardId==="BT31-142")!; assert.ok(extra);
  if(variant!=="white") {
    const parsed=JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json",import.meta.url),"utf8"));
    const rows=(Array.isArray(parsed)?parsed:Object.values(parsed).find(Array.isArray)) as Record<string,unknown>[];
    const raw=rows.find(c=>c.id==="DB1-019")!; assert.ok(raw);
    const def={id:"DB1-019",name:raw.name,type:raw.cardType,colors:raw.colors,energyCost:2,zEnergyCost:null,power:null,comboCost:null,comboPower:null,skill:raw.skill,characters:[],traits:[],back:null} as CardDef;
    match.ctx.defs[def.id]=def; const compiled=rulesFromCompiler({[def.id]:def}); assert.ok(compiled[def.id]?.complete); match.ctx.scripts![def.id]=compiled[def.id];
    const bundle=await makeReplayBundle({defs:match.ctx.defs,scripts:match.ctx.scripts!,art:{},rulesetFiles:DBS_FILES,runtime:"a899000000000000000000000000000000000899"});
    const opening=await mainPhaseMatch({...bundle,decks:{p1:{name:"attacker",leader:"SD5-01",main:Array<string>(50).fill("SD5-03")},p2:{name:"defender",leader:"SD15-01",main:Array<string>(50).fill("SD5-03")}}},899,"a899000000000000000000000000000000000899");
    match=stage(opening,{p1:{hand:[],energy:[],battle:[{cardId:"SD15-03",mode:"active"}],leaderMode:"rest"},p2:{hand:["DB1-019"],energy:["SD5-03","SD5-03"],battle:[{cardId:"SD15-03",mode:"rest"}],leaderMode:"rest"}});
    const target=zones(match,owner,variant==="niagara-leader"?"leader":"battle")[0];
    match=takeLegal(match,a=>a.type==="attack"&&a.attacker===zones(match,"p1","battle")[0]&&a.target===target).match;
    for(let n=0;n<8&&!(match.state.prompt.kind==="combo"&&match.state.prompt.player===owner);n++)match=takeLegal(match,a=>a.type==="pass"||a.type==="counter"&&a.card===null||a.type==="block"&&a.card===null).match;
    extra=zones(match,owner,"hand").find(id=>match.state.cards[id].cardId===def.id)!;assert.ok(extra);
  }
  const stronger=zones(match,owner,"deck").pop()!;match.state.cards[stronger].cardId=variant==="white"?"BT31-129":"SD15-03";match.state.cards[stronger].mode="rest";zones(match,owner,"battle").push(stronger);
  addEffect(match.state,[],{kind:"power",source:stronger,target:stronger,value:100000,until:"turn",master:owner});
  const guard=match.state.battle!.guard;
  const before=match.state.effects.filter(e=>e.kind==="power"&&e.target===guard).reduce((n,e)=>n+Number(e.value),0);
  const targetStart=match.state.effects.filter(e=>e.kind==="power"&&e.target===stronger).reduce((n,e)=>n+Number(e.value),0);
  let memory=localMemory(policyRng(899));let activated=false,annotated=false,competingOffered=false;
  if(variant!=="white") {
    // Niagara valuation is already covered by the six defense scenarios. Here
    // declare its exact legal offer to isolate the subsequent mode/target path.
    const input=policyTurn(match,owner,0).input;
    const offered=legalMoves(match).find(l=>l.action.type==="activate"&&l.action.card===extra)!;assert.ok(offered,variant);
    assert.ok(input.decisions.decisions.some(d=>d.kind==="menu"&&d.type==="activate"&&d.action.card===extra&&d.battleActivation?.power.battle===5000));
    match=applyMove(match,offered.action).match;activated=true;
  }
  const policy=localPolicy();
  for(let n=0;n<12;n++) {
    const turn=policyTurn(match,owner,n);
    assert.deepEqual(copy(turn.input),turn.input,"restricted input survives actual JSON save/reload");
    const chosen=policy(turn.input,memory.rng);
    const cosmetic=copy(turn.input) as PolicyInput;
    for(const side of [cosmetic.observation.you,cosmetic.observation.them]) for(const card of [side.leader,...side.battle,...(side.hand??[])]) if(card)card.text="unrelated display";
    for(const d of cosmetic.decisions.decisions)if(d.kind==="menu"){d.label="unrelated display";if(d.cost)d.cost.describe="free";}
    assert.deepEqual(policy(cosmetic,memory.rng),chosen,"metadata display mutations preserve actual contract answer");
    const action=turn.key.menu[chosen.answer.id];
    if(!activated){assert.equal(action?.type,"activate",variant);assert.equal(action?.card,extra,variant);activated=true;}
    if(turn.input.decisions.decisions.some(d=>d.battlePowerTarget))annotated=true;
    if(turn.input.decisions.decisions.some(d=>d.kind==="pick"&&d.candidates.includes(stronger)&&d.candidates.includes(guard)))competingOffered=true;
    const next=localStep(match,owner,n,memory,policy);const replay=localStep(copy(match),owner,n,copy(memory),policy);
    assert.deepEqual(copy(replay),copy(next),"actual JSON match replay gives identical transition");assert.ok(next.ok,next.ok?"":next.detail);
    match=next.match;memory=next.memory;
    const power=match.state.effects.filter(e=>e.kind==="power"&&e.target===guard).reduce((sum,e)=>sum+Number(e.value),0);
    if(power>before){assert.equal(power-before,variant==="white"?10000:5000);break;}
    assert.ok(n<11,"power must reach current battler within bounded decisions");
  }
  if(variant!=="niagara-leader")assert.ok(competingOffered,`${variant} actually offers the stronger competing target`);
  assert.ok(annotated,`${variant} exercises an actual typed mode/target offer`);
  assert.equal(match.state.effects.filter(e=>e.kind==="power"&&e.target===stronger).reduce((sum,e)=>sum+Number(e.value),0),targetStart,"stronger eligible card gets no defensive power");checks++;
}
console.log(`typed-combat-target-899: ${checks} actual defensive activations reach intended battler with JSON replay and cosmetic twins`);

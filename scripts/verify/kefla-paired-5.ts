import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import fixture from "./fixtures/kefla-paired-5.json";
import { vmRevealedTo } from "../../src/lib/arena/vm/view";
import { moved } from "../../src/lib/arena/vm/flow";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";

const c=fixture.catalogCard;
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),G:card("G",{power:100000}),E:card("E",{colors:["Red"]}),BLUE:card("BLUE",{colors:["Blue"]}),C:card("C",{characters:["Caulifla"],power:10000}),K:card("K",{characters:["Kale"],power:20000}),[c.id]:card(c.id,{name:c.name,colors:c.colors as Color[],characters:c.characters,traits:c.traits,power:c.power,energyCost:5,skill:c.skill}),
PLAY:card("PLAY",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."}),
BOUNCE:card("BOUNCE",{skill:"[Auto] When one of your Battle Cards attacks, choose up to 1 of your Battle Cards and return it to its owner's hand, then choose up to 1 Battle Card from your hand and play it."})};
defs.RETAIN=card("RETAIN",{skill:"[Auto] When one of your Battle Cards attacks, choose up to 1 of your Battle Cards and use it in a combo, then choose up to 1 Battle Card from your Combo Area and play it."});
defs.REMOVE=card("REMOVE",{skill:"[Auto] When one of your Battle Cards attacks, choose up to 1 of your Battle Cards and return it to its owner's hand."});
defs.UNDER=card("UNDER",{skill:"[Auto] When one of your Battle Cards attacks, choose up to 1 of your Battle Cards and place it under this card."});
defs.COUNTER=card("COUNTER",{type:"EXTRA",energyCost:0,comboCost:null,comboPower:null,skill:"[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."});
defs.NO_DEFLECT={...defs[c.id],id:"NO_DEFLECT",skill:c.skill.replace(/\[deflect\][^<]*<br>/i,"")};
defs.CONTROL=card("CONTROL",{skill:"[Auto] When one of your Battle Cards attacks, choose up to 1 of your Battle Cards and your opponent gains control of it."});
defs.PLAYDROP=card("PLAYDROP",{skill:"[Activate: Main] Choose up to 1 Battle Card from your Drop Area and play it."});
defs.PLAYBOUNCE=card("PLAYBOUNCE",{skill:"[Auto] [Once per turn] When one of your Battle Cards is played, choose up to 1 of your Battle Cards and return it to its owner's hand, then choose up to 1 Battle Card from your hand and play it."});
defs.BOUNCENEGATE={...defs.BOUNCE,id:"BOUNCENEGATE",skill:defs.BOUNCE.skill!.replace("play it.","play it with its skills negated for the turn.")};
defs.NEGATEWATCH=card("NEGATEWATCH",{skill:"[Auto] When one of your Battle Cards attacks, choose up to 1 of your Battle Cards and negate its skills for the turn."});
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const records=Object.values(defs).flatMap(skillRecords);assert.ok(records.every(r=>!r.unread.length),JSON.stringify(records.filter(r=>r.unread.length)));
const row=records.find(r=>r.cardId===c.id&&r.skillIndex===30)!;assert.deepEqual(row.trigger,["attacks","playedUsingUnionPotara"]);assert.equal(row.cond,null);assert.deepEqual(row.ops,[{op:"draw",n:1},{op:"power",target:{sel:{special:"self"}},amount:5000,until:"turn"}]);
for(const field of ["printed","combo","cost","usage","validity"] as const)assert.deepEqual(row[field],fixture.record[field]);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const events:GameEvent[]=[];
function take(s:VmState,a:Action):VmState{const saved=copy(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,"p1",{});RULES.boardView(ctx,saved,"p2",{});const out=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));events.push(...out.events);return out.state as VmState;}
function fresh(turn:PlayerId):VmState{let s=RULES.createGame(ctx,{seed:485,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,def:string,area:string,rest=false):string{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode=rest?"rest":"active";if(area==="deck"){s.sides[p].zones.deck=s.sides[p].zones.deck.filter(x=>x!==id);s.sides[p].zones.deck.unshift(id);}return id;}
type Policy={counter?:(s:VmState)=>string|null;prefer?:string[];declineCost?:boolean;declineMay?:boolean;choose?:(s:VmState)=>string[]|undefined;stop?:(s:VmState)=>boolean};
function drive(s:VmState,policy:Policy={}):VmState{for(let n=0;n<120;n++){if(policy.stop?.(s)||s.prompt.kind==="main"||s.prompt.kind==="charge")return s;const q=s.prompt;let a:Action|undefined;
 if(q.kind==="chooseCards"){const desired=policy.choose?.(s)??policy.prefer?.filter(x=>q.choice.candidates.includes(x));a={type:"choose",player:q.player,cards:desired?.slice(0,q.choice.max??1)??q.choice.candidates.slice(0,q.choice.min??0)};}
 else if(q.kind==="chooseMode"&&policy.declineCost&&q.reason==="Pay this Auto skill's cost?")a={type:"chooseMode",player:q.player,index:q.options.length-1};
 else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:!policy.declineCost};
 else if(q.kind==="combo")a={type:"pass",player:q.player};else if(q.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:q.player,card:null};
 else if(q.kind==="counter"&&policy.counter)a={type:"counter",player:q.player,card:policy.counter(s)};
 else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates[0],...(policy.declineCost?{decline:true as const}:{})};
 else {const legal=RULES.legalActions(ctx,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="block"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===(policy.declineMay?1:0))??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="pass");}
 assert.ok(a,JSON.stringify(q));s=take(s,a);
 }throw Error("drive bound");}
function act(s:VmState,id:string):VmState{const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===id);assert.ok(a,`activate ${id}/${s.cards[id].cardId}: ${JSON.stringify(s.prompt)}`);return take(s,a);}

const power=(s:VmState,id:string)=>attrsNow(ctx,game,s,id).power;
const cases:string[]=[];
for(const p of ["p1","p2"] as PlayerId[]){
 let s=fresh(p);const id=stage(s,p,c.id,"hand"),ca=stage(s,p,"C","battle"),ka=stage(s,p,"K","battle");const energy=[stage(s,p,"E","energy"),stage(s,p,"E","energy"),stage(s,p,"E","energy")];const hand=s.sides[p].zones.hand.length;
 s=drive(act(s,id),{prefer:[ca,ka]});assert.ok(s.sides[p].zones.battle.includes(id));assert.deepEqual(s.cards[id].under,[ca,ka]);assert.equal(s.cards[id].mode,"active");assert.ok(energy.every(e=>s.cards[e].mode==="rest"));assert.equal(power(s,id),30000);assert.equal(s.sides[p].zones.hand.length,hand);cases.push(`${p}/real-potara`);
 const guard=stage(s,other(p),"G","battle",true);
 for(let n=1;n<=2;n++){s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}));assert.equal(power(s,id),30000+n*5000);assert.equal(s.sides[p].zones.hand.length,hand+n);const drawn=s.sides[p].zones.hand.at(-1)!;assert.ok(vmRevealedTo(game,s,p).has(drawn));assert.ok(!vmRevealedTo(game,s,other(p)).has(drawn));cases.push(`${p}/attack-${n}`);}
}

for(const p of ["p1","p2"] as PlayerId[]){
 // Native competing watcher resolves first and replays the source as a new occurrence.
 let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true),watch=stage(s,p,"BOUNCE","battle");const hand=s.sides[p].zones.hand.length;
 s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});
 const saved=copy(s),old=s.cards[id].pairedSelfToken;assert.equal(typeof old,"number");
 const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===watch)!;assert.notEqual(index,undefined);
 s=drive(take(s,{type:"orderPending",player:p,index}),{prefer:[id]});assert.ok(s.sides[p].zones.battle.includes(id));assert.ok(s.cards[id].pairedSelfToken!>old!);assert.equal(power(s,id),25000);assert.equal(s.sides[p].zones.hand.length,hand+1);cases.push(`${p}/fresh-occurrence-draw-only`);
 for(const bad of ["missing","version","card","negative","future","current-missing","epoch-negative","epoch-fraction","epoch-future-token"]){const broken=copy(saved);const q=broken.pending.find(x=>x.card===id&&x.skillIndex===30)!;assert.ok(q.kind!=="hook");if(bad==="missing")delete q.pairedSelf;else if(bad==="version")q.pairedSelf!.version=2 as 1;else if(bad==="card")q.pairedSelf!.card=watch;else if(bad==="negative")q.pairedSelf!.token=-1;else if(bad==="future")q.pairedSelf!.token=999;else if(bad==="epoch-negative")broken.cards[id].zoneEpoch=-1;else if(bad==="epoch-fraction")broken.cards[id].zoneEpoch=2.5;else if(bad==="epoch-future-token")broken.cards[id].zoneEpoch=0;else delete broken.cards[id].pairedSelfToken;
 broken.pendingOrder!.queue=copy(broken.pending);
 const selected=broken.pendingOrder!.candidates.find(i=>broken.pendingOrder!.queue[i].card===id&&broken.pendingOrder!.queue[i].skillIndex===30)!;const out=RULES.apply(ctx,broken,{type:"orderPending",player:p,index:selected});assert.equal(out.state.outcome?.kind,"interrupted",bad);cases.push(`${p}/saved-${bad}`);}
 // FAQ: material power carries; granted skills do not. The Auto adds a separate 5000.
 s=fresh(p);const pot=stage(s,p,c.id,"hand"),ca=stage(s,p,"C","battle"),ka=stage(s,p,"K","battle");for(let n=0;n<3;n++)stage(s,p,"E","energy");
 addEffect(s,[],{target:ca,source:ca,master:p,kind:"power",value:5000,until:"turn"});addEffect(s,[],{target:ca,source:ca,master:p,kind:"keyword",value:{name:"Strike",x:2},until:"turn"});
 s=drive(act(s,pot),{prefer:[ca,ka]});assert.equal(power(s,pot),35000);assert.equal(hasKeyword(ctx,game,s,pot,"Strike"),false);cases.push(`${p}/FAQ-power-not-skills`);
}

for(const p of ["p1","p2"] as PlayerId[])for(const route of ["RETAIN"]){
 let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true),watch=stage(s,p,route,"battle");const hand=s.sides[p].zones.hand.length;
 s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});const token=s.cards[id].pairedSelfToken,epoch=s.cards[id].zoneEpoch;
 const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===watch)!;
 s=drive(take(s,{type:"orderPending",player:p,index}),{prefer:[id],stop:s=>s.prompt.kind==="combo"});
 assert.equal(s.cards[id].pairedSelfToken,token);assert.ok(s.cards[id].zoneEpoch!>epoch!);assert.equal(power(s,id),30000);assert.equal(s.sides[p].zones.hand.length,hand+1);assert.ok(s.sides[p].zones[route==="RETAIN"?"battle":"combo"].includes(id));cases.push(`${p}/${route}/retained-self`);
}

for(const p of ["p1","p2"] as PlayerId[]){
 for(const route of ["REMOVE","UNDER"]){let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true),watch=stage(s,p,route,"battle");const hand=s.sides[p].zones.hand.length;s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});const token=s.cards[id].pairedSelfToken;const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===watch)!;s=drive(take(s,{type:"orderPending",player:p,index}),{prefer:[id]});assert.ok(s.cards[id].pairedSelfToken!>token!);assert.equal(power(s,id),25000);assert.equal(s.sides[p].zones.hand.length,hand+(route==="REMOVE"?2:1));if(route==="UNDER")assert.ok(s.cards[watch].under.includes(id));cases.push(`${p}/${route}/draw-only`);}
 for(const deflect of [true,false]){let s=fresh(p);const id=stage(s,p,deflect?c.id:"NO_DEFLECT","hand"),ca=stage(s,p,"C","battle"),ka=stage(s,p,"K","battle"),counter=stage(s,other(p),"COUNTER","hand");for(let n=0;n<3;n++)stage(s,p,"E","energy");const hand=s.sides[p].zones.hand.length;s=drive(act(s,id),{prefer:[ca,ka],counter:s=>RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===counter)?counter:null});assert.ok(s.sides[p].zones[deflect?"battle":"drop"].includes(id));assert.equal(s.sides[p].zones.hand.length,hand+(deflect?0:-1));assert.equal(power(s,id),deflect?30000:25000);cases.push(`${p}/${deflect?"actual-Deflect":"typed-no-Deflect-failed-entry"}`);}
 // Actual ordinary five-energy play is silent, but subsequent attacks are independent.
 {let s=fresh(p);const id=stage(s,p,c.id,"hand"),guard=stage(s,other(p),"G","battle",true);for(let n=0;n<5;n++)stage(s,p,"E","energy");const hand=s.sides[p].zones.hand.length;const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===id);assert.ok(play);s=drive(take(s,play));assert.equal(power(s,id),25000);assert.equal(s.sides[p].zones.hand.length,hand-1);s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}));assert.equal(power(s,id),30000);assert.equal(s.sides[p].zones.hand.length,hand);cases.push(`${p}/ordinary-play-then-attack`);}
}

for(const p of ["p1","p2"] as PlayerId[]){
 let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true),watch=stage(s,p,"CONTROL","battle");const hand=s.sides[p].zones.hand.length;
 s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});const token=s.cards[id].pairedSelfToken;const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===watch)!;
 s=drive(take(s,{type:"orderPending",player:p,index}),{prefer:[id]});assert.equal(s.cards[id].pairedSelfToken,token);assert.ok(s.sides[other(p)].zones.battle.includes(id));assert.equal(power(s,id),30000);assert.equal(s.sides[p].zones.hand.length,hand+1);cases.push(`${p}/holder-transfer-retained`);
}

for(const p of ["p1","p2"] as PlayerId[]){
 for(const bad of ["one-material","wrong-material","two-energy","wrong-color","not-Hand"]){const s=fresh(p);const id=stage(s,p,c.id,bad==="not-Hand"?"drop":"hand");stage(s,p,"C","battle");if(bad!=="one-material")stage(s,p,bad==="wrong-material"?"C":"K","battle");for(let n=0;n<(bad==="two-energy"?2:3);n++)stage(s,p,bad==="wrong-color"&&n===2?"BLUE":"E","energy");assert.equal(RULES.legalActions(ctx,s).find(x=>x.action.type==="activate"&&x.action.card===id),undefined,bad);cases.push(`${p}/illegal-${bad}`);}
 for(const area of ["hand","drop"]){let s=fresh(p);const id=stage(s,p,c.id,area),helper=stage(s,p,area==="hand"?"PLAY":"PLAYDROP","battle"),guard=stage(s,other(p),"G","battle",true);const hand=s.sides[p].zones.hand.length;s=drive(act(s,helper),{prefer:[id]});assert.equal(power(s,id),25000);assert.equal(s.sides[p].zones.hand.length,hand-(area==="hand"?1:0));s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}));assert.equal(power(s,id),30000);assert.equal(s.sides[p].zones.hand.length,hand+(area==="hand"?0:1));s=take(s,{type:"endMain",player:p});assert.equal(power(s,id),25000);cases.push(`${p}/skill-${area}-attack-expiry`);}
 {let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true);addEffect(s,[],{target:id,source:id,master:p,kind:"negateSkills",value:0,until:"turn"});const hand=s.sides[p].zones.hand.length;s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}));assert.equal(power(s,id),25000);assert.equal(s.sides[p].zones.hand.length,hand);cases.push(`${p}/negated-attack`);}

}

// Exact-body boundary: no implicit support for a self move, choices, a different procedure or extra timing.
for(const changed of [fixture.record.printed.replace("draw 1 card", "return this card to its owner's hand"),fixture.record.printed.replace("draw 1 card", "choose up to 1 card from your hand and discard it"),fixture.record.printed.replace("[union-potara] or attacks", "[union-fusion] or attacks"),fixture.record.printed.replace("or attacks,", "or attacks during your turn,")])assert.ok(skillRecords(card("REFUSED",{skill:changed}))[0].unread.length);
// Constructed saved-frame fixtures use the same stored bounded program, not a live text fallback.
for(const p of ["p1","p2"] as PlayerId[])for(const bad of ["valid","missing","wrong-card","future","bad-epoch","bad-current"]){const s=fresh(p);const id=stage(s,p,c.id,"battle");s.cards[id].pairedSelfToken=s.cards[id].zoneEpoch??0;const token=s.cards[id].pairedSelfToken;
 const script=ctx.scripts![c.id].bySkill[30];const frame={ops:copy(script.ops),ip:0,vars:{},card:id,master:p,skillIndex:30,trigger:"attacks" as const,usage:script.usage,validity:script.validity,skillEffectOrigin:{version:2 as const,kind:"auto" as const},pairedSelf:{version:1 as const,card:id,token}};
 if(bad==="missing")delete (frame as {pairedSelf?:unknown}).pairedSelf;if(bad==="wrong-card")frame.pairedSelf.card="unknown";if(bad==="future")frame.pairedSelf.token=999;if(bad==="bad-epoch")s.cards[id].zoneEpoch=-1;if(bad==="bad-current")s.cards[id].pairedSelfToken=-1;s.programs.unshift(frame);const out=RULES.apply(ctx,copy(s),{type:"endMain",player:p});assert.equal(out.state.outcome?.kind,bad==="valid"?undefined:"interrupted",bad);cases.push(`${p}/frame-${bad}`);}

// Focused native mover/play seam: an incomplete required stack must retract only its new alias.
for(const p of ["p1","p2"] as PlayerId[]){
 let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true),watch=stage(s,p,"BOUNCE","battle"),material=stage(s,p,"C","battle");void watch;
 s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});const prior=s.pending.find(q=>q.card===id&&q.skillIndex===30)!;assert.ok(prior);const ev:GameEvent[]=[];moved(ctx,game,s,ev,id,"hand");
 assert.equal(resolvePlay(ctx,game,s,ev,id,p,{using:"Union-Potara",under:[material]}),false);assert.ok(s.pending.includes(prior),"old independent attack is untouched");assert.equal(s.pending.filter(q=>q.card===id&&q.trigger==="playedUsingUnionPotara").length,0);cases.push(`${p}/incomplete-stack-retracts-only-new-alias`);
 for(const using of [undefined,"Union-Fusion","Union-Absorb","Evolve"]){const plain=fresh(p),source=stage(plain,p,c.id,"hand");const success=resolvePlay(ctx,game,plain,[],source,p,{using});if(using===undefined)assert.equal(success,true);assert.equal(plain.pending.filter(q=>q.card===source&&q.skillIndex===30).length,0);cases.push(`${p}/procedure-negative-${using??"ordinary"}`);}
}

// Copied exact paired bodies are deliberately outside this scoped occurrence admission.
for(const p of ["p1","p2"] as PlayerId[]){const s=fresh(p),id=stage(s,p,"C","battle"),guard=stage(s,other(p),"G","battle",true);addEffect(s,[],{target:id,master:p,kind:"copiedSkills",value:0,until:"turn",copied:{cardId:c.id,side:"front",skills:[30],from:id}});const out=RULES.apply(ctx,copy(s),{type:"attack",player:p,attacker:id,target:guard});assert.equal(out.state.outcome?.kind,"interrupted");cases.push(`${p}/copied-pair-explicit-refusal`);}

for(const p of ["p1","p2"] as PlayerId[])for(const bad of ["null-target","missing-target","null-selector","null-power","null-draw"]){let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true);stage(s,p,"BOUNCE","battle");s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});const changed=copy(ctx);const ops=changed.scripts![c.id].bySkill[30].ops as unknown as Record<string,unknown>[];if(bad==="null-target")ops[1].target=null;if(bad==="missing-target")delete ops[1].target;if(bad==="null-selector")ops[1].target={sel:null};if(bad==="null-power")ops[1]=null as unknown as Record<string,unknown>;if(bad==="null-draw")ops[0]=null as unknown as Record<string,unknown>;const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===id&&s.pendingOrder!.queue[i].skillIndex===30)!;const out=RULES.apply(changed,copy(s),{type:"orderPending",player:p,index});assert.equal(out.state.outcome?.kind,"interrupted",bad);assert.match(JSON.stringify(out.state.outcome),/R487/);cases.push(`${p}/malformed-body-${bad}`);}

for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const id=stage(s,p,c.id,"hand"),ca=stage(s,p,"C","battle"),ka=stage(s,p,"K","battle"),watch=stage(s,p,"PLAYBOUNCE","battle");for(let n=0;n<3;n++)stage(s,p,"E","energy");const hand=s.sides[p].zones.hand.length;s=drive(act(s,id),{prefer:[ca,ka],stop:s=>s.prompt.kind==="orderPending"});const original=s.pending.find(q=>q.card===id&&q.skillIndex===30)!;assert.ok(original.kind!=="hook"&&original.pairedSelf);const token=s.cards[id].pairedSelfToken;const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===watch)!;s=drive(take(s,{type:"orderPending",player:p,index}),{prefer:[id]});assert.ok(s.sides[p].zones.battle.includes(id));assert.equal(power(s,id),25000);assert.ok(s.cards[id].pairedSelfToken!>token!);assert.equal(s.sides[p].zones.hand.length,hand);assert.ok(s.sides[p].zones.drop.includes(ca)&&s.sides[p].zones.drop.includes(ka));cases.push(`${p}/Potara-pending-bounce-replay-draw-only`);}

for(const p of ["p1","p2"] as PlayerId[])for(const kind of ["BOUNCENEGATE","NEGATEWATCH"]){let s=fresh(p);const id=stage(s,p,c.id,"battle"),guard=stage(s,other(p),"G","battle",true),watch=stage(s,p,kind,"battle");const hand=s.sides[p].zones.hand.length;s=drive(take(s,{type:"attack",player:p,attacker:id,target:guard}),{stop:s=>s.prompt.kind==="orderPending"});const token=s.cards[id].pairedSelfToken;const index=s.pendingOrder!.candidates.find(i=>s.pendingOrder!.queue[i].card===watch)!;s=drive(take(s,{type:"orderPending",player:p,index}),{prefer:[id]});assert.ok(s.sides[p].zones.battle.includes(id));assert.equal(power(s,id),25000);assert.equal(s.sides[p].zones.hand.length,hand+(kind==="BOUNCENEGATE"?1:0));if(kind==="BOUNCENEGATE")assert.ok(s.cards[id].pairedSelfToken!>token!);else assert.equal(s.cards[id].pairedSelfToken,token);cases.push(`${p}/${kind}/scoped-pending-negation`);}
console.log(`kefla-paired-5: ${cases.length} native cases PASS`);

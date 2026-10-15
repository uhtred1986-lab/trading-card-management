/** #827: real printed skills, independently proved continuations, then policy
 * measurements. A policy failure is reported as evidence, never renamed pass.
 * Run: env -u DATABASE_URL npx tsx scripts/verify/arena-real-card-tactics.mts */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { applyMove, legalMoves, projectSnapshot, type PinnedMatch } from "../../src/lib/arena/browser";
import { localStep, policyTurn } from "../../src/lib/arena/policy/boundary";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory, mainChoice, MAIN_POLICY_VERSION } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { searchPolicy, SEARCH_VERSION } from "../../src/lib/arena/policy/search";
import { permutedFor } from "./arena-policy-permute";
import { actionCostOf, freePrice, mandatoryLifeCost } from "../../src/lib/arena/vm/costs";
import type { Op } from "../../src/lib/arena/vm/script";
import { realTacticalCases, TACTICAL_CARDS, TACTICAL_SEED, zones, type RealTacticalCase } from "./arena-real-card-tactics-fixture";
import { evaluationRunnerPin } from "../lib/evaluation-provenance";
import { assertManifest, evidenceHash, fixturePin, policyPin, writeEvidenceFile } from "../lib/policy-evaluation-manifest";
import type { DecisionManifest } from "../../src/lib/arena/testing/run-manifest";

const args=process.argv.slice(2);
if(args.length%2 || args.some((a,i)=>i%2===0 && !["--out","--manifest-out"].includes(a))) throw new Error("usage: tsx scripts/verify/arena-real-card-tactics.mts [--out FILE] [--manifest-out FILE]");
const flag=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const runner=evaluationRunnerPin("arena-policy-strategy","827-real-card-tactics-v1");

type Choice = "activation"|"combo-only"|"attack"|"restand"|"decline";
const actor = (m:PinnedMatch) => (m.state.prompt as {player?:PlayerId}).player;
const activeEnergy = (m:PinnedMatch,p:PlayerId) => zones(m,p,"energy").filter((id)=>m.state.cards[id].mode==="active").length;
const focusPresent = (c:RealTacticalCase,m:PinnedMatch) => zones(m,c.seat,"battle").includes(c.focus);
const clone = <T,>(x:T):T => JSON.parse(JSON.stringify(x)) as T;

/** Fixed adversary: the public two attackers attack the named rested Cell;
 * all response windows decline. It uses only engine-offered legal actions. */
function passiveAction(m:PinnedMatch,c:RealTacticalCase):Action {
  const legal=legalMoves(m).map((l)=>l.action);
  if(m.state.prompt.kind==="main" && actor(m)!==c.seat) {
    const attack=legal.find((a)=>a.type==="attack" && c.attackerIds.includes(a.attacker) && a.target===c.focus);
    if(attack) return attack;
  }
  const no=legal.find((a)=>a.type==="pass" || a.type==="endMain" || (a.type==="counter" || a.type==="block" || a.type==="zEnergyFromCombo") && a.card===null);
  if(no) return no;
  const decline=legal.find((a)=>a.type==="choose" && a.cards.length===0 || a.type==="optionalCost" && !a.pay);
  return decline ?? legal[0];
}

/** Scripted lines are legal engine continuations, not assertions about what
 * the policy should score. Printed targets/prices decide the chosen actions. */
function oracleAction(m:PinnedMatch,c:RealTacticalCase,line:Choice):Action {
  const p=actor(m),legal=legalMoves(m).map((l)=>l.action);
  if(p!==c.seat) return passiveAction(m,c);
  if(m.state.prompt.kind==="chooseCards") {
    const pr=m.state.prompt;
    const chosen=pr.choice.candidates.includes(c.focus) ? c.focus : pr.choice.min>0 ? pr.choice.candidates[0] : null;
    return legal.find((a)=>a.type==="choose" && (chosen ? a.cards.includes(chosen) : a.cards.length===0)) ?? legal[0];
  }
  if(line==="activation") {
    const extra=zones(m,p,"hand").find((id)=>m.state.cards[id].cardId==="BT31-142");
    const activate=legal.find((a)=>a.type==="activate" && a.card===extra);
    if(activate) return activate;
  }
  if(line==="combo-only" && m.state.prompt.kind==="combo" && m.state.battle?.attacker===c.attackerIds[0]) {
    const combo=legal.find((a)=>a.type==="combo" && m.state.cards[a.card].cardId==="BT31-132");
    if(combo) return combo;
  }
  if(line==="restand") {
    const activate=legal.find((a)=>a.type==="activate" && a.card===c.focus);
    if(activate) return activate;
  }
  if(line==="attack" || line==="restand") {
    const attack=legal.find((a)=>a.type==="attack" && a.attacker===c.focus && a.target===zones(m,p==="p1"?"p2":"p1","leader")[0]);
    if(attack) return attack;
  }
  return passiveAction(m,c);
}

interface LineResult {match:PinnedMatch;events:GameEvent[];actions:Action[];stop:string|null;}
function enough(c:RealTacticalCase,m:PinnedMatch,events:GameEvent[]) {
  return m.state.phase==="over" || m.state.turn!==c.match.state.turn ||
    c.horizonBattles>0 && events.filter((e)=>e.type==="powerCompare").length>=c.horizonBattles && !m.state.battle ||
    c.seat==="p2" && !focusPresent(c,m);
}
function oracleLine(c:RealTacticalCase,line:Choice):LineResult {
  let match=clone(c.match); const events:GameEvent[]=[],actions:Action[]=[];
  for(let n=0;n<80;n++) {
    if(enough(c,match,events)) return {match,events,actions,stop:null};
    const action=oracleAction(match,c,line); assert.ok(action,"oracle always has a legal action");
    actions.push(action); const out=applyMove(match,action);match=out.match;events.push(...out.events);
  }
  return {match,events,actions,stop:"80-decision bound"};
}

const {bundle,cases}=await realTacticalCases();
const [white,dual,restand,unsafe]=cases;

// Typed Life facts survive the same JSON/contract path a worker policy reads.
for(const c of [restand,unsafe]) {
  const legal=legalMoves(c.match).find((l)=>l.action.type==="activate" && l.action.card===c.focus)!;
  assert.equal(legal.cost?.life,1,"SD5-04 exact action price is a typed Life payment");
  const snapshot=clone(projectSnapshot(c.match,c.seat));
  assert.equal(snapshot.legal.find((l)=>l.action.type==="activate" && l.action.card===c.focus)?.cost?.life,1,"snapshot/JSON preserve the legal cost fact");
  const preview=snapshot.view.you.battle.find((card)=>card.id===c.focus)?.abilities?.find((a)=>a.skillIndex===10)?.costPreview;
  assert.ok(preview?.state==="known");assert.equal(preview.offers[0].cost.life,1,"ability cost preview retains the same fact");
  const input=policyTurn(c.match,c.seat,0).input;
  const projected=clone(input).decisions.decisions.find((d)=>d.kind==="menu" && d.type==="activate" && d.action.card===c.focus);
  assert.ok(projected?.kind==="menu");assert.equal(projected.cost?.life,1,"contract/JSON preserve typed Life metadata");
}
const exact:Op[]=[{op:"choose",sel:{side:"you",area:"life",count:1,upTo:false},as:"paid"},{op:"moveTo",target:{var:"paid"},to:"hand"}];
assert.equal(mandatoryLifeCost(freePrice(),exact),1);
assert.equal(actionCostOf({...freePrice(),life:2})?.life,2,"declared Life cost is also typed");
assert.equal(mandatoryLifeCost({...freePrice(),life:1},exact),undefined,"combined representations are not guessed or double-counted");
for(const ops of [
  [{...exact[0],sel:{side:"you",area:"life",count:1,upTo:true}},exact[1]],
  [{op:"if",cond:{kind:"life",side:"you",atMost:3},then:exact}],
  [{op:"may",ops:exact}],
  [exact[0],{op:"moveTo",target:{var:"other"},to:"hand"}],
  [{op:"choose",sel:{side:"opponent",area:"life",count:1},as:"paid"},exact[1]],
  [exact[0],exact[1],{op:"draw",n:1}],
] as Op[][]) assert.equal(mandatoryLifeCost(freePrice(),ops),undefined,"optional/conditional/unknown prices stay unprojected");
const costInput=clone(policyTurn(unsafe.match,"p1",0).input);
costInput.decisions.decisions=costInput.decisions.decisions.filter((d)=>d.kind==="menu" && (d.type==="endMain" || d.type==="activate" && d.action.card===unsafe.focus));
const fatal=costInput.decisions.decisions.find((d)=>d.kind==="menu" && d.type==="activate")!;
assert.ok(fatal.kind==="menu");
fatal.label="Unrelated display words";fatal.cost!.describe="free";
assert.equal(mainChoice(costInput)?.id,costInput.decisions.decisions.find((d)=>d.kind==="menu" && d.type==="endMain")!.id,"typed price wins over misleading display text");
delete fatal.cost;
assert.equal(mainChoice(costInput)?.id,fatal.id,"unknown prices are not guessed from printed or display text");

// Evidence is tied to actual recipe membership, without copying/changing their
// quantities or converting recipe readiness into a strategic result.
const recipes=JSON.parse(readFileSync(new URL("../../src/lib/arena/testing/prepared-recipes.json",import.meta.url),"utf8")) as {recipes:{id:string;leaderId:string;cards:{id:string}[]}[]};
for(const [recipeId,ids] of [
  [white.recipeId,["BT31-116","BT31-129","BT31-132","BT31-142"]],
  [dual.recipeId,["SD15-01","SD15-03"]],
  [restand.recipeId,["SD5-01","SD5-03","SD5-04"]],
] as const) {
  const recipe=recipes.recipes.find((r)=>r.id===recipeId);assert.ok(recipe,`prepared recipe ${recipeId} exists`);
  for(const id of ids) assert.ok(recipe.leaderId===id || recipe.cards.some((c)=>c.id===id),`${id} really belongs to ${recipeId}`);
}
assert.equal(new Set(TACTICAL_CARDS.map((c)=>c.id)).size,TACTICAL_CARDS.length);

// Rules-derived exact outcomes. Guard must exceed attacker power (8-4-6).
// Kamehameha's printed turn duration protects both battles; a combo expires.
const whiteGood=oracleLine(white,"activation"),whiteCombo=oracleLine(white,"combo-only"),whitePass=oracleLine(white,"decline");
assert.equal(whiteGood.stop,null);assert.ok(focusPresent(white,whiteGood.match));
assert.equal(whiteGood.events.filter((e)=>e.type==="powerCompare").length,2);
assert.ok(whiteGood.events.filter((e)=>e.type==="powerCompare").every((e)=>e.guardPower===35000 && e.attackPower===25000 && !e.hit));
assert.equal(activeEnergy(whiteGood.match,"p2"),0,"printed Extra energy cost2 paid");
assert.equal(whiteGood.actions.filter((a)=>a.type==="combo").length,0);
assert.ok(zones(whiteGood.match,"p2","hand").includes(zones(white.match,"p2","hand").find((id)=>white.match.state.cards[id].cardId==="BT31-132")!),"original free-combo Larva preserved");
assert.equal(zones(whiteGood.match,"p2","hand").length,2,"Extra consumed, one card drawn, original Larva retained");
assert.equal(whiteGood.events.filter((e)=>e.type==="move" && e.from==="battle" && e.to==="drop" && white.attackerIds.includes(e.card)).length,0,"opponent-turn Extra has no own-turn removal effect");
assert.equal(focusPresent(white,whiteCombo.match),false,"one combo only protects first battle");
assert.equal(whiteCombo.actions.filter((a)=>a.type==="combo").length,1);
assert.equal(focusPresent(white,whitePass.match),false,"a tied 25k guard is KO'd");

// Double Strike gives two damage, Dual Attack reactivates once (22-7/22-8).
const dualGood=oracleLine(dual,"attack");assert.equal(dualGood.stop,null);
assert.equal(dualGood.match.state.winner,"p1");assert.equal(dualGood.events.filter((e)=>e.type==="damage").reduce((n,e)=>n+e.amount,0),4);
assert.equal(dualGood.actions.filter((a)=>a.type==="attack").length,2);
assert.equal(dualGood.actions.filter((a)=>a.type==="combo").length,0);
assert.equal(dualGood.match.state.cards[dual.focus].mode,"rest","second attack has no third stand");
assert.equal(activeEnergy(dualGood.match,"p1"),0);

// Printed life payment occurs before the <=2 condition. Paying at3 leaves2
// and enables exactly3 damage; paying the last Life loses (21-2-2-1).
const standGood=oracleLine(restand,"restand"),lastBad=oracleLine(unsafe,"restand"),lastSafe=oracleLine(unsafe,"decline");
assert.equal(standGood.stop,null);assert.equal(standGood.match.state.winner,"p1");
assert.equal(zones(standGood.match,"p1","life").length,2);
assert.equal(standGood.events.filter((e)=>e.type==="damage").reduce((n,e)=>n+e.amount,0),3);
assert.equal(standGood.actions.filter((a)=>a.type==="attack").length,1);
assert.equal(lastBad.match.state.winner,"p2");assert.equal(zones(lastBad.match,"p1","life").length,0);
assert.equal(lastSafe.match.state.phase==="over",false);assert.equal(zones(lastSafe.match,"p1","life").length,1);

const policies=[{key:`heuristic-v${MAIN_POLICY_VERSION}`,policy:localPolicy(),depth:undefined},{key:`search-v${SEARCH_VERSION}-d2`,policy:searchPolicy({depth:2}),depth:2},{key:`search-v${SEARCH_VERSION}-d3`,policy:searchPolicy({depth:3}),depth:3}];
interface Measurement {key:string;portalScenarioId:string;policy:string;seed:number;seat:PlayerId;horizonSteps:number;initialPolicyRng:{p1:ReturnType<typeof policyRng>;p2:ReturnType<typeof policyRng>};outcome:"pass"|"fail"|"interrupted"|"error";objective:boolean;firstAction:string|null;activatedCards:string[];comboCards:number;energySpent:number;battles:number;life:number;focusPreserved:boolean;winner:PlayerId|null;stop:string|null;}
const records:Measurement[]=[];
let privacyPositions=0;
for(const c of cases) for(const selected of policies) {
  let match=clone(c.match),stop:string|null=null,firstAction:string|null=null,energySpent=0,comboCards=0;
  const events:GameEvent[]=[],activatedCards:string[]=[];const memory={p1:localMemory(policyRng(82701)),p2:localMemory(policyRng(82702))};
  const initialPolicyRng={p1:policyRng(82701),p2:policyRng(82702)};
  let error=false,steps=0;
  try {
    for(;steps<80;steps++) {
      const n=steps;
      if(enough(c,match,events)) break;
      const p=actor(match);if(!p){stop="missing actor";break;}
      if(p!==c.seat) {const out=applyMove(match,passiveAction(match,c));match=out.match;events.push(...out.events);continue;}
      const turn=policyTurn(match,p,n),rng=memory[p].rng;
      const chosen=selected.policy(turn.input,rng);
      const action=turn.key.menu[chosen.answer.id];
      if(firstAction===null) firstAction=action?.type ?? chosen.answer.id;
      // At every candidate position, changing only unknown identities/order
      // must preserve the restricted input and choice. This does not claim
      // that every hidden continuation has the same tactical result.
      for(const salt of [8271,8272]) {
        const twin=policyTurn(permutedFor(match,p,salt),p,n);
        assert.deepEqual(twin.input,turn.input,`${c.key}: hidden data stays outside policy input`);
        assert.deepEqual(selected.policy(twin.input,rng),chosen,`${c.key}: hidden twins choose identically`);
      }
      privacyPositions++;
      const next=localStep(match,p,n,memory[p],selected.policy);
      if(!next.ok){stop=`${next.reason}:${next.detail}`;break;}
      if(turn.key.menu[next.id]?.type==="combo") comboCards++;
      const applied=turn.key.menu[next.id];
      if(applied?.type==="activate") activatedCards.push(match.state.cards[applied.card].cardId);
      energySpent+=Math.max(0,activeEnergy(match,p)-activeEnergy(next.match,p));
      memory[p]=next.memory;match=next.match;events.push(...next.events);
      if(n===79) stop="80-decision bound";
    }
  } catch(e) {error=true;stop=String(e);}
  const battles=events.filter((e)=>e.type==="powerCompare").length;
  const objective=c===white ? focusPresent(c,match) && battles===2 && comboCards===0 && energySpent===2 :
    c===unsafe ? match.state.phase!=="over" && match.state.turn!==c.match.state.turn && zones(match,"p1","life").length===1 :
    match.state.winner==="p1" && (c!==restand || zones(match,"p1","life").length===2);
  records.push({key:c.key,portalScenarioId:c.portalScenarioId,policy:selected.key,seed:TACTICAL_SEED,seat:c.seat,horizonSteps:steps,initialPolicyRng,
    outcome:error?"error":stop?"interrupted":objective?"pass":"fail",objective,firstAction,activatedCards,comboCards,energySpent,battles,life:zones(match,c.seat,"life").length,focusPreserved:focusPresent(c,match),winner:match.state.winner ?? null,stop});
}
assert.ok(records.every((r)=>r.outcome!=="error" && r.outcome!=="interrupted"),JSON.stringify(records.filter((r)=>r.stop),null,2));
assert.ok(records.filter((r)=>r.key==="ai-10-decline-last-life-price" || r.key==="ai-10-restand-for-triple-strike").every((r)=>r.outcome==="pass"),"known fatal payment declined, safe useful payment retained, including search fallback");
const sha=(path:string)=>createHash("sha256").update(readFileSync(new URL(path,import.meta.url))).digest("hex");
const setups=cases.map((c)=>({key:c.key,recipeId:c.recipeId,sha256:evidenceHash({state:c.match.state,focus:c.focus,seat:c.seat,attackers:c.attackerIds,horizonBattles:c.horizonBattles})}));
const manifest:DecisionManifest={version:1,requestId:randomUUID(),source:"decision_cases",runner,protocol:{id:"827-real-card-tactics",revision:"printed-skill-lines-v1"},
  fixtures:cases.map((c)=>({...fixturePin(c.key,bundle,bundle.runtimeRevision),sourceId:`tactical-${setups.find((s)=>s.key===c.key)!.sha256}`})),
  policies:policies.map((p)=>({...policyPin(p.key,p.depth),version:p.depth ? `resource-search-v${SEARCH_VERSION}-depth-${p.depth}` : `heuristic-v${MAIN_POLICY_VERSION}`})),
  results:records.map((r)=>({key:`${r.key}-${r.policy}`,kind:"decision_case",fixtureKey:r.key,sourceScenarioId:r.key,portalScenarioId:r.portalScenarioId,
    policyKey:r.policy,seed:r.seed,seat:r.seat,initialPolicyRng:{p1:{mode:"seeded",...r.initialPolicyRng.p1},p2:{mode:"seeded",...r.initialPolicyRng.p2}},
    assertion:"acceptable_action",outcome:r.outcome,horizonSteps:r.horizonSteps,evidenceSha256:evidenceHash(r)}))};
assertManifest(manifest);
assert.deepEqual(evaluationRunnerPin("arena-policy-strategy","827-real-card-tactics-v1"),runner,"source changed during tactical run; discard and rerun");
const report={runner,protocol:manifest.protocol,scope:"three tactical scenarios plus last-life negative control; no deck or whole-family pass",seed:TACTICAL_SEED,setups,
  sourceHashes:{fixture:sha("./arena-real-card-tactics-fixture.ts"),scenario:sha("./arena-real-card-tactics.mts"),heuristic:sha("../../src/lib/arena/policy/combat.ts"),main:sha("../../src/lib/arena/policy/main.ts"),search:sha("../../src/lib/arena/policy/search.ts")},
  independentOracleLines:7,privacyPositions,records};
const out=flag("--out"),target=flag("--manifest-out");
if(out) writeEvidenceFile(out,`${JSON.stringify(report,null,2)}\n`);
if(target) writeEvidenceFile(target,`${JSON.stringify(manifest,null,2)}\n`);
console.log(JSON.stringify(report,null,2));

/** Executable #826 subcases. Oracles are declared engine continuations and
 * numeric resource objectives, independent of the candidate's scoring weights.
 * Full states/actions stay local; the manifest exporter projects hashes only.
 */
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { policyTurn, localStep } from "../../src/lib/arena/policy/boundary";
import { answerFor, type Policy } from "../../src/lib/arena/policy/contract";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { searchPolicy } from "../../src/lib/arena/policy/search";
import { strategyBundle, strategyOpening, layout, declare, STRATEGY_SEED } from "./arena-policy-strategy-fixture";

export interface StrategyEvidence {
  key: string; portalScenarioId: "ai-01" | "ai-02" | "ai-05"; policyKey: string; seed: number; seat: "p1" | "p2";
  initialPolicyRng: { p1: ReturnType<typeof policyRng>; p2: ReturnType<typeof policyRng> };
  outcome: "pass" | "fail" | "interrupted" | "error"; horizonSteps: number;
  detail: { acceptableFirst: boolean; objective: boolean; life: number; energySpent: number; comboCards: number; battles: number; stop: string | null };
}
export const STRATEGY_POLICIES = [
  { key:"heuristic-v1", policy:localPolicy() },
  { key:"search-v2-d2", policy:searchPolicy({depth:2}) },
  { key:"search-v2-d3", policy:searchPolicy({depth:3}) },
] as const;
export interface StrategyCase {
  key:string; portalScenarioId:StrategyEvidence["portalScenarioId"]; match:PinnedMatch; seat:"p1"|"p2";
  acceptable:(m:PinnedMatch,action:Record<string,unknown>)=>boolean; opponent:Policy; objective:(m:PinnedMatch)=>boolean;
  /** A one-battle finish is a distinct objective from eventually winning. */
  horizonBattles?: number;
}
// Legal numeric defense, independent of candidate/heuristic values. Only combos
// needed to hold the current attack are spent; every chosen ID is engine-offered.
const numericDefense: Policy = (input,rng) => {
  const o=input.observation, menu=input.decisions.decisions.filter((d) => d.kind === "menu");
  const pass=menu.find((d) => d.type === "pass" || d.type === "counter" && d.action.card === null || d.type === "block" && d.action.card === null);
  if(input.decisions.window === "combo" && o.turnPlayer !== o.seat && o.battle && o.battle.guardPower <= o.battle.attackPower) {
    const combo=menu.find((d) => d.type === "combo");
    if(combo) return {answer:answerFor(input.decisions,combo.id),rng};
  }
  return pass ? {answer:answerFor(input.decisions,pass.id),rng} : localPolicy()(input,rng);
};
const orderedAttacker: Policy = (input,rng) => {
  const menu=input.decisions.decisions.filter((d) => d.kind === "menu");
  if(input.decisions.window === "main") {
    const card=input.observation.you.battle.find((c) => c.cardId === "S-DS25" && c.mode === "active");
    const d=menu.find((d) => d.type === "attack" && d.action.attacker === card?.id && d.action.target === input.observation.them.leader?.id) ?? menu.find((d) => d.type === "endMain");
    if(d) return {answer:answerFor(input.decisions,d.id),rng};
  }
  const pass=menu.find((d) => d.type === "pass");
  return pass ? {answer:answerFor(input.decisions,pass.id),rng} : localPolicy()(input,rng);
};
export async function strategyCases() {
  const bundle=await strategyBundle(), opening=await strategyOpening(bundle);
  const empty={hand:[],energy:[],battle:[],energyMarkers:0,leaderMode:"rest" as const};
  const cases: StrategyCase[] = [
    {key:"ai-01-own-combo-lethal",portalScenarioId:"ai-01",seat:"p1",match:layout(opening,{...empty,hand:["S-10"],energy:["S-5"],battle:[{cardId:"S-15",mode:"active"}]},{...empty,life:1},"S-L20"),
      acceptable:(m,a)=>a.type==="attack" && a.target===m.state.sides.p2.zones.leader[0],opponent:numericDefense,objective:(m)=>m.state.phase==="over" && m.state.winner==="p1"},
    {key:"ai-01-life-replenishment",portalScenarioId:"ai-01",seat:"p1",match:layout(opening,{...empty,battle:Array.from({length:3},()=>({cardId:"S-5",mode:"active" as const}))},{...empty,life:3}),
      acceptable:(_m,a)=>a.type==="attack",opponent:numericDefense,objective:(m)=>m.state.phase!=="over" && m.state.sides.p2.zones.life.length>0},
    {key:"ai-05-critical-first",portalScenarioId:"ai-05",seat:"p1",match:layout(opening,{...empty,battle:[{cardId:"S-5",mode:"active"},{cardId:"S-CRIT",mode:"active"}]},{...empty,life:2}),
      acceptable:(m,a)=>a.type==="attack" && m.state.cards[String(a.attacker)]?.cardId==="S-CRIT",opponent:numericDefense,objective:(m)=>m.state.phase==="over" && m.state.winner==="p1"},
    {key:"ai-05-normal-first",portalScenarioId:"ai-05",seat:"p1",horizonBattles:1,match:layout(opening,{...empty,battle:[{cardId:"S-25",mode:"active"},{cardId:"S-CRIT",mode:"active"}]},{...empty,hand:["S-5"],life:1}),
      acceptable:(m,a)=>a.type==="attack" && m.state.cards[String(a.attacker)]?.cardId==="S-25",opponent:numericDefense,objective:(m)=>m.state.phase==="over" && m.state.winner==="p1"},
    {key:"ai-02-defer-first-defense",portalScenarioId:"ai-02",seat:"p2",match:declare(layout(opening,{...empty,battle:[{cardId:"S-15",mode:"active"},{cardId:"S-DS25",mode:"active"}]},{...empty,hand:["S-5","S-10"],energy:["S-5"],life:2}),"S-15"),
      acceptable:(_m,a)=>a.type==="pass",opponent:orderedAttacker,objective:(m)=>m.state.phase!=="over" && m.state.sides.p2.zones.life.length===1},
  ];
  return {bundle,cases};
}
export async function runStrategyCases(): Promise<{ bundle: Awaited<ReturnType<typeof strategyBundle>>; records: StrategyEvidence[] }> {
  const {bundle,cases}=await strategyCases();
  const records:StrategyEvidence[]=[];
  for(const c of cases) for(const selected of STRATEGY_POLICIES) {
    let match=c.match;
    const initialPolicyRng={p1:policyRng(82601),p2:policyRng(82602)};
    const memory={p1:localMemory(initialPolicyRng.p1),p2:localMemory(initialPolicyRng.p2)};
    let first:boolean|null=null, steps=0, stop:string|null=null, comboCards=0, energySpent=0, battles=0;
    try {
      for(;steps<80 && match.state.phase!=="over" && match.state.turn===c.match.state.turn;steps++) {
        if(battles >= (c.horizonBattles ?? Infinity) && !match.state.battle) break;
        const seat=(match.state.prompt as {player?:"p1"|"p2"}).player;
        if(!seat) {stop="no seat";break;}
        const turn=policyTurn(match,seat,steps);
        if(seat===c.seat && (c.seat==="p1" || turn.input.decisions.window==="combo") && first===null) {
          const chosen=selected.policy(turn.input,memory[seat].rng);
          const action=turn.key.menu[chosen.answer.id];
          first=!!action && c.acceptable(match,action as unknown as Record<string,unknown>);
        }
        const next=localStep(match,seat,steps,memory[seat],seat===c.seat?selected.policy:c.opponent);
        if(!next.ok) {stop=`${next.reason}:${next.detail}`;break;}
        if(turn.key.menu[next.id]?.type === "combo" && seat===c.seat) {
          comboCards++;
        }
        energySpent+=match.state.sides[c.seat].zones.energy.filter((id)=>match.state.cards[id].mode==="active" && next.match.state.cards[id].mode==="rest").length;
        battles+=next.events.filter((event)=>event.type==="powerCompare").length;
        memory[seat]=next.memory;match=next.match;
      }
      if(steps>=80 && match.state.phase!=="over" && match.state.turn===c.match.state.turn
        && !(battles >= (c.horizonBattles ?? Infinity) && !match.state.battle)) stop="decision limit (80)";
      const objective=c.objective(match);
      records.push({key:c.key,portalScenarioId:c.portalScenarioId,policyKey:selected.key,seed:STRATEGY_SEED,seat:c.seat,initialPolicyRng,
        outcome:stop?"interrupted":first&&objective?"pass":"fail",horizonSteps:steps,
        detail:{acceptableFirst:first===true,objective,life:match.state.sides[c.seat].zones.life.length,
          energySpent,comboCards,battles,stop}});
    } catch(error) {
      records.push({key:c.key,portalScenarioId:c.portalScenarioId,policyKey:selected.key,seed:STRATEGY_SEED,seat:c.seat,initialPolicyRng,outcome:"error",horizonSteps:steps,
        detail:{acceptableFirst:first===true,objective:false,life:match.state.sides[c.seat].zones.life.length,energySpent,comboCards,battles,stop:String(error)}});
    }
  }
  return {bundle,records};
}

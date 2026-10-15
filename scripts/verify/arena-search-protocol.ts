/** V1's +10M holdouts are consumed. V2 must never present them as fresh. */
import { SEED_SETS, type SeedSet } from "./arena-policy-seeds";
export const SEARCH_EVAL_SETS: Record<"dev"|"holdout",SeedSet>={
  dev:SEED_SETS.dev,
  holdout:{name:"holdout",base:20_000_000,size:1000,reserved:true},
};
export const SEARCH_HOLDOUT_PROTOCOL={id:"resource-search-826-strength",revision:"resource-search-826-v1",
  candidateDepth:2,
  fixtures:["AvA","AvB","BvA","BvB"],indices:{first:0,last:39},seats:["p1","p2"],base:20_000_000,
  engineSeeds:Object.fromEntries(["AvA","AvB","BvA","BvB"].map((name,i)=>[name,Array.from({length:40},(_,k)=>20_000_000+(649+i)*1000+k)])),
  policySeedFormula:"7919 + 2*k + (candidateSeat === p2 ? 1 : 0)",
  policyRngFormula:"p1=policyRng(2*policySeed+1), p2=policyRng(2*policySeed+2)",maxMoves:3000,
  approval:"Coordinator must review candidate source/config/fixture hashes and freeze chosen depth before any holdout execution.",
} as const;
export const SEARCH_STRENGTH_GATE={
  curatedPairs:160,decisivePairs:20,pairWinCiLowGreaterThan:0.5,
  perFixturePairCiUpperAtLeast:0.5,perFixturePowerMarkerPairs:20,
  completionRate:1,illegal:0,privacyFailures:0,
  workerStepP95Ms:30,workerStepMaxMs:300,workerRetainedBytes:16*1024*1024,
  policyP95Ms:5,searchReservationBytes:256*1024,
} as const;

/** Frozen development comparison proposal. No fresh holdout is authorized here. */
import { SEARCH_CACHE_LIMITS, SEARCH_LIMITS, SEARCH_PROTOCOL_REVISION } from "../../src/lib/arena/policy/search";
export const SEARCH_FRONTIER_DEV_PROTOCOL={id:"search-frontier-development",revision:SEARCH_PROTOCOL_REVISION,
  seedSet:"dev",indices:[0,1,2,3],fixtures:["AvA","AvB","BvA","BvB"],seats:["p1","p2"],gamesPerArm:32,
  arms:[{frontierCache:false,depth:2},{frontierCache:true,depth:2}],maxMoves:3000,
  baseline:"heuristic-v1 (stable key; main/combat/choices versions and source pinned)",limits:SEARCH_LIMITS,cacheLimits:SEARCH_CACHE_LIMITS,
  policySeedFormula:"7919 + 2*k + (candidateSeat === p2 ? 1 : 0)",
  approval:"Integrate, review and pin source/configuration before executing both32-game arms. Development evidence only; no default promotion.",
} as const;

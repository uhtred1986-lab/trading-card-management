/** Browser-safe aggregate diagnostics. No IDs, state, actions or free-form keys. */
import { SEARCH_CACHE_LIMITS, SEARCH_PHASES, SEARCH_REASONS, SEARCH_STATUSES, SEARCH_WINDOWS, type SearchReport } from "../../src/lib/arena/policy/search";

interface WindowTelemetry {decisions:number;statuses:Record<string,number>;reasons:Record<string,number>}
export interface SearchTelemetry {
  decisions:number;
  byWindow:Record<string,WindowTelemetry>;
  cache:{enabledDecisions:number;hits:number;misses:number;entriesStored:number;skipped:number;maxEntries:number;maxRetainedBytes:number};
}
export const searchTelemetry=():SearchTelemetry=>({decisions:0,byWindow:{},cache:{enabledDecisions:0,hits:0,misses:0,entriesStored:0,skipped:0,maxEntries:0,maxRetainedBytes:0}});
const add=(into:Record<string,number>,from:Record<string,number>)=>{for(const [key,n] of Object.entries(from)) into[key]=(into[key] ?? 0)+n;};
export function recordSearchTelemetry(into:SearchTelemetry,report:SearchReport):void {
  const key=`${report.window}/${report.phase}`;
  const bucket=into.byWindow[key] ?? (into.byWindow[key]={decisions:0,statuses:{},reasons:{}});
  into.decisions++;bucket.decisions++;add(bucket.statuses,{[report.status]:1});add(bucket.reasons,{[report.reason]:1});
  const c=report.cache;
  into.cache.enabledDecisions+=Number(c.enabled);into.cache.hits+=c.hits;into.cache.misses+=c.misses;
  into.cache.entriesStored+=c.entries;into.cache.skipped+=c.skipped;
  into.cache.maxEntries=Math.max(into.cache.maxEntries,c.entries);into.cache.maxRetainedBytes=Math.max(into.cache.maxRetainedBytes,c.retainedBytes);
}
export function mergeSearchTelemetry(rows:readonly SearchTelemetry[]):SearchTelemetry {
  const into=searchTelemetry();
  for(const row of rows) {
    into.decisions+=row.decisions;
    for(const [key,source] of Object.entries(row.byWindow)) {
      const bucket=into.byWindow[key] ?? (into.byWindow[key]={decisions:0,statuses:{},reasons:{}});
      bucket.decisions+=source.decisions;add(bucket.statuses,source.statuses);add(bucket.reasons,source.reasons);
    }
    for(const key of ["enabledDecisions","hits","misses","entriesStored","skipped"] as const) into.cache[key]+=row.cache[key];
    into.cache.maxEntries=Math.max(into.cache.maxEntries,row.cache.maxEntries);
    into.cache.maxRetainedBytes=Math.max(into.cache.maxRetainedBytes,row.cache.maxRetainedBytes);
  }
  return into;
}
const record=(x:unknown):x is Record<string,unknown>=>!!x && typeof x==="object" && !Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).length===keys.length && keys.every((k)=>Object.hasOwn(x,k));
const integer=(x:unknown):x is number=>typeof x==="number" && Number.isSafeInteger(x) && x>=0;
const sum=(x:Record<string,unknown>)=>Object.values(x).reduce<number>((n,x)=>n+(x as number),0);
/** Strict validation also prevents checkpoint payloads inventing private fields
 * or silently dropping telemetry during resume. */
export function validSearchTelemetry(value:unknown):value is SearchTelemetry {
  if(!record(value) || !exact(value,["decisions","byWindow","cache"]) || !integer(value.decisions) || !record(value.byWindow) || !record(value.cache)) return false;
  let decisions=0;
  for(const [key,bucket] of Object.entries(value.byWindow)) {
    const [window,phase,...extra]=key.split("/");
    if(extra.length || !SEARCH_WINDOWS.some((x)=>x===window) || !SEARCH_PHASES.some((x)=>x===phase)) return false;
    if(window==="main" ? phase!=="main" : window==="combo" ? phase!=="offense" && phase!=="defense" : phase!=="other") return false;
    if(!record(bucket) || !exact(bucket,["decisions","statuses","reasons"]) || !integer(bucket.decisions) || !record(bucket.statuses) || !record(bucket.reasons)) return false;
    if(!Object.entries(bucket.statuses).every(([k,n])=>SEARCH_STATUSES.some((x)=>x===k) && integer(n))
      || !Object.entries(bucket.reasons).every(([k,n])=>SEARCH_REASONS.some((x)=>x===k) && integer(n))) return false;
    if(sum(bucket.statuses)!==bucket.decisions || sum(bucket.reasons)!==bucket.decisions) return false;
    decisions+=bucket.decisions;
  }
  const c=value.cache;
  return decisions===value.decisions && exact(c,["enabledDecisions","hits","misses","entriesStored","skipped","maxEntries","maxRetainedBytes"])
    && Object.values(c).every(integer) && (c.enabledDecisions as number)<=decisions
    && (c.maxEntries as number)<=SEARCH_CACHE_LIMITS.entries && (c.maxRetainedBytes as number)<=SEARCH_CACHE_LIMITS.bytes
    && (c.entriesStored as number)>=(c.maxEntries as number)
    && ((c.enabledDecisions as number)>0 || Object.values(c).every((x)=>x===0));
}
export function telemetryStatuses(value:SearchTelemetry):Record<string,number> {
  const totals:Record<string,number>={};
  for(const row of Object.values(value.byWindow)) add(totals,row.statuses);
  return totals;
}

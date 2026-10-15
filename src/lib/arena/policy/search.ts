/**
 * Optional O5 attack-sequence experiment. This is a small information-set model,
 * not an interpreter: visible attacks are approximated, and every root
 * answer comes from the current legal menu. Unsupported positions use the
 * unchanged heuristic. No live match or game randomness enters this module.
 *
 * Opponent deck composition is deliberately absent from the observation. The
 * sampled hand therefore contains abstract free 0/5k combo resources under an
 * explicit experimental prior, never guessed card identities. Life replenishment
 * and visible own combos are modelled; counters, skill triggers, cost reducers,
 * extra attacks and future turns remain outside this model.
 */
import { answerFor, DECISION_WINDOWS, type MenuDecision, type Policy, type PolicyInput } from "./contract";
import { localPolicy } from "./combat";
import { cardValue, lifeLoss } from "./main";
import type { CardFacts } from "./observation";
import { nextInt, type PolicyRng } from "./rng";

export const SEARCH_VERSION = 3;
export const SEARCH_PROTOCOL_REVISION = "resource-frontier-dev-v1";
export const SEARCH_LIMITS = { nodes: 4096, bytes: 256 * 1024, samples: 8, depth: 3, decisions: 32, cards: 16, hand: 32, resources: 8, life: 8 } as const;
export const SEARCH_CACHE_LIMITS = { entries:64, bytes:64*1024, indexBytes:256, entryBytes:128, coverBytes:96 } as const;
export const SEARCH_STATUSES = ["searched","unsupported","nodes","memory","deadline","cancelled"] as const;
export const SEARCH_WINDOWS = [...DECISION_WINDOWS,"other"] as const;
export const SEARCH_PHASES = ["main","offense","defense","other"] as const;
export const SEARCH_REASONS = ["complete","disabled_configuration","not_search_window","baseline_action","decision_limit","opponent_hand_limit","life_limit","unison",
  "missing_leader","board_limit","hidden_or_missing_power","unknown_strike","defense_extra_attacks","resource_limit","defense_hidden_hand","defense_board",
  "missing_attack_facts","missing_battle_facts","no_scored_root","nonpositive_attack","node_budget","memory_budget","deadline","cancelled","memory_pressure"] as const;
export type SearchReason = typeof SEARCH_REASONS[number];
export type SearchStop = "deadline" | "cancelled" | "memory";
/** The host supplies a monotonic deadline/cancellation/memory-pressure check.
 * It must be cheap, non-blocking and must never read match state. Without it,
 * node-budget runs are deterministic (including across reloads).
 */
export interface SearchOptions {
  nodes?: number;
  bytes?: number;
  samples?: number;
  depth?: number;
  stop?: () => SearchStop | null;
  /** Developer experiment only; unchanged uncached behavior is the default. */
  frontierCache?: boolean;
  /** May only reduce the fixed cache ceiling; useful for budget proofs. */
  frontierCacheBytes?: number;
}
export interface FrontierCacheReport {enabled:boolean;hits:number;misses:number;entries:number;retainedBytes:number;skipped:number}
export interface SearchReport {
  version: typeof SEARCH_VERSION;
  status: typeof SEARCH_STATUSES[number];
  window:typeof SEARCH_WINDOWS[number];
  phase:typeof SEARCH_PHASES[number];
  reason:SearchReason;
  cache:FrontierCacheReport;
  nodes: number;
  /** Conservative structural reservation, not measured process/JS heap usage. */
  reservedBytes: number;
  samples: number;
}
export interface SearchResult extends SearchReport {
  answer: ReturnType<Policy>["answer"];
  rng: PolicyRng;
}

const keyword = (c: CardFacts, k: string) => c.keywords.some((x) => x.trim().toLowerCase() === k);
const supported = (c: CardFacts) => !c.hidden && c.power !== null;
// A small cost for exposing the model to skill text it does not execute. It
// ranks otherwise similar sequences conservatively; it is NOT a rule reading.
const uncertainty = (c: CardFacts) => (c.text ?? "").replace(/\[(Blocker|Critical|Double Strike|Triple Strike|Quadruple Strike|Revenge|Indestructible|Victory Strike)\]/gi, "").trim() ? .5 : 0;
// Native keyword projection names the family "Strike"; its parameter remains
// explicit in printed text. Do not silently read every family member as one.
const strike = (c: CardFacts): number | null => {
  for(const [name,count] of [["quadruple strike",4],["triple strike",3],["double strike",2]] as const) if(keyword(c,name)) return count;
  if(!keyword(c,"strike")) return 1; // Printed text survives skill negation.
  if(c.effects?.some((e)=>e.keyword && /strike/i.test(e.keyword))) return null;
  const printed=[...((c.text ?? "").matchAll(/\[(Double|Triple|Quadruple) Strike\]/gi))];
  return printed.length===1 ? ({double:2,triple:3,quadruple:4}[printed[0][1].toLowerCase()] ?? null) : null;
};
const bound = (n: number | undefined, fallback: number) => n === undefined ? fallback : Number.isFinite(n) ? Math.max(0, Math.min(fallback, Math.floor(n))) : 0;

/** The unknown opponent hand under the declared prior: independent 50% free
 * 5k combo / 50% unusable. This is a sensitivity model, not a catalog claim.
 * Sampling uses only a public hand count and the policy RNG, and changes neither.
 */
export function sampleComboHand(handCount: number, rng: PolicyRng): { combo: number; rng: PolicyRng } {
  let combo = 0;
  let next = rng;
  for (let i = 0; i < Math.min(SEARCH_LIMITS.hand, Math.max(0, Math.floor(handCount))); i++) {
    const draw = nextInt(next, 2);
    next = draw.rng;
    combo += draw.value;
  }
  return { combo, rng: next };
}

interface Position {
  used: number;
  killed: number;
  rested: number;
  life: number;
  combo: number;
  lifeCursor: number;
  spent: number;
  energy: number;
}
interface Attack { decision: MenuDecision; attacker: CardFacts; target: CardFacts; a: number; t: number }
interface Resource { card: CardFacts; power: number; energy: number; cost: number; field: boolean }
interface Cover { mask: number; power: number; energy: number; cost: number }

/** Pre-sampled Life slots are common across every root/continuation. Critical
 * consumes the same slots but never adds their resources to hand. */
export function sampleLifeResources(life: number, rng: PolicyRng): { slots: number[]; rng: PolicyRng } {
  const slots: number[] = [];
  let next = rng;
  for (let i = 0; i < Math.min(SEARCH_LIMITS.life, Math.max(0, Math.floor(life))); i++) {
    const draw = nextInt(next, 2); next = draw.rng; slots.push(draw.value);
  }
  return { slots, rng: next };
}
const resourcesOf = (input: PolicyInput): Resource[] => {
  const o = input.observation;
  return [...(o.you.hand ?? []).map((card) => ({ card, field: false })), ...o.you.battle.filter((c) => c.mode === "active").map((card) => ({ card, field: true }))]
    .filter(({ card }) => !card.hidden && card.comboPower !== null && card.comboPower > 0 && card.comboCost !== null)
    .sort((a, b) => a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0)
    .map(({ card, field }) => ({ card, field, power: card.comboPower!, energy: Math.max(0, card.comboCost!), cost: field ? cardValue(card) : 1 }));
};

/** Fully evaluated roots only: any exhausted budget discards partial scores AND
 * sampled RNG advancement, returning the exact heuristic answer and RNG.
 */
export function searchDecision(input: PolicyInput, rng: PolicyRng, options: SearchOptions = {}, heuristic: Policy = localPolicy()): SearchResult {
  const fallback = heuristic(input, rng);
  let nodes = 0, reservedBytes = 0, samples = 0;
  const cache:FrontierCacheReport={enabled:options.frontierCache===true,hits:0,misses:0,entries:0,retainedBytes:0,skipped:0};
  const window:SearchReport["window"]=DECISION_WINDOWS.find((w)=>w===input.decisions.window) ?? "other";
  const phase:SearchReport["phase"]=input.decisions.window==="main"?"main":input.decisions.window==="combo"?(input.observation.turnPlayer===input.observation.seat?"offense":"defense"):"other";
  const result = (status: SearchReport["status"], chosen = fallback, reason:SearchReason=status==="searched"?"complete":status==="nodes"?"node_budget":status==="memory"?"memory_pressure":status==="unsupported"?"no_scored_root":status): SearchResult =>
    ({ ...chosen, version: SEARCH_VERSION, status, window,phase,reason,cache:{...cache},nodes,reservedBytes,samples });
  const unsupported=(reason:SearchReason)=>result("unsupported",fallback,reason);
  const firstStop = options.stop?.();
  if (firstStop) return result(firstStop,fallback,firstStop==="memory"?"memory_pressure":firstStop);
  const cap = bound(options.nodes, SEARCH_LIMITS.nodes);
  const bytes = bound(options.bytes, SEARCH_LIMITS.bytes);
  const depth = options.depth === undefined ? 2 : bound(options.depth, SEARCH_LIMITS.depth);
  const count = bound(options.samples, SEARCH_LIMITS.samples);
  if (!cap) return result("nodes");
  if (!bytes) return result("memory",fallback,"memory_budget");
  const { observation: o, decisions: ds } = input;
  const baseline = ds.decisions.find((d) => d.id === fallback.answer.id);
  const main = ds.window === "main";
  const offense = ds.window === "combo" && o.turnPlayer === o.seat;
  const defense = ds.window === "combo" && o.turnPlayer !== o.seat;
  // First defensive subcase has only a Leader and known own combo resources;
  // hidden offensive pumps and future blocker/counter/activation timing remain
  // with the unchanged heuristic rather than a guessed defense promise.
  if (defense && o.them.handCount !== 0) return unsupported("defense_hidden_hand");
  if (defense && o.you.battle.length !== 0) return unsupported("defense_board");
  if (!depth || !count) return unsupported("disabled_configuration");
  if (!main && !offense && !defense) return unsupported("not_search_window");
  if (main && (baseline?.kind !== "menu" || !["attack", "endMain"].includes(baseline.type))) return unsupported("baseline_action");
  if(ds.decisions.length>SEARCH_LIMITS.decisions) return unsupported("decision_limit");
  if(o.them.handCount>SEARCH_LIMITS.hand) return unsupported("opponent_hand_limit");
  if(o.you.life>SEARCH_LIMITS.life || o.them.life>SEARCH_LIMITS.life) return unsupported("life_limit");
  if(o.you.unison || o.them.unison) return unsupported("unison");
  const own = [o.you.leader, ...o.you.battle].filter((c): c is CardFacts => !!c);
  const enemy = [o.them.leader, ...o.them.battle].filter((c): c is CardFacts => !!c);
  if(!o.you.leader || !o.them.leader) return unsupported("missing_leader");
  if(own.length+enemy.length>SEARCH_LIMITS.cards) return unsupported("board_limit");
  if(![...own,...enemy].every(supported)) return unsupported("hidden_or_missing_power");
  if([...own,...enemy].some((c)=>strike(c)===null)) return unsupported("unknown_strike");
  if(defense && enemy.some((c)=>keyword(c,"victory strike") || keyword(c,"dual attack") || keyword(c,"triple attack"))) return unsupported("defense_extra_attacks");
  const resources = resourcesOf(input);
  if (resources.length > SEARCH_LIMITS.resources) return unsupported("resource_limit");
  // Explicit bounded workspace, including common Life slots and own resources.
  reservedBytes = 2048 + ds.decisions.length * 512 + count * (SEARCH_LIMITS.life + 2) * 8
    + (depth + 2) * (4096 + 2 ** resources.length * 96) + (own.length + enemy.length + resources.length) * 256;
  if (reservedBytes > bytes) return result("memory",fallback,"memory_budget");
  const cacheCapacity=cache.enabled?Math.min(bound(options.frontierCacheBytes,SEARCH_CACHE_LIMITS.bytes),bytes-reservedBytes):0;
  const frontiers=cacheCapacity>=SEARCH_CACHE_LIMITS.indexBytes?new Map<string,Cover[]>():null;
  if(frontiers) {cache.retainedBytes=SEARCH_CACHE_LIMITS.indexBytes;reservedBytes+=cache.retainedBytes;}
  let exhausted: SearchReport["status"] | null = null;
  const step = () => {
    exhausted = options.stop?.() ?? (nodes >= cap ? "nodes" : null);
    if (exhausted) return false;
    nodes++; return true;
  };
  // Resource subsets are actual power/cost, not interchangeable 5k tokens.
  // Every subset node counts; no partial frontier escapes a budget failure.
  const covers = (spent: number, energy: number, excluded: Set<string>, required?: string): Cover[] => {
    let key="";
    if(frontiers) {
      if(!step()) return [];
      let excludedMask=0;
      for(let i=0;i<resources.length;i++) if(excluded.has(resources[i].card.id)) excludedMask|=1<<i;
      const index=required?resources.findIndex((r)=>r.card.id===required):-1;
      // -1 means no requirement; -2 means a required card outside this model.
      key=`${spent}/${energy}/${excludedMask}/${required && index===-1?-2:index}`;
      const found=frontiers.get(key);
      if(found) {cache.hits++;return found;}
      cache.misses++;
    }
    const out: Cover[] = [];
    const walk = (i: number, mask: number, power: number, paid: number, cost: number) => {
      if (!step()) return;
      if (i === resources.length) {
        if (!required || resources.some((r, k) => r.card.id === required && !!(mask & (1 << k)))) out.push({ mask, power, energy: paid, cost: cost + .25 * paid });
        return;
      }
      const r = resources[i];
      walk(i + 1, mask, power, paid, cost);
      if (!exhausted && !(spent & (1 << i)) && !excluded.has(r.card.id) && paid + r.energy <= energy) walk(i + 1, mask | (1 << i), power + r.power, paid + r.energy, cost + r.cost);
    };
    walk(0, 0, 0, 0, 0);
    // Never retain a partial frontier. Capacity only disables insertion; it
    // never discards a legal search or changes the scoring model.
    if(cache.enabled && !exhausted) {
      const size=SEARCH_CACHE_LIMITS.entryBytes+out.length*SEARCH_CACHE_LIMITS.coverBytes;
      if(frontiers && frontiers.size<SEARCH_CACHE_LIMITS.entries && cache.retainedBytes+size<=cacheCapacity) {
        frontiers.set(key,out);cache.entries++;cache.retainedBytes+=size;reservedBytes+=size;
      } else cache.skipped++;
    }
    return out;
  };
  const fieldSpent = (spent: number, id: string) => resources.some((r, i) => r.field && r.card.id === id && !!(spent & (1 << i)));
  let next = rng;
  const worlds: { combo: number; life: number[] }[] = [];
  for (let i = 0; i < count; i++) {
    if (!step()) return result(exhausted!);
    const hand = sampleComboHand(o.them.handCount, next); next = hand.rng;
    const life = sampleLifeResources(defense ? o.you.life : o.them.life, next); next = life.rng;
    worlds.push({ combo: hand.combo, life: life.slots }); samples++;
  }
  const menu = ds.decisions.filter((d): d is MenuDecision => d.kind === "menu").sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const attacks: Attack[] = menu.filter((d) => d.type === "attack").map((decision) => {
    const a = own.findIndex((c) => c.id === decision.action.attacker), t = enemy.findIndex((c) => c.id === decision.action.target);
    return { decision, attacker: own[a], target: enemy[t], a, t };
  });
  // At the offense window the current attack is fixed; future Leader attacks
  // use only public active attackers. Restrictions/extra attacks stay approximate.
  if (offense && o.battle) for (let a = 0; a < own.length; a++) if (own[a].mode === "active") attacks.push({ decision: menu[0], attacker: own[a], target: o.them.leader, a, t: enemy.findIndex((c) => c.id === o.them.leader!.id) });
  if (attacks.some((a) => !a.attacker || !a.target)) return unsupported("missing_attack_facts");
  const leader = enemy.findIndex((c) => c.id === o.them.leader!.id);
  const restMask = enemy.reduce((mask,c,i) => c.mode === "rest" ? mask | (1 << i) : mask, 0);
  const initial = (combo: number): Position => ({ used: 0, killed: 0, rested: restMask, life: o.them.life, combo, lifeCursor: 0, spent: 0, energy: o.you.activeEnergy });
  const replenish = (slots: number[], cursor: number, damage: number, critical: boolean) => critical ? 0 : slots.slice(cursor, cursor + damage).reduce((n,x) => n+x,0);
  const follow = (p: Position, left: number, slots: number[]): number => {
    if (!left || p.life <= 0 || exhausted) return 0;
    let best = 0;
    for (const a of attacks) {
      if (!(p.used & (1 << a.a)) && !(p.killed & (1 << a.t)) && !fieldSpent(p.spent,a.attacker.id)) best = Math.max(best, fight(a,p,left,slots));
      if (exhausted) break;
    }
    return best;
  };
  const fight = (a: Attack, p: Position, left: number, slots: number[], fixed?: Cover, currentPower?: number): number => {
    if (!step()) return 0;
    const excluded = new Set([a.attacker.id, ...own.filter((_,i) => !!(p.used & (1 << i))).map((c) => c.id)]);
    const pumps = fixed ? [fixed] : covers(p.spent,p.energy,excluded);
    let best = -Infinity;
    for (const pump of pumps) {
      let worst = Infinity;
      for (let t = 0; t < enemy.length; t++) {
        const target = enemy[t];
        if (currentPower !== undefined && t !== a.t) continue; // Blocker window already closed.
        if (t !== a.t && ((p.killed | p.rested) & (1 << t) || !keyword(target,"blocker"))) continue;
        if (p.killed & (1 << t)) continue;
        const power = (currentPower ?? a.attacker.power ?? 0) + pump.power;
        const guardPower=currentPower !== undefined ? o.battle!.guardPower : target.power ?? 0;
        const needed = Math.max(0,Math.floor((power - guardPower)/5000)+1);
        for (const spent of needed > 0 && needed <= p.combo ? [0,needed] : [0]) {
          if (!step()) return 0;
          const hit = power >= guardPower + spent * 5000;
          const critical = currentPower !== undefined ? o.battle?.stakes?.critical ?? keyword(a.attacker,"critical") : keyword(a.attacker,"critical");
          const damage = hit && t === leader ? Math.min(p.life,keyword(a.attacker,"victory strike") ? p.life : currentPower !== undefined ? o.battle?.stakes?.strikeDamage ?? strike(a.attacker)! : strike(a.attacker)!) : 0;
          const killed = hit && t !== leader && !keyword(target,"indestructible");
          const gain = damage ? lifeLoss(p.life,damage,critical,false) : killed ? cardValue(target) : 0;
          const risk = uncertainty(a.attacker) + uncertainty(target) + (a.attacker.id === o.you.leader?.id ? 0 : .25 * cardValue(a.attacker))
            + (t !== leader && keyword(target,"revenge") && a.attacker.id !== o.you.leader?.id ? cardValue(a.attacker) : 0);
          const q = { ...p, used:p.used | (1 << a.a), killed:killed ? p.killed | (1 << t) : p.killed,
            rested:t === a.t ? p.rested : p.rested | (1 << t), life:p.life-damage, spent:p.spent | pump.mask, energy:p.energy-pump.energy,
            lifeCursor:p.lifeCursor+damage, combo:p.combo-spent+replenish(slots,p.lifeCursor,damage,critical) };
          // Prefer an immediate forced finish to gaining disposable resources
          // before the same finish. The 1% per-attack horizon discount also
          // charges exposure to another unmodelled response window.
          worst = Math.min(worst,gain+spent-risk-pump.cost+.99*follow(q,left-1,slots));
        }
      }
      best = Math.max(best,worst);
    }
    return best;
  };
  let bestId: string | null = null, bestScore = -Infinity;
  const consider = (id: string, score: number) => { if (score > bestScore || score === bestScore && id === baseline?.id) { bestId=id; bestScore=score; } };
  if (main) {
    for (const a of attacks) { let total=0; for (const w of worlds) { total+=fight(a,initial(w.combo),depth,w.life); if(exhausted) return result(exhausted); } consider(a.decision.id,total); }
  } else if (offense && o.battle) {
    const attacker = own.find((c) => c.id === o.battle!.attacker), target = enemy.find((c) => c.id === o.battle!.guard);
    if (!attacker || !target) return unsupported("missing_battle_facts");
    const a = { decision: menu[0], attacker,target,a:own.indexOf(attacker),t:enemy.indexOf(target) };
    for (const d of menu.filter((d) => d.type === "combo" || d.type === "pass")) {
      const pumps = d.type === "pass" ? [{mask:0,power:0,energy:0,cost:0}] : covers(0,o.you.activeEnergy,new Set([attacker.id]),String(d.action.card));
      if(exhausted) return result(exhausted);
      let total=0;
      for(const w of worlds) { let value=-Infinity; for(const pump of pumps) value=Math.max(value,fight(a,initial(w.combo),depth,w.life,pump,o.battle.attackPower)); total+=value; if(exhausted) return result(exhausted); }
      consider(d.id,total);
    }
  } else if (defense && o.battle && o.battle.guard === o.you.leader.id) {
    const current = enemy.find((c) => c.id === o.battle!.attacker);
    if (!current) return unsupported("missing_battle_facts");
    const future = enemy.filter((c) => c.id !== current.id && c.mode === "active");
    // Defensive subcase: known generic combo cards and public one-attack threats.
    // Counters/blockers/activations/extra attacks remain with the heuristic.
    const lossAfter = (life: number, cursor: number, abstract: number, spentMask: number, energy: number, used: number, left: number, slots: number[]): number => {
      if (!left || life <= 0 || exhausted) return 0;
      let worst=0;
      for(let i=0;i<future.length;i++) if(!(used & (1<<i))) {
        const a=future[i]; let best=Infinity;
        for(const cover of covers(spentMask,energy,new Set([o.you.leader!.id]))) {
          if(!step()) return 0;
          const needed=Math.max(0,Math.floor(((a.power??0)-(o.you.leader!.power??0)-cover.power)/5000)+1);
          for(const pay of needed>0 && needed<=abstract ? [0,needed] : [0]) {
            const damage=(a.power??0)>=(o.you.leader!.power??0)+cover.power+pay*5000 ? Math.min(life,strike(a)!) : 0;
            const critical=keyword(a,"critical");
            const nextAbstract=abstract-pay+replenish(slots,cursor,damage,critical);
            best=Math.min(best,lifeLoss(life,damage,critical,false)+cover.cost+pay
              +lossAfter(life-damage,cursor+damage,nextAbstract,spentMask|cover.mask,energy-cover.energy,used|(1<<i),left-1,slots));
          }
        }
        worst=Math.max(worst,best);
        if(exhausted) break;
      }
      return worst;
    };
    for(const d of menu.filter((d) => d.type === "combo" || d.type === "pass")) {
      const choices=d.type === "pass" ? [{mask:0,power:0,energy:0,cost:0}] : covers(0,o.you.activeEnergy,new Set([o.you.leader.id]),String(d.action.card));
      if(exhausted) return result(exhausted);
      let total=0;
      for(const w of worlds) { let best=Infinity; for(const cover of choices) {
        if(!step()) return result(exhausted!);
        const hit=o.battle.attackPower>=o.battle.guardPower+cover.power;
        const damage=hit?Math.min(o.you.life,o.battle.stakes?.strikeDamage ?? strike(current)!):0, critical=o.battle.stakes?.critical ?? keyword(current,"critical");
        best=Math.min(best,lifeLoss(o.you.life,damage,critical,false)+cover.cost
          +lossAfter(o.you.life-damage,damage,replenish(w.life,0,damage,critical),cover.mask,o.you.activeEnergy-cover.energy,0,depth-1,w.life));
      } total-=best; if(exhausted) return result(exhausted); }
      consider(d.id,total);
    }
  } else return unsupported("missing_battle_facts");
  const finalStop=options.stop?.();
  if(finalStop) return result(finalStop,fallback,finalStop==="memory"?"memory_pressure":finalStop);
  if(!bestId || !Number.isFinite(bestScore)) return unsupported("no_scored_root");
  if(main && baseline?.kind === "menu" && baseline.type === "endMain" && bestScore<=0) return unsupported("nonpositive_attack");
  return result("searched",{answer:answerFor(ds,bestId),rng:next});
}

/** Opt-in adapter; callers must explicitly choose this policy. The shipped
 * localPolicy and online opponent are unchanged. Reports never contain input.
 */
export function searchPolicy(options: SearchOptions = {}, report?: (value: SearchReport) => void): Policy {
  const heuristic = localPolicy();
  return (input, rng) => {
    const result = searchDecision(input, rng, options, heuristic);
    const {answer,rng:nextRng,...metrics}=result;
    report?.(metrics);
    return { answer, rng:nextRng };
  };
}

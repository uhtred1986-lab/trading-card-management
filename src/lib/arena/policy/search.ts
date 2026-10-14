/**
 * Optional O5 attack-sequence experiment. This is a small information-set model,
 * not an interpreter: visible attacks are approximated, and every root
 * answer comes from the current legal menu. Unsupported positions use the
 * unchanged heuristic. No live match or game randomness enters this module.
 *
 * Opponent deck composition is deliberately absent from the observation. The
 * sampled hand therefore contains abstract free 0/5k combo resources under an
 * explicit experimental prior, never guessed card identities. Counters, draws,
 * skill triggers, own combos and future turns are outside this model.
 */
import { answerFor, type MenuDecision, type Policy, type PolicyInput } from "./contract";
import { localPolicy } from "./combat";
import { cardValue, lifeLoss } from "./main";
import type { CardFacts } from "./observation";
import { nextInt, type PolicyRng } from "./rng";

export const SEARCH_VERSION = 1;
export const SEARCH_LIMITS = { nodes: 4096, bytes: 256 * 1024, samples: 8, depth: 2, decisions: 32, cards: 16, hand: 32 } as const;
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
}
export interface SearchReport {
  version: typeof SEARCH_VERSION;
  status: "searched" | "unsupported" | "nodes" | "memory" | "deadline" | "cancelled";
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
const strike = (c: CardFacts) => keyword(c, "quadruple strike") ? 4 : keyword(c, "triple strike") ? 3 : keyword(c, "double strike") ? 2 : 1;
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
}
interface Attack { decision: MenuDecision; attacker: CardFacts; target: CardFacts; a: number; t: number }

/** Fully evaluated roots only: any exhausted budget discards partial scores AND
 * sampled RNG advancement, returning the exact heuristic answer and RNG.
 */
export function searchDecision(input: PolicyInput, rng: PolicyRng, options: SearchOptions = {}, heuristic: Policy = localPolicy()): SearchResult {
  const fallback = heuristic(input, rng);
  let nodes = 0;
  let reservedBytes = 0;
  let samples = 0;
  const result = (status: SearchReport["status"], chosen = fallback): SearchResult => ({ ...chosen, version: SEARCH_VERSION, status, nodes, reservedBytes, samples });
  const firstStop = options.stop?.();
  if (firstStop) return result(firstStop);
  const cap = bound(options.nodes, SEARCH_LIMITS.nodes);
  const bytes = bound(options.bytes, SEARCH_LIMITS.bytes);
  const depth = bound(options.depth, SEARCH_LIMITS.depth);
  const count = bound(options.samples, SEARCH_LIMITS.samples);
  if (!cap) return result("nodes");
  if (!bytes) return result("memory");
  const { observation: o, decisions: ds } = input;
  const baseline = ds.decisions.find((d) => d.id === fallback.answer.id);
  if (!depth || !count || ds.window !== "main" || baseline?.kind !== "menu" || baseline.type !== "attack"
    || ds.decisions.length > SEARCH_LIMITS.decisions || o.them.handCount > SEARCH_LIMITS.hand
    || o.you.unison || o.them.unison) return result("unsupported");
  const attackers = [o.you.leader, ...o.you.battle].filter((c): c is CardFacts => !!c);
  const targets = [o.them.leader, ...o.them.battle].filter((c): c is CardFacts => !!c);
  if (!o.them.leader || attackers.length + targets.length > SEARCH_LIMITS.cards || ![...attackers, ...targets].every(supported)) return result("unsupported");
  // Includes the bounded root list, samples and the worst simultaneous DFS
  // frames. Never retain a tree or allocate in proportion to the node budget.
  reservedBytes = 1024 + ds.decisions.length * 512 + count * 8 + (depth + 1) * 1024 + (attackers.length + targets.length) * 128;
  if (reservedBytes > bytes) return result("memory");
  const attacks: Attack[] = ds.decisions.filter((d): d is MenuDecision => d.kind === "menu" && d.type === "attack")
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((decision) => {
      const a = attackers.findIndex((c) => c.id === decision.action.attacker);
      const t = targets.findIndex((c) => c.id === decision.action.target);
      return { decision, attacker: attackers[a], target: targets[t], a, t };
    });
  if (attacks.some((a) => !a.attacker || !a.target)) return result("unsupported");
  let next = rng;
  const hands: number[] = [];
  for (let i = 0; i < count; i++) {
    const stop = options.stop?.();
    if (stop) return result(stop);
    const drawn = sampleComboHand(o.them.handCount, next);
    hands.push(drawn.combo);
    next = drawn.rng;
    samples++;
  }
  let exhausted: SearchReport["status"] | null = null;
  const step = () => {
    exhausted = options.stop?.() ?? (nodes >= cap ? "nodes" : null);
    if (exhausted) return false;
    nodes++;
    return true;
  };
  const leader = targets.findIndex((c) => c.id === o.them.leader!.id);
  const initialRested = targets.reduce((mask, c, i) => c.mode === "rest" ? mask | (1 << i) : mask, 0);
  const continuation = (p: Position, left: number): number => {
    if (!left || p.life <= 0 || exhausted) return 0;
    let best = 0; // May stop attacking.
    for (const attack of attacks) {
      if (!(p.used & (1 << attack.a)) && !(p.killed & (1 << attack.t))) best = Math.max(best, battle(attack, p, left));
      if (exhausted) break;
    }
    return best;
  };
  const battle = (attack: Attack, p: Position, left: number): number => {
    if (!step()) return 0;
    const used = p.used | (1 << attack.a);
    let worst = Infinity;
    // Defender can accept the declared target, or redirect to any standing
    // Blocker once. Both choices consume this attacker's one modelled attack.
    for (let t = 0; t < targets.length; t++) {
      const target = targets[t];
      if (t !== attack.t && ((p.killed | p.rested) & (1 << t) || !keyword(target, "blocker"))) continue;
      if (p.killed & (1 << t)) continue;
      const rested = t === attack.t ? p.rested : p.rested | (1 << t);
      const needed = Math.max(0, Math.floor(((attack.attacker.power ?? 0) - (target.power ?? 0)) / 5000) + 1);
      // Resolve no combo, plus the cheapest successful sampled defence. Excess
      // combo cannot improve this bounded battle model.
      for (const spent of needed > 0 && needed <= p.combo ? [0, needed] : [0]) {
        if (!step()) return 0;
        const hit = (attack.attacker.power ?? 0) >= (target.power ?? 0) + spent * 5000;
        const damage = hit && t === leader ? keyword(attack.attacker, "victory strike") ? p.life : Math.min(p.life, strike(attack.attacker)) : 0;
        const killed = hit && t !== leader && !keyword(target, "indestructible");
        const gain = damage ? lifeLoss(p.life, damage, keyword(attack.attacker, "critical"), false) : killed ? cardValue(target) : 0;
        const revenge = t !== leader && keyword(target, "revenge") && attack.attacker.id !== o.you.leader?.id;
        // The attacker is exposed next turn. Unknown triggers/restrictions are
        // left to the real engine; their uncertainty lowers the model score.
        const exposure = attack.attacker.id === o.you.leader?.id ? 0 : .25 * cardValue(attack.attacker);
        const risk = uncertainty(attack.attacker) + uncertainty(target) + exposure + (revenge ? cardValue(attack.attacker) : 0);
        const q = { used, rested, killed: killed ? p.killed | (1 << t) : p.killed, life: p.life - damage, combo: p.combo - spent };
        // Consuming a sampled hand resource is useful pressure (one card).
        const score = gain + spent - risk + continuation(q, left - 1);
        worst = Math.min(worst, score);
      }
    }
    return worst;
  };
  let best: Attack | null = null;
  let score = -Infinity;
  for (const attack of attacks) {
    let total = 0;
    for (const combo of hands) {
      total += battle(attack, { used: 0, killed: 0, rested: initialRested, life: o.them.life, combo }, depth);
      if (exhausted) return result(exhausted);
    }
    if (total > score || (total === score && attack.decision.id === baseline.id)) { score = total; best = attack; }
  }
  const finalStop = options.stop?.();
  if (finalStop) return result(finalStop);
  if (!best) return result("unsupported");
  return result("searched", { answer: answerFor(ds, best.decision.id), rng: next });
}

/** Opt-in adapter; callers must explicitly choose this policy. The shipped
 * localPolicy and online opponent are unchanged. Reports never contain input.
 */
export function searchPolicy(options: SearchOptions = {}, report?: (value: SearchReport) => void): Policy {
  const heuristic = localPolicy();
  return (input, rng) => {
    const result = searchDecision(input, rng, options, heuristic);
    report?.({ version: result.version, status: result.status, nodes: result.nodes, reservedBytes: result.reservedBytes, samples: result.samples });
    return { answer: result.answer, rng: result.rng };
  };
}

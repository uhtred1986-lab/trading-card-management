import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { queryHookStatics } from "./program";

/** The unchanged damage query shared by the resolver and its public projection. */
interface DamageRule {
  atLeast?: number;
  to?: "drop";
  allMarkers?: boolean;
  wins?: boolean;
}

/**
 * 8-4-6, 22-6/22-7/22-18: the attacker's `beforeDamage` bodies — [Critical],
 * [Strike X], [Victory Strike] — read declaratively the moment the damage
 * lands (`queryHookStatics`), the legacy `battleDamage`'s own inline
 * `has`/`keyword` reads. A keyword granted for the turn counts, as it does
 * there. Two [Strike]s keep the larger X.
 */
export function damageRule(ctx: EngineContext, game: GameDefinition, state: VmState, attacker: string): DamageRule {
  const out: DamageRule = {};
  for (const f of queryHookStatics(ctx, game, state, attacker, "beforeDamage")) {
    if (f.op !== "battleDamage") continue;
    if (f.atLeast !== undefined) out.atLeast = Math.max(out.atLeast ?? 0, f.atLeast);
    if (f.to) out.to = f.to;
    if (f.allMarkers) out.allMarkers = true;
    if (f.wins) out.wins = true;
  }
  return out;
}

/** 8-1-7, 23-5-4: the resolver and projection share the same battle eligibility. */
export function battleIntact(state: VmState): boolean {
  const b = state.battle;
  if (!b || b.hiddenOut) return false;
  return inPlayZone(state, b.attacker) !== null && inPlayZone(state, b.guard) !== null;
}

function inPlayZone(state: VmState, id: string): PlayerId | null {
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (const zone of ["battle", "leader", "unison"]) if (state.sides[p].zones[zone]?.includes(id)) return p;
  }
  return null;
}


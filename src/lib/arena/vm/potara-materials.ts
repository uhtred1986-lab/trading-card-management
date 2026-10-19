/** Potara owns distinct material/source semantics; shared matching executes its slots. */
import type { Skill } from "../types";
import type { PotaraMaterials, SkillPrice } from "./script";
import { filterProblem } from "./script-schema";
import { IllegalAction } from "./common";
export const POTARA_REBUILD = "missing or malformed typed Union-Potara material contract v1; regenerate rules and rebuild saved matches/exports (#907)";
export const isPotaraSkill = (s: Pick<Skill, "keyword">) => s.keyword?.name === "Union" && s.keyword.variant === "Potara";
export function potaraMaterialsProblem(value: unknown): string | null {
  const p = value as PotaraMaterials | undefined;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some(k => !["version", "variant", "activation", "base", "needs", "samePower", "extensions"].includes(k))
    || p.version !== 1 || p.variant !== "Potara" || p.activation !== "hand" || p.base !== "battle" || p.samePower !== false || !Array.isArray(p.needs) || p.needs.length !== 2
    || !Array.isArray(p.extensions) || new Set(p.extensions).size !== p.extensions.length || p.extensions.some(k => !["unionEnergy", "unionFusionWarp", "unionSourceUnder", "unionSourceOpponentBattle"].includes(k))) return POTARA_REBUILD;
  for (const n of p.needs) if (!n || typeof n !== "object" || Array.isArray(n) || Object.keys(n).some(k => !["name", "filter"].includes(k)) || typeof n.name !== "string" || !n.name.trim() || n.name !== n.name.trim() || /[<>]/.test(n.name) || filterProblem(n.filter) || n.filter.unreadable) return POTARA_REBUILD;
  return null;
}
export function requirePotaraMaterials(price: SkillPrice | undefined): PotaraMaterials {
  const bad = potaraMaterialsProblem(price?.potara); if (bad) throw new IllegalAction(bad); return price!.potara!;
}
/** Migration detection only. Constant bound native variant branches prevent a
 * dormant Potara branch in a valid Fusion declaration from claiming execution. */
export function containsPotaraPlay(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPotaraPlay);
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  if (op.op === "if" && op.cond && typeof op.cond === "object") {
    const c = op.cond as Record<string, unknown>;
    if (c.kind === "oneOf" && typeof c.value === "string" && Array.isArray(c.of)) return containsPotaraPlay(c.of.includes(c.value) ? op.then : op.else);
  }
  return op.op === "play" && op.using === "Union-Potara" || Object.values(op).some(containsPotaraPlay);
}

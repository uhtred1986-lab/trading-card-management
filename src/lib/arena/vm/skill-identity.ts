import { POTARA_REBUILD, isPotaraSkill, potaraMaterialsProblem, potaraPrintedSelector } from "./potara-materials";
import { ABSORB_REBUILD, isAbsorbSkill, absorbEffectProblem } from "./absorb-procedure";
import { evolutionBaseProblem, needsEvolutionContract, EVOLUTION_REBUILD } from "./evolution-base";
/** Record-owned Fusion identity; native keyword declarations remain ruleset-owned. */
import type { Skill } from "../types";
import type { Script } from "./script";
import { fusionMaterialsProblem, isFusionSkill } from "./fusion-materials";
import { skillPriceProblem } from "./skill-payment";
import { NotYet } from "./errors";

export const FUSION_IDENTITY_REBUILD = "missing or contradictory recorded Union-Fusion identity; regenerate rules and rebuild saved matches/exports (#907)";
/**
 * The identity checks below are pure functions of a recorded script (its kind, price and ops), which a
 * game never changes, and `skillsShowing` asks them for every printed line many times per engine step.
 * Each answer is kept per script object (and per `required`), so the schema checks run once per record
 * (9 Nov 2026: about a third of a search step on BT29–BT31 decks). A new or rebuilt script object is a
 * new key, so nothing stale is read.
 */
function perScript<S extends object>(check: (script: S | undefined, required: boolean) => string | null): (script: S | undefined, required?: boolean) => string | null {
  const known = [new WeakMap<object, string | null>(), new WeakMap<object, string | null>()];
  return (script, required = false) => {
    if (!script) return check(script, required);
    const cache = known[required ? 1 : 0];
    if (cache.has(script)) return cache.get(script)!;
    const answer = check(script, required);
    cache.set(script, answer);
    return answer;
  };
}

export const fusionIdentityProblem = perScript((script: Pick<Script, "kind" | "price"> | undefined, required: boolean): string | null => {
  if (!required && script?.price?.fusion === undefined) return null;
  if (script?.kind !== "keyword") return FUSION_IDENTITY_REBUILD;
  return skillPriceProblem(script.price) ?? fusionMaterialsProblem(script.price?.fusion);
});
export const evolutionIdentityProblem = perScript((script: Pick<Script, "kind" | "price"> | undefined, required: boolean): string | null => {
  if (!required && script?.price?.evolution === undefined) return null;
  if (script?.kind !== "keyword") return EVOLUTION_REBUILD;
  return skillPriceProblem(script.price) ?? evolutionBaseProblem(script.price?.evolution);
});
export const potaraIdentityProblem = perScript((script: (Pick<Script, "kind" | "price"> & {ops?: Script["ops"]}) | undefined, required: boolean): string | null => {
  if (!required && script?.price?.potara === undefined) return null;
  if (script?.kind !== "keyword") return POTARA_REBUILD;
  return skillPriceProblem(script.price) ?? potaraMaterialsProblem(script.price?.potara) ?? (potaraPrintedSelector(script.ops) ? POTARA_REBUILD : null);
});
export function potaraLineProblem(line: { script?: Script; skill: Skill; keyword?: {name: string} }, required = false): string | null {
  if (!required && line.script?.price?.potara === undefined && !isPotaraSkill(line.skill)) return null;
  return potaraIdentityProblem(line.script, true) ?? (!isPotaraSkill(line.skill) || line.skill.kind !== "keyword" || line.keyword?.name !== "Union" ? POTARA_REBUILD : null);
}
/** Identity is joint with the complete bounded recorded cost and effect programs. */
export const absorbIdentityProblem = perScript((script: Pick<Script, "kind" | "price" | "ops"> | undefined, required: boolean): string | null => {
  if (!required && script?.price?.absorb === undefined) return null;
  if (script?.kind !== "keyword" || script.price?.absorb === undefined) return ABSORB_REBUILD;
  return skillPriceProblem(script.price) ?? absorbEffectProblem(script.ops);
});
export function absorbLineProblem(line: { script?: Script; skill: Skill; keyword?: { name: string } }, required = false): string | null {
  if (!required && line.script?.price?.absorb === undefined && !isAbsorbSkill(line.skill)) return null;
  return absorbIdentityProblem(line.script, true) ?? (line.skill.kind !== "keyword" || !isAbsorbSkill(line.skill) || line.keyword?.name !== "Union" ? ABSORB_REBUILD : null);
}
/** JSON-safe structural equality for two captures of the same executable record. */
export function sameAbsorbIdentity(a: unknown, b: unknown): boolean {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
/** Printed Fusion can identify a missing migration, never supply executable identity. */
export function recordedSkillIdentity(skill: Skill, script: Script | undefined): Skill {
  const known = ["keyword", "auto", "permanent", "activate:main", "activate:battle", "activate:main/battle", "counter:play", "counter:attack", "counter:battle card attack", "counter:counter"];
  const kind = script?.kind && known.includes(script.kind) ? script.kind : skill.kind;
  // A blocked record cannot become a native hook through its displayed tags.
  if (script?.unsupported.length) return { ...skill, kind, keyword: null, tags: [] };
  if (script?.price?.potara !== undefined || script?.price?.fusion === undefined && script?.price?.evolution === undefined && script?.price?.absorb === undefined && isPotaraSkill(skill)) {
    const gap = potaraIdentityProblem(script, true); if (gap) throw new NotYet(gap, "#907");
    return { ...skill, kind: "keyword", keyword: { name: "Union", variant: "Potara" }, tags: [] };
  }
  if (script?.price?.absorb !== undefined || script?.price?.fusion === undefined && script?.price?.evolution === undefined && isAbsorbSkill(skill)) {
    const gap = absorbIdentityProblem(script, true); if (gap) throw new NotYet(gap, "#907");
    return { ...skill, kind: "keyword", keyword: { name: "Union", variant: "Absorb" }, tags: [] };
  }
  if (script?.price?.fusion !== undefined || script?.price?.evolution === undefined && isFusionSkill(skill)) {
    const gap = fusionIdentityProblem(script, true); if (gap) throw new NotYet(gap, "#907");
    return { ...skill, kind: "keyword", keyword: { name: "Union", variant: "Fusion" }, tags: [] };
  }
  if (script?.price?.evolution !== undefined || needsEvolutionContract(skill)) {
    const gap = evolutionIdentityProblem(script, true); if (gap) throw new NotYet(gap, "#907");
    return { ...skill, kind: "keyword", keyword: { name: "Evolve", variant: "EX-Evolve" }, tags: [] };
  }
  return { ...skill, kind };
}
/** Captured price identity must agree before any saved Fusion payment resumes. */
export function fusionLineProblem(line: { script?: Script; skill: Skill; keyword?: { name: string } }, marked = false): string | null {
  if (!marked && line.script?.price?.fusion === undefined && !isFusionSkill(line.skill)) return null;
  const gap = fusionIdentityProblem(line.script, true); if (gap) return gap;
  return line.skill.kind !== "keyword" || !isFusionSkill(line.skill) || line.keyword?.name !== "Union" ? FUSION_IDENTITY_REBUILD : null;
}

export function evolutionLineProblem(line: { script?: Script; skill: Skill; keyword?: { name: string } }, required = false): string | null {
  if (!required && line.script?.price?.evolution === undefined && !needsEvolutionContract(line.skill)) return null;
  const gap = evolutionIdentityProblem(line.script, true); if (gap) return gap;
  return line.skill.kind !== "keyword" || line.skill.keyword?.name !== "Evolve" || line.skill.keyword.variant !== "EX-Evolve" || line.keyword?.name !== "Evolve" ? EVOLUTION_REBUILD : null;
}

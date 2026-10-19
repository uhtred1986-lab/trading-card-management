/** Executable self-combo facts, stored beside WHEN rather than inferred from display text. */
export interface ComboQualification {
  version: 1;
  timing: "entry" | "battleEnd";
  subject: "self";
  origins: string[] | null;
  turn: "any" | "controller" | "opponent";
  viaSkillOf?: string;
}

/** No defaults: an obsolete save or partially migrated row cannot establish a combo occurrence. */
export function comboQualificationProblem(value: unknown): string | null {
  const bad = "missing or malformed typed combo qualification; regenerate rules and rebuild the match (#907)";
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad;
  const q = value as Record<string, unknown>;
  if (Object.keys(q).some((key) => !["version", "timing", "subject", "origins", "turn", "viaSkillOf"].includes(key))) return bad;
  if (q.version !== 1 || (typeof q.timing !== "string" || !["entry", "battleEnd"].includes(q.timing)) || q.subject !== "self"
    || (typeof q.turn !== "string" || !["any", "controller", "opponent"].includes(q.turn))) return bad;
  const areas = ["hand", "deck", "battle", "energy", "drop", "warp", "life", "zEnergy"];
  if (q.origins !== null && (!Array.isArray(q.origins) || !q.origins.length
    || q.origins.some((a) => typeof a !== "string" || !areas.includes(a)) || new Set(q.origins).size !== q.origins.length)) return bad;
  if (q.viaSkillOf !== undefined && (typeof q.viaSkillOf !== "string" || !q.viaSkillOf.trim() || q.timing !== "entry")) return bad;
  return null;
}

/** Human reading of the executable facts, shared by review and diagnostics. */
export function describeComboQualification(q: ComboQualification): string {
  return `This card's ${q.timing === "entry" ? "combo entry" : "combo in this battle, at its normal cleanup"}${q.origins ? ` from ${q.origins.join(" or ")}` : " from any area"}${q.turn === "any" ? "; either turn" : q.turn === "controller" ? "; during your turn" : "; during your opponent’s turn"}${q.viaSkillOf ? `; using ${q.viaSkillOf}’s skill` : ""}`;
}

/** Saved executable contexts need WHEN as well as qualification; never recover it from display text. */
export function comboScriptProblem(script: { combo?: unknown; trigger?: unknown } | undefined): string | null {
  const gap = comboQualificationProblem(script?.combo);
  if (gap) return gap;
  const q = script!.combo as ComboQualification;
  const wanted = q.timing === "entry" ? "comboUsed" : "comboed";
  return Array.isArray(script?.trigger) && script.trigger.includes(wanted) ? null
    : "typed combo timing has no corresponding stored WHEN trigger; rebuild the rule record (#907)";
}

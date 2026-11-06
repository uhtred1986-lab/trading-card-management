/** R460: printed wording is used only to refuse stale stored trigger contracts. */
export const EXTRA_SELF_REBUILD = "rebuild the stored Extra self-activation trigger";
export function selfExtraActivationWording(printed: string): boolean {
  return /when (?:you activate this card(?!['’]s)|this card is activated)(?=\s*[,.:]|\s*$)/i.test(printed);
}
export function isExtraCardActivation(extra: boolean, from: string, kind: string, keyword?: string): boolean {
  return extra && from === "hand" && (kind.startsWith("activate:") || kind.startsWith("counter:") || keyword === "Field");
}
export function extraActivationContractGap(row: { kind: string; printed: string; trigger?: unknown }): string | null {
  if (row.kind !== "auto") return null;
  const triggers = Array.isArray(row.trigger) ? row.trigger : [];
  const text = row.printed.replace(/[’‘]/g, "'");
  if (selfExtraActivationWording(text) && (triggers.includes("played") || !triggers.includes("selfExtraActivated"))) return EXTRA_SELF_REBUILD;
  if (/when you activate[^,:]*\bextra(?: cards?)?[^,:]*from your hand(?=\s*[,.:]|\s*$)/i.test(text) && (triggers.includes("extraActivated") || !triggers.includes("extraActivatedFromHand"))) return "rebuild the stored hand-only Extra activation trigger";
  return null;
}

export function staleExtraSelfActivation(scripts: { bySkill: Record<number, { unsupported: string[] }> }): string | null {
  const gap = EXTRA_SELF_REBUILD;
  return Object.values(scripts.bySkill).some(script => script.unsupported.includes(gap)) ? gap : null;
}

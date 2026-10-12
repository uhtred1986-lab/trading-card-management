import type { Action, LegalAction, RejectedAction, Requirement } from "@/lib/arena/types";
import type { CardView } from "@/lib/arena/view";

export interface AbilitySheetMove {
  index: number;
  legal: LegalAction;
}

export type AbilityLine = NonNullable<CardView["abilities"]>[number];

const STRUCTURAL_REFUSAL_KINDS = new Set<Requirement["kind"]>(["cardType", "zone", "timing"]);

export function isStructuralRequirement(why: Requirement): boolean {
  return STRUCTURAL_REFUSAL_KINDS.has(why.kind);
}

/** A structural reason belongs in the collapsed Other actions list when per-line data exists. */
export function isStructuralRefusal(rejected: RejectedAction): boolean {
  return rejected.why.length > 0 && rejected.why.every(isStructuralRequirement);
}

export interface AbilityPanelRows {
  manual: AbilityLine[];
  passive: AbilityLine[];
  pending: AbilityLine[];
  other: AbilityLine[];
}

/** Partition only authoritative per-line snapshot rows; this helper does not decide legality. */
export function abilityPanelRows(abilities: AbilityLine[]): AbilityPanelRows {
  return {
    manual: abilities.filter((line) => (line.category === "manual" || line.category === "counter") && !isOtherAbility(line)),
    passive: abilities.filter((line) => line.category === "passive"),
    pending: abilities.filter((line) => line.category === "automatic" && line.pending),
    other: abilities.filter((line) => isOtherAbility(line) || (line.category === "automatic" && !line.pending) || line.category === "keyword"),
  };
}

function isOtherAbility(line: AbilityLine): boolean {
  if (line.category !== "manual" && line.category !== "counter") return false;
  return line.availability === "notEvaluated" || !!line.notEvaluatedReason ||
    (line.why ?? []).some((why) => why.kind === "timing" || why.kind === "zone");
}

function counterLinesForAction(abilities: AbilityLine[]): AbilityLine[] {
  return abilities.filter((line) => line.category === "counter" && line.availability === "offered" && line.notEvaluatedReason !== "unidentifiedAction");
}

/** Resolve only engine-offered actions for this exact card/skill identity. */
export function offeredMoves(line: AbilityLine, card: CardView, abilities: AbilityLine[], moves: AbilitySheetMove[]): AbilitySheetMove[] {
  if (line.availability !== "offered" || (line.category !== "manual" && line.category !== "counter")) return [];
  return moves.filter(({ legal }) => {
    const action = legal.action;
    if (action.type === "activate") return line.category === "manual" && action.player === line.controller && action.card === card.id && action.skill === line.skillIndex;
    if (action.type !== "counter" || line.category !== "counter" || action.card !== card.id) return false;
    return action.player === line.controller && (action.skill === line.skillIndex || (action.skill == null && counterLinesForAction(abilities).length === 1 && counterLinesForAction(abilities)[0]?.skillIndex === line.skillIndex));
  });
}

export function matchesAbilityAction(line: AbilityLine, action: Action, card: CardView, abilities: AbilityLine[]): boolean {
  if (action.type === "activate") return line.category === "manual" && action.player === line.controller && action.card === card.id && action.skill === line.skillIndex;
  if (action.type !== "counter" || line.category !== "counter" || action.card !== card.id) return false;
  return action.player === line.controller && (action.skill === line.skillIndex || (action.skill == null && counterLinesForAction(abilities).length === 1 && counterLinesForAction(abilities)[0]?.skillIndex === line.skillIndex));
}

export function abilityReasonType(line: AbilityLine): Action["type"] {
  return line.category === "counter" ? "counter" : "activate";
}

export function abilityCost(line: AbilityLine, move: AbilitySheetMove): string {
  if (move.legal.cost) return move.legal.cost.describe;
  if (line.costPreview.state === "known") {
    const matching = line.costPreview.offers.filter((offer) => offer.label === move.legal.label);
    if (matching.length === 1) return matching[0]!.cost.describe;
    const descriptions = [...new Set(line.costPreview.offers.map((offer) => offer.cost.describe))];
    if (descriptions.length === 1) return descriptions[0];
    if (descriptions.length > 1) return "Choose payment";
  }
  // Missing cost evidence is not evidence that activation is free.
  return line.costPreview.state === "incomplete" ? "Cost details unavailable" : "No cost shown";
}

/** Keep the common one-button CTA compact while distinguishing real alternate/X offers. */
export function abilityActionLabel(line: AbilityLine, move: AbilitySheetMove, choices: AbilitySheetMove[]): string {
  const fallback = move.legal.action.type === "counter" ? "Counter" : "Activate";
  if (choices.length <= 1) return fallback;
  const label = move.legal.label.trim();
  if (label && choices.filter((choice) => choice.legal.label.trim() === label).length === 1) return label;
  const action = move.legal.action;
  const detail = action.type === "activate"
    ? [action.x != null ? `X = ${action.x}` : "", action.alt ? "alternate payment" : "", action.onto ? `onto ${action.onto}` : ""].filter(Boolean).join(", ")
    : "";
  const cost = abilityCost(line, move);
  const suffix = detail || (cost !== "No cost shown" && cost !== "Cost details unavailable" ? cost : "choice");
  return `${fallback} · ${suffix}`;
}

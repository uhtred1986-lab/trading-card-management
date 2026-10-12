import type { Action, LegalAction, PlayerId } from "./types";

export interface PlanMove { action: Action; label: string }
export interface PlanBudget {
  source: "payment" | "printed";
  ready: number;
  total: number;
  markers: number;
  colors: { color: string; ready: number; total: number }[];
  energy: { id: string; name: string; imageUrl: string | null; ready: boolean; paymentColors: string[] }[];
}
export interface PlanStep { label: string; budget: PlanBudget }
export interface GameplanPreview {
  steps: PlanStep[];
  next: PlanMove[];
  stopped: string | null;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a as object).sort();
  const right = Object.keys(b as object).sort();
  return left.length === right.length && left.every((key, index) => key === right[index] && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

export const PLAN_TYPES = new Set<Action["type"]>(["play", "playUnison", "playZ", "activate", "growUnison"]);
export function planMoves(legal: LegalAction[], player: PlayerId): PlanMove[] {
  return legal.filter((l) => l.action.player === player && PLAN_TYPES.has(l.action.type)).map(({ action, label }) => ({ action, label }));
}


/** Server Function inputs are runtime JSON, regardless of TypeScript's caller type. */
export function validPlanActions(value: unknown): value is Action[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every((item) =>
    item && typeof item === "object" && !Array.isArray(item) &&
    PLAN_TYPES.has((item as Action).type) && ["p1", "p2"].includes((item as Action).player) &&
    "card" in item && typeof item.card === "string" && item.card.length <= 120 &&
    Object.keys(item).length <= 12 && JSON.stringify(item).length <= 2048);
}

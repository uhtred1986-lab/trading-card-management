/** Occurrence receipts for a strict activation-tax program's selected payers. */
import type { Op, ScriptFrame } from "./script";
import type { VmState } from "./state";

export type TaxPayers = Record<string, { card: string; epoch: number; paid: boolean }>;

/** Each alias is a single selection. Reusing an alias would need a serialized
 * selection generation to distinguish its old paid receipt from a new choice. */
export function taxPayerProgramProblem(ops: readonly Op[]): string | null {
  const aliases = new Set<string>();
  const walk = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(walk);
    if (!value || typeof value !== "object") return false;
    const object = value as Record<string, unknown>;
    if (typeof object.op === "string" && typeof object.as === "string") {
      if (aliases.has(object.as)) return true;
      aliases.add(object.as);
    }
    return Object.values(object).some(walk);
  };
  return walk(ops) ? "bind successive tax selections that reuse an alias" : null;
}

export function captureTaxPayers(state: VmState, vars: ScriptFrame["vars"], payers: TaxPayers): void {
  for (const [name, ids] of Object.entries(vars)) {
    if (name.endsWith("@epoch")) continue;
    for (const card of ids) if (state.cards[card]) {
      payers[`${name}:${card}`] ??= {card,epoch:state.cards[card].zoneEpoch ?? 0,paid:false};
    }
  }
}

export function taxPayerProblem(
  state: VmState, vars: ScriptFrame["vars"], payers: TaxPayers, requireCaptured = true,
): "malformed" | "missing" | "stale" | null {
  if (!payers || typeof payers !== "object" || Array.isArray(payers)) return "malformed";
  let stale = false;
  for (const payer of Object.values(payers)) {
    if (!payer || typeof payer.card !== "string" || !Number.isSafeInteger(payer.epoch) ||
      payer.epoch < 0 || typeof payer.paid !== "boolean") return "malformed";
    if (!payer.paid && (!state.cards[payer.card] || (state.cards[payer.card].zoneEpoch ?? 0) !== payer.epoch)) stale = true;
  }
  if (requireCaptured) for (const [name, ids] of Object.entries(vars)) {
    if (name.endsWith("@epoch")) continue;
    for (const card of ids) if (state.cards[card] && !payers[`${name}:${card}`]) return "missing";
  }
  return stale ? "stale" : null;
}

export function markTaxPayerPaid(payers: TaxPayers, card: string, originalEpoch: number): void {
  for (const payer of Object.values(payers)) {
    if (payer.card === card && payer.epoch === originalEpoch) payer.paid = true;
  }
}

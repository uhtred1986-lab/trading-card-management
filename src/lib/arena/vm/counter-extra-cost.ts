/** RM12-2-2: card energy/alternative, source Drop, then skill costs. */
import type { Op, Script } from "./script";
import type { VmPayment } from "./costs";

export interface ExtraCounterSource {
  card: string;
  cardId: string;
  epoch: number;
  area: string;
}
export interface ExtraCounterBinding {
  version: 1;
  source: ExtraCounterSource;
  /** The selected payer is still unpaid while card energy is being paid. */
  markerPayers: { card: string; epoch: number }[];
  declaredScript: Script;
  skillIndex: number;
  skillKind: string;
  selectedX: number | null;
}
export interface ExtraCounterCost extends ExtraCounterBinding {
  phase: "cardAlternative" | "skillResources" | "skillAction";
  actionOps: Op[];
  /** Saved options belong only to the skill-resource phase. */
  choices?: { payment: VmPayment; epochs: Record<string, number>; label: string }[];
}

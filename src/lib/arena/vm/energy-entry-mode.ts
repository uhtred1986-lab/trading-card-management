/** R476: observe entry validity before moving the card or clearing effects.
 * Optional entry effects must finish before this observation. This helper does
 * not move a card, grant negation, or admit an optional entry procedure.
 */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { hasKeyword } from "./program";

export interface EnergyEntryMode {
  exhausted: boolean;
  mode: "active" | "rest";
}

export function captureEnergyEntryMode(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, explicit?: "active" | "rest"): EnergyEntryMode {
  const exhausted = hasKeyword(ctx, game, state, card, "Energy-Exhaust");
  // RM0-2-6 / Energy-Exhaust general FAQ: Rest prevails over explicit Active.
  return { exhausted, mode: exhausted || explicit === "rest" ? "rest" : "active" };
}

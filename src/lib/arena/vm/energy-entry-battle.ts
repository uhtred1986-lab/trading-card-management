/** R489/R491 ordinary owned Battle source, rechecked before every saved child step. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import type { ScriptFrame } from "./script";
import { findCard, isTokenCard } from "./zones";
import { possibleEnergyEntrySource } from "./energy-entry-source";
import { COPIED_SKILL_BASE } from "./common";
import { NotYet } from "./errors";

export interface EnergyBattleScope {
  version: 1;
  activation: { version: 2; kind: "activate" | "auto"; scope?: number };
  hiddenCount: number;
}
export function captureEnergyBattleScope(ctx: EngineContext, state: VmState, frame: ScriptFrame, id: string): EnergyBattleScope {
  const source=state.cards[id],at=findCard(state,id),origin=frame.skillEffectOrigin;
  if (!source || ctx.defs[source.cardId]?.type!=="BATTLE" || source.zCard || isTokenCard(source.cardId) || source.hidden || source.under.length ||
    at?.zone!=="battle" || at.owner!==source.owner ||
    state.effects.some(effect=>effect.target===id&&(effect.kind==="control"||effect.kind==="copiedSkills")) ||
    origin?.version!==2 || origin.kind!=="activate"&&origin.kind!=="auto" ||
    frame.skillIndex===undefined || frame.skillIndex>=COPIED_SKILL_BASE || frame.copiedSkillCapture ||
    frame.replacing || frame.replacementAuto || frame.replacementFallback ||
    !Number.isSafeInteger(source.hiddenCount??0) || (source.hiddenCount??0)<0) {
    throw new NotYet("plain owned Battle Energy entry needs its original native skill and source", "R489");
  }
  return {version:1,activation:{version:2,kind:origin.kind,...(origin.scope!==undefined?{scope:origin.scope}:{})},hiddenCount:source.hiddenCount??0};
}

/** A negated optional Permanent does not negate an independent copied Auto.
 * Refuse the unproved family source before cleanup even without a child. */
export function guardBattleEnergyScriptHistory(ctx: EngineContext, state: VmState, id: string): void {
  if (findCard(state,id)?.zone === "battle" && possibleEnergyEntrySource(ctx,state,id)
    && state.effects.some(effect=>effect.target===id&&effect.kind==="copiedSkills")) {
    throw new NotYet("Battle Energy source with uncaptured copied movement-skill history", "R489");
  }
}

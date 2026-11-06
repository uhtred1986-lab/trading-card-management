/** R513 stable mixed observer boundary; R524 shares facts without ledger conversion. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { standingComboWholePrinted, standingComboWholeDescriptor } from "./standing-negation-policy";
import { priorStandingView, standingPriorFacts } from "./standing-negation-prior-view";
import { validateMixedStandingNegationHistory } from "./standing-negation-mixed-history";
import { collectNativeStandingFacts } from "./standing-negation-native-facts";
import type { MixedStandingNegationCard as Card, MixedStandingNegationObservation as Observation, MixedStandingNegationHistory as History } from "./standing-negation-mixed-history";
export { mixedStandingOccurrences } from "./standing-negation-native-facts";
/** Used only by explicit new-game initialization; does not compile source text. */
export function hasMixedStandingPolicy(ctx: EngineContext): boolean {
    return Object.values(ctx.defs).some(def => (["front", "back"] as const).some(side => {
        if (side === "back" && !def.back)
            return false;
        const scripts = programsOf(ctx, def, side);
        return parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null).some(skill => skill.kind === "permanent" && (standingComboWholePrinted(skill)
            || standingComboWholeDescriptor(scripts.bySkill[skill.index]?.ops)));
    }));
}
/** History validation precedes physical reads as before. Native transactions
 * still own complete arrival validation and explicit participant transitions. */
export function observeMixedStandingNegation(ctx: EngineContext, game: GameDefinition, state: VmState, history: History,
    arrivals: readonly Card[] = [], participants?: Observation["battle"]): Observation {
    if (history?.version !== 2) validateMixedStandingNegationHistory(history);
    const prior = priorStandingView(history);
    const facts = collectNativeStandingFacts(ctx, game, state, prior, arrivals,
        participants === undefined ? standingPriorFacts(prior).area.battle : participants);
    return { version: 2, policy: "mixedWholeV1", ...facts };
}

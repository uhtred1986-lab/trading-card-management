/** R524 transient views of validated real ledgers. No schema conversion or migration. */
import { validateMixedStandingNegationHistory, mixedStandingObservationFromHistory, type MixedStandingNegationHistory, type MixedStandingNegationObservation } from "./standing-negation-mixed-history";
import { validateUnderStandingHistory, type UnderHistory } from "./standing-negation-under-history";
import { NotYet } from "./errors";
declare const brand: unique symbol;
export interface StandingPriorView { readonly [brand]: true }
interface Facts {
    version: 2 | 3;
    nextSerial: number;
    area: MixedStandingNegationObservation;
    active: UnderHistory["active"];
    edges: UnderHistory["negated"];
    hasUnderInteraction: boolean;
}
const views = new WeakMap<StandingPriorView, Facts>();
function refuse(): never { throw new NotYet("derive standing facts from a validated original ledger", "R524"); }
export function priorStandingView(history: MixedStandingNegationHistory | UnderHistory): StandingPriorView {
    if (!history || typeof history !== "object") return refuse();
    let facts: Facts;
    if (history.version === 2) {
        validateMixedStandingNegationHistory(history);
        facts = { version: 2, nextSerial: history.nextSerial, area: mixedStandingObservationFromHistory(history),
            active: history.active, edges: history.suppressed, hasUnderInteraction: false };
    } else if (history.version === 3) {
        validateUnderStandingHistory(history);
        facts = { version: 3, nextSerial: history.nextSerial, area: history.observation.area,
            active: history.active, edges: history.negated,
            hasUnderInteraction: !!history.observation.under.length || history.active.some(entry => "kind" in entry.source) };
    } else return refuse();
    const view = Object.freeze({}) as StandingPriorView;
    views.set(view, structuredClone(facts));
    return view;
}
/** Defensive data only; callers cannot overwrite the opaque view's source or edges. */
export function standingPriorFacts(view: StandingPriorView): Facts {
    const facts = view && views.get(view);
    if (!facts) return refuse();
    return structuredClone(facts);
}

/** R448: card-energy coupons are scoped to the activation being paid for. */
import type { Skill } from "../types";
export const ENERGY_ACTIVATIONS = ["activate", "main", "battle", "main/battle"] as const;
export type EnergyActivation = typeof ENERGY_ACTIVATIONS[number];
export type EnergyPaymentContext = Pick<Skill, "kind" | "keyword">;
/** P-524 Q1/Q2: exact Main excludes Main/Battle but includes Field. */
export function energyActivationReaches(scope: EnergyActivation | undefined, payment?: EnergyPaymentContext): boolean {
    if (scope === undefined)
        return true;
    if (!payment)
        return false;
    if (payment.keyword?.name === "Field")
        return scope === "activate" || scope === "main";
    return scope === "activate" ? payment.kind.startsWith("activate:") : payment.kind === `activate:${scope}`;
}
/** Printed text is consulted only to identify obsolete records/saves, never compiled at runtime. */
export function printsScopedEnergyCoupon(text: string): boolean {
    return /next time[^.]*\b(?:activate|use)\b[^.]*\[activate(?::[^\]]+)?\][^.]*reduce (?:the|its) energy cost/i.test(text);
}

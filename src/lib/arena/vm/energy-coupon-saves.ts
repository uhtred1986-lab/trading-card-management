/** R448 rebuild boundaries for old records, active frames and already-created discounts. */
import type { EngineContext } from "../types";
import { parseSkills } from "../text/cards";
import type { Op, ScriptFrame } from "./script";
import type { VmState } from "./state";
import { ENERGY_ACTIVATIONS, printsScopedEnergyCoupon } from "./energy-coupons";
import { rebuildScope } from "./skill-play-scope";
const printedCouponLines = new Map<string, readonly number[]>();
function couponLines(text: string): readonly number[] {
    const hit = printedCouponLines.get(text);
    if (hit)
        return hit;
    const indices = parseSkills(text).filter(skill => printsScopedEnergyCoupon(skill.raw)).map(skill => skill.index);
    if (printedCouponLines.size >= 512)
        printedCouponLines.delete(printedCouponLines.keys().next().value!);
    printedCouponLines.set(text, indices);
    return indices;
}
function sourceHasCoupon(ctx: EngineContext, state: VmState, source: string | undefined, index?: number): boolean {
    const def = source && ctx.defs[state.cards[source]?.cardId];
    if (!def)
        return false;
    return [def.skill, def.back?.skill].some(text => text && couponLines(text).some(i => index === undefined || i === index));
}
type CouponOp = Extract<Op, {
    op: "costReduction" | "costModifier";
}>;
export interface EnergyCouponContract {
    version: 1;
    costs: CouponOp[];
}
function couponOps(ops: readonly Op[]): CouponOp[] {
    return ops.flatMap(op => op.op === "costReduction" || op.op === "costModifier" ? [op] : op.op === "if" ? [...couponOps(op.then), ...couponOps(op.else ?? [])] : op.op === "may" ? couponOps(op.ops) : op.op === "chooseMode" ? op.modes.flatMap(mode => couponOps(mode.ops)) : []);
}
export function energyCouponContract(ops: readonly Op[]): EnergyCouponContract | undefined {
    const costs = couponOps(ops).filter(op => (!op.what || op.what === "energy") && !("pay" in op && op.pay !== undefined));
    return costs.length ? { version: 1, costs: structuredClone(costs) } : undefined;
}
function canonical(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "undefined";
}
function couponShape(op: CouponOp): string {
    const normalized: Record<string, unknown> = { target: op.target ?? { sel: { special: "self" } }, amount: op.amount, what: op.what ?? "energy" };
    for (const key of ["colors", "skillKind", "activateTiming", "energyActivation", "tag", "until", "onto", "uses", "all"]) {
        const value = (op as unknown as Record<string, unknown>)[key];
        if (value !== undefined)
            normalized[key] = value;
    }
    return canonical(normalized);
}
export function unscopedEnergyCoupon(ops: unknown): boolean {
    return Array.isArray(ops) && ops.some(raw => {
        if (!raw || typeof raw !== "object")
            return false;
        const op = raw as Op;
        return ((op.op === "costReduction" || (op.op === "costModifier" && op.pay === undefined)) && (!op.what || op.what === "energy") && !op.energyActivation)
            || (op.op === "if" && (unscopedEnergyCoupon(op.then) || unscopedEnergyCoupon(op.else)))
            || (op.op === "may" && unscopedEnergyCoupon(op.ops))
            || (op.op === "chooseMode" && Array.isArray(op.modes) && op.modes.some(mode => unscopedEnergyCoupon(mode.ops)));
    });
}
export function requireEnergyCouponFrame(ctx: EngineContext, state: VmState, frame: ScriptFrame): void {
    const paying = frame.saveVarsAs ? state.programs.find(next => next.pricedBy?.key === frame.saveVarsAs) : frame;
    if (paying && (paying.pricedBy || paying.dropCost)) {
        const captured = paying.activationEnergyPayment;
        if (captured) {
            if (captured.version !== 1 || !Array.isArray(captured.ids) || captured.ids.some(id => !Number.isSafeInteger(id) || id < 0) || new Set(captured.ids).size !== captured.ids.length)
                rebuildScope("rebuild this saved activation-energy coupon payment");
            if (state.effects.some(effect => captured.ids.includes(effect.id) && (effect.kind !== "cost" || !effect.energyActivation || effect.master !== paying.master)))
                rebuildScope("rebuild this saved activation-energy coupon identity");
        }
        else {
            const def = ctx.defs[state.cards[paying.card]?.cardId];
            const kind = paying.dropCost?.line.kind ?? ctx.scripts?.[def?.id ?? ""]?.bySkill[paying.skillIndex ?? -1]?.kind;
            if (def?.type.replace(/^Z-/, "") === "EXTRA" && kind?.startsWith("activate:") && state.effects.some(effect => effect.energyActivation && effect.master === paying.master && (effect.uses ?? 1) > 0))
                rebuildScope("rebuild this saved Extra payment's captured energy coupons");
        }
    }
    const contract = frame.energyCouponContract;
    if (contract) {
        if (contract.version !== 1 || !Array.isArray(contract.costs) || contract.costs.some(op => !op || (op.op !== "costReduction" && op.op !== "costModifier") || (op.energyActivation !== undefined && !ENERGY_ACTIVATIONS.includes(op.energyActivation))))
            rebuildScope("rebuild this saved energy coupon contract");
        const expected = new Map<string, number>();
        for (const op of contract.costs) {
            const shape = couponShape(op);
            expected.set(shape, (expected.get(shape) ?? 0) + 1);
        }
        for (const op of couponOps(frame.ops).filter(op => (!op.what || op.what === "energy") && !("pay" in op && op.pay !== undefined))) {
            const shape = couponShape(op), remaining = expected.get(shape) ?? 0;
            if (!remaining)
                rebuildScope("rebuild this saved activation-energy coupon frame");
            expected.set(shape, remaining - 1);
        }
        return;
    }
    if (unscopedEnergyCoupon(frame.ops) && sourceHasCoupon(ctx, state, frame.card, frame.skillIndex))
        rebuildScope("rebuild this saved activation-energy coupon frame");
}
export function requireEnergyCouponEffects(ctx: EngineContext, state: VmState): void {
    for (const effect of state.effects) {
        if (effect.kind !== "cost" || (effect.uses ?? 1) <= 0)
            continue;
        if (effect.energyActivation !== undefined && !ENERGY_ACTIVATIONS.includes(effect.energyActivation))
            rebuildScope("rebuild this saved activation-energy coupon scope");
        if (effect.costOrigin && (effect.costOrigin.version !== 1 || (effect.costOrigin.skillIndex !== null && (!Number.isSafeInteger(effect.costOrigin.skillIndex) || effect.costOrigin.skillIndex < 0))))
            rebuildScope("rebuild this saved cost effect origin");
        if (effect.costOrigin) {
            if (effect.costOrigin.energyActivation !== (effect.energyActivation ?? null))
                rebuildScope("rebuild this saved energy coupon scope provenance");
            continue;
        }
        if (effect.energyActivation)
            continue;
        if (sourceHasCoupon(ctx, state, effect.source))
            rebuildScope("rebuild this saved card-energy coupon before using its unscoped discount");
    }
}

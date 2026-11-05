/** R449: successful marker payments retain facts, not a live Unison lookup. */
import type { Attrs } from "./cards";
import type { ScriptFrame } from "./script";
import { NotYet } from "./errors";
export interface PaidMarkerReceipt {
    version: 1;
    cost: string;
    source: string;
    sourceEpoch: number;
    /** Attached when the successful payment is assigned to its exact skill. */
    skillIndex?: number;
    declaration?: {
        fixed: number | null;
        x: number | null;
    };
    requested: number;
    amount: number;
    status: "paid" | "notApplied" | "waived";
    payers: {
        card: string;
        epoch: number;
        amount: number;
        info: Attrs;
    }[];
}
export type PaidMarkers = Record<string, PaidMarkerReceipt>;
const attributes = (value: unknown): boolean => !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(v => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (Array.isArray(v) && v.every(x => typeof x === "string")));
const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
function rebuild(): never {
    throw new NotYet("read missing or malformed historical marker payment; rebuild the saved match", "R-449");
}
/** No current characteristics or selected X can repair absent historical facts. */
export function requirePaidMarkers(frame: Pick<ScriptFrame, "card" | "skillIndex" | "paidMarkers">, cost: string): PaidMarkerReceipt {
    const receipt = frame.paidMarkers?.[cost];
    if (!receipt || receipt.version !== 1 || receipt.cost !== cost || receipt.source !== frame.card || !whole(receipt.sourceEpoch) || !whole(receipt.skillIndex) || receipt.skillIndex !== frame.skillIndex || !whole(receipt.requested) || !whole(receipt.amount) || !["paid", "notApplied", "waived"].includes(receipt.status) || !Array.isArray(receipt.payers))
        rebuild();
    const declaration = receipt.declaration;
    if (!declaration || (declaration.fixed !== null && !whole(declaration.fixed)) || (declaration.x !== null && !whole(declaration.x)))
        rebuild();
    if (receipt.status === "paid" && receipt.requested !== (declaration.x ?? declaration.fixed ?? 0))
        rebuild();
    if (receipt.payers.some(payer => !payer || typeof payer.card !== "string" || !whole(payer.epoch) || !whole(payer.amount) || payer.amount === 0 || !attributes(payer.info) || !Array.isArray(payer.info.colors)) || receipt.payers.reduce((n, payer) => n + payer.amount, 0) !== receipt.amount)
        rebuild();
    if (receipt.status === "paid" ? receipt.amount !== receipt.requested : receipt.amount !== 0 || receipt.payers.length !== 0)
        rebuild();
    return receipt;
}
/** Bind the receipt only to the skill whose declared price was actually paid. */
export function bindPaidMarkers(paid: PaidMarkers | undefined, card: string, skillIndex: number, declaration: {
    fixed: number | null;
    x: number | null;
}): PaidMarkers | undefined {
    if (!paid)
        return undefined;
    const bound = structuredClone(paid);
    for (const receipt of Object.values(bound)) {
        if (receipt.source !== card || (receipt.skillIndex !== undefined && receipt.skillIndex !== skillIndex))
            rebuild();
        receipt.skillIndex = skillIndex;
        if (receipt.cost !== "spiritBoost")
            rebuild();
        if (receipt.declaration && (receipt.declaration.fixed !== declaration.fixed || receipt.declaration.x !== declaration.x))
            rebuild();
        receipt.declaration = structuredClone(declaration);
        if (receipt.status === "paid" && receipt.amount === 0 && (declaration.x ?? declaration.fixed ?? 0) > 0)
            receipt.status = "notApplied";
        requirePaidMarkers({ card, skillIndex, paidMarkers: { [receipt.cost]: receipt } }, receipt.cost);
    }
    return bound;
}
/** Typed historical reads expected from the source program, carried by branch frames. */
type MarkerPrice = {
    payment: {
        spiritBoost?: number | null;
    };
    x?: {
        spiritBoost?: boolean;
    };
};
export interface MarkerHistoryContract {
    version: 1;
    reads: string[];
    declaration: {
        fixed: number | null;
        x: boolean;
    };
}
function canonical(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
    return JSON.stringify(value) ?? "undefined";
}
function reads(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== "object")
        return [];
    if (Array.isArray(value))
        return value.flatMap(reads);
    const fields = value as Record<string, unknown>;
    if (fields.kind === "paidMarkers" || typeof fields.paidMarkers === "string")
        return [fields];
    return Object.values(fields).flatMap(reads);
}
export function markerHistoryContract(ops: unknown, price?: MarkerPrice): MarkerHistoryContract | undefined {
    const found = reads(ops).map(canonical).sort();
    return found.length ? { version: 1, reads: found, declaration: { fixed: price?.payment.spiritBoost ?? null, x: !!price?.x?.spiritBoost } } : undefined;
}
export function markerHistoryContractGap(row: {
    printed: string;
    ops: unknown;
}): string | null {
    if (!/\[spirit boost (?:\d+|x)\]/i.test(row.printed))
        return null;
    const found = reads(row.ops);
    const conditions = [...row.printed.matchAll(/if you removed (?:a|1) markers? from/gi)].length;
    const thresholds = [...row.printed.matchAll(/if you removed \d+ or more markers/gi)].length;
    const amounts = [...row.printed.matchAll(/for each marker you remove/gi)].length;
    if (found.filter(r => r.kind === "paidMarkers" && r.filter).length < conditions || found.filter(r => r.kind === "paidMarkers" && !r.filter).length < thresholds || found.filter(r => typeof r.paidMarkers === "string").length < amounts)
        return "rebuild historical Spirit Boost payment instead of reading the current Unison or chosen X";
    return null;
}
export function requireMarkerHistoryFrame(frame: ScriptFrame, script: {
    ops: unknown;
    price?: MarkerPrice;
} | undefined): void {
    const expected = markerHistoryContract(script?.ops, script?.price);
    const own = markerHistoryContract(frame.ops);
    const contract = frame.markerHistoryContract;
    if (!expected && !own && !contract)
        return;
    if (!contract || contract.version !== 1 || !Array.isArray(contract.reads) || contract.reads.some(r => typeof r !== "string"))
        rebuild();
    if (!contract.declaration || (contract.declaration.fixed !== null && !whole(contract.declaration.fixed)) || typeof contract.declaration.x !== "boolean")
        rebuild();
    const receipt = frame.paidMarkers?.spiritBoost;
    if (receipt?.declaration && (receipt.declaration.fixed !== contract.declaration.fixed || (receipt.declaration.x !== null) !== contract.declaration.x))
        rebuild();
    if (expected && canonical(expected) !== canonical(contract))
        rebuild();
    const pendingEffect = frame.autoCost?.effect ?? frame.counterCost?.effect;
    if (pendingEffect && canonical(markerHistoryContract(pendingEffect)?.reads) !== canonical(contract.reads))
        rebuild();
    if (own && own.reads.some(read => !contract.reads.includes(read)))
        rebuild();
}

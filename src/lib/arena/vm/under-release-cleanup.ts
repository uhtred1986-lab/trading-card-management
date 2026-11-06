/** Private synchronous release receipt for the opts.under producer, not source lifetime cleanup. */
import type { GameEvent } from "../types";
import type { VmState } from "./state";
import { findCard, hostOf, type MoveRecord } from "./zones";
import { captureAppliedEffectMove, settleAppliedEffectMove, type NativeEffectMove } from "./applied-effect-receipt";
import { cleanupPlacement } from "./script-placement-cleanup";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";

declare const brand: unique symbol;
export interface UnderReleaseCapture { readonly [brand]: true }
interface Material { card: string; cardId: string; owner: string; epoch: number; hiddenCount: number; z: boolean; effect: NativeEffectMove }
interface Capture {
    state: VmState; source: string; destination: string; before: string;
    from: NonNullable<ReturnType<typeof findCard>>; to: NonNullable<ReturnType<typeof findCard>>;
    sourceIdentity: string; destinationIdentity: string; destinationPile: string[]; materials: Material[];
}
const captures = new WeakMap<UnderReleaseCapture, Capture>();
const fail = (message: string): never => { throw new NotYet(message, "under-release-cleanup"); };
const natural = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
function identity(state: VmState, id: string): string {
    const c = state.cards[id];
    if (!c || !c.cardId || !["p1", "p2"].includes(c.owner) || !natural(c.zoneEpoch ?? 0)) return fail("capture original under-placement identity");
    return canonical({ cardId: c.cardId, owner: c.owner, epoch: c.zoneEpoch ?? 0 });
}
function snapshot(state: VmState, source: string, destination: string, materials: readonly string[]): string {
    return canonical({ source: state.cards[source], destination: state.cards[destination], from: findCard(state, source), to: findCard(state, destination),
        materials: materials.map(id => ({ card: state.cards[id], at: findCard(state, id), hosts: Object.values(state.cards).filter(c => c.under.includes(id)).map(c => c.id) })),
        effects: state.effects.filter(e => materials.includes(e.target) || materials.includes(e.source ?? "")),
        ownership: Object.entries(state.appliedEffectOwnership ?? {}).filter(([id]) => state.effects.some(e => e.id === Number(id) && materials.includes(e.target))) });
}
export function captureUnderRelease(state: VmState, source: string, destination: string): UnderReleaseCapture | undefined {
    const card = state.cards[source];
    if (!card || !Array.isArray(card.under)) return fail("capture original under-placement pile");
    if (!card.under.length) return undefined;
    const from = findCard(state, source), to = findCard(state, destination), host = state.cards[destination];
    if (!from || !to || source === destination || !host || !Array.isArray(host.under)) return fail("capture physical source and destination for under release");
    if (from.zone !== to.zone && !["battle", "combo", "unison"].includes(from.zone))
        return fail("prove nonempty source pile release outside Battle Combo or Unison");
    const ids = new Set<string>(), materials: Material[] = [];
    for (const id of card.under) {
        const c = state.cards[id];
        if (!c || ids.has(id) || id === source || id === destination || findCard(state, id) || hostOf(state, id) !== source
            || Object.values(state.cards).filter(x => x.under.includes(id)).length !== 1
            || !Array.isArray(c.under) || c.under.length || !natural(c.hiddenCount ?? 0)) return fail("capture unique flat under-release materials");
        identity(state, id); ids.add(id);
        materials.push({ card: id, cardId: c.cardId, owner: c.owner, epoch: c.zoneEpoch ?? 0, hiddenCount: c.hiddenCount ?? 0, z: c.zCard === true, effect: captureAppliedEffectMove(state, id) });
    }
    if (((from.zone === "battle" && to.zone === "combo") || (from.zone === "combo" && to.zone === "battle")) && materials.some(m => m.z))
        return fail("resolve Z-material Battle/Combo release destination before under placement");
    const token = Object.freeze({}) as UnderReleaseCapture;
    captures.set(token, { state, source, destination, from: { ...from }, to: { ...to }, materials,
        before: snapshot(state, source, destination, [...ids]), sourceIdentity: identity(state, source), destinationIdentity: identity(state, destination), destinationPile: [...host.under] });
    return token;
}
function capture(state: VmState, token: UnderReleaseCapture): Capture {
    const c = token && captures.get(token);
    if (!c || c.state !== state) return fail("rebuild under-release capture on its exact board");
    return c;
}
export function requireUnderReleaseCapture(state: VmState, token: UnderReleaseCapture | undefined): void {
    if (!token) return;
    const c = capture(state, token);
    if (c.before !== snapshot(state, c.source, c.destination, c.materials.map(m => m.card))) fail("under-release capture changed before placement");
}
export function cleanupUnderRelease(state: VmState, events: GameEvent[], token: UnderReleaseCapture | undefined, move: MoveRecord): MoveRecord[] {
    if (!token) {
        if (move.released?.length) return fail("actual under releases require original capture");
        return [];
    }
    const c = capture(state, token), source = state.cards[c.source], host = state.cards[c.destination], at = findCard(state, c.destination);
    if (!source || !host) return fail("rebuild actual under-placement source and host");
    const original = JSON.parse(c.sourceIdentity) as { cardId: string; owner: string; epoch: number };
    const leaderException = c.from.zone === "leader" && c.to.zone === "leader" && host.zCard === true;
    const releases = c.from.zone !== c.to.zone;
    if (move.card !== c.source || move.from !== c.from.zone || move.fromOwner !== c.from.owner || move.to !== "under" || move.under !== c.destination
        || move.owner !== host.owner || findCard(state, c.source) || hostOf(state, c.source) !== c.destination
        || !at || at.zone !== c.to.zone || at.owner !== c.to.owner || identity(state, c.destination) !== c.destinationIdentity
        || source.cardId !== original.cardId || source.owner !== original.owner || (source.zoneEpoch ?? 0) !== original.epoch + (leaderException ? 0 : 1)
        || source.under.length || canonical(host.under) !== canonical([...c.destinationPile, c.source, ...(releases ? [] : c.materials.map(m => m.card))]))
        return fail("bind actual under placement and flattened pile to original capture");
    const records = move.released ?? [];
    if (!Array.isArray(records) || records.length !== (releases ? c.materials.length : 0)) return fail("under placement omitted or invented material releases");
    for (const [i, m] of c.materials.entries()) {
        const child = state.cards[m.card], where = findCard(state, m.card), record = records[i];
        if (!child || child.cardId !== m.cardId || child.owner !== m.owner || (child.hiddenCount ?? 0) !== m.hiddenCount || child.under.length
            || (child.zoneEpoch ?? 0) !== m.epoch + (releases ? 1 : 0)) return fail("validate original under material occurrence");
        if (releases ? !record || record.card !== m.card || record.from !== c.from.zone || record.fromOwner !== c.from.owner
            || record.owner !== m.owner || record.to !== (m.z ? "removed" : "drop") || record.under !== null || record.released?.length
            || !where || where.zone !== record.to || where.owner !== m.owner || hostOf(state, m.card)
            : where || hostOf(state, m.card) !== c.destination) return fail("validate actual released or retained under material");
    }
    for (const record of records) {
        const originalMaterial = c.materials.find(m => m.card === record.card)!;
        cleanupPlacement(state, events, record, c.from.zone, { changedArea: true, retained: [] });
        settleAppliedEffectMove(state, originalMaterial.effect);
    }
    captures.delete(token);
    return structuredClone(records);
}

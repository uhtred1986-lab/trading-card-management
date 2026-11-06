/** RM23-2-5 regular-mover release cleanup. The script host uses this boundary; other regular movers require their own hookup.
 * Every live caller must preflight its complete move+cleanup on its own clone.
 * The helper emits effect-ended bookkeeping only, never movement events/Autos.
 */
import type { GameEvent } from "../types";
import type { VmState } from "./state";
import type { MoveRecord } from "./zones";
import { findCard, hostOf } from "./zones";
import { captureAppliedEffectMove, settleAppliedEffectMove, type NativeEffectMove } from "./applied-effect-receipt";
import { cleanupPlacement } from "./script-placement-cleanup";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";

declare const brand: unique symbol;
export interface PileReleaseCapture { readonly [brand]: true }
interface Material {
    card: string;
    cardId: string;
    owner: string;
    epoch: number;
    hiddenCount: number;
    zCard: boolean;
    effectMove: NativeEffectMove;
}
interface Capture {
    state: VmState;
    top: string;
    topIdentity: string;
    from: NonNullable<ReturnType<typeof findCard>>;
    carry: boolean;
    materials: Material[];
    before: string;
    restoredHost?: string;
}
const captures = new WeakMap<PileReleaseCapture, Capture>();
const fail = (message: string): never => { throw new NotYet(message, "pile-release-cleanup"); };
const natural = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
function topIdentity(state: VmState, id: string): string {
    const card = state.cards[id];
    if (!card || !natural(card.zoneEpoch ?? 0) || !["p1", "p2"].includes(card.owner)
        || typeof card.cardId !== "string" || !card.cardId) return fail("rebuild original pile host occurrence");
    return canonical({ card: id, cardId: card.cardId, owner: card.owner, epoch: card.zoneEpoch ?? 0 });
}
function physicalHosts(state: VmState, id: string): string[] {
    const result: string[] = [];
    for (const card of Object.values(state.cards)) {
        if (!card || !Array.isArray(card.under)) return fail("rebuild physical pile membership");
        if (card.under.includes(id)) result.push(card.id);
    }
    return result;
}
function snapshot(state: VmState, top: string, ids: readonly string[]): string {
    return canonical({ top: state.cards[top], at: findCard(state, top), materials: ids.map(id => ({
        card: state.cards[id], at: findCard(state, id), hosts: physicalHosts(state, id),
    })), effects: state.effects.filter(e => ids.includes(e.target) || ids.includes(e.source ?? "")),
    ownership: Object.entries(state.appliedEffectOwnership ?? {}).filter(([id]) => state.effects.some(e => e.id === Number(id) && ids.includes(e.target))) });
}
/** Call before the regular primitive; under-placement's recursive releases are excluded. */
export function capturePileRelease(state: VmState, top: string, options: { carry?: boolean } = {}): PileReleaseCapture | undefined {
    const at = findCard(state, top), card = state.cards[top];
    if (!card || !Array.isArray(card.under)) return fail("capture a physical regular-mover pile host");
    if (!card.under.length) return undefined;
    if (!at) return fail("capture a physical regular-mover pile host");
    const materials: Material[] = [], ids = new Set<string>();
    for (const id of card.under) {
        const child = state.cards[id];
        if (!child || typeof child.cardId !== "string" || !child.cardId || ids.has(id) || id === top || findCard(state, id) || !Array.isArray(child.under) || child.under.length
            || physicalHosts(state, id).length !== 1
            || hostOf(state, id) !== top || !natural(child.zoneEpoch ?? 0) || !natural(child.hiddenCount ?? 0)
            || !["p1", "p2"].includes(child.owner)) return fail("capture one flat unique material occurrence");
        ids.add(id);
        materials.push({ card: id, cardId: child.cardId, owner: child.owner, epoch: child.zoneEpoch ?? 0,
            hiddenCount: child.hiddenCount ?? 0, zCard: child.zCard === true, effectMove: captureAppliedEffectMove(state, id) });
    }
    const token = Object.freeze({}) as PileReleaseCapture;
    captures.set(token, { state, top, topIdentity: topIdentity(state, top), from: { ...at }, carry: options.carry === true,
        materials, before: snapshot(state, top, [...ids]),
        ...(at.zone === "leader" && card.zCard && card.leaderBase ? { restoredHost: card.leaderBase.card } : {}) });
    return token;
}
function capture(state: VmState, token: PileReleaseCapture): Capture {
    const value = token && captures.get(token);
    if (!value || value.state !== state) return fail("rebuild synchronous pile-release capture on this exact board");
    return value;
}
/** Useful at the native pre-mutation boundary; catches stale source/effect/pile facts. */
export function requirePileReleaseCapture(state: VmState, token: PileReleaseCapture | undefined): void {
    if (token === undefined) return;
    const value = capture(state, token);
    if (snapshot(state, value.top, value.materials.map(m => m.card)) !== value.before)
        fail("pile-release capture changed before primitive placement");
}
/** Validate ALL actual results before effect cleanup. Returns detached records for caller publication. */
export function cleanupReleasedPile(state: VmState, events: GameEvent[], token: PileReleaseCapture | undefined, move: MoveRecord): MoveRecord[] {
    if (token === undefined) {
        if (move?.released !== undefined && (!Array.isArray(move.released) || move.released.length))
            return fail("actual released materials need a pre-mutation capture");
        return [];
    }
    const value = capture(state, token), top = state.cards[value.top], topAt = findCard(state, value.top);
    if (!move || move.card !== value.top || move.from !== value.from.zone || move.fromOwner !== value.from.owner
        || move.under !== null || !topAt || topAt.zone !== move.to || topAt.owner !== move.owner)
        return fail("bind pile release to the actual regular top movement");
    const original = JSON.parse(value.topIdentity) as { card: string; cardId: string; owner: string; epoch: number };
    const changed = move.from !== move.to || move.fromOwner !== move.owner;
    if (!top || top.cardId !== original.cardId || top.owner !== original.owner
        || (top.zoneEpoch ?? 0) !== original.epoch + (changed && !value.carry ? 1 : 0))
        return fail("the original top occurrence does not match its completed movement");
    const released = move.released ?? [];
    if (!Array.isArray(released)) return fail("rebuild actual released-material records");
    const expected = ["battle", "combo", "unison"].includes(value.from.zone) && move.to !== value.from.zone;
    if (released.length !== (expected ? value.materials.length : 0))
        return fail("the completed regular move omitted or invented a pile release");
    const used = new Set<string>();
    for (const [index, record] of released.entries()) {
        const original = record && value.materials[index], at = record && findCard(state, record.card);
        const child = record && state.cards[record.card];
        if (!original || original.card !== record.card || used.has(record.card) || record.from !== value.from.zone || record.fromOwner !== value.from.owner
            || record.owner !== original.owner || record.to !== (original.zCard ? "removed" : "drop") || record.under !== null
            || record.released?.length || !at || at.zone !== record.to || at.owner !== original.owner
            || !child || child.cardId !== original.cardId || child.owner !== original.owner
            || (child.zoneEpoch ?? 0) !== original.epoch + 1 || (child.hiddenCount ?? 0) !== original.hiddenCount
            || hostOf(state, record.card) || child.under.length)
            return fail("rebuild original released material identity and destination");
        used.add(record.card);
    }
    if (!expected) for (const original of value.materials) {
        const child = state.cards[original.card];
        const restored = value.restoredHost && move.to !== value.from.zone;
        if (restored && original.card === value.restoredHost) {
            const at = findCard(state, original.card);
            if (!at || at.zone !== "leader" || at.owner !== value.from.owner)
                return fail("the recorded original Leader was not restored");
        } else if (hostOf(state, original.card) !== (restored ? value.restoredHost : value.top))
            return fail("a retained material changed its physical host");
        if (!child || child.cardId !== original.cardId || child.owner !== original.owner
            || (child.zoneEpoch ?? 0) !== original.epoch || (child.hiddenCount ?? 0) !== original.hiddenCount)
            return fail("a retained material changed its original occurrence");
    }
    // No policy is inferred for retained/restored attachments. Only returned releases end effects.
    for (const record of released) {
        const original = value.materials.find(m => m.card === record.card)!;
        cleanupPlacement(state, events, record, value.from.zone, { changedArea: true, retained: [] });
        settleAppliedEffectMove(state, original.effectMove);
    }
    captures.delete(token);
    return structuredClone(released);
}

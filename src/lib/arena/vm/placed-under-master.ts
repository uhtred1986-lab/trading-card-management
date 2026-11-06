/** RM23-2-2-4: the explicitly placed-under source answers for its actual top's master. */
import type { PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import type { Moment } from "./events";
import { findCard } from "./zones";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";
interface Identity { card: string; cardId: string; owner: PlayerId; epoch: number; flipped: boolean; hidden: boolean; hiddenCount: number }
export interface PlacedUnderRelation { version: 1; source: Identity; host: Identity; area: string; holder: PlayerId; master: PlayerId }
const fail = (): never => { throw new NotYet("rebuild actual placed-under source and host master relation", "placed-under-master"); };
function identity(state: VmState, id: string): Identity {
    const c = state.cards[id];
    if (!c || typeof c.cardId !== "string" || !c.cardId || !["p1", "p2"].includes(c.owner)
        || !Number.isSafeInteger(c.zoneEpoch ?? 0) || (c.zoneEpoch ?? 0) < 0 || (c.zoneEpoch ?? 0) >= Number.MAX_SAFE_INTEGER
        || c.flipped !== undefined && typeof c.flipped !== "boolean" || c.hidden !== undefined && typeof c.hidden !== "boolean"
        || !Number.isSafeInteger(c.hiddenCount ?? 0) || (c.hiddenCount ?? 0) < 0 || !Array.isArray(c.under)) return fail();
    return { card: id, cardId: c.cardId, owner: c.owner, epoch: c.zoneEpoch ?? 0, flipped: !!c.flipped, hidden: !!c.hidden, hiddenCount: c.hiddenCount ?? 0 };
}
/** Structural checks before any emitter mutates. Native writers establish the final relation. */
export function preflightPlacedUnder(state: VmState, source: string, host: string): void {
    if (source === host) fail();
    identity(state, source); identity(state, host);
    if ((state.cards[source].zoneEpoch ?? 0) >= Number.MAX_SAFE_INTEGER - 1 || (state.cards[host].zoneEpoch ?? 0) >= Number.MAX_SAFE_INTEGER - 1) fail();
    for (const id of [source, host, ...state.cards[source].under, ...state.cards[host].under]) {
        identity(state, id);
        let count = 0;
        for (const card of Object.values(state.cards)) {
            if (!Array.isArray(card.under)) fail();
            count += card.under.filter(x => x === id).length;
        }
        for (const side of Object.values(state.sides)) for (const zone of Object.values(side.zones)) count += zone.filter(x => x === id).length;
        if (count !== 1) fail();
    }
}
export function capturePlacedUnderRelation(game: GameDefinition, state: VmState, source: string, host: string): PlacedUnderRelation {
    const original = identity(state, source), top = identity(state, host), at = findCard(state, host);
    if (Object.values(state.cards).some(c => !Array.isArray(c.under))) return fail();
    if (!at || findCard(state, source) || source === host || state.cards[source].under.length
        || Object.values(state.cards).flatMap(c => c.under.filter(id => id === source).map(() => c.id)).join() !== host
        || !(game.zones[at.zone]?.host || at.zone === "zDeck" && state.cards[host].zCard)) return fail();
    return { version: 1, source: original, host: top, area: at.zone, holder: at.owner,
        master: at.owner };
}
/** Only a declared self placedUnder alias receives the override; other watchers are unchanged. */
export function placedUnderMaster(game: GameDefinition, state: VmState, moment: Moment, answering: string, trigger: string): PlayerId | undefined {
    const declaration = game.triggers[trigger];
    if (moment.event !== "placedUnder" || moment.card !== answering || declaration?.bind !== "self" || declaration.on.event !== "placedUnder") return undefined;
    for (const [key, expected] of Object.entries(declaration.on.args)) {
        if (Array.isArray(expected) ? !expected.includes(moment.args[key] as never) : expected !== moment.args[key]) return undefined;
    }
    const relation = moment.placedUnderRelation;
    if (!relation || relation.version !== 1 || !relation.source || !relation.host || relation.source.card !== answering) return fail();
    const actual = capturePlacedUnderRelation(game, state, answering, relation.host.card);
    if (canonical(actual) !== canonical(relation) || moment.controller !== actual.master || moment.args.to !== "under") return fail();
    return actual.master;
}

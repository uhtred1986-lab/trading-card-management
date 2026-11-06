/** Isolated physical under-relation contract; supplied facts are not native authority. */
import type { PlayerId } from "../types";
import type { MixedStandingNegationCard as Card } from "./standing-negation-mixed-history";
import { emptyMixedStandingNegationHistory, settleMixedStandingNegation } from "./standing-negation-mixed-history";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";

export interface UnderOccurrence {
    card: string;
    cardId: string;
    epoch: number;
    hiddenCount: number;
    side: "front" | "back";
    owner: PlayerId;
}
export interface UnderRelation {
    source: UnderOccurrence;
    host: Card;
    position: number;
}
export interface UnderPile {
    host: Card;
    type: "BATTLE";
    hidden: false;
    cards: string[];
}
export interface UnderStandingSource {
    kind: "under";
    policy: "battleOnTopNegationAndAttackBanV1";
    occurrence: UnderOccurrence;
    skillIndex: number;
    skillIdentity: string;
}
export type UnderRelationChange = {
    kind: "reorder";
    before: UnderRelation;
    after: UnderRelation;
};
export const underRebuild = (message: string): never => { throw new NotYet(message, "under-standing-contract"); };
export const underShape = (value: unknown, fields: readonly string[]): boolean => !!value
    && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export function requireUnderOccurrence(value: UnderOccurrence): void {
    if (!underShape(value, ["card", "cardId", "epoch", "hiddenCount", "side", "owner"])
        || !text(value.card) || !text(value.cardId) || !natural(value.epoch) || !natural(value.hiddenCount)
        || !["front", "back"].includes(value.side) || !["p1", "p2"].includes(value.owner))
        underRebuild("rebuild the physical under-source occurrence");
}
export function requireUnderSource(value: UnderStandingSource): void {
    if (!underShape(value, ["kind", "policy", "occurrence", "skillIndex", "skillIdentity"])
        || value.kind !== "under" || value.policy !== "battleOnTopNegationAndAttackBanV1"
        || !natural(value.skillIndex) || !text(value.skillIdentity))
        underRebuild("rebuild the complete under-standing source");
    requireUnderOccurrence(value.occurrence);
}
/** Host, master and pile position deliberately do not identify a generation. */
export function underStandingSourceKey(source: UnderStandingSource): string {
    requireUnderSource(source);
    return canonical(source);
}
/** Uses the unchanged v2 area domain validator, never creates an under zone member. */
export function requireUnderRelations(cards: Card[], piles: UnderPile[], relations: UnderRelation[]): void {
    settleMixedStandingNegation(emptyMixedStandingNegationHistory(), {
        version: 2, policy: "mixedWholeV1", cards, battle: null, candidates: [],
    });
    if (!Array.isArray(piles) || !Array.isArray(relations)) underRebuild("rebuild under-standing pile facts");
    const buried = new Set<string>(), hosts = new Set<string>();
    for (const pile of piles) {
        if (!underShape(pile, ["host", "type", "hidden", "cards"]) || pile.type !== "BATTLE"
            || pile.hidden !== false || !Array.isArray(pile.cards) || pile.cards.some(id => !text(id))
            || !cards.some(card => canonical(card) === canonical(pile.host))
            || !["battle", "combo"].includes(pile.host.area) || hosts.has(pile.host.card))
            underRebuild("unreviewed or malformed under-standing host");
        hosts.add(pile.host.card);
        for (const id of pile.cards) {
            if (buried.has(id) || cards.some(card => card.card === id))
                underRebuild("under-standing source needs one flat unique outer host");
            buried.add(id);
        }
    }
    const sources = new Set<string>();
    for (const relation of relations) {
        if (!underShape(relation, ["source", "host", "position"]) || !natural(relation.position))
            underRebuild("rebuild under-standing source position");
        requireUnderOccurrence(relation.source);
        const pile = piles.find(item => canonical(item.host) === canonical(relation.host));
        if (!pile || pile.cards[relation.position] !== relation.source.card || sources.has(relation.source.card))
            underRebuild("rebuild the actual outer-host membership");
        sources.add(relation.source.card);
    }
}
/** Exact before/after facts, not an inference made by a standing query. */
export function requireUnderRelationChange(change: UnderRelationChange): void {
    if (!underShape(change, ["kind", "before", "after"]) || change.kind !== "reorder"
        || !underShape(change.before, ["source", "host", "position"])
        || !underShape(change.after, ["source", "host", "position"]))
        underRebuild("unreviewed under-standing relation transition");
    requireUnderOccurrence(change.before.source);
    requireUnderOccurrence(change.after.source);
    if (canonical(change.before.source) !== canonical(change.after.source))
        underRebuild("a retained under source must remain the same physical occurrence");
    if (!natural(change.before.position) || !natural(change.after.position))
        underRebuild("rebuild under-standing transition positions");
    for (const host of [change.before.host, change.after.host]) {
        settleMixedStandingNegation(emptyMixedStandingNegationHistory(), {
            version: 2, policy: "mixedWholeV1", cards: [host], battle: null, candidates: [],
        });
    }
    // RM23-2-5 releases the pile when the top moves to a differently named
    // area. Existing native Battle/Combo pile retention is not rule authority.
    if (canonical(change.before.host) !== canonical(change.after.host))
        underRebuild("reorder cannot change the outer host");
}

/** R523 unimported actual-board observer. Under-only, no gameplay or grant writes. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import type { Script, Op } from "./script";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { findCard } from "./zones";
import { externallyNegatedSkill } from "./effects";
import { zeroSkillPrice } from "./skill-payment";
import { mixedStandingOccurrences } from "./standing-negation-mixed-observation";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { standingWholePrinted, standingWholeScript, standingComboWholePrinted } from "./standing-negation-policy";
import { reviewUnderStandingDefinitions, requireReviewedUnderDefinition, type ReviewedUnderDefinition } from "./standing-negation-under-definition";
import { validateUnderStandingHistory, type UnderHistory, type UnderObservation } from "./standing-negation-under-history";
import { requireUnderRelations, requireUnderOccurrence, underRebuild as fail, type UnderOccurrence } from "./standing-negation-under-relation";
import { nativeAreaStandingFacts, requireNativeAreaStandingDiscovery, type NativeAreaStandingDiscovery } from "./standing-negation-native-facts";
const protection: Op = { op: "forbid", what: "beNegated", until: "game", target: { sel: { special: "self" } } };
const attack: Op = { op: "permit", what: "attackUnnegatable", until: "game", target: { sel: { special: "self" } } };
function exactProtection(script: Script): boolean {
    return (canonical(script.ops) === canonical([protection]) || canonical(script.ops) === canonical([attack, protection]))
        && script.kind === "permanent" && canonical(script.price) === canonical(zeroSkillPrice())
        && canonical(script.trigger) === "[]" && script.combo == null && !script.paidAdmission
        && !script.keepResolutionCondition && !script.playReplacement
        && canonical(script.usage) === canonical({ version: 1, oncePerTurn: false, limit: null })
        && canonical(script.validity) === canonical({ version: 1, sparking: null });
}
function sensitive(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(sensitive);
    const op = value as Record<string, unknown>;
    return ["negateSkills", "grant", "copySkills", "immune"].includes(String(op.op))
        || op.op === "forbid" && ["beNegated", "beAffectedBySkill"].includes(String(op.what))
        || Object.values(op).some(sensitive);
}
export function underObservedOccurrence(state: VmState, id: string): UnderOccurrence {
    const card = state.cards[id];
    if (!card || card.flipped !== undefined && typeof card.flipped !== "boolean"
        || card.hidden !== undefined && typeof card.hidden !== "boolean") return fail("observe an existing under-source occurrence");
    const occurrence: UnderOccurrence = { card: id, cardId: card.cardId, owner: card.owner, epoch: card.zoneEpoch ?? 0,
        hiddenCount: card.hiddenCount ?? 0, side: card.flipped ? "back" : "front" };
    requireUnderOccurrence(occurrence);
    return occurrence;
}
/** Actual physical placement including all zone memberships; never masterOf(owner). */
export function underPhysicalFacts(state: VmState) {
    if (Object.values(state.cards).some(card => !card || !Array.isArray(card.under))
        || Object.values(state.sides).some(side => !side || !side.zones || Object.values(side.zones).some(zone => !Array.isArray(zone))))
        return fail("observe complete physical pile and zone arrays");
    return Object.values(state.cards).map(card => ({ occurrence: underObservedOccurrence(state, card.id),
        hidden: !!card.hidden, zCard: !!card.zCard, pile: [...card.under],
        locations: Object.entries(state.sides).flatMap(([holder, side]) => Object.entries(side.zones)
            .flatMap(([area, ids]) => ids.flatMap(id => id === card.id ? [{ holder, area }] : []))),
        hosts: Object.values(state.cards).flatMap(host => host.under.flatMap((id, position) => id === card.id ? [{ host: host.id, position }] : [])),
    }));
}
export function observeUnderStandingFacts(ctx: EngineContext, game: GameDefinition, state: VmState,
    prior: UnderHistory, reviewed: readonly ReviewedUnderDefinition[]): UnderObservation {
    validateUnderStandingHistory(prior);
    if (state.battle || prior.observation.area.battle || prior.observation.area.candidates.length
        || prior.active.some(source => !("kind" in source.source)))
        return fail("isolated under observation does not yet combine battle participation or area policies");
    const discovery = discoverUnder(ctx, game, state, reviewed);
    const { cards, under, piles } = discovery;
    const protectedCards = collectUnderProtection(ctx, state, discovery);
    for (const candidate of under) {
        const host = candidate.relation.host;
        if (!protectedCards.has(host.card)) continue;
        if (prior.negated.some(edge => canonical(edge.target) === canonical(host)))
            return fail("review under self-protection reactivation from prior suppression");
        candidate.negateTargets = [];
    }
    requireUnderRelations(cards, piles, under.map(candidate => candidate.relation));
    return { version: 3, policy: "underAwareWholeV1", area: { version: 2, policy: "mixedWholeV1", cards, battle: null, candidates: [] }, piles, under };
}

/** Actual physical discovery only; qualification and history remain separate. */
function discoverUnder(ctx: EngineContext, game: GameDefinition, state: VmState,
    reviewed: readonly ReviewedUnderDefinition[]) {
    if (!Array.isArray(reviewed) || new Set(reviewed.map(x => `${x?.cardId}:${x?.side}:${x?.skill?.index}`)).size !== reviewed.length)
        return fail("rebuild distinct original under review descriptors");
    reviewed.forEach(value => requireReviewedUnderDefinition(ctx, value));
    for (const instance of Object.values(state.cards)) if (!Array.isArray(instance.under))
        return fail("observe complete actual flat piles");
    const cards = mixedStandingOccurrences(ctx, game, state), physical = underPhysicalFacts(state);
    const under: UnderObservation["under"] = [], piles: UnderObservation["piles"] = [];
    for (const fact of physical) {
        const instance = state.cards[fact.occurrence.card], def = ctx.defs[instance.cardId];
        if (!def) return fail("observe complete physical card definitions");
        const actual = reviewUnderStandingDefinitions(ctx, instance.cardId, fact.occurrence.side);
        if (!actual.length) continue;
        if (actual.some(value => !reviewed.some(item => canonical(item) === canonical(value))))
            return fail("review every actual under policy before observing its source");
        if (!fact.hosts.length) {
            if (fact.locations.length !== 1) return fail("bind unattached reviewed source to its physical area");
            continue;
        }
        if (actual.length !== 1 || fact.hosts.length !== 1 || fact.locations.length || fact.pile.length
            || fact.hidden || fact.zCard) return fail("observe one ordinary flat nonhidden under source");
        const relation = fact.hosts[0], top = state.cards[relation.host], at = findCard(state, relation.host);
        const host = cards.find(card => card.card === relation.host);
        if (!top || !at || !host || !["battle", "combo"].includes(at.zone) || top.hidden || top.zCard
            || ctx.defs[top.cardId]?.type !== "BATTLE")
            return fail("observe relevant under policy only beneath a plain Battle host in Battle or Combo");
        const topFact = physical.find(item => item.occurrence.card === top.id)!;
        if (topFact.locations.length !== 1 || topFact.hosts.length) return fail("bind actual outer host membership");
        for (const id of top.under) {
            const material = physical.find(item => item.occurrence.card === id);
            if (!material || material.locations.length || material.hosts.length !== 1 || material.pile.length)
                return fail("observe a unique flat complete outer pile");
        }
        if (!piles.some(pile => pile.host.card === top.id)) piles.push({ host, type: "BATTLE", hidden: false, cards: [...top.under] });
        const source = actual[0];
        under.push({ source: { kind: "under", policy: "battleOnTopNegationAndAttackBanV1", occurrence: fact.occurrence,
            skillIndex: source.skill.index, skillIdentity: canonical({ skill: source.skill, script: source.script, definition: source.definitionIdentity }) },
            relation: { source: fact.occurrence, host, position: relation.position },
            externalEnabled: !externallyNegatedSkill(state, instance.id, source.skill.index, source.skill.kind),
            negateTargets: [host], attackBanTargets: [host] });
    }
    requireUnderRelations(cards, piles, under.map(candidate => candidate.relation));
    return { cards, physical, under, piles };
}
function collectUnderProtection(ctx: EngineContext, state: VmState,
    discovery: ReturnType<typeof discoverUnder>, area?: NativeAreaStandingDiscovery): Set<string> {
    const { physical, under } = discovery;
    const areaCandidates = area ? nativeAreaStandingFacts(area).candidates : [];
    // Do not hide unsupported board policies simply because no current under output is enabled.
    const protectedCards = new Set<string>();
    for (const fact of physical) {
        const id = fact.occurrence.card, instance = state.cards[id], def = ctx.defs[instance.cardId];
        const publicArea = fact.locations.some(at => ["leader", "battle", "unison", "combo", "energy"].includes(at.area));
        if (!publicArea && !fact.hosts.length) continue;
        if (instance.hidden) continue;
        const scripts = programsOf(ctx, def, fact.occurrence.side);
        for (const skill of parseSkills((fact.occurrence.side === "back" ? def.back?.skill : def.skill) ?? null)) {
            if (skill.kind !== "permanent") continue;
            if (under.some(candidate => candidate.source.occurrence.card === id && candidate.source.skillIndex === skill.index)) continue;
            const script = scripts.bySkill[skill.index];
            if (!script || !Array.isArray(script.ops) || !Array.isArray(script.unsupported) || script.unsupported.length)
                return fail("review complete relevant Permanent records before under protection qualification");
            if (standingWholePrinted(skill) || standingComboWholePrinted(skill)) {
                const actual = areaCandidates.find(candidate => candidate.source.card === id && candidate.source.skillIndex === skill.index);
                if (actual && actual.source.skillIdentity === canonical(script)) continue;
                // A reviewed Battle-only policy in Combo is inactive, not an omitted source.
                if (area && fact.locations.length === 1 && fact.locations[0].area === "combo"
                    && standingWholePrinted(skill) && standingWholeScript(script)) continue;
                return fail("combine actual area standing policies only through shared reviewed native facts");
            }
            if (!script.ops.length && skill.effect.trim()) return fail("do not infer absent protection from an empty Permanent body");
            if (!sensitive(script.ops)) continue;
            if (!exactProtection(script) || skill.tags.length !== 1 || skill.tags[0].toLowerCase() !== "permanent" || skill.cost.trim() || skill.oncePerTurn || skill.limit !== null
                || skill.bond !== null || skill.sparking !== null || skill.burst !== null || skill.spiritBoost !== null
                || skill.markerCost !== null || Object.keys(skill.energyCost).length || skill.energyEither.length
                || skill.granted || skill.grants || fact.hosts.length)
                return fail("review broad, qualified or buried protection and standing grants before under observation");
            if (fact.locations[0]?.area === "battle" && def.type === "BATTLE"
                && !externallyNegatedSkill(state, id, skill.index, skill.kind)) protectedCards.add(id);
        }
    }
    for (const effect of state.effects) {
        if (effect.kind === "immune" || effect.kind === "forbid" && ["beNegated", "beAffectedBySkill"].includes(effect.forbid?.what ?? ""))
            return fail("review timed under-standing protection");
        if (effect.kind !== "copiedSkills") continue;
        requireResolvedGrantHistory(state, effect.target);
        if (resolvedGrantDeleted(state, effect.target, effect.id)) continue;
        const copied = effect.copied, def = copied && ctx.defs[copied.cardId];
        if (!copied || !def || !["front", "back"].includes(copied.side) || copied.side === "back" && !def.back || !Array.isArray(copied.skills)) return fail("review actual copied under-standing source identity");
        const skills = parseSkills((copied.side === "back" ? def.back?.skill : def.skill) ?? null);
        if (copied.skills.some(index => !skills.some(skill => skill.index === index) || skills.some(skill => skill.index === index && (skill.kind === "permanent" || skill.granted))))
            return fail("review copied Permanent or quoted under policy before observation");
    }
    return protectedCards;
}

declare const underDiscoveryBrand: unique symbol;
export interface UnderStandingDiscovery { readonly [underDiscoveryBrand]: true }
interface UnderDiscovery {
    ctx: EngineContext; game: GameDefinition; state: VmState;
    snapshot: string; facts: ReturnType<typeof discoverUnder>;
}
const underDiscoveries = new WeakMap<UnderStandingDiscovery, UnderDiscovery>();
function underDiscoverySnapshot(ctx: EngineContext, state: VmState): string {
    const ids = new Set(Object.values(state.cards).filter(Boolean).map(card => card.cardId));
    for (const effect of state.effects) if (effect.copied) ids.add(effect.copied.cardId);
    return canonical({ physical: underPhysicalFacts(state), effects: state.effects, grants: state.resolvedGrantDeletions,
        definitions: [...ids].sort().map(id => ({ id, def: ctx.defs[id],
            front: ctx.defs[id] && programsOf(ctx, ctx.defs[id], "front"),
            back: ctx.defs[id]?.back && programsOf(ctx, ctx.defs[id], "back") })) });
}
export function discoverUnderStandingCandidates(ctx: EngineContext, game: GameDefinition, state: VmState,
    reviewed: readonly ReviewedUnderDefinition[]): UnderStandingDiscovery {
    const facts = discoverUnder(ctx, game, state, reviewed);
    const token = Object.freeze({}) as UnderStandingDiscovery;
    underDiscoveries.set(token, { ctx, game, state, snapshot: underDiscoverySnapshot(ctx, state), facts });
    return token;
}
function requireUnderDiscovery(ctx: EngineContext, game: GameDefinition, state: VmState, token: UnderStandingDiscovery) {
    const value = token && underDiscoveries.get(token);
    if (!value || value.ctx !== ctx || value.game !== game || value.state !== state
        || value.snapshot !== underDiscoverySnapshot(ctx, state))
        return fail("retain under discovery on its original board, context and game");
    return value.facts;
}
export function underStandingCandidateFacts(ctx: EngineContext, game: GameDefinition, state: VmState, token: UnderStandingDiscovery) {
    return structuredClone(requireUnderDiscovery(ctx, game, state, token));
}
export function discoverUnderStandingProtection(ctx: EngineContext, game: GameDefinition, state: VmState,
    token: UnderStandingDiscovery, area?: NativeAreaStandingDiscovery): Set<string> {
    const facts = requireUnderDiscovery(ctx, game, state, token);
    if (area) requireNativeAreaStandingDiscovery(ctx, game, state, area);
    return collectUnderProtection(ctx, state, facts, area);
}

/** R524 extracted native area/protection facts; v2 semantics and refusal order unchanged. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { externallyNegatedSkill } from "./effects";
import { masterOf } from "./triggers";
import { findCard } from "./zones";
import { zeroSkillPrice } from "./skill-payment";
import { NotYet } from "./errors";
import type { Op, Script } from "./script";
import type { VmState } from "./state";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { standingUnderPrinted, standingUnderScript } from "./standing-negation-under-policy";
import { standingWholePrinted, standingWholeScript, standingComboWholePrinted, standingComboWholeScript } from "./standing-negation-policy";
import { mixedStandingNegationSourceKey as sourceKey } from "./standing-negation-mixed-history";
import { standingPriorFacts, type StandingPriorView } from "./standing-negation-prior-view";
import type { MixedStandingNegationCard as Card, MixedStandingNegationSource as Source, MixedStandingNegationObservation as Observation } from "./standing-negation-mixed-history";
function refuse(message: string): never { throw new NotYet(message, "R513"); }
const areas = ["leader", "battle", "unison", "combo"] as const;
const protection: Op = { op: "forbid", what: "beNegated", until: "game", target: { sel: { special: "self" } } };
const attackProtection: Op = { op: "permit", what: "attackUnnegatable", until: "game", target: { sel: { special: "self" } } };
const exactProtection = (script: Script) => canonical(script.ops) === canonical([protection])
    || canonical(script.ops) === canonical([attackProtection, protection]);
function contains(ops: unknown, kind: "whole" | "protection" | "grant"): boolean {
    if (!ops || typeof ops !== "object")
        return false;
    if (Array.isArray(ops))
        return ops.some(op => contains(op, kind));
    const op = ops as Record<string, unknown>;
    return (kind === "whole" && op.op === "negateSkills")
        || (kind === "protection" && op.op === "forbid" && op.what === "beNegated")
        || (kind === "grant" && ["grant", "copySkills"].includes(String(op.op)))
        || Object.values(op).some(value => contains(value, kind));
}
function printedIntent(effect: string): boolean {
    const text = effect.trim().toLowerCase();
    return text === "negate the skills of all other battle cards."
        || text === "while there are 7 or more cards in your combo area and this card is in a battle, negate the skills of all cards in your opponent's combo area.";
}
function ordinaryArea(type: string, area: string): boolean {
    const base = type.replace(/^Z-/, "");
    return base === "LEADER" ? area === "leader" : base === "UNISON" ? area === "unison"
        : ["BATTLE", "TOKEN", "EXTRA"].includes(base) && area === "battle";
}
/** Actual physical membership, never owner-inferred placement. */
export function mixedStandingOccurrences(ctx: EngineContext, game: GameDefinition, state: VmState): Card[] {
    if (game.id !== "dbs" || state.game !== game.id)
        refuse("observe mixed standing negation only in the reviewed ruleset");
    const result: Card[] = [];
    for (const holder of ["p1", "p2"] as const)
        for (const area of areas) {
            for (const id of state.sides[holder].zones[area] ?? []) {
                const instance = state.cards[id], at = findCard(state, id);
                if (!instance || !ctx.defs[instance.cardId] || !at || at.owner !== holder || at.zone !== area)
                    refuse("rebuild mixed standing-negation physical occurrence");
                result.push({ card: id, cardId: instance.cardId, epoch: instance.zoneEpoch ?? 0,
                    hiddenCount: instance.hiddenCount ?? 0, side: instance.flipped ? "back" : "front",
                    owner: instance.owner, holder, master: masterOf(game, state, id), area });
            }
        }
    if (new Set(result.map(card => card.card)).size !== result.length)
        refuse("duplicate mixed standing-negation physical holder");
    return result;
}
/** Complete observation from the supplied native board. Protection handoffs
 * use the already validated preceding history and actual transaction arrivals.
 */
export type NativeStandingFacts = Pick<Observation, "cards" | "battle" | "candidates">;
export function collectNativeStandingFacts(ctx: EngineContext, game: GameDefinition, state: VmState, view: StandingPriorView,
    arrivals: readonly Card[], battle: Observation["battle"]): NativeStandingFacts {
    const priorFacts = standingPriorFacts(view);
    if (priorFacts.hasUnderInteraction || priorFacts.version === 3
        && Object.values(state.cards).some(card => !card || !Array.isArray(card.under) || card.under.length > 0)) throw new NotYet("combine actual under and area source facts before protection handoff", "R524");
    const discovery = discoverArea(ctx, game, state, battle);
    const { cards, candidates } = discovery.facts;
    if (!candidates.length)
        return { cards, battle, candidates };
    const protectors = collectProtectors(ctx, state, discovery);
    for (const target of cards.filter(card => protectors.has(card.card))) {
        const prior = priorFacts.edges.filter(edge => canonical(edge.target) === canonical(target));
        if (arrivals.some(arrival => canonical(arrival) === canonical(target))) {
            if (prior.length)
                refuse("fresh mixed arrival reuses a suppressed occurrence");
            continue;
        }
        if (!prior.length)
            continue;
        if (prior.some(edge => candidates.some(candidate => sourceKey(candidate.source) === edge.source && candidate.externalEnabled)))
            protectors.delete(target.card);
        else
            refuse("review mixed self-protection reactivation when original suppression ends");
    }
    for (const candidate of candidates)
        candidate.targets = cards.filter(target => target.card !== candidate.source.card && !protectors.has(target.card)
            && (candidate.source.policy === "otherBattleWholeV1"
                ? target.area === "battle" && ["BATTLE", "Z-BATTLE", "TOKEN"].includes(ctx.defs[target.cardId].type)
                : target.area === "combo" && target.holder !== candidate.source.master));
    return { cards, battle, candidates };
}

/** Private staged discovery, shared without qualifying protection or changing history. */
declare const discoveryBrand: unique symbol;
export interface NativeAreaStandingDiscovery { readonly [discoveryBrand]: true }
interface DiscoveredArea {
    ctx: EngineContext;
    game: GameDefinition;
    state: VmState;
    facts: NativeStandingFacts;
    lines: Array<{ occurrence: Card; skill: ReturnType<typeof parseSkills>[number]; script: Script; activeArea: boolean }>;
}
const discoveries = new WeakMap<NativeAreaStandingDiscovery, { value: DiscoveredArea; snapshot: string }>();
function discoverySnapshot(ctx: EngineContext, state: VmState): string {
    const ids = new Set(Object.values(state.cards).filter(Boolean).map(card => card.cardId));
    for (const effect of state.effects) if (effect.copied) ids.add(effect.copied.cardId);
    return canonical({ cards: state.cards, zones: Object.values(state.sides).map(side => side.zones),
        battle: state.battle, effects: state.effects, grants: state.resolvedGrantDeletions,
        definitions: [...ids].sort().map(id => ({ id, def: ctx.defs[id], front: ctx.defs[id] && programsOf(ctx, ctx.defs[id], "front"), back: ctx.defs[id]?.back && programsOf(ctx, ctx.defs[id], "back") })) });
}
function requireDiscovery(token: NativeAreaStandingDiscovery): DiscoveredArea {
    const value = token && discoveries.get(token);
    if (!value || value.snapshot !== discoverySnapshot(value.value.ctx, value.value.state))
        refuse("retain actual area standing discovery before qualification");
    return value.value;
}
export function requireNativeAreaStandingDiscovery(ctx: EngineContext, game: GameDefinition, state: VmState,
    token: NativeAreaStandingDiscovery): void {
    const value = requireDiscovery(token);
    if (value.ctx !== ctx || value.game !== game || value.state !== state)
        refuse("bind shared area discovery to its actual board, context and game");
}
export function nativeAreaStandingFacts(token: NativeAreaStandingDiscovery): NativeStandingFacts {
    return structuredClone(requireDiscovery(token).facts);
}
function discoverArea(ctx: EngineContext, game: GameDefinition, state: VmState,
    battle: Observation["battle"], additionalPolicy = false, nativeUnder = false): DiscoveredArea {
    const cards = mixedStandingOccurrences(ctx, game, state);
    if (!!battle !== !!state.battle)
        refuse("bind mixed battle participation through an explicit native assignment");
    if (battle && state.battle) {
        for (const role of ["attacker", "guard"] as const) {
            const slot = battle[role], original = slot?.occurrence;
            if (!slot || !original || state.battle[role] !== original.card)
                refuse("bind mixed battle participant to the native role record");
            const current = cards.find(card => card.card === original.card);
            const same = current && canonical(current) === canonical(original) && !state.cards[original.card]?.hidden;
            if (slot.present !== !!same)
                refuse("retire changed mixed battle participation only from its original capture");
            const instance = state.cards[original.card];
            if (!slot.present && instance && (instance.cardId !== original.cardId || instance.owner !== original.owner
                || !Number.isSafeInteger(instance.zoneEpoch ?? 0) || (instance.zoneEpoch ?? 0) < original.epoch
                || !Number.isSafeInteger(instance.hiddenCount ?? 0) || (instance.hiddenCount ?? 0) < original.hiddenCount))
                refuse("bind historical mixed participant to its original physical card");
        }
    }
    const lines = cards.flatMap(occurrence => {
        const instance = state.cards[occurrence.card], def = ctx.defs[occurrence.cardId];
        if (instance.hidden)
            return [];
        const scripts = programsOf(ctx, def, occurrence.side);
        return parseSkills((occurrence.side === "back" ? def.back?.skill : def.skill) ?? null)
            .filter(skill => skill.kind === "permanent").map(skill => ({ occurrence, skill,
            script: scripts.bySkill[skill.index], activeArea: ordinaryArea(def.type, occurrence.area) }));
    });
    const candidates: Observation["candidates"] = [];
    for (const { occurrence, skill, script, activeArea } of lines) {
        // Battle text does not become an active source simply by entering Combo.
        if (!activeArea)
            continue;
        if (nativeUnder && standingUnderPrinted(skill) && standingUnderScript(script)) continue;
        if (!printedIntent(skill.effect) && !contains(script?.ops, "whole"))
            continue;
        let policy: Source["policy"];
        if (standingWholePrinted(skill) && standingWholeScript(script) && occurrence.area === "battle"
            && ["BATTLE", "Z-BATTLE", "TOKEN"].includes(ctx.defs[occurrence.cardId].type))
            policy = "otherBattleWholeV1";
        else if (standingComboWholePrinted(skill) && standingComboWholeScript(script) && occurrence.area === "leader"
            && ["LEADER", "Z-LEADER"].includes(ctx.defs[occurrence.cardId].type))
            policy = "opponentComboSevenInBattleV1";
        else
            return refuse("observe only complete reviewed mixed standing-negation source policies");
        candidates.push({ source: { ...occurrence, policy, skillIndex: skill.index, skillIdentity: canonical(script) },
            externalEnabled: !externallyNegatedSkill(state, occurrence.card, skill.index, skill.kind), targets: [] });
    }
    // Copied bodies must have original R475 identity. Ordinary copied Autos can
    // be deleted by the transaction; copied negators/protectors are not sources.
    for (const effect of state.effects) {
        if (effect.kind !== "copiedSkills" || !cards.some(card => card.card === effect.target))
            continue;
        requireResolvedGrantHistory(state, effect.target);
        if (resolvedGrantDeleted(state, effect.target, effect.id))
            continue;
        const copy = effect.copied, def = copy && ctx.defs[copy.cardId];
        if (!copy || !def || !["front", "back"].includes(copy.side) || copy.side === "back" && !def.back)
            refuse("rebuild mixed copied source definition");
        const scripts = programsOf(ctx, def, copy.side);
        const printed = parseSkills((copy.side === "back" ? def.back?.skill : def.skill) ?? null);
        for (const index of copy.skills) {
            const original = printed.find(skill => skill.index === index);
            if (!original || !!original.granted !== !!copy.quoted)
                refuse("rebuild mixed copied source skill identity");
            const skill = copy.quoted ? original.granted!.skill : original;
            const script = scripts.bySkill[index];
            if ((candidates.length || additionalPolicy) && skill.kind === "permanent"
                && (!script || !Array.isArray(script.unsupported) || script.unsupported.length || !Array.isArray(script.ops)))
                refuse("observe complete copied Permanent records before mixed policy qualification");
            if (skill.kind === "permanent" && (printedIntent(skill.effect) || contains(scripts.bySkill[index]?.ops, "whole")
                || contains(scripts.bySkill[index]?.ops, "protection") || contains(scripts.bySkill[index]?.ops, "grant")))
                refuse("observe copied mixed negators or protectors only with reviewed source authority");
        }
    }

    return { ctx, game, state, facts: { cards, battle, candidates }, lines };
}
export function discoverNativeAreaStandingFacts(ctx: EngineContext, game: GameDefinition, state: VmState,
    battle: Observation["battle"], additionalPolicy = false): NativeAreaStandingDiscovery {
    const value = discoverArea(ctx, game, state, battle, additionalPolicy);
    const token = Object.freeze({}) as NativeAreaStandingDiscovery;
    discoveries.set(token, { value, snapshot: discoverySnapshot(ctx, state) });
    return token;
}
export function discoverNativeStandingProtectors(ctx: EngineContext, game: GameDefinition, state: VmState,
    token: NativeAreaStandingDiscovery): Set<string> {
    const value = requireDiscovery(token);
    if (value.ctx !== ctx || value.game !== game || value.state !== state)
        refuse("qualify area standing discovery on its original board and context");
    return collectProtectors(ctx, state, value);
}
function collectProtectors(ctx: EngineContext, state: VmState, value: DiscoveredArea): Set<string> {
    const { cards, candidates } = value.facts;
    const { lines } = value;
    // A prospective opposing Combo target may print protection valid outside
    // its ordinary Battle Area. An unread Permanent cannot prove its absence.
    for (const candidate of candidates) {
        if (candidate.source.policy !== "opponentComboSevenInBattleV1") continue;
        for (const occurrence of cards.filter(card => card.area === "combo" && card.holder !== candidate.source.master)) {
            const instance = state.cards[occurrence.card];
            if (instance.hidden) continue;
            const def = ctx.defs[occurrence.cardId], scripts = programsOf(ctx, def, occurrence.side);
            for (const skill of parseSkills((occurrence.side === "back" ? def.back?.skill : def.skill) ?? null)) {
                if (skill.kind !== "permanent") continue;
                const script = scripts.bySkill[skill.index];
                if (!script || !Array.isArray(script.unsupported) || script.unsupported.length || !Array.isArray(script.ops))
                    refuse("observe complete opposing Combo Permanent records before mixed suppression");
            }
        }
    }
    if (state.effects.some(effect => effect.kind === "forbid" && effect.forbid?.what === "beNegated"))
        refuse("observe timed beNegated protection with reviewed mixed-policy qualification");
    // Public sources outside the target areas can supply protections or grants.
    // Recognized ordinary self protection in an inactive area has no effect;
    // an area-qualified or broad aura remains explicitly outside this slice.
    for (const holder of ["p1", "p2"] as const)
        for (const area of ["leader", "battle", "unison", "energy", "combo"] as const) {
            for (const id of state.sides[holder].zones[area] ?? []) {
                const instance = state.cards[id], def = instance && ctx.defs[instance.cardId];
                if (!def || instance.hidden)
                    continue;
                const scripts = programsOf(ctx, def, instance.flipped ? "back" : "front");
                for (const skill of parseSkills((instance.flipped ? def.back?.skill : def.skill) ?? null)) {
                    if (skill.kind !== "permanent")
                        continue;
                    const script = scripts.bySkill[skill.index];
                    if (contains(script?.ops, "grant"))
                        refuse("standing skill-grant regeneration during mixed whole-negation");
                    if (contains(script?.ops, "protection") && (!script || !exactProtection(script)))
                        refuse("observe area-qualified or broad mixed beNegated protection");
                }
            }
        }
    const protectors = new Set<string>();
    for (const { occurrence, skill, script, activeArea } of lines) {
        if (!activeArea)
            continue;
        if (!script || !Array.isArray(script.unsupported) || script.unsupported.length || !Array.isArray(script.ops))
            refuse("observe complete mixed-policy Permanent records");
        if (!contains(script.ops, "protection"))
            continue;
        if (!exactProtection(script) || script.kind !== "permanent" || script.paidAdmission || script.keepResolutionCondition || script.playReplacement
            || canonical(script.price) !== canonical(zeroSkillPrice()) || canonical(script.trigger) !== "[]"
            || canonical(script.usage) !== canonical({ version: 1, oncePerTurn: false, limit: null })
            || canonical(script.validity) !== canonical({ version: 1, sparking: null })
            || skill.cost.trim() || skill.oncePerTurn || skill.limit !== null || skill.bond !== null || skill.sparking !== null
            || skill.burst !== null || skill.spiritBoost !== null || skill.markerCost !== null || skill.granted || skill.grants)
            refuse("observe only unconditional native-area self beNegated protection");
        if (!externallyNegatedSkill(state, occurrence.card, skill.index, skill.kind))
            protectors.add(occurrence.card);
    }
    return protectors;
}

/** Native v3 only: an exact admitted under descriptor is not an area source. */
export function discoverNativeUnderAwareAreaFacts(ctx: EngineContext, game: GameDefinition, state: VmState,
    battle: Observation["battle"], additionalPolicy: boolean): NativeAreaStandingDiscovery {
    const value = discoverArea(ctx, game, state, battle, additionalPolicy, true);
    const token = Object.freeze({}) as NativeAreaStandingDiscovery;
    discoveries.set(token, { value, snapshot: discoverySnapshot(ctx, state) });
    return token;
}

/** R499: original declarations for one synchronous movement, never public events. */
import type { EngineContext, PlayerId, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import type { Moment } from "./events";
import type { Script } from "./script";
import { COPIED_SKILL_BASE, GRANTED_LINE_BASE } from "./common";
import { skillsShowing, matchTriggers, captureCopiedSkill } from "./triggers";
import { keywordMomentOf } from "./keyword-do";
import { keywordInstancesInForce, keywordNegatedFor, staticsNow } from "./program";
import { skillNegated } from "./effects";
import { autoTriggerMatches } from "../text/triggers";
import { findCard } from "./zones";
import { NotYet } from "./errors";
export interface LegacyMovementFacts {
    version: 1;
    union?: "Fusion" | "Potara" | "Absorb";
    revealedTop?: true;
    fromPile?: "leader" | "other";
}
interface Declaration {
    index: number;
    identity: string;
    negated: boolean;
    triggers: string[];
}
export interface MovementAutoHistory {
    version: 1;
    card: string;
    cardId: string;
    side: "front" | "back";
    epoch: number;
    hiddenCount: number;
    holder: PlayerId;
    from: string | null;
    declarations: Declaration[];
    unresolved: {
        authority: "copied" | "standing" | "grantedKeyword";
        grant?: number;
        triggers: string[];
    }[];
}
const identity = (skill: Skill, script?: Script): string => JSON.stringify([
    skill.kind, skill.raw, skill.cost, skill.effect, skill.keyword, script?.kind, script?.trigger,
]);
/** KO victim declarations are separate from the cause's `kos` moment. */
export function selfMovementDeclaration(game: GameDefinition, trigger: string, event: "moved" | "ko" = "moved"): boolean {
    const declared = game.triggers[trigger];
    return declared?.bind === "self" && declared.on.event === event
        && (event !== "ko" || declared.on.args.role === "koed");
}
function sourceTriggers(game: GameDefinition, skill: Skill, script?: Script): string[] {
    const keyword = keywordMomentOf(game, skill);
    return Object.keys(game.triggers).filter(trigger => (selfMovementDeclaration(game, trigger) || selfMovementDeclaration(game, trigger, "ko"))
        && (keyword ? keyword.at!.includes(trigger)
            : skill.kind === "auto" && (script?.trigger ? (script.trigger as string[]).includes(trigger) : autoTriggerMatches(skill, trigger as never))));
}
/** Read at the actual mutation boundary, after choices/replacements/payments. */
export function captureMovementAutoHistory(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): MovementAutoHistory {
    const source = state.cards[card];
    if (!source)
        throw new NotYet("capture the moving source's original skill history", "R499");
    const at = findCard(state, card), showing = skillsShowing(ctx, state, card);
    const declarations: Declaration[] = [], unresolved: MovementAutoHistory["unresolved"] = [];
    for (const skill of showing.skills) {
        const script = showing.scripts.bySkill[skill.index], triggers = sourceTriggers(game, skill, script);
        if (!triggers.length)
            continue;
        const negated = skillNegated(state, card, skill.index, skill.kind)
            || !!skill.keyword && keywordNegatedFor(ctx, game, state, card, skill.keyword.name, staticsNow(ctx, game, state));
        declarations.push({ index: skill.index, identity: identity(skill, script), negated, triggers });
        if (!negated && skill.index >= COPIED_SKILL_BASE)
            unresolved.push({
                authority: skill.index >= GRANTED_LINE_BASE ? "standing" : "copied", triggers,
                grant: captureCopiedSkill(state, card, skill, script)?.grant,
            });
    }
    // Resolved/standing keyword grants are not ordinary printed Skill entries.
    // Do not pretend their instance IDs can be reconstructed from a printed index.
    for (const instance of keywordInstancesInForce(ctx, game, state, card)) {
        if (instance.grantEffectId === undefined && instance.standingGrantId === undefined)
            continue;
        const declaration = Object.values(game.keywords).find(value => value.name === instance.keyword.name);
        const triggers = (declaration?.at ?? []).filter(trigger => selfMovementDeclaration(game, trigger)
            || selfMovementDeclaration(game, trigger, "ko"));
        if (triggers.length)
            unresolved.push({ authority: instance.standingGrantId === undefined ? "grantedKeyword" : "standing", triggers });
    }
    return { version: 1, card, cardId: source.cardId, side: source.flipped ? "back" : "front",
        epoch: source.zoneEpoch ?? 0, hiddenCount: source.hiddenCount ?? 0,
        holder: at?.owner ?? source.owner, from: at?.zone ?? null, declarations, unresolved };
}
/** Called only for unresolved source declarations. The caller projects the exact
 * primitive move, so redirects are not inferred from a requested destination. */
export function requireMovementAutoBodies(game: GameDefinition, state: VmState, history: MovementAutoHistory, moment: Moment, retainsDefinitions: boolean, legacy?: LegacyMovementFacts, ko?: Moment, legacyCause?: {
    actor: PlayerId;
    source: string;
}): void {
    const variants: Moment[] = [moment, ...(ko ? [ko] : [])];
    if (legacy)
        variants.push({ ...moment, ...(legacyCause ? { source: legacyCause.source } : {}), args: { ...moment.args,
                ...(legacyCause ? { by: "skill", byOpponent: legacyCause.actor !== history.holder, viaCard: legacyCause.source } : {}),
                ...(legacy.union ? { union: legacy.union === "Fusion" ? "Fusion" : true } : {}),
                ...(legacy.revealedTop ? { revealed: true } : {}),
                ...(legacy.fromPile ? { fromPile: legacy.fromPile === "leader" ? "leader" : true } : {}) } });
    const matched = new Set(variants.flatMap(value => matchTriggers(game, state, value)
        .filter(match => match.card === history.card && selfMovementDeclaration(game, match.trigger, value.event as "moved" | "ko"))
        .map(match => match.trigger)));
    if (history.unresolved.some(line => (!retainsDefinitions || line.authority !== "copied"
        || line.grant === undefined || !state.effects.some(effect => effect.id === line.grant && effect.target === history.card))
        && line.triggers.some(trigger => matched.has(trigger)))) {
        throw new NotYet("retain a copied or granted original movement Auto body", "R499");
    }
}
/** Current arrival negation remains an independent check in pendAutos. */
export function originalMovementSkillNegated(game: GameDefinition, state: VmState, moment: Moment, card: string, trigger: string, skill: Skill, script?: Script): boolean {
    const history = moment.movementHistory;
    if (!history || moment.card !== card || history.card !== card
        || !selfMovementDeclaration(game, trigger, moment.event as "moved" | "ko"))
        return false;
    const current = state.cards[card];
    if (!current || history.version !== 1 || current.cardId !== history.cardId
        || !Number.isSafeInteger(history.epoch) || !Number.isSafeInteger(history.hiddenCount)
        || history.epoch > (current.zoneEpoch ?? 0) || history.hiddenCount > (current.hiddenCount ?? 0)) {
        throw new NotYet("bind original movement Auto history to its source", "R499");
    }
    if (history.side !== (current.flipped ? "back" : "front"))
        return false;
    return history.declarations.some(line => line.index === skill.index && line.identity === identity(skill, script)
        && line.triggers.includes(trigger) && line.negated);
}

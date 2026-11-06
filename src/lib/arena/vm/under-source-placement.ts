/** R521 ordinary incoming-source cleanup. Specialized stack/promotion writers stay separate. */
import type { EngineContext, GameEvent, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import type { Script, ScriptFrame } from "./script";
import type { VmState } from "./state";
import type { MoveRecord } from "./zones";
import { findCard } from "./zones";
import { captureAppliedUnderPlacement, eligibleAppliedUnderPlacement, requireAppliedUnderPlacement, validateAppliedUnderPlacement, settleAppliedUnderPlacement, type AppliedUnderPlacement } from "./applied-effect-receipt";
import { captureRetainedGrantHistory, carryRetainedGrantHistory, type ResolvedGrantDeletion } from "./resolved-grant-deletion";
import { dropEffectsOnExcept, endSourceEffects, skillNegated, keywordSkillsNegated, grantedSkillNegated } from "./effects";
import { skillsShowing, matchTriggers } from "./triggers";
import { keywordMomentOf } from "./keyword-do";
import { keywordNegatedFor, staticsNow } from "./program";
import { autoTriggerMatches } from "../text/triggers";
import { capturePlacedUnderRelation } from "./placed-under-master";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";
interface Declaration { key: string; identity: string; aliases: string[]; negated: boolean }
declare const brand: unique symbol;
export interface UnderSourcePlacement { readonly [brand]: true }
interface Capture {
    state: VmState; source: string; host: string; from: string | null;
    effects: AppliedUnderPlacement; policy: { retained: readonly number[]; endBattleSourceEffects: boolean };
    grants: ResolvedGrantDeletion[]; declarations: Declaration[]; stage: 'prepared' | 'cleaned' | 'settled';
}
const captures = new WeakMap<UnderSourcePlacement, Capture>();
const fail = (message: string): never => { throw new NotYet(message, "under-source-placement"); };
function underAliases(game: GameDefinition): string[] {
    return Object.values(game.triggers).filter(trigger => trigger.bind === 'self' && trigger.on.event === 'placedUnder').map(trigger => trigger.name);
}
function declarationIdentity(skill: Skill, script?: Script): string { return canonical({ skill, script }); }
function declarations(ctx: EngineContext, game: GameDefinition, state: VmState, source: string): Declaration[] {
    const aliases = underAliases(game), showing = skillsShowing(ctx, state, source), result: Declaration[] = [];
    for (const skill of showing.skills) {
        const script = showing.scripts.bySkill[skill.index], keyword = keywordMomentOf(game, skill);
        const matching = aliases.filter(alias => keyword ? keyword.at?.includes(alias) : skill.kind === 'auto'
            && (script?.trigger ? (script.trigger as string[]).includes(alias) : autoTriggerMatches(skill, alias as never)));
        if (!matching.length) continue;
        result.push({ key: `line:${skill.index}`, identity: declarationIdentity(skill, script), aliases: matching,
            negated: skillNegated(state, source, skill.index, skill.kind) || !!keyword && keywordNegatedFor(ctx, game, state, source, skill.keyword?.name, staticsNow(ctx, game, state)) });
    }
    // Capture actual triggered keyword grants, not unrelated Continuous/Activate keywords.
    const names = new Set(Object.values(game.keywords).filter(keyword => keyword.at?.some(alias => aliases.includes(alias))).map(keyword => keyword.name));
    if (names.size) {
        const standing = staticsNow(ctx, game, state);
        const grants = [...state.effects.filter(effect => effect.target === source && effect.kind === 'keyword').map(effect => ({ key: `grant:${effect.id}`, value: effect.value, grant: effect.id })),
            ...standing.filter(effect => effect.target === source && effect.kind === 'keyword').map(effect => ({ key: `standing:${effect.standingGrantId ?? canonical(effect)}`, value: effect.value, grant: effect.standingGrantId }))];
        for (const grant of grants) {
            if (!grant.value || typeof grant.value !== 'object' || !('name' in grant.value) || !names.has(grant.value.name as never)) continue;
            const name = grant.value.name;
            const keyword = Object.values(game.keywords).find(value => value.name === name)!;
            result.push({ key: grant.key, identity: canonical(grant.value), aliases: (keyword.at ?? []).filter(alias => aliases.includes(alias)),
                negated: keywordSkillsNegated(state, source) || grant.grant !== undefined && grantedSkillNegated(state, source, grant.grant)
                    || keywordNegatedFor(ctx, game, state, source, grant.value.name as never, standing) });
        }
    }
    return result;
}
function capture(state: VmState, token: UnderSourcePlacement): Capture {
    const value = token && captures.get(token);
    if (!value || value.state !== state) return fail("rebuild ordinary under-source cleanup on this exact board");
    return value;
}
export function prepareUnderSourcePlacement(ctx: EngineContext, game: GameDefinition, state: VmState, source: string, host: string, frame?: ScriptFrame): UnderSourcePlacement {
    const effects = captureAppliedUnderPlacement(state, source, host, frame), policy = eligibleAppliedUnderPlacement(state, effects);
    const token = Object.freeze({}) as UnderSourcePlacement;
    captures.set(token, { state, source, host, from: findCard(state, source)?.zone ?? null, effects, policy,
        grants: captureRetainedGrantHistory(state, source), declarations: declarations(ctx, game, state, source), stage: 'prepared' });
    return token;
}
export function requireUnderSourcePlacement(state: VmState, token: UnderSourcePlacement): void {
    const value = capture(state, token);
    if (value.stage !== 'prepared') fail("reuse ordinary under-source placement");
    requireAppliedUnderPlacement(state, value.effects);
}
/** Validate actual movement before effects change. Caller still owns released-material cleanup. */
export function cleanupUnderSourcePlacement(state: VmState, events: GameEvent[], token: UnderSourcePlacement, move: MoveRecord): void {
    const value = capture(state, token);
    if (value.stage !== 'prepared') fail("reuse ordinary under-source cleanup");
    validateAppliedUnderPlacement(state, value.effects, move);
    dropEffectsOnExcept(state, events, value.source, value.policy.retained);
    if (value.policy.endBattleSourceEffects) endSourceEffects(state, events, value.source);
    carryRetainedGrantHistory(state, value.grants);
    value.stage = 'cleaned';
}
/** Run only after the source AND R519 material cleanups. */
export function settleUnderSourcePlacement(state: VmState, token: UnderSourcePlacement, move: MoveRecord): void {
    const value = capture(state, token);
    if (value.stage !== 'cleaned') fail("settle ordinary under-source metadata after cleanup");
    settleAppliedUnderPlacement(state, value.effects, move);
    value.stage = 'settled';
}
/** Clone preflight calls this after final standing settlement, before any live writes.
 * It refuses only actually matching declaration history changes; it publishes no Auto.
 */
export function requireUnderSourceTriggerHistory(ctx: EngineContext, game: GameDefinition, state: VmState, token: UnderSourcePlacement): void {
    const value = capture(state, token);
    if (value.stage !== 'settled') fail("inspect original under-source history after settlement");
    const relation = capturePlacedUnderRelation(game, state, value.source, value.host);
    const moment = { event: 'placedUnder', card: value.source, controller: relation.master, placedUnderRelation: relation,
        args: { to: 'under', ...(value.from ? { from: value.from } : {}) } };
    const matching = new Set(matchTriggers(game, state, moment).filter(match => match.card === value.source && underAliases(game).includes(match.trigger)).map(match => match.trigger));
    const relevant = (lines: Declaration[]) => lines.filter(line => line.aliases.some(alias => matching.has(alias)));
    const before = relevant(value.declarations), after = relevant(declarations(ctx, game, state, value.source));
    if (before.length !== after.length || before.some(original => {
        const current = after.find(line => line.key === original.key && line.identity === original.identity && canonical(line.aliases) === canonical(original.aliases));
        return !current || original.negated !== current.negated;
    })) fail("preserve the original matching placed-under declaration body and negation history");
    captures.delete(token);
}

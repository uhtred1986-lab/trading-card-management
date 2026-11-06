import { spendSelectedUses } from "./costs";
import { hasMixedStandingPolicy } from "./standing-negation-mixed-observation";
import { nativeUnderDefinitions } from "./under-native-policy";
import { projectNativeStack, type NativeStackWrite } from "./under-native-stack";
import { prohibitionUsesToSpend, attrsNow } from "./program";
/** R528 closed native writer preview. No caller-provided projected board or callback. */
import type { ContinuousEffect, EngineContext, ForbiddenAction, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ScriptFrame } from "./script";
import type { Receipt } from "./applied-effect-receipt";
import { captureAppliedEffectMove, settleAppliedEffectMove, recordAppliedEffect } from "./applied-effect-receipt";
import { findCard, moveCard, newCard, type MoveOptions, type MoveRecord } from "./zones";
import { captureFlowPlacement, cleanupFlowPlacement } from "./flow-placement-cleanup";
import { cleanupScriptPlacement } from "./script-placement-cleanup";
import { capturePileRelease, cleanupReleasedPile } from "./pile-release-cleanup";
import { captureUnderRelease, cleanupUnderRelease } from "./under-release-cleanup";
import { prepareUnderSourcePlacement, cleanupUnderSourcePlacement, settleUnderSourcePlacement } from "./under-source-placement";
import { addEffect, dropEffectsOn, endEffects, endTurnRelativeEffects, endAfterChargeEffects, endOwnTurnEffects,
    endNextMainEffects, endAfterOpponentChargeEffects, endSourceEffects, type EffectSpec } from "./effects";
import { issueNativeUnderRead } from "./under-native-read";
import { requireDormantNativePolicy, refuseNativeUnder as fail, type NativeUnderState } from "./under-native-observation";

export type NativeUnderEffectWrite =
    | { kind: "couponUses"; ids: number[] }
    | { kind: "prohibitionUse"; what: ForbiddenAction; opts: Parameters<typeof prohibitionUsesToSpend>[4] }
    | { kind: "add"; spec: EffectSpec }
    | { kind: "scriptAdd"; spec: EffectSpec; frame: ScriptFrame }
    | { kind: "group"; effect: number; group: number }
    | { kind: "end"; until: ContinuousEffect["until"]; player?: PlayerId }
    | { kind: "endRelative" | "endOwnTurn" | "endNextMain" | "endOpponentCharge" }
    | { kind: "endCharge"; cards: string[] }
    | { kind: "endSource" | "dropOn"; card: string };
export type NativeUnderMoveWrite =
    | { route: "host" | "flow"; card: string; to: string; options: MoveOptions; receipt?: Receipt }
    | { route: "under"; card: string; host: string; frame?: ScriptFrame; procedure?: { kind: "Z-Awaken"; frame: ScriptFrame } };
export type NativeUnderBattleWrite =
    | { kind: "begin"; attacker: string; guard: string }
    | { kind: "end" }
    | { kind: "assign"; role: "attacker" | "guard"; card: string }
    | { kind: "face"; card: string };
export interface NativeUnderWritePlan {
    moves?: NativeUnderMoveWrite[];
    effects?: NativeUnderEffectWrite[];
    battle?: NativeUnderBattleWrite;
    stack?: NativeStackWrite;
    token?: { id: string; cardId: string; owner: PlayerId; rest: boolean };
    hidden?: { card: string; hidden: boolean };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function fields(v: unknown, required: string[], optional: string[] = []): boolean {
    return object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
/** Only existing pure lifecycle helpers run here. Post-arrival producers must
 * name their exact effect writes; an arbitrary projected effects array is never accepted. */
export function projectNativeUnderWrite(ctx: EngineContext, game: GameDefinition, original: NativeUnderState, plan: NativeUnderWritePlan) {
    if (!fields(plan, [], ["moves", "effects", "battle", "stack", "token", "hidden"]) || plan.moves !== undefined && !Array.isArray(plan.moves)
        || plan.effects !== undefined && !Array.isArray(plan.effects)) return fail("bind a closed native standing writer plan");
    const state = structuredClone(original), results: MoveRecord[] = [];
    issueNativeUnderRead(ctx, game, state);
    if (plan.hidden) {
        const change = plan.hidden, instance = state.cards[change.card], def = instance && ctx.defs[instance.cardId];
        if (!fields(change, ["card", "hidden"]) || !instance || !def || typeof change.hidden !== "boolean"
            || instance.under.length || !findCard(state, change.card) || instance.zCard
            || hasMixedStandingPolicy({ ...ctx, defs: { [def.id]: def } })
            || nativeUnderDefinitions(ctx, def.id, "front").length || def.back && nativeUnderDefinitions(ctx, def.id, "back").length
            || state.underStandingNegationHistory!.active.length || state.underStandingNegationHistory!.observation.under.length)
            return fail("preflight only ordinary dormant Hidden changes without standing source or host relations");
        instance.hidden = change.hidden;
        if (change.hidden) instance.hiddenCount = (instance.hiddenCount ?? 0) + 1;
        applyNativeUnderEffectWrites(ctx, game, state, [], [{ kind: "dropOn", card: change.card }]);
        if (change.hidden && state.battle && (state.battle.attacker === change.card || state.battle.guard === change.card)) state.battle.hiddenOut = true;
    }
    if (plan.token) {
        const token = plan.token;
        if (!fields(token, ["id", "cardId", "owner", "rest"]) || !["p1", "p2"].includes(token.owner)
            || token.id !== `${token.owner}#token${Object.keys(state.cards).length}` || state.cards[token.id]
            || typeof token.rest !== "boolean" || !token.cardId.startsWith("TOKEN:") || ctx.defs[token.cardId]?.type !== "TOKEN")
            return fail("bind the actual native token definition before insertion");
        state.cards[token.id] = newCard(token.id, token.cardId, token.owner);
        const moved = moveCard(state, game, token.id, "battle", { owner: token.owner });
        if (!moved.ok) return fail("preflight the actual token placement");
        if (token.rest && game.zones.battle?.modes?.includes("rest")) state.cards[token.id].mode = "rest";
        results.push(moved.move);
    }
    for (const write of plan.moves ?? []) {
        if (!object(write) || typeof write.card !== "string" || !state.cards[write.card]) return fail("bind a real native movement source");
        if (write.route === "under") {
            if (!fields(write, ["route", "card", "host"], ["frame", "procedure"]) || typeof write.host !== "string" || !state.cards[write.host])
                return fail("bind the original native under-placement route");
            if (write.procedure) {
                const procedure = write.procedure, frame = procedure.frame, at = findCard(state, write.host);
                if (!fields(procedure, ["kind", "frame"]) || procedure.kind !== "Z-Awaken" || !frame
                    || frame.keywordCost?.line.keyword?.name !== "Z-Awaken" || frame.card !== write.host
                    || at?.zone !== "zDeck" || at.owner !== frame.master || findCard(state, write.card)?.owner !== frame.master
                    || attrsNow(ctx, game, state, write.host).type !== "Z-LEADER"
                    || frame.vars.zAwakenSource?.[0] !== write.host
                    || frame.vars["zAwakenSource@epoch"]?.[0] !== `${write.host}@${state.cards[write.host].zoneEpoch ?? 0}`)
                    return fail("bind the original paid Z-Awaken self-placement frame");
            }
            const source = prepareUnderSourcePlacement(ctx, game, state, write.card, write.host, write.frame && structuredClone(write.frame));
            const release = captureUnderRelease(state, write.card, write.host);
            const moved = moveCard(state, game, write.card, "drop", { under: write.host, ...(write.procedure ? { underProcedure: "Z-Awaken" as const } : {}) });
            if (!moved.ok) return fail("preflight the actual successful under placement");
            cleanupUnderSourcePlacement(state, [], source, moved.move);
            cleanupUnderRelease(state, [], release, moved.move);
            settleUnderSourcePlacement(state, source, moved.move);
            results.push(moved.move);
        } else {
            if (!["host", "flow"].includes(write.route) || !fields(write, ["route", "card", "to", "options"], ["receipt"])
                || typeof write.to !== "string" || !fields(write.options, [], ["owner", "position", "mode", "carry", "energyEntryCleanup", "zBattleControl", "replacement", "onto"])
                || write.options.carry !== undefined && typeof write.options.carry !== "boolean")
                return fail("bind the original plain native movement route");
            const from = findCard(state, write.card)?.zone ?? null;
            const pile = capturePileRelease(state, write.card, { carry: write.route === "host" && write.options.carry });
            const flow = write.route === "flow" ? captureFlowPlacement(state, write.card, write.receipt && structuredClone(write.receipt)) : undefined;
            const effect = write.route === "host" ? captureAppliedEffectMove(state, write.card, write.receipt && structuredClone(write.receipt)) : undefined;
            const moved = moveCard(state, game, write.card, write.to, structuredClone(write.options));
            if (!moved.ok) return fail("preflight the actual successful ordinary movement");
            if (flow) cleanupFlowPlacement(state, [], moved.move, flow);
            else cleanupScriptPlacement(state, [], moved.move, from, write.options.carry === true);
            cleanupReleasedPile(state, [], pile, moved.move);
            if (effect) settleAppliedEffectMove(state, effect);
            results.push(moved.move);
        }
    }
    applyNativeUnderEffectWrites(ctx, game, state, [], plan.effects ?? []);
    if (plan.stack) results.push(...projectNativeStack(ctx, state, game, plan.stack));
    const change = plan.battle;
    if (change !== undefined) {
        if (!object(change)) return fail("bind an actual native battle writer");
        if (change.kind === "begin") {
            if (!fields(change, ["kind", "attacker", "guard"]) || state.battle || !state.cards[change.attacker] || !state.cards[change.guard]) return fail("bind new battle participants");
            state.battle = { attacker: change.attacker, guard: change.guard, target: change.guard, step: "offense", negated: false, blockerOffered: false, counters: [] };
        } else if (change.kind === "end") {
            if (!fields(change, ["kind"]) || !state.battle) return fail("bind actual battle ending");
            delete state.battle;
        } else if (change.kind === "assign") {
            if (!fields(change, ["kind", "role", "card"]) || !state.battle || !["attacker", "guard"].includes(change.role) || !state.cards[change.card]) return fail("bind an actual participant assignment");
            state.battle[change.role] = change.card;
        } else if (change.kind === "face") {
            if (!fields(change, ["kind", "card"]) || !state.cards[change.card] || ctx.defs[state.cards[change.card].cardId]?.type !== "LEADER" || state.cards[change.card].zCard) return fail("bind a normal Leader face writer");
            state.cards[change.card].flipped = !state.cards[change.card].flipped;
        } else return fail("review this native battle writer");
    }
    return { state, results };
}

/** The same closed effect producer is used for typed native arrival setup. */
export function applyNativeUnderEffectWrites(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, ev: GameEvent[], writes: readonly NativeUnderEffectWrite[]): void {
    const expiry = (ended: ContinuousEffect[]) => {
        if (ended.some(effect => effect.kind === "control")) {
            requireDormantNativePolicy(state, "control expiry");
            if (ended.some(effect => effect.kind === "control" && effect.control && findCard(state, effect.target)?.zone === "battle"
                && findCard(state, effect.target)?.owner !== effect.control.from))
                return fail("preflight the complete original control-return batch before any loan expires");
        }
    };
    for (const write of writes) {
        if (!object(write)) return fail("bind an explicit native effect write");
        switch (write.kind) {
            case "couponUses": {
                if (!fields(write, ["kind", "ids"]) || !Array.isArray(write.ids) || new Set(write.ids).size !== write.ids.length)
                    return fail("bind the original selected coupon batch");
                const selected = write.ids.map(id => state.effects.find(effect => effect.id === id));
                if (selected.some(effect => !effect || !["cost", "specifiedCost", "skillCost", "evolveCost"].includes(effect.kind)
                    || !Number.isSafeInteger(effect.uses) || effect.uses! <= 0)) return fail("spend only current original cost coupons");
                const groups = new Set(selected.filter(effect => effect!.uses === 1 && effect!.group !== undefined).map(effect => effect!.group));
                if (state.effects.some(effect => effect.group !== undefined && groups.has(effect.group)
                    && !["cost", "specifiedCost", "skillCost", "evolveCost"].includes(effect.kind)))
                    return fail("review non-cost effect expiry in a coupon group before payment");
                spendSelectedUses(state, ev, selected as ContinuousEffect[]); break;
            }
            case "prohibitionUse":
                if (!fields(write, ["kind", "what", "opts"]) || typeof write.what !== "string"
                    || !fields(write.opts, [], ["player", "card", "bySkill", "source", "from", "skillKind", "keyword"]))
                    return fail("bind the original counted prohibition query");
                for (const effect of prohibitionUsesToSpend(ctx, game, state, write.what, write.opts))
                    effect.forbid!.uses = Math.max(0, (effect.forbid!.uses ?? 0) - 1);
                break;
            case "add":
                if (!fields(write, ["kind", "spec"]) || !object(write.spec) || !state.cards[write.spec.target]) return fail("bind a native effect production");
                if (write.spec.kind === "control") requireDormantNativePolicy(state, "control effect production");
                addEffect(state, ev, structuredClone(write.spec)); break;
            case "scriptAdd": {
                if (!fields(write, ["kind", "spec", "frame"]) || !object(write.spec) || !object(write.frame) || !state.cards[write.spec.target]) return fail("bind the actual executing effect frame");
                if (write.spec.kind === "control") requireDormantNativePolicy(state, "control effect production");
                const frame = structuredClone(write.frame);
                recordAppliedEffect(state, frame, write.spec.target, () => addEffect(state, ev, structuredClone(write.spec)));
                break;
            }
            case "group": {
                if (!fields(write, ["kind", "effect", "group"]) || !Number.isSafeInteger(write.effect) || !Number.isSafeInteger(write.group) || write.group < 0) return fail("bind an existing native effect group");
                const effect = state.effects.find(effect => effect.id === write.effect);
                if (!effect) return fail("group the original existing effect");
                effect.group = write.group;
                break;
            }
            case "end":
                if (!fields(write, ["kind", "until"], ["player"])) return fail("bind a native effect expiry");
                expiry(endEffects(state, ev, write.until, write.player)); break;
            case "endRelative":
                if (!fields(write, ["kind"])) return fail("bind relative expiry");
                expiry(endTurnRelativeEffects(state, ev)); break;
            case "endOwnTurn":
                if (!fields(write, ["kind"])) return fail("bind own-turn expiry");
                expiry(endOwnTurnEffects(state, ev)); break;
            case "endNextMain":
                if (!fields(write, ["kind"])) return fail("bind Main expiry");
                expiry(endNextMainEffects(state, ev)); break;
            case "endOpponentCharge":
                if (!fields(write, ["kind"])) return fail("bind opponent Charge expiry");
                expiry(endAfterOpponentChargeEffects(state, ev)); break;
            case "endCharge":
                if (!fields(write, ["kind", "cards"]) || !Array.isArray(write.cards) || write.cards.some(id => typeof id !== "string" || !state.cards[id])) return fail("bind charged-card expiry");
                expiry(endAfterChargeEffects(state, ev, write.cards)); break;
            case "dropOn":
                if (!fields(write, ["kind", "card"]) || typeof write.card !== "string" || !state.cards[write.card]) return fail("bind actual arrival effect reset");
                if (state.effects.some(effect => effect.target === write.card && effect.kind === "control")) requireDormantNativePolicy(state, "arrival control-effect reset");
                dropEffectsOn(state, ev, write.card); break;
            case "endSource":
                if (!fields(write, ["kind", "card"]) || typeof write.card !== "string" || !state.cards[write.card]) return fail("bind source expiry");
                expiry(endSourceEffects(state, ev, write.card)); break;
            default: return fail("review this native effect writer before standing settlement");
        }
    }
}

/** R528 closed native writer preview. No caller-provided projected board or callback. */
import type { ContinuousEffect, EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ScriptFrame } from "./script";
import type { Receipt } from "./applied-effect-receipt";
import { captureAppliedEffectMove, settleAppliedEffectMove, recordAppliedEffect } from "./applied-effect-receipt";
import { findCard, moveCard, type MoveOptions, type MoveRecord } from "./zones";
import { captureFlowPlacement, cleanupFlowPlacement } from "./flow-placement-cleanup";
import { cleanupScriptPlacement } from "./script-placement-cleanup";
import { capturePileRelease, cleanupReleasedPile } from "./pile-release-cleanup";
import { captureUnderRelease, cleanupUnderRelease } from "./under-release-cleanup";
import { prepareUnderSourcePlacement, cleanupUnderSourcePlacement, settleUnderSourcePlacement } from "./under-source-placement";
import { addEffect, endEffects, endTurnRelativeEffects, endAfterChargeEffects, endOwnTurnEffects,
    endNextMainEffects, endAfterOpponentChargeEffects, endSourceEffects, type EffectSpec } from "./effects";
import { issueNativeUnderRead } from "./under-native-read";
import { refuseNativeUnder as fail, type NativeUnderState } from "./under-native-observation";

export type NativeUnderEffectWrite =
    | { kind: "add"; spec: EffectSpec }
    | { kind: "scriptAdd"; spec: EffectSpec; frame: ScriptFrame }
    | { kind: "group"; effect: number; group: number }
    | { kind: "end"; until: ContinuousEffect["until"]; player?: PlayerId }
    | { kind: "endRelative" | "endOwnTurn" | "endNextMain" | "endOpponentCharge" }
    | { kind: "endCharge"; cards: string[] }
    | { kind: "endSource"; card: string };
export type NativeUnderMoveWrite =
    | { route: "host" | "flow"; card: string; to: string; options: MoveOptions; receipt?: Receipt }
    | { route: "under"; card: string; host: string; frame?: ScriptFrame };
export type NativeUnderBattleWrite =
    | { kind: "begin"; attacker: string; guard: string }
    | { kind: "end" }
    | { kind: "assign"; role: "attacker" | "guard"; card: string }
    | { kind: "face"; card: string };
export interface NativeUnderWritePlan {
    moves?: NativeUnderMoveWrite[];
    effects?: NativeUnderEffectWrite[];
    battle?: NativeUnderBattleWrite;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function fields(v: unknown, required: string[], optional: string[] = []): boolean {
    return object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
/** Only existing pure lifecycle helpers run here. Post-arrival producers must
 * name their exact effect writes; an arbitrary projected effects array is never accepted. */
export function projectNativeUnderWrite(ctx: EngineContext, game: GameDefinition, original: NativeUnderState, plan: NativeUnderWritePlan) {
    if (!fields(plan, [], ["moves", "effects", "battle"]) || plan.moves !== undefined && !Array.isArray(plan.moves)
        || plan.effects !== undefined && !Array.isArray(plan.effects)) return fail("bind a closed native standing writer plan");
    const state = structuredClone(original), results: MoveRecord[] = [];
    issueNativeUnderRead(ctx, game, state);
    for (const write of plan.moves ?? []) {
        if (!object(write) || typeof write.card !== "string" || !state.cards[write.card]) return fail("bind a real native movement source");
        if (write.route === "under") {
            if (!fields(write, ["route", "card", "host"], ["frame"]) || typeof write.host !== "string" || !state.cards[write.host])
                return fail("bind the original native under-placement route");
            const source = prepareUnderSourcePlacement(ctx, game, state, write.card, write.host, write.frame && structuredClone(write.frame));
            const release = captureUnderRelease(state, write.card, write.host);
            const moved = moveCard(state, game, write.card, "drop", { under: write.host });
            if (!moved.ok) return fail("preflight the actual successful under placement");
            cleanupUnderSourcePlacement(state, [], source, moved.move);
            cleanupUnderRelease(state, [], release, moved.move);
            settleUnderSourcePlacement(state, source, moved.move);
            results.push(moved.move);
        } else {
            if (!["host", "flow"].includes(write.route) || !fields(write, ["route", "card", "to", "options"], ["receipt"])
                || typeof write.to !== "string" || !fields(write.options, [], ["owner", "position", "mode", "carry", "energyEntryCleanup", "zBattleControl", "replacement"])
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
    const expiry = (ended: ContinuousEffect[]) => {
        if (ended.some(effect => effect.kind === "control")) return fail("preflight control-return movements before effect expiry");
    };
    for (const write of plan.effects ?? []) {
        if (!object(write)) return fail("bind an explicit native effect write");
        switch (write.kind) {
            case "add":
                if (!fields(write, ["kind", "spec"]) || !object(write.spec) || !state.cards[write.spec.target]) return fail("bind a native effect production");
                if (write.spec.kind === "control") return fail("bind control effects through their native movement writer");
                addEffect(state, [], structuredClone(write.spec)); break;
            case "scriptAdd": {
                if (!fields(write, ["kind", "spec", "frame"]) || !object(write.spec) || !object(write.frame) || !state.cards[write.spec.target]) return fail("bind the actual executing effect frame");
                if (write.spec.kind === "control") return fail("bind control effects through their native movement writer");
                const frame = structuredClone(write.frame);
                recordAppliedEffect(state, frame, write.spec.target, () => addEffect(state, [], structuredClone(write.spec)));
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
                expiry(endEffects(state, [], write.until, write.player)); break;
            case "endRelative":
                if (!fields(write, ["kind"])) return fail("bind relative expiry");
                expiry(endTurnRelativeEffects(state, [])); break;
            case "endOwnTurn":
                if (!fields(write, ["kind"])) return fail("bind own-turn expiry");
                expiry(endOwnTurnEffects(state, [])); break;
            case "endNextMain":
                if (!fields(write, ["kind"])) return fail("bind Main expiry");
                expiry(endNextMainEffects(state, [])); break;
            case "endOpponentCharge":
                if (!fields(write, ["kind"])) return fail("bind opponent Charge expiry");
                expiry(endAfterOpponentChargeEffects(state, [])); break;
            case "endCharge":
                if (!fields(write, ["kind", "cards"]) || !Array.isArray(write.cards) || write.cards.some(id => typeof id !== "string" || !state.cards[id])) return fail("bind charged-card expiry");
                expiry(endAfterChargeEffects(state, [], write.cards)); break;
            case "endSource":
                if (!fields(write, ["kind", "card"]) || typeof write.card !== "string" || !state.cards[write.card]) return fail("bind source expiry");
                expiry(endSourceEffects(state, [], write.card)); break;
            default: return fail("review this native effect writer before standing settlement");
        }
    }
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

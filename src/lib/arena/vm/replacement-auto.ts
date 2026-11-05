/** R-424: an Auto replacing its own Combo departure is an activation, while
 * an ordinary Permanent replacement is only an application (RM 9-5/9-10). */
import type { EngineContext, MoveReason, PlayerId, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import type { Script, ScriptFrame } from "./script";
import { isComboDepartureProgram, skillNegated } from "./effects";
import { skillsShowing } from "./triggers";
import { condHolds, forbids } from "./program";
import { automaticHasPrice } from "./secret-auto";
import { requireUsage } from "./usage";
import { requireValidity, sparkingIsValid } from "./validity";
import { usesLeft } from "./limits";
import { NotYet } from "./errors";
import { findCard } from "./zones";
import { fire } from "./events";

export interface ReplacementMove {
  owner: PlayerId;
  reason?: MoveReason;
  actor?: PlayerId;
  by?: string;
  byCard?: string;
  byOpponent?: boolean;
  cleanupDeparture?: true;
}
export interface ReplacementAuto {
  version: 1 | 2;
  card: string;
  epoch: number;
  move: ReplacementMove;
  used: { source: string; skillIndex?: number; occurrence: string }[];
  awaiting?: { choices: import("../types").ReplacementChoice[]; allowNone: boolean };
  started?: true;
  activation?: "paying" | "active";
  denied?: true;
}
export function sameReplacementOccurrence(state: VmState, r: ReplacementAuto): boolean {
  if (![1, 2].includes(r.version) || !Number.isSafeInteger(r.epoch) || r.epoch < 0 || !Array.isArray(r.used) || r.used.some(item => !item || typeof item.source !== "string" || typeof item.occurrence !== "string" || item.skillIndex !== undefined && !Number.isSafeInteger(item.skillIndex)) || !r.move || !["p1", "p2"].includes(r.move.owner)) replacementGuard("rebuild this saved Combo replacement occurrence");
  return findCard(state, r.card)?.zone === "combo" && (state.cards[r.card]?.zoneEpoch ?? 0) === r.epoch;
}
/** Called before canceling the original movement. Unsupported activation
 * prices must never be silently waived by replacement arbitration. */
export function prepareReplacementAuto(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, id: string, to: string, move: ReplacementMove): void {
  const showing = skillsShowing(ctx, state, frame.card);
  const skill = showing.skills.find(sk => sk.index === frame.skillIndex);
  if (skill?.kind !== "auto") return;
  const script = frame.skillIndex === undefined ? undefined : showing.scripts.bySkill[frame.skillIndex];
  // An already-activated Auto may install an ordinary timed replacement.
  // Only the whole triggerless Combo departure Auto is a new activation here.
  if (!script || script.trigger?.length || !isComboDepartureProgram(script.ops)) return;
  if (frame.card !== id || to !== "drop" || findCard(state, id)?.zone !== "combo") replacementGap("activate this replacement Auto outside the supported Combo departure");
  const [choice, play] = frame.ops;
  if (frame.ops.length !== 2 || choice.op !== "choose" || choice.sel.special !== "self" || play.op !== "play" || !("var" in play.target) || play.target.var !== choice.as) replacementGap("resolve a replacement Auto with effects beyond its own substitute play");
  requireUsage(skill.usage); requireValidity(skill.validity);
  if (automaticHasPrice(skill, script)) replacementGap("pay a replacement Auto activation price before replacing its departure");
  frame.replacementAuto = { version: 2, card: id, epoch: state.cards[id].zoneEpoch ?? 0, move, used: [{ source: frame.card, skillIndex: frame.skillIndex, occurrence: `standing:${state.cards[id].zoneEpoch ?? 0}` }] };
  frame.usage = skill.usage as import("./usage").UsageRecord; frame.validity = skill.validity as import("./validity").ValidityRecord;
  if (skillNegated(state, id, skill.index, "auto") || forbids(ctx, game, state, "activateSkill", { player: frame.master, card: id, skillKind: "auto" }) || !sparkingIsValid(state, frame.master, skill.validity) || usesLeft(state, frame.master, id, skill) === 0 || script.price?.condition && !condHolds(ctx, game, state, frame, script.price.condition)) frame.replacementAuto.denied = true;
}
/** No checkpoint is inserted inside the interrupted movement. This activation
 * owns its own shared Counter scope, then the original movement's fallback. */
export function beginReplacementAuto(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, queue: (skill: Skill, script: Script) => void): boolean {
  const occurrence = frame.replacementAuto!;
  if (occurrence.started && (!frame.skillEffectOrigin || frame.skillEffectOrigin.kind !== "replacement")) replacementGuard("rebuild this saved replacement Auto activation cursor");
  if (!occurrence.started) {
    occurrence.started = true;
    state.programs.unshift({ ops: [], ip: 0, vars: {}, card: frame.card, master: frame.master, replacing: occurrence.card, replacementFallback: structuredClone(occurrence) });
    if (occurrence.denied || !sameReplacementOccurrence(state, occurrence)) return false;
    const showing = skillsShowing(ctx, state, frame.card);
    const skill = showing.skills.find(sk => sk.index === frame.skillIndex);
    const script = frame.skillIndex === undefined ? undefined : showing.scripts.bySkill[frame.skillIndex];
    if (!skill || !script) replacementGuard("rebuild this saved replacement Auto identity");
    occurrence.version = 2;
    occurrence.activation = "paying";
    frame.skillEffectOrigin = { version: 2, kind: "replacement" };
    queue(skill, script);
    return false;
  }
  if (occurrence.denied || !sameReplacementOccurrence(state, occurrence)) return false;
  // R424 saves already announced their free activation. New frames wait for
  // the ordinary Auto payment continuation to finish before firing the moment.
  if (occurrence.version === 1) return true;
  if (frame.skillEffectOrigin?.scope !== undefined && occurrence.activation !== "active" || frame.autoCost && occurrence.activation === "active") replacementGuard("rebuild this saved replacement Auto payment/effect boundary");
  if (occurrence.activation === "paying") {
    if (frame.autoCost) return true;
    occurrence.activation = "active";
    fire(ctx, game, state, { event: "skillActivated", card: frame.card, controller: frame.master, args: { kind: "auto", from: "combo", paid: true, extra: false } });
  }
  if (occurrence.activation !== "active") replacementGuard("rebuild this saved replacement Auto payment cursor");
  return true;
}

export function requireReplacementOrigin(frame: ScriptFrame, script: import("./script").Script | undefined): void {
  if (frame.replacing && script?.kind === "auto" && !script.trigger?.length && isComboDepartureProgram(script.ops) && !frame.replacementAuto) replacementGuard("rebuild this saved replacement Auto before its Counter timing");
}

function replacementGuard(detail: string): never { throw new NotYet(detail, "#1249"); }
function replacementGap(detail: string): never { throw new NotYet(detail, "#1249"); }

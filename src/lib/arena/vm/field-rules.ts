/** R469: Field identity for rule processing differs from a skill referencing Field. */
import type { CardOccurrence, EngineContext, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import { parseSkills } from "../text/cards";
import { hasKeyword, permissions, permitted } from "./program";
import type { VmState } from "./state";
import { findCard, hostOf } from "./zones";

/** 9-1-2-1 retains negated printed text. A negated granted skill is deleted
 * (9-1-2-2), so only effective grants/copies supplement the printed face. */
export function fieldForRule(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): boolean {
  const inst = state.cards[card], def = inst && ctx.defs[inst.cardId];
  if (!inst || !def || inst.hidden || def.type !== "EXTRA") return false;
  const face = inst.flipped && def.back ? def.back : def;
  return parseSkills(face.skill ?? null).some(skill => skill.keyword?.name === "Field")
    || hasKeyword(ctx, game, state, card, "Field");
}

/** 22-3-5 is mandatory rule processing, not choosing targets. Under-card
 * placement is expressly excluded by22-3-5-1. Permission remains a live skill. */
export function otherFieldsToDrop(ctx: EngineContext, game: GameDefinition, state: VmState, arriving: string): string[] {
  const at = findCard(state, arriving);
  if (!at || at.zone !== "battle" || hostOf(state, arriving) || !fieldForRule(ctx, game, state, arriving)) return [];
  const keep = permissions(ctx, game, state, "fieldKeepOthers").some(permission => {
    const source = findCard(state, permission.target);
    return permission.master === at.owner && source?.owner === at.owner && source.zone === "battle"
      && !hostOf(state, permission.target) && permitted(ctx, game, state, permission.filter, arriving);
  });
  if (keep) return [];
  return state.sides[at.owner].zones.battle.filter(card => card !== arriving && !hostOf(state, card) && fieldForRule(ctx, game, state, card));
}

/** One arrival owns this rule action even when a replacement asks a question. */
export interface FieldCleanup {
  version: 1; arriving: CardOccurrence; master: PlayerId;
  cards: (CardOccurrence & { owner: PlayerId })[];
  order: string[];
  owners: PlayerId[];
  ordering?: { player: PlayerId; cards: string[] };
}


import { IllegalAction } from "./common";
import type { ScriptHost } from "./script-host";
import { NotYet } from "./errors";
import { vmHost } from "./host";
import { stepScript, type Op, type ScriptFrame } from "./script";
import { canonicalTaxValue as canonical } from "./tax-receipt";
function cleanupProgram(cards: CardOccurrence[]): { ops: Op[]; vars: ScriptFrame["vars"] } {
  const vars: ScriptFrame["vars"] = {};
  const ops: Op[] = cards.map((item, index) => {
    const key = `§fieldOld${index}`;
    vars[key] = [item.card]; vars[`${key}@epoch`] = [`${item.card}@${item.epoch}`];
    return { op: "moveTo", target: { var: key }, to: "drop", cause: "rule", completedAs: `§fieldMoved${index}` };
  });
  return { ops, vars };
}
/** Called only after the successful arrival's movement event was emitted. */
export function queueFieldCleanup(ctx: EngineContext, game: GameDefinition, state: VmState, arriving: string, from: string | null, fromHolder?: PlayerId | null): void {
  const at = findCard(state, arriving);
  if (!at || at.zone !== "battle" || (from === "battle" && fromHolder === at.owner)) return;
  const cards = otherFieldsToDrop(ctx, game, state, arriving).map(card => ({ card, epoch: state.cards[card].zoneEpoch ?? 0, owner: state.cards[card].owner }));
  if (!cards.length) return;
  const stamp: FieldCleanup = { version: 1, arriving: { card: arriving, epoch: state.cards[arriving].zoneEpoch ?? 0 }, master: at.owner, cards, order: [], owners: [state.turnPlayer, state.turnPlayer === "p1" ? "p2" : "p1"] };
  state.programs.unshift({ ops: [], vars: {}, card: arriving, master: at.owner, ip: 0, fieldCleanup: stamp });
}
/** An instruction's newly queued rule processing precedes its next instruction. */
export function takeFieldCleanup(state: VmState): ScriptFrame | null {
  const index = state.programs.findIndex(frame => !!frame.fieldCleanup);
  return index < 0 ? null : state.programs.splice(index, 1)[0];
}
/** Rule moves are neither targets of skills nor departures caused by a skill. */
export function fieldRuleHost(host: ScriptHost): ScriptHost {
  return { ...host,
    forbids: (what, options) => what === "beMovedBySkill" ? false : host.forbids(what, options),
    pend: () => {},
    replacementsFor: (card, reason, options) => host.replacementsFor(card, reason, { inSubstitute: options?.inSubstitute, requestedTo: options?.requestedTo }),
    prepareReplacement: (frame, card, to, cause) => host.prepareReplacement?.(frame, card, to, { owner: cause.owner, reason: "rule" }),
  };
}
export function stepFieldCleanup(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const stamp = frame.fieldCleanup;
  const valid = (item: CardOccurrence | undefined) => !!item && typeof item.card === "string" && Number.isSafeInteger(item.epoch) && item.epoch >= 0;
  if (!Array.isArray(frame.ops) || !frame.vars || typeof frame.vars !== "object" || Array.isArray(frame.vars) || !stamp || stamp.version !== 1 || stamp.master !== frame.master || !valid(stamp.arriving) || stamp.arriving.card !== frame.card || !Array.isArray(stamp.cards) || stamp.cards.some(item => !valid(item) || !["p1", "p2"].includes(item.owner)) || new Set(stamp.cards.map(item => item.card)).size !== stamp.cards.length || !Array.isArray(stamp.order) || new Set(stamp.order).size !== stamp.order.length || stamp.order.some(id => !stamp.cards.some(item => item.card === id)) || !Array.isArray(stamp.owners) || stamp.owners.length !== 2 || new Set(stamp.owners).size !== 2 || stamp.owners.some(player => player !== "p1" && player !== "p2"))
    throw new NotYet("rebuild the saved mandatory Field cleanup occurrences", "R469");
  while (stamp.order.length < stamp.cards.length) {
    if (frame.ip !== 0 || frame.ops.length) throw new NotYet("rebuild the unfinished Field cleanup ordering", "R469");
    const player = stamp.owners.find(owner => stamp.cards.some(item => item.owner === owner && !stamp.order.includes(item.card)))!;
    const remaining = stamp.cards.filter(item => item.owner === player && !stamp.order.includes(item.card)).map(item => item.card);
    if (stamp.ordering) {
      if (stamp.ordering.player !== player || canonical(stamp.ordering.cards) !== canonical(remaining) || frame.awaiting !== "fieldOrder") throw new NotYet("rebuild the saved Field cleanup order choice", "R469");
      const index = state.lastMode;
      if (index === null || !Number.isSafeInteger(index) || index < 0 || index >= remaining.length) throw new IllegalAction("choose the next Field to place in its owner's Drop");
      stamp.order.push(remaining[index]); state.lastMode = null; delete stamp.ordering; delete frame.awaiting;
    } else if (remaining.length === 1) stamp.order.push(remaining[0]);
    else {
      stamp.ordering = { player, cards: remaining }; frame.awaiting = "fieldOrder"; state.programs.unshift(frame);
      state.prompt = { kind: "chooseMode", player, reason: "Choose which Field to place in the Drop next", options: remaining.map(id => ctx.defs[state.cards[id]?.cardId]?.name ?? id) };
      return "wait";
    }
  }
  const expected = cleanupProgram(stamp.order.map(id => stamp.cards.find(item => item.card === id)!));
  if (!frame.ops.length) { frame.ops = expected.ops; frame.vars = expected.vars; }
  if (canonical(expected.ops) !== canonical(frame.ops) || Object.entries(expected.vars).some(([key, value]) => canonical(frame.vars[key]) !== canonical(value))) throw new NotYet("rebuild the saved mandatory Field cleanup program", "R469");
  return stepScript(fieldRuleHost(vmHost(ctx, game, state, ev)), frame);
}

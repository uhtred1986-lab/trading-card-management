/** R474: one complete alternative, one host, original selected occurrences. */
import type { CardOccurrence, EngineContext, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { Op, ScriptFrame, Script } from "./script";
import type { VmState } from "./state";
import type { AwakenAlternative } from "./awaken-alternative";
import { awakenAlternativeProblem } from "./awaken-alternative";
import { activationMoment, awakenCeiling, keywordActivationMoments, raiseLifeCeiling, resolveActivation, type ActivationLine } from "./activate";
import { automaticPriceHost, AutoPaymentFailed, canFinishAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { NotYet } from "./errors";
import { fire, log } from "./events";
import { vmHost } from "./host";
import { keywordAfterProgram, keywordProgram } from "./keyword-do";
import { forbiddenBy, resolveSelector, spendProhibitionUse, standingKindNegated, standingKeywordsNegated } from "./program";
import { stepScript } from "./script";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { skillsNegated, skillNegated, keywordSkillsNegated } from "./effects";
import { usesLeft } from "./limits";
import { skillsShowing } from "./triggers";
import { findCard, hostOf } from "./zones";

function rebuild(message: string): never { throw new NotYet(message, "R474"); }
const SOURCE = "§awakenOriginalLeader";
export interface AwakenAlternativePaid { version: 1; source: CardOccurrence; descriptor: AwakenAlternative }
const HOST = "§awakenHost", PAYERS = "§awakenPayers", POOL = "§awakenPool", PREFIX = "§awakenPrefix";
type Route = "free" | "under";
export interface AwakenAlternativeCost {
  version: 1;
  source: CardOccurrence & { cardId: string; master: PlayerId };
  line: ActivationLine;
  descriptor: AwakenAlternative;
  stage: "route" | "host" | "payers";
  routes?: Route[];
  hosts?: CardOccurrence[];
  host?: CardOccurrence;
  pool?: CardOccurrence[];
  offered?: CardOccurrence[];
  payers: Record<string, { epoch: number; paid: boolean }>;
}
const occurrence = (state: VmState, card: string): CardOccurrence => ({ card, epoch: state.cards[card]?.zoneEpoch ?? 0 });
const validOccurrence = (value: CardOccurrence | undefined): value is CardOccurrence => !!value && typeof value.card === "string" && Number.isSafeInteger(value.epoch) && value.epoch >= 0;
const current = (state: VmState, value: CardOccurrence): boolean => !!state.cards[value.card] && (state.cards[value.card].zoneEpoch ?? 0) === value.epoch;
const baseFrame = (source: string, master: PlayerId): ScriptFrame => ({ card: source, master, ops: [], ip: 0, vars: {} });
export const hasAwakenAlternative = (line: ActivationLine): boolean => line.keyword?.name === "Awaken" && !!line.script?.price?.awakenAlternative;
function freeHolds(ctx: EngineContext, game: GameDefinition, state: VmState, line: ActivationLine, master: PlayerId, descriptor: AwakenAlternative): boolean {
  const ceiling = awakenCeiling(ctx, game, state, master, line.card);
  const cond = ceiling === null ? descriptor.free : raiseLifeCeiling(descriptor.free, ceiling);
  return vmHost(ctx, game, state, []).condHolds(baseFrame(line.card, master), cond);
}
function hostVars(state: VmState, host: CardOccurrence): ScriptFrame["vars"] { const cards = [...state.cards[host.card].under]; return { [HOST]: [host.card], [`${HOST}@epoch`]: [`${host.card}@${host.epoch}`], [POOL]: cards, [`${POOL}@epoch`]: cards.map(card => `${card}@${state.cards[card].zoneEpoch ?? 0}`) }; }
function payerChoice(n: number): Op { return { op: "choose", sel: { area: "under", fromVar: POOL, notIn: [PREFIX], count: n, minCount: n }, as: PAYERS }; }
function transfer(name: string): Op { return { op: "moveTo", target: { var: name }, to: "under", under: { sel: { special: "self" } } }; }
function hostMatches(ctx: EngineContext, game: GameDefinition, state: VmState, line: ActivationLine, master: PlayerId, descriptor: AwakenAlternative, host: string): boolean {
  return !hostOf(state, host) && resolveSelector(ctx, game, state, baseFrame(line.card, master), descriptor.host, true).includes(host);
}
/** Prefix moves happen first in the isolated strict proof, preserving the order
 * the player selected. Remaining cards must come from this same bound pile. */
function finishes(ctx: EngineContext, game: GameDefinition, state: VmState, line: ActivationLine, master: PlayerId, descriptor: AwakenAlternative, host: CardOccurrence, prefix: string[] = [], pool?: CardOccurrence[]): boolean {
  if (!current(state, host) || !hostMatches(ctx, game, state, line, master, descriptor, host.card) || prefix.length > descriptor.count || new Set(prefix).size !== prefix.length || prefix.some(card => hostOf(state, card) !== host.card)) return false;
  const vars = hostVars(state, host), ops: Op[] = [];
  if (pool) { vars[POOL] = pool.map(payer => payer.card); vars[`${POOL}@epoch`] = pool.map(payer => `${payer.card}@${payer.epoch}`); }
  if (prefix.length) { vars[PREFIX] = [...prefix]; vars[`${PREFIX}@epoch`] = prefix.map(card => `${card}@${state.cards[card].zoneEpoch ?? 0}`); ops.push(transfer(PREFIX)); }
  if (prefix.length < descriptor.count) ops.push(payerChoice(descriptor.count - prefix.length), transfer(PAYERS));
  return canFinishAutomaticPrice(ctx, game, state, { ...baseFrame(line.card, master), ops, vars }, { symmetry: false });
}
function payableHosts(ctx: EngineContext, game: GameDefinition, state: VmState, line: ActivationLine, master: PlayerId, descriptor: AwakenAlternative): CardOccurrence[] {
  return resolveSelector(ctx, game, state, baseFrame(line.card, master), descriptor.host, true).filter(card => !hostOf(state, card)).map(card => occurrence(state, card)).filter(host => finishes(ctx, game, state, line, master, descriptor, host));
}
export function canPayAwakenAlternative(ctx: EngineContext, game: GameDefinition, state: VmState, master: PlayerId, line: ActivationLine): boolean {
  const descriptor = line.script?.price?.awakenAlternative;
  if (!hasAwakenAlternative(line) || awakenAlternativeProblem(descriptor)) return false;
  return freeHolds(ctx, game, state, line, master, descriptor!) || payableHosts(ctx, game, state, line, master, descriptor!).length > 0;
}
export function queueAwakenAlternative(state: VmState, master: PlayerId, line: ActivationLine): void {
  const descriptor = line.script?.price?.awakenAlternative;
  if (!hasAwakenAlternative(line) || awakenAlternativeProblem(descriptor)) rebuild("rebuild this alternative Awaken price");
  const cost: AwakenAlternativeCost = { version: 1, source: { ...occurrence(state, line.card), cardId: state.cards[line.card].cardId, master }, line: structuredClone(line), descriptor: structuredClone(descriptor!), stage: "route", payers: {} };
  state.programs.unshift({ ...baseFrame(line.card, master), skillIndex: line.skillIndex, awakenAlternativeCost: cost });
}
function requireCost(frame: ScriptFrame): AwakenAlternativeCost {
  const cost = frame.awakenAlternativeCost;
  if (!cost || cost.version !== 1 || !validOccurrence(cost.source) || cost.source.card !== frame.card || cost.source.master !== frame.master || typeof cost.source.cardId !== "string" || !cost.line?.skill || !cost.line.script?.price || cost.line.card !== frame.card || cost.line.skillIndex !== frame.skillIndex || cost.line.skill.index !== frame.skillIndex || !hasAwakenAlternative(cost.line) || awakenAlternativeProblem(cost.descriptor) || canonical(cost.descriptor) !== canonical(cost.line.script.price.awakenAlternative) || !["route", "host", "payers"].includes(cost.stage) || !cost.payers || typeof cost.payers !== "object" || Array.isArray(cost.payers) || !Array.isArray(frame.ops) || !Number.isSafeInteger(frame.ip) || frame.ip < 0 || frame.ip > frame.ops.length || !frame.vars || typeof frame.vars !== "object" || Array.isArray(frame.vars)) rebuild("rebuild the saved alternative Awaken declaration");
  if (cost.routes !== undefined && (!Array.isArray(cost.routes) || !cost.routes.length || cost.routes.some(route => route !== "free" && route !== "under") || new Set(cost.routes).size !== cost.routes.length)) rebuild("rebuild the alternative Awaken route choice");
  if (cost.hosts !== undefined && (!Array.isArray(cost.hosts) || cost.hosts.some(host => !validOccurrence(host)) || new Set(cost.hosts.map(host => host.card)).size !== cost.hosts.length)) rebuild("rebuild the alternative Awaken host choice");
  if (cost.pool !== undefined && (!Array.isArray(cost.pool) || cost.pool.some(payer => !validOccurrence(payer)) || new Set(cost.pool.map(payer => payer.card)).size !== cost.pool.length)) rebuild("rebuild the original alternative Awaken pile");
  if (cost.offered !== undefined && (!Array.isArray(cost.offered) || cost.offered.some(payer => !validOccurrence(payer)) || new Set(cost.offered.map(payer => payer.card)).size !== cost.offered.length)) rebuild("rebuild the offered alternative Awaken payer occurrences");
  for (const [card, payer] of Object.entries(cost.payers)) if (!card || !payer || !Number.isSafeInteger(payer.epoch) || payer.epoch < 0 || typeof payer.paid !== "boolean") rebuild("rebuild the alternative Awaken payer occurrences");
  if (cost.stage === "payers" && (!validOccurrence(cost.host) || !cost.pool)) rebuild("rebuild the chosen alternative Awaken host occurrence");
  return cost;
}
function sourceValid(state: VmState, cost: AwakenAlternativeCost): boolean {
  const at = findCard(state, cost.source.card), inst = state.cards[cost.source.card];
  return current(state, cost.source) && inst.cardId === cost.source.cardId && !inst.flipped && !hostOf(state, cost.source.card) && at?.zone === "leader" && at.owner === cost.source.master;
}
function fail(state: VmState, ev: GameEvent[], frame: ScriptFrame, message: string): "done" {
  state.lastChoice = null; state.lastMode = null;
  const at = state.programs.indexOf(frame); if (at >= 0) state.programs.splice(at, 1);
  log(ev, { type: "note", text: `Awaken cost failed: ${message}` }); return "done";
}
function liveLine(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, cost: AwakenAlternativeCost): boolean {
  const showing = skillsShowing(ctx, state, frame.card), skill = showing.skills.find(sk => sk.index === cost.line.skillIndex);
  return !!skill && canonical(skill) === canonical(cost.line.skill) && canonical(showing.scripts.bySkill[cost.line.skillIndex]) === canonical(cost.line.script)
    && !skillsNegated(state, frame.card) && !skillNegated(state, frame.card, skill.index, skill.kind)
    && !keywordSkillsNegated(state, frame.card) && !standingKindNegated(ctx, game, state, frame.card, skill.kind)
    && !standingKeywordsNegated(ctx, game, state, frame.card) && usesLeft(state, frame.master, frame.card, skill) !== 0;
}
function activationAvailable(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, cost: AwakenAlternativeCost): boolean {
  return sourceValid(state, cost) && liveLine(ctx, game, state, frame, cost)
    && !forbiddenBy(ctx, game, state, "activateSkill", { player: frame.master, card: frame.card, from: "leader", skillKind: cost.line.kind, keyword: "Awaken" })
    && !forbiddenBy(ctx, game, state, "flipLeaderBack", { player: frame.master, card: frame.card });
}
function finish(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, cost: AwakenAlternativeCost): "done" {
  if (!activationAvailable(ctx, game, state, frame, cost)) return fail(state, ev, frame, "the original Leader cannot complete this activation");
  const after = keywordAfterProgram(game, cost.line.keyword!, cost.line.skill).map(op => op.op === "flip" ? { ...op, target: { sel: { fromVar: SOURCE, area: "leader" as const } } } : op);
  const ops = [...keywordProgram(game, cost.line.keyword!, cost.line.skill), ...(cost.line.script!.ops ?? []), ...after];
  const moment = activationMoment(ctx, game, state, frame.master, cost.line), keywords = keywordActivationMoments(state, frame.master, cost.line);
  spendProhibitionUse(ctx, game, state, "activateSkill", { player: frame.master, card: frame.card, from: "leader", skillKind: cost.line.kind, keyword: "Awaken" });
  resolveActivation(ctx, game, state, ev, frame.master, cost.line, undefined, undefined, { ops, vars: { [SOURCE]: [frame.card], [`${SOURCE}@epoch`]: [`${frame.card}@${cost.source.epoch}`] } });
  const effect = state.programs.find(queued => queued.card === frame.card && queued.skillIndex === cost.line.skillIndex && queued.viaKeyword === "Awaken");
  if (!effect) rebuild("retain the paid alternative Awaken continuation");
  effect.awakenAlternativePaid = { version: 1, source: { card: frame.card, epoch: cost.source.epoch }, descriptor: structuredClone(cost.descriptor) };
  fire(ctx, game, state, moment); for (const event of keywords) fire(ctx, game, state, event);
  return "done";
}
export function stepAwakenAlternative(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = requireCost(frame);
  if (!activationAvailable(ctx, game, state, frame, cost)) return fail(state, ev, frame, "the Leader left its original occurrence");
  try {
    if (cost.stage === "route") {
      cost.routes ??= [...(freeHolds(ctx, game, state, cost.line, frame.master, cost.descriptor) ? ["free" as const] : []), ...(payableHosts(ctx, game, state, cost.line, frame.master, cost.descriptor).length ? ["under" as const] : [])];
      if (!cost.routes.length) throw new AutoPaymentFailed("neither printed alternative can be paid");
      if (cost.routes.length > 1 && frame.awaiting !== "awakenRoute") { frame.awaiting = "awakenRoute"; state.programs.unshift(frame); state.prompt = { kind: "chooseMode", player: frame.master, reason: "Choose how to Awaken", options: cost.routes.map(route => route === "free" ? "Use the life condition" : `Place ${cost.descriptor.count} cards from one matching card under your Leader`) }; return "wait"; }
      const route = cost.routes[cost.routes.length === 1 ? 0 : state.lastMode ?? -1];
      if (!route) throw new IllegalAction("choose an offered Awaken alternative");
      state.lastMode = null; delete frame.awaiting;
      if (route === "free") { if (!freeHolds(ctx, game, state, cost.line, frame.master, cost.descriptor)) throw new AutoPaymentFailed("the life condition no longer holds"); return finish(ctx, game, state, ev, frame, cost); }
      cost.stage = "host";
    }
    if (cost.stage === "host") {
      cost.hosts ??= payableHosts(ctx, game, state, cost.line, frame.master, cost.descriptor);
      if (!cost.hosts.length) throw new AutoPaymentFailed("no single matching pile can pay the cost");
      if (cost.hosts.length > 1 && frame.awaiting !== "awakenHost") { frame.awaiting = "awakenHost"; state.programs.unshift(frame); state.prompt = { kind: "chooseCards", player: frame.master, choice: { reason: "Choose one card whose pile will pay for Awaken", candidates: cost.hosts.map(host => host.card), min: 1, max: 1, continuation: HOST } }; return "wait"; }
      const host = cost.hosts.length === 1 ? cost.hosts[0] : state.lastChoice?.length === 1 ? cost.hosts.find(host => host.card === state.lastChoice![0]) : undefined;
      if (!host || !finishes(ctx, game, state, cost.line, frame.master, cost.descriptor, host)) throw new AutoPaymentFailed("the chosen original pile cannot pay the cost");
      cost.host = host; cost.stage = "payers"; state.lastChoice = null; state.lastMode = null; delete frame.awaiting;
      frame.ops = [payerChoice(cost.descriptor.count)]; frame.ip = 0; frame.vars = hostVars(state, host);
      cost.pool = state.cards[host.card].under.map(card => occurrence(state, card));
    }
    const host = cost.host!;
    if (!current(state, host) || !hostMatches(ctx, game, state, cost.line, frame.master, cost.descriptor, host.card)) throw new AutoPaymentFailed("the chosen host left its eligible occurrence");
    if (canonical(frame.ops) !== canonical([payerChoice(cost.descriptor.count)]) || canonical(frame.vars[HOST]) !== canonical([host.card]) || canonical(frame.vars[`${HOST}@epoch`]) !== canonical([`${host.card}@${host.epoch}`])) rebuild("rebuild the alternative Awaken selected-pile program");
    if (canonical(frame.vars[POOL]) !== canonical(cost.pool!.map(payer => payer.card)) || canonical(frame.vars[`${POOL}@epoch`]) !== canonical(cost.pool!.map(payer => `${payer.card}@${payer.epoch}`))) rebuild("rebuild the original alternative Awaken pile binding");
    const prior = frame.vars[PAYERS] ?? [];
    if (!Array.isArray(prior) || new Set(prior).size !== prior.length || prior.some(card => !cost.payers[card])) rebuild("rebuild the selected alternative Awaken payer receipts");
    if (Object.entries(cost.payers).some(([card, payer]) => !payer.paid && (!current(state, { card, epoch: payer.epoch }) || hostOf(state, card) !== host.card))) throw new AutoPaymentFailed("a selected payer left the original pile");
    if (!finishes(ctx, game, state, cost.line, frame.master, cost.descriptor, host, prior, cost.pool)) throw new AutoPaymentFailed("the bound pile can no longer complete the original cost");
    if (frame.awaiting === PAYERS) {
      if (!cost.offered) rebuild("rebuild the offered alternative Awaken payer occurrences");
      for (const card of state.lastChoice ?? []) {
        const offered = cost.offered.find(payer => payer.card === card);
        if (!offered || !current(state, offered) || hostOf(state, card) !== host.card) throw new AutoPaymentFailed("a chosen payer is no longer its offered pile occurrence");
      }
    }
    const strict = automaticPriceHost(ctx, game, state, ev, frame);
    const result = stepScript({ ...strict, ruleInterrupt: () => null,
      resolveSelector: (f, selector) => {
        const cards = strict.resolveSelector(f, selector);
        if (selector.area !== "under" || selector.fromVar !== POOL) return cards;
        const prefix = f.vars[PAYERS] ?? [];
        return cards.filter(card => hostOf(state, card) === host.card && (prefix.includes(card) || finishes(ctx, game, state, cost.line, frame.master, cost.descriptor, host, [...prefix, card], cost.pool)));
      },
    }, frame);
    for (const card of frame.vars[PAYERS] ?? []) cost.payers[card] ??= { epoch: state.cards[card]?.zoneEpoch ?? 0, paid: false };
    if (result === "wait") {
      if (state.prompt.kind === "chooseCards" && frame.awaiting === PAYERS) cost.offered = state.prompt.choice.candidates.map(card => occurrence(state, card));
      return "wait";
    }
    const selected = frame.vars[PAYERS] ?? [];
    if (selected.length !== cost.descriptor.count || !finishes(ctx, game, state, cost.line, frame.master, cost.descriptor, host, selected, cost.pool)) throw new AutoPaymentFailed("the exact selected cards cannot complete the cost");
    for (const card of selected) {
      const payer = cost.payers[card];
      if (!sourceValid(state, cost) || !current(state, host) || hostOf(state, card) !== host.card || !current(state, { card, epoch: payer.epoch })) throw new AutoPaymentFailed("an unpaid original pile member is no longer available");
      if (!strict.placeUnder(card, frame.card, frame)) throw new AutoPaymentFailed("an original payer was not placed under the Leader");
      payer.paid = true;
    }
    return finish(ctx, game, state, ev, frame, cost);
  } catch (error) { if (error instanceof AutoPaymentFailed) return fail(state, ev, frame, error.message); throw error; }
}

/** A newly loaded alternative may not resume an old unpriced/conjunctive save. */
export function requireAwakenAlternativeFrame(frame: ScriptFrame, source: Script | undefined): void {
  const paid = frame.awakenAlternativePaid;
  if (!paid && !source?.price?.awakenAlternative) return;
  if (!paid || paid.version !== 1 || !validOccurrence(paid.source) || paid.source.card !== frame.card || awakenAlternativeProblem(paid.descriptor)
    || (source?.price?.awakenAlternative && canonical(source.price.awakenAlternative) !== canonical(paid.descriptor))
    || canonical(frame.vars[SOURCE]) !== canonical([paid.source.card]) || canonical(frame.vars[`${SOURCE}@epoch`]) !== canonical([`${paid.source.card}@${paid.source.epoch}`])) rebuild("rebuild this saved alternative Awaken paid continuation");
}

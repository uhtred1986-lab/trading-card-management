import { standingWholeDescriptor, standingWholePrinted, standingWholeScript } from "./standing-negation-policy";
import { requireStandingNegationBounds } from "./standing-negation-bounds";
/** R477/R509 bounded native whole-negation observation and source validation. */
import type { EngineContext, PlayerId } from "../types";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { externallyNegatedSkill } from "./effects";
import { NotYet } from "./errors";
import type { Op, Script } from "./script";
import type { VmState } from "./state";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { validateStandingNegationObservation, standingNegationSourceKey } from "./standing-negation-history";
import type { StandingNegationCard as Card, StandingNegationSource as Source, StandingNegationObservation as Observation, StandingNegationHistory as History } from "./standing-negation-history";

export interface StandingNegationTransaction {
  /** Captured and validated before the mutation, never reconstructed after it. */
  previous: Observation;
  history: History;
  /** Actual arrivals supplied by the native transaction, not board traversal. */
  arrivals: Card[];
  /** Native pre-mutation provenance, including protected/noncandidate cards.
   * Serialized contents alone never authorize an arrival. A future writer
   * must bind this to the original transaction and its parent receipts. */
  before: Card[];
}
const refuse = (message: string): never => { throw new NotYet(message, "R477"); };
const same = (a: Card, b: Card) => canonical(a) === canonical(b);
function cardOf(source: Card): Card {
  const { card, cardId, epoch, hiddenCount, side, master } = source;
  return { card, cardId, epoch, hiddenCount, side, master };
}
const protectionOperation: Op = { op: "forbid", what: "beNegated", until: "game", target: { sel: { special: "self" } } };
const attackProtection: Op = { op: "permit", what: "attackUnnegatable", until: "game", target: { sel: { special: "self" } } };
function contains(ops: Op[], what: "whole" | "protection"): boolean {
  return ops.some(op => what === "whole" && op.op === "negateSkills" || what === "protection" && op.op === "forbid" && op.what === "beNegated"
    || op.op === "if" && (contains(op.then, what) || contains(op.else ?? [], what)));
}
function unconditional(script: Script): boolean {
  return !script.unsupported.length && script.kind === "permanent" && script.validity?.version === 1 && script.validity.sparking === null
    && !script.price?.condition && !script.paidAdmission;
}

/** This policy has no Leader, Unison or Field source semantics. Inactive areas
 * and ordinary buried cards are deliberately not discovered as active sources. */
export function requireStandingWholeSourceAreas(ctx: EngineContext, state: VmState): void {
  for (const p of ["p1", "p2"] as const) for (const zone of ["leader", "unison", "battle"] as const) {
    for (const id of state.sides[p].zones[zone] ?? []) {
      const instance = state.cards[id], def = instance && ctx.defs[instance.cardId];
      if (!instance || !def || instance.hidden) continue;
      const type = def.type.replace(/^Z-/, "");
      if (zone === "battle" && (type === "BATTLE" || type === "TOKEN")) continue;
      if (zone === "battle" ? type !== "EXTRA" : type !== (zone === "leader" ? "LEADER" : "UNISON")) continue;
      const side = instance.flipped ? "back" : "front", scripts = programsOf(ctx, def, side);
      for (const skill of parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null)) {
        if (skill.kind === "permanent" && (skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards."
          || standingWholeDescriptor(scripts.bySkill[skill.index]?.ops))) refuse("standing whole-negation from a non-Battle source");
      }
    }
  }
}

/** Capture exact native Battle occurrences before a synchronous mutation. */
export function standingNegationBattleOccurrences(ctx: EngineContext, state: VmState): Card[] {
  const board: Card[] = [];
  for (const master of ["p1", "p2"] as PlayerId[]) for (const id of state.sides[master].zones.battle ?? []) {
    const instance = state.cards[id], def = instance && ctx.defs[instance.cardId];
    if (!instance || !def) return refuse("rebuild standing-negation Battle occurrence definition");
    if (def.type !== "BATTLE" && def.type !== "Z-BATTLE" && def.type !== "TOKEN") continue;
    board.push({ card: id, cardId: instance.cardId, epoch: instance.zoneEpoch ?? 0, hiddenCount: instance.hiddenCount ?? 0, side: instance.flipped ? "back" : "front", master });
  }
  if (new Set(board.map(card => card.card)).size !== board.length) refuse("duplicate standing-negation Battle occurrence");
  return board;
}

/** Reads exact stored programs and raw printed skill identities, never statics,
 * attrsNow, keyword queries or a compiler. Existing unsupported records refuse;
 * only the exact reviewed whole-source envelope is admitted. */
export function observeStandingNegation(ctx: EngineContext, state: VmState, transaction: StandingNegationTransaction): Observation {
  requireStandingWholeSourceAreas(ctx, state);
  if (!transaction || typeof transaction !== "object" || !Array.isArray(transaction.arrivals) || !Array.isArray(transaction.before)) return refuse("rebuild standing-negation transaction witness");
  const validCard = (card: Card) => !!card && typeof card === "object" && !Array.isArray(card)
    && Object.keys(card).sort().join(",") === "card,cardId,epoch,hiddenCount,master,side"
    && typeof card.card === "string" && !!card.card && typeof card.cardId === "string" && !!card.cardId
    && Number.isSafeInteger(card.epoch) && card.epoch >= 0 && Number.isSafeInteger(card.hiddenCount) && card.hiddenCount >= 0
    && ["front", "back"].includes(card.side) && ["p1", "p2"].includes(card.master);
  for (const cards of [transaction.before, transaction.arrivals]) {
    if (cards.some(card => !validCard(card)) || new Set(cards.map(card => card.card)).size !== cards.length) return refuse("rebuild standing-negation transaction occurrence witness");
  }
  validateStandingNegationObservation(transaction.history, transaction.previous);
  for (const candidate of transaction.previous.candidates) {
    if (![cardOf(candidate.source), ...candidate.targets].every(card => transaction.before.some(prior => same(prior, card)))) return refuse("standing-negation prior observation disagrees with transaction Battle snapshot");
  }
  if (transaction.arrivals.some(arrival => transaction.before.some(prior => same(prior, arrival)))) return refuse("standing-negation transaction cannot mark an existing occurrence as arriving");
  const board = standingNegationBattleOccurrences(ctx, state);
  if (transaction.arrivals.some(arrival => !board.some(card => same(card, arrival))) || new Set(transaction.arrivals.map(card => card.card)).size !== transaction.arrivals.length) refuse("rebuild standing-negation transaction arrivals");
  const lines = board.flatMap(occurrence => {
    const instance = state.cards[occurrence.card], def = ctx.defs[occurrence.cardId];
    if (instance.hidden) return [];
    const scripts = programsOf(ctx, def, occurrence.side);
    return parseSkills((occurrence.side === "back" ? def.back?.skill : def.skill) ?? null)
      .filter(skill => skill.kind === "permanent").map(skill => ({ occurrence, skill, script: scripts.bySkill[skill.index] }));
  });
  const sources: { source: Source; enabled: boolean }[] = [];
  for (const { occurrence, skill, script } of lines) {
    // Exact reviewed wording is a missing-record refusal guard only. Execution
    // still requires the exact complete stored operation below, never text.
    const intent = skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards.";
    if (!intent && !(script && contains(script.ops, "whole"))) continue;
    if (script && !standingWholeDescriptor(script.ops)) return refuse("observe only all-other-Battle whole-negation policy");
    if (!script || !standingWholePrinted(skill) || !standingWholeScript(script)) return refuse("observe only complete unconditional standing-negation and self-protection records");
    sources.push({ source: { ...occurrence, skillIndex: skill.index, skillIdentity: canonical(script) }, enabled: !externallyNegatedSkill(state, occurrence.card, skill.index, skill.kind) });
  }
  for (const effect of state.effects) {
    if (effect.kind !== "copiedSkills" || !board.some(card => card.card === effect.target && !state.cards[card.card].hidden)) continue;
    const copy = effect.copied;
    if (!copy || !["front", "back"].includes(copy.side) || !Array.isArray(copy.skills) || copy.skills.some(index => !Number.isSafeInteger(index) || index < 0)
      || (copy.quoted !== undefined && typeof copy.quoted !== "boolean")) return refuse("observe copied standing negators with reviewed grant identities");
    const def = ctx.defs[copy.cardId];
    if (!def || copy.side === "back" && !def.back) return refuse("rebuild copied standing-negation source definition and side");
    const printed = parseSkills((copy.side === "back" ? def.back?.skill : def.skill) ?? null);
    const scripts = programsOf(ctx, def, copy.side);
    for (const index of copy.skills) {
      const original = printed.find(skill => skill.index === index);
      if (!original || !!original.granted !== !!copy.quoted) return refuse("rebuild copied standing-negation source skill identity");
      const skill = copy.quoted ? original.granted!.skill : original;
      const intent = skill.kind === "permanent" && skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards.";
      if (skill.kind === "permanent" && (intent || contains(scripts.bySkill[index]?.ops ?? [], "whole"))) refuse("observe copied standing negators with reviewed grant identities");
    }
  }
  // Unaffected boards need no protection analysis or new history requirement.
  // Prior history was already validated, so removal of the final source still
  // produces an explicit empty observation for the mutation owner to settle.
  if (!sources.length) return { version: 1, policy: "otherBattleWholeV1", candidates: [] };
  requireStandingNegationBounds(ctx, state, undefined, true);
  if (state.effects.some(effect => effect.kind === "forbid" && effect.forbid?.what === "beNegated")) refuse("observe timed beNegated protection with reviewed source qualification");
  for (const instance of Object.values(state.cards)) {
    if (board.some(card => card.card === instance.id)) continue;
    const def = ctx.defs[instance.cardId];
    if (!def) continue;
    const scripts = programsOf(ctx, def, instance.flipped ? "back" : "front");
    for (const script of Object.values(scripts.bySkill)) if (contains(script.ops, "protection")
      && canonical(script.ops) !== canonical([protectionOperation]) && canonical(script.ops) !== canonical([attackProtection, protectionOperation])) refuse("observe external-area beNegated protection with reviewed validity");
  }
  if (state.effects.some(effect => effect.kind === "copiedSkills" && board.some(card => card.card === effect.target && !state.cards[card.card].hidden))) refuse("observe copied standing negators or protectors with reviewed grant identities");
  const protectors = new Set<string>();
  for (const { occurrence, skill, script } of lines) {
    if (!script || script.unsupported.length) return refuse("observe only complete unconditional standing-negation and self-protection records");
    if (!contains(script.ops, "protection")) continue;
    if (!unconditional(script) || skill.bond !== null || skill.sparking !== null || skill.granted) refuse("observe only complete unconditional standing-negation and self-protection records");
    if (canonical(script.ops) !== canonical([protectionOperation]) && canonical(script.ops) !== canonical([attackProtection, protectionOperation])) refuse("observe only unconditional self beNegated protection");
    if (!externallyNegatedSkill(state, occurrence.card, skill.index, skill.kind)) protectors.add(occurrence.card);
  }
  const candidateKeys = new Map(sources.map(candidate => [standingNegationSourceKey(candidate.source), candidate]));
  for (const target of board.filter(card => protectors.has(card.card))) {
    const prior = transaction.history.suppressed.filter(edge => same(cardOf(edge.target), target));
    if (transaction.arrivals.some(arrival => same(arrival, target))) {
      if (prior.length) refuse("fresh standing-negation arrival reuses a suppressed occurrence");
      continue;
    }
    if (!prior.length) continue;
    if (prior.some(edge => candidateKeys.get(edge.source)?.enabled)) protectors.delete(target.card);
    else refuse("review self-protection reactivation when the original suppressor ends");
  }
  return { version: 1, policy: "otherBattleWholeV1", candidates: sources.map(candidate => ({ ...candidate,
    targets: board.filter(target => target.card !== candidate.source.card && !protectors.has(target.card)),
  })) };
}

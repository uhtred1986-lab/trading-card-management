/** #899: bounded executable facts for a legal offer, never a second effect interpreter.
 * Unknown operations/predicates invalidate the effect summary. In particular, raw
 * hidden-zone conditions are refused before evaluation, even if their answer is false.
 */
import type { BattleActivationSummary, CounterResponseSummary, EngineContext, LegalAction, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets/types";
import type { CardFilter } from "../text/filters";
import type { Cond, Op, Ref, Script, ScriptFrame, Selector } from "./script";
import type { VmState } from "./state";
import { counterAlt, openWindowOf, selectedCounterSkill } from "./battle";
import { condHolds, resolveRef, resolveSelector } from "./program";
import { modifyAttrAs, replaceAs } from "./script-schema";
import { skillsShowing } from "./triggers";
import { findCard } from "./zones";

const FILTER_KEYS = new Set(["colors", "notColors", "monoColor", "multiColor", "characters", "notCharacters", "charactersIncluding", "notCharactersIncluding", "charactersAll", "namesAll", "traits", "notTraits", "characterOrTrait", "onlyCharacters", "names", "notNames", "namesIncluding", "notNamesIncluding", "type", "notType", "faceUp", "token", "notToken", "costMin", "costMax", "powerMin", "powerMax", "originalPowerMin", "originalPowerMax", "comboPowerMin", "comboPowerMax", "markersMin", "markersMax", "specifiedCostMin", "specifiedCostMax", "specifiedCostNone", "z"]);
const SELECTOR_KEYS = new Set(["side", "area", "filter", "special", "mode", "count", "upTo", "minCount", "ignoreBarrier", "notSelf"]);
const active = (v: unknown) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0);
const only = (v: object, keys: Set<string>) => Object.entries(v).every(([k, x]) => !active(x) || keys.has(k));
const number = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
function safeFilter(filter?: CardFilter): boolean { return !filter || only(filter, FILTER_KEYS); }
function safeSelector(sel: Selector): boolean {
  return only(sel, SELECTOR_KEYS) && (sel.side === undefined || sel.side === "you")
    && (sel.special === undefined || ["self", "leader", "attacker", "guard"].includes(sel.special))
    && (sel.area === undefined || ["battle", "leader", "energy"].includes(sel.area))
    && (sel.count === undefined || Number.isSafeInteger(sel.count) && sel.count >= 0)
    && safeFilter(sel.filter);
}
/** These predicates depend only on public turn/Life/Leader facts, not hidden identities. */
function safeCondition(c: Cond, depth = 0): boolean {
  if (depth > 8) return false;
  switch (c.kind) {
    case "isTurnPlayer": case "life": case "lifeVsOpponent": case "leaderColor": case "leaderFlipped": return true;
    case "leaderMatches": return safeFilter(c.filter) && !Object.entries(c.filter).some(([k, v]) => active(v) && /power|markers/i.test(k));
    case "any": case "all": return c.conds.length <= 16 && c.conds.every(x => safeCondition(x, depth + 1));
    case "not": return safeCondition(c.cond, depth + 1);
    default: return false;
  }
}
interface Facts { battle: number; turn: number; drawnFirst: number; negatesAttack: boolean; started: boolean; hasPower: boolean; powerVars: Set<string> }
function summarize(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, ownBattle: string | null): Facts | null {
  const facts: Facts = { battle: 0, turn: 0, drawnFirst: 0, negatesAttack: false, started: false, hasPower: false, powerVars: new Set() };
  let work = 0;
  const targets = (ref: Ref): string[] | null => {
    if ("var" in ref) return ref.minus || !Object.hasOwn(frame.vars, ref.var) ? null : frame.vars[ref.var];
    return safeSelector(ref.sel) ? resolveRef(ctx, game, state, frame, ref) : null;
  };
  const choose = (op: Extract<Op, { op: "choose" }>): boolean => {
    if (!only(op, new Set(["op", "sel", "as", "reason", "chooser"])) || op.chooser && op.chooser !== "you" || !safeSelector(op.sel)) return false;
    if (Object.hasOwn(frame.vars, op.as)) return false;
    const ids = resolveSelector(ctx, game, state, frame, op.sel);
    // A possible selection, not an actual execution: retain the candidate domain.
    frame.vars[op.as] = (op.sel.count ?? 1) > 0 ? ids : [];
    facts.started = true;
    return true;
  };
  const walk = (ops: readonly Op[], depth = 0): boolean => {
    if (depth > 8) return false;
    for (const raw of ops) {
      if (++work > 128) return false;
      const op = replaceAs(modifyAttrAs(raw));
      switch (op.op) {
        case "if":
          if (!safeCondition(op.cond)) return false;
          if (!walk(condHolds(ctx, game, state, frame, op.cond) ? op.then : op.else ?? [], depth + 1)) return false;
          break;
        case "draw":
          if (!number(op.n) || !Number.isSafeInteger(op.n) || op.side && op.side !== "you") return false;
          if (!facts.started) facts.drawnFirst += op.n;
          break;
        case "choose": if (!choose(op)) return false; break;
        case "chooseMode": {
          // The existing Leader-or-Battle selector is a choice of domains for
          // the same variable. Other modal effects are outside this summary.
          if (op.chooser && op.chooser !== "you" || !op.modes.length || op.modes.length > 8) return false;
          const modes = op.modes.map(m => m.ops.length === 1 && m.ops[0].op === "choose" ? m.ops[0] : null);
          if (modes.some(m => !m || m.as !== modes[0]?.as)) return false;
          const name = modes[0]!.as, candidates: string[] = [];
          for (const mode of modes) {
            if (!choose(mode!)) return false;
            candidates.push(...frame.vars[name]); delete frame.vars[name];
          }
          frame.vars[name] = [...new Set(candidates)];
          break;
        }
        case "power": {
          if (!number(op.amount) || (op.until !== "battle" && op.until !== "turn")) return false;
          const ids = targets(op.target); if (!ids) return false;
          facts.hasPower = true; facts.started = true;
          if (ownBattle && ids.includes(ownBattle)) { facts.battle += op.amount; if (op.until === "turn") facts.turn += op.amount; if ("var" in op.target && op.amount > 0) facts.powerVars.add(op.target.var); }
          break;
        }
        case "switchMode": {
          const ids = targets(op.target);
          // Niagara's positive own-energy ready effect cannot remove a power
          // benefit. Resting/changing a battle card is deliberately unsupported.
          if (!ids || op.mode !== "active" || ids.some(id => { const at = findCard(state, id); return at?.owner !== frame.master || at.zone !== "energy"; })) return false;
          facts.started = true; break;
        }
        case "negateAttack": facts.negatesAttack = true; facts.started = true; break;
        case "negateCounter": facts.started = true; break;
        default: return false;
      }
    }
    return true;
  };
  return walk(frame.ops) && number(facts.battle) && number(facts.turn) && number(facts.drawnFirst) ? facts : null;
}
function readable(script: Script | undefined): script is Script { return !!script && Array.isArray(script.ops) && Array.isArray(script.unsupported) && script.unsupported.length === 0; }

/** Projection is called only for the actor's already offered moves. No scripts or instance IDs escape. */
export function defensiveSummary(ctx: EngineContext, game: GameDefinition, state: VmState, legal: LegalAction, seat: PlayerId): Pick<LegalAction, "battleActivation" | "counterResponse"> {
  const action = legal.action;
  if (action.player !== seat || (action.type !== "activate" && action.type !== "counter") || !action.card) return {};
  const ownBattle = state.battle ? [state.battle.attacker, state.battle.guard].find(id => findCard(state, id)?.owner === seat) ?? null : null;
  const showing = skillsShowing(ctx, state, action.card);
  if (action.type === "activate") {
    if (!ownBattle) return {};
    const script = showing.scripts.bySkill[action.skill];
    if (!readable(script) || (script.kind !== "activate:battle" && script.kind !== "activate:main/battle")) return {};
    const facts = summarize(ctx, game, state, { ops: script.ops, ip: 0, vars: {}, card: action.card, master: seat, skillIndex: action.skill }, ownBattle);
    if (!facts || !facts.hasPower) return {};
    const battleActivation: BattleActivationSummary = { version: 1, skillIndex: action.skill, timing: script.kind, power: { battle: facts.battle, turn: facts.turn }, drawnFirst: facts.drawnFirst };
    return { battleActivation };
  }
  if (state.prompt.kind !== "counter") return {};
  const skill = selectedCounterSkill(ctx, state, action.card, openWindowOf(state.prompt.window), action.skill);
  if (!skill) return {};
  const script = showing.scripts.bySkill[skill.index], kind = script?.kind;
  if (!["counter:attack", "counter:battle card attack", "counter:counter", "counter:play"].includes(kind ?? "")) return {};
  const alt = action.alt ? counterAlt(ctx, game, state, action.card, seat) : null;
  const facts = readable(script) ? summarize(ctx, game, state, { ops: script.ops, ip: 0, vars: {}, card: action.card, master: seat, skillIndex: skill.index }, ownBattle) : null;
  const counterResponse: CounterResponseSummary = { version: 1, skillIndex: skill.index, kind: kind as CounterResponseSummary["kind"], negatesAttack: facts?.negatesAttack ?? null, alternativePrice: !action.alt ? "none" : alt?.pay === "none" ? "free" : "other" };
  return { counterResponse };
}

/** The awaiting choice/mode can realize a known positive boost on the own battler.
 * No question label is interpreted. The full remaining bounded path must be known.
 */
export function battlePowerChoices(ctx: EngineContext, game: GameDefinition, state: VmState, seat: PlayerId): { target?: string; modes?: number[] } {
  if (!state.battle || (state.prompt.kind !== "chooseCards" && state.prompt.kind !== "chooseMode") || state.prompt.player !== seat) return {};
  const frame = state.programs[0];
  if (!frame || frame.master !== seat || frame.skillIndex === undefined || frame.awaiting === undefined) return {};
  const script = skillsShowing(ctx, state, frame.card).scripts.bySkill[frame.skillIndex];
  if (!readable(script) || (script.kind !== "activate:battle" && script.kind !== "activate:main/battle")) return {};
  const target = [state.battle.attacker, state.battle.guard].find(id => findCard(state, id)?.owner === seat);
  if (!target) return {};
  // A captured suffix alone cannot prove how an earlier variable/condition
  // was obtained. Require a bounded original path, then allow only bindings
  // established by the remaining visible choice; never trust saved IDs.
  if (!summarize(ctx, game, state, { ops: script.ops, ip: 0, vars: {}, card: frame.card, master: seat, skillIndex: frame.skillIndex }, target)) return {};
  const op = frame.ops[frame.ip];
  const suffix = (ops: Op[]) => summarize(ctx, game, state, { ...frame, ops, ip: 0, vars: {} }, target);
  if (state.prompt.kind === "chooseCards" && op?.op === "choose" && frame.awaiting === op.as && state.prompt.choice.candidates.includes(target)) {
    const facts = suffix(frame.ops.slice(frame.ip));
    return facts && facts.battle > 0 && facts.powerVars.has(op.as) ? { target } : {};
  }
  if (state.prompt.kind === "chooseMode" && op?.op === "chooseMode" && op.modes.length <= 8) {
    const modes = op.modes.flatMap((mode, index) => {
      const facts = suffix([...mode.ops, ...frame.ops.slice(frame.ip + 1)]);
      return facts && facts.battle > 0 ? [index] : [];
    });
    return modes.length ? { target, modes } : {};
  }
  return {};
}

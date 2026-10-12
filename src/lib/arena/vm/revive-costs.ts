/** 22-34-3: optional original-colour hand payment precedes the live Auto price. */
import type { EngineContext, GameEvent, Skill } from "../types";
import type { GameDefinition, KeywordDef } from "../rulesets";
import { automaticPriceHost, finishAutomaticCost, prepareAutomaticCost } from "./auto-costs";
import { IllegalAction } from "./common";
import { log } from "./events";
import { revivePrograms } from "./keyword-do";
import { stepScript, type Op, type Script, type ScriptFrame } from "./script";
import type { VmState } from "./state";

export interface ReviveCost {
  skill: Skill;
  script: Script;
  effect: Op[];
  variable: string;
  paid: string[];
}

export function queueReviveCost(game: GameDefinition, state: VmState, frame: ScriptFrame, keyword: KeywordDef, skill: Skill, script: Script): void {
  const program = revivePrograms(game, keyword, skill);
  state.programs.unshift({ ...frame, ops: program.payment, reviveCost: { skill, script, effect: program.effect, variable: program.variable, paid: [] } });
}

/** Unlike Aegis, an empty or incomplete optional selection spends nothing.
 * Once the covered set is accepted, retain each actual cost on failure. */
export function stepReviveCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.reviveCost!;
  const host = automaticPriceHost(ctx, game, state, ev);
  const result = stepScript({
    ...host,
    resolveSelector: (f, sel) => {
      const ids = host.resolveSelector(f, sel);
      const op = f.ops[f.ip];
      if (op?.op === "choose" && op.sel === sel && f.awaiting === op.as
        && [...(f.vars[op.as] ?? []), ...(state.lastChoice ?? [])].some((id) => !ids.includes(id))) {
        throw new IllegalAction("that Revive color payment is no longer available");
      }
      return ids;
    },
    move: (id, to, owner, opts) => {
      if (host.areaOf(id) !== "hand") throw new IllegalAction("a Revive color payment must still be in hand");
      const actual = host.move(id, to, owner, opts);
      cost.paid.push(id);
      return actual;
    },
  }, frame);
  if (result === "wait") return result;
  const selected = frame.vars[cost.variable] ?? [];
  if (!selected.length || selected.length !== cost.paid.length || selected.some((id) => !cost.paid.includes(id))) return "done";

  // The hand departure may change modifiers, alternative payers or action
  // price targets. Determine all supported additional costs on this board.
  if (cost.script.price?.condition && !host.condHolds(frame, cost.script.price.condition)) {
    log(ev, { type: "note", text: "Revive activation failed: its additional skill cost condition does not hold" });
    return "done";
  }
  const effect = { ...frame, ops: cost.effect, ip: 0 };
  delete effect.reviveCost;
  delete effect.awaiting;
  delete effect.moveLoop;
  const autoCost = prepareAutomaticCost(ctx, game, state, effect, cost.skill, cost.script);
  if (!autoCost.choices.length) {
    log(ev, { type: "note", text: "Revive activation failed: its additional skill cost is unaffordable" });
    return "done";
  }
  effect.autoCost = autoCost;
  const priced = Object.values(cost.skill.energyCost).some((n) => n > 0) || cost.skill.energyEither.length > 0
    || cost.skill.markerCost != null || cost.skill.burst != null || cost.skill.spiritBoost != null
    || cost.script.price?.ops?.length || cost.script.price?.x;
  if (priced) state.programs.unshift({ ...effect, ops: cost.script.price?.ops ?? [] });
  else finishAutomaticCost(ctx, game, state, ev, effect);
  return "done";
}

/** R480: settle supported chargeLimit mode bodies before movement/cleanup.
 * Optional entry effects must finish before this read-only observation.
 */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { hookBodiesFor } from "./program";
import { NotYet } from "./errors";

export interface EnergyEntryMode {
  restRequired: boolean;
  mode: "active" | "rest";
}

export function captureEnergyEntryMode(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, explicit?: "active" | "rest"): EnergyEntryMode {
  let restRequired = false;
  for (const body of hookBodiesFor(ctx, game, state, card, "chargeLimit")) {
    // Only the shipped immediate self Rest modifier has a placement-time
    // interpretation. Refuse a changed body before moving, never silently
    // discard instructions or execute a generic effect after observation.
    if (!body.ops.length) throw new NotYet("an empty chargeLimit entry hook", "R480");
    for (const op of body.ops) {
      if (op.op !== "modifyAttr" || op.attr !== "mode" || op.mode !== "rest" ||
        Object.keys(op).some(key => !["op", "attr", "mode", "target"].includes(key)) ||
        op.target && (!("sel" in op.target) || Object.keys(op.target).length !== 1 || Object.keys(op.target.sel).length !== 1 || op.target.sel.special !== "self")) {
        throw new NotYet("this chargeLimit entry hook needs placement-time interpretation", "R480");
      }
      restRequired = true;
    }
  }
  // Explicit Rest remains authoritative; an Active request cannot undo a Rest hook.
  return { restRequired, mode: restRequired || explicit === "rest" ? "rest" : "active" };
}

/** R476 before-mutation exclusions for an optional entry owned by a script move. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import type { ScriptFrame, Op, Ref, Selector } from "./script";
import type { ScriptHost } from "./script-host";
import { findCard } from "./zones";
import { NotYet } from "./errors";
import { energyEntrySource, possibleEnergyEntrySource } from "./energy-entry-source";

type Pool = readonly string[] | null;
interface CostView { vars: Map<string, Pool>; changed: boolean; skillsChanged: boolean }
const union = (a: Pool, b: Pool): Pool => a === null || b === null ? null : [...new Set([...a, ...b])];

/** Analyze only possible original targets, without executing a cost or choosing
 * a payer. A null pool means a later mutation/binding prevents an exact bound.
 * Existing bound identities remain usable after an earlier ordinary move. */
export function guardCostEnergyEntry(ctx: EngineContext, state: VmState, h: ScriptHost, frame: ScriptFrame): void {
  const remaining = frame.ops.slice(frame.ip);
  const hasEnergyMove = (ops: readonly Op[]): boolean => ops.some(op =>
    op.op === "moveTo" && op.to === "energy"
    || op.op === "if" && (hasEnergyMove(op.then) || hasEnergyMove(op.else ?? []))
    || op.op === "may" && hasEnergyMove(op.ops)
    || op.op === "chooseMode" && op.modes.some(mode => hasEnergyMove(mode.ops)));
  if (!hasEnergyMove(remaining)) return;
  const possible = (ids: readonly string[]) => ids.some(id => possibleEnergyEntrySource(ctx, state, id));
  const anyPossible = () => possible(Object.keys(state.cards));
  const selectorPool = (sel: Selector, view: CostView): Pool => {
    if (sel.special === "self" && Object.keys(sel).length === 1) return [frame.card];
    if (view.changed || sel.fromVar && !view.vars.has(sel.fromVar)) return null;
    return h.resolveSelector(frame, sel);
  };
  const refPool = (ref: Ref, view: CostView): Pool => "var" in ref
    ? view.vars.get(ref.var) ?? null : selectorPool(ref.sel, view);
  const branch = (ops: readonly Op[], view: CostView): CostView => {
    const next: CostView = { vars: new Map(view.vars), changed: view.changed, skillsChanged: view.skillsChanged };
    walk(ops, next);
    return next;
  };
  const merge = (view: CostView, branches: CostView[]) => {
    for (const name of new Set(branches.flatMap(part => [...part.vars.keys()]))) {
      view.vars.set(name, branches.reduce<Pool>((pool, part) => union(pool, part.vars.get(name) ?? null), []));
    }
    view.changed = branches.some(part => part.changed);
    view.skillsChanged = branches.some(part => part.skillsChanged);
  };
  const walk = (ops: readonly Op[], view: CostView): void => {
    for (const op of ops) {
      if (op.op === "choose") {
        const pool = selectorPool(op.sel, view);
        for (const name of [op.as, `${op.as}Outside`, `${op.as}First`, `${op.as}Rest`]) view.vars.set(name, pool);
        view.changed = true;
        continue;
      }
      if (op.op === "if") { merge(view, [branch(op.then, view), branch(op.else ?? [], view)]); continue; }
      if (op.op === "may") { merge(view, [branch(op.ops, view), branch([], view)]); continue; }
      if (op.op === "chooseMode") { merge(view, op.modes.map(mode => branch(mode.ops, view))); continue; }
      if (op.op === "moveTo" && op.to === "energy") {
        const pool = refPool(op.target, view);
        if (pool === null || view.skillsChanged ? anyPossible() : possible(pool)) throw new NotYet("optional Energy entry inside a payment or proof program", "R476");
      }
      if (["copySkills", "invokeSkill", "printedEffect", "payActionPrice"].includes(op.op)) view.skillsChanged = true;
      if ("as" in op && typeof op.as === "string") {
        for (const name of [op.as, `${op.as}Outside`, `${op.as}First`, `${op.as}Rest`]) view.vars.set(name, null);
      }
      // The bounded interpreter does not predict card/area changes. A selector
      // evaluated after any instruction must therefore retain an unknown pool.
      // Already bound targets and self remain exact physical identities.
      view.changed = true;
    }
  };
  walk(remaining, { vars: new Map(Object.entries(frame.vars)), changed: false, skillsChanged: false });
}

/** Batch preflight occurs before even an ordinary first card can be moved. */
export function guardEnergyEntryBatch(ctx: EngineContext, state: VmState, h: ScriptHost, frame: ScriptFrame, ids: string[]): void {
  const op=frame.ops[frame.ip];
  if(op?.op!=="moveTo" || op.to!=="energy")return;
  if(ids.some(id=>h.isHidden(id)&&possibleEnergyEntrySource(ctx,state,id)))throw new NotYet("Hidden optional Energy entry", "R476");
  const sources=ids.filter(id=>energyEntrySource(ctx,state,id));
  if(!sources.length)return;
  if(ids.length!==1 || sources.length!==1)throw new NotYet("owner ordering for a multi-card Energy entry", "R476");
  const id=sources[0],area=h.areaOf(id),owner=op.owner===undefined||op.owner==="you"?frame.master:frame.master==="p1"?"p2":"p1";
  const destination=op.owner===undefined?h.ownerOf(id):owner,location=findCard(state,id);
  if((!["hand","deck","warp","zEnergy"].includes(area??"")) || !location || location.zone!==area || location.owner!==destination || state.cards[id]?.under.length || h.defOf(id).type!=="BATTLE" || h.isHidden(id) || h.ownerOf(id)!==destination || h.masterOf(id)!==destination || op.owner==="both")throw new NotYet("this optional Energy entry origin or controller", "R476");
  if(op.cause==="cost" || frame.saveVarsAs || frame.keywordPrice || frame.keywordCost || frame.counterCost || frame.autoCost)throw new NotYet("optional Energy entry inside a payment program", "R476");
  if(h.replacementsFor(id,frame.declaredCharge?"charge":op.cause??"effect",{actor:frame.declaredCharge?undefined:frame.master,requestedTo:"energy"}).length)throw new NotYet("optional Energy entry with an incoming movement replacement", "R476");
}

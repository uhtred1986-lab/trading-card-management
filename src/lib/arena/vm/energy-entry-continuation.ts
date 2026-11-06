import { bindEnergyEntryPayers, offerEnergyEntryPayers, requireEnergyEntryPayers, type EnergyEntryPayers } from "./energy-entry-payers";
/** R476 suspended ordinary effect owned by one original Energy movement. */
import type { EnergyEntryExhaustPolicy } from "./energy-entry-policy";
import { energyEntryPolicyProblem } from "./energy-entry-policy";
import { energyEntryEffect, energyEntryPayersCompleted, ENERGY_ENTRY_SLOTS } from "./energy-entry-effect";
import { captureEnergyEntryWitness, requireEnergyEntryWitness, type EnergyEntryWitness } from "./energy-entry-witness";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";
import { stepScript, type ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";

export interface EnergyEntryContinuation {
  version: 1;
  policy: EnergyEntryExhaustPolicy;
  witness: EnergyEntryWitness;
  skillIndex: number;
  child: ScriptFrame;
  payers: EnergyEntryPayers;
  completed?: boolean;
}
const fail = (): never => { throw new NotYet("rebuild this saved Energy entry continuation", "R476"); };

export function createEnergyEntryContinuation(h: ScriptHost, parent: ScriptFrame, incoming: string, skillIndex: number, policy: EnergyEntryExhaustPolicy, destination: EnergyEntryWitness["destination"]): EnergyEntryContinuation {
  if (energyEntryPolicyProblem(policy) || !Number.isSafeInteger(skillIndex) || skillIndex < 0 || parent.energyEntry) fail();
  const owner = (parent.energyEntrySequence ?? 0) + 1;
  const witness = captureEnergyEntryWitness(h, owner, parent, incoming, destination);
  parent.energyEntrySequence = owner;
  return { version: 1, policy: structuredClone(policy), witness, skillIndex, payers: {},
    child: { card: incoming, master: destination.player, skillIndex, ops: energyEntryEffect(policy), ip: 0, vars: {} } };
}

export function requireEnergyEntryContinuation(h: ScriptHost, parent: ScriptFrame, pending: EnergyEntryContinuation, skillIndex: number, policy: EnergyEntryExhaustPolicy, destination: EnergyEntryWitness["destination"]): void {
  if (!pending || pending.version !== 1 || energyEntryPolicyProblem(pending.policy) || canonical(pending.policy) !== canonical(policy) ||
    pending.skillIndex !== skillIndex || pending.completed !== undefined && pending.completed !== true) fail();
  requireEnergyEntryWitness(h, parent.energyEntrySequence!, parent, pending.witness, destination);
  const child = pending.child, original = energyEntryEffect(policy), first = original[0];
  if (!child || child.card !== pending.witness.incoming.card || child.master !== destination.player || child.skillIndex !== skillIndex ||
    !Number.isSafeInteger(child.ip) || child.ip < 0 || !Array.isArray(child.ops) || child.ip > child.ops.length ||
    (canonical(child.ops) !== canonical(original) && (first.op !== "may" || canonical(child.ops) !== canonical(first.ops))) ||
    pending.completed && child.ip !== child.ops.length) fail();
  requireDistinctDropPayers(h, pending);
  requireNoPayerReplacement(child);
  requireEnergyEntryPayers(h,child,pending.payers);
}

/** R508 preserves the full printed candidate pool. Selecting the incoming Drop
 * occurrence remains an unresolved ruling, not a silently forbidden candidate.
 * Check saved answers before consumption and forced selections before any move. */
function requireDistinctDropPayers(h: ScriptHost, pending: EnergyEntryContinuation): void {
  const child = pending.child;
  if (!child || !child.vars || typeof child.vars !== "object" || Array.isArray(child.vars)) fail();
  if (pending.witness.incoming.area !== "drop") return;
  const incoming = pending.witness.incoming.card;
  const selected = ENERGY_ENTRY_SLOTS.some(name =>
    Array.isArray(child.vars[name]) && child.vars[name].includes(incoming) ||
    pending.payers?.[name]?.selected?.card === incoming);
  const answered = child.awaiting !== undefined &&
    (ENERGY_ENTRY_SLOTS as readonly string[]).includes(child.awaiting) && h.lastChoice()?.includes(incoming);
  if (selected || answered) throw new NotYet("incoming Drop card Energy-entry payment ruling", "R476");
}

/** A serialized replacement continuation cannot bypass the live-route preflight. */
function requireNoPayerReplacement(child: ScriptFrame): void {
  if (child.awaiting === "replaceMove" || child.replacementMove || child.replacementAuto || child.replacing || child.moveLoop?.choices?.length)
    throw new NotYet("optional Energy-entry payer replacement continuation", "R476");
}

/** Child choices return to the original parent, including after reload.
 * Payer replacement/interrupt continuations remain unadmitted. */
export function runEnergyEntryContinuation(parentHost: ScriptHost, childHost: ScriptHost, parent: ScriptFrame, pending: EnergyEntryContinuation): "suspended" | "completed" {
  requireDistinctDropPayers(childHost, pending);
  requireNoPayerReplacement(pending.child);
  if (pending.completed) return "completed";
  let transferred = false;
  requireEnergyEntryPayers(childHost,pending.child,pending.payers);
  const bind = () => {
    requireDistinctDropPayers(childHost, pending);
    bindEnergyEntryPayers(childHost,pending.child,pending.payers);
  };
  const guardPayerRoutes = () => {
    requireDistinctDropPayers(childHost, pending);
    // Check both bound payers before the first one can move. In particular a
    // second-payer substitute must not strand a paid first card or a stale
    // chooser prompt. These are ordinary effects, never cost-host moves.
    for (const name of ENERGY_ENTRY_SLOTS) for (const id of pending.child.vars[name] ?? []) {
      if (childHost.areaOf(id) === "drop" && childHost.replacementsFor(id,"effect",{actor:pending.child.master,requestedTo:"warp"}).length) throw new NotYet("optional Energy-entry payer replacement route", "R476");
    }
  };
  guardPayerRoutes();
  const host: ScriptHost = { ...childHost,
    resolveSelector: (frame,sel) => { const ids=childHost.resolveSelector(frame,sel);offerEnergyEntryPayers(childHost,frame,pending.payers,ids);return ids; },
    ask: prompt => { bind();childHost.ask(prompt); },
    replacementsFor: (id,reason,opts) => { guardPayerRoutes();return childHost.replacementsFor(id,reason,opts); },
    move: (id,to,owner,opts) => {
      bind();
      const result=childHost.move(id,to,owner,opts);
      for(const choice of Object.values(pending.payers))if(choice.selected?.card===id)choice.attempted=true;
      return result;
    },
    resume: () => { transferred = true; parentHost.resume(parent); },
    interrupt: () => { throw new NotYet("optional Energy-entry child interrupt continuation", "R476"); },
  };
  const result = stepScript(host, pending.child);
  if (result === "wait" || transferred) return "suspended";
  bind();
  if (pending.child.ip !== pending.child.ops.length) fail();
  pending.completed = true;
  return "completed";
}

export function energyEntryNegationEarned(pending: EnergyEntryContinuation): boolean {
  if (!pending.completed) fail();
  return energyEntryPayersCompleted(pending.child);
}

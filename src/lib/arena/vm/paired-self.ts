import { completeFilter } from "./script-schema";
import { canonicalTaxValue } from "./tax-receipt";
import type { Script, ScriptFrame } from "./script";
import type { VmState } from "./state";
import { NotYet } from "./errors";

/** R487/R490/R496: bounded paired-source occurrence. The historical wire name also covers P419, whose body has no self instruction. */
export interface PairedSelf { version: 1; card: string; token: number }
export function pairedSelfScript(script: Script | undefined): boolean {
  return Array.isArray(script?.trigger) && (script.trigger.includes("playedUsingUnionPotara") || script.trigger.includes("attacksOpponentBattle") || script.trigger.includes("youGainControlBattle"));
}
export function requirePairedSelfShape(script: Script | undefined): void {
  if (Array.isArray(script?.trigger) && script.trigger.includes("youGainControlBattle")) {
    if (script.kind !== "auto" || script.trigger.length !== 2 || !script.trigger.includes("played")
        || canonicalTaxValue(script.ops) !== canonicalTaxValue([{ op: "discard", n: 1, side: "opponent", to: "warp" }]))
      throw new NotYet("rebuild the bounded paired control-gain opponent Hand-to-Warp program", "R496");
    return;
  }
  if (Array.isArray(script?.trigger) && script.trigger.includes("attacksOpponentBattle")) {
    // Complete stored selector and variable linkage; key order is not semantics.
    const expected = [
      { op: "switchMode", target: { sel: { special: "self" } }, mode: "active" },
      { op: "choose", sel: { side: "opponent", area: "battle", filter: completeFilter({ type: "BATTLE" }), count: 1, upTo: true, ignoreBarrier: true }, as: "c0", reason: "choose up to 1 of your opponent's Battle Cards" },
      { op: "switchMode", target: { var: "c0" }, mode: "rest" },
    ];
    if (script.kind !== "auto" || !Array.isArray(script.trigger) || script.trigger.length !== 2 || !script.trigger.includes("played")
        || canonicalTaxValue(script.ops) !== canonicalTaxValue(expected))
      throw new NotYet("rebuild the bounded paired self-Active and opposing Rest program", "R490");
    return;
  }
  const ops = script?.ops;
  const draw = ops?.[0], power = ops?.[1];
  if (script?.kind !== "auto" || !Array.isArray(script.trigger) || script.trigger.length !== 2 || !script.trigger.includes("attacks")
      || !script.trigger.includes("playedUsingUnionPotara") || !Array.isArray(ops) || ops.length !== 2
      || draw?.op !== "draw" || draw.n !== 1 || Object.keys(draw).length !== 2
      || power?.op !== "power" || power.amount !== 5000 || power.until !== "turn" || Object.keys(power).length !== 4
      || !power.target || typeof power.target !== "object" || !("sel" in power.target) || Object.keys(power.target).length !== 1
      || !power.target.sel || typeof power.target.sel !== "object" || power.target.sel.special !== "self" || Object.keys(power.target.sel).length !== 1)
    throw new NotYet("rebuild the bounded paired self-power program", "R487");
}
export function capturePairedSelf(state: VmState, card: string, script: Script): PairedSelf {
  requirePairedSelfShape(script);
  const source = state.cards[card];
  source.pairedSelfToken ??= source.zoneEpoch ?? 0;
  const captured = { version: 1 as const, card, token: source.pairedSelfToken };
  requirePairedSelf(state, card, captured);
  return captured;
}
export function requirePairedSelf(state: VmState, card: string, captured: PairedSelf | undefined): void {
  const source = state.cards[card], current = source?.pairedSelfToken, epoch = source?.zoneEpoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !captured || captured.version !== 1 || captured.card !== card
      || !Number.isSafeInteger(captured.token) || captured.token < 0 || captured.token > epoch
      || !Number.isSafeInteger(current) || current! < captured.token || current! > epoch)
    throw new NotYet("saved paired source is missing its original occurrence; rebuild the match", "R487");
}

/** R496: discard expands deterministically; a saved chooser cannot change its owner, area or linkage. */
export function requirePairedSourceFrame(state: VmState, script: Script | undefined, frame: ScriptFrame): void {
  if (!script?.trigger?.includes("youGainControlBattle")) return;
  const opponent = frame.master === "p1" ? "p2" : "p1", variable = `discarded0${opponent}`;
  const original = [{ op: "discard", n: 1, side: "opponent", to: "warp" }];
  // Printed price is empty; external activation taxes have their own native
  // gate/payment frames. Bind this Auto's saved effect without treating its
  // empty printed-cost continuation as the effect body.
  if (frame.autoCost) {
    const cost = frame.autoCost;
    if (canonicalTaxValue(cost.effect) !== canonicalTaxValue(original)
        || canonicalTaxValue(frame.ops) !== "[]" || canonicalTaxValue(script.price?.ops ?? []) !== "[]"
        || !cost.skill || cost.skill.kind !== "auto" || cost.skill.index !== frame.skillIndex
        || canonicalTaxValue(cost.skill.usage) !== canonicalTaxValue(script.usage)
        || !["offer", "pools", "action"].includes(cost.stage) || frame.ip !== 0
        || !frame.vars || canonicalTaxValue(frame.vars) !== "{}"
        || frame.awaiting !== undefined && frame.awaiting !== "autoCost")
      throw new NotYet("saved paired Auto price lost its exact opponent Hand-to-Warp effect", "R496");
    return;
  }
  const expanded = [
    { op: "choose", sel: { side: "opponent", area: "hand", count: 1 }, as: variable, chooser: "opponent", reason: "discard 1 card" },
    { op: "moveTo", target: { var: variable }, to: "warp", reveal: true },
  ];
  const initial = canonicalTaxValue(frame.ops) === canonicalTaxValue(original);
  const vars = frame.vars, picked = vars?.[variable];
  if (!script.trigger.includes(frame.trigger!) || !["p1", "p2"].includes(frame.master)
      || !Number.isSafeInteger(frame.ip) || frame.ip < 0 || frame.ip > (initial ? 0 : 2)
      || !initial && canonicalTaxValue(frame.ops) !== canonicalTaxValue(expanded)
      || !vars || typeof vars !== "object" || Array.isArray(vars) || Object.keys(vars).some(key => key !== variable)
      || initial && (Object.keys(vars).length !== 0 || frame.awaiting !== undefined)
      || !initial && (!Array.isArray(picked) || picked.length > (frame.ip === 0 ? 0 : 1)
        || picked.some(id => typeof id !== "string" || state.cards[id]?.owner !== opponent)
        || frame.ip === 0 && frame.awaiting !== undefined && frame.awaiting !== variable))
    throw new NotYet("saved paired opponent Hand-to-Warp chooser lost its exact body or linkage", "R496");
}

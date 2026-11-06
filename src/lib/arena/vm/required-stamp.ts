import type { ScriptFrame, Selector } from "./script";
import type { VmState } from "./state";
import { NotYet } from "./errors";

/** R498: a required named arrival is never inferred from a card's current area. */
export function requiredStampedCards(state: VmState, frame: ScriptFrame, sel: Selector): string[] {
  const fail = (): never => { throw new NotYet("saved named arrival is missing valid occurrence stamps; rebuild the match", "R498"); };
  if (sel.requiredStamp !== true || typeof sel.fromVar !== "string" || !sel.fromVar || sel.special !== undefined) return fail();
  const ids = frame.vars?.[sel.fromVar], stamps = frame.vars?.[`${sel.fromVar}@epoch`];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length
      || !Array.isArray(stamps) || stamps.length !== ids.length || stamps.some(stamp => typeof stamp !== "string") || new Set(stamps).size !== stamps.length) return fail();
  const epochs = new Map<string, number>();
  for (const stamp of stamps) {
    const split = stamp.lastIndexOf("@"), id = stamp.slice(0, split), text = stamp.slice(split + 1), epoch = Number(text);
    if (split < 1 || !ids.includes(id) || epochs.has(id) || !/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(epoch)) return fail();
    epochs.set(id, epoch);
  }
  const current: string[] = [];
  for (const id of ids) {
    const epoch = epochs.get(id);
    if (epoch === undefined) return fail();
    const card = state.cards[id];
    if (!card) continue;
    const now = card.zoneEpoch ?? 0;
    if (!Number.isSafeInteger(now) || now < epoch) return fail();
    if (now === epoch) current.push(id);
  }
  return current;
}

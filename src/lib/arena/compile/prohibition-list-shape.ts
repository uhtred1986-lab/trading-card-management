/**
 * Prohibition batch 5: "…and it can't attack, be placed in your opponent's
 * Combo Area, or activate skills until the end of your next turn" (BT9-087) —
 * one prohibition said as a list of actions, which `compileProhibition`'s
 * `prohibitedActs` cuts into one rule per action with the subject and the
 * span they share. `splitClauses` cut it at its commas first, so the first
 * action lost the span printed at the end ("…can't attack" for the turn) and
 * the others lost their subject. Only a list whose every item starts with a
 * verb a prohibition takes, and whose last item follows ", or", is kept whole.
 */
const VERB = "(?:attack|block|be|activate|switch|play|combo|use|send|place)\\b";
/** One item: no full stop, comma or semicolon, and no "or" of its own — "be KO'd by skills or battles" (BT7-057) is not one action. */
const ITEM = "(?:(?!\\bor\\b)[^.;,])*";
const LIST = new RegExp(`\\bcan(?:'|no)t ${VERB}${ITEM}(?:,\\s*${VERB}${ITEM})*,\\s*or\\s+${VERB}${ITEM}`, "gi");

/** Where in a skill's text such a list lies, for `splitClauses` to leave whole. */
export function prohibitionListSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(LIST)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return out;
}

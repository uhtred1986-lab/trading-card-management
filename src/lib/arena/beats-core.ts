/**
 * The engine-neutral half of `beats.ts` (#641): the queue bookkeeping and the
 * per-viewer masking both engines' beats go through, with no import of the
 * legacy engine (`./engine`). `beats.ts` re-exports every name here, so
 * existing callers are unchanged; the rules engine (`vm/beats.ts`), `snapshot`
 * and the browser-safe entry (`browser.ts`) reach these without `./engine`.
 *
 * Checked by `scripts/verify/arena-browser-boundary.mts`.
 */
import type { EngineContext, GameEvent, PlayerId } from "./types";
import type { Beats, NumberedBeat } from "./beats";
import type { EngineState } from "./engines";
import type { GameDefinition } from "./rulesets/types";
import { revealedTo } from "./view-core";

export const EMPTY_BEATS: Beats = { seq: 0, list: [], art: {} };

/** How many beats a game keeps. A whole opponent turn is a few dozen. */
export const BEAT_CAP = 300;

export const SKILL_LABELS: Record<string, string> = {
  "activate:main": "Activate: Main",
  "activate:battle": "Activate: Battle",
  "activate:main/battle": "Activate: Main/Battle",
  auto: "Auto",
  permanent: "Permanent",
  "counter:play": "Counter: Play",
  "counter:attack": "Counter: Attack",
  "counter:battle card attack": "Counter: Attack",
  "counter:counter": "Counter",
  keyword: "Keyword",
};

/**
 * Was this move shown to both players (#463)? The event's own `reveal` says so
 * for a play, an Extra or a Critical life card; a life card revealed on its way
 * into a hand (#272, BT10-031/SD18-01's "reveal it and add it to your hand
 * instead") is the one that arrives `faceUp` in a hidden area, which is how
 * both engines mark it.
 */
export function revealedMove(e: Extract<GameEvent, { type: "move" }>, faceUpNow: boolean | undefined): boolean {
  return !!e.reveal || (e.from === "life" && e.to === "hand" && !!faceUpNow);
}

/**
 * What one batch's beats can only say by looking at each other (#463), shared
 * by both engines' translations so they stay the same shape:
 *
 * - a `damage` beat that a won clash dealt carries that clash's `attacker` as
 *   `by` — only the life cards leaving in between may separate them;
 * - a `skill` beat whose card moved from the hand to the Drop earlier in the
 *   batch is an Extra being used (12-2-2), `extra`;
 * - a `skill` beat that is the batch's last, outside a battle, with the game
 *   back at a Main Phase prompt, did nothing anyone can see, `noEffect`.
 *
 * Mutates `list` in place; called once at the end of `toBeats`/`vmToBeats`.
 */
export function relateBeats(list: NumberedBeat[], promptKind: string): void {
  let hit: string | null = null;
  const toDrop = new Set<string>();
  list.forEach((b, i) => {
    if (b.t === "clash") hit = b.hit ? b.attacker : null;
    else if (b.t === "damage") {
      if (hit) b.by = hit;
      hit = null;
    } else if (!(b.t === "move" && b.from === "life")) hit = null;
    if (b.t === "move" && b.from === "hand" && b.to === "drop") toDrop.add(b.card);
    if (b.t === "skill") {
      if (toDrop.has(b.card)) b.extra = true;
      if (i === list.length - 1 && !b.inBattle && promptKind === "main") b.noEffect = true;
    }
  });
}

/** Add a batch to a game's queue, keeping it bounded. */
export function appendBeats(prev: Beats | null, next: Beats): Beats {
  const before = prev ?? EMPTY_BEATS;
  const list = [...before.list, ...next.list].slice(-BEAT_CAP);
  return { seq: next.seq, list, art: { ...before.art, ...next.art } };
}

/**
 * The same queue, with the faces this viewer may not see taken out.
 *
 * Beats are built once per game and `art` carries the true name and picture of
 * every card they name — including the ones a player draws. On one device that
 * is harmless. On two it hands your opponent your hand, one card at a time, as
 * you draw it; `damage` leaks the Life cards you take the same way, since
 * those go to hand unrevealed.
 *
 * **Only the face is removed, never the beat.** The card still flies from the
 * deck to the hand and the story still reads — it simply arrives face-down.
 * Its instance id is *not* safe to keep (an id is a decklist position), so
 * the snapshot replaces it with `?` afterwards (`conceal.ts`, `concealBeats`);
 * this function only decides which faces go.
 *
 * The rule is `revealedTo`'s, not a second copy of it, and it is asked of the
 * state *now*: a card drawn and then played is public by the time anyone looks,
 * so its beat is not masked. The queue is returned unchanged when nothing is
 * hidden, so a snapshot with nothing to hide is the same object it was.
 */
export function maskBeats(state: EngineState, beats: Beats | null, viewer: PlayerId, ctx?: EngineContext): Beats | null {
  if (!beats) return null;
  const pinned = (ctx as (EngineContext & { rulesetDefinition?: GameDefinition }) | undefined)?.rulesetDefinition;
  const seen = revealedTo(state, viewer, pinned);
  // A declared secret [Auto] shows only that source while its private VM
  // witness remains live. The beat's exact epoch must match; an older beat
  // cannot authorize a later re-entry or another pending occurrence.
  const witnesses = (state as EngineState & { publicAutoReveals?: { card: string; epoch: number; sourceZoneEpoch: number }[] }).publicAutoReveals ?? [];
  const isRevealBeat = (b: NumberedBeat): b is NumberedBeat & ({ t: "autoDeclared" } | { t: "skill"; reveal: true }) =>
    b.t === "autoDeclared" || (b.t === "skill" && !!b.reveal);
  const declared = new Set(witnesses.filter((w) => !state.cards[w.card]?.hidden
    && ((state.cards[w.card] as { zoneEpoch?: number } | undefined)?.zoneEpoch ?? 0) === w.sourceZoneEpoch
    && beats.list.some((b) => isRevealBeat(b) && b.card === w.card && b.revealEpoch === w.epoch)).map((w) => w.card));
  const art: Beats["art"] = {};
  for (const [id, a] of Object.entries(beats.art)) if (seen.has(id) || declared.has(id)) art[id] = a;
  // #463: a `skill` beat carries the printed text and tag of the card that
  // fired it, which names the card as surely as its face does. Blanked on the
  // same rule; the beat stays, so the moment still plays.
  const hiddenSkill = (b: NumberedBeat) => (b.t === "skill" || b.t === "autoDeclared") && !seen.has(b.card)
    && !(declared.has(b.card) && isRevealBeat(b) && witnesses.some((w) => w.card === b.card && w.epoch === b.revealEpoch))
    && (b.text !== "" || b.label !== "Skill");
  const masksSkill = beats.list.some(hiddenSkill);
  const hasPrivateEpoch = beats.list.some((b) => (b.t === "skill" || b.t === "autoDeclared") && b.revealEpoch !== undefined);
  if (!masksSkill && !hasPrivateEpoch && Object.keys(art).length === Object.keys(beats.art).length) return beats;
  const list = beats.list.map((b) => {
    if (b.t !== "skill" && b.t !== "autoDeclared") return b;
    // This authorization key belongs only to the server's saved match; never
    // put it in either viewer's returned beat history.
    const publicBeat = { ...b };
    delete publicBeat.revealEpoch;
    return hiddenSkill(b) ? { ...publicBeat, label: "Skill", text: "" } : publicBeat;
  });
  return { ...beats, list, art };
}

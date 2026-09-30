/**
 * The narration log (issue #350): the sentences `narrate` already produces for
 * the beat on screen, kept as a list so a player can read back what happened —
 * newest first, each under its turn number. It replaces the raw engine log
 * everywhere but the admin drawer.
 *
 * Pure and React-free. The board keeps the list in state and folds each
 * snapshot's beats into it; a beat is recorded once, by its number, and the
 * number never restarts for the life of a game (`clearBeats`).
 */
import type { Beats, NumberedBeat } from "./beats";
import { narrate, type Narrator } from "./narration";

export interface StoryLine {
  /** The beat's number: what makes a line recorded once. */
  n: number;
  turn: number;
  text: string;
  /** Said about the viewer's own side. */
  mine: boolean;
}

/** Folds `beats` into `prev` (oldest first): only beats not yet recorded are added. */
export function foldStory(prev: StoryLine[], beats: Beats | null, narrator: Narrator, fallbackTurn: number, actorOf: (b: NumberedBeat) => string | null): StoryLine[] {
  if (!beats || beats.list.length === 0) return prev;
  const seen = prev.length ? prev[prev.length - 1].n : 0;
  const fresh = beats.list.filter((b) => b.n > seen);
  if (fresh.length === 0) return prev;
  // A beat ahead of the list's first phase beat belongs to the turn that beat names.
  const firstPhase = beats.list.find((b) => b.t === "phase");
  let turn = prev.length ? prev[prev.length - 1].turn : firstPhase && firstPhase.t === "phase" ? firstPhase.turn : fallbackTurn;
  const out = [...prev];
  for (const b of fresh) {
    if (b.t === "phase") turn = b.turn;
    const text = narrate(b, narrator);
    if (text) out.push({ n: b.n, turn, text, mine: actorOf(b) === narrator.viewer });
  }
  return out;
}

/** Newest first, for display. */
export const newestFirst = (story: StoryLine[]): StoryLine[] => [...story].reverse();

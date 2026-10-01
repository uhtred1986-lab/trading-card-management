"use client";

import { useState, useTransition } from "react";
import type { PlayerId } from "@/lib/arena/types";

/**
 * The end of the game, on the board (`docs/arena-redesign/` frame 10,
 * prototype `.over`): VICTORY or DEFEAT slammed over slow rays, the reason in
 * one line, and Rematch.
 *
 * Rematch is the same server action as the end screen's button below the
 * board (`GameOver`, #358): on success it redirects and never returns, on a
 * refusal — a deck gone, a game archived — the reason shows under it. The
 * board is put away with "Look at the board", which is how the final position
 * and the end screen's coaching are reached.
 *
 * It decides nothing: the winner and the reason are the engine's (`view.over`).
 */
export function GameEnd({
  over,
  you,
  them,
  turn,
  canRematch,
  versus,
  onRematch,
  onDismiss,
}: {
  over: { winner: PlayerId | null; reason: string };
  you: PlayerId;
  them: string;
  turn: number;
  canRematch: boolean;
  versus: boolean;
  onRematch: () => Promise<{ error: string | null }>;
  onDismiss: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tone = !over.winner ? "draw" : over.winner === you ? "win" : "lose";
  const title = tone === "win" ? "VICTORY" : tone === "lose" ? "DEFEAT" : "DRAW";
  // The engine's reason names the side ("Claude has no life left"); the turn is
  // the one fact it leaves out.
  const sub = over.reason ? `${over.reason[0].toUpperCase()}${over.reason.slice(1)} — turn ${turn}.` : tone === "win" ? `${them}'s leader falls on turn ${turn}.` : `Turn ${turn}.`;
  return (
    <div className={`arena-end arena-end-${tone}`} role="dialog" aria-modal="true" aria-label={title.toLowerCase()}>
      {tone !== "draw" && <span className="arena-end-rays" aria-hidden />}
      <h2 className="arena-end-title arena-impact">{title}</h2>
      <p className="arena-end-sub">{sub}</p>
      {canRematch && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await onRematch();
              setError(r.error);
            })
          }
          className="arena-end-rematch tap"
        >
          {pending ? (versus ? "Opening the invitation…" : "Dealing…") : versus ? "Rematch — invite again" : "Rematch"}
        </button>
      )}
      {error && <p className="arena-end-error">{error}</p>}
      <button type="button" onClick={onDismiss} className="arena-end-look tap">
        Look at the board
      </button>
    </div>
  );
}

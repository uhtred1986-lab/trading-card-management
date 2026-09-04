"use client";

import { useState, useTransition } from "react";
import { reportBug } from "@/app/arena/actions";

/**
 * "That's not right" — from inside the game, in two taps.
 *
 * You type one sentence. The state, every action so far, whose decision it
 * was, what was on offer and the tail of the log are copied in by the server,
 * so the report can be replayed rather than argued about. Naming the card is
 * optional but is usually the whole answer, so the cards on the table are
 * offered as a list.
 */
export function ReportBug({ gameId, cards }: { gameId: number; cards: { cardId: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [cardId, setCardId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await reportBug(gameId, note, cardId || null);
      if (r.error) {
        setError(r.error);
        return;
      }
      setSent(true);
      setNote("");
      setCardId("");
      setOpen(false);
      setTimeout(() => setSent(false), 4000);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="tap text-[11px] text-space-400 hover:text-loss">
        {sent ? <span className="text-gain">reported — thanks</span> : "something's wrong"}
      </button>
    );
  }

  // Distinct cards only: a report is about a card, not about one copy of it.
  const choices = [...new Map(cards.map((c) => [c.cardId, c])).values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-x-2 bottom-2 z-30 space-y-2 rounded-xl border border-space-600 bg-space-900/95 p-3 shadow-lg backdrop-blur sm:inset-x-auto sm:right-4 sm:w-96">
      <label className="block text-xs text-space-200">
        What happened that should not have?
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          placeholder="e.g. Gine says I can play her for free but it still took my energy"
          className="mt-1 w-full rounded-md border border-space-600 bg-space-950 p-2 text-sm text-space-100"
        />
      </label>
      {choices.length > 0 && (
        <label className="block text-[11px] text-space-300">
          Which card? (optional, but it is usually the answer)
          <select value={cardId} onChange={(e) => setCardId(e.target.value)} className="mt-1 w-full rounded-md border border-space-600 bg-space-950 p-2 text-xs text-space-100">
            <option value="">— no particular card —</option>
            {choices.map((c) => (
              <option key={c.cardId} value={c.cardId}>
                {c.name} ({c.cardId})
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[10px] text-space-500">The board, the whole game and every move so far are attached automatically, so it can be replayed.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={submit} disabled={pending || !note.trim()} className="tap rounded-lg bg-ki-500 px-3 py-1.5 text-xs font-semibold text-space-950 disabled:opacity-50">
          {pending ? "sending…" : "Send it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="tap text-xs text-space-400">
          cancel
        </button>
        {error && <span className="text-xs text-loss">{error}</span>}
      </div>
    </div>
  );
}

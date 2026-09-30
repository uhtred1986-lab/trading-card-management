"use client";

import { useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { CardImage } from "@/components/CardImage";
import { ColorPill } from "@/components/ColorPill";
import { deckPreviewAction } from "@/app/arena/deck-preview-action";
import { groupPreview, type CardRuleState, type DeckPreviewCard } from "@/lib/arena/deck-preview";

/**
 * Each state differs in shape and in a written word, never hue alone: open is a
 * hollow ring, draft a half dot, confirmed a filled dot, corrected a dot in a
 * ring. The word is shown beside the glyph and is also its `aria-label`.
 */
const STATE: Record<CardRuleState, { glyph: string; label: string; text: string }> = {
  open: { glyph: "○", label: "Open, no rule yet", text: "text-loss" },
  draft: { glyph: "◐", label: "Draft, not yet checked", text: "text-dbs-blue" },
  corrected: { glyph: "◉", label: "Corrected by hand", text: "text-ki-300" },
  confirmed: { glyph: "●", label: "Confirmed", text: "text-gain" },
  plain: { glyph: "–", label: "No skill text, no rule needed", text: "text-space-500" },
};
const WORD: Record<CardRuleState, string> = { open: "open", draft: "draft", corrected: "corrected", confirmed: "confirmed", plain: "no skill" };

/**
 * "See the cards" (#368): a button and the dialog it opens, a bottom sheet on a
 * phone and a side panel from `sm` up. Read-only. The cards are fetched when
 * the sheet first opens for a deck (one server action, one query), not with the
 * page. A native `<dialog>` opened with `showModal()` supplies the focus trap,
 * Escape and top layer; the scrim click and the return of focus are added here.
 */
export function DeckPreviewSheet({ deckId, deckName, className = "" }: { deckId: number; deckName: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState<{ deckId: number; cards: DeckPreviewCard[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () => {
    if (loaded?.deckId === deckId) return;
    setFailed(false);
    start(async () => {
      try {
        setLoaded({ deckId, cards: await deckPreviewAction(deckId) });
      } catch {
        setFailed(true);
      }
    });
  };
  const show = () => {
    // Rendered before `showModal()`, so the close button exists to take focus.
    flushSync(() => setOpen(true));
    dialog.current?.showModal();
    load();
  };
  const cards = loaded?.deckId === deckId ? loaded.cards : null;
  const groups = cards ? groupPreview(cards) : [];
  const openCount = cards ? new Set(cards.filter((c) => c.state === "open").map((c) => c.cardId)).size : 0;

  return (
    <>
      <button ref={opener} type="button" onClick={show} className={`tap rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-sm text-space-100 hover:border-space-500 ${className}`}>
        See the cards
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`deck-preview-${deckId}`}
        onClose={() => {
          setOpen(false);
          opener.current?.focus();
        }}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-space-700 bg-space-950 p-0 text-space-100 backdrop:bg-black/60 sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:h-full sm:w-96 sm:rounded-none sm:rounded-l-2xl"
      >
        {open && (
          <div className="flex max-h-[85dvh] flex-col sm:max-h-none sm:h-full">
            <header className="flex items-start gap-2 border-b border-space-700 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id={`deck-preview-${deckId}`} className="truncate text-base font-semibold text-space-50">
                  {deckName}
                </h2>
                <p className="text-xs text-space-400" aria-live="polite">
                  {pending || (!cards && !failed) ? "Loading the cards…" : failed ? "Could not load the cards." : openCount > 0 ? `${openCount} open card${openCount === 1 ? "" : "s"} first in each group.` : "Every card has a rule."}
                </p>
              </div>
              <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Close" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-space-600 bg-space-900 text-lg">
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {failed && (
                <button type="button" onClick={load} className="tap mt-3 rounded-lg border border-space-600 px-3 py-2 text-sm">
                  Try again
                </button>
              )}
              {cards && cards.length === 0 && <p className="py-6 text-center text-sm text-space-400">No cards to show.</p>}
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label} className="mt-3">
                  <h3 className="sticky top-0 z-10 flex justify-between bg-space-950 py-1 text-xs uppercase tracking-widest text-space-400">
                    <span>{g.label}</span>
                    <span>{g.copies}</span>
                  </h3>
                  <ul className="divide-y divide-space-800">
                    {g.cards.map((c) => (
                      <Row key={`${c.zone}:${c.cardId}`} card={c} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function Row({ card: c }: { card: DeckPreviewCard }) {
  const s = STATE[c.state];
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-space-50">{c.quantity}×</span>
      <div className="w-10 shrink-0">
        <CardImage src={c.imageUrl} alt="" sizes="40px" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-space-50">{c.name}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-space-400">
          {c.colors.map((k) => (
            <ColorPill key={k} color={k} small />
          ))}
          {c.energyCost != null && <span>cost {c.energyCost}</span>}
        </p>
      </div>
      <span role="img" aria-label={s.label} className={`flex w-16 shrink-0 flex-col items-center text-center leading-tight ${s.text}`}>
        <span aria-hidden className="text-lg">
          {s.glyph}
        </span>
        <span aria-hidden className="text-[10px] uppercase tracking-wider">
          {WORD[c.state]}
        </span>
      </span>
    </li>
  );
}

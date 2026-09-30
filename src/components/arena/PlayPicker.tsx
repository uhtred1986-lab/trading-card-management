"use client";

import { useState } from "react";
import { CardImage } from "@/components/CardImage";
import { SubmitButton } from "@/components/SubmitButton";

export interface PlayDeck {
  id: number;
  name: string;
  leaderName: string | null;
  leaderImage: string | null;
  mainCount: number;
}

type Opponent = "sparring" | "tournament" | "versus" | "hotseat";

/**
 * The Play form (#356): your deck, the opponent, one button.
 *
 * Three hidden inputs are the whole contract with `startGameForm`: `deck`,
 * `opponent` and `claudeDeck`. The engine and the debug record are not asked
 * about. The readiness strip and the block (ah-03) will sit between the deck
 * and the opponent; the Continue strip (ah-05) above the form.
 */
export function PlayPicker({
  decks,
  initialDeck,
  initialClaudeDeck,
  costs,
  canVersus,
  versusNote,
  action,
}: {
  decks: PlayDeck[];
  initialDeck: number;
  initialClaudeDeck: number;
  costs: { sparring: string; tournament: string };
  canVersus: boolean;
  versusNote: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [deckId, setDeckId] = useState(initialDeck);
  const [claudeDeck, setClaudeDeck] = useState(initialClaudeDeck);
  const [friend, setFriend] = useState(false);
  const [friendKind, setFriendKind] = useState<"versus" | "hotseat">(canVersus ? "versus" : "hotseat");
  const [claudeKind, setClaudeKind] = useState<"sparring" | "tournament">("sparring");

  const opponent: Opponent = friend ? friendKind : claudeKind;
  const index = Math.max(0, decks.findIndex((d) => d.id === deckId));
  const deck = decks[index];
  const step = (by: number) => setDeckId(decks[(index + by + decks.length) % decks.length].id);
  const needsOtherDeck = opponent !== "versus";
  const invite = opponent === "versus";

  const chip = (on: boolean, off = false) =>
    `tap rounded-lg border px-3 py-2 text-left text-sm ${off ? "cursor-not-allowed opacity-50" : ""} ${on ? "border-ki-500 bg-space-800 text-space-50" : "border-space-600 bg-space-900 text-space-200"}`;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="deck" value={deckId} />
      <input type="hidden" name="opponent" value={opponent} />
      <input type="hidden" name="claudeDeck" value={claudeDeck} />

      <section aria-label="Your deck" className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Your deck</h2>

        {/* Phone: one deck at a time. */}
        <div className="flex items-center gap-2 sm:hidden">
          <button type="button" onClick={() => step(-1)} disabled={decks.length < 2} aria-label="Previous deck" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-space-600 bg-space-900 text-lg disabled:opacity-40">
            ‹
          </button>
          <div className="min-w-0 flex-1 text-center" aria-live="polite">
            <div className="mx-auto w-40">
              <CardImage src={deck.leaderImage} alt={deck.leaderName ?? "No leader"} sizes="160px" priority />
            </div>
            <p className="mt-2 truncate text-base font-semibold text-space-50">{deck.name}</p>
            <p className="truncate text-xs text-space-400">
              {deck.leaderName ?? "no leader"} · {deck.mainCount} cards · {index + 1} of {decks.length}
            </p>
          </div>
          <button type="button" onClick={() => step(1)} disabled={decks.length < 2} aria-label="Next deck" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-space-600 bg-space-900 text-lg disabled:opacity-40">
            ›
          </button>
        </div>

        {/* Desktop: a grid, click to select. */}
        <ul className="hidden gap-3 sm:grid sm:grid-cols-3">
          {decks.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setDeckId(d.id)}
                aria-pressed={d.id === deckId}
                className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left ${d.id === deckId ? "border-ki-500 bg-space-800" : "border-space-700/70 bg-space-900/50 hover:border-space-500"}`}
              >
                <div className="w-14 shrink-0">
                  <CardImage src={d.leaderImage} alt={d.leaderName ?? "No leader"} sizes="56px" />
                </div>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-space-50">{d.name}</span>
                  <span className="block truncate text-xs text-space-400">
                    {d.leaderName ?? "no leader"} · {d.mainCount} cards
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-space-500">Fusion World decks are not listed: the arena plays the original game&rsquo;s rules only.</p>
      </section>

      <section aria-label="Opponent" className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Opponent</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" aria-pressed={!friend && claudeKind === "sparring"} onClick={() => { setFriend(false); setClaudeKind("sparring"); }} className={chip(!friend && claudeKind === "sparring")}>
            <span className="block font-medium">Claude · Sparring</span>
            <span className="block text-[11px] text-space-400">{costs.sparring}</span>
          </button>
          <button type="button" aria-pressed={!friend && claudeKind === "tournament"} onClick={() => { setFriend(false); setClaudeKind("tournament"); }} className={chip(!friend && claudeKind === "tournament")}>
            <span className="block font-medium">Claude · Tournament</span>
            <span className="block text-[11px] text-space-400">{costs.tournament}</span>
          </button>
          <button type="button" aria-pressed={friend} onClick={() => setFriend(true)} className={chip(friend)}>
            <span className="block font-medium">A friend</span>
            <span className="block text-[11px] text-space-400">Free</span>
          </button>
        </div>
        {friend && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={!canVersus} aria-pressed={friendKind === "versus"} onClick={() => setFriendKind("versus")} className={chip(friendKind === "versus", !canVersus)}>
              <span className="block font-medium">On their device</span>
              <span className="block text-[11px] text-space-400">{canVersus ? "1 v 1. They join and pick their own deck." : versusNote}</span>
            </button>
            <button type="button" aria-pressed={friendKind === "hotseat"} onClick={() => setFriendKind("hotseat")} className={chip(friendKind === "hotseat")}>
              <span className="block font-medium">Pass-and-play here</span>
              <span className="block text-[11px] text-space-400">Both sides on this device.</span>
            </button>
          </div>
        )}
      </section>

      {needsOtherDeck && (
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-space-400">{friend ? "Second player plays" : "Claude plays"}</span>
          <select
            value={claudeDeck}
            onChange={(e) => setClaudeDeck(Number(e.target.value))}
            className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-100"
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.leaderName ?? "no leader"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="sticky bottom-2 z-10 space-y-1 rounded-xl bg-space-950/80 py-1 backdrop-blur sm:static sm:bg-transparent sm:backdrop-blur-none">
        <SubmitButton pendingLabel={invite ? "Opening…" : "Flipping…"} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950">
          {invite ? "Invite a friend" : "Play"}
        </SubmitButton>
        <p className="text-center text-[11px] text-space-400">{invite ? "They get a waiting room and choose their own deck." : "The coin flip comes first, then each side may mulligan once."}</p>
      </div>
    </form>
  );
}

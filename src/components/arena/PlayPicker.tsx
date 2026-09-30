"use client";

import Link from "next/link";
import { useState } from "react";
import { CardImage } from "@/components/CardImage";
import { SubmitButton } from "@/components/SubmitButton";

export interface PlayDeck {
  id: number;
  name: string;
  leaderName: string | null;
  leaderImage: string | null;
  mainCount: number;
  /** Rule readiness (`readiness.ts`): open rows lock the deck. */
  ready: { open: number; draft: number; corrected: number; confirmed: number; plain: number; openCards: { id: string; name: string }[] };
}

const RING = "○";
const HALF = "◐";
const DOT = "●";

type Opponent = "sparring" | "tournament" | "versus" | "hotseat";

/**
 * The Play form (#356): your deck, the opponent, one button.
 *
 * Three hidden inputs are the whole contract with `startGameForm`: `deck`,
 * `opponent` and `claudeDeck`. The engine and the debug record are not asked
 * about. The readiness strip sits under the deck; a deck with an open rule is
 * Locked here and refused again by the server (#357). The Continue strip
 * (ah-05) goes above the form.
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
  const locked = (d: PlayDeck) => d.ready.open > 0;
  const readyDecks = decks.filter((d) => !locked(d));
  const isLocked = locked(deck);
  // "Next ready deck" walks forward from the current position and wraps.
  const nextReady = decks.map((_, i) => decks[(index + 1 + i) % decks.length]).find((d) => !locked(d));
  const other = decks.find((d) => d.id === claudeDeck);
  const otherLocked = needsOtherDeck && !!other && locked(other);
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
            <p className="mt-2 truncate text-base font-semibold text-space-50">
              {deck.name}
              {isLocked && <LockedBadge />}
            </p>
            <p className="truncate text-xs text-space-400">
              {deck.leaderName ?? "no leader"} · {deck.mainCount} cards · {index + 1} of {decks.length}
            </p>
          </div>
          <button type="button" onClick={() => step(1)} disabled={decks.length < 2} aria-label="Next deck" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-space-600 bg-space-900 text-lg disabled:opacity-40">
            ›
          </button>
        </div>
        {/* Locked decks show red dots. */}
        <div className="flex justify-center gap-1.5 sm:hidden" aria-hidden>
          {decks.map((d) => (
            <span key={d.id} className={`h-1.5 w-1.5 rounded-full ${locked(d) ? "bg-loss" : "bg-space-500"} ${d.id === deckId ? "ring-2 ring-ki-500" : ""}`} />
          ))}
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
                  <span className="block truncate text-sm font-medium text-space-50">
                    {d.name}
                    {locked(d) && <LockedBadge />}
                  </span>
                  <span className="block truncate text-xs text-space-400">
                    {d.leaderName ?? "no leader"} · {d.mainCount} cards
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Readiness deck={deck} />
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
              <option key={d.id} value={d.id} disabled={locked(d)}>
                {d.name} — {d.leaderName ?? "no leader"}
                {locked(d) ? ` (${d.ready.open} open, locked)` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="sticky bottom-2 z-10 space-y-1 rounded-xl bg-space-950/80 py-1 backdrop-blur sm:static sm:bg-transparent sm:backdrop-blur-none">
        {isLocked ? (
          <>
            {/* Computer: Rules is one click away. */}
            <Link href={`/arena/rules?deck=${deck.id}&seg=open`} className="tap hidden w-full items-center justify-center rounded-lg bg-loss px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950 sm:flex">
              Fix {deck.ready.open} card{deck.ready.open === 1 ? "" : "s"} to play
            </Link>
            {/* Phone: Rules is made for the computer, so move to a deck that can be played. */}
            <button type="button" disabled={!nextReady} onClick={() => nextReady && setDeckId(nextReady.id)} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950 disabled:opacity-40 sm:hidden">
              Pick a ready deck
            </button>
            <p className="text-center text-[11px] text-space-400 sm:hidden">
              {readyDecks.length} of your {decks.length} decks {readyDecks.length === 1 ? "is" : "are"} ready.
            </p>
          </>
        ) : otherLocked ? (
          <button type="button" disabled className="tap w-full rounded-lg bg-space-700 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-300 opacity-70">
            Choose a ready deck for {friend ? "the second player" : "Claude"}
          </button>
        ) : (
          <SubmitButton pendingLabel={invite ? "Opening…" : "Flipping…"} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950">
            {invite ? "Invite a friend" : "Play"}
          </SubmitButton>
        )}
        <p className={`text-center text-[11px] text-space-400 ${isLocked || otherLocked ? "hidden" : ""}`}>{invite ? "They get a waiting room and choose their own deck." : "The coin flip comes first, then each side may mulligan once."}</p>
      </div>
    </form>
  );
}

function LockedBadge() {
  return <span className="ml-2 rounded-full border border-loss/60 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-loss">Locked</span>;
}

/**
 * The stacked bar and the four counts. Each state also differs in shape (ring,
 * half, filled), so the bar never relies on hue alone (spec §3).
 */
function Readiness({ deck }: { deck: PlayDeck }) {
  const r = deck.ready;
  const cells = [
    { key: "open", label: "open", n: r.open, glyph: RING, bar: "bg-loss", text: "text-loss" },
    { key: "draft", label: "draft", n: r.draft, glyph: HALF, bar: "bg-dbs-blue", text: "text-dbs-blue" },
    { key: "corrected", label: "corrected", n: r.corrected, glyph: DOT, bar: "bg-ki-500", text: "text-ki-300" },
    { key: "confirmed", label: "confirmed", n: r.confirmed, glyph: DOT, bar: "bg-gain", text: "text-gain" },
  ];
  const total = cells.reduce((n, c) => n + c.n, 0);
  return (
    <div className="space-y-1.5 rounded-lg bg-space-900/50 p-2 text-xs" aria-label="Rule readiness">
      <div className="flex h-2 overflow-hidden rounded-full bg-space-800" aria-hidden>
        {cells.map((c) => c.n > 0 && <span key={c.key} className={c.bar} style={{ width: `${(c.n / Math.max(1, total)) * 100}%` }} />)}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5">
        {cells.map((c) => (
          <span key={c.key} className={c.n > 0 ? c.text : "text-space-500"}>
            <span aria-hidden>{c.glyph}</span> {c.n} {c.label}
          </span>
        ))}
        {r.plain > 0 && <span className="text-space-500">{r.plain} without skills</span>}
      </p>
      {r.open > 0 ? (
        <div className="rounded-md border border-loss/60 bg-loss/10 p-2 text-loss">
          <p className="font-semibold">
            {r.open} card{r.open === 1 ? " has" : "s have"} no rule yet
          </p>
          <p className="mt-0.5 text-space-200">
            {/* Computer: each name links into Rules. */}
            <span className="hidden sm:inline">
              {r.openCards.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <Link href={`/arena/rules?deck=${deck.id}&seg=open&q=${encodeURIComponent(c.id)}`} className="underline hover:text-space-50">
                    {c.name}
                  </Link>
                </span>
              ))}
            </span>
            {/* Phone: no link, Rules is for the computer. */}
            <span className="sm:hidden">{r.openCards.map((c) => c.name).join(", ")}</span>
          </p>
          <p className="mt-1 text-space-300 sm:hidden">Fix them in Rules on the computer.</p>
        </div>
      ) : (
        <p className="text-gain">
          Every card has a rule
          {r.draft > 0 && (
            <span className="text-space-400">
              {" "}
              · {r.draft} draft{r.draft === 1 ? "" : "s"} not yet checked, they play as read.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

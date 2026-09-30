"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { rematch, requestReview } from "@/app/arena/actions";
import type { GameReview } from "@/lib/arena/ai/review";
import { ReportBug } from "./ReportBug";

/**
 * The end screen: who won, what it cost, and Claude's coaching.
 *
 * Below the result: REMATCH (the one filled button), Change deck, how many
 * unchecked (draft) rules this game relied on, then the secondary actions (#358).
 *
 * The cost is what the game actually spent, added up from the token counts of
 * every call, not an estimate — which is the whole point of recording them.
 */
export function GameOver({
  gameId,
  winnerName,
  draw,
  reason,
  turns,
  damage,
  spend,
  review,
  aiEnabled,
  deckId,
  versus,
  draftFired,
  cards,
}: {
  gameId: number;
  winnerName: string | null;
  draw: boolean;
  reason: string;
  turns: number;
  damage: { you: number; them: number };
  spend: { calls: number; input: number; output: number; cached: number; micros: number };
  review: GameReview | null;
  aiEnabled: boolean;
  /** The viewer's deck in this game, preselected by "Change deck"; null when it is gone. */
  deckId: number | null;
  /** A 1 v 1: rematch opens a new invitation rather than starting a game. */
  versus: boolean;
  /** Draft rules that resolved in this game (`game-over.ts`). */
  draftFired: { count: number; names: string[] };
  cards: { cardId: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rematching, startRematch] = useTransition();
  const [rematchError, setRematchError] = useState<string | null>(null);

  const dollars = spend.micros / 1_000_000;
  const cost = dollars < 0.01 && dollars > 0 ? "under $0.01" : `$${dollars.toFixed(2)}`;
  const cachedShare = spend.input + spend.cached > 0 ? Math.round((spend.cached / (spend.input + spend.cached)) * 100) : 0;

  return (
    <section className="space-y-3 rounded-xl border border-space-700/70 bg-space-900/60 p-4">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.28em] text-space-400">{draw ? "Draw" : winnerName ? "Result" : "Over"}</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-ki-300">{draw ? "A draw" : `${winnerName} wins`}</p>
        <p className="mt-1 text-xs text-space-300">{reason}</p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          disabled={rematching}
          onClick={() =>
            startRematch(async () => {
              // On success the action redirects and this never returns.
              const r = await rematch(gameId);
              setRematchError(r.error);
            })
          }
          className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-base font-bold uppercase tracking-widest text-space-950 disabled:opacity-60"
        >
          {rematching ? (versus ? "Opening the invitation…" : "Dealing…") : versus ? "Rematch — invite again" : "Rematch"}
        </button>
        {rematchError && <p className="text-xs text-loss">{rematchError}</p>}
        <div className="grid grid-cols-2 gap-2 text-center text-sm">
          <Link href={deckId != null ? `/arena?deck=${deckId}` : "/arena"} className="tap rounded-lg border border-space-600 bg-space-800 px-3 py-2.5 font-semibold text-space-50">
            Change deck
          </Link>
          <a href="#board" className="tap rounded-lg border border-space-600 bg-space-800 px-3 py-2.5 font-semibold text-space-50">
            Look at the final board
          </a>
        </div>
      </div>

      {draftFired.count > 0 && (
        <div className="rounded-lg border border-space-700 bg-space-900 p-3 text-xs">
          <p className="font-semibold text-space-100">
            {draftFired.count} unchecked {draftFired.count === 1 ? "rule" : "rules"} played this game
          </p>
          <p className="mt-0.5 text-space-400">
            {draftFired.names.join(", ")}
            {draftFired.count > draftFired.names.length && ` and ${draftFired.count - draftFired.names.length} more`}
          </p>
          {/* Computer: a link into the Rules queue scoped to this game. Phone: a
              note only; Rules is worked at the computer (spec decision 6). */}
          <Link href={`/arena/rules?game=${gameId}&state=draft`} className="mt-1 hidden text-ki-300 hover:underline sm:inline-block">
            Check them in Rules →
          </Link>
          <p className="mt-1 text-space-400 sm:hidden">They wait at the top of Rules for your next session at the computer.</p>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="turns" value={String(turns)} />
        <Stat label="damage dealt" value={`${damage.them} / ${damage.you}`} />
        <Stat label="Claude calls" value={String(spend.calls)} />
      </dl>

      {spend.calls > 0 && (
        <div className="rounded-lg border border-space-700 bg-space-900 p-3 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="text-space-300">What this game cost</span>
            <span className="font-mono font-semibold text-space-50">{cost}</span>
          </div>
          <p className="mt-1 text-space-400">
            {spend.input.toLocaleString("en")} input, {spend.output.toLocaleString("en")} output, {spend.cached.toLocaleString("en")} read from cache
            {cachedShare > 0 && ` — ${cachedShare} % of the input was cached, at a tenth of the price`}
          </p>
        </div>
      )}

      {review ? (
        <div className="space-y-2 rounded-lg border-l-2 border-ki-500 bg-space-800 p-3 text-xs leading-relaxed">
          <p className="text-space-100">{review.verdict}</p>
          <p className="text-space-300">
            <span className="font-semibold text-space-100">Turning point. </span>
            {review.turningPoint}
          </p>
          <Points title="Well played" items={review.wellPlayed} tone="text-gain" />
          <Points title="To work on" items={review.toWorkOn} tone="text-ki-300" />
          <Points title="Deck changes to try" items={review.deckAdvice} tone="text-space-100" />
        </div>
      ) : aiEnabled ? (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await requestReview(gameId);
                setError(r.error);
              })
            }
            className="tap w-full rounded-lg border border-space-600 bg-space-800 px-4 py-3 text-sm font-semibold text-space-50 disabled:opacity-50"
          >
            {pending ? "Claude is reviewing the game…" : "Ask Claude what to learn from this"}
          </button>
          {error && <p className="mt-1 text-xs text-loss">{error}</p>}
        </div>
      ) : null}

      <div className="text-center">
        <ReportBug gameId={gameId} cards={cards} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-space-700 bg-space-900 p-2">
      <dd className="font-mono text-lg font-bold text-space-50">{value}</dd>
      <dt className="text-[9px] uppercase tracking-widest text-space-500">{label}</dt>
    </div>
  );
}

function Points({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-widest ${tone}`}>{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-space-300">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

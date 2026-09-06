"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buildDeckFromCardAction } from "@/app/decks/actions";
import { CardSearchInput, type CardHit } from "./CardSearchInput";
import { CardImage } from "./CardImage";
import { GAME_INFO, gameOr } from "@/lib/catalog/games";

/**
 * Start a deck from a card you like: search the catalog for any non-Leader
 * card, and Claude picks a Leader for it as well as the other 49-odd cards.
 * The mirror image of {@link NewDeckWithClaude}, which starts from the
 * Leader instead.
 */
export function NewDeckFromCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<CardHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();

  const draft = () => {
    if (!picked) return;
    startDraft(async () => {
      setError(null);
      const r = await buildDeckFromCardAction(picked.id);
      if (r.ok) router.push(`/decks/${r.deckId}`);
      else setError(r.error);
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!enabled}
        title={enabled ? "Pick a card and Claude builds a Leader and a deck around it" : "Set ANTHROPIC_API_KEY"}
        className="tap rounded-md border border-ki-500/60 px-3 py-1.5 text-sm font-semibold text-ki-300 hover:bg-ki-500/10 disabled:opacity-50"
      >
        ✦ Deck around a card
      </button>
    );
  }

  const isLeader = picked?.cardType === "LEADER";

  return (
    <div className="w-full rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 sm:w-96">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-space-50">Deck around a card</span>
        <button onClick={() => setOpen(false)} className="rounded px-1 text-xs text-space-400 hover:text-space-100">
          close
        </button>
      </div>

      <CardSearchInput autoFocus onPick={setPicked} placeholder="Card name or number, e.g. BT18-020" />

      {picked ? (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-space-900/70 p-2">
          <div className="w-10 shrink-0">
            <CardImage src={picked.imageUrl} alt={picked.name} sizes="40px" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-space-50">{picked.name}</span>
            <span className="text-[11px] text-space-400">
              {picked.id} · {GAME_INFO[gameOr(picked.game)].short} · {picked.colors.join("/")}
            </span>
          </div>
          <button onClick={() => setPicked(null)} className="shrink-0 rounded px-1 text-xs text-space-400 hover:text-space-100">
            change
          </button>
        </div>
      ) : null}

      {isLeader ? (
        <p className="mt-2 text-xs text-space-300">
          That&apos;s a Leader — use{" "}
          <Link href="/leaders" className="text-ki-300 hover:underline">
            Build a deck with Claude
          </Link>{" "}
          on the Leaders page instead.
        </p>
      ) : (
        <button
          onClick={draft}
          disabled={!picked || drafting}
          className="tap mt-2 w-full rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50"
        >
          {drafting ? "Drafting… (a minute or two)" : picked ? "Draft a deck with Claude" : "Pick a card first"}
        </button>
      )}
      <p className="mt-1 text-[11px] text-space-400">
        Claude also picks a Leader, preferring cards you own and listing anything you&apos;d need to buy. Creates a <span className="text-space-300">virtual</span> deck.
      </p>
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
    </div>
  );
}

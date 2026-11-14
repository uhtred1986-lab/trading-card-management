"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { INPUT_COPY } from "@/lib/pokemon/copy-input";
import type { PokemonBatchOffer } from "@/lib/pokemon/scan-batch-types";
import { DeckSelect, type DeckChoice } from "./AddParts";
import { BatchOfferCard } from "./PokemonPageBatch";

const C = INPUT_COPY.hub;

function Option({ href, icon, title, hint }: { href: string; icon: ReactNode; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="tap flex min-h-20 items-center gap-4 rounded-2xl border border-space-700 bg-space-900/60 p-4 hover:bg-space-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ki-500/15 text-2xl text-ki-300" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-space-50">{title}</span>
        <span className="block text-sm text-space-300">{hint}</span>
      </span>
    </Link>
  );
}

/** The three ways in, and the deck new cards may also go into (passed on as `?deck=`). */
export function AddHub({ decks, initialDeck, offer }: { decks: DeckChoice[]; initialDeck: number | null; offer: PokemonBatchOffer | null }) {
  const [deckId, setDeckId] = useState<number | null>(initialDeck);
  const q = deckId ? `?deck=${deckId}` : "";
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold text-space-50">{C.title}</h1>
      {offer ? <BatchOfferCard offer={offer} href={`/pokemon/add/photo?mode=page${deckId ? `&deck=${deckId}` : ""}`} /> : null}
      <div className="space-y-3">
        <Option href={`/pokemon/add/voice${q}`} icon="🎤" title={C.voice.title} hint={C.voice.hint} />
        <Option href={`/pokemon/add/photo${q}`} icon="📷" title={C.photo.title} hint={C.photo.hint} />
        <Option href="/pokemon/discover" icon="🔍" title={C.search.title} hint={C.search.hint} />
      </div>
      <DeckSelect decks={decks} value={deckId} onChange={setDeckId} label={C.deck.label} none={C.deck.none} hint={C.deck.hint} />
    </div>
  );
}

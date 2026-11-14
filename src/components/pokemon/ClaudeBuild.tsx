"use client";

import { useEffect, useRef, useState } from "react";
import { NewDeckFromCard, type FromCardSeed } from "@/components/NewDeckFromCard";
import { NewDeckWithClaude, type SeedCard } from "@/components/NewDeckWithClaude";
import { DECK_AI_LABELS_DE, NEW_DECK_FROM_CARD_LABELS_DE, NEW_DECK_WITH_CLAUDE_LABELS_DE } from "@/lib/ai/games/labels-de";
import { DeckAI } from "@/components/DeckAI";
import { tileFromHit } from "@/lib/pokemon/client";
import { PK } from "@/lib/pokemon/copy";
import type { PokemonHit } from "@/lib/pokemon/types";
import { MiniArt } from "./DeckParts";

const DECK_HREF = "/pokemon/decks/{id}";

/** "Deck mit Claude bauen": a wish, a format and, if she likes, a card to build around (picked by picture). */
export function PokemonDeckWithClaude({ enabled }: { enabled: boolean }) {
  return (
    <div className="pk-claude">
      <NewDeckWithClaude enabled={enabled} games={["pokemon"]} labels={NEW_DECK_WITH_CLAUDE_LABELS_DE} deckHref={DECK_HREF} renderSeedPicker={(onPick) => <SeedPicker onPick={onPick} />} />
    </div>
  );
}

/** "Neues Deck mit dieser Karte" for the card the page is about: the free draft and Claude's, then the new deck opens. */
export function PokemonDeckFromCard({ enabled, seed }: { enabled: boolean; seed: FromCardSeed }) {
  return (
    <div className="pk-claude">
      <NewDeckFromCard enabled={enabled} game="pokemon" seed={seed} labels={NEW_DECK_FROM_CARD_LABELS_DE} deckHref={DECK_HREF} defaultOpen />
    </div>
  );
}

/** "Deck analysieren" and "Mit Claude verbessern": two buttons that open the one Claude panel of the deck page. */
export function PokemonDeckClaude({ deckId, enabled, aiSummary, aiSummaryAt, openSuggestions }: { deckId: number; enabled: boolean; aiSummary: string | null; aiSummaryAt: string | null; openSuggestions: number }) {
  const [open, setOpen] = useState<"analyse" | "improve" | null>(null);
  return (
    <div>
      <div className="pk-buttons" style={{ marginBottom: open ? 8 : 0 }}>
        <button type="button" className="pk-cta pk-cta-alt" aria-expanded={open === "analyse"} onClick={() => setOpen(open === "analyse" ? null : "analyse")}>
          ✦ {PK.decks.analyse}
        </button>
        <button type="button" className="pk-cta pk-cta-alt" aria-expanded={open === "improve"} onClick={() => setOpen(open === "improve" ? null : "improve")}>
          ✦ {PK.decks.improve}
        </button>
      </div>
      {open ? (
        <div className="pk-claude">
          <DeckAI deckId={deckId} aiSummary={aiSummary} aiSummaryAt={aiSummaryAt} enabled={enabled} openSuggestions={openSuggestions} labels={DECK_AI_LABELS_DE} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A simple card picker on the live search: type, tap a picture. It reads `/api/pokemon/search` the way
 * Entdecken does and offers Pokémon cards only (a deck is built around a Pokémon).
 */
function SeedPicker({ onPick }: { onPick: (card: SeedCard) => void }) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<{ q: string; hits: PokemonHit[]; phase: "loading" | "ready" | "down" }>({ q: "", hits: [], phase: "ready" });
  const ctl = useRef<AbortController | null>(null);
  const q = input.trim();

  useEffect(() => {
    if (q.length < 2) return;
    const timer = window.setTimeout(() => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      const p = new URLSearchParams({ q, category: "POKEMON", page: "1" });
      setState((s) => ({ ...s, q, phase: "loading" }));
      fetch(`/api/pokemon/search?${p}`, { signal: c.signal, headers: { accept: "application/json" } })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return ((await r.json()) as { hits: PokemonHit[] }).hits;
        })
        .then((hits) => {
          if (!c.signal.aborted) setState({ q, hits: hits.slice(0, 12), phase: "ready" });
        })
        .catch((e) => {
          if (!c.signal.aborted && !(e instanceof DOMException && e.name === "AbortError")) setState({ q, hits: [], phase: "down" });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctl.current?.abort();
    };
  }, [q]);

  const shown = q.length >= 2 && state.q === q ? state : null;
  return (
    <div>
      <input type="search" className="pk-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={PK.newDeck.pickPlaceholder} aria-label={PK.newDeck.pickCard} autoComplete="off" spellCheck={false} />
      {shown?.phase === "loading" ? <p className="pk-note" role="status">{PK.newDeck.pickSearching}</p> : null}
      {shown?.phase === "down" ? <p className="pk-note pk-error" role="alert">{PK.newDeck.pickDown}</p> : null}
      {shown?.phase === "ready" && shown.hits.length === 0 ? <p className="pk-note" role="status">{PK.newDeck.pickNone}</p> : null}
      {shown && shown.phase === "ready" && shown.hits.length > 0 ? (
        <div className="pk-seedgrid">
          {shown.hits.map((h) => {
            const t = tileFromHit(h);
            return (
              <button key={h.id} type="button" aria-label={PK.newDeck.pickAria(h.name)} onClick={() => onPick({ id: h.id, name: h.name, imageUrl: t.imageLow })}>
                <MiniArt src={t.imageLow} name={h.name} label={`${h.name}, ${h.setName} ${h.localId}`} />
                <small>{h.name}</small>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

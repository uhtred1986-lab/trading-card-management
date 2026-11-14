"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { buildDeckAroundCardAction } from "@/app/decks/claude-actions";
import { CardSearchInput } from "./CardSearchInput";
import { CardImage } from "./CardImage";
import { GAME_INFO, gameOr, type Game } from "@/lib/catalog/games";
import { NEW_DECK_FROM_CARD_LABELS_EN, type NewDeckFromCardLabels } from "@/lib/ai/games/labels";

/** The card a deck is built around: a catalog search hit, or any card a page already knows. */
export interface FromCardSeed {
  id: string;
  name: string;
  imageUrl?: string | null;
  game?: string;
  colors?: string[];
  cardType?: string;
}

/**
 * Start a deck from a card you like: search the catalog for any non-Leader
 * card, and Claude picks a Leader for it as well as the other 49-odd cards.
 * The mirror image of {@link NewDeckWithClaude}, which starts from the
 * Leader instead.
 *
 * Game-neutral. Dragon Ball (the default): as above. `game="pokemon"` has no Leader: with a `seed` (the
 * card the page is about; no search box) it offers a free "Entwurf" (deterministic, no model: the card's
 * evolution line, Energy of its type, the Trainers you own) beside Claude's. `renderSearch` swaps in a
 * game's own card search (client parents only: a function cannot cross from a server page); `labels` is
 * the screen's language (`NEW_DECK_FROM_CARD_LABELS_DE` from `@/lib/ai/games/labels-de`) and `deckHref`
 * where the deck opens (`{id}` is the deck id).
 */
export function NewDeckFromCard({
  enabled,
  game,
  labels = NEW_DECK_FROM_CARD_LABELS_EN,
  seed,
  renderSearch,
  deckHref = "/decks/{id}",
  defaultOpen = false,
}: {
  enabled: boolean;
  game?: Game;
  labels?: NewDeckFromCardLabels;
  seed?: FromCardSeed | null;
  renderSearch?: (onPick: (card: FromCardSeed) => void) => ReactNode;
  deckHref?: string;
  /** Start with the panel open (a screen that is only about this: the Pokémon new-deck page). */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [pickedCard, setPicked] = useState<FromCardSeed | null>(null);
  const picked = seed ?? pickedCard;
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();
  const [mode, setMode] = useState<"draft" | "claude">("claude");
  const formats = game ? GAME_INFO[game].deck.formats : [];
  const [format, setFormat] = useState<string>(formats[0] ?? "");
  const hasLeader = game ? GAME_INFO[game].deck.leader : true;

  const draft = (how: "draft" | "claude") => {
    if (!picked) return;
    setMode(how);
    startDraft(async () => {
      setError(null);
      const r = await buildDeckAroundCardAction(game ?? gameOr(picked.game), picked.id, how, format || null);
      if (r.ok) router.push(deckHref.replace("{id}", String(r.deckId)));
      else setError(r.error);
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!enabled && hasLeader}
        title={enabled || !hasLeader ? labels.openTitle : labels.disabledTitle}
        className="tap rounded-md border border-ki-500/60 px-3 py-1.5 text-sm font-semibold text-ki-300 hover:bg-ki-500/10 disabled:opacity-50"
      >
        {labels.open}
      </button>
    );
  }

  const isLeader = hasLeader && picked?.cardType === "LEADER";

  return (
    <div className="w-full rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 sm:w-96">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-space-50">{labels.heading}</span>
        <button onClick={() => setOpen(false)} className="rounded px-1 text-xs text-space-400 hover:text-space-100">
          {labels.close}
        </button>
      </div>

      {seed ? null : renderSearch ? renderSearch(setPicked) : <CardSearchInput autoFocus onPick={setPicked} placeholder={labels.searchPlaceholder} />}

      {picked ? (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-space-900/70 p-2">
          <div className="w-10 shrink-0">
            <CardImage src={picked.imageUrl ?? null} alt={picked.name} sizes="40px" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-space-50">{picked.name}</span>
            <span className="text-[11px] text-space-400">
              {picked.id} · {GAME_INFO[game ?? gameOr(picked.game)].short}
              {picked.colors?.length ? ` · ${picked.colors.join("/")}` : ""}
            </span>
          </div>
          {seed ? null : (
            <button onClick={() => setPicked(null)} className="shrink-0 rounded px-1 text-xs text-space-400 hover:text-space-100">
              {labels.change}
            </button>
          )}
        </div>
      ) : null}

      {formats.length > 1 ? (
        <label className="mt-2 block min-w-0 text-xs text-space-300">
          {labels.formatLabel}
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 text-sm">
            {formats.map((f) => (
              <option key={f} value={f}>
                {labels.formatNames[f] ?? f}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {isLeader ? (
        <p className="mt-2 text-xs text-space-300">
          {labels.leaderPre}
          <Link href="/leaders" className="text-ki-300 hover:underline">
            {labels.leaderLink}
          </Link>
          {labels.leaderPost}
        </p>
      ) : hasLeader ? (
        <button onClick={() => draft("claude")} disabled={!picked || drafting} className="tap mt-2 w-full rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
          {drafting ? labels.drafting : picked ? labels.draft : labels.pickFirst}
        </button>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={() => draft("draft")} disabled={!picked || drafting} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
            {drafting && mode === "draft" ? labels.freeDrafting : picked ? labels.freeDraft : labels.pickFirst}
          </button>
          <button onClick={() => draft("claude")} disabled={!picked || !enabled || drafting} title={enabled ? undefined : labels.disabledTitle} className="tap rounded-md border border-ki-500/60 px-3 py-1.5 text-sm font-semibold text-ki-300 hover:bg-ki-500/10 disabled:opacity-50">
            {drafting && mode === "claude" ? labels.drafting : labels.withClaude}
          </button>
        </div>
      )}
      <p className="mt-1 text-[11px] text-space-400">
        {hasLeader ? null : <>{labels.freeNote} </>}
        {labels.footnotePre}
        <span className="text-space-300">{labels.footnoteEmph}</span>
        {labels.footnotePost}
      </p>
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
    </div>
  );
}

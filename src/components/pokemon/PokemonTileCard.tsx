"use client";

import { useState } from "react";
import { numberLabel, type PokemonTile } from "@/lib/pokemon/client";
import { PK } from "@/lib/pokemon/copy";
import { formatCents } from "@/lib/money";
import { HeartIcon } from "./icons";

/**
 * A card picture at tile size. Its own photo (`card_photos`) wins over the catalog picture; a card
 * with no picture, or one that does not load, shows a neutral placeholder with its name.
 */
export function PokemonArt({ tile, children }: { tile: PokemonTile; children?: React.ReactNode }) {
  const photoSrc = tile.photoId ? `/api/card-photo/${tile.photoId}` : null;
  const [failed, setFailed] = useState<string | null>(null);
  const src = photoSrc && failed !== photoSrc ? photoSrc : tile.imageLow;
  const show = src && failed !== src ? src : null;
  return (
    <div className="pk-art">
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={show} alt={`${tile.name}, ${tile.setName} ${numberLabel(tile)}`} loading="lazy" decoding="async" width={245} height={342} onError={() => setFailed(show)} />
      ) : (
        <div className="pk-noimg" role="img" aria-label={`${PK.common.noImage}: ${tile.name}`}>
          {tile.name}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * One tile of a grid: the picture (tap opens the viewer), an optional owned count and a heart that
 * toggles the wish at once, and a caption with the name, set, number and price.
 */
export function PokemonTileCard({
  tile,
  onOpen,
  owned = 0,
  ownedLabel,
  deckCount = 0,
  wished,
  onToggleWish,
  caption,
  photo = false,
  onAdd,
  addLabel,
  inTarget = 0,
}: {
  tile: PokemonTile;
  onOpen: () => void;
  /** The viewer's own copies, shown as a badge. */
  owned?: number;
  /** What the badge says (default "✓ n"); the collection says "×n". */
  ownedLabel?: (n: number) => string;
  deckCount?: number;
  /** Omit for a tile without a heart. */
  wished?: boolean;
  onToggleWish?: (tile: PokemonTile) => void;
  /** Extra caption line, e.g. the owner an SL is looking at. */
  caption?: React.ReactNode;
  /** The tile shows the viewer's own photo. */
  photo?: boolean;
  /** Entdecken for a deck (`?deck=`): a "＋" on the picture that puts one copy into that deck. */
  onAdd?: (tile: PokemonTile) => void;
  /** Its spoken label ("Glurak ins Deck „Feuer“ legen"). */
  addLabel?: string;
  /** Copies already in the deck Entdecken was opened for. */
  inTarget?: number;
}) {
  const [pulse, setPulse] = useState(false);
  const line = [tile.setName, numberLabel(tile)].filter(Boolean).join(" · ");
  return (
    <div className="pk-tilewrap">
      <div className="pk-artbox">
      <button type="button" className="pk-tile" onClick={onOpen} aria-label={`${tile.name}, ${line}`}>
        <PokemonArt tile={tile}>
          {photo ? <span className="pk-cam">{PK.collection.ownPhoto}</span> : null}
          {owned > 0 ? <span className="pk-badge">{(ownedLabel ?? PK.discover.ownedBadge)(owned)}</span> : null}
          {deckCount > 0 ? <span className="pk-badge pk-badge-deck">{PK.collection.inDecks(deckCount)}</span> : null}
          {inTarget > 0 ? <span className="pk-badge pk-badge-in">{PK.discover.inTargetDeck(inTarget)}</span> : null}
        </PokemonArt>
      </button>
      {onAdd ? (
        <button
          type="button"
          className="pk-addbtn"
          aria-label={addLabel ?? PK.discover.addToDeck}
          data-pulse={pulse ? "1" : "0"}
          onClick={() => {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 200);
            onAdd(tile);
          }}
        >
          <span aria-hidden>＋</span>
        </button>
      ) : null}
      {wished !== undefined && onToggleWish ? (
        <button
          type="button"
          className="pk-heart"
          aria-pressed={wished}
          aria-label={PK.verbs.wishAria(tile.name, wished)}
          data-pulse={pulse ? "1" : "0"}
          onClick={() => {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 200);
            onToggleWish(tile);
          }}
        >
          <span>
            <HeartIcon />
          </span>
        </button>
      ) : null}
      </div>
      <div className="pk-cap">
        <b>{tile.name}</b>
        <span>
          {line}
          {tile.priceCents != null ? ` · ${formatCents(tile.priceCents)}` : ""}
        </span>
        {caption}
      </div>
    </div>
  );
}

/** Grey tiles in the final layout while a page loads. */
export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="pk-grid" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="pk-skel" />
          <div className="pk-skel-line" />
        </div>
      ))}
    </div>
  );
}

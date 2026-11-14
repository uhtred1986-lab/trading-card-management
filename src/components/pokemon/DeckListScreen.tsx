import Link from "next/link";
import { PK } from "@/lib/pokemon/copy";
import type { PokemonDeckListEntry } from "@/lib/pokemon/deck-data";
import { PageTop } from "./PageTop";
import { PokemonDeckWithClaude } from "./ClaudeBuild";
import { MiniArt, StatusPill } from "./DeckParts";

/**
 * Decks: large rows with a card picture, the name, "47 / 60 Karten · Standard" and the legality badge.
 * One sentence and one button when there is none. An SL sees every player's decks, labelled by owner.
 */
export function DeckListScreen({ decks, showOwners, claudeEnabled }: { decks: PokemonDeckListEntry[]; showOwners: boolean; claudeEnabled: boolean }) {
  return (
    <div className="pk-area">
      <PageTop title={showOwners ? PK.decks.listTitleAll : PK.decks.listTitle} sub={decks.length ? PK.decks.deckCount(decks.length) : undefined} />

      {decks.length === 0 ? (
        <div className="pk-panel pk-empty">
          <p>{PK.decks.empty}</p>
          <Link href="/pokemon/decks/new" prefetch={false} className="pk-cta">
            {PK.decks.emptyAction}
          </Link>
        </div>
      ) : (
        <ul className="pk-decklist">
          {decks.map((d) => (
            <li key={d.id}>
              <Link href={`/pokemon/decks/${d.id}`} prefetch={false} className="pk-deckrow">
                <MiniArt src={d.cover?.image ?? null} name={d.cover?.name ?? PK.decks.noCover} label={d.cover?.name ?? ""} />
                <span>
                  <b>{d.name}</b>
                  <small>{PK.decks.rowLine(d.count, PK.decks.formatNames[d.format] ?? d.format)}</small>
                  {showOwners ? <small className="pk-owner">{PK.decks.ownerLabel(d.owner)}</small> : null}
                </span>
                <span className="pk-badges">
                  <StatusPill status={d.status} />
                  {d.isBuilt ? (
                    <span className="pk-pillstate" data-built="1">
                      {PK.decks.builtBadge}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="pk-buttons">
        {decks.length > 0 ? (
          <Link href="/pokemon/decks/new" prefetch={false} className="pk-cta">
            {PK.decks.newDeck}
          </Link>
        ) : null}
        <PokemonDeckWithClaude enabled={claudeEnabled} />
      </div>
    </div>
  );
}

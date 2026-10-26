import Link from "next/link";
import { GAME_INFO, type Game } from "@/lib/catalog/games";
import { GameMark } from "@/components/GameMark";

/**
 * Which game to play (F1-12). With ready decks of two games: the two official tiles side by side as a
 * radio group of links (`?game=`), the same pattern as `GameFilter`, so it is one tap and survives a
 * reload. The chosen tile is full colour with an accent ring, the other dimmed. With one game there is
 * nothing to choose, so a single logo says which game this is.
 */
export function GameSwitch({ games, chosen, hrefFor }: { games: readonly Game[]; chosen: Game; hrefFor: (g: Game) => string }) {
  if (games.length < 2) {
    return <GameMark game={games[0] ?? chosen} size="logo" />;
  }
  return (
    <div role="radiogroup" aria-label="Game to play" className="grid max-w-xl grid-cols-2 gap-3" data-game-switch>
      {games.map((g) => {
        const on = g === chosen;
        return (
          <Link
            key={g}
            href={hrefFor(g)}
            replace
            scroll={false}
            role="radio"
            aria-checked={on}
            aria-label={GAME_INFO[g].label}
            data-game-tile={g}
            className={`tap block min-w-0 rounded-xl bg-space-900 p-0.5 transition ${on ? "ring-2 ring-offset-2 ring-offset-space-950" : "opacity-60 saturate-50 hover:opacity-90"}`}
            style={on ? ({ "--tw-ring-color": GAME_INFO[g].art.accent } as React.CSSProperties) : undefined}
          >
            <GameMark game={g} size="tile" />
          </Link>
        );
      })}
    </div>
  );
}

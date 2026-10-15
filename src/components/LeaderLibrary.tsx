import Link from "next/link";
import { COLORS } from "@/lib/catalog/queries";
import { GameFilter } from "@/components/GameFilter";
import { mainCountLabel, mainCountOk } from "@/lib/decks/legality";
import { DeckStatusBadge } from "@/components/DeckStatusBadge";
import { BuildDeckButton } from "@/components/BuildDeckButton";
import { CardFaces } from "@/components/CardFaces";
import { DeckDescription } from "@/components/DeckDiscovery";
import { ColorPill, RarityBadge } from "@/components/ColorPill";

import { GAMES, GAME_INFO, type Game } from "@/lib/catalog/games";
import type { OwnedLeader } from "@/lib/leaders/queries";
import { PageHeader, SectionTabs } from "@/components/ui";
import { ActiveFilterChips, FilterBar } from "@/components/ui";

export function LeaderLibrary({ all, game, color, q = "", set = "", usage = "", aiEnabled }: {
  all: OwnedLeader[]; game?: Game; color?: string; q?: string; set?: string; usage?: string; aiEnabled: boolean;
}) {
  const ofColour = color ? all.filter((l) => l.colors.includes(color)) : all;
  const inGame = game ? ofColour.filter((l) => l.game === game) : ofColour;
  const sets = [...new Map(inGame.map((l) => [l.setCode, l.setName])).entries()];
  const words = q.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const leaders = inGame.filter((l) => {
    const text = [l.name, l.backName, l.id, ...l.decks.flatMap((d) => [d.name, d.description])].join(" ").toLocaleLowerCase();
    return words.every((w) => text.includes(w)) && (!set || l.setCode === set)
      && (!usage || (usage === "built" ? l.decks.some((d) => d.isBuilt) : usage === "with" ? l.decks.length > 0 : l.decks.length === 0));
  });
  // The chosen game stays offered even when the colour filter empties it.
  const gamesPresent = GAMES.filter((g) => g === game || ofColour.some((l) => l.game === g));
  const withDeck = leaders.filter((l) => l.decks.length).length;
  const built = leaders.filter((l) => l.decks.some((d) => d.isBuilt)).length;
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  return (
    <div className="space-y-4">
      <PageHeader title="My leaders" eyebrow="Cards" description={`${leaders.length} leaders owned · ${withDeck} with a deck · ${built} built`} actions={<Link href="/cards?type=LEADER" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          Browse all leaders
        </Link>} />
      <SectionTabs items={[{href:"/cards",label:"Catalog"},{href:"/leaders",label:"Leaders",active:true},{href:"/collection",label:"Collection"},{href:"/decks",label:"Decks"}]} />

      <GameFilter path="/leaders" params={{ color, q, set, usage }} game={game} available={gamesPresent} />

      <form action="/leaders" className="space-y-2">
        <FilterBar summary={`${leaders.length} matching leaders`} active={<ActiveFilterChips path="/leaders" params={{q,game,color,set,usage}} keys={["q", "color", "set", "usage"]} />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="col-span-2 text-xs text-space-300">Find a leader<input type="search" name="q" defaultValue={q} placeholder="Name, card number, deck strategy…" className={`${select} block w-full`} /></label>
        {game ? <input type="hidden" name="game" value={game} /> : null}
        <select aria-label="Leader colour" name="color" defaultValue={color ?? ""} className={select}>
          <option value="">Any colour</option>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        </div>
        </FilterBar>
        <details className="ds-more-filters"><summary className="tap ds-button-secondary">More filters</summary><div className="grid grid-cols-2 gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 sm:flex sm:flex-wrap sm:items-end">
        <label className="min-w-0 text-xs text-space-300">Set<select name="set" defaultValue={set} className={`${select} block w-full`}><option value="">Any set</option>{sets.map(([code,name]) => <option key={code} value={code}>{code} · {name}</option>)}</select></label>
        <label className="min-w-0 text-xs text-space-300">Deck availability<select name="usage" defaultValue={usage} className={`${select} block w-full`}><option value="">Any leader</option><option value="with">Has a deck</option><option value="without">No deck yet</option><option value="built">Has a built deck</option></select></label>
        <button className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">Filter</button>
        {color || q || set || usage ? (
          <Link href={game ? `/leaders?game=${game}` : "/leaders"} className="text-xs text-space-300 hover:text-ki-300">
            Clear
          </Link>
        ) : null}
        </div></details>
      </form>

      {leaders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-space-700 p-8 text-center text-sm text-space-300">
          <p>{color ? `No ${color.toLowerCase()} leaders in your collection.` : "No leaders match these filters. Clear filters or add leaders to your collection."}</p>
          <p className="mt-1">
            <Link href="/add" className="text-ki-300 hover:underline">
              Add cards
            </Link>{" "}
            or pick one from the{" "}
            <Link href="/cards?type=LEADER" className="text-ki-300 hover:underline">
              catalog
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {leaders.map((l) => (
            <li key={l.id} className="flex gap-3 rounded-xl border border-space-700/70 bg-space-900/60 p-3">
              <div className="w-24 shrink-0 sm:w-28">
                <CardFaces front={l.imageUrl} back={l.backImageUrl} name={l.name} backName={l.backName} layout="flip" sizes="112px" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-w-0">
                  <Link href={`/cards/${encodeURIComponent(l.id)}`} className="block break-words font-medium text-space-50 hover:text-ki-300">
                    {l.name}
                  </Link>
                  {l.backName ? <div className="break-words text-xs text-space-300">↻ {l.backName}</div> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-space-300">
                    <span className="font-mono">{l.id}</span>
                    {l.game !== "dbs" ? <span className="rounded border border-space-600 px-1 text-[10px] uppercase">{GAME_INFO[l.game].short}</span> : null}
                    <RarityBadge code={l.rarityCode} />
                    {l.colors.map((c) => (
                      <ColorPill key={c} color={c} small />
                    ))}
                    <span className="ml-auto rounded bg-ki-500/15 px-1.5 font-semibold text-ki-300">×{l.owned}</span>
                  </div>
                </div>

                <div className="text-xs">
                  {l.decks.length === 0 ? (
                    <span className="rounded bg-space-800 px-1.5 py-0.5 text-space-300">No deck yet</span>
                  ) : (
                    <ul className="space-y-1">
                      {l.decks.map((d) => (
                        <li key={d.id} className="space-y-1">
                          <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${d.isBuilt ? "bg-ki-500 text-space-950" : "bg-space-700 text-space-200"}`}>
                            {d.isBuilt ? "Built" : "Virtual"}
                          </span>
                          <Link href={`/decks/${d.id}`} className="block break-words text-space-100 hover:text-ki-300">
                            {d.name}
                          </Link>
                          <DeckDescription text={d.description} />
                          <DeckStatusBadge status={d.status} small />
                          <span className={`ml-auto shrink-0 ${mainCountOk(d.mainCount, d.game) ? "text-space-400" : "text-ki-300"}`}>{mainCountLabel(d.mainCount, d.game)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-auto">
                  <BuildDeckButton leaderId={l.id} enabled={aiEnabled} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-space-400">
        &ldquo;Build a deck&rdquo; asks Claude for a full 50-card list around that leader, using the on-colour cards you own first and adding cards to buy only where they matter. The result is saved
        as a new <em>virtual</em> deck with the shopping list in its description — nothing is reserved until you mark it built.
      </p>
    </div>
  );
}

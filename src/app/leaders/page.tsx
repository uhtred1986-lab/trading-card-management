import Link from "next/link";
import { db } from "@/db";
import { hasAnthropic } from "@/lib/ai/client";
import { RULES } from "@/lib/decks/queries";
import { ownedLeaders } from "@/lib/leaders/queries";
import { BuildDeckButton } from "@/components/BuildDeckButton";
import { CardFaces } from "@/components/CardFaces";
import { ColorPill, RarityBadge } from "@/components/ColorPill";

export const dynamic = "force-dynamic";
/** Deck drafting is a long Claude call. */
export const maxDuration = 300;

export default async function LeadersPage() {
  const leaders = await ownedLeaders(db);
  const aiEnabled = hasAnthropic();
  const withDeck = leaders.filter((l) => l.decks.length).length;
  const built = leaders.filter((l) => l.decks.some((d) => d.isBuilt)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">My leaders</h1>
          <p className="text-sm text-space-300">
            {leaders.length} leader{leaders.length === 1 ? "" : "s"} owned · {withDeck} with a deck · {built} built
          </p>
        </div>
        <Link href="/cards?type=LEADER" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          Browse all leaders
        </Link>
      </div>

      {leaders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-space-700 p-8 text-center text-sm text-space-300">
          <p>No leaders in your collection yet.</p>
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
                  <Link href={`/cards/${encodeURIComponent(l.id)}`} className="block truncate font-medium text-space-50 hover:text-ki-300">
                    {l.name}
                  </Link>
                  {l.backName ? <div className="truncate text-xs text-space-300">↻ {l.backName}</div> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-space-300">
                    <span className="font-mono">{l.id}</span>
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
                        <li key={d.id} className="flex items-center gap-1.5">
                          <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${d.isBuilt ? "bg-ki-500 text-space-950" : "bg-space-700 text-space-200"}`}>{d.isBuilt ? "Built" : "Virtual"}</span>
                          <Link href={`/decks/${d.id}`} className="min-w-0 truncate text-space-100 hover:text-ki-300">
                            {d.name}
                          </Link>
                          <span className={`ml-auto shrink-0 ${d.mainCount === RULES.main ? "text-space-400" : "text-ki-300"}`}>
                            {d.mainCount}/{RULES.main}
                          </span>
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
        &ldquo;Build a deck&rdquo; asks Claude for a full 50-card list around that leader, using the on-colour cards you own first and adding cards to buy only where they matter. The result is saved as a new <em>virtual</em> deck with the shopping list in its description — nothing is reserved until you mark it built.
      </p>
    </div>
  );
}

import Link from "next/link";
import { db } from "@/db";
import { listDecks } from "@/lib/decks/queries";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { GAMES, parseGame } from "@/lib/catalog/games";
import { GameFilter, GameSelect } from "@/components/GameFilter";
import { NewDeckWithClaude } from "@/components/NewDeckWithClaude";
import { NewDeckFromCard } from "@/components/NewDeckFromCard";
import { hasAnthropic } from "@/lib/ai/client";
import { SubmitButton } from "@/components/SubmitButton";
import { DeckDiscovery } from "@/components/DeckDiscovery";
import { createDeckForm } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function DecksPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireSignedInPage();
  const sp = await searchParams;
  const raw = Array.isArray(sp.show) ? sp.show[0] : sp.show;
  const show: "all" | "built" | "virtual" = raw === "built" || raw === "virtual" ? raw : "all";
  const game = parseGame(Array.isArray(sp.game) ? sp.game[0] : sp.game);
  const all = await listDecks(db, { viewer: await currentScope() });
  const gamesPresent = GAMES.filter((g) => all.some((d) => d.game === g));
  const decks = game ? all.filter((d) => d.game === game) : all;
  const built = decks.filter((d) => d.isBuilt);
  const virtual = decks.filter((d) => !d.isBuilt);
  const visible = decks.filter((d) => show === "all" || (show === "built" ? d.isBuilt : !d.isBuilt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">Decks</h1>
          <p className="text-sm text-space-300">
            {built.length} built · {virtual.length} virtual
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href="/leaders" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
            My leaders
          </Link>
          <NewDeckWithClaude enabled={hasAnthropic()} />
          <NewDeckFromCard enabled={hasAnthropic()} />
          <form action={createDeckForm} className="flex w-full flex-wrap gap-2 sm:w-auto">
            <input aria-label="New deck name" name="name" placeholder="New deck name" className="tap min-w-0 flex-1 rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100" />
            {/* A deck belongs to one game from the moment it exists — its rules
                and the cards its builder offers both follow from this. */}
            <GameSelect value={game} className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100" />
            <SubmitButton pendingLabel="Creating…" className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400">
              Create
            </SubmitButton>
          </form>
        </div>
      </div>

      <GameFilter path="/decks" params={{ show: show === "all" ? undefined : show }} game={game} available={gamesPresent} />

      {decks.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all", label: "All", n: decks.length },
              { key: "built", label: "Built", n: built.length },
              { key: "virtual", label: "Virtual", n: virtual.length },
            ] as const
          ).map((f) => (
            <Link
              key={f.key}
              href={`/decks?${new URLSearchParams({ ...(f.key === "all" ? {} : { show: f.key }), ...(game ? { game } : {}) }).toString()}`}
              aria-current={show === f.key}
              className={`tap rounded-lg border px-2.5 py-1 text-sm transition-colors ${
                show === f.key ? "border-ki-500 bg-ki-500/10 text-space-50" : "border-space-700 text-space-300 hover:border-space-500"
              }`}
            >
              {f.label} <span className="tabular-nums text-space-400">{f.n}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <p className="rounded-xl border border-space-700/70 bg-space-900/40 p-3 text-xs text-space-300">
        <span className="font-semibold text-ki-300">Built</span> decks are physical stacks: every copy they contain is reserved from your collection, and a deck can only be marked built while you own
        enough copies for it and every other built deck. <span className="font-semibold text-space-100">Virtual</span> decks are unlimited and can use any card.
      </p>

      {decks.length === 0 ? <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-space-300">No decks yet — create one above.</p> : null}

      {decks.length > 0 && <DeckDiscovery label="Browse decks" decks={visible.map((d) => ({
        id: String(d.id), name: d.name, description: d.description, leaderName: d.leader?.name ?? null,
        leaderId: d.leaderId, colors: d.leader?.colors ?? [], leaderImage: d.leader?.imageUrl,
        group: d.isBuilt ? "Built" : "Virtual", mainCount: d.mainCount, status: d.legality.status,
        note: [d.locationName, ...d.legality.issues.map((i) => i.message)].filter(Boolean).join(" · "), href: `/decks/${d.id}`,
      }))} />}

    </div>
  );
}

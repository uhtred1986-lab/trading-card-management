import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getDeck, ZONE_LABEL, ZONES, zonesFor, deckToText } from "@/lib/decks/queries";
import { copyLimit, mainCountLabel, mainCountOk, type DeckLegality } from "@/lib/decks/legality";
import { deckRules, GAME_INFO, type Game } from "@/lib/catalog/games";
import { GameSelect } from "@/components/GameFilter";
import { CardFlagBadge, DeckStatusBadge } from "@/components/DeckStatusBadge";
import { buildConflicts, decksReservingFor } from "@/lib/decks/reservations";
import { CardFaces } from "@/components/CardFaces";
import { CardImage } from "@/components/CardImage";
import { ColorPill } from "@/components/ColorPill";
import { DeckBuilder } from "@/components/DeckBuilder";
import { DeckAI } from "@/components/DeckAI";
import { SwapSuggestions } from "@/components/SwapSuggestions";
import { suggestionsForDeck } from "@/lib/decks/swaps";
import { listLocations } from "@/lib/collection/locations";
import { DeckLocationPicker } from "@/components/DeckLocationPicker";
import { hasAnthropic } from "@/lib/ai/client";
import { BuiltToggle } from "@/components/BuiltToggle";
import { DeckCardControls } from "@/components/DeckCardControls";
import { deleteDeckForm, duplicateDeckForm, importDeckListForm, updateDeckForm } from "../actions";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const deck = await getDeck(db, id);
  if (!deck) notFound();
  const conflicts = deck.isBuilt ? [] : await buildConflicts(db, id);
  const tiedUpIds = conflicts.filter((c) => c.reservedElsewhere > 0).map((c) => c.cardId);
  // Archived places are listed too, so a deck already filed in one still shows
  // where it is.
  const [suggestions, locations, reserversMap] = await Promise.all([
    suggestionsForDeck(db, id),
    listLocations(db),
    tiedUpIds.length ? decksReservingFor(db, tiedUpIds, id) : Promise.resolve(new Map<string, { id: number; name: string; quantity: number }[]>()),
  ]);
  const reservers = Object.fromEntries(reserversMap);
  const deckLocation = locations.find((l) => l.id === deck.locationId) ?? null;
  const leader = deck.cards.find((c) => c.zone === "leader");
  const rules = deckRules(deck.game);
  // A zone the game does not have is still shown when something is sitting in
  // it, so cards can never go missing behind a rule change.
  const zones = ZONES.filter((z) => zonesFor(deck.game).includes(z) || deck.cards.some((c) => c.zone === z));
  const input = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className={`shrink-0 ${leader?.backImageUrl ? "w-48 sm:w-64" : "w-24 sm:w-32"}`}>
          <CardFaces front={leader?.imageUrl} back={leader?.backImageUrl} name={leader?.name ?? "No leader"} backName={leader?.backName} sizes="128px" priority />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/decks" className="text-xs text-space-300 hover:text-ki-300">
              ← Decks
            </Link>
            {deck.isBuilt ? <span className="rounded bg-ki-500 px-1.5 py-px text-[10px] font-bold uppercase text-space-950">Built</span> : <span className="rounded bg-space-800 px-1.5 py-px text-[10px] font-bold uppercase text-space-300">Virtual</span>}
            <DeckStatusBadge status={deck.legality.status} />
            {deckLocation ? (
              <Link href={`/collection?view=list&location=${deckLocation.id}`} className="rounded border border-space-700 px-1.5 py-px text-[11px] text-space-300 hover:border-space-500 hover:text-space-100">
                📍 {deckLocation.name}
              </Link>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold text-space-50">{deck.name}</h1>
          <div className="flex flex-wrap items-center gap-1 text-sm text-space-300">
            {leader ? (
              <>
                <span className="text-space-100">{leader.name}</span>
                {leader.colors.map((c) => (
                  <ColorPill key={c} color={c} small />
                ))}
              </>
            ) : (
              "No leader — add one from the search panel."
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Stat label="Main" value={mainCountLabel(deck.legality.mainCount, deck.game)} warn={!mainCountOk(deck.legality.mainCount, deck.game)} />
            {/* Fusion World has no Z-Deck, so the tile only appears when the
                game has one — or when stray Z-cards need pointing at. */}
            {rules.zMax > 0 || deck.legality.zCount > 0 ? (
              <Stat label="Z-Deck" value={`${deck.legality.zCount}/${rules.zMax}`} warn={deck.legality.zCount > rules.zMax} />
            ) : null}
            <Stat label="Leader" value={`${deck.legality.leaderCount}`} warn={deck.legality.leaderCount !== 1} />
            <Stat label="Game" value={GAME_INFO[deck.game].short} />
          </div>
          <DeckIssues legality={deck.legality} game={deck.game} />
          <BuiltToggle deckId={deck.id} isBuilt={deck.isBuilt} initialConflicts={conflicts} reservers={reservers} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(300px,380px)]">
        <div className="space-y-4">
          {zones.map((zone) => {
            const rows = deck.cards.filter((c) => c.zone === zone);
            if (!rows.length && zone !== "main") return null;
            const total = rows.reduce((n, r) => n + r.quantity, 0);
            return (
              <section key={zone}>
                <h2 className="mb-1 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wider text-space-300">
                  {ZONE_LABEL[zone]}
                  <span className="text-xs font-normal normal-case">{total} card{total === 1 ? "" : "s"}</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-space-700 p-4 text-center text-sm text-space-300">Search on the right to add cards.</p>
                ) : (
                  <ul className="divide-y divide-space-800 rounded-xl border border-space-700/70">
                    {rows.map((r) => (
                      <li key={`${r.zone}:${r.cardId}`} className="px-2 py-1.5 text-sm">
                        <div className="flex items-center gap-2">
                        <div className="w-9 shrink-0">
                          <CardImage src={r.imageUrl} alt={r.name} sizes="36px" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link href={`/cards/${encodeURIComponent(r.cardId)}`} className="block truncate font-medium text-space-50 hover:text-ki-300">
                            {r.name}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1 text-[11px] text-space-300">
                            <span className="font-mono">{r.cardId}</span>
                            {r.energyCost ? <span>· {r.energyCost} energy</span> : null}
                            {r.power ? <span>· {r.power.toLocaleString()}</span> : null}
                            {deck.legality.flags[`${r.zone}:${r.cardId}`] ? <CardFlagBadge {...deck.legality.flags[`${r.zone}:${r.cardId}`]} /> : null}
                            <span
                              className={`ml-1 rounded px-1 ${
                                r.alloc.owned >= r.quantity ? "bg-gain/15 text-gain" : r.alloc.owned > 0 ? "bg-dbs-yellow/15 text-yellow-200" : "bg-space-800 text-space-400"
                              }`}
                              title="owned / reserved by built decks / available"
                            >
                              own {r.alloc.owned} · res {r.alloc.reserved} · free {r.alloc.available}
                            </span>
                          </div>
                        </div>
                        <DeckCardControls deckId={deck.id} cardId={r.cardId} zone={r.zone} quantity={r.quantity} limit={copyLimit(r, deck.game)} />
                        </div>
                        {suggestions.get(r.cardId)?.length ? <SwapSuggestions deckId={deck.id} zone={r.zone} suggestions={suggestions.get(r.cardId)!} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <aside className="space-y-4">
          <DeckBuilder deckId={deck.id} game={deck.game} />
          <DeckAI
            deckId={deck.id}
            aiSummary={deck.aiSummary}
            aiSummaryAt={deck.aiSummaryAt?.toISOString() ?? null}
            enabled={hasAnthropic()}
            openSuggestions={[...suggestions.values()].reduce((n, l) => n + l.length, 0)}
          />

          <details className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-space-100">Deck details & notes</summary>
            <form action={updateDeckForm} className="mt-2 space-y-2">
              <input type="hidden" name="id" value={deck.id} />
              <label className="block text-xs text-space-300">
                Name
                <input name="name" defaultValue={deck.name} className={input} />
              </label>
              <label className="block text-xs text-space-300">
                Game <span className="text-space-400">(decides which rules apply and which cards the search offers)</span>
                <GameSelect value={deck.game} className={input} />
              </label>
              <label className="block text-xs text-space-300">
                Description
                <textarea name="description" defaultValue={deck.description ?? ""} rows={2} className={input} />
              </label>
              <label className="block text-xs text-space-300">
                Meta notes <span className="text-space-400">(given to the AI wizard)</span>
                <textarea name="metaNotes" defaultValue={deck.metaNotes ?? ""} rows={3} className={input} placeholder="What's popular locally, what you keep losing to…" />
              </label>
              <button className="tap rounded-md bg-space-700 px-3 py-1.5 text-sm text-space-50 hover:bg-space-600">Save</button>
            </form>
            {/* Outside the form: it saves on its own, so Save can't clobber it. */}
            <div className="mt-2 border-t border-space-700/70 pt-2">
              <DeckLocationPicker deckId={deck.id} locationId={deck.locationId} locations={locations} isBuilt={deck.isBuilt} />
            </div>
          </details>

          <details className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-space-100">Import / export list</summary>
            <form action={importDeckListForm} className="mt-2 space-y-2">
              <input type="hidden" name="id" value={deck.id} />
              <textarea name="list" rows={6} className={`${input} font-mono text-xs`} placeholder={"# Leader\n1 BT18-001\n# Main deck\n4 BT18-020\n…"} />
              <button className="tap rounded-md bg-space-700 px-3 py-1.5 text-sm text-space-50 hover:bg-space-600">Import lines</button>
            </form>
            <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-space-950 p-2 font-mono text-[11px] text-space-300">{deckToText(deck.cards) || "(empty)"}</pre>
          </details>

          <div className="flex flex-wrap gap-2">
            <form action={duplicateDeckForm}>
              <input type="hidden" name="id" value={deck.id} />
              <button className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">Duplicate</button>
            </form>
            <form action={deleteDeckForm}>
              <input type="hidden" name="id" value={deck.id} />
              <button className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-300 hover:bg-space-800 hover:text-loss">Delete deck</button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 ${warn ? "border-ki-500/40 text-ki-300" : "border-space-700 text-space-200"}`}>
      {label} <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

/**
 * Nothing here blocks anything: an illegal or half-finished deck saves fine,
 * this just says what a judge would say about it.
 */
function DeckIssues({ legality, game }: { legality: DeckLegality; game: Game }) {
  const RULES = deckRules(game);
  // Keywords like [Dragon Ball] carry their own limit, printed on the card.
  const rules = legality.keywordRules.length ? (
    <p className="text-[11px] text-space-400">
      Card rules in play:{" "}
      {legality.keywordRules.map((r) => (
        <span key={r.keyword} className="mr-2">
          <span className="text-space-200">[{r.keyword}]</span>{" "}
          <span className={`tabular-nums ${r.used > r.max ? "text-loss" : ""}`}>
            {r.used}/{r.max}
          </span>
          {r.unlimitedCopies ? " (any mix of copies)" : null}
        </span>
      ))}
    </p>
  ) : null;

  if (legality.status === "legal" && legality.issues.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-gain">
          Tournament-legal: one leader, {RULES.main}–{RULES.mainMax} cards, copy limits respected.
        </p>
        {rules}
      </div>
    );
  }
  const groups = [
    { severity: "illegal" as const, title: "Breaks a rule", cls: "text-loss" },
    { severity: "incomplete" as const, title: "Still to do", cls: "text-ki-300" },
    { severity: "warning" as const, title: "Worth a look", cls: "text-yellow-200" },
  ];
  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const list = legality.issues.filter((i) => i.severity === g.severity);
        if (list.length === 0) return null;
        return (
          <div key={g.severity} className="text-xs">
            <span className={`font-semibold ${g.cls}`}>{g.title}:</span>{" "}
            <span className="text-space-300">{list.map((i) => i.message).join(" ")}</span>
          </div>
        );
      })}
      {rules}
      <p className="text-[11px] text-space-400">Saved either way — the deck is only flagged, never blocked.</p>
    </div>
  );
}

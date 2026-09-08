import Link from "next/link";
import { db } from "@/db";
import { ConfirmAll } from "@/components/arena/rules/ConfirmAll";
import { RulesHeader } from "@/components/arena/rules/RulesHeader";
import { Segments, Workbench, chipClass, statusRank } from "@/components/arena/rules/Workbench";
import { mechanismOf, PHRASING_ONLY } from "@/lib/arena/gaps";
import { deckInputFor } from "@/lib/arena/load";
import { countRules, worklist, type RuleStatus, type WorklistRow } from "@/lib/arena/rules-store";
import { listDecks } from "@/lib/decks/queries";
import { lastSyncRuns } from "@/lib/sync";
import { recentBatches } from "../actions";
import { buildRecord, historyOf, probeScenarios } from "./record";

export const dynamic = "force-dynamic";

/**
 * The rules of the cards in the decks the arena can play: the worklist that is
 * worth working through first, because these are the skills a game will
 * actually reach. `/arena/rules/all` is the same list over the catalog.
 */
type Row = WorklistRow & { decks: string[] };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const seg = one(sp.seg) || "all";
  const deckParam = one(sp.deck);
  const mech = one(sp.mech);
  const claudeOnly = one(sp.claude) === "1";
  const q = one(sp.q).trim().toLowerCase();
  const ruleParam = Number(one(sp.rule)) || null;

  // The cards in the decks the arena can play: the worklist's default scope.
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const deckCards = new Map<number, Set<string>>();
  const decksOf = new Map<string, string[]>();
  for (const d of decks) {
    const input = await deckInputFor(db, d.id);
    if (!input) continue;
    const ids = new Set(input.cardIds);
    deckCards.set(d.id, ids);
    for (const id of ids) decksOf.set(id, [...(decksOf.get(id) ?? []), d.name]);
  }
  const allDeckCards = [...decksOf.keys()];
  const scope = deckParam && deckCards.has(Number(deckParam)) ? [...deckCards.get(Number(deckParam))!] : allDeckCards;

  const rows: Row[] = (await worklist(db, scope)).map((r) => ({ ...r, decks: decksOf.get(r.cardId) ?? [] }));
  const mechanisms = new Map<string, number>();
  for (const r of rows) if (r.status === "open") mechanisms.set(mechanismOf(r.unread[0] ?? ""), (mechanisms.get(mechanismOf(r.unread[0] ?? "")) ?? 0) + 1);
  const claudeDrafted = rows.filter((r) => r.source === "claude" && r.status === "draft").length;

  const shown = rows
    .filter((r) => seg === "all" || r.status === seg)
    .filter((r) => !mech || (r.status === "open" && mechanismOf(r.unread[0] ?? "") === mech))
    .filter((r) => !claudeOnly || (r.source === "claude" && r.status === "draft"))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.cardId.toLowerCase().includes(q) || r.printed.toLowerCase().includes(q))
    // Inside a state, a card in more of your decks is the one to look at first.
    .sort((a, b) => statusRank(a) - statusRank(b) || b.decks.length - a.decks.length || a.name.localeCompare(b.name) || a.skillIndex - b.skillIndex);
  const counts = Object.fromEntries([["all", rows.length], ...(["open", "draft", "confirmed", "corrected"] as RuleStatus[]).map((k) => [k, rows.filter((r) => r.status === k).length])]);

  const [inDecks, catalog, syncs, batches] = await Promise.all([countRules(db, allDeckCards), countRules(db), lastSyncRuns(db), recentBatches()]);
  const lastSync = syncs.latest.get("catalog")?.summary as { stillOpen?: number; cardsNew?: number; cardsChanged?: number } | null | undefined;

  const selected = shown.find((r) => r.id === ruleParam) ?? shown[0] ?? null;
  const record = selected ? await buildRecord(db, selected, selected.decks) : null;
  const probe = selected ? await probeScenarios(db, selected) : null;

  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const cur: Record<string, string> = { seg, deck: deckParam, mech, claude: claudeOnly ? "1" : "", q, rule: ruleParam ? String(ruleParam) : "" };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) params.set(k, v);
    const s = params.toString();
    return `/arena/rules${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-3">
      <RulesHeader tab="/arena/rules" inDecks={inDecks} catalog={catalog} openSinceSync={lastSync && (lastSync.cardsNew || lastSync.cardsChanged) ? (lastSync.stillOpen ?? 0) : null} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          {decks.length === 0
            ? "No deck the arena can play yet — a deck needs a leader and 50 cards."
            : "No rules drafted for the cards in your decks yet. Run `npm run arena:draft` once; after that every new card is drafted at catalog sync."}
        </p>
      ) : (
        <Workbench
          rows={shown}
          record={record}
          history={selected ? historyOf(selected) : []}
          mechanism={record?.mechanism ?? null}
          probe={probe}
          href={(id) => href({ rule: String(id) })}
          empty="Nothing here."
          head={
            <>
              <Segments seg={seg} counts={counts} href={(key) => href({ seg: key, rule: null })} />
              <div className="flex flex-wrap gap-1.5">
                <Link href={href({ deck: null, rule: null })} className={chipClass(!deckParam)}>
                  My decks
                </Link>
                {decks.map((d) => (
                  <Link key={d.id} href={href({ deck: deckParam === String(d.id) ? null : String(d.id), rule: null })} className={chipClass(deckParam === String(d.id))}>
                    {d.name}
                  </Link>
                ))}
                {claudeDrafted > 0 && (
                  <Link href={href({ claude: claudeOnly ? null : "1", rule: null })} className={chipClass(claudeOnly)}>
                    Claude drafted — unconfirmed ({claudeDrafted})
                  </Link>
                )}
                {[...mechanisms.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, n]) => (
                    <Link key={key} href={href({ mech: mech === key ? null : key, seg: "open", rule: null })} className={chipClass(mech === key)}>
                      {key === PHRASING_ONLY ? "phrasing only" : `mechanism: ${key}`} ({n})
                    </Link>
                  ))}
              </div>
              <form action="/arena/rules" className="flex gap-1">
                {seg !== "all" && <input type="hidden" name="seg" value={seg} />}
                {deckParam && <input type="hidden" name="deck" value={deckParam} />}
                <input name="q" defaultValue={q} placeholder="find a card…" className="w-full rounded-md border border-space-600 bg-space-950 px-2 py-1 text-xs text-space-100" />
              </form>
              <ConfirmAll
                filter={{ cardIds: scope, status: "draft", mechanism: mech || undefined, q: q || undefined, source: claudeOnly ? "claude" : undefined }}
                drafts={shown.filter((r) => r.status === "draft").length}
                batches={batches}
              />
            </>
          }
        />
      )}
    </div>
  );
}

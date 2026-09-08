import Link from "next/link";
import { db } from "@/db";
import { ConfirmAll } from "@/components/arena/rules/ConfirmAll";
import { RulesHeader } from "@/components/arena/rules/RulesHeader";
import { chipClass } from "@/components/arena/rules/Workbench";
import { mechanismNeeds, PHRASING_ONLY } from "@/lib/arena/gaps";
import { deckInputFor } from "@/lib/arena/load";
import { countRules, draftPatterns, openPatterns, type PatternGroup } from "@/lib/arena/rules-store";
import { listDecks } from "@/lib/decks/queries";
import { recentBatches } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * The same rules, gathered by the wording that produced them.
 *
 * One compiler reading covers 400 cards, and confirming it once for all of
 * them is the only way 11,375 drafts are ever reviewed; one wording the
 * compiler cannot read covers as many, and one rule in `compile.ts` clears the
 * lot. So the page has two halves, and they are worked down differently:
 * drafts are confirmed here, open groups are what the compiler still owes.
 */
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PatternsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const half = one(sp.half) === "open" ? "open" : "drafts";

  const [groups, inDecks, catalog, batches] = await Promise.all([half === "drafts" ? draftPatterns(db) : openPatterns(db), deckCounts(), countRules(db), recentBatches()]);

  const rules = groups.reduce((n, g) => n + g.rules, 0);
  const cards = groups.reduce((n, g) => n + g.cards, 0);

  return (
    <div className="space-y-3">
      <RulesHeader tab="/arena/rules/patterns" inDecks={inDecks} catalog={catalog} />

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/arena/rules/patterns" className={chipClass(half === "drafts")}>
          Drafts, by the reading they came out as
        </Link>
        <Link href="/arena/rules/patterns?half=open" className={chipClass(half === "open")}>
          Open, by what the wording would need
        </Link>
        <span className="text-[11px] text-space-400">
          {groups.length} group{groups.length === 1 ? "" : "s"} · {rules} rules on {cards} cards
        </span>
      </div>

      <p className="text-xs text-space-300">
        {half === "drafts"
          ? "Each group is one reading the compiler produced for many cards. Confirming the group says that reading is right for all of them; if it is wrong, open one card and correct it — the record asks whether the pattern is wrong or only that card."
          : "Each group is one shape of wording the compiler cannot read, gathered by what it would take. A rule in compile.ts clears a whole group at once; until then the engine plays these skills as blank and says so in the log."}
      </p>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">Nothing here — run `npm run arena:draft` to fill the table.</p>
      ) : (
        <ol className="space-y-2">
          {groups.map((g) => (
            <Group key={`${g.kind}:${g.key}:${g.label}`} g={g} batches={batches} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Group({ g, batches }: { g: PatternGroup; batches: { id: number; note: string; n: number }[] }) {
  const seeAll = g.kind === "draft" ? `/arena/rules/all?seg=draft&pattern=${encodeURIComponent(g.key)}` : `/arena/rules/all?seg=open&mech=${encodeURIComponent(g.key)}`;
  return (
    <li className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="text-sm text-space-50">{g.label}</code>
        {g.mechanism && <span className={`rounded-full px-2 py-0.5 text-[10px] ${g.mechanism === PHRASING_ONLY ? "bg-space-800 text-space-300" : "bg-ki-500/15 text-ki-300"}`}>{g.mechanism}</span>}
        <span className="ml-auto shrink-0 text-xs text-space-400">
          {g.rules} rule{g.rules === 1 ? "" : "s"} on {g.cards} card{g.cards === 1 ? "" : "s"}
        </span>
      </div>

      {g.mechanism && <p className="mt-1 text-[11px] text-space-400">→ {mechanismNeeds(g.mechanism)}</p>}

      <ul className="mt-2 space-y-1.5">
        {g.examples.map((e) => (
          <li key={e.id} className="rounded-lg bg-space-950/60 p-2 text-[11px]">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <Link href={`/arena/rules/all?rule=${e.id}`} className="font-medium text-space-100 hover:text-ki-300">
                {e.name}
              </Link>
              <span className="font-mono text-[10px] text-space-500">{e.cardId}</span>
            </div>
            <p className="mt-0.5 text-space-400">{e.printed.replace(/\s+/g, " ").slice(0, 200)}</p>
            <p className={g.kind === "open" ? "text-loss" : "text-space-300"}>
              <span className="text-space-500">{g.kind === "open" ? "could not read: " : "reads as: "}</span>
              {g.kind === "open" ? e.unread.join(" | ") : e.reads || "nothing"}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {g.kind === "draft" && <ConfirmAll filter={{ pattern: g.key, status: "draft" }} drafts={g.rules} label="Confirm the pattern" batches={batches} />}
        <Link href={seeAll} className="text-[11px] text-space-400 hover:text-ki-300">
          {g.kind === "draft" ? `all ${g.rules} in the worklist →` : "these in the worklist →"}
        </Link>
      </div>
    </li>
  );
}

/** The KPI row is about your decks, on every tab. */
async function deckCounts() {
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const ids = new Set<string>();
  for (const d of decks) {
    const input = await deckInputFor(db, d.id);
    if (input) for (const id of input.cardIds) ids.add(id);
  }
  return countRules(db, [...ids]);
}

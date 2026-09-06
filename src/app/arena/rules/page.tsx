import Link from "next/link";
import { db } from "@/db";
import { RuleEditor } from "@/components/arena/RuleEditor";
import { rulesForDecks, type RuleRow } from "@/lib/arena/rules";

export const dynamic = "force-dynamic";

const TABS: { key: string; label: string; keep: (r: RuleRow) => boolean }[] = [
  { key: "referee", label: "Claude decides these", keep: (r) => r.state === "referee" },
  { key: "stored", label: "You set these", keep: (r) => r.state === "stored" },
  { key: "read", label: "The engine reads these", keep: (r) => r.state === "read" },
  { key: "all", label: "All", keep: () => true },
];

/**
 * The rules of the cards in your decks, and where to change one.
 *
 * Every skill is in one of three states, and the first tab is the one that
 * matters: those are the cards Claude has to rule on mid-game, which costs
 * tokens, takes a moment, and can be wrong. Setting a rule here moves a card
 * out of that list for good.
 */
export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "referee";
  const q = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "").trim().toLowerCase();

  const all = await rulesForDecks(db);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, all.filter(t.keep).length]));
  const keep = (TABS.find((t) => t.key === tab) ?? TABS[0]).keep;
  const rows = all.filter(keep).filter((r) => !q || r.name.toLowerCase().includes(q) || r.cardId.toLowerCase().includes(q) || r.printed.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">The rules of your cards</h1>
        <Link href="/arena/rules/keywords" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          keywords the engine knows
        </Link>
        <Link href="/arena" className="text-xs text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
      </div>
      <p className="text-sm text-space-300">
        Every skill in a deck you can play. Where the engine cannot read a card, Claude rules on it mid-game — which works, but costs tokens, takes a moment and can be
        wrong. You can set the rule yourself instead: edit the wording, read back what the engine makes of it, and keep it when it says what the card says. What the
        engine already knows by heart — every keyword skill, and the rules it reads a line by — is on{" "}
        <Link href="/arena/rules/keywords" className="text-ki-300 hover:underline">
          the keyword reference
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/arena/rules?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`tap rounded-md px-3 py-1.5 ${tab === t.key ? "bg-space-800 text-space-50" : "text-space-300"}`}>
            {t.label} ({counts[t.key]})
          </Link>
        ))}
        <form className="ml-auto" action="/arena/rules">
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} placeholder="find a card…" className="w-40 rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-xs text-space-100" />
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          {all.length === 0 ? "No deck the arena can play yet — a deck needs a leader and 50 cards." : "Nothing here."}
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <li key={`${r.cardId}#${r.side}#${r.skillIndex}`} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={`/cards/${encodeURIComponent(r.cardId)}`} className="text-sm font-medium text-space-100 hover:text-ki-300">
                  {r.name}
                </Link>
                <span className="font-mono text-[10px] text-space-500">{r.cardId}</span>
                <span className="text-[10px] text-space-500">{r.kind}</span>
                <span
                  className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    r.state === "referee" ? "bg-dbs-yellow/20 text-dbs-yellow" : r.state === "stored" ? "bg-ki-500/20 text-ki-300" : "bg-gain/15 text-gain"
                  }`}
                >
                  {r.state === "referee" ? "Claude decides" : r.state === "stored" ? "you set it" : "read"}
                </span>
              </div>

              <p className="mt-1 font-mono text-[11px] leading-relaxed text-space-300">{r.printed}</p>

              {r.state === "referee" ? (
                <p className="mt-1 text-[11px] text-dbs-yellow">could not read: {r.unsupported.join(" | ")}</p>
              ) : (
                <p className="mt-1 text-[11px] text-space-400">
                  <span className="text-space-500">the engine will: </span>
                  {r.reads || "nothing"}
                </p>
              )}

              <p className="mt-1 text-[10px] text-space-500">in {r.decks.join(", ")}</p>

              <RuleEditor cardId={r.cardId} skillIndex={r.skillIndex} side={r.side} printed={r.printed} stored={r.stored} />
            </li>
          ))}
        </ol>
      )}

      <p className="text-[11px] text-space-500">
        Would rather explain it in your own words and let Claude write the program? That is on the{" "}
        <Link href="/arena/backlog" className="text-ki-300 hover:underline">
          backlog page
        </Link>
        , which also produces the work item for teaching the compiler the wording for good — the fix that covers every card phrased the same way.
      </p>
    </div>
  );
}

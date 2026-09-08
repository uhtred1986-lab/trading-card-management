import Link from "next/link";
import type { RuleCounts, RuleStatus } from "@/lib/arena/rules-store";

/**
 * One head for the workbench's pages: which one you are on, and the four
 * numbers that say whether the rules are in a state worth playing from.
 */
const TABS: { href: string; label: string }[] = [
  { href: "/arena/rules", label: "My decks" },
  { href: "/arena/rules/all", label: "All cards" },
  { href: "/arena/rules/patterns", label: "Patterns" },
  { href: "/arena/feedback", label: "Feedback" },
];

/** What share of the rules the engine can play at all: everything but `open`. */
export function readable(c: RuleCounts): string {
  const total = (Object.keys(c) as RuleStatus[]).reduce((n, k) => n + c[k], 0);
  return total ? `${(Math.round(((total - c.open) / total) * 1000) / 10).toFixed(1)} %` : "—";
}

export function RulesHeader({ tab, inDecks, catalog, openSinceSync }: { tab: string; inDecks: RuleCounts; catalog: RuleCounts; openSinceSync?: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="text-lg font-semibold tracking-tight text-space-50">
        Arena <span className="text-ki-300">/ Rules</span>
      </h1>
      <nav className="flex flex-wrap gap-1 text-xs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`tap rounded-lg px-2.5 py-1 ${tab === t.href ? "bg-space-800 text-space-50" : "text-space-300 hover:text-space-100"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex flex-wrap gap-4 text-right">
        <Kpi n={inDecks.open} label="open in your decks" tone={inDecks.open ? "text-loss" : ""} />
        <Kpi n={inDecks.draft} label="drafts to confirm" tone={inDecks.draft ? "text-ki-300" : ""} />
        <Kpi n={readable(inDecks)} label="your decks readable" />
        <Kpi n={readable(catalog)} label="catalog readable" />
        {openSinceSync != null ? <Kpi n={openSinceSync} label="open since last sync" tone={openSinceSync ? "text-loss" : ""} /> : null}
      </div>
      <div className="flex gap-3 text-xs">
        <Link href="/arena/rules/keywords" className="text-space-300 hover:text-ki-300">
          keywords
        </Link>
        <Link href="/arena" className="text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
      </div>
    </div>
  );
}

function Kpi({ n, label, tone = "" }: { n: number | string; label: string; tone?: string }) {
  return (
    <div className="leading-tight">
      <div className={`text-base font-bold ${tone || "text-space-50"}`}>{n}</div>
      <div className="text-[10px] text-space-400">{label}</div>
    </div>
  );
}

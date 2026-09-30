import Link from "next/link";
import { getRepoUrl } from "@/lib/github";
import { ReferenceDrawer } from "@/components/arena/rules/ReferenceDrawer";
import type { RuleCounts, RuleStatus } from "@/lib/arena/rules-store";

/**
 * The one header for the Arena's two doors (docs/arena-home-spec.md §1, §2):
 * Play (`/arena`) and Rules (`/arena/rules`), plus the feedback page.
 * Not used on the board (`/arena/[id]`), which is full-bleed.
 *
 * Wide screens get an ARENA wordmark, a Play | Rules switch (real links, the
 * current one carries `aria-current="page"`) and a ⋯ menu. Phones get ARENA,
 * a Games button and ⋯, with no switch — the phone is the Arena, and the
 * Rules Workbench is made for the computer (spec decision 6).
 *
 * The menu is a `<details>`, so it needs no client code and Tab reaches it in
 * order: Play, Rules, ⋯.
 */

/** What the Rules side says about the rules: its numbers (today's `Kpi`). */
export type ArenaKpis = { inDecks: RuleCounts; catalog: RuleCounts; openSinceSync?: number | null };

/** What share of the rules the engine can play at all: everything but `open`. */
export function readable(c: RuleCounts): string {
  const total = (Object.keys(c) as RuleStatus[]).reduce((n, k) => n + c[k], 0);
  return total ? `${(Math.round(((total - c.open) / total) * 1000) / 10).toFixed(1)} %` : "—";
}

const item = "tap flex items-center rounded-md px-3 py-2 text-sm text-space-100 hover:bg-space-800";
const dim = "tap flex items-center rounded-md px-3 py-2 text-sm text-space-500";

export function ArenaHeader({ side, kpis }: { side: "play" | "rules" | "other"; kpis?: ArenaKpis }) {
  const seg = (active: boolean) => `tap flex items-center rounded-md px-4 text-sm font-medium ${active ? "bg-space-700 text-space-50" : "text-space-300 hover:text-space-100"}`;
  return (
    <header className="space-y-3">
      <div className="flex items-center gap-3">
        <Link href="/arena" className="tap flex items-center text-lg font-bold tracking-[0.2em] text-space-50">
          ARENA
        </Link>

        {/* Below `sm` there is no switch: the phone is the Arena. */}
        <nav aria-label="Arena" className="hidden gap-1 rounded-lg bg-space-900 p-1 sm:flex">
          <Link href="/arena" aria-current={side === "play" ? "page" : undefined} className={seg(side === "play")}>
            Play
          </Link>
          <Link href="/arena/rules" aria-current={side === "rules" ? "page" : undefined} className={seg(side === "rules")}>
            Rules
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/arena?tab=games#games" className="tap flex items-center rounded-md border border-space-700 px-3 text-sm text-space-200 hover:text-space-50 sm:hidden">
            Games
          </Link>
          {side === "rules" ? <ReferenceDrawer fixingHref={`${getRepoUrl()}/blob/main/docs/arena-fixing-a-card.md`} /> : null}
          <details className="relative">
            <summary
              aria-label="More"
              className="tap flex min-w-11 cursor-pointer list-none items-center justify-center rounded-md border border-space-700 px-3 text-lg leading-none text-space-200 marker:hidden [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden>⋯</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-space-700 bg-space-900 p-1 shadow-xl">
              <Link href="/arena?tab=games#games" className={item}>
                Games
              </Link>
              {/* Phone-only entries: the phone has no Play | Rules switch, and these are its friend and board doors. */}
              <div className="sm:hidden">
                <Link href="/arena#friend" className={item}>
                  Play a friend
                </Link>
                <span aria-disabled="true" className={dim}>
                  Board settings
                </span>
              </div>
              <Link href="/arena/feedback" className={item}>
                <span className="sm:hidden">Report a problem</span>
                <span className="hidden sm:inline">What you told the arena</span>
              </Link>
              <Link href="/settings#arena-engine" className={`${item} hidden sm:flex`}>
                Settings → Arena engine
              </Link>
              {/* The admin entry joins here once #350's admin check exists. */}
              <div className="mt-1 border-t border-space-700 pt-1 sm:hidden">
                <div className="px-3 pt-1 text-[10px] uppercase tracking-wider text-space-400">
                  Rules, decks and collection <span className="normal-case">· made for the computer</span>
                </div>
                <Link href="/arena/rules" className={item}>
                  Rules
                </Link>
                <Link href="/" className={item}>
                  Decks and collection
                </Link>
              </div>
            </div>
          </details>
        </div>
      </div>

      {side === "rules" && kpis ? (
        <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 sm:flex">
          <div className="flex flex-wrap gap-4">
            <Kpi n={kpis.inDecks.open} label="open in decks" tone={kpis.inDecks.open ? "text-loss" : ""} />
            <Kpi n={kpis.inDecks.draft} label="drafts to check" tone={kpis.inDecks.draft ? "text-ki-300" : ""} />
            <Kpi n={readable(kpis.inDecks)} label="decks ready" />
            <Kpi n={readable(kpis.catalog)} label="catalog readable" />
            {kpis.openSinceSync != null ? <Kpi n={kpis.openSinceSync} label="open since last sync" tone={kpis.openSinceSync ? "text-loss" : ""} /> : null}
          </div>
        </div>
      ) : null}
    </header>
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

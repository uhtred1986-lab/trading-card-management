"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PhoneAppMenu } from "./PhoneAppMenu";
import { BottomTabs } from "./BottomTabs";
import { ThemePicker } from "./ThemePicker";
import type { ArenaSkin } from "@/lib/arena/skin";
import { HeaderNav } from "./HeaderNav";
import { isArenaShell, isCardRulesPage, isFullBleed } from "@/lib/navigation";
import { useMatchOnScreen } from "@/lib/match-screen";

/**
 * The app's chrome, and the one screen that does without it.
 *
 * A game in progress gets the whole display: no header, no tab bar, and the
 * insets handled here rather than by the board, so the board can be written as
 * though it owns the screen — which on a phone, during a game, it does.
 *
 * `usePathname` is read during server rendering too, so the chrome is right on
 * the first paint and never flashes in and out.
 */
/** The whole-screen board's frame: no chrome, the insets handled here. */
const BLEED = "flex min-h-dvh w-full flex-col pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]";

/** `isSl`: an SL (or local dev) gets Settings in the navigation; a player gets their own page instead. */
export function AppShell({ children, isSl, skin }: { children: React.ReactNode; isSl: boolean; skin: ArenaSkin }) {
  const pathname = usePathname();
  // A board on a page that is not a game route (the offline shell, #783) claims the screen itself.
  const matchOnScreen = useMatchOnScreen();

  // The sign-in and join pages have nowhere to go yet: no header, no tabs.
  if (pathname === "/login" || pathname === "/join") return <main className="flex min-h-dvh w-full flex-col app-safe-x pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">{children}</main>;

  if (isFullBleed(pathname)) {
    return (
      <main
        className={BLEED}
        // Pull-to-refresh firing mid-drag and reloading a game is the worst
        // thing that can happen on this screen.
        style={{ overscrollBehavior: "none" }}
      >
        {children}
      </main>
    );
  }

  // Arena pages use their own phone header. Focused review tasks keep their own way back.
  const shell = isArenaShell(pathname);
  const focused = isCardRulesPage(pathname);

  // The tree keeps its shape when a board claims the screen (`matchOnScreen`): the header and the tabs
  // give way to null in their own slots, so the page under them — and the match it holds — is not
  // remounted.
  return (
    <>
      {matchOnScreen ? null : <header className={`ds-app-header sticky top-0 z-20 pt-[env(safe-area-inset-top)] border-b border-space-700/70 bg-space-950/85 backdrop-blur${shell ? " max-sm:hidden" : ""}`}>
        <div className="mx-auto flex max-w-7xl items-center gap-4 app-safe-x py-3">
          <Link href="/" className="tap flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-ki-400">✦ DBS</span>
            <span className="hidden text-xs uppercase tracking-widest text-space-300 min-[420px]:inline">Card Companion</span>
          </Link>
          <HeaderNav /><ThemePicker skin={skin} />
          {/* The five bottom tabs cannot grow, so everything else lives here on a phone (Arena is the first tab). */}
          {!shell && <PhoneAppMenu isSl={isSl} />}
        </div>
      </header>}

      {/* Extra bottom padding clears the phone tab bar; it collapses at `sm`. */}
      <main
        className={matchOnScreen ? BLEED : `ds-app-main mx-auto w-full max-w-7xl flex-1 app-safe-x sm:pb-8 sm:pt-5 ${
          focused ? "pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]" : "pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5"
        }`}
        style={matchOnScreen ? { overscrollBehavior: "none" } : undefined}
      >
        {children}
      </main>

      {focused || matchOnScreen ? null : <BottomTabs />}
    </>
  );
}

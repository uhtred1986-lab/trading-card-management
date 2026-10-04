"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BottomTabs } from "./BottomTabs";
import { HeaderNav } from "./HeaderNav";
import { isArenaShell, isFullBleed, secondaryItems } from "@/lib/navigation";

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
/** `isSl`: an SL (or local dev) gets Settings in the navigation; a player gets their own page instead. */
export function AppShell({ children, isSl }: { children: React.ReactNode; isSl: boolean }) {
  const pathname = usePathname();

  // The sign-in and join pages have nowhere to go yet: no header, no tabs.
  if (pathname === "/login" || pathname === "/join") return <main className="flex min-h-dvh w-full flex-col px-4">{children}</main>;

  if (isFullBleed(pathname)) {
    return (
      <main
        className="flex min-h-dvh w-full flex-col px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]"
        // Pull-to-refresh firing mid-drag and reloading a game is the worst
        // thing that can happen on this screen.
        style={{ overscrollBehavior: "none" }}
      >
        {children}
      </main>
    );
  }

  // Below `sm` an Arena page is the whole app: no header, no tab bar, insets handled here.
  const shell = isArenaShell(pathname);

  return (
    <>
      <header className={`sticky top-0 z-20 border-b border-space-700/70 bg-space-950/85 backdrop-blur${shell ? " max-sm:hidden" : ""}`}>
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="tap flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-ki-400">DBS</span>
            <span className="hidden text-xs uppercase tracking-widest text-space-300 min-[420px]:inline">Card Companion</span>
          </Link>
          <HeaderNav isSl={isSl} />
          {/* The five bottom tabs cannot grow, so everything else lives here on a phone (Arena is the first tab). */}
          <div className="ml-auto flex gap-1 sm:hidden">
            {secondaryItems(isSl).filter((item) => item.href !== "/arena").map((item) => (
              <Link key={item.href} href={item.href} className="tap flex items-center rounded-md px-2 text-xs text-space-300 hover:text-space-50">
                {item.short ?? item.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Extra bottom padding clears the phone tab bar; it collapses at `sm`. */}
      <main
        className={`mx-auto w-full max-w-7xl flex-1 px-4 sm:pb-8 sm:pt-5 ${
          shell ? "pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]" : "pb-24 pt-5"
        }`}
      >
        {children}
      </main>

      {shell ? null : <BottomTabs />}
    </>
  );
}

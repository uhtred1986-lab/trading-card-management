"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PhoneAppMenu } from "./PhoneAppMenu";
import { BottomTabs } from "./BottomTabs";
import { ThemePicker } from "./ThemePicker";
import type { ArenaSkin } from "@/lib/arena/skin";
import { HeaderNav } from "./HeaderNav";
import { DRAGON_BALL_ENTRY, NAV_ITEMS, POKEMON_NAV_ITEMS, POKEMON_SL_ENTRY, isArenaShell, isCardRulesPage, isFullBleed, isPokemonPath, usesPokemonNav } from "@/lib/navigation";
import { PK } from "@/lib/pokemon/copy";
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

/**
 * `isSl`: an SL (or local dev) gets Settings in the navigation; a player gets their own page instead.
 * `homeGame`: a player's home game (`players.home_game`); "pokemon" swaps the Dragon Ball navigation
 * for the Pokémon one on every page. Inside `/pokemon` everyone gets the Pokémon navigation and skin.
 */
export function AppShell({ children, isSl, skin, homeGame = null }: { children: React.ReactNode; isSl: boolean; skin: ArenaSkin; homeGame?: string | null }) {
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

  const pokemonNav = usesPokemonNav(pathname, homeGame);
  const pokemonArea = isPokemonPath(pathname);
  const pokemonPlayer = homeGame === "pokemon" && !isSl;
  const headerItems = pokemonNav ? (isSl ? [...POKEMON_NAV_ITEMS, DRAGON_BALL_ENTRY] : POKEMON_NAV_ITEMS) : isSl ? [...NAV_ITEMS, POKEMON_SL_ENTRY] : NAV_ITEMS;

  // The tree keeps its shape when a board claims the screen (`matchOnScreen`): the header and the tabs
  // give way to null in their own slots, so the page under them — and the match it holds — is not
  // remounted.
  const tree = (
    <>
      {matchOnScreen ? null : <header className={`ds-app-header sticky top-0 z-20 pt-[env(safe-area-inset-top)] border-b border-space-700/70 bg-space-950/85 backdrop-blur${shell ? " max-sm:hidden" : ""}`}>
        <div className="mx-auto flex max-w-7xl items-center gap-4 app-safe-x py-3">
          <Link href="/" className="tap flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-ki-400">{pokemonNav ? `✦ ${PK.appName}` : "✦ DBS"}</span>
            <span className="hidden text-xs uppercase tracking-widest text-space-300 min-[420px]:inline">{pokemonNav ? "" : "Card Companion"}</span>
          </Link>
          <HeaderNav items={headerItems} fromSm={pokemonNav} />
          {/* The Pokémon skin is the area's own: the Dragon Ball themes do not apply there. */}
          {pokemonArea ? <span className="ml-auto" /> : <ThemePicker skin={skin} />}
          {/* The five bottom tabs cannot grow, so everything else lives here on a phone (Arena is the first tab). */}
          {!shell && <PhoneAppMenu isSl={isSl} pokemonPlayer={pokemonPlayer} />}
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

      {focused || matchOnScreen ? null : <BottomTabs pokemon={pokemonNav} />}
    </>
  );
  // The Pokémon skin wraps the chrome too, so the header and the tab bar match the page.
  return pokemonArea ? (
    <div data-skin="pokemon" className="pk-root flex min-h-dvh flex-1 flex-col">
      {tree}
    </div>
  ) : (
    tree
  );
}

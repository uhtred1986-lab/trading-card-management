import { PK } from "@/lib/pokemon/copy";

/** One source of truth for the desktop header and the phone tab bar. */
export interface NavItem {
  href: string;
  label: string;
  /** Short label for the phone tab bar. */
  short?: string;
  /** The raised centre button of the Pokémon tab bar (the add sheet). */
  plus?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home" }, { href: "/collection", label: "Collection" },
  { href: "/cards", label: "Cards" }, { href: "/decks", label: "Decks" },
  { href: "/arena", label: "Arena" }, { href: "/meta", label: "Insights" },
];

/**
 * The phone tab bar, including the Arena hub: the phone is the Arena (docs/arena-home-spec.md §1,
 * decision 6), so Arena is the first tab and replaces Home, which stays one tap away on the
 * header wordmark. A phone-only list; the desktop header keeps `NAV_ITEMS`.
 */
export const PHONE_NAV_ITEMS: NavItem[] = [
  { href: "/arena", label: "Arena" }, { href: "/collection", label: "Collection" },
  { href: "/cards", label: "Cards" }, { href: "/decks", label: "Decks" }, { href: "/add", label: "Add cards", short: "Add" },
];
/**
 * The Pokémon area's navigation (docs/pokemon/design.md §2): the same five entries in the phone tab
 * bar and, from `sm`, in the header. Paths are English, labels German. `/pokemon/add` and
 * `/pokemon/decks` are built by other lanes.
 */
export const POKEMON_NAV_ITEMS: NavItem[] = [
  { href: "/pokemon", label: PK.nav.sammlung },
  { href: "/pokemon/discover", label: PK.nav.entdecken },
  { href: "/pokemon/add", label: PK.nav.add, plus: true },
  { href: "/pokemon/decks", label: PK.nav.decks },
  { href: "/pokemon/wishes", label: PK.nav.wishes },
];

/** The one Pokémon entry an SL sees beside today's Dragon Ball navigation (header and phone menu). */
export const POKEMON_SL_ENTRY: NavItem = { href: "/pokemon", label: PK.nav.pokemonEntry };

/** What a Pokémon player's phone menu holds: the tabs carry everything else. */
export const POKEMON_PLAYER_MENU: NavItem[] = [{ href: "/me", label: "Mein Konto" }];

/** The way back to the Dragon Ball side for an SL who is in the Pokémon area. */
export const DRAGON_BALL_ENTRY: NavItem = { href: "/arena", label: "Dragon Ball" };

/** Whether this path is a Pokémon screen (`/pokemon` and everything under it). */
export function isPokemonPath(pathname: string): boolean {
  return pathname === "/pokemon" || pathname.startsWith("/pokemon/");
}

/**
 * Which navigation a page shows: a person whose home game is Pokémon always gets the Pokémon one,
 * and anyone gets it inside the Pokémon area. An SL elsewhere keeps the Dragon Ball navigation.
 */
export function usesPokemonNav(pathname: string, homeGame: string | null | undefined): boolean {
  return homeGame === "pokemon" || isPokemonPath(pathname);
}

export const SECONDARY_ITEMS: NavItem[] = [
  { href: "/leaders", label: "Leaders" }, { href: "/meta", label: "Insights" },
  { href: "/add", label: "Add cards" }, { href: "/cart", label: "Want-list & cart" },
  { href: "/collection/archived", label: "Archived copies" },
  { href: "/me", label: "My account" }, { href: "/settings", label: "Settings" },
];

export function secondaryItems(isSl: boolean): NavItem[] {
  return isSl ? [...SECONDARY_ITEMS, POKEMON_SL_ENTRY, { href: "/arena/rules", label: "Rules workbench" }, { href: "/arena/testing", label: "Testing" }, { href: "/arena/review", label: "Match review" }] : SECONDARY_ITEMS.filter(i => i.href !== "/settings");
}

/** The Card rules page, `/arena/rules/card/<id>` (not the play-test below it). */
export function isCardRulesPage(pathname: string): boolean {
  return /^\/arena\/rules\/card\/[^/]+$/.test(pathname);
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // "Sammlung" is the area's own page: it is not lit on Entdecken and the rest below it.
  if (href === "/pokemon") return pathname === "/pokemon";
  if (href === "/cards" && pathname === "/leaders") return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one route that takes the whole screen: a game in progress. On a 390×844
 * phone the header and the tab bar cost about 114 px, which is most of a card,
 * and neither is any use mid-game — the board has its own way back.
 *
 * Only a game, its local twin `/arena/local` (#656: a match on this device), and its dev-only twin `/arena/preview` (#447): a shot of the
 * preview has to show what a player sees. Everything else under `/arena` — the
 * list, the backlog, the rules, the debug view — keeps its navigation.
 */
export function isFullBleed(pathname: string): boolean {
  return /^\/arena\/(\d+|preview|local)$/.test(pathname);
}

/**
 * The Arena's own pages on a phone: everything that draws an `ArenaHeader` (ARENA, Games, ⋯) —
 * the Play screen (`/arena`, also `?tab=games`), a waiting 1 v 1 and the feedback page. Below
 * `sm` they replace the app header with ArenaHeader and handle
 * the safe-area insets themselves, as `isFullBleed` does; from `sm` up nothing changes. The
 * board is `isFullBleed`; the workbench and debug views keep the app's chrome. The Card rules page
 * (`/arena/rules/card/[cardId]`, Rules PR 3) is a phone screen with its own way back, so it is one too.
 */
export function isArenaShell(pathname: string): boolean {
  // The offline shell's setup (#783) is a phone screen with its own way back; its board goes
  // full-bleed on its own (`useMatchScreen`), since the path is the same for both.
  return pathname === "/arena" || pathname === "/arena/offline" || pathname === "/arena/feedback" || isCardRulesPage(pathname) || /^\/arena\/match\/\d+$/.test(pathname);
}

/** One source of truth for the desktop header and the phone tab bar. */
export interface NavItem {
  href: string;
  label: string;
  /** Short label for the phone tab bar. */
  short?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", short: "Home" },
  { href: "/collection", label: "Collection" },
  { href: "/cards", label: "Cards" },
  { href: "/decks", label: "Decks" },
  { href: "/add", label: "Add cards", short: "Add" },
];

/**
 * The phone tab bar outside the Arena: the phone is the Arena (docs/arena-home-spec.md §1,
 * decision 6), so Arena is the first tab and replaces Home, which stays one tap away on the
 * header wordmark. A phone-only list; the desktop header keeps `NAV_ITEMS`.
 */
export const PHONE_NAV_ITEMS: NavItem[] = [{ href: "/arena", label: "Arena" }, ...NAV_ITEMS.filter((i) => i.href !== "/")];

export const SECONDARY_ITEMS: NavItem[] = [
  { href: "/leaders", label: "Leaders" },
  { href: "/meta", label: "Meta & News" },
  { href: "/arena", label: "Arena" },
  { href: "/settings", label: "Settings & sync", short: "Settings" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one route that takes the whole screen: a game in progress. On a 390×844
 * phone the header and the tab bar cost about 114 px, which is most of a card,
 * and neither is any use mid-game — the board has its own way back.
 *
 * Only a game, and its dev-only twin `/arena/preview` (#447): a shot of the
 * preview has to show what a player sees. Everything else under `/arena` — the
 * list, the backlog, the rules, the debug view — keeps its navigation.
 */
export function isFullBleed(pathname: string): boolean {
  return /^\/arena\/(\d+|preview)$/.test(pathname);
}

/**
 * The Arena's own pages on a phone: everything that draws an `ArenaHeader` (ARENA, Games, ⋯) —
 * the Play screen (`/arena`, also `?tab=games`), a waiting 1 v 1 and the feedback page. Below
 * `sm` they drop the app header and the tab bar (about 114 px of a 390×844 screen) and handle
 * the safe-area insets themselves, as `isFullBleed` does; from `sm` up nothing changes. The
 * board is `isFullBleed`; the workbench and debug views keep the app's chrome.
 */
export function isArenaShell(pathname: string): boolean {
  return pathname === "/arena" || pathname === "/arena/feedback" || /^\/arena\/match\/\d+$/.test(pathname);
}

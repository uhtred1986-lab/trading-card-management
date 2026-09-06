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
 * Only a game. Everything else under `/arena` — the list, the backlog, the
 * rules, the debug view — keeps its navigation.
 */
export function isFullBleed(pathname: string): boolean {
  return /^\/arena\/\d+$/.test(pathname);
}

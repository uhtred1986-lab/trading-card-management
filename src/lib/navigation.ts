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
  { href: "/settings", label: "Settings & sync", short: "Settings" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

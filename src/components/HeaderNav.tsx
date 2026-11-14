"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive, type NavItem } from "@/lib/navigation";

/**
 * Desktop navigation in the header; hidden on phones where BottomTabs takes over. `items` replaces
 * the Dragon Ball entries (the Pokémon area passes its own, shown from `sm` instead of `lg`).
 */
export function HeaderNav({ items = NAV_ITEMS, fromSm = false }: { items?: NavItem[]; fromSm?: boolean }) {
  const pathname = usePathname();
  const link = (href: string, label: string) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 text-sm transition-colors ${active ? "bg-space-800 text-space-50" : "text-space-200 hover:bg-space-800 hover:text-space-50"}`}
      >
        <NavLabel label={label} />
      </Link>
    );
  };
  return (
    <nav aria-label={fromSm ? "Hauptnavigation" : undefined} className={`ds-primary-nav hidden flex-1 items-center gap-1 ${fromSm ? "sm:flex" : "lg:flex"}`}>
      {items.map((i) => link(i.href, i.label))}

    </nav>
  );
}

/**
 * `useLinkStatus` only sees the nearest `Link` ancestor, so the clicked
 * item's own pending state has to live in a child — dims the instant it's
 * clicked, ahead of the destination route's `loading.tsx` painting.
 */
function NavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "animate-pulse opacity-60" : ""}>{label}</span>;
}

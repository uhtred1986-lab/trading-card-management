"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "@/lib/navigation";

/** Phone navigation: five fixed tabs at the bottom, hidden from `sm` up. */
export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-space-700 bg-space-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? "text-ki-400" : "text-space-300"
                }`}
              >
                <TabContent active={active} label={item.short ?? item.label} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * `useLinkStatus` only sees the nearest `Link` ancestor, so the tapped tab's
 * own pending state has to live in a child component — this is what makes a
 * tap dim immediately, before the destination route's `loading.tsx` paints.
 */
function TabContent({ active, label }: { active: boolean; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className={`flex flex-col items-center gap-0.5 transition-opacity ${pending ? "animate-pulse opacity-60" : ""}`}>
      <span aria-hidden className={`h-1 w-6 rounded-full ${active ? "bg-ki-400" : "bg-transparent"}`} />
      {label}
    </span>
  );
}

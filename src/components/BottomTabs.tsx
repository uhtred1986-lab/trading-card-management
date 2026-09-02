"use client";

import Link from "next/link";
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
                <span aria-hidden className={`h-1 w-6 rounded-full ${active ? "bg-ki-400" : "bg-transparent"}`} />
                {item.short ?? item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

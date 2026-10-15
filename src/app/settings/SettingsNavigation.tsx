"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
const subscribe = (notify: () => void) => { window.addEventListener("hashchange", notify); return () => window.removeEventListener("hashchange", notify); };
const snapshot = () => window.location.hash;
const items = [
  { label: "Appearance", href: "/settings#appearance", activePaths: ["/settings"] },
  { label: "AI & integrations", href: "/settings#ai", activePaths: [] },
  { label: "Data & sync", href: "/settings#sync", activePaths: [] },
  { label: "Storage locations", href: "/settings/locations", activePaths: ["/settings/locations"] },
  { label: "Users & access", href: "/settings/access", activePaths: ["/settings/access", "/settings/users"] },
] as const;
export function SettingsNavigation() {
  const pathname = usePathname();
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  return <nav className="mt-4 flex gap-2 overflow-x-auto sm:flex-col" aria-label="Settings navigation">{items.map(({ label, href, activePaths }) => <Link key={href} href={href} aria-current={(pathname === "/settings" ? href === `/settings${hash || "#appearance"}` : activePaths.some(p => p === pathname)) ? "page" : undefined}>{label}</Link>)}</nav>;
}

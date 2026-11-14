"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { PHONE_NAV_ITEMS, POKEMON_NAV_ITEMS, isActive } from "@/lib/navigation";
import { PK } from "@/lib/pokemon/copy";

/**
 * Phone navigation: five fixed tabs at the bottom, Arena first, hidden from `sm` up. With `pokemon`
 * it is the Pokémon bar instead (German, with the raised "+" in the centre).
 */
export function BottomTabs({ pokemon = false }: { pokemon?: boolean }) {
  const pathname = usePathname();
  if (pokemon) return <PokemonTabs pathname={pathname} />;
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-space-700 bg-space-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <ul className="grid grid-cols-5 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {PHONE_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-ki-400" : "text-space-300"}`}
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

function PokemonTabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label={PK.nav.label} className="pk-tabs fixed inset-x-0 bottom-0 z-30 border-t border-space-700 bg-space-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <ul className="grid grid-cols-5 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {POKEMON_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex justify-center">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.plus ? PK.nav.addAria : undefined}
                className={item.plus ? "pk-tab pk-tab-plus" : `pk-tab ${active ? "pk-tab-on" : ""}`}
              >
                <PokemonTabContent plus={!!item.plus} icon={ICONS[item.href]} label={item.label} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pending state of the tapped tab, as in `TabContent`. */
function PokemonTabContent({ plus, icon, label }: { plus: boolean; icon: React.ReactNode; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className={`flex flex-col items-center gap-0.5 transition-opacity ${pending ? "animate-pulse opacity-60" : ""}`}>
      {plus ? <span className="pk-plus-disc" aria-hidden>{icon}</span> : <><span aria-hidden>{icon}</span><span>{label}</span></>}
    </span>
  );
}

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const ICONS: Record<string, React.ReactNode> = {
  "/pokemon": svg(<><rect x="4" y="3" width="11" height="15" rx="2" /><path d="M9 21h9a2 2 0 0 0 2-2V8" /></>),
  "/pokemon/discover": svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>),
  "/pokemon/add": svg(<path d="M12 5v14M5 12h14" />),
  "/pokemon/decks": svg(<path d="M4 7h16M4 12h16M4 17h10" />),
  "/pokemon/wishes": svg(<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />),
};

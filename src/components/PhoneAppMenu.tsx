"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { POKEMON_PLAYER_MENU, isActive, isArenaShell, secondaryItems } from "@/lib/navigation";

/** Secondary destinations, available beside the same five tabs on each phone page. */
/** `pokemonPlayer`: a player whose home game is Pokémon gets the short menu (their tabs carry the rest). */
export function PhoneAppMenu({ isSl, arenaHeader = false, pokemonPlayer = false }: { isSl: boolean; arenaHeader?: boolean; pokemonPlayer?: boolean }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  if (arenaHeader && !isArenaShell(pathname)) return null;
  return <details key={pathname} ref={ref} className="ds-app-menu relative" data-phone-app-menu>
    <summary className="tap flex min-h-11 cursor-pointer list-none items-center justify-center rounded-lg border border-space-600 px-3 text-sm text-space-100 [&::-webkit-details-marker]:hidden">{pokemonPlayer ? "Menü" : "Menu"}</summary>
    <nav aria-label="More app pages" className="absolute right-0 z-40 mt-2 max-h-[70dvh] w-56 overflow-y-auto overscroll-contain rounded-xl border border-space-600 bg-space-900 p-2 shadow-xl">
      {(pokemonPlayer ? POKEMON_PLAYER_MENU : [{ href: "/", label: "Home" }, ...secondaryItems(isSl).filter(item => item.href !== "/arena")]).map(item => <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} onClick={() => ref.current?.removeAttribute("open")} className="tap flex min-h-11 items-center rounded-lg px-3 text-sm text-space-100 hover:bg-space-800">{item.label}</Link>)}
    </nav>
  </details>;
}

import type { Metadata } from "next";
import { PK } from "@/lib/pokemon/copy";

export const metadata: Metadata = { title: PK.appName };

/**
 * The Pokémon area (docs/pokemon/design.md §11): its own skin, painted route and German screens.
 * `AppShell` wraps the header and the tab bar in the same `data-skin="pokemon"` and draws the scene;
 * this layout carries the skin to the page itself, so the Dragon Ball skins stay where they are. It
 * reads no data: every page below it checks who is asking.
 */
export default function PokemonLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="pokemon" lang="de" className="pk-page">
      {children}
    </div>
  );
}

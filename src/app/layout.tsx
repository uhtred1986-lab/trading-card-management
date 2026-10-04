import type { Metadata, Viewport } from "next";
import { Barlow_Semi_Condensed, Kanit } from "next/font/google";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { getViewer } from "@/lib/auth";
import "./globals.css";

/**
 * The arena's two faces (`docs/arena-redesign/prototype/arena.css`), both
 * loaded the one way the app loads fonts: `next/font`, self-hosted at build.
 *
 * - Kanit, the impact face: the board's numerals, the turn pill and the
 *   banners, in both skins (`.arena-impact`, `.arena-num`). Italic only.
 * - Barlow Semi Condensed, the board's text face, set on `.arena` alone; the
 *   rest of the app keeps the default stack.
 */
const impact = Kanit({ subsets: ["latin"], weight: ["800", "900"], style: ["italic"], variable: "--font-impact", display: "swap" });
const arenaText = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-arena", display: "swap" });

export const metadata: Metadata = {
  title: "DBS Card Companion",
  description: "Collection, decks, prices and AI analysis for the Dragon Ball Super Card Game.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "DBS Arena" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090b15",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The skin paints the whole app (docs/arena-skin-spec.md §8): read here so
  // the markup the server sends is already the right colour and nothing flashes.
  const skin = skinFrom((await cookies()).get(SKIN_COOKIE)?.value);
  // Only which links the navigation shows; every page and action checks access itself.
  const viewer = await getViewer();
  return (
    <html lang="en" className={`h-full antialiased ${impact.variable} ${arenaText.variable}`} data-skin={skin}>
      <body className="flex min-h-full flex-col">
        <AppShell isSl={viewer?.kind !== "player"}>{children}</AppShell>
        <ServiceWorker />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Kanit } from "next/font/google";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import "./globals.css";

/**
 * The one display face, used only by the arena's anime skin for numerals and
 * banners (`docs/arena-skin-spec.md` §3.5). Two weights, italic only; the
 * rest of the app keeps the default stack.
 */
const impact = Kanit({ subsets: ["latin"], weight: ["800", "900"], style: ["italic"], variable: "--font-impact", display: "swap" });

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
  return (
    <html lang="en" className={`h-full antialiased ${impact.variable}`} data-skin={skin}>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
        <ServiceWorker />
      </body>
    </html>
  );
}

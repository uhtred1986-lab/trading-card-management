import type { Metadata, Viewport } from "next";
import { Kanit } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { ServiceWorker } from "@/components/ServiceWorker";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${impact.variable}`}>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
        <ServiceWorker />
      </body>
    </html>
  );
}

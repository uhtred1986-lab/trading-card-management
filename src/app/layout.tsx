import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BottomTabs } from "@/components/BottomTabs";
import { HeaderNav } from "@/components/HeaderNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "DBS Card Companion",
  description: "Collection, decks, prices and AI analysis for the Dragon Ball Super Card Game.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-space-700/70 bg-space-950/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight text-ki-400">DBS</span>
              <span className="text-xs uppercase tracking-widest text-space-300">Card Companion</span>
            </Link>
            <HeaderNav />
            <Link
              href="/settings"
              className="ml-auto rounded-md px-2 py-1 text-xs text-space-300 hover:text-space-50 sm:hidden"
            >
              Settings
            </Link>
          </div>
        </header>

        {/* Extra bottom padding clears the phone tab bar; it collapses at `sm`. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-5 sm:pb-8">{children}</main>

        <BottomTabs />
      </body>
    </html>
  );
}

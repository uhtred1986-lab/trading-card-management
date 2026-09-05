import type { MetadataRoute } from "next";

/**
 * What makes the arena installable to an Android home screen — no store, no
 * listing, just "Add to home screen" from the browser (design proposal §13).
 *
 * `start_url` is the arena rather than the dashboard: this is installed to
 * play, and the rest of the app is a tap away inside it.
 *
 * Served at `/manifest.webmanifest`, which `src/proxy.ts` exempts from Basic
 * Auth along with the icons — a name and a picture are not secrets, and the
 * browser fetches both without credentials, so behind auth they would 401 and
 * the app would simply not be installable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DBS Card Companion",
    short_name: "DBS Arena",
    description: "Collection, decks, prices and the arena for the Dragon Ball Super Card Game.",
    start_url: "/arena",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#090b15",
    theme_color: "#090b15",
    categories: ["games", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

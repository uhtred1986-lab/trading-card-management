import type { MetadataRoute } from "next";

/**
 * What makes the app installable to an Android or iPhone home screen — no store, no listing, just
 * "Add to home screen" from the browser (design proposal §13).
 *
 * The name is neutral: the same app holds the Dragon Ball games and Pokémon. `start_url` is `/` with
 * a launch marker, and `/` sends each person to their own start screen (src/app/page.tsx): a player
 * whose home game is Pokémon opens on their collection, everyone else on the arena as before. A
 * plain visit to `/` (the desktop dashboard) never redirects a Dragon Ball user.
 *
 * Served at `/manifest.webmanifest`, which `src/proxy.ts` exempts from Basic
 * Auth along with the icons — a name and a picture are not secrets, and the
 * browser fetches both without credentials, so behind auth they would 401 and
 * the app would simply not be installable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Card Companion",
    short_name: "Card Companion",
    description: "Collection, decks, prices and the arena for your trading card games.",
    start_url: "/?source=pwa",
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

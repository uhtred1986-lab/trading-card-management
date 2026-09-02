import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Canonical card art from the deckplanet catalog (see src/lib/catalog/deckplanet.ts).
      { protocol: "https", hostname: "storage.googleapis.com", pathname: "/deckplanet_card_images/**" },
      // TCGplayer product photos — fallback when a print has no deckplanet image.
      { protocol: "https", hostname: "tcgplayer-cdn.tcgplayer.com" },
      // CardTrader blueprint images — leader back sides for Masters-era sets.
      { protocol: "https", hostname: "www.cardtrader.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "cardtrader.com", pathname: "/uploads/**" },
    ],
  },
  // Scan uploads are multi-megabyte phone photos; the default 1 MB body limit
  // would reject them before the server action ever sees the file.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;

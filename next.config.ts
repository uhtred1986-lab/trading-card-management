import type { NextConfig } from "next";

/**
 * Routes whose function can reach the AI layer (`src/lib/ai/*`) and so can end up starting the
 * Claude Agent SDK. Found from the build: every `.nft.json` that traces `claude-agent-sdk`
 * (`npm run ai:trace-sizes` lists them and fails when one is missing from here). Server actions
 * run inside the page that renders them, so pages are listed, not the actions.
 */
const AGENT_SDK_ROUTES = [
  "/add/bulk", "/add/quick", "/add/scan", "/cards/[id]", "/cart", "/decks", "/decks/[id]", "/leaders", "/settings",
  "/sets/[code]/review",
  "/arena", "/arena/[id]", "/arena/feedback", "/arena/match/[id]", "/arena/preview", "/arena/review",
  "/arena/rules", "/arena/rules/build/[id]", "/arena/rules/build/preview", "/arena/rules/review",
  "/api/scan", "/api/scan/quick", "/api/sync/prices",
  "/api/v1/games/[id]", "/api/v1/games/[id]/abandon", "/api/v1/games/[id]/actions", "/api/v1/games/[id]/advance",
];

/**
 * The `claude` binary the SDK spawns lives in an optional platform package that the SDK finds with
 * `createRequire` at run time, so the file tracer cannot see it. Vercel runs Linux x64 on glibc; the
 * musl, arm64, macOS and Windows packages stay out. Inert: the file is only ever executed when
 * AI_AGENT_SDK=1 (anthropic-agent-sdk.ts).
 */
const AGENT_SDK_BINARY = ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*"];

// Route keys are globs and Next matches them as substrings ("/decks" also catches "/api/v1/decks"; Turbopack
// rejects any key that tries to anchor itself), so a few small routes that cannot call a model carry the binary
// too. `npm run ai:trace-sizes` shows which. Brackets of a dynamic segment are escaped.
const escapeRoute = (r: string) => r.replace(/[[\]]/g, "\\$&");

const nextConfig: NextConfig = {
  // Keep standalone output for self-hosted builds, but let Vercel package the
  // default build output so it can read the trace files its adapter expects.
  output: process.env.VERCEL ? undefined : "standalone",
  images: {
    remotePatterns: [
      // Canonical card art from the deckplanet catalog (see src/lib/catalog/deckplanet.ts).
      { protocol: "https", hostname: "storage.googleapis.com", pathname: "/deckplanet_card_images/**" },
      // Fusion World art from Bandai's own card list (see src/lib/catalog/bandai.ts).
      { protocol: "https", hostname: "www.dbs-cardgame.com", pathname: "/fw/images/**" },
      // The original game's leaders deckplanet lacks, both faces (see src/lib/catalog/bandai.ts).
      { protocol: "https", hostname: "www.dbs-cardgame.com", pathname: "/images/cardlist/cardimg/**" },
      // TCGplayer product photos — fallback when a print has no deckplanet image.
      { protocol: "https", hostname: "tcgplayer-cdn.tcgplayer.com" },
      // CardTrader blueprint images — leader back sides for Masters-era sets.
      { protocol: "https", hostname: "www.cardtrader.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "cardtrader.com", pathname: "/uploads/**" },
    ],
  },
  // The Claude Agent SDK (the "Claude plan" provider, #518) finds its native `claude` binary with
  // createRequire at run time, so it must stay a real node_modules package instead of a bundled
  // chunk; the binary itself is added to the AI-calling functions below.
  outputFileTracingIncludes: Object.fromEntries(AGENT_SDK_ROUTES.map((r) => [escapeRoute(r), AGENT_SDK_BINARY])),
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // Scan uploads are multi-megabyte phone photos; the default 1 MB body limit
  // would reject them before the server action ever sees the file.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;

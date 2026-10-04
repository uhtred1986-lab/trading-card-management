import type { NextConfig } from "next";

/**
 * The ONE route whose function carries the Claude Agent SDK's `claude` binary (#518, owner ruling 4 Oct 2026):
 * 246 MB fits under Vercel's 250 MB only alone. Every other function reaches the plan by calling this route
 * (src/lib/ai/providers/agent-sdk-remote.ts). `npm run ai:trace-sizes` fails when any other function carries it.
 */
const AGENT_SDK_ROUTE = "/api/ai/agent-sdk";

/**
 * The `claude` binary the SDK spawns lives in an optional platform package that the SDK finds with
 * `createRequire` at run time, so the file tracer cannot see it. Vercel runs Linux x64 on glibc; the
 * musl, arm64, macOS and Windows packages stay out. Inert: the file is only ever executed when
 * AI_AGENT_SDK=1 (anthropic-agent-sdk.ts).
 */
const AGENT_SDK_BINARY = ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*"];

/**
 * Files of the SDK package the file tracer pulls into the function although nothing at run time reads them
 * (the browser build, the bridge entry and the `core*` chunks of the "./core" export; `sdk.mjs` imports none of them). They cost 3.5 MB, and without them the route is 249.4 MB, with 0.6 MB to spare.
 */
const AGENT_SDK_UNUSED = ["./node_modules/@anthropic-ai/claude-agent-sdk/browser-sdk.js", "./node_modules/@anthropic-ai/claude-agent-sdk/bridge.mjs", "./node_modules/@anthropic-ai/claude-agent-sdk/core*.mjs"];

/** The spike is off unless AI_AGENT_SDK=1 is set when the app is built (Vercel exposes project variables at build time). */
const AGENT_SDK_BUILD = process.env.AI_AGENT_SDK === "1";

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
  // chunk; the binary itself is added to the one internal route. All of it is behind AI_AGENT_SDK=1 at BUILD time
  // (the same variable the adapter reads at run time): the binary is 246 MB, so adding it to a function is not free
  // (see ai:trace-sizes), and a default build must stay exactly what it was.
  ...(AGENT_SDK_BUILD ? { outputFileTracingIncludes: { [AGENT_SDK_ROUTE]: AGENT_SDK_BINARY }, outputFileTracingExcludes: { [AGENT_SDK_ROUTE]: AGENT_SDK_UNUSED } } : {}),
  ...(AGENT_SDK_BUILD ? { serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"] } : {}),
  // Scan uploads are multi-megabyte phone photos; the default 1 MB body limit
  // would reject them before the server action ever sees the file.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;

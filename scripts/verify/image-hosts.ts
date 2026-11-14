/**
 * The image hosts are listed twice by hand: `next.config.ts` `images.remotePatterns` (what
 * `next/image` may load) and `public/sw.js` `ART_HOSTS` (what the service worker caches). A host in
 * only one of them is a card picture that loads online but is not kept offline, or the reverse
 * (docs/pokemon/plan.md §10 item 6). The service worker is a plain file served as it is, so it
 * cannot import the config; this fails `npm test` when the two lists differ instead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nextConfig from "../../next.config";

const fromConfig = [...new Set((nextConfig.images?.remotePatterns ?? []).map((p) => (p as { hostname: string }).hostname))].sort();

const sw = readFileSync("public/sw.js", "utf8");
const list = /const ART_HOSTS = new Set\(\[([^\]]*)\]\)/.exec(sw);
assert.ok(list, "public/sw.js must still declare `const ART_HOSTS = new Set([...])`");
const fromWorker = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

assert.deepEqual(fromWorker, fromConfig, "public/sw.js ART_HOSTS must list exactly the hosts of next.config.ts images.remotePatterns");
assert.ok(fromConfig.includes("assets.tcgdex.net"), "TCGdex card art must be loadable and cached");

console.log(`image-hosts: ok — ${fromConfig.length} hosts, one list in the config and the same in the worker`);

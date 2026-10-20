/**
 * `node scripts/card-db-env.mjs <out-file>`: writes this app's pooled DATABASE_URL, from the Vercel project
 * (needs VERCEL_TOKEN), as `DATABASE_URL='...'` to <out-file> with mode 600. The value is never printed.
 * The cloud environment's own DATABASE_URL belongs to another app (docs/agent-brief.md, "When the owner asks
 * for live data"). Then: `set -a; . <out-file>; set +a` (the file is quoted, so `&` in the URL is safe).
 * Refuses an out-file inside the current directory (the repo) and a host that is not `-pooler` in eu-central-1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.vercel.com";
const PROJECT = "trading-card-management";

/** `'...'` for a POSIX shell: a quote inside the value becomes '\'' . */
export const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/** Throws (without the value) unless the URL is a pooled Neon host in eu-central-1. */
export function checkHost(url) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error("the stored DATABASE_URL does not parse as a URL"); }
  if (!host.includes("-pooler")) throw new Error("the stored DATABASE_URL host is not the pooled one (-pooler)");
  if (!host.includes("eu-central-1")) throw new Error("the stored DATABASE_URL host is not in eu-central-1");
  return host;
}

async function getJson(fetchFn, url, token, tries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let last = "";
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // a 4xx will not get better
    } catch (e) {
      last = e instanceof Error ? e.message : "request failed";
    }
    if (i < tries) await sleep(500 * i);
  }
  throw new Error(`Vercel API ${url.replace(/\?.*$/, "").replace(API, "")}: ${last}`);
}

/**
 * The DATABASE_URL value of the project's env, by the Vercel API (3 attempts per request).
 * @param {{ token?: string, fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export async function fetchDatabaseUrl({ token, fetchFn = fetch, sleep } = {}) {
  if (!token) throw new Error("VERCEL_TOKEN is not set");
  const get = (u) => getJson(fetchFn, u, token, 3, sleep);
  const projects = (await get(`${API}/v9/projects?limit=50`)).projects ?? [];
  const project = projects.find((p) => p.name === PROJECT);
  if (!project) throw new Error(`no Vercel project named ${PROJECT} in the first 50 projects of this token`);
  const q = project.accountId ? `?teamId=${project.accountId}` : "";
  const envs = (await get(`${API}/v10/projects/${project.id}/env${q}`)).envs ?? [];
  const candidates = envs.filter((e) => e.key === "DATABASE_URL");
  const env = candidates.find((e) => [].concat(e.target ?? []).includes("production")) ?? candidates[0];
  if (!env) throw new Error("the project has no DATABASE_URL env entry");
  const value = (await get(`${API}/v1/projects/${project.id}/env/${env.id}${q}`)).value;
  if (typeof value !== "string" || !value) throw new Error("the DATABASE_URL entry has no readable value");
  return value;
}

export function writeEnvFile(file, value) {
  const resolved = path.resolve(file);
  if (resolved === process.cwd() || resolved.startsWith(process.cwd() + path.sep)) {
    throw new Error("refusing to write the URL inside the repo; use the session scratchpad");
  }
  fs.writeFileSync(resolved, `DATABASE_URL=${shellQuote(value)}\n`, { mode: 0o600 });
  fs.chmodSync(resolved, 0o600); // the file may have existed with looser rights
  return resolved;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: node scripts/card-db-env.mjs <out-file>   (needs VERCEL_TOKEN)");
    process.exit(1);
  }
  try {
    const value = await fetchDatabaseUrl({ token: process.env.VERCEL_TOKEN });
    checkHost(value);
    const written = writeEnvFile(out, value);
    console.log(`wrote DATABASE_URL (pooled, eu-central-1) to ${written}, mode 600. Next: set -a; . ${written}; set +a; export DB_DRIVER=neon-http`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

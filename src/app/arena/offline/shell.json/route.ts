import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtimeRevision } from "@/lib/arena/replay-bundle";
import { SHELL_FORMAT, SHELL_PATH, isShellAsset, type ShellManifest } from "@/lib/arena/local/shell";

/**
 * The offline shell's precache list (#659, `src/lib/arena/local/shell.ts`): every static file of
 * THIS build, listed once at build time (`force-static`: the response is a file of the build, the
 * handler never runs on a request). It names public files only — the build's content-hashed
 * `/_next/static/` output, the web-app manifest and its icons — and the interpreter revision the
 * build runs; no data, no viewer, no secret. Exempt from sign-in in `src/proxy.ts`, because the
 * service worker fetches it without credentials.
 */
export const dynamic = "force-static";
export const revalidate = false;

function walk(dir: string, prefix: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, `${prefix}/${e.name}`, out);
    else out.push(`${prefix}/${e.name}`);
  }
}

export async function GET() {
  const files: string[] = [];
  walk(path.join(process.cwd(), ".next", "static"), "/_next/static", files);
  const icons = path.join(process.cwd(), "public", "icons");
  if (fs.existsSync(icons)) walk(icons, "/icons", files);
  files.push("/manifest.webmanifest");
  const list = [...new Set(files)].filter(isShellAsset).sort();
  // No JS means no build output was found: refuse to describe a shell rather than list an empty one.
  if (!list.some((f) => f.startsWith("/_next/static/") && f.endsWith(".js"))) throw new Error("shell.json: no /_next/static JS found in .next/static");
  const revision = runtimeRevision();
  const version = createHash("sha256").update(JSON.stringify({ format: SHELL_FORMAT, revision, list })).digest("hex").slice(0, 16);
  const manifest: ShellManifest = { format: SHELL_FORMAT, version, revision, shell: SHELL_PATH, files: list };
  return Response.json(manifest);
}

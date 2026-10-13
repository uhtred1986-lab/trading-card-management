/**
 * Serve the repo's TypeScript to a real browser as native ES modules (#640, shared since #641).
 *
 * Each `.ts`/`.tsx`/`.mts` file is transpiled on request with `typescript` (type-only imports
 * vanish), `@/` is rewritten to `/src/`, and an extensionless specifier is redirected to the real
 * file — so there is no bundler and no Node shim: a module that needs `node:crypto`, `fs` or
 * `process` fails to load. `/` serves the page given. Every request is recorded, so a check can
 * prove what the page did and did not ask for.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import ts from "typescript";

export interface ModuleServer {
  port: number;
  origin: string;
  /** Module paths served, in order. */
  served: string[];
  /** Paths asked for that are not repo modules (404). */
  refused: string[];
  /** Every request path, in order, page included. */
  requests: string[];
  close(): void;
}

function fileFor(root: string, urlPath: string): string | null {
  const base = path.join(root, decodeURIComponent(urlPath).replace(/^\/+/, ""));
  if (!base.startsWith(root + path.sep)) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (/\.(ts|tsx|mts)$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function serveRepoModules(root: string, page: string): Promise<ModuleServer> {
  const served: string[] = [];
  const refused: string[] = [];
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    const file = fileFor(root, url.pathname);
    if (!file) {
      if (url.pathname !== "/favicon.ico") refused.push(url.pathname);
      res.writeHead(404);
      res.end();
      return;
    }
    const canonical = "/" + path.relative(root, file).split(path.sep).join("/");
    if (canonical !== url.pathname) {
      // Redirect so the module's own URL is its real path and its relative imports resolve.
      res.writeHead(302, { location: canonical });
      res.end();
      return;
    }
    served.push(canonical);
    const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
    }).outputText.replace(/(from\s+|import\s*\(\s*|import\s+)(["'])@\//g, "$1$2/src/");
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(out);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { port, origin: `http://127.0.0.1:${port}`, served, refused, requests, close: () => server.close() };
}

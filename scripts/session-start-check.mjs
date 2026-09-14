#!/usr/bin/env node
/**
 * SessionStart hook: installs dependencies before a fresh Claude Code on the
 * web session's first turn, so the first `verify-rules`/`verify-arena` run
 * is a real test rather than a `Cannot find module` error mistaken for one.
 *
 * Plain Node (no `tsx`, no deps) because it has to run *before* `npm ci` —
 * the thing it may need to invoke. Windows-safe: no shell-only syntax (no
 * `[ -d ... ]`, no `$VAR`), just `node` plus fs/child_process calls, so the
 * same command works under the owner's PowerShell and under bash.
 */
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `node_modules` needs a reinstall when it's absent, or older than
 * `package-lock.json` (a pull that changed dependencies since the last
 * install). `nodeModulesMtimeMs` is `null` when the directory doesn't exist.
 */
export function needsInstall(nodeModulesMtimeMs, lockMtimeMs) {
  if (nodeModulesMtimeMs == null) return true;
  return lockMtimeMs > nodeModulesMtimeMs;
}

function main() {
  const nodeModulesDir = path.join(root, "node_modules");
  const lockFile = path.join(root, "package-lock.json");

  const nodeModulesMtimeMs = existsSync(nodeModulesDir) ? statSync(nodeModulesDir).mtimeMs : null;
  const lockMtimeMs = statSync(lockFile).mtimeMs;

  if (!needsInstall(nodeModulesMtimeMs, lockMtimeMs)) {
    console.log("session-start: node_modules up to date, skipping install");
    return;
  }

  console.log("session-start: node_modules missing or stale, running npm ci...");
  const install = spawnSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (install.status !== 0) {
    console.error("session-start: npm ci failed");
    process.exit(install.status ?? 1);
  }

  spawnSync("npx", ["tsx", "--version"], {
    cwd: root,
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  console.log("session-start: dependencies installed, tsx cache warmed");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

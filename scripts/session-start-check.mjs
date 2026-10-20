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
import { appendFileSync, existsSync, statSync } from "node:fs";
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

/** Claude Code on the web: `CLAUDE_CODE_REMOTE=true`. */
const isCloud = process.env.CLAUDE_CODE_REMOTE === "true";
const NODE22_NPM = "/opt/node22/bin/npm";

/**
 * In a cloud session every later Bash call should run on Node 24 (the sandbox's default `node` is 22,
 * under which three proofs fail for no reason) and never see the environment's DATABASE_URL, which is
 * another app's database. `$CLAUDE_ENV_FILE` is sourced before each Bash call.
 */
export function cloudEnvLines() {
  return ["export PATH=/usr/local/bin:$PATH", "unset DATABASE_URL"];
}

function writeCloudEnv() {
  const file = process.env.CLAUDE_ENV_FILE;
  if (!isCloud || !file) return;
  appendFileSync(file, cloudEnvLines().join("\n") + "\n");
}

function main() {
  writeCloudEnv();
  const nodeModulesDir = path.join(root, "node_modules");
  const lockFile = path.join(root, "package-lock.json");

  const nodeModulesMtimeMs = existsSync(nodeModulesDir) ? statSync(nodeModulesDir).mtimeMs : null;
  const lockMtimeMs = statSync(lockFile).mtimeMs;

  if (!needsInstall(nodeModulesMtimeMs, lockMtimeMs)) {
    console.log("session-start: node_modules up to date, skipping install");
    return;
  }

  console.log("session-start: node_modules missing or stale, running npm ci...");
  // The cloud's default npm (11, under Node 24) rejects the lockfile's optional platform packages.
  const npm = isCloud && existsSync(NODE22_NPM) ? NODE22_NPM : "npm";
  const install = spawnSync(npm, ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
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

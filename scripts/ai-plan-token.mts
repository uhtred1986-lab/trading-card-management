/**
 * `npm run ai:plan-token` — the Claude plan (Agent SDK) token for this app, set up or renewed in one go
 * (docs/architecture/ai-providers.md, "Token"; #518).
 *
 * 1. Runs `claude setup-token`: you sign in with your Claude plan in the browser and it prints a token that
 *    lasts about a year.
 * 2. Asks you to paste that token (hidden input; it is never printed or logged).
 * 3. Sets in Vercel (Production and Preview, as the project keeps them), through `npx vercel`:
 *    `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN_CREATED` (today, yyyy-mm-dd). Values go in on
 *    stdin, never on the command line, and replace what is there (`--force`).
 *    Optional, only when asked:
 *      --rotate-secret  a new random `AI_AGENT_SDK_SECRET` (the functions ↔ /api/ai/agent-sdk guard; one value
 *                       everywhere, so every function picks it up with the same deploy)
 *      --enable         `AI_AGENT_SDK=1` — only once the route PR is merged and measured (CLAUDE.md, #518)
 *      --disable        `AI_AGENT_SDK=0`
 * 4. Writes the token and its date into `.env.local`.
 *
 * Vercel picks the values up with the next deploy. Needs `npx vercel login` once, and the `claude` CLI
 * (Claude Code) — falls back to `npx @anthropic-ai/claude-code` when `claude` is not on PATH. Pure Node, so it
 * runs the same on Windows, macOS and Linux. Never part of `npm test`.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PACKAGE = "dbs-card-companion";
const PROJECT = "trading-card-management";
const SCOPE = "gullet-cove";
const TARGETS = ["production", "preview"] as const;
/** Not a devDependency here: pinned to the major the sibling repo uses, fetched by npx on first use. */
const VERCEL = "vercel@58";
const WINDOWS = process.platform === "win32";

const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!["--rotate-secret", "--enable", "--disable"].includes(flag)) {
    console.error(`Unknown option ${flag}. Options: --rotate-secret, --enable, --disable.`);
    process.exit(1);
  }
}
if (flags.has("--enable") && flags.has("--disable")) {
  console.error("--enable and --disable together make no sense.");
  process.exit(1);
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  // `npx`/`claude` are .cmd shims on Windows, which only start through a shell.
  return spawnSync(command, args, { stdio: "inherit", shell: WINDOWS, ...options });
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

/** One line from the terminal without echoing it. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this in a terminal: the token is read with hidden input."));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

function hasCommand(command: string): boolean {
  const probe = spawnSync(WINDOWS ? "where" : "which", [command], { stdio: "ignore", shell: WINDOWS });
  return probe.status === 0;
}

async function main() {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!existsSync(pkgPath) || JSON.parse(readFileSync(pkgPath, "utf8")).name !== PACKAGE) {
    fail("Run this from the trading-card-management repo root (npm run ai:plan-token).");
  }

  console.log("\nStep 1: claude setup-token. Sign in with your Claude plan in the browser, then copy the token it prints.\n");
  const setup = hasCommand("claude")
    ? run("claude", ["setup-token"])
    : run("npx", ["--yes", "@anthropic-ai/claude-code", "setup-token"]);
  if (setup.status !== 0) fail("claude setup-token did not finish. Nothing was changed.");

  const token = await readHidden("\nStep 2: paste the token here (input hidden): ");
  if (token.length < 20 || /\s/.test(token)) fail("That does not look like a token. Nothing was changed.");

  const created = new Date().toISOString().slice(0, 10);
  const values: { name: string; value: string; local: boolean }[] = [
    { name: "CLAUDE_CODE_OAUTH_TOKEN", value: token, local: true },
    { name: "CLAUDE_CODE_OAUTH_TOKEN_CREATED", value: created, local: true },
  ];
  if (flags.has("--rotate-secret")) values.push({ name: "AI_AGENT_SDK_SECRET", value: randomBytes(32).toString("hex"), local: false });
  if (flags.has("--enable")) values.push({ name: "AI_AGENT_SDK", value: "1", local: false });
  if (flags.has("--disable")) values.push({ name: "AI_AGENT_SDK", value: "0", local: false });

  console.log(`\nStep 3: setting the values in Vercel (${TARGETS.join(", ")})…`);
  for (const { name, value } of values) {
    for (const target of TARGETS) {
      const added = run(
        "npx",
        ["--yes", VERCEL, "env", "add", name, target, "--force", "--yes", "--sensitive", "--project", PROJECT, "--scope", SCOPE],
        // The value on stdin, without a trailing newline (Vercel would store it).
        { input: value, stdio: ["pipe", "ignore", "inherit"] },
      );
      if (added.status !== 0) {
        fail(`vercel env add ${name} (${target}) failed. Run \`npx ${VERCEL} login\` once if you are not signed in, then try again.`);
      }
    }
    console.log(`  set ${name}`);
  }

  console.log("\nStep 4: updating .env.local…");
  const envPath = path.join(process.cwd(), ".env.local");
  const before = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const lines = before ? before.split(/\r?\n/) : [];
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const { name, value } of values.filter((entry) => entry.local)) {
    const entry = `${name}="${value}"`;
    const at = lines.findIndex((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
    if (at >= 0) lines[at] = entry;
    else lines.push(entry);
    console.log(`  set ${name}`);
  }
  writeFileSync(envPath, `${lines.join(eol)}${eol}`, "utf8");

  console.log(`\nDone. Token made on ${created}; it lasts about a year.`);
  console.log("Vercel picks the values up with the next deploy.");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

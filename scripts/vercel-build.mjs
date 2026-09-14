// Vercel's build command. Migrations run against the one shared Neon database
// (`CLAUDE.md` › Conventions: there is no per-branch database), so they run on
// **production** deploys only — a preview deploy used to run them too, which
// woke Neon on every push to every pull-request branch for a preview nobody can
// open (deployment protection is on). Plain Node so it reads the same on the
// owner's Windows machine and on the build runner.
import { execSync } from "node:child_process";

export function shouldMigrate(env) {
  return env.VERCEL_ENV === "production";
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const run = (cmd) => execSync(cmd, { stdio: "inherit" });
  if (shouldMigrate(process.env)) run("npm run db:migrate");
  else console.log(`vercel-build: ${process.env.VERCEL_ENV ?? "unknown"} deploy — migrations skipped, production runs them`);
  run("npm run build");
}

// Vercel's "ignored build step": exit 0 skips the deploy, exit 1 builds it.
// A production deploy always builds. A preview of a branch an agent pushed
// (`feat/*`, `arena-*`, `backlog/*`, `claude/*`, `copilot/*`, `ops/*`) is skipped:
// nobody opens those previews (deployment protection plus Basic Auth) and each
// one cost a Neon wake-up and a Vercel build. A branch the owner pushes by hand
// under any other name still gets its preview.
export const BOT_BRANCH = /^(feat|arena|backlog|claude|copilot|ops)[\/-]/;

export function shouldSkipBuild(env) {
  if (env.VERCEL_ENV === "production") return false;
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  return BOT_BRANCH.test(branch);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const skip = shouldSkipBuild(process.env);
  console.log(`vercel-ignore-build: ${process.env.VERCEL_ENV ?? "unknown"} deploy of ${process.env.VERCEL_GIT_COMMIT_REF ?? "?"} — ${skip ? "skipped" : "building"}`);
  process.exit(skip ? 0 : 1);
}

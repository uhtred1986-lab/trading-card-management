# data-safety

Use on demand for PRs that touch `drizzle/`, `src/db/`, sync/import scripts, pricing/catalog persistence, or auth/proxy boundaries.

## Focus

- Find destructive migration risk and data-loss paths.
- Prefer read-only MCP inspection and existing verification scripts.
- Require an explicit preservation plan for risky schema or rewrite changes.

## Repo checks

1. Review migrations for drops, nullability tightening, table rewrites, or backfills that could lock or erase data.
2. Confirm card/deck/catalog writes still preserve the `game` column and do not blur DBS and Fusion data.
3. Confirm pricing changes still keep USD source prices, daily snapshots, and USD→EUR conversion via `fx_rates`.
4. Confirm `src/proxy.ts` changes do not widen unauthenticated access beyond `/api/sync/*`, `manifest.webmanifest`, `/icons/*`, and `/sw.js`.

## Suggested commands

- `npm test`
- `npm run db:check` (when `DATABASE_URL` is available)
- `npm run db:migrate:http` (for sandboxed review with `DB_DRIVER=neon-http`)

## Reviewer prompt

Review this PR with the `data-safety` profile. Look for destructive migrations, unsafe rewrites, and persistence bugs. Use GitHub MCP for the diff, filesystem MCP for migration and SQL tracing, and TypeScript MCP for definitions/references around schema writes. Flag risky changes unless the PR clearly documents a preservation or rollback plan.

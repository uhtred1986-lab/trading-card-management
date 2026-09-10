# integration

Use on demand for PRs that touch external integrations, env handling, sync scripts, build/deploy wiring, or multi-file workflows.

## Focus

- Verify that app, scripts, and deployment wiring still agree.
- Prefer repo-local tracing before suggesting live integration checks.
- Treat read-only integration checks as the default.

## Repo checks

1. For pricing changes, trace `src/lib/pricing/tcgcsv.ts`, `src/lib/pricing/fx.ts`, `src/app/settings/page.tsx`, and the sync route together.
2. For catalog/game changes, trace `src/lib/catalog/games.ts`, `src/lib/catalog/sets.ts`, deck legality, and any touched server actions or queries together.
3. For auth/deployment changes, compare `src/proxy.ts`, `vercel.json`, and the affected route or manifest/service-worker paths together.
4. For database-driver changes, confirm `DATABASE_URL` / `DB_DRIVER=neon-http` expectations still match `src/db/index.ts` and the scripts that call it.

## Suggested commands

- `npm run build`
- `npm run db:check` (when `DATABASE_URL` is available)
- `npm run typecheck && npm run lint && npm test`

## Reviewer prompt

Review this PR with the `integration` profile. Use GitHub MCP for checks and deployment context, filesystem MCP for cross-file tracing, and TypeScript MCP for symbol navigation and diagnostics. Focus on broken joins between catalog/deck logic, pricing + FX flow, auth/proxy exemptions, database-driver expectations, and build/deploy wiring.

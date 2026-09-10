# quick-gate

Use on every PR open and after any substantial update.

## Focus

- Catch high-confidence regressions quickly.
- Use GitHub MCP for the diff, review comments, check runs, and failing jobs.
- Use filesystem + TypeScript MCP to trace cross-file effects before flagging anything.

## Repo checks

1. If the PR touches catalog, card, collection, leader, or deck paths, confirm `game` still propagates cleanly through set/card/deck queries and filters.
2. If the PR touches arena paths, confirm Fusion decks still cannot enter arena flows that only support `dbs`.
3. If the PR touches `src/proxy.ts`, auth helpers, sync routes, `src/app/manifest.ts`, `public/icons`, or `public/sw.js`, re-check the unauthenticated exemptions.
4. If the PR touches pricing code, confirm the source remains TCGplayer/tcgcsv in USD with EUR conversion via `fx_rates`.

## Suggested commands

- `npm run typecheck`
- `npm run lint`
- `npm test`

## Reviewer prompt

Review this PR with the `quick-gate` profile. Use GitHub MCP first for the diff and checks, then filesystem and TypeScript MCP only as needed to confirm high-confidence issues. Focus on breakages in `game` propagation, arena `dbs`-only guardrails, auth/proxy exemptions, and pricing invariants. Ignore style-only nits.

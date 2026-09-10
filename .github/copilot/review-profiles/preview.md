# preview

Use on demand for PRs with route, UI, manifest, service-worker, auth, or deployment-surface changes when a preview URL or local tunnel is available.

## Focus

- Verify the user-visible surface still behaves as expected.
- Re-check auth-protected vs exempt paths.
- Use browser/preview access only after the static diff and code tracing look sane.

## Repo checks

1. Confirm preview-only changes do not bypass the Basic Auth boundary in `src/proxy.ts`.
2. Confirm installability surfaces still work: `manifest.webmanifest`, `/icons/*`, and `/sw.js`.
3. Confirm arena-related UI changes still avoid Fusion gameplay where the arena is `dbs`-only.
4. Confirm pricing text still matches the USD source + EUR conversion model.

## Suggested commands

- `npm run build`
- `npm run typecheck && npm run lint && npm test`
- Optional live check against a preview URL or local tunnel after the code review pass

## Reviewer prompt

Review this PR with the `preview` profile. Start with GitHub MCP, filesystem MCP, and TypeScript MCP. If a preview URL is available, then use the default browser/preview tooling to verify route behavior, auth exemptions, manifest/icons/service worker access, and the affected UI flows. Report only issues that can be tied back to the diff.

## What

<!-- One or two sentences: what changed and why. -->

## Closes

<!--
One reference per line. `Closes #N` (or `Fixes #N` / `Resolves #N`) is a
claim the acceptance-criteria check (ac-check) grades against that issue's
own Acceptance section — GitHub auto-closes the issue the moment this PR
merges, whether or not the work is really there, so only claim it when the
diff actually delivers it. Use `Refs #N` for an issue this PR touches but
does not finish; ac-check lists those as "referenced, not closing" and never
grades them or raises the auto-close risk warning.
-->

Closes #

## Checks run

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run arena:fuzz -- 40` (arena engine or rules changes)
- [ ] `npm run contract:emit` reviewed (only if the `Snapshot` shape changed)
- [ ] `npm run arena:readings` / `npm run arena:tally` diff reviewed (compiler changes only)

<!-- Paste the ac-check verdict table here once it has run on this PR. -->

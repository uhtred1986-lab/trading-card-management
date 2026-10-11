## What

<!-- One or two sentences: what changed and why. -->

## Closes

<!--
One reference per line. `Closes #N` (or `Fixes #N` / `Resolves #N`) is a
claim the orchestrator reviews against that issue's Acceptance section —
GitHub auto-closes the issue the moment this PR
merges, whether or not the work is really there, so only claim it when the
diff actually delivers it. Use `Refs #N` for an issue this PR touches but
does not finish. For each claimed closure, attach evidence for every acceptance
bullet and clearly list unverified or owner-run checks.
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

<!-- All checks above are local. Add the orchestrator's acceptance review and
     any Kotlin contract checks when Snapshot/fixtures change. GitHub does not
     run duplicate test or AI-review workflows (owner, 11 Oct 2026). -->

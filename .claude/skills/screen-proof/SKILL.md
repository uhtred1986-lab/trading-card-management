---
name: screen-proof
description: Use when you change a screen, layout, CSS or any UI, or the brief asks for "before and after" screenshots at 1440 and 390. One command shoots origin/main and your checkout, diffs them and says which pages changed.
---

# Screen proof: before vs after in one command

Do not rebuild the recipe (worktree, second server, two browsers). Run:

```
npm run shots:compare -- /collection /decks            # app routes
npm run shots:compare -- play over                     # arena fixtures (/arena/preview?fixture=...)
# --base origin/main  --widths 1440,390  --out .shots-compare  --skin night  --rounds 2
```

It needs no database and no `npm run dev` of yours. It starts its own `next dev` for `origin/main`
(temporary git worktree, hard-linked `node_modules`) and then for your working tree, one after the
other, stops them and Chromium by PID, and removes the worktree. Your `node_modules` must be a real
directory (`cp -al <other>/node_modules .` or `npm ci`), not a symlink: Turbopack refuses those.
About 1-2 minutes for a few pages.

## Reading the report (`.shots-compare/report.md`, also printed)

- `identical`: no pixel differs. Say so for every page you did not mean to change.
- `N px changed, box x y WxH`: open `<route>-<width>.diff.png` (red = changed) next to
  `.before.png` and `.after.png`. Check the box is only what you meant. A page size change is shown.
- `identical (flaky: ...)`: the first run differed, the repeat did not. Fine.
- `... (differed in all 2 rounds)` with a box you did not touch: the arena hand fan and similar
  measured layouts jitter between runs on the same code. Judge by the diff image, not the number.
- `needs DB`: the page reads the database and errors without one. Not compared. Name it in the PR so
  the owner compares it by hand.
- `failed`: a real error (exit code 1); read the message.

## In the PR

List each page x width with its verdict line, attach or name the diff PNGs for the changed ones, and
list every "needs DB" page as unverified. Do not commit `.shots-compare/` (git-ignored). Look at the
`.after.png` yourself, not only the numbers.

---
title: Arena: board screenshots from contract fixtures and a contrast audit, both skins (review tooling)
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: scripts/arena-shots.mts, scripts/arena-contrast.mts, src/app/arena/preview/page.tsx, package.json, docs/arena-tooling.md
---
**Source:** `docs/arena-board-redesign-spec.md` §2 (the review tooling row); `contract/fixtures/`; `src/components/arena/stage/ArenaStage.tsx`; `scripts/verify/game-page.ts` (which notes there is no Playwright here); `docs/arena-redesign/README.md`.

**Problem.** Nobody can put the real board next to the design frames without a live game in the Neon database. Development keeps off Neon (`CLAUDE.md`), so today no agent session can see the board it changes. The redesign is visual, so every issue in this milestone needs a picture to be reviewable. The owner's other app, **gullet-cove-dm**, has solved exactly this:
- `scripts/shots.mts` drives the installed Chrome over the DevTools protocol with no new dependency. It shoots 1440×900 and 390×844, supports `--tap`, and sets cookies before navigation.
- `scripts/contrast-audit.mts` is a WCAG 1.4.3 checker. It walks each text node's ancestors and composites translucent fills *and gradient stops* worst-case. axe-core cannot resolve backgrounds through gradients, and the anime sky is built on them.

**Build.**
1. **A fixture preview route**, `src/app/arena/preview/page.tsx`, dev-only (`notFound()` when `NODE_ENV === "production"`). It renders `ArenaStage` from a `contract/fixtures/*.json` snapshot chosen by `?fixture=` — no database and no server actions. `?skin=`, `?staging=` and a `?pace=step` pin work as they do on the game page. Mutations are stubbed so a tap goes nowhere. If `ArenaStage` needs a prop the fixture cannot supply, add the smallest seam, such as an injected `send` that defaults to the real server action.
2. **`scripts/arena-shots.mts`** — port gullet cove's `shots.mts` (read it there; it is self-contained). It shoots the preview route for a list of fixtures × {anime, night} × {390×844 phone with touch emulation, 1440×900 desktop} into `docs/arena-redesign/current/` (git-ignored). File names follow the reference frames' pattern (`phone-…`, `desk-…`) so the two sit side by side. `--tap "<selector>"` shoots an opened state, such as a card's review.
3. **`scripts/arena-contrast.mts`** — port `contrast-audit.mts` and point it at the same preview URLs in both skins. It reports failures as JSON and a table; `--strict` exits non-zero. Card faces are dark on purpose (`docs/arena-skin-spec.md` decision 4), so text inside a card face is judged against the card, not the sky.
4. **`npm run arena:shots` / `npm run arena:contrast`** in `package.json`, and a section in `docs/arena-tooling.md` covering both: what each proves, and that neither is in `npm test` because both need a running dev server and a browser.

**Out of scope.** Playwright as a dependency, CI wiring, and any visual change to the board.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`, where `build` proves the preview route is excluded from production.
- With `npm run dev` running, `npm run arena:shots` writes at least `play`, `attack` and `ko` fixtures × 2 skins × 2 viewports. Attach four of them to the PR.
- `npm run arena:contrast` runs over the same set and its summary is in the PR. Failures are listed, not fixed, unless trivial.

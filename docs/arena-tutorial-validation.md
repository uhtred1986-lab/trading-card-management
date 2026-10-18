# Tutorial implementation validation

Integration PR: #861. Animation dependency: #862 landed at `d1544fbf`; its production deployment was verified READY before the tutorial merge.
Implementation tested: `29312b61`, including animation head `c0effa15`.
Fixture version: 1. Date: 15 October 2026.

## Evidence

- Targeted `arena-tutorial-session.mts`: real RULES transitions, first-turn restrictions, three-Life card conservation, alternative legal play/charge choices, explicit payments, stale/duplicate/rejected commands, actor-isolated request receipts, journal restore, complete win/loss paths, and retained opponent animation beats.
- Targeted `arena-tutorial-lessons.mts`: accepted-action progression, defensive and offensive battle evidence, legal deviations, and safe handoff. Both scripts are in the standard test chain.
- Independent GPT-6.1 Sol review found and prompted fixes for lost animation beats, request-ID collision, and parent subscription/save timing. No remaining blocker in that review through `ce9c835a`; follow-up diff review through `29312b61` also found no concrete blocker.
- Chromium/Playwright browser smoke at 390×844 (touch), 820×1180 (touch), and 1440×1000 with reduced motion: intro and actual ArenaStage render; no JavaScript errors or horizontal overflow. Page heights match the respective viewports. Coordinator visually inspected screenshots.
- Phone night-skin smoke: actual card selection, Charge it, play review, reload and hints toggle. Reload safely closes an unconfirmed review while restoring accepted game actions. No JavaScript errors.
- Responsive fixes preserve the existing hand, action dock, targeting, payment and confirmation components. Tutorial height reservation uses ResizeObserver for layout only; lesson completion uses accepted session transitions.
- Original announcer SVGs reviewed at large and small sizes; no external artwork hotlinks. Browser speech is optional and can be stopped. Session runtime is local and does not use a database or paid AI.

## Standard validation

The combined implementation passed TypeScript, ESLint (five existing prototype warnings), and the complete standard `npm test` chain with `DATABASE_URL` unset. The production `npm run build` also passed. No worker ran the full suite.

## Limits

Engine proofs are not a complete browser playthrough. The brief 15 October browser smoke did not establish keyboard, 200% zoom, short-landscape or full-match coverage (the 18 October section below does; all skins and all viewports are still not covered). Human comprehension has not been tested. Agent evaluation results are recorded separately in `arena-tutorial-usability.md`; neither agent completion nor a prompt-only critique proves learning.

The existing published Sites prototype is an earlier artifact. It is not the deployment of this implementation. Production deployment and TinyFish validation remain dependent on the animation-first merge order. Repository configuration disables hosted branch previews; this work does not change access or deployment settings.

## Animation rebase and live validation authorization

The owner authorized rebasing onto merged animation #862 and merging before the hosted usability test on 15 October 2026. Tutorial commits rebased cleanly onto `d1544fbf`; animation changes remain intact. The shared Stage diff remains an optional readiness callback only. The prior complete suite/build result is retained; affected tutorial session/lesson proofs, immersion assets validation and TypeScript all passed after this rebase. TinyFish will test the deployed tutorial.

## Browser evidence, 18 October 2026 (#843, #844, #845)

`npm run arena:tutorial-browser` (`scripts/arena-tutorial-browser.mts`) in real headless Chrome over `scripts/lib/cdp.mts`, against `next dev` with no database: 148 checks, all pass; `docs/arena-backlog/evidence/tutorial/results.json` lists each one and the jpg screenshots sit beside it. What it adds to the smoke above, and what it does not:

- **Intro (#843):** 390 / 820 / 1440, a keyboard-only walk (focus on the heading, Tab order, 3 px ring, Enter alone), a real-touch walkthrough, 44 px targets, 200 % browser zoom, 200 % text size, short landscape 844 x 390 and 667 x 375, safe-area insets, Back / reload / browser back, Restart and Exit. Three defects found and fixed: no focus on first load, focus lost when the intro closed, a squeezed dialogue column in short landscape.
- **Coach (#844):** input-mode detection (`use-input-mode.ts`, `compactCoach(..., mode)`) proved for touch, mouse, keyboard, a narrow mouse window and a wide touch device; anchors measured at every checkpoint of a match played through the real controls; hints off changes no board text at three widths; reduced-motion path. One defect fixed: the `decision` cue outlined only a toolbar that phones hide (now the dock too, via `data-arena-dock`).
- **Persistence (#845):** reload in the intro, in a play review, at two moments of the opponent's turn, and after hand-off, each with a clean journal; a whole match to its end after hand-off and another with hints off from the start.
- **Found, not fixed (stage code, outside this change):** `Hand.tsx` passes `onDoubleTap={browsing ? undefined : ...}` and browse mode is on, so on desktop a mouse double-click on a hand card does not charge it, although the board's own prompt (`src/lib/arena/vm/view.ts`: "double-click a hand card to charge it") says it does. The coach therefore tells mouse players to click the card and use its Charge button, or to drag it onto Energy.

Still unproven: a real phone, a screen reader, an explicit multi-option payment prompt and the "Confirm attack" step (neither came up on the phone flow), a desktop-mouse attack, a won match (the scripted player lost both), and human comprehension.

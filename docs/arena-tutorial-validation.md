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

Still unproven: a real phone, a screen reader, an explicit multi-option payment prompt in the browser, a desktop-mouse attack, a won match (the scripted player lost both), and human comprehension. ("Confirm attack" cannot come up: see the next section.)

## Acceptance map, 18 October 2026 (#846, #875)

Run: `npm run arena:tutorial-browser` against `next dev` with no database. Pinned to the commit in `docs/arena-backlog/evidence/tutorial/trace.json` (the commit the run started from; the working tree adds the extended script and the phone-frame fix below), fixture `arena:masters-first-match:classic-v2`. `results.json` lists every check; the jpg files beside it are the screenshots. New scenario `audit` (`--only audit`, 72 checks, about 2 minutes); `guided` and `unguided` gained a lesson replay, `Replay practice` and a wait for the attack review. Re-run on 18 October: `audit` (72/72) and `guided` (51/51); `intro`, `input`, `motion`, `boards` and `unguided` keep their earlier passing results (their code is unchanged except that `unguided` now also ends with the shared `Replay practice` check, which passed in `guided`).

**#846**

1. *Deterministic path, skip/replay, legal deviations, rejected action, reload, hints.* `guided` plays one match with the real controls: intro, charge (an alternate card, and an unaffordable card the board refuses with no move and no lesson progress), play review, the opponent's turn and its attack, the defence window (`prompt:combo`), your own attack and target pick, the next charge and play, hand-off, and the match to its end. Skip opening, Lessons > Replay welcome (same match, no move spent) and Replay practice (fresh match, empty journal) are exercised; reload in six places; hints off, restored, and off again from the board's own menu. The accepted journal of a played stretch is `trace.json` (commit, fixture version, every accepted action). Not reached in the browser: an explicit multi-option payment prompt (the session proof `arena-tutorial-session.mts` covers explicit payments; the browser only met the play review) and a won match. There is **no attack confirmation step** to reach: `ArenaStage` contains the "Confirm attack" panel, but nothing calls `setAttackPick` with a value, so a tap on the target sends the attack. The script waits for the panel anyway and would use it if it came back. That is stage code, outside this change.
2. *Sizes, input, skins, motion, zoom, overlap.* 390 x 844, 820 x 1180 and 1440 x 1000 in the anime and night skins (the two the arena's own shots use; namek, korin and instinct were not run), short landscape 844 x 390 and 667 x 375, touch and mouse/keyboard (`input`, and a mouse charge at 1440 in `audit`), reduced motion (`motion`), 200 % browser zoom and 200 % text. Per size and skin: no horizontal overflow; every hand, dock and coach control hit-tested at its centre after scrolling it into view (none covered); 45 Tab presses never stay on one control and reach 27 to 35 different stops (no focus trap). The hand sits under the sticky dock until the page is scrolled, as the stage lays it out, which is why the hit test scrolls first. Against the non-tutorial `ArenaStage` (`/arena/preview?fixture=play`): the same 14 zone anchors, the same End turn control and label, the board's own setting menu and tappable hand cards.
3. *No API/AI, hotlinks, console errors, database.* Every `audit` combination records the console, exceptions, failed requests and every request URL: no error, every request to the page's own origin (52 to 62 per combination, so no artwork hotlink or third party), no `/api/` request. The route runs with `DATABASE_URL` empty. Next's dev indicator (bottom left) is the one thing excluded from hit-testing; it is not in a production build.
4. *Screenshots, trace, honesty.* Screenshots and `trace.json` are in `docs/arena-backlog/evidence/tutorial/`. Automated: everything above. Manual: the author looked at `phone-frame-1440.jpg` and one frame of the 390 board only; the other screenshots are unreviewed evidence. Limits: a real phone, a screen reader, human comprehension, three skins not run, `next dev` rather than production, no won match. Nothing here is added to `npm test` (it needs Chrome and a dev server); no new dependency.

**#875**

1. *Real BT1 decks, eight Life, printed abilities, Awakening, provenance.* `arena-tutorial-session.mts` asserts 50-card decks, eight Life per side and the printed Awaken through the engine; provenance is in `arena-tutorial-classic-art.md`, `-cards.json` and `-decks.md`. The browser run plays those decks and finds no external artwork request.
2. *Contextual guidance, Energy versus Drop, combo consumption, Stage controls authoritative.* `arena-tutorial-lessons.mts` (costs, colours, Play versus combo, Awaken versus Evolve, declined-charge recovery; #879); the browser checkpoints measure the coach against the real board at every lesson step and never find a control covered.
3. *390 x 844 iframe route, honest record.* The route `/arena/tutorial/phone` is now measured by the script: the frame's own `innerWidth` x `innerHeight` is 390 x 844 with no overflow inside it. This **found a regression**: since the design system (#895) the panel around the frame carried `.ds-panel` padding and border, so on a desktop the frame was 340 x 844. Fixed in `src/app/arena/tutorial/phone/page.tsx`. The TinyFish record in the issue stands (incomplete; comprehension not passed; its own size claim not accepted). A CSS viewport is not a physical touch device.
4. *Targeted checks and responsive browser smoke.* The two tutorial verify scripts and this browser script; no broad suite.

Still open on #875 after this: the blind TinyFish comprehension pass that the issue's own comment keeps open. Nothing in this run measures human learning.

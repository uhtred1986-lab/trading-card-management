# Tutorial usability evidence and first-player protocol

15 October 2026. Tested implementation `29312b61`, fixture v1, local Chromium with Python Playwright. Browser tests do not establish child comprehension.

## Blind Luna evaluation

GPT-6 Luna, low reasoning, fresh browser at 390×844 with touch. Brief: learn the game from the tutorial, finish a practice match, explain charging, attacking, combos and winning, and report what cannot be inferred. No source, selectors, hidden state, curriculum answers or walkthrough were supplied. Bound: 10 minutes / 60 actions, one tooling retry. Agent reports staying below the action bound; exact elapsed time, action total and token cost were not instrumented and are unknown.

Outcome: **incomplete, not a pass**. The initial attempt had a Python driver/module error and mistaken charge taps. One permitted tooling retry read the opening, selected a hand card and confirmed “Charge it”; the player saw 1/1 energy and the accepted charge event. The agent could describe charging, cost and the opening concepts, but did not observe attack, combo or victory. It could not activate the visible Play affordances through its text/coordinate driver. It explicitly could not distinguish a UI failure from a driver limitation.

Coordinator reproduction: actual hand-card selection after charge opens the existing Play review, both with reduced motion and with normal animation allowed to finish. Reload and hints toggle also pass without JavaScript errors. The agent screenshot shows dimmed cards and an active Fast-forward playback control, so an in-progress animation is a possible explanation, not a proven root cause. No blocking Play defect was reproduced. Discoverability during playback remains an observation for the second evaluation.

Artifacts were captured in the execution workspace (`work/tutorial-blind-luna`, `work/tutorial-planning`); they are not durable hosted evidence. This was one blind run with a tooling retry, not three independent successes. No prompt-only copy critique is counted as browser evidence.

## TinyFish

Pending, not passed. Must follow Luna. Use the authorized “Arena UX review” profile and the same learning goal, without a walkthrough, source or selectors. Maximum 600 seconds / 60 steps; do not automatically buy or repeat paid runs. Stay inside the synthetic tutorial and never interact with collection data, live decks or matches.

The repository disables hosted branch previews. Its signed-in production profile cannot access the local execution server. Keep animation #862 ahead of tutorial #861 and verify production deployment before running the hosted evaluation. Do not weaken authentication or enable previews to work around this limitation. Record the deployed commit, model/tool metadata where provided, viewport, action/time bounds, observed stalls and final explanation. Reproduce claims before treating them as product defects.

## First-time-player session sheet (not yet performed)

Recruit 3–5 first-time players; use adult observation where appropriate. Do not coach. Record anonymized outcomes only; recording is not required.

1. Open the tutorial and reach the unguided handoff.
2. Ask what happens to a card charged as energy and how ready energy pays a cost.
3. Ask who wins a battle when both sides have equal power.
4. Ask the player to defend using a combo and explain its temporary power increase.
5. Change the board through legal play and ask which action they can take next and why.
6. Turn guidance off, complete one legal turn and explain the victory condition.

For each task record: independent / needed help / not completed, observable confusion, device and approximate time. Proposed directional acceptance: no blocking controls; everyone reaches handoff; at least 80% explain four of five concepts and complete an unguided turn. Report actual sample size. Human results remain unverified until these sessions occur; agent behavior is not a substitute.

## Local TinyFish connectivity check

Run `86f03932-a6e1-4d31-8101-d8bc00e410c7` completed in 20 seconds / 8 steps with `ERR_CONNECTION_REFUSED` for the execution environment localhost URL. The route independently returned HTTP 200 from the execution environment. This is an access failure, not a tutorial usability result. The owner subsequently authorized testing on production after merging onto animation #862; a hosted live run remains pending.

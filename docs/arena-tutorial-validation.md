# Tutorial implementation validation

Integration PR: #861. Animation dependency: #862 (must land first).
Implementation tested: `29312b61`, including animation head `c0effa15`.
Fixture version: 1. Date: 15 October 2026.

## Evidence

- Targeted `arena-tutorial-session.mts`: real RULES transitions, first-turn restrictions, three-Life card conservation, alternative legal play/charge choices, explicit payments, stale/duplicate/rejected commands, actor-isolated request receipts, journal restore, complete win/loss paths, and retained opponent animation beats.
- Targeted `arena-tutorial-lessons.mts`: accepted-action progression, defensive and offensive battle evidence, legal deviations, and safe handoff. Both scripts are in the standard test chain.
- Independent GPT-6.1 Sol review found and prompted fixes for lost animation beats, request-ID collision, and parent subscription/save timing. No remaining blocker in that review through `ce9c835a`; later changes receive a separate diff review.
- Chromium/Playwright browser smoke at 390×844 (touch), 820×1180 (touch), and 1440×1000 with reduced motion: intro and actual ArenaStage render; no JavaScript errors or horizontal overflow. Page heights match the respective viewports. Coordinator visually inspected screenshots.
- Phone night-skin smoke: actual card selection, Charge it, play review, reload and hints toggle. Reload safely closes an unconfirmed review while restoring accepted game actions. No JavaScript errors.
- Responsive fixes preserve the existing hand, action dock, targeting, payment and confirmation components. Tutorial height reservation uses ResizeObserver for layout only; lesson completion uses accepted session transitions.
- Original announcer SVGs reviewed at large and small sizes; no external artwork hotlinks. Browser speech is optional and can be stopped. Session runtime is local and does not use a database or paid AI.

## Limits

Engine proofs are not a complete browser playthrough. The brief browser smoke does not establish exhaustive keyboard, 200% zoom, short-landscape or all-skins/all-viewports coverage. Human comprehension has not been tested. Agent evaluation results are recorded separately in `arena-tutorial-usability.md`; neither agent completion nor a prompt-only critique proves learning.

The existing published Sites prototype is an earlier artifact. It is not the deployment of this implementation. Production deployment and TinyFish validation remain dependent on the animation-first merge order. Repository configuration disables hosted branch previews; this work does not change access or deployment settings.

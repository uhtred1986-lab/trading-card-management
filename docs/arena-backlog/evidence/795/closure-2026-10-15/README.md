# Milestone 23 acceptance reconciliation

PR #808, `arena-m23-phone-ux-reviewed`, integrated with main through `e2a40e88`.
Final application/validation code: `01bb3b61` (subsequent changes record evidence
and issue closure only).
This supplements the retained [14 October results](../README.md); it does not
rewrite the earlier failed/partial runs as successful invocations.

## Remaining acceptance

| Issue | Evidence and disposition |
|---|---|
| #796 | Separate main checkout at `ff2b7d59`: [before screenshots](before/). Identical fixtures on the branch: [after](after/), with final hand/combo captures replaced by the final layout run. Both 360×800/650 skins; [390/1440 before](wide-before/) and [after](wide-after/). The old board had no staged attack confirmation; compare its attack-pick baseline with the new [interaction captures](interactions/). The night palette remains; shared phone layout improvements apply to both skins. |
| #796 contrast | The same evaluator as `arena:contrast` measured frosted strip, lane, fight and dock text, excluding card overlays, at both phone heights. All sampled sky-surface text is ≥4.5:1: [rows](acceptance/results.json). The new green action-chip text was corrected to white. [Whole-board audit](contrast.json) still reports eight card-cost, combo-badge and dim Leader text failures outside the frosted-surface requirement. This is not a blanket WCAG pass. |
| #797 | In a real local match, import the audited pack, Start match, tap the player strip: both original decklists contain card entries, and Drop is inspectable. [Result](acceptance/results.json), [capture](acceptance/zones.jpg), [log](acceptance-night.log). No database. |
| #798 | Existing engine proofs cover legal/empty/not-evaluated target previews, source-state immutability and hidden information. Full integrated test/contract results are recorded below. The current rules engine is the sole engine; obsolete “both engines” wording is not a missing test. |
| #799 | Touch every card in 6- and 10-card hands; open own full/top review; select All/Playable/Counters; use next, previous, swipe and close; measure paging/filmstrip/close rectangles ≥44×44; exercise opponent peek (≤56% height), Bigger and Board. Charge selection changes the dock without a popup, and selecting another card changes its name. [Measured results](acceptance/results.json), [captures](acceptance/). |
| #799 layout | Final [12-case layout result](layout/layout.json) has no page scrolling, covered rows, clipped reasons or covered/clipped hand-action chips. Explicit space for the chips and shorter field rows at ≤720 px fix the found dock overlap. The 66 px combo hand remains unchanged. Legal combo cards now show their snapshot's +5k/+10k value, rather than an irrelevant Counter label. |
| #800 | The retained live-art Vegeta-empty/Unison and Strike cases cover both heights. Supplementary hand-6 cases verify “Need 3” and no enabled Play button for the rejected card. [Unaffordable screenshots](acceptance/), [results](acceptance/results.json). Reasons remain wrapping live text; final layout checks find no clipped target reason. |
| #801 | Engine-generated battle fixtures provide attack pick, confirmation, Counter, Block and Combo at both heights/skins; the public clash cue supplies the verdict frame. These are scripted visual states, not a claim that a static preview advanced a live match. Complete live matches and reference equality are independently proved by the retained release/recovery runs. [Interactions](interactions.log) verify attack/cancel, visible target labels above the targeting review, and active Counter/Block buttons sending exactly one matching card action in all four combinations. [Verdict frames](acceptance/). |
| #802 | Retained normal/reduced-motion subject cues pass. All eight release matches and production recovery pass functionally. Quantitative local timing acceptance is waived for this owner's laptop/network, per repeated explicit instruction; no comparative speed claim is made. Default application/performance gates are unchanged. |
| #795 | Owner S21 approval is complete. The independent TinyFish [phone review](../tinyfish-phone-followup-2026-10-14.md) answered the core screen-reading questions. Its unmeasured hit targets, Bigger/Board and active Counter/Block gaps are covered by the supplementary local checks above. Two-tab ownership/recovery and frozen-owner fencing already passed; their full raw results remain in the parent evidence directory. |

The final interaction check uses real touch events for normal controls. Opening
the targeting inspector uses the card's context-menu inspection handler, then
measures every eligible target label above the sheet. Fixture artwork is
synthetic and may have no image; printed-card readability is established by the
separate live-art cases, not by these placeholder cards.

## Pass / Fast-forward audit

Reviewed against `Prompt` in `src/lib/arena/types.ts`, `action-tone.ts`,
`PromptPanel.tsx`, `shared-sheets.tsx` and `StageZones.tsx`:

| Prompt or state | Decline / progression wording |
|---|---|
| charge | Pass — Don’t charge |
| main | End turn — N attackers can still attack / No attackers left |
| attack pick and confirm | Pass — Cancel the attack |
| counter (all windows) | Pass — Don’t counter; detailed engine consequence remains available |
| blocker | Pass — Keep the current target |
| combo, offense/defense | Pass — If unchanged: take/defend the hit when stakes exist; otherwise Finish adding combo power. Engine response-window consequence remains in the details. |
| optionalCost | Pass — Don’t pay the optional cost |
| chooseCards with a legal empty selection | Pass — KO nothing for KO choices, otherwise Choose nothing or the engine consequence; no Pass for a mandatory nonempty choice |
| chooseFirst, mulligan, orderPending, chooseMode, replaceMove, zEnergyFromCombo, payCost, offering, empowerCarry | Explicit engine-labelled choices; no invented generic Pass. An explicit mode such as Don’t pay, or a zero-marker option, keeps its engine label. |
| referee, gameOver, other player's decision | No human Pass action |
| narration/replay | ⏩ Fast-forward in the narration line; Next ▸ for the player's step-paced narration, separate from decision buttons |

## Validation notes

- A first supplementary run mixed a night query with the sky cookie. The harness
  now sets both; those mixed-style captures are not acceptance evidence.
- Reserving hand-chip space then exposed a real short-screen overflow. The final
  row sizing and chip layout pass the strict layout check in both skins.
- An initial typecheck read a malformed generated `.next/dev/types/validator.ts`
  while the dev server was generating routes. Final gates run with both dev
  servers stopped and that generated cache file removed.
- Main advanced during validation with #822's iPhone/Safari support. The merge
  retains both its safe-area/input styles and M23's sky styles. The earlier full
  test attempt was deliberately stopped and restarted on this combined state.
  At the emulated phone's zero safe-area insets, the new left/right padding is
  the same 8 px as before; the comparison baseline remains `ff2b7d59`.
- No dependency, migration, database content or production-setting change.
- Source review reproduced an implicit-selector edge case in the new choice
  preview. An omitted area defaults to Battle Area in the VM, so the same
  conservative own-Battle guard must apply to both selector forms. The added
  synthetic-selector regression failed before the one-line fix and passed
  afterwards; it does not reinterpret any printed card. The full merge gate
  was restarted after this final application change.

## Final merge gates

On final application code `01bb3b61`, integrated with main `e2a40e88`:

- Standard `npm test`: **PASS, exit 0**, complete uninterrupted invocation with default timing gates unchanged. [Full log](test.log).
- Production `npm run build`: **PASS, exit 0**, including TypeScript and route generation. [Full log](build.log).
- `npm run typecheck`: **PASS**. [Log](typecheck.log).
- `npm run lint`: **PASS**, zero errors and five existing prototype warnings. [Log](lint.log).
- Backlog validation: **242 files clean**. [Log](backlog.log).
- The retained contract emission run passed 85/85 with no fixture diff; the final conservative selector guard changes neither the contract shape nor emitted fixture expectations.
- `git diff --check`: clean. No database connection or production credentials used.

The earlier interrupted full-suite runs are superseded by this complete successful run. Local release timing observations remain excluded from app-defect findings per owner instruction; this does not weaken correctness assertions.

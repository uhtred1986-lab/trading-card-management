# Milestone 23 branch validation

The integration implements #796–#802 in the production board and current rules
engine, using the approved #788 prototype as a behaviour reference. It does not
restore the removed legacy engine or change database contents.

## Final acceptance reconciliation — 15 October 2026

The [closure evidence](closure-2026-10-15/README.md) supersedes the remaining-open
statements below. It includes before/after comparisons, measured interactions,
decklists, scoped contrast, final hand-chip fixes, a complete prompt-wording
audit, and final merge gates. Earlier run results below remain historical records.
Owner laptop/network timings are excluded; quantitative performance acceptance
is explicitly waived rather than falsely reported as a measured pass.

## Recovery and independent phone follow-up — 14 October 2026

The two previously incomplete checks have now produced passing evidence within
the scopes below. Application code remains `f7831ce7`; this follow-up changes
only the validation harness and evidence.

- **Production recovery: passed.** `arena:local-browser --json --total-timeout
  1800` completed with no failures or browser exceptions. Simultaneous Continue
  produced exactly one owner and one watcher; watcher moves were refused;
  **Play here instead** transferred ownership and fenced the old writer without
  writing another move. The match ended at revision 128, with all 127 decisions,
  trace, final board and next AI decisions after recovery equal to the reference.
  All 86 observed revisions matched; no match/provider request occurred.
  [Full result](local-2026-10-14/recovery-foreground.json).
- **Dedicated browser ownership proof: passed.** Real Web Locks, IndexedDB and
  BroadcastChannel tests cover concurrent claims, takeover during AI work,
  closing the owner, worker kills before/after persistence, frozen lease owner
  fencing and cleanup. All 86 observed revisions matched the reference.
  [Result](local-2026-10-14/ownership-followup.json).
- **Independent TinyFish phone screen-reading review: completed.** The follow-up
  exercised the unchanged production app in real 360×800/360×650 iframe browsing
  viewports. Turn/hand ownership, Leaders, actions, payment information, battle
  stakes and Pass consequences were readable; no internal decision scrolling or
  row/hand/dock overlap was reported. Hand navigation and attack cancellation
  were reported exercised. [Report, scope and caveats](tinyfish-phone-followup-2026-10-14.md).
  This is responsive layout evidence; the owner's S21 pass supplies physical
  device approval. Actual hit-target measurements, independent skin/reduced-motion
  comparison, Bigger/Board and active phone Counter/Block choices are not proved
  by this run. Existing deterministic checks are not replaced by reviewer prose.

The full UI harness initially timed out during tab opening/takeover. It now
allows 120 seconds to settle and 180 seconds to open the two tabs, and disables
headless Chrome background timer/renderer throttling for this CDP-driven test.
All correctness assertions remain enabled. This combination produced the full
pass; it does not establish an app regression or isolate a single timing cause.
The separate ownership proof still tests frozen-tab lease recovery explicitly.
[First follow-up](local-2026-10-14/recovery-followup.json) and
[longer-wait attempt](local-2026-10-14/recovery-patient.json) retain the earlier outcomes.

TinyFish's first follow-up could only use desktop dimensions; the second used
this temporary [review-frame proxy](local-2026-10-14/phone-review-proxy.mjs).
It changes only the containing viewport, not the game, DOM or styles. Both
tunnels, the proxy and production server were stopped after review. Laptop and
network delays remain excluded from app-defect findings by owner instruction.

## Earlier local validation — 14 October 2026

This section supersedes the historical handoff below. Tested application revision:
`f7831ce71961734033fe70336ac435964802881f`, branch
`arena-m23-phone-ux-reviewed`, PR #808. Windows, Node 24.21.0, Chrome 155;
lockfile dependencies verified. No production database or provider calls.

- **Owner S21 approval: passed.** The owner confirmed "yes all happy, close the
  requirements". The physical-device requirement is complete.
- **Production build, typecheck and lint: passed.** Lint retains five existing
  prototype warnings. [Build](local-2026-10-14/build.log),
  [typecheck](local-2026-10-14/typecheck.log), [lint](local-2026-10-14/lint.log).
- **All functional test-chain checks passed across the run and continuation.**
  The original `npm test` stopped at combat policy's 119.1 ms maximum against a
  100 ms ceiling. Per owner instruction, the continuation used the explicit
  timing-recording option for that proof; it passed all functional assertions
  and measured p95 0.34 ms/max 9.9 ms. All 28 commands from that point onward
  ran. One SDK stub assertion assumed Linux path separators; after correcting
  its expected paths for Windows, that entire proof passed on rerun. This does
  not claim the original unmodified `npm test` exited zero.
  [Original log](local-2026-10-14/test-original.log),
  [continuation log](local-2026-10-14/test-remaining.log),
  [per-command exit codes](local-2026-10-14/test-remaining-results.json),
  [SDK proof rerun](local-2026-10-14/ai-agent-sdk-retry.log).
- **Contract emission: passed, 85/85 engine suites.** The emitted fixtures
  match the committed contract (no diff). The rules engine is the only engine
  since #118; old "both engines" acceptance wording is obsolete.
  [Emission log](local-2026-10-14/contract-emit.log).
- **Phone checks: passed.** 28 layout cases, four interaction combinations,
  16 feedback/motion cases and six real-card art cases. Both skins at 360×800
  and 360×650; arrows/swipe and staged attack/cancel work. The art run loaded
  live remote artwork, unlike the older cached-art evidence below.
  [Layout](local-2026-10-14/layout.json), [interactions](local-2026-10-14/interactions.log),
  [feedback](local-2026-10-14/feedback.log), [art](local-2026-10-14/art.log).
- **Complete release matrix: functional pass.** All eight matchups completed;
  recovery reproduced the reference journal and final board (106 decisions,
  revision 107). All 16 offline artwork blobs loaded and there were no match or
  provider requests. [Machine report](local-2026-10-14/release-matrix.json),
  [log](local-2026-10-14/release-matrix.log). Run with `--record --total-timeout 1800`.
- **Timing is informational on this machine, by owner instruction.** Nine
  release timing budgets were exceeded; these are not app-defect findings or
  evidence of a regression. Memory budgets passed; process RSS was unavailable
  on Windows. This run does not establish comparative performance acceptance.
- **Dedicated recovery harness: not a complete pass.** The first run finished
  a reference-identical 164-decision match but exposed a race in its worker-kill
  injection. Dispatch-time injection fixes that race and passed the mid-AI kill;
  the later run did not settle the two-tab ownership scenario. Observed states
  matched the reference and browser exceptions were empty. Keep this requirement
  unverified rather than attributing timeouts to the app.
  [Original](local-2026-10-14/recovery.json),
  [retry](local-2026-10-14/recovery-retry.json),
  [dispatch-time injection](local-2026-10-14/recovery-dispatch.json).
- **Independent TinyFish review: partial.** The exact built branch was served
  through a temporary tunnel. The run reached desktop mulligan but did not
  exercise phone combat/payment, both skins, reduced motion or touch targets.
  [Report and limits](tinyfish-local-2026-10-14.md). Slow artwork downloads are
  an environment observation, not an app defect. Server and tunnel are stopped.

Representative captures: [10-card hand](local-2026-10-14/hand-10-360x650-anime.jpg),
[attack confirmation](local-2026-10-14/attack-confirm-360x650-anime.jpg),
[Strike targets](local-2026-10-14/strike-target-decision-360x650.jpg),
[Vegeta without a target](local-2026-10-14/vegeta-empty-360x650.jpg).

Validation-only harness changes retain normal gates: Chrome profile cleanup
cannot mask a release result; worker termination happens at dispatch; the combat
proof has an explicit `--record-performance` option that skips only timing
assertions. The SDK stub test normalizes expected paths for Windows, with no
provider change. Application code and dependency manifests are unchanged.

Passed acceptance items are checked on the issues and in their backlog copies.
Unverified composite requirements remain open; this record does not claim the
whole milestone is complete.

## Historical browser evidence

`arena-phone-ux.mts` checks 360×800 and 360×650 in both skins: visible phase
track, no page scrolling, no dock covering the rows/hand, and no clipped target
reasons. Six core states passed; `phone-ux-combo-empty` additionally proves the
engine-supplied Counter/Block `none` markers.

`arena-phone-interactions.mts` passes full-screen arrows/swipe and staged
attack selection, visible summary, cancellation in all four phone/skin
combinations. The generic CDP tap helper auto-scrolls first; the Open hand
check touches the already visible control to avoid scrolling a sticky board.

`arena-phone-feedback.mts` passes visible hit/held/life/KO subject cues with both
motion preferences and skins. Reduced cues have no animation. Phase cue
folding, privacy and duration are covered by the retained engine/cue proofs.
These screenshots do not prove physical-device rendering or timing budgets.

`arena-phone-art.mts` uses the real BT11-011/BT6-025 engine snapshots from
`evidence/798/browser`. The captures load cached artwork of those same printed
cards from the approved prototype; they do not prove remote CDN readiness.
Combat/hand layout fixtures use synthetic cards. Screenshots are from the real
dev board; the Next development indicator is absent from production.

- [Attack confirmation](attack-confirm-360x650-anime.jpg)
- [Blocker option](blocker-360x650-anime.jpg)
- [Empty response steps](combo-none-360x650-anime.jpg)
- [Printed Vegeta review](vegeta-card-360x650-anime.jpg)
- [Optional empty on-play effect](vegeta-play-anyway-360x650-anime.jpg)
- [Transcendent Strike targets/rejections](strike-targets-360x650-anime.jpg)
- [Reduced-motion held cue](held-reduced-360x650-anime.jpg)
- Hit: [motion](hit-normal-360x650-anime.jpg), [reduced](hit-reduced-360x650-anime.jpg)
- KO: [motion](ko-normal-360x650-anime.jpg), [reduced](ko-reduced-360x650-anime.jpg)
- Life loss: [motion](life-normal-360x650-anime.jpg), [reduced](life-reduced-360x650-anime.jpg)

## Historical checks and handoff gates (superseded above)

- Typecheck and targeted lint pass. Full lint has five pre-existing warnings
  in the old prototype assets.
- Contract emission passes 84/84 engine cases. Attack and defense fixtures
  include the additive, viewer-filtered response-history field.
- Target preview, exact payment, attack/block projection, response-window
  privacy and cue proofs are in the standard test command.
- A contrast audit of the changed sky surfaces led to stronger phase, energy
  gain, folded-hand and action/cost-chip text. The broad contrast audit still
  reports pre-existing card badges, inactive cards and desktop animation text;
  it is not a blanket WCAG pass.
- Full suite, typecheck, lint and production build pass on code commit
  `ad788078b2d2026bd7aa14e47d25332c633ca043`. Earlier production recovery
  passes reloads, worker termination, quota/abort and two-tab takeover,
  ending with 172 journal decisions identical to the reference. A fresh recovery
  run on that code commit was stopped at the owner’s request on 14 October;
  it is not a new pass.
- Performance acceptance remains open: the last full branch matrix
  (`b4aed13b`) passes all functional cases and frame budgets but exceeds startup
  (834.4 ms versus 770 ms) and long-task count (24 versus 12). Current main
  (`6f08002f`) also exceeds those budgets (941.8 ms and 23 tasks). The latest
  code has only a single-case probe, not a completed full release matrix.
- The browser recovery run found rejected-target rows calling a location helper
  before initialization. The helper is now hoisted; browser exceptions are
  retained in the proof output so a future render failure keeps its cause.
- The production TinyFish report's hidden phone deck-inspection button is
  now visible with a 44px tap target. Payment-preview controls also have 44px
  targets. These are source/local fixes awaiting independent browser retest.
- The complete delayed KO flight shares one sub-700ms visual budget; its burst
  and flight remain distinct and narration dwell is unchanged.
- TinyFish review of this branch has not run. The owner deferred validation
  on 14 October and will run locally. The production build was launched on
  local port 3000 and `/arena/offline` returned HTTP 200; the workspace offers
  no public forwarding URL for TinyFish. Both local processes are stopped.
  Git/Vercel branch previews are disabled and the
  fixture route is dev-only, so review needs a reachable built-branch deployment.
  Do not test old production and report it as acceptance of this branch.
  [The regression checklist](tinyfish-retest.md) identifies both baseline runs
  and includes setup/navigation findings that Milestone 23 has not addressed.
- Owner S21 retest passed on 14 October 2026: Heyhey confirmed in the local validation chat, "yes all happy, close the requirements". The physical-device owner requirement in tracker #795 is satisfied. Automated release and independent browser gates are tracked separately.

No milestone issue is closed by this evidence record.

## Owner local launch

Use Node 24 and branch `arena-m23-phone-ux-reviewed` (PR #808). On a clean
checkout, install with npm 10 if npm 11 rejects optional lockfile packages.
Run without a production database or authentication configuration:

```sh
npx --yes npm@10 ci --no-audit --no-fund
env -u DATABASE_URL npm run build
env -u DATABASE_URL -u AUTH_SECRET -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET -u SL_EMAILS -u BASIC_AUTH_USER -u BASIC_AUTH_PASSWORD npm run start -- -p 3000
```

Open `http://localhost:3000/arena/offline` for the real production board.
The fixture review route `/arena/preview` is available only with `npm run dev`.
TinyFish runs remotely and needs a public URL forwarding to the local server.
Use the regression checklist above for its previous findings.

# Battle stakes and resources — #562

The browser harness renders the real ArenaStage from EngineAPI-built snapshots.
The fixtures stage public cards through the repository harness; turns, counter
and combo windows, legal actions, prices, snapshots and continuation events
come from the rules engine. Test attackers/leaders are visibly synthetic text
faces. Double Strike, Critical and Victory Strike attackers are Blue Leader
definitions with null energy/combo costs and null combo power; the synthetic
Unison also has null combo statistics. Fixture construction and every snapshot
validate the types and statistics of Leader/Unison areas, and negative cases
reject mismatched attacker, guard and Unison definitions. Senzu Bean and Whis's Coercion keep their catalog facts and use the
checked-in real artwork from #546; artwork is served from local intercepted
URLs, with no database or remote-art download.

`before-{desk,phone,shortphone}-{anime,night}.jpg` records the unchanged board
UI from main 08b65df before the UI edits. The newly added optional server facts
were ignored by that UI. `after-*` uses the same engine-built baseline fixture,
with actor, totals, conditional tie result, Pass consequence and resources.
The short phone is 390×650; phone is 390×844; desktop is 1440×900. The 200text
captures set the root text size to 200% and emulate reduced motion. Dev tools
portals are removed before the after captures. Captures wait for the expected
rendered decision and two paint frames, then recheck it after capture, so a
fixture reload cannot be accepted as a Loading-only evidence frame.

The normal phone was compared with `docs/arena-redesign/phone-07-clash-defend.jpg`
and desktop with `desk-07-clash-defend.jpg`. The current band preference and
public energy/resource line remain visible. During phone hand decisions, only
empty Battle rows whose Leaders have moved into the band shrink from 128px to
96px. Occupied rows and drop targets retain their full card footprint. The
Assumptions disclosure shares the Pass row, and the combo hint sits beside
Inspect hand, leaving a readable, tappable card strip above the dock at normal
390×844. The conditional result and immediate consequence stay visible; full
pending-skill/replacement caveats and public blockers/restrictions with expiry
remain in the disclosure. Overall crowded-hand/phone consolidation stays under
#563.

The harness asserts Double Strike, Critical and potential lethal summaries
before submission in both skins on desktop and phone. Payment fixtures show
separate remaining-colour previews for exact offered payment options. A
captured UI payment is independently applied to the real engine and must
emit the combo movement. A genuine same-view Counter: Attack → Defense update
uses captured No-counter, the real engine's offense Pass and increasing
snapshot revisions; an older poll must not restore the old decision.
The preview transport itself only records actions; it does not pretend to be
a production game server.

In both phone skins, a legal combo card must expose an unobscured 44×44px tap
area outside the sticky dock, verified with nine elementFromPoint samples.
Normal 390×844 starts with this area visible without scrolling. Actual touch
opens hand inspection and expands its artwork fullscreen; after focus restores
page scroll, actual finger scrolling recovers the hand. Normal-text and 200%
taps each capture an offered combo, independently apply it to EngineAPI, and
verify movement into Combo Area, fewer hand cards, unchanged energy for the
zero-cost combo and the increased defense total in the same view. Short-phone
and 200% access uses actual touch scrolling starting on visible board content
above the dock. Separate occupied-row fixtures verify the full row footprint
and touch access through In play inspection to fullscreen review. The
`*-hand-access`, `*-hand-combo*`, `*-hand-inspection` and
`*-occupied-inspection` images record these paths.

At 200% text, Pass is reached with actual Tab traversal and activated with
Enter. Its rectangle must fit inside the viewport and its centre must hit the
control via elementFromPoint; horizontal page overflow is checked. A phone
finger scroll is used when the control needs to be brought into view. Captured
Pass must equal an offered action and independently produce the engine's power
comparison. The harness also touches Pass at 200% on both phone sizes and skins, then verifies Tab/Enter as an independent continuation of the same offered decision. Counter decline has its own real phone touch proof.

Reproduce locally, without a database:

```sh
DATABASE_URL='' npm run dev -- --port 3022
DATABASE_URL='' npx tsx scripts/arena-battle-stakes-562.mts --base=http://localhost:3022
DATABASE_URL='' npx tsx scripts/verify/battle-stakes-562.ts
```

The pure scenario suite covers tied/held attacks, Strike/Critical/Victory
outcomes, actual optional life replacements and pending Autos, public Unison
marker loss and Indestructible, negated/removed/completed battle suppression,
private payment options, serialization, old-view fallback and stale revision
reconciliation. Exact colour grants, source departure/turn expiry and payment
basis have additional independent checks. The default totals and payment
previews use the existing planner's payment colours. Inspection separately
shows effective colours if they differ, and explains that gained colours do
not affect energy payments in this arena yet. A Red energy card gaining Blue
remains refused for Senzu's Blue orb in the current engine; the regression
asserts that existing limitation without teaching the UI a different rule.

No new dependencies, migrations, settings changes, live database reads/writes,
paid provider calls or production checks are involved. Kotlin decoding was
attempted with the existing Docker image, network disabled and Gradle offline;
its required Kotlin JVM 2.1.0 plugin is absent from the cache, so decoding is
unverified. `arena:fuzz 40` needs live deck data and is owner-run; the resolver's
damage and battle-intact queries are extracted unchanged, with no new rule
mechanic or compiler reading to measure. Final local gates all passed on frozen source `89cae2a` (runtime source `4524998`): typecheck, lint
(5 existing prototype warnings), contract emission, full npm test and build.
Legacy arena: 42/42; rules-only: 41/42 with the legacy-parity VM suite
intentionally not run; emitted contract: 42/42 on each engine. The browser
harness also passed expanded-disclosure reachability. Results and retained
logs are in `checks.json` and `logs/`; only canonical/evidence bookkeeping
followed these checks. #626 owns the existing colour-grant payment limitation.

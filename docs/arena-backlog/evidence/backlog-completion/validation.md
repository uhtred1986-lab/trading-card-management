# Combined backlog validation — PR #824

Coordinator review covers the integrated search/evaluation, diagnostics/replay, optional
exact choice, Bond/native keyword fixes, reviewed data refresh commands, cost migration,
Arena testing portal and online/local testing-deck filtering.
The owner requested grouping related work and delegated implementation to cheaper workers.

## Evidence

- Focused native keyword, Bond, optional exact-count, refresh compare-and-swap, replay and
  fuzz diagnostics checks pass. Refresh PGlite proofs refuse stale rows and preserve owner
  programs/non-null costs.
- `npm run contract:emit`: 90/90 arena suites pass. Reviewed fixture diff changes only
  `ARRIVES2#0`'s probe digest, from `3680fcfa` to `754351b2`, after the explicit “the Battle
  Area” printed wording fixture changed; outcome remains fired. No snapshot schema changes.
- Full catalog reading comparison: 6,552 cards / 13,615 records; 23 changes (22 optional
  exact selections and BT3-030's missing trigger), 13,592 unchanged; all 3,363 unread clause
  shapes unchanged. See `compiler-readings.json` and `../538/README.md`. This is a bounded
  diff review, not confirmation of the whole catalog.
- Captured stored-rule fuzz: 40 games, 39 completed, one interruption, zero crashes or
  action limits. Remaining SD13-05 condition metadata is the explicitly approved repair;
  see `captured-fuzz-summary.json`. Global-stream changes prevent treating before/after
  totals as paired game comparisons. Recent native Attack/Revenge and Bond failures have
  independent focused reproductions.
- Search holdout: 80/80 complete, zero illegal, 418 hidden-state twins, 41–39; failed
  predeclared strength gate. No difficulty is shipped. Chrome policy/Worker evidence and
  the initial performance miss are preserved in `../663/` and `arena-policy-strength.md`.
- Authenticated backlog drift check: 244 canonical files clean against GitHub.
- Player UI changes: Arena navigation and testing-deck toggles; deck create/edit flags;
  the admin testing portal. The owner waived physical-phone acceptance testing.
  The deck naming affordance and release validation corpus are tracked in #827.
- First 26-rule live refresh is recorded in `rule-refresh.json`. The separate approved
  eleven-rule plus owner-condition repair runs after matching production deployment;
  readback and final readiness are recorded in PR #824's closeout, not preclaimed here.

Full integrated `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`
all passed under Node 24 with DATABASE_URL unset. Five existing lint warnings remain
in the checked-in prototype JavaScript; there are no lint errors. The final integrated run includes the portal and testing flags and passed in full.
The initial combined run caught a guard-order violation in `createDeckForm`; it was
fixed and the complete four-command chain rerun successfully.

## Delegation review

The cheaper tooling worker delivered the compact replay CLI and the Bond Auto fix.
Coordinator review required semantic fixups for Battle-Card-only counting and energy-orb
versus name parsing, plus tests for paid Bond and mixed action prices. The search and
coverage workers delivered the broader runtime/evaluation changes. The coordinator
reviewed combined semantics, protected data writes and evidence and owns final gates.

The cheaper UI worker delivered the portal and deck forms. Coordinator/browser review
required fixes for truncated recipe IDs, stale hidden picker selections, copied testing
flags, exact Opus model validation, form-reset data loss, statistics denominators and
mobile overflow. Backend/coverage workers delivered persistence, sample-aware statistics
and planning data; independent read-only review found no remaining data/privacy blockers.

## Remaining scope

- #825: Cooler qualified Battle-to-hand watcher, Trunks Battle/deck-to-Warp self trigger,
  Great Ape combo-end evolution. These remain actual supported-play gaps.
- #826: Resource-aware search and fresh strength holdouts.
- #827: Named release deck pairs, specific ability scenarios, discoverable naming and
  a bounded Opus comparison pilot. No paid call was made for the proposal.

The O5 tracker #637 remains open; this PR does not claim every printed rule is supported.

## Portal and testing-deck evidence

- Migration 0052 adds the testing flag (false for existing decks) and three tables;
  64 recipes and 55 scenarios start planned. GET is read-only. No new dependency.
- PGlite verifies durable reload, CAS conflicts, idempotent recording, malformed
  winners/costs/evidence, exact Opus model labels, mirrored unique-game/seat counts,
  same-seat filters and legacy interrupted/model provenance.
- Testing flag proof covers scoped database reads, download propagation, update
  fingerprints, legacy packs, unchanged engine inputs and both-seat filtering.
- Local browser viewport checks use isolated Postgres fixtures, not production data.
  The portal, Arena, decks and deck details fit 390 and 1440 widths. Local picker
  tests cover both seats, toggling back to normal decks and all-testing empty states.
- General strategic benchmark families AI-01..12 are planned, not new passing tests.
  No paid Opus calls ran; proposed budgets and manual cost reports are labelled.
- Browser interaction proof passes: progress survives reload; rejected saves retain
  inputs; long recipe IDs record intact; manual unknown-cost results persist; online
  hide/show resets both selected testing decks. Deck create/edit flags persist and
  preserve existing notes. Card-art URLs were unavailable in this isolated browser
  environment, so before/after images show the app's image fallback.

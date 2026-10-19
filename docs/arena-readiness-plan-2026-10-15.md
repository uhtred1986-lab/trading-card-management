# Arena readiness and testing plan — 15 October 2026

The owner asked for a visible playable built-in opponent, a prepared Claude API comparison campaign and an unread-rule audit. GitHub now has three milestones, twelve issues and a complete affected-card index. The owner subsequently requested **one consolidated unread-rule issue** and approved **$20 pilot / $100 total including pilot**. No paid comparison calls were made during planning.

**Historical 15 October snapshot.** The [current rules delivery plan](arena-rules-delivery.md)
and [current state](arena-CURRENT.md) supersede the dispatch order and pending-work
claims below. In particular #1030 delivered the starter corpus tool, #1026 fixed
the tactical defense case, and #898 is closed. Keep the original counts as dated
evidence. The approved $20 pilot / $100 inclusive campaign cap remains unchanged.

## What the inspection found

The non-LLM opponent already exists. `localPolicy()` and the browser Worker play prepared Masters decks without provider tokens. Arena home exposes that flow through a small “Play on this device” text link rather than a primary opponent choice. Existing offline/recovery work is delivered; #793’s owner-waived physical-phone check stays waived. Make the shipped opponent discoverable before claiming a new difficulty.

The two bounded search experiments did not pass their strength promotion gates (41–39 over 80 games for the first; 142–178 over 320 completed games for resource-aware search). Keep the heuristic default. The real-card tactics matrix still has a turn-long White Kamehameha defense failure. Closed #826 is valid negative evidence; #899 is its bounded next improvement.

The existing `arena:vs` script uses a first-legal-move human stand-in and writes server game records. It does **not** compare the actual local policy against Claude. The paid campaign needs an isolated duel runner, durable spending reservations and pinned masked observations, rather than another run of that smoke script.

The live rule audit found 1,714 Masters cards / 1,985 unread skills. A guarded refresh repaired 22 reviewed stale skill records on 22 cards. **Remaining: 1,694 catalog entries / 1,963 skills, including 40 Energy Markers (1,654 non-marker cards).** Twenty cards lost their last unread skill; two retain a different gap. All remain drafts requiring review. No affected unread card is currently in the 29 saved decks; missing triggers, runtime support and strategic behavior remain separate concerns. The complete [audit report](rules-audit-2026-10-15/README.md), [card checklist](rules-audit-2026-10-15/cards.md) and [machine-readable evidence](rules-audit-2026-10-15/audit.json) retain every affected face and skill.

## Milestone 30: make computer play visible and reliable

[Milestone](https://github.com/uhtred1986-lab/trading-card-management/milestone/30) · [Tracker #900](https://github.com/uhtred1986-lab/trading-card-management/issues/900)

| Order | Issue | Deliverable | Gate |
| --- | --- | --- | --- |
| 1 | [#896](https://github.com/uhtred1986-lab/trading-card-management/issues/896) | Primary “Play against computer” entry, useful preparation/refusal/update/resume states, clear token-free wording | Coordinate home design #894; reuse LocalArena |
| 2 | [#897](https://github.com/uhtred1986-lab/trading-card-management/issues/897) | Frozen qualified starter controls, then a concrete additional pair from #827; reproducible both-seat local runs | Actual stored-rule/runtime checks, not compile percentage |
| 3 | [#898](https://github.com/uhtred1986-lab/trading-card-management/issues/898) | Real human-versus-heuristic walkthrough and reload/offline/two-tab recovery | After #896 + #897 |
| 4 | [#899](https://github.com/uhtred1986-lab/trading-card-management/issues/899) | Fix and measure turn-long defensive valuation | Independent strategic fixtures, fresh paired holdout; retain heuristic unless promotion passes |

Steps 1 and 2 can progress independently. Step 4 is continuing strategy work and does not block exposing the shipped opponent. Verify existing #825 code/refresh evidence instead of duplicating its Cooler/Trunks/Great Ape work or assuming its open metadata describes current behavior. Reuse #827’s lists, scenarios and result-import system.

## Milestone 31: local policy versus Claude API

[Milestone](https://github.com/uhtred1986-lab/trading-card-management/milestone/31) · [Tracker #906](https://github.com/uhtred1986-lab/trading-card-management/issues/906)

| Order | Issue | Deliverable | Gate |
| --- | --- | --- | --- |
| 1 | [#901](https://github.com/uhtred1986-lab/trading-card-management/issues/901) | Isolated real-policy/real-VM versus explicit Anthropic API runner; masked menus, typed stops and replayable manifests | Fake-provider $0 proof first |
| 2 | [#902](https://github.com/uhtred1986-lab/trading-card-management/issues/902) | Verified exact model/rates; durable atomic worst-case reservations, retries and restart-safe cap | Fail closed on unknown model/price/billing |
| 3 | [#903](https://github.com/uhtred1986-lab/trading-card-management/issues/903) | Freeze corpus, seed pairs, policy/model/settings, pricing and protocol; run preflight | #897 + #901 + #902, independent rules/strategy expectations |
| 4 | [#904](https://github.com/uhtred1986-lab/trading-card-management/issues/904) | At most eight pilot games, stopping at $20 | Verified preflight; inspect trace validity and useful findings |
| 5 | [#905](https://github.com/uhtred1986-lab/trading-card-management/issues/905) | At most 40 total games, stopping at $100 inclusive of pilot; publish per-archetype results and repair findings | Pilot validity/usefulness review passes |

The owner’s numeric cap is already approved. Exact API model availability, current rate verification and credential readiness remain unverified; runtime variable names alone do not establish usable app credentials. Use the app’s API credential binding; never substitute the agent session’s own model credentials. The campaign must include retries/failed billed calls in its ledger, record limited/error games separately and never expose hidden opponent state. Do not import results into the live portal merely as part of a dry run. A Claude opinion is diagnostic evidence, not a rules ruling or a strength-promotion substitute.

## Milestone 32: consolidated unread-rule repairs

[Milestone](https://github.com/uhtred1986-lab/trading-card-management/milestone/32) · [Single repair issue #907](https://github.com/uhtred1986-lab/trading-card-management/issues/907)

The complete 1,714-card baseline and 1,694-card remaining queue live in the linked audit, rather than thousands of individual GitHub issues. Full semantics have not all been individually adjudicated: each affected row was scanned, compared with current compilation and indexed with printed text and remaining clauses. Existing mechanism/shape buckets are engineering triage hints.

Prioritize these bounded repairs:

1. P-616/front/20: fresh compilation incorrectly reads a total of seven `<GT>`-named cards across energy, Z-Energy, Battle and Drop as one in energy. Preserve its unread record and prove both threshold/area boundaries before refresh.
2. Review the other eight clean parses held for runtime/context concerns; clean text alone does not earn support.
3. Implement the owner’s social-card ruling for P-514–P-516 and P-588–P-592: **show a compliment, then acknowledge the instruction**. The explanations are already recorded on all eight cards via `arena:rule`; visible behavior is pending.
4. Verify classification and representation of the 40 Energy Marker records tagged `dbs`. Retain them in the raw census until the source/product semantics are checked.
5. Work repeated shapes through shared compiler fixes, updating each card’s checklist and exact positive/negative scenario evidence. Favor requested decks and the qualified release corpus over a catalog-wide percentage.

Use the delivered #830/#831 guided review workflow. Further improvements should make the grouped queue easier to work through and preserve context, rather than introduce another editor or force manual confirmation of every compiler gap. Ask the owner only when a real ruling or missing input remains; ordinary unsupported wording is engineering work.

## Verification and boundaries

The 22 refreshed records had matching printed text and no named runtime/context support warning, were individually reviewed and updated through the repository’s compare-and-swap refresh helper, then read back. Versions increased by one and status became draft. All 85 owner- or Claude-owned records and 13,593 untargeted programs stayed unchanged. Eight promo explanations changed only through the supported ruling command. No catalog sync, game-tag rewrite or blanket approval ran.

The pure rules-engine verification passed **91/91 suites**, including existing printed/manual-based summed targeting, taxes, alternate battle activation and follow-up checks. Full local checks and the production build are recorded in the PR’s final validation. This planning/audit change contains no new app UI, policy or engine implementation; new discoverability and Claude comparison acceptance remain explicitly open in the milestones.

One writer at a time for shared home/setup UI, policy/combat, Worker, snapshot and replay boundaries. Use one implementation issue per branch/PR. Each future code change must meet the repository’s local typecheck, lint, full test, build and applicable browser/scenario gates, preserve private information and update the glossary alongside compiler behavior.

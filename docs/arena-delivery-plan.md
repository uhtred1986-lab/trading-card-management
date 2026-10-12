# Arena delivery plan — 11 October 2026

Authoritative next-work queue, reconciled with all 13 originally open repository issues and their comments.
The current queue uses eight existing GitHub milestones; historical completed stages stay separate.
Master tracking issue: [#581](https://github.com/uhtred1986-lab/trading-card-management/issues/581). The grounded review/spec is [arena-playability-review.md](arena-playability-review.md).

## Priority and execution policy

**P0:** match integrity/common rule correctness before claiming verified competitive play. **P1:** next core delivery.
**P2:** measured or lower-frequency follow-up. **P3:** retirement/native parity after prerequisites.
Priority appears in new issue titles, every issue body and local front matter. Existing labels are retained;
blocked replaces ready-for-agent until merge dependencies pass. Epics are tracking, not worker tasks.

These are delivery increments within existing milestone objects, not eight duplicate milestones.
No dates are promised. Finish prerequisite acceptance before opening a dependent implementation PR.

## Active milestones

| Existing milestone | Current delivery | Priority | Tracker | Implementation issues |
|---|---|---|---|---|
| Arena M17 — Arena home: Play and Rules Workbench | Match integrity and recovery | P0 | [#576](https://github.com/uhtred1986-lab/trading-card-management/issues/576) | [#543](https://github.com/uhtred1986-lab/trading-card-management/issues/543), [#544](https://github.com/uhtred1986-lab/trading-card-management/issues/544), [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545), [#546](https://github.com/uhtred1986-lab/trading-card-management/issues/546), [#547](https://github.com/uhtred1986-lab/trading-card-management/issues/547) |
| Arena M5 — Engine capability gaps and advanced mechanics | Rule engine correctness | P0/P1 | [#577](https://github.com/uhtred1986-lab/trading-card-management/issues/577) | [#548](https://github.com/uhtred1986-lab/trading-card-management/issues/548), [#549](https://github.com/uhtred1986-lab/trading-card-management/issues/549), [#550](https://github.com/uhtred1986-lab/trading-card-management/issues/550), [#551](https://github.com/uhtred1986-lab/trading-card-management/issues/551), [#552](https://github.com/uhtred1986-lab/trading-card-management/issues/552), [#553](https://github.com/uhtred1986-lab/trading-card-management/issues/553), [#554](https://github.com/uhtred1986-lab/trading-card-management/issues/554), [#555](https://github.com/uhtred1986-lab/trading-card-management/issues/555), [#595](https://github.com/uhtred1986-lab/trading-card-management/issues/595), [#597](https://github.com/uhtred1986-lab/trading-card-management/issues/597), [#602](https://github.com/uhtred1986-lab/trading-card-management/issues/602), [#556](https://github.com/uhtred1986-lab/trading-card-management/issues/556), [#557](https://github.com/uhtred1986-lab/trading-card-management/issues/557), [#540](https://github.com/uhtred1986-lab/trading-card-management/issues/540), [#541](https://github.com/uhtred1986-lab/trading-card-management/issues/541), [#542](https://github.com/uhtred1986-lab/trading-card-management/issues/542) |
| Arena M16 — Board redesign: play feel and card review | Playable board and fullscreen cards | P1 | [#578](https://github.com/uhtred1986-lab/trading-card-management/issues/578) | [#558](https://github.com/uhtred1986-lab/trading-card-management/issues/558), [#559](https://github.com/uhtred1986-lab/trading-card-management/issues/559), [#560](https://github.com/uhtred1986-lab/trading-card-management/issues/560), [#561](https://github.com/uhtred1986-lab/trading-card-management/issues/561), [#562](https://github.com/uhtred1986-lab/trading-card-management/issues/562), [#563](https://github.com/uhtred1986-lab/trading-card-management/issues/563), [#564](https://github.com/uhtred1986-lab/trading-card-management/issues/564) |
| Arena M2 — Gameplay UX/HUD completion | Measured speed and gameplan | P1/P2 | [#579](https://github.com/uhtred1986-lab/trading-card-management/issues/579) | [#565](https://github.com/uhtred1986-lab/trading-card-management/issues/565), [#566](https://github.com/uhtred1986-lab/trading-card-management/issues/566), [#567](https://github.com/uhtred1986-lab/trading-card-management/issues/567), [#568](https://github.com/uhtred1986-lab/trading-card-management/issues/568), [#569](https://github.com/uhtred1986-lab/trading-card-management/issues/569), [#570](https://github.com/uhtred1986-lab/trading-card-management/issues/570) |
| Arena M1 — Rules correctness and parser coverage | Outstanding card readings | P1 | [#539](https://github.com/uhtred1986-lab/trading-card-management/issues/539) | [#571](https://github.com/uhtred1986-lab/trading-card-management/issues/571), [#572](https://github.com/uhtred1986-lab/trading-card-management/issues/572), [#573](https://github.com/uhtred1986-lab/trading-card-management/issues/573), [#574](https://github.com/uhtred1986-lab/trading-card-management/issues/574) |
| Arena M13 — Retire the legacy engine (Stage 10) | Independent coverage and retirement | P2/P3 | [#168](https://github.com/uhtred1986-lab/trading-card-management/issues/168) | [#575](https://github.com/uhtred1986-lab/trading-card-management/issues/575), [#601](https://github.com/uhtred1986-lab/trading-card-management/issues/601), [#459](https://github.com/uhtred1986-lab/trading-card-management/issues/459), [#118](https://github.com/uhtred1986-lab/trading-card-management/issues/118) |
| Arena M4 — Android client enablement | Android after web contract | P2/P3 | [#580](https://github.com/uhtred1986-lab/trading-card-management/issues/580) | [#105](https://github.com/uhtred1986-lab/trading-card-management/issues/105), [#106](https://github.com/uhtred1986-lab/trading-card-management/issues/106) |
| AI providers — one contract, API or subscription, any vendor | AI efficiency and live verification | P2 | [#511](https://github.com/uhtred1986-lab/trading-card-management/issues/511) | [#381](https://github.com/uhtred1986-lab/trading-card-management/issues/381), [#518](https://github.com/uhtred1986-lab/trading-card-management/issues/518) |

## Complete issue list

Dependencies are merge gates. Ready rows still require a hot-file ownership check.
Issue bodies contain scoped build instructions, named acceptance scenarios and verification commands.

### Match integrity and recovery — P0

**Exit:** Missing/unsupported skills cannot look verified; interrupted games never look drawn; clients converge after stale or disconnected requests.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#543](https://github.com/uhtred1986-lab/trading-card-management/issues/543) T01 | P0 | Verify deck readiness per printed skill and runtime capability | Merged [#585](https://github.com/uhtred1986-lab/trading-card-management/pull/585) | [pv-t01.md](arena-backlog/pv-t01.md) |
| [#544](https://github.com/uhtred1986-lab/trading-card-management/issues/544) T02 | P0 | Stop unsupported resolution with a typed interrupted outcome | Ready; check hot files | [pv-t02.md](arena-backlog/pv-t02.md) |
| [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545) T03 | P0 | Use monotonic game revision and action identity across clients | Merged [#586](https://github.com/uhtred1986-lab/trading-card-management/pull/586) | [pv-t03.md](arena-backlog/pv-t03.md) |
| [#546](https://github.com/uhtred1986-lab/trading-card-management/issues/546) T04 | P1 | Make reconnection visible and cancel abandoned polling | [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545) | [pv-t04.md](arena-backlog/pv-t04.md) |
| [#547](https://github.com/uhtred1986-lab/trading-card-management/issues/547) T05 | P1 | Pin immutable match rules and export reproducible replay bundles | [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545) | [pv-t05.md](arena-backlog/pv-t05.md) |

### Rule engine correctness — P0/P1

**Exit:** Each named mechanic has rule-grounded state, cost, timing and refusal assertions; no supported case silently disappears.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#548](https://github.com/uhtred1986-lab/trading-card-management/issues/548) R01 | P0 | Apply zero-power Battle Card rule processing at checkpoints | Ready; check hot files | [pv-r01.md](arena-backlog/pv-r01.md) |
| [#549](https://github.com/uhtred1986-lab/trading-card-management/issues/549) R02 | P0 | Resolve Auto skill costs with pay and decline decisions | [#544](https://github.com/uhtred1986-lab/trading-card-management/issues/544) | [pv-r02.md](arena-backlog/pv-r02.md) |
| [#550](https://github.com/uhtred1986-lab/trading-card-management/issues/550) R03 | P1 | Carry chosen cost values and targets into skill effects | [#549](https://github.com/uhtred1986-lab/trading-card-management/issues/549) | [pv-r03.md](arena-backlog/pv-r03.md) |
| [#551](https://github.com/uhtred1986-lab/trading-card-management/issues/551) R04 | P1 | Offer eligible spent combo cards as Z-Energy | Ready; check hot files | [pv-r04.md](arena-backlog/pv-r04.md) |
| [#552](https://github.com/uhtred1986-lab/trading-card-management/issues/552) R05 | P1 | Implement Counter Counter response chains | [#550](https://github.com/uhtred1986-lab/trading-card-management/issues/550) | [pv-r05.md](arena-backlog/pv-r05.md) |
| [#553](https://github.com/uhtred1986-lab/trading-card-management/issues/553) R06 | P1 | Resolve static identity keyword and negation layers | Ready; check hot files | [pv-r06.md](arena-backlog/pv-r06.md) |
| [#554](https://github.com/uhtred1986-lab/trading-card-management/issues/554) R07 | P1 | Enforce Heroic once-per-turn use | Ready; check hot files | [pv-r07.md](arena-backlog/pv-r07.md) |
| [#555](https://github.com/uhtred1986-lab/trading-card-management/issues/555) R08 | P1 | Keep Aegis payment choices eligible after each selection | Ready; check hot files | [pv-r08.md](arena-backlog/pv-r08.md) |
| [#556](https://github.com/uhtred1986-lab/trading-card-management/issues/556) R09 | P1 | Emit face-up life trigger events | Ready; check hot files | [pv-r09.md](arena-backlog/pv-r09.md) |
| [#557](https://github.com/uhtred1986-lab/trading-card-management/issues/557) R10 | P2 | Report genuine damage statistics for rules-engine games | [#544](https://github.com/uhtred1986-lab/trading-card-management/issues/544) | [pv-r10.md](arena-backlog/pv-r10.md) |
| [#602](https://github.com/uhtred1986-lab/trading-card-management/issues/602) R13 | P1 | Preserve granted Heroic individual skill identity | [#554](https://github.com/uhtred1986-lab/trading-card-management/issues/554) | [pv-r13.md](arena-backlog/pv-r13.md) |
| [#595](https://github.com/uhtred1986-lab/trading-card-management/issues/595) R11 | P1 | Pay additional Aegis costs after colored-card payment | [#555](https://github.com/uhtred1986-lab/trading-card-management/issues/555) | [pv-r11.md](arena-backlog/pv-r11.md) |
| [#597](https://github.com/uhtred1986-lab/trading-card-management/issues/597) R12 | P1 | Use original colors for keyword payment eligibility | [#553](https://github.com/uhtred1986-lab/trading-card-management/issues/553), [#555](https://github.com/uhtred1986-lab/trading-card-management/issues/555) | [pv-r12.md](arena-backlog/pv-r12.md) |
| [#540](https://github.com/uhtred1986-lab/trading-card-management/issues/540) existing | P1 | Arena: BT29-040 "returned to hand → bottom of the deck instead" replacement | Ready; original acceptance retained | [ui-112-return-to-deck-replacement.md](arena-backlog/ui-112-return-to-deck-replacement.md) |
| [#541](https://github.com/uhtred1986-lab/trading-card-management/issues/541) existing | P1 | Arena: BT31-001 — pay a red Veku/Gogeta [Union] cost from the Battle Area or the Drop | Needs owner scope ruling: Fusion first vs full Union/Potara | [ui-113-union-cost-from-board.md](arena-backlog/ui-113-union-cost-from-board.md) |
| [#542](https://github.com/uhtred1986-lab/trading-card-management/issues/542) existing | P1 | Arena: BT30-084 — a filter for "a card whose name is in the text of a skill on the chosen card" | [#550](https://github.com/uhtred1986-lab/trading-card-management/issues/550) | [ui-114-name-in-skill-text-filter.md](arena-backlog/ui-114-name-in-skill-text-filter.md) |

### Playable board and fullscreen cards — P1

**Exit:** Actor, window, stakes and resources are visible; tap/swipe fullscreen review and timely abilities work with real artwork on phone and desktop.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#558](https://github.com/uhtred1986-lab/trading-card-management/issues/558) U01 | P1 | Expose authoritative ability availability and decision data | [#544](https://github.com/uhtred1986-lab/trading-card-management/issues/544), [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545) | [pv-u01.md](arena-backlog/pv-u01.md) |
| [#559](https://github.com/uhtred1986-lab/trading-card-management/issues/559) U02 | P1 | Make card sheets and action controls accessible | Ready; check hot files | [pv-u02.md](arena-backlog/pv-u02.md) |
| [#560](https://github.com/uhtred1986-lab/trading-card-management/issues/560) U03 | P1 | Extend the existing phone pager to tap-open fullscreen review | [#559](https://github.com/uhtred1986-lab/trading-card-management/issues/559) | [pv-u03.md](arena-backlog/pv-u03.md) |
| [#561](https://github.com/uhtred1986-lab/trading-card-management/issues/561) U04 | P1 | Show Abilities now and collapse wrong-timing abilities | [#558](https://github.com/uhtred1986-lab/trading-card-management/issues/558), [#560](https://github.com/uhtred1986-lab/trading-card-management/issues/560) | [pv-u04.md](arena-backlog/pv-u04.md) |
| [#562](https://github.com/uhtred1986-lab/trading-card-management/issues/562) U05 | P1 | Make battle stakes resources and pass consequences explicit | [#558](https://github.com/uhtred1986-lab/trading-card-management/issues/558) | [pv-u05.md](arena-backlog/pv-u05.md) |
| [#563](https://github.com/uhtred1986-lab/trading-card-management/issues/563) U06 | P1 | Fit the phone board and crowded hand around the current decision | [#560](https://github.com/uhtred1986-lab/trading-card-management/issues/560), [#561](https://github.com/uhtred1986-lab/trading-card-management/issues/561), [#562](https://github.com/uhtred1986-lab/trading-card-management/issues/562) | [pv-u06.md](arena-backlog/pv-u06.md) |
| [#564](https://github.com/uhtred1986-lab/trading-card-management/issues/564) U07 | P1 | Consolidate desktop board status and contextual decision panel | [#561](https://github.com/uhtred1986-lab/trading-card-management/issues/561), [#562](https://github.com/uhtred1986-lab/trading-card-management/issues/562), [#563](https://github.com/uhtred1986-lab/trading-card-management/issues/563) | [pv-u07.md](arena-backlog/pv-u07.md) |

### Measured speed and gameplan — P1/P2

**Exit:** Measured acknowledgement, polling and rendering improve without changing legal outcomes or leaking hidden information.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#565](https://github.com/uhtred1986-lab/trading-card-management/issues/565) S01 | P1 | Measure arena acknowledgement polling AI and rendering costs | Ready; check hot files | [pv-s01.md](arena-backlog/pv-s01.md) |
| [#566](https://github.com/uhtred1986-lab/trading-card-management/issues/566) S02 | P1 | Acknowledge human actions before resumable AI advance | [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545), [#565](https://github.com/uhtred1986-lab/trading-card-management/issues/565) | [pv-s02.md](arena-backlog/pv-s02.md) |
| [#567](https://github.com/uhtred1986-lab/trading-card-management/issues/567) S03 | P1 | Record concurrent AI usage atomically | Ready; check hot files | [pv-s03.md](arena-backlog/pv-s03.md) |
| [#568](https://github.com/uhtred1986-lab/trading-card-management/issues/568) S04 | P2 | Skip unchanged snapshot loads with revision-aware polling | [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545), [#565](https://github.com/uhtred1986-lab/trading-card-management/issues/565) | [pv-s04.md](arena-backlog/pv-s04.md) |
| [#569](https://github.com/uhtred1986-lab/trading-card-management/issues/569) S05 | P2 | Share immutable derived evaluation by match revision | [#547](https://github.com/uhtred1986-lab/trading-card-management/issues/547), [#565](https://github.com/uhtred1986-lab/trading-card-management/issues/565), [#568](https://github.com/uhtred1986-lab/trading-card-management/issues/568) | [pv-s05.md](arena-backlog/pv-s05.md) |
| [#607](https://github.com/uhtred1986-lab/trading-card-management/issues/607) S07 | P1 | Profile and reduce corrected zero-power checkpoint evaluation | #548/#553 context; coordinate #551 flow ownership | [pv-s07.md](arena-backlog/pv-s07.md) |
| [#570](https://github.com/uhtred1986-lab/trading-card-management/issues/570) S06 | P2 | Preview a gameplan without committing moves | [#558](https://github.com/uhtred1986-lab/trading-card-management/issues/558), [#564](https://github.com/uhtred1986-lab/trading-card-management/issues/564), [#547](https://github.com/uhtred1986-lab/trading-card-management/issues/547) | [pv-s06.md](arena-backlog/pv-s06.md) |

### Outstanding card readings — P1

**Exit:** Every #539 bullet and existing card-specific capability ticket has a bounded owner and deterministic reading proof.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#571](https://github.com/uhtred1986-lab/trading-card-management/issues/571) C01 | P1 | Fix missing and over-broad card Auto trigger readings | Ready; check hot files | [pv-c01.md](arena-backlog/pv-c01.md) |
| [#572](https://github.com/uhtred1986-lab/trading-card-management/issues/572) C02 | P1 | Bind end-of-battle Auto to this card comboed from hand | [#571](https://github.com/uhtred1986-lab/trading-card-management/issues/571) | [pv-c02.md](arena-backlog/pv-c02.md) |
| [#573](https://github.com/uhtred1986-lab/trading-card-management/issues/573) C03 | P1 | Fix grouped counts shared conditions and mixed target readings | [#572](https://github.com/uhtred1986-lab/trading-card-management/issues/572) | [pv-c03.md](arena-backlog/pv-c03.md) |
| [#574](https://github.com/uhtred1986-lab/trading-card-management/issues/574) C04 | P1 | Fix phase durations and Desire hand activation readings | [#573](https://github.com/uhtred1986-lab/trading-card-management/issues/573) | [pv-c04.md](arena-backlog/pv-c04.md) |
| [#539](https://github.com/uhtred1986-lab/trading-card-management/issues/539) existing | P1 | Arena: card review 4 Oct 2026 — single-card misreadings and missing triggers | Tracking only | [s2-101-card-review-misreadings.md](arena-backlog/s2-101-card-review-misreadings.md) |

### Independent coverage and retirement — P2/P3

**Exit:** #459 provides fixed rule expectations; saved-game migration and support evidence pass before #118 removes legacy.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#575](https://github.com/uhtred1986-lab/trading-card-management/issues/575) V01 | P1 | Generate a capability and named test-gap inventory | Ready; check hot files | [pv-v01.md](arena-backlog/pv-v01.md) |
| [#601](https://github.com/uhtred1986-lab/trading-card-management/issues/601) V02 | P2 | Replace AI presentation/request oracle with fixed expectations (child of #459) | Independent; registry single-writer | [Issue body](https://github.com/uhtred1986-lab/trading-card-management/issues/601); canonical file in child PR |
| [#459](https://github.com/uhtred1986-lab/trading-card-management/issues/459) existing | P2 | Arena tests: off the legacy oracle — fixed expectations for the seven legacy-fixture suites, contract fixtures and verify/vm.ts | Ready; original acceptance retained | [pv-existing-459.md](arena-backlog/pv-existing-459.md) |
| [#118](https://github.com/uhtred1986-lab/trading-card-management/issues/118) existing | P3 | Arena: delete engine/'s rule content, move the generic parts into vm/, drop the adapter and --engine | [#459](https://github.com/uhtred1986-lab/trading-card-management/issues/459), [#575](https://github.com/uhtred1986-lab/trading-card-management/issues/575), [#547](https://github.com/uhtred1986-lab/trading-card-management/issues/547), [#544](https://github.com/uhtred1986-lab/trading-card-management/issues/544), [#548](https://github.com/uhtred1986-lab/trading-card-management/issues/548), [#549](https://github.com/uhtred1986-lab/trading-card-management/issues/549) | [s10-01-retire-engine.md](arena-backlog/s10-01-retire-engine.md) |
| [#168](https://github.com/uhtred1986-lab/trading-card-management/issues/168) existing | P3 | Arena Stage 10 tracking — retire the legacy engine | Tracking only | [s10-00-tracking.md](arena-backlog/s10-00-tracking.md) |

### Android after web contract — P2/P3

**Exit:** #105 and #106 consume the settled auth/snapshot/ability contract with polling and playback parity.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#105](https://github.com/uhtred1986-lab/trading-card-management/issues/105) existing | P2 | Arena: implement Android Stage 1 app shell and snapshot polling | [#545](https://github.com/uhtred1986-lab/trading-card-management/issues/545), [#546](https://github.com/uhtred1986-lab/trading-card-management/issues/546), [#558](https://github.com/uhtred1986-lab/trading-card-management/issues/558) | [ui-105-android-shell.md](arena-backlog/ui-105-android-shell.md) |
| [#106](https://github.com/uhtred1986-lab/trading-card-management/issues/106) existing | P3 | Arena: implement Android battle playback and animation parity | [#105](https://github.com/uhtred1986-lab/trading-card-management/issues/105) | [ui-106-android-playback.md](arena-backlog/ui-106-android-playback.md) |

### AI efficiency and live verification — P2

**Exit:** #381 implements the recorded cost ruling; #518 completes owner-run verification of already-built route; #511 records the result.

| Issue / plan key | Priority | Work | Prerequisites / state | Canonical file |
|---|---|---|---|---|
| [#381](https://github.com/uhtred1986-lab/trading-card-management/issues/381) existing | P2 | AI spend: cheaper models where Opus with thinking is overkill (scan, cart explain, summaries, arena counter/blocker) | Ready; original acceptance retained | [pv-existing-381.md](arena-backlog/pv-existing-381.md) |
| [#518](https://github.com/uhtred1986-lab/trading-card-management/issues/518) existing | P2 | AI providers 7: the subscription on Vercel and arena latency — inert spike, numbers, owner rules | Owner live verification | [pv-existing-518.md](arena-backlog/pv-existing-518.md) |
| [#511](https://github.com/uhtred1986-lab/trading-card-management/issues/511) existing | P2 | AI providers: one contract, API or subscription, any vendor (tracking) | Tracking only | [pv-existing-511.md](arena-backlog/pv-existing-511.md) |

## Consolidation decisions

| Existing work | Decision | Reason |
|---|---|---|
| #539 card-review batch | Split into #571–#574; retain #539 as parent | Four bounded reading families; every original bullet mapped once |
| #348 / #352 completed phone pager / board programme | Extend in #560 and tracker #578 | Fullscreen/tap discovery is new scope; pager already exists |
| #366 completed Arena home programme | Follow-up #543 and tracker #576 | Per-skill completeness/runtime support extends status-based readiness |
| #540 / #541 / #542 | Keep three distinct issues | Different semantics and regression cards; #542 uses shared #550 binding |
| #459 / #118 / #168 | Keep coverage, deletion and tracker separate | Rule expectations must precede oracle removal |
| #105 / #106 | Keep shell/playback separate; fix readiness labels | Native contract depends on #545/#546/#558 and current session auth |
| #381 / #518 / #511 | Keep model economics, live verification and tracker separate | Rulings already recorded; #531 route already built; no duplicate route task |
| #170 / #135 / #137 | Repair checklist and close stale #170 | Declaration tests passed; native mill exception documented; runtime evidence stays #575 |

No further duplicate issue closures were justified. Broad historical completions do not prove all rule runtime behavior.
“Merge” here means consolidating backlog scope; this task did not merge code PRs.

## Order and hot files

Use at most three active worktrees/branches, with one issue per draft PR. Workers do not spawn nested agents.
One writer at a time on any shared file, especially VM flow/costs/effects, snapshot/games/actions,
page/stage/hand/sheets, glossary, shared verification fixtures and schema/migrations. Re-check actual files
and symbols after each predecessor merges; front matter is a starting touch set, not an exemption.

A safe initial assignment is #543 readiness, #545 revision, and #559 accessible sheets, after checking
shared types/fixtures. #544 interruption then #548/#549 serialize VM flow; independent #575 support
inventory must coordinate glossary/verification edits. No three-worker wave is mandatory.

| Work lane | Merge order / constraints |
|---|---|
| Integrity / API | #543 and #545; #544 shares contract/page edits; then #546/#547; #558 after #544/#545 |
| VM / compiler | #544 → #548 → #549 → #550; #551/#552; #553/#554/#555/#556 serialize shared hooks/costs/fixtures; #540/#541/#542 coordinated; #571 → #572 → #573 → #574 |
| Web UI | #559 → #560; #558 → #561/#562; #561/#562/#560 → #563 → #564. #561 and #562 only concurrent if shared page/display edits are disjoint |
| Performance | #565 baseline; #567 atomic accounting independently with schema ownership; #545/#565 → #566/#568; #547/#565/#568 → #569; #547/#558/#564 → #570 |
| Coverage / retirement | #575 inventory and #459 fixed expectations can begin early; #118 waits for their evidence, #547 and P0 rule/outcome gates; #168 tracks exit |
| Android | #545/#546/#558 → #105 → #106 |
| AI provider/model | #381 approved model changes; #518 owner-run live verification; #511 records closure. No gate on unrelated local implementation |

Ready-for-agent is a prerequisite signal, not permission to ignore these writer conflicts. Model labels are
repo recommendations/ceilings; choose the cheapest capable worker under docs/agent-brief.md.
Review each PR against acceptance and required local validation, then follow production-deploy ordering.
The owner removed duplicate GitHub test/BugBot/acceptance workflows on 11 Oct 2026 (#583).
The orchestrator owns test evidence, exact-commit review, contract/backlog checks and merge decisions.

## Historical milestone register

These have no remaining open implementation issue in the reconciled queue. “No open work” means backlog
state, not a claim of complete runtime support; follow-ups above own discovered gaps.

| Arena milestone | Current backlog status |
|---|---|
| M3 — Battle staging and inspector | Original work closed; new stakes/review follow-ups live in M16 |
| M6 — Definitions in the language (Stage 3) | #170 now closed after exit verification |
| M7 — Rules engine core (Stage 4) | Original implementation closed; new interruption/checkpoint work in M17/M5 |
| M8 — Rules engine actions and costs (Stage 5) | Original implementation closed; Auto/binding follow-ups in M5 |
| M9 — Rules engine battle (Stage 6) | Original implementation closed; Z-Energy/counter/statistics follow-ups in M5 |
| M10 — Keywords as macros (Stage 7) | Original hook/macro programme closed; runtime gaps explicitly in M5/#575 |
| M11 — Everything else from config (Stage 8) | Original work closed; current contract follow-ups above |
| M12 — Parity and the flip (Stage 9) | Default already rules; historical owner evidence does not waive current retirement gates |
| M14 — Rules language and ruleset documentation | Existing work closed; changed semantics update glossary/docs in the implementation PR |
| M15 — Backlog tooling and CI | Existing tooling closed; no invented tooling follow-up needed |

## Evidence and limits

Backlog review used all open issues plus relevant closed pager/hook/battle and declaration issues and their
comments. Local declaration verification: verify-rules passed; verify-arena passed 28/28 (legacy harness),
including language, rulesets, words and primer. The earlier rules-only review was 26/28 with two comparisons
not run and 18 named skips; these are not full rules coverage. #575 audits that inventory.

No implementation issue has been marked fixed by this planning work. No production database, paid AI call,
deployment setting, or code PR merge was performed. Existing grounded prototype changes are preserved.
Live-only verification is explicitly assigned to the owner; agents use local fixtures/PGlite.

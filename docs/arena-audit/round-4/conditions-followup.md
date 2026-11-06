# Round 4 bounded condition follow-up — 4 November 2026

This batch repairs the seven still-misread condition skills listed in `notes-S.md`.

The implementation and review fixes were brought into PR #1249 on 4 Nov 2026 at `29326703`. The validation below records the original condition-lane head; combined-head validation is tracked in [complete card support](../support-completion.md). BT2-048’s keyword choice has since been repaired in the same PR.
It does not complete the four-lane round, and it changes no persisted production rules.

| Card / skill | Corrected requirement |
|---|---|
| P-468 #20 | One yellow Leader with both Vegeta and Trunks: Future character names; discard-self activation price retained. |
| BT19-063 #20 | Three ordinary energy and Son Gohan: SH in either player's Leader or Battle Area. |
| BT19-064 #20 | Three ordinary energy and Piccolo: SH in either player's Leader or Battle Area. |
| BT19-112 #30 | Four ordinary energy; cost-three and cost-five Lord Slug cards in Z-Energy, each with combo cost one. |
| BT19-113 #30 | Three ordinary energy; cost-three Lord Slug with combo cost one in Z-Energy. |
| BT19-080 #20 | Additional draw requires both Son Goku: Br and Vegeta: Br in Z-Energy; neither is chosen. Drawing does not require a successful KO. |
| BT19-145 #30 | Five Z-Energy or two Z-Battle Cards; each alternative keeps its own bound. |

BT26-023/024's Leader-back-side, energy and two Combo Area requirements were already
fixed in round 3; they remain controls, not claimed new repairs. BT2-048's mandatory
keyword-negation choice was separate work when this receipt was written; it is now repaired in PR #1249. The remaining unread families continue under the complete-support workstream.

## Sources and measurement

The frozen input is the public Deckplanet feed shaped with the repository's errata,
not a production database or stored-rule snapshot. It has 6,597 cards and 13,964 skills.
The baseline reproduces the handoff's 12,953 read / 1,011 unread skills. The final
corpus diff changes exactly the seven skills above, with no read/unread transitions.
Every changed reading was reviewed, including partially unread skills. The final
source includes reviewer-requested conjunction-precedence guards and reproduces the
initial diff exactly. See [the reviewed readings](conditions-readings.md).

- Catalog SHA256: `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`.
- Final readings SHA256: `aeae9cc6ee384394341f05eff1f10f3856a0e63098e9ce0248458ade58aea945`.
- Baseline SHA256: `c0733390cd26937aa63fd9019b76d99a791016b26ee7a80a6cbcec13ecb4e511`.
- RM 9-1-3: printed conditions gate the skill; RM 20-1-3: energy means cards in an
  Energy Area; RM 20-1-6: named characters without another area mean Leader/Battle;
  RM 2-10-4: one card may have multiple character names.
- Official BT19-080 Q&A explicitly permits drawing with the specified Z-Energy cards
  even when no opposing Battle Card can be KO'd.
- P-468's Q&A addresses Unison targeting; that behavior is unchanged. The other five
  cards have no own Q&A entries in the checked source. None of the seven has an entry
  in the checked official errata snapshot.
- R-380 through R-383 record these readings; none is a pending design-intent guess.

## Verification

`audit-conditions-4` checks stored JSON and language round trips, P-468 activation from
hand, both/one-name and colour boundaries, either-player area boundaries, both Slug
cost slots, missing energy and wrong combo costs, independent alternative bounds,
and actual BT19-080 program execution with both, neither, or only one Z-Energy card
and no KO candidate. Conjunction-precedence controls cover a whole-condition outer
OR and a trailing shared Leader condition.

Worker checks passed: typecheck, changed-file eslint, the new suite, rulings (173,
none pending), condition audit suites 1–3, phrasing batches 1/3,
`price-condition-clauses`, `census-round6-907`, and `names-both-768`.

Final `npm run checks -- quick` passed both typecheck and changed-file lint. The
full gate completed 95 passing steps; its Teach-it failure is repaired below. Its
earlier arena process was intentionally stopped after review changes, superseded
by the direct arena run on the final source. No build-sensitive paths changed,
so the checks runner skipped the build.

Fixture fuzz (`scripts/arena-fuzz.mts 40 --game fusion`) completed all 40 games:
zero crashes, interruptions, or action limits. This is fixture coverage, not a
production Masters deck qualification. The new suite uses its own card definitions
and does not recompile or mutate cards registered by earlier suites.

Final direct run (`npx tsx scripts/verify-arena.ts --emit`): **243/243 suites passed,
zero failures**, including `audit-conditions-4` in the combined process. Emission
produced no contract fixture changes. Together with the 95 completed full-gate
steps and the repaired Teach-it suite, every planned check is accounted for.
The final typecheck/lint rerun also passed after the review and fixture-isolation
changes.

## Existing gate failure repaired

The full gate's `scripts/verify/teach.ts:101` assertion fails because the existing
Teach-it system prompt contains 40,104 characters against a strict 40,000-character
limit. The same failure was reproduced on untouched `origin/main` at `1d3962e4`;
its generated reference contains 39,132 characters before the prompt wrapper.
A separate repair reserves space for the introduction, separator and strict-bound
margin when selecting the reference detail level. The existing test passes with all
statement, condition and trigger rows retained; its size assertion is unchanged.
The draft PR remains unmerged for the documented batch integration workflow.

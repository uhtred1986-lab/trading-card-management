# Round 4 bounded condition follow-up — 4 November 2026

This batch repairs the seven still-misread condition skills listed in `notes-S.md`.
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
keyword-negation choice and the remaining round-4 unread families remain future work.

## Sources and measurement

The frozen input is the public Deckplanet feed shaped with the repository's errata,
not a production database or stored-rule snapshot. It has 6,597 cards and 13,964 skills.
The baseline reproduces the handoff's 12,953 read / 1,011 unread skills. The initial
corpus diff changes exactly the seven skills above, with no read/unread transitions.
Final source includes reviewer-requested conjunction-precedence guards; the coordinator
will record its final diff and gate below.

- Catalog SHA256: `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`.
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

Worker checks: typecheck, changed-file eslint, the new suite, rulings, prior condition
audit suites, and older suites naming the affected cards/wordings. Coordinator corpus
review and final gate evidence are added after review.

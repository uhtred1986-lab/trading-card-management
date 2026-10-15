# Optional exact payments: #538 follow-up

The existing #538 fix checked the payoff's `chose atLeast N` after a partial
payment had already moved. Fresh readings for BT3-109 #20, BT6-062 #10 and
SD8-03 #10 therefore remained held during the reviewed rule refresh.

The basis is the [owner's 4 Oct ruling](../../s2-100-exact-count-if-you-do.md):
“exactly 5 … with fewer the cost cannot be paid”, together with each card's
printed “you may choose N … If you do”. [Rule Manual](../../../rules/rulemanual.txt)
20-16-1 makes the preceding action a necessary condition for the following
action; 0-2-10-1 and 5-2-4 distinguish printed “up to”; 5-2-5 remains the rule
for mandatory effects with insufficient targets. No additional official Q&A
was used; the owner ruling resolves the optional payment's all-or-decline
behavior. The runtime fixture reproduces the catalog's complete printed Autos.

Plain optional choices of multiple cards now use `may` around an exact choice.
Fewer available cards suppress the offer and move nothing. Declining binds no
cards; accepting requires every pick and moves all selected cards together.
The payoff follows only after full payment. Saved partial selections retain
that obligation; an injected empty saved answer cannot bypass the required
pick. Existing selected pools are checked against the live frame variables.
Later instructions that create candidates are not prechecked against the
earlier board.

The local dated catalog comparison covered 6,552 cards and 13,615 skill records
(the snapshot already used for the previous refresh review). The
[reading diff](optional-exact-readings.json) has 22 changed records and 13,593
unchanged records. Every changed printed skill contains “you may choose 2” or
“you may choose 5”. Each reading was checked against its printed text.

The full operation comparison proved the changes are limited to converting the
plain optional multi-card choice to an exact choice inside `may`, and the
corresponding offer condition when “if you do” immediately follows that choice.
BT6-043 is a replacement whose surrounding offer already requires full payment;
its selector becomes explicitly exact without another nested offer. All other
record fields except the derived reading/pattern remain identical, including
prices, triggers, conditions and unread clauses. The unread-clause total remains
3,363; no unread clause shape appears or disappears. BT5-045's missing movement,
BT9-068's attack restriction, P-156's “did both” and BT15-140's restriction remain
unread, as the diff records; the new offer does not claim those skills are complete.

Focused checks:

- `scripts/verify/optional-exact-538.ts`: all three complete printed Auto programs
  run on the real rules engine, with zero/fewer-than-N candidates, declining,
  accepting, excess candidates, no early or partial payment, the correct payoff,
  JSON reload at every pick, forged empty saved answers, and private hand choices
  in both viewer projections. Exactly N cards are paid only after acceptance.
  Mandatory partial effects, printed up-to choices, captured pools and later
  candidate-producing instructions retain their behavior.
- Existing `readings`, `compiler`, `bounded-life-820`, `auto-costs-549` and
  `substitute-unpaid-720` suites pass.

This changes compiler/runtime behavior only. No production card rule record was
updated. The three held rows need a separate reviewed, authorized refresh before
an online/offline deck loaded from those stored records receives the new program.

# Review of the 27 draft-refresh candidates

## Evidence and limits

The exact set is recovered from the historical audit transcript the saved `historical-audit.txt` excerpts from the local chat “Handover - DBS” (items 288, 291, 293, and 295), dated 14 October 2026. Item 288 compared all 50 compiler-owned draft flags against a fresh compiler pass and found 29 semantic differences. Item 295 excluded BT5-119 #10 and BT6-063 #10 as separate investigation cases, leaving the 27 listed below. The historical pass reported all 50 stored printed texts equal to the frozen catalog texts. This establishes the historic snapshot only; it does not establish current DB status, ownership, or whether a row has since been refreshed.

No database was read or written in this review. The allowed app database endpoint could not be retrieved because the Vercel API request was blocked with HTTP 403. The inherited `DATABASE_URL` belongs to another app and was not inspected or used. Before any future write, re-fetch the 27 rows from the documented trading-card-management DB and verify each is still a compiler-owned draft with the same printed text and old reading.

## Disposition

**24 semantic approvals; 3 held for compiler correction.** The 24 approvals mean the historical fresh reading matches the printed card behavior on review. They are not DB write authorization: current live-row revalidation remains required. The 3 held readings have a documented partial-choice approximation: the fresh program adds an `atLeast N` gate for the conditional follow-up, but leaves the choice as `upTo N` and moves chosen cards before that gate. The saved `draft-refresh-optional-check.mts` checks current compiled program shape; it is not an end-to-end runtime scenario. The glossary explicitly documents this limitation at `src/lib/arena/glossary.ts:943-944`.

| Candidate | Historical old → fresh behavior | Review |
|---|---|---|
| SD13-01 #10 | No explicit guard-attack condition → condition fires when an opponent Leader Card is the guard. | Approved. Restores the printed attack target. |
| SD5-01 #0 | No explicit guard-attack condition → opponent Leader Card guard condition. | Approved. Restores the printed attack target. |
| BT3-109 #20 | Old: chose up to 5 Warp cards and moved them; follow-up ran if any were chosen. Fresh: adds `chose atLeast 5` to the follow-up, while retaining the up-to choice and preceding move. | **Held.** Compiled control-flow inference: selecting fewer than 5 still reaches the preceding move, while the follow-up is gated on 5. This is the approximation explicitly documented in [`src/lib/arena/glossary.ts:943`](../../../../src/lib/arena/glossary.ts). Printed “may choose 5 … If you do so” is optional exact-5-or-decline. See [#538](https://github.com/uhtred1986-lab/trading-card-management/issues/538) and `docs/arena-backlog/s2-100-exact-count-if-you-do.md`. |
| BT29-029 #10 | Over-restrictive Extra + blue + Armored Squadron filter → alternatives: blue Cooler’s Armored Squadron card, or blue Extra; the first alternative keeps the not-in-a-battle restriction. | Approved. The selector-level `notInBattle` also reaches the Extra alternative, but an Extra cannot be the attacker or guard in a battle; no valid Extra target is excluded by that field. |
| BT29-032 #10 | Only one exact-cost alternative → blue Cooler’s Armored Squadron at exact energy cost 1 or exact cost 5. | Approved. The OR alternatives preserve the two exact costs. |
| BT6-009 #0 | Red applied to both named alternatives → red applies to Son Goku: Br, while Veku: Br is a separate uncolored alternative. | Approved. |
| BT30-084 #0 | Tried to play the chosen card onto itself → choose a Battle Card in Warp whose name appears in the chosen host’s skill text, then play it on top of that host. | Approved. Named card-specific coverage exists in `scripts/verify/name-in-skill-text-542.ts`, including name filter, Warp selection, and play-on-top behavior. |
| SD13-04 #10 | One Leader selector → `chooseMode` for one of your Leader Cards or one of your Unison Cards. | Approved. The alternatives are separate and share the chosen-card reference. |
| BT6-004 #0 | Red applied to both names → red applies to Vegeta: Br only. | Approved. |
| BT6-005 #0 | Red applied to both names → red applies to Vegeta: Br only. | Approved. |
| BT6-008 #0 | Red applied to both names → red applies to Son Goku: Br only. | Approved. |
| BT4-095 #0 | Trait/cost selector → same selector also requires [Swap]. | Approved. |
| BT6-062 #10 | Old: up to 2 from hand; move selection; run follow-up if any were chosen. Fresh: adds `chose atLeast 2`, but retains the up-to choice and preceding move. | **Held.** Fresh adds an `atLeast 2` condition after the old unconditional move, so a partial selection is still moved and only the follow-up is skipped. This is compiled control-flow inference; the known approximation is documented in [`src/lib/arena/glossary.ts:943`](../../../../src/lib/arena/glossary.ts). Printed “may choose 2 … If you do” must be 2 or decline. |
| BT6-014 #40 | No explicit guard-attack condition → condition fires when an opponent Battle Card is the guard. | Approved. |
| EX03-19 #0 | No explicit guard-attack condition → condition fires when an opponent Leader Card is the guard. | Approved. |
| BT29-036 #10 | “Not in a battle” was only in explanatory text → selector has `notInBattle: true` for the opponent Battle Card. | Approved. This is a single alternative, so selector scope is correct. |
| BT6-015 #30 | No explicit guard-attack condition → condition fires when an opponent Battle Card is the guard. | Approved. |
| BT3-030 #20 | Chose only an opponent Leader → `chooseMode` for opponent Leader or Battle Card, then applies −5000 to that selection. | Approved. |
| BT29-035 #10 | Conjoined filter over-narrowed search → blue Cooler OR blue Cooler’s Armored Squadron OR blue Extra with cost 0. | Approved. The cost qualifier applies only to Extra. `scripts/verify/readings.ts` has a representative three-alternative assertion. |
| BT29-039 #10 | Same over-restrictive search as BT29-035 → same three alternatives and Extra-only cost 0. | Approved. |
| SD13-04 #0 | Over-restrictive filter → from the looked-at cards, green Unison with specified cost 2 OR green Frieza’s Army card with energy cost 4 or less. | Approved. The selector carries `fromVar`; in `src/lib/arena/vm/program.ts`, that path resolves the looked-at cards before board-area traversal, so the selector-level Unison area does not exclude Frieza’s Army cards from the looked-at pool. |
| DB1-019 #0 | Chose only a Leader → `chooseMode` for your Leader or Battle Card before granting +5000. | Approved. |
| BT31-119 #20 | Extra + white + Cell filter omitted valid white Cell cards and white Extras → white Cell OR white Extra, up to 2 total, then move to Drop; later Android-under-card step retained. | Approved. The OR alternatives preserve “total of up to 2.” |
| BT3-031 #0 | No explicit attack target → condition fires on opponent Leader Card attack. | Approved. |
| SD8-03 #10 | Old: up to 2 from hand; move selection; run follow-up if any were chosen. Fresh: adds `chose atLeast 2`, but retains the up-to choice and preceding move. | **Held.** Fresh adds an `atLeast 2` condition after the old unconditional move, so a partial selection is still moved and only the follow-up is skipped. This is compiled control-flow inference; the known approximation is documented in [`src/lib/arena/glossary.ts:943`](../../../../src/lib/arena/glossary.ts). Printed “may choose 2 … If you do” must be 2 or decline. |
| BT3-010 #20 | Red Leader-only selector → `chooseMode` for red Leader or red Battle Card, then grants power to that selection. | Approved. `scripts/verify/readings.ts` asserts the red qualifier is retained in both modes. |
| SD13-03 #0 | Green Leader-only selector → `chooseMode` for Leader or green Unison, then grants power. | Approved. `scripts/verify/readings.ts` asserts green applies only to the Unison alternative. |

The semantic concern is the difference between the printed full-count choice and the compiled partial-choice approximation. `scripts/verify/readings.ts` checks the later `atLeast` condition, while the saved compiler-shape check confirms that the choice remains `upTo: true` and the move precedes that condition. The glossary acknowledges this approximation directly (`src/lib/arena/glossary.ts:943-944`). The manual’s “if you do” action condition (§20-16-1, `docs/rules/rulemanual.txt`) makes the follow-up depend on completing its stated action; the saved check does not independently execute this card flow through the runtime.

## Excluded investigation rows

These two rows were not members of the 27 historical refresh candidates:

- **BT5-119 #10:** official Bandai erratum changes “energy cost less than or equal to your current energy” to “3 or less”; it must be reconciled before approving a reading. See [Bandai errata](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php), [`src/lib/catalog/errata.ts`](../../../../src/lib/catalog/errata.ts), and [issue #819](https://github.com/uhtred1986-lab/trading-card-management/issues/819). This branch applies the official cost-3 erratum; live catalog and stored-rule reconciliation remain pending.
- **BT6-063 #10:** historical fresh compilation leaves “choose 1 or 2” unread and has a partial downstream Leader target; do not replace it with the old exact-one draft. See [issue #820](https://github.com/uhtred1986-lab/trading-card-management/issues/820).

Both are implemented separately on this branch and remain outside the 27; their live acceptance checks are pending. All 27 candidate rows still require current DB revalidation before any changes.

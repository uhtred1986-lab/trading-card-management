# Paid Burst history and printed payment repairs — 4 Nov 2026

Intermediate checkpoint in PR #1249 at `85112214`. Complete card support remains in progress.

## Behavior and sources

- **R-389/R-391, Burst history:** successful Burst payments retain the paid cards' effective attributes and arrival epochs. Historical color conditions read this payment snapshot; later live Drop targets separately require the original occurrence. Failed, replaced or suppressed payments cannot grant the effect. Waived or keyword-negated Burst supplies known-empty history, so an invoked Extra does not interrupt or receive an unpaid bonus. Ordinary live-card conditions keep their existing semantics.
- **SD16 source correction:** the official FAQ is indexed as SD16-001, despite catalog ID SD16-01. Its own-card answer says milling SD16-03 (printed red, also black by Permanent) grants both Critical and +5000. R-391 supersedes R-389's initial non-black interpretation: this bounded paid-card clause detects another actual color, including gained colors. Ordinary non-black selectors and prohibitions are unchanged. The FAQ also says SD16's second Auto negates Burst while leaving Activate usable. Native tests exercise that sequence, standing keyword negation and protection from negation. No catalog erratum was invented.
- **R-390, Evolve prices:** Bandai images confirm P-006 has two green plus one generic energy and BT2-084 two green plus four generic energy. Narrow normalization retains these generic amounts. Their programs and targets otherwise remain unchanged.
- **R-442, SD22 Awaken:** a dash following “or” no longer drops the alternative payment condition. The condition remains life at most four OR own energy at least two plus an own yellow Son Goku in the Battle Area with current energy cost at least two. The printed image confirms the alternative; draw, life-to-five and flip effects remain unchanged.
- **Source tooling:** `arena-intent-brief` now uses the existing normalized FAQ key for own-card and matching-wording lookups. The real CLI finds both SD16-001 and SD3-001 answers. This fixes evidence retrieval rather than altering card rules.

Official images inspected: [P-006](https://www.dbs-cardgame.com/images/cardlist/cardimg/P-006.png), [BT2-084](https://www.dbs-cardgame.com/images/cardlist/cardimg/BT2-084.png), [SD16-01](https://www.dbs-cardgame.com/images/cardlist/cardimg/SD16-01.png), [SD16-03](https://www.dbs-cardgame.com/images/cardlist/cardimg/SD16-03.png), and [SD22-01](https://www.dbs-cardgame.com/images/cardlist/cardimg/SD22-01.png). Rulings retain manual and own-card FAQ citations.

## Verification

At `85112214`, **526 focused scenarios pass together**: Burst 92, invocation 76, Awaken 146, Evolve 32, scopes 22, implicit Absorb/entry 48 and Surge 110. These cover both seats, native payments, gained colors, saved history, waived Burst, invalidated occurrences, printed totals/colors and independent negative controls for Awaken qualifiers. Worker compatibility additionally covers Auto costs, typed payments, keyword actions, Spirit Boost, static layers, language and Teach.

Typecheck, changed-file lint, Teach, rulings (195, zero pending), capability inventory (74 sites) and whitespace checks pass. Fixture fuzz completes **40/40**, with zero interruptions, action limits or crashes (`/tmp/arena-support5/combined/fuzz-fifth-final.json`). Fusion fixture fuzz checks shared-runtime regressions; it is not exhaustive Masters or Fusion support.

## Full-record evidence and remaining work

The frozen 6,597-card/13,964-skill Masters corpus changes exactly **10 full records** from the fourth checkpoint: seven Burst restorations, two Evolve price repairs and one SD22 Awaken price repair. The seven Burst records exactly match the reviewed corrected worker snapshot; the three payment records match the independently reviewed payment snapshot. The comparison includes all fields, not only narration. [Full changed-field evidence](support-fifth-program-diff.json).

Snapshot: `/tmp/arena-support5/combined/fifth-final-full.json`, SHA-256 `593e1aa1e64644c0a104e4fb677514678631db3efe0875f329ba407f581ad53d`. Totals: **12,979 readable / 985 unread**, no read-to-unread regression. Additional readable-record runtime gaps fall from 47 to **44**; the broader checker reports 360 records with additional reasons and 2,559 contextual unknowns. Static counts remain non-exhaustive.

SD3 explicit mill-payment history and shared skill-play Counter timing continue next, followed by the remaining payment/runtime families and unread clauses. The Battle invocation owner question remains pending. No production refresh, database change, deployment or merge occurred. The full integration gate remains deferred until the complete combined deliverable.

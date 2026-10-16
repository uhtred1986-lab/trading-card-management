# Universe 3 removal replacement: issue 920

## Official text and the stale catalog

Reviewed 15 October 2026. The public catalog snapshot stores the original
Drop-only Permanent for DB2-137 Anilaza, the Towering Atrocity; DB2-140 Secret
Technique Paparoni; DB2-151 Nigrisshi, from the Shadows; and DB2-153 Viara,
Everlasting Assault. All four have `has_errata: true` and `is_banned: true`.
The ban is retained; fixing a program does not establish deck legality.

[Bandai's official errata](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php)
lists all four original/corrected pairs. The current text is:

> [Permanent] When this card is removed from a Battle Area or Combo Area, it
> is placed at the bottom of its owner's deck instead.

The [official DB2 card list](https://www.dbs-cardgame.com/asia/cardlist/?search=true&category=428602) confirms each name, type, black colour, cost (5/2/3/4 without coloured orbs), power, Alien/Universe 3 traits, resurrection cost/effect and tournament-ban note. Its skill text still displays the original Permanent and flags the cards as errata; the dedicated errata page supplies the authoritative change. Keyword icons are omitted by text extraction, so the public catalog retains those standalone tags.

The [official announcement of 6 March 2020](https://www.dbs-cardgame.com/canada/strategy/announcement/banned-cards_mar-06-2020.php)
prints all four full pre/post-errata cards, including Anilaza’s Double Strike/Barrier and Viara’s Critical, and confirms the change was issued before release to prevent unintended interactions with existing/future skills. Those full texts match the public fixtures after the one Permanent correction. Canonical corrections in
`src/lib/catalog/errata.ts` replace only the obsolete text for these four
catalog IDs, before a future sync drafts the cards. Current wording is
idempotent. The old wording remains unread by the generic compiler, so an
old persisted record cannot quietly become the broader errata program.

[Bandai's card Q&A](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)
was checked for all four numbers. No dedicated entries for DB2-137, DB2-140
or DB2-151 were present. DB2-153 appears in SD14-03 Time Agent Vegeta's Q&A:
using Viara's activation to send that card to Warp does not allow the Vegeta
to be played. That answer does not narrow the four errata Permanents.

## Rules basis and boundaries

The [official manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)
is also stored in `docs/rules/rulemanual.txt`.

- **9-10-1 / 9-10-1-1:** replace the movement before it happens. There is no
  intermediate Drop entry, no Drop recovery program, and no false Drop-entry
  Auto. The actual departure from Battle is retained.
- **5-12-3:** a card's own KO Auto may still pend when a continuous effect
  redirects its KO movement to another area. KO and actual Drop entry are
  separate facts; this patch preserves the existing KO occurrence.
- **5-8-2-2-1-1 / 5-8-4:** a required action-price movement is not paid when
  the card goes to another area. A redirect already performed stays performed;
  the activation does not resolve on the strength of an unpaid cost.
- **9-10-2 / 9-10-2-3:** suspendable moves preserve the affected player's
  choice between replacements and the existing one-use-per-subject-event IDs.
- **3-1-6 / 3-2:** the destination is the owner's deck, with one bottom
  insertion preserving the rest of the ordered pile, even under borrowed
  control.

The source restriction is Battle or Combo, regardless of the attempted
destination. Hand, Energy, Deck and Warp departures are not covered. A
change of controller within the same Battle Area is not an area departure.
The rule is disabled by skill negation and creates no blanket prohibition on
entering Drop from another area.

## Shared implementation

The compiler emits a `replaceLeave` redirect with explicit
`from: ["battle", "combo"]`, `to: "deck"`, and `position: "bottom"`.
The schema, language round trip, human reading and macro expansion retain the
areas and position. Ordinary Battle-Area replacements retain their previous
scope. Only explicitly scoped replacement programs become valid from Combo;
other Permanents are not enabled there.

Native battle cleanup already owns replacement choices and saved cursors.
Before its generic Combo-to-Drop announcement, it now recognizes a mandatory
set of redirects whose possible routes all avoid Drop, and emits no false
Drop Auto. The pre-existing explicit issue-609 boundary remains for projecting
generic Drop Autos through optional/substitute choices that can still reach
Drop; no route is guessed.

## Explicit Drop activation and strict costs

The four resurrection lines already compile independently, but the declared
activation candidates previously omitted Drop entirely. The shared activation
now considers Drop, admitting only a non-keyword line whose persisted
`usableFrom` explicitly names Drop. Unrelated lines, keyword moves, missing
stored programs, foreign cards, negation, timing, costs and use limits remain
gated. This grants no general permission to use skills from Drop.

A new saved continuation uses the existing strict action-price host, following
the established Swap cost pattern. It proves affordability on a copy, filters
saved choices, pays the action price once, and only then announces activation,
spends Once/Limit and runs the printed effect with cost bindings. A redirect
that defeats the required Warp movement neither activates nor spends Limit;
performed replacement movement is retained. Ordinary non-Drop activation
payment is outside this change. Additional synthetic proofs cover competing
price choices, wrong-player/foreign-card rejection, persistence and cross-copy
Limit behavior. Zero-power confirmative rule processing also now carries the
replacement's bottom position through its frozen route instead of losing it.

## Proof

`scripts/fixtures/universe3-920.json` contains only public printed card fields
from the snapshot. `scripts/verify/universe3-removal-920.ts` corrects those
rows, drafts every skill, serializes ordinary rule rows, and loads them with
the production `rulesFromRows` seam. VM tests cover all four cards, both seats,
Battle and Combo, Drop/hand/Warp/deck attempts, Battle-to-Combo, excluded
origins, individual/all-skill negation, borrowed control, ordered decks,
snapshot privacy, JSON reload, KO Autos, failing movement/KO prices,
competing replacement choices, replacement-use IDs and native battle cleanup
with a generic Drop watcher. The resurrection skills are compared against
their pre-change drafts independently of the Permanent.

No Neon writes or paid calls are part of these proofs. A production refresh
must correct the catalog through its canonical ingestion path, wait for the
deployment, and use a guarded supported rule refresh with exact readback;
owner/Claude/confirmed/corrected rows and untargeted records stay protected.
Issue 907's full census remains the historical baseline until that receipt.

## Reading delta

The fixed private catalog snapshot contains 6,552 Masters entries. Excluding
all 59 Energy Marker accessories consistently on both sides leaves 6,493
cards and 13,556 drafted skill records (standalone native keywords are not
records). The baseline compiler at `f105e02d` (the same compiler/text sources as branch base `15487afd`) and this branch differ on exactly four
records: these four Permanents. Unread clauses decrease **3,177 → 3,169**.
Both previously unread clauses disappear on each target; all other drafted
records retain their readings, costs, conditions and programs. This is an
offline result, not a production refresh receipt. `readings.json` retains the
four complete before/after public records; no private deck/owner data.

## Offline fuzz validation

A frozen **public synthetic** snapshot using the four corrected cards and
vanilla opposing decks completed **40 games, 40 completed, zero interrupted,
zero action limits and zero crashes**. The report recorded 433 ordinary
bottom-deck redirect notes across all four names. These are mechanics probes,
not owner saved decks, strategy certification, or permission to use banned
cards in tournaments. The private-local report and replay inputs stay outside
Git; this run opened no database connection.

## Final local validation receipt

Node24 typecheck and lint passed (five pre-existing historical prototype warnings). The full npm-test command chain passed cumulatively: the original run passed every entry before capabilities, then found that the capability inventory needed the new explicit `comboCleanup: true` argument in the existing issue-609 NotYet guard identity. One inventory signature string was corrected, without changing production behavior. The failed capabilities check and every remaining package test entry were then rerun successfully, followed by a successful production build. See `validation.json` for the exact upstream/resumed commands and exits. The final focused Universe3/609 proofs and offline40-game fuzz passed. An uninterrupted full gate on combined current main remains the coordinator integration step. No migration, UI layout change, live write or paid call.

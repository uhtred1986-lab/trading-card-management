# EX23-36/P-519: conditioned Fusion Drop-to-bottom permission

This bounded source/design audit covers EX23-36 and P-519 front#10 activations
and front#20 support clauses only. It performs no code change, database read/write,
test or game. Actual stored rows and any proposed writes require a separate
coordinator freeze; public printed text is not an actual-row admission claim.
BT17-082's different Absorb substitution is outside scope.

[Receipts](online-sources.json), [normalized official lines](online-card-lines.json)
and [manual/FAQ excerpts](online-sources-excerpts.txt) retain authority, exact URLs,
retrieval times, bytes and hashes. Both fresh card pages returned HTTP200 at
17:08:52–53 UTC on19October. Their bytes exactly match the earlier same-day
#1068 source audit. Same-day official manual/FAQ/errata bytes were reverified;
raw HTML/PDF remain outside the checkout. No exact-ID FAQ/errata entry was found
for these two cards. No community ruling or equal-power waiver is used.

## Exact primary printed lines

**EX23-36/front/10:**

> [Union-Fusion]{y}{y}{y}, draw 1 card: Yellow <Son Goten: GT> card and yellow
> <Trunks: GT> card.

**EX23-36/front/20:**

> [Permanent] If your Leader is a yellow <Gotenks: Adolescence> card and you are
> choosing cards to use with this card's [Union] skill from your hand, you may
> choose the specified Battle Cards from your Drop. If you do, place the chosen
> cards at the bottom of your deck in any order.

**P-519/front/10:**

> [Union-Fusion][Limit 1] <Son Goten: GT> card and <Trunks: GT> card, both yellow.

**P-519/front/20:**

> [Permanent] If your Leader is a yellow <Gotenks: Adolescence> and you choose
> cards to use with this card's [Union] skill from a hand, you may choose the
> specified Battle Card in your Drop. If you do, place the chosen cards at the
> bottom of your deck in any order.

The JSON preserves official colon spacing/apostrophes; these readable quotes
normalize typography only. EX23-36 has three yellow-orb images; P-519 prints no
energy or action price on this Fusion line. Other bare keywords and payoff
skills on either card are contextual source, not additional target acceptance.

## Mixed Hand/Drop classification and destination

Manual22-13-4-2/-4 establishes one of each specified Battle Card of equal power
from hand, while4-2-1 explicitly says source permissions **expand** the conditions
that can be fulfilled when choosing Fusion materials. The support text adds
Drop choices; it does not replace the hand option or require all materials to
come from one area.

There is direct analogous official FAQ evidence: **BT12-136Q1, BT12-137Q1 and
P-286Q1** each ask whether their source-expanded Fusion can choose one material
from hand and one from Warp. Every answer is **“Yes, you can.”** This is an
explicit analogy for mixing an added area with the default hand, not a claimed
card-specific Drop-to-bottom FAQ. The general expansion rule and the same
individual specified-material selection support Hand/Drop mixtures here.

The “chosen cards” in the added clause refers to the materials chosen **from
Drop** using that permission. Those cards go to deck bottom. Hand-selected
materials retain the unchanged default hand→Drop cost of22-13-4-4. Rule0-2-2 gives
the printed added source/destination instruction priority where it changes the
default; it does not change unrelated materials. There is no basis to bottom
all hand materials, the whole Drop pile, or to waive typed character/color/type
or equal-power requirements. Preserve standard named distinct copies and the
existing labelled printed-power rule; this slice supplies no new power ruling.

## Order and payment checkpoint

“In any order” gives the owner an actual choice for two Drop materials. General
3-1-5 additionally assigns ordering of simultaneously placed cards to their
owner. Under3-1-5-1, when that owner can determine the order for open→secret
placement, the opponent cannot confirm the order; the bottom-order choice must
remain private. No extra shuffle is printed or implied. A single Drop
material in a mixed pair has no two-card bottom-order choice.

Material movement finishes before the remaining Fusion skill cost is determined
and paid (22-13-4-4/-4-1). Consequently EX23-36's draw1 is after material placement,
as is its remaining energy payment under the already delivered checkpoint.
P-519's Limit1 is the existing typed use ceiling, not an invented energy price.
If a later operation explicitly shuffles the deck, it shuffles the resulting
Deck normally; these support lines themselves do not shuffle it.

## Small typed increment and focused boundaries

Reuse existing typed Leader conditions, exact named Fusion slots, optional
source permissions, movement-to-deck-bottom, order choice and strict payment
checkpoint. A distinct permission must record Drop as the added material area
and bottom as the destination for those selected cards. Do not route it through
BT31-001's Battle/Drop→Warp permission or the Warp→Drop permission, and do not
create another parser or interpreter during payment.

Required boundaries include wrong Leader color/character, wrong material
character/color/type/power, wrong source/copy, hand-only/Drop-only/mixed pairs,
both bottom orders, ordinary hand cost and other source-permission controls.
Verify that payment redirection fails before remaining price/activation,
materials remain paid after a later incoming-card Counter replacement, and
saved choices bind source occurrences/permission snapshots without reparsing
English. With an initially empty deck, moving two Drop materials to bottom may
make the later draw1 payable: affordability must use the real post-material
board rather than rejecting that sequence from the original deck count.

Freeze the four exact rows before selecting application scope. Do not infer
whole-card/deck readiness or overwrite unrelated payoff lines because the two
support clauses share wording. No new ruling is required by the area-mixing
classification above; the FAQ analogy and general rules are explicit evidence.

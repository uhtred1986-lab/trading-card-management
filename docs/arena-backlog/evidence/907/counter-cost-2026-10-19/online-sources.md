# #907: BT6-060/061 Counter energy-cost restriction

Official sources freshly checked 19 October 2026 UTC; byte hashes, HTTP status,
retrieval times and exact URLs are in [the source receipt](online-sources-receipt.json).
This is a bounded source/parser finding, not an actual-record application or pair qualification.

Both current official listings retain the frozen text:
[BT6-060](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-060)
and [BT6-061](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-061):
“During battles where this card is attacking, your opponent can't activate
[Counter] skills with energy costs of 2 or more.” Neither exact number appears
in the current [official errata](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php).

The [Masters manual v4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)
separates the energy-cost information of a card from its skill cost and the
amount actually paid:

- §1-2-4: “When card text refers to energy costs, it refers to energy costs on
  Battle Cards, Extra Cards, and Unison Cards.”
- §1-2-5-1/2: the card's energy-cost information is its total cost, floored by
  its remaining specified cost if the latter is greater.
- §9-9-1: when card information is requested, apply continuous effects to the
  printed information, including numerical rewrites.
- §22-10-4: a pending Counter is activated during Counter timing by paying
  its “energy and skill cost.” These are separate quantities.

Thus the restriction tests the Counter **card's current energy cost**, including
continuous changes and its specified-cost floor. It does not test additional
orb costs printed in the skill's cost, or the amount actually paid after a
payment waiver. A cost-2 card activated without paying is still cost 2; a card
whose energy-cost information is reduced from 3 to 1 is cost 1.

The current [official Card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)
has no BT6-060 entry and BT6-061's Q1–6 discuss its removal Auto, not this
Permanent. Adjacent independent checks support the current-information reading:
BT9-011 and BT9-029 say their Counter cards reduced to cost 1 are returned by
DB1-040's cost-bounded Counter; BT9-059 and BT9-071 likewise apply to current cost 2.
BT13-020 Q1 explicitly distinguishes a Counter activated **without paying** its
energy cost. These are supporting examples; the manual is the direct definition.

Read-only fresh compilation reproduced the defect on both front skill #10:
`unread:[]`, correct `inBattle(self,attacker)` condition, but a bare
`forbid activateCounter` operation that discards “with energy costs of 2 or more.”
Both records must remain held from actual metadata application until repaired.
The existing operation's `filter.costMin:2` and existing `ruleApplies` current-card
filtering can represent the exact restriction without a new interpreter.

The proposed focused proof uses the frozen actual Broly printings plus synthetic
Counter controls. Both seats cover the source attacking versus another attacker,
current card costs 1/2/3, reductions/increases, a distinct additional skill orb
price, free activation and specified-cost floors. It checks live offers and
forged direct declarations as well as saved-context replay. No protected record
is overwritten by this proof.

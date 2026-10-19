# #907 combo-trigger qualifications: online rules check

Fresh retrieval: **19 October 2026 UTC**. Scope is exactly BT6-006 front #10,
BT6-010 front #0, BT6-066 front #0 and BT6-070 front #0. Official Bandai Masters
sources govern the conclusions below. [The retrieval receipt](online-sources-receipt.json)
records each exact URL, timestamp, HTTP status, byte count and SHA-256 of response
bytes, including denied responses. This is semantic source evidence, not an
implementation or per-skill verification claim.

## Qualification contract

The current official card listings agree with the frozen selected-pair catalog:

| Exact skill | Official printed instruction and resulting qualification |
| --- | --- |
| [BT6-006 Support Attack Son Goten](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-006), front #10 | “When you combo with this card, if your Leader Card is red and your life is at 4 or less, draw 1 card.” This is this physical card's combo, with no printed hand-only or turn restriction. Preserve the red Leader/life condition and draw. |
| [BT6-010 Support Attack Trunks](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-010), front #0 | “At the end of a battle in which you combo with this card from your hand during your opponent's turn, if your Leader Card is red, play this card in Rest Mode.” Bind the end-of-battle trigger to this physical card's combo from hand in that battle on the opponent's turn. Another card's combo, a Battle Area origin, the controller's turn or another battle cannot qualify it. Preserve the red Leader condition and Rest Mode play. |
| [BT6-066 Quickshift Angila](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-066), front #0 | “When you combo with this card, if your Leader Card is green, you may choose 2 cards from your hand and shuffle them into your deck. If you do, draw 2 cards.” This is this physical card's combo, with no printed origin or turn restriction. The optional choice is exactly two, not up to two; draw requires fulfilling that choice/payment. |
| [BT6-070 Goliamite, the New Breed](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-070), front #0 | “When you combo with this card during your turn, choose up to 1 of your 〈Broly : Br〉 cards and it gets +5000 power for the duration of the turn.” This is this physical card's combo on its controller's turn. There is no hand-only restriction. Preserve the Broly: Br target and turn-long modifier. |

All four listings returned HTTP 200. Their printed tournament availability date
is March 8, 2019; that is not a page revision date. No page-level update date was
exposed. Normalized spaces around the official character-name colon do not
change the frozen character identity.

## Manual and FAQ: distinguish a pending combo Auto from a later battle-end Auto

The [official manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)
returned HTTP 200 and identifies itself as **Masters Official Rule Manual
ver.4.00**, “Last Updated: 01/09/2025” (printed date retained without resolving its
locale). SHA-256 is
`e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`.

- §5-7-1 defines a combo as placing Battle Cards in a Combo Area.
- §5-7-4 explicitly says references to Battle Cards used in combos can refer to
  cards in areas other than the Battle Area. §§5-7-5/6 permit normal combos from
  hand or eligible Active Mode Battle Cards during offense/defense respectively.
  Do not infer a hand-only restriction for the three skills that do not print it.
- §§9-6-2/3 make an Auto pending when its trigger condition is fulfilled, then
  activate it at a checkpoint. §9-6-11 says an Auto whose trigger condition has
  been fulfilled still resolves if its card has moved areas or its skill has
  subsequently been negated, unless the effect has become impossible to carry out.
- §8-5-8 moves all remaining Combo Area Battle Cards into their owners' Drop
  Areas. §8-5-9 then makes end-of-battle skills pending; §8-5-10 is a checkpoint.
  §8-5-10-1 explicitly includes “the end of the battle after you combo with this
  card” skills on cards moved Combo → Drop during §8-5-8. Normal cleanup must
  therefore preserve the qualifying card/battle binding. An arbitrary earlier
  move to a different area does not receive this explicit cleanup exception.

The [official Card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)
returned HTTP 200; SHA-256
`75233787a3b2d245ff4fc34971c3a78e8402e12d29b4ee8d73b96e3315362001`.
Two card-specific answers make the distinction concrete:

> **BT6-010 Q2:** You used this card in a combo. Then, your opponent used
> {BT1-048 Ultimate Judgment Jaco}'s auto skill to return it to your hand. At the
> end of the battle, can you use this card's auto skill to put it into play?
> **A2:** No, you can't.

> **BT6-066 Q1:** You used this card in a combo. Then, your opponent used
> {BT1-048 Ultimate Judgment Jaco}'s auto skill to return it to your hand. Can
> you activate and resolve this card's auto skill?
> **A1:** Yes, you can.

Thus BT6-010's later trigger must not revive a card returned to hand before
battle end; BT6-066's already-pending combo Auto must not be lost simply because
Angila subsequently moved to hand. The FAQ's BT6-010 Q1 also confirms that Battle
Cards reduced to zero power enter Drop, but that is outside this trigger slice.
Exact card-number searches found no FAQ entries for BT6-006 or BT6-070.

The [official errata list](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php)
returned HTTP 200; SHA-256
`0ae8e4f719e4b263ec4ec85cbf14b6bf423d7021417ae109760c93be8897b696`.
Exact card-number searches found **no entry for any of the four**. Absence from
this retrieved list is not a claim about unpublished rulings or future errata.

## Public forum search and access limits

Public discussion was searched separately and does not establish a rule.
DuckDuckGo's HTML search for `site:reddit.com/r/DBS_CardGame "Support Attack
Trunks"` returned a result for [“Can you counter then combo”](https://www.reddit.com/r/DBS_CardGame/comments/qoi8qj/can_you_counter_then_combo/).
Its search snippet describes a beginner asking about Afterimage Technique and
Support Attack Trunks power reductions. Another result, [“Question
Megathread”](https://www.reddit.com/r/DBS_CardGame/comments/fk9o8f/question_megathread/),
mentions Support Attack Trunks in a snippet. These snippets neither establish
the precise end-of-battle/origin binding nor override the official FAQ.

Direct retrieval of both Reddit threads, the old.reddit.com version of the
first thread, and Reddit's public search JSON returned **HTTP 403**. Their
contents/comments and post dates were not accessible; no claim is made to have
read those discussions. Searches for Quickshift Angila and for the broader
Trunks end-of-battle wording yielded no usable discussion in the retrieved
search responses. A Google search for Quickshift Angila returned HTTP 200 but
served a JavaScript/access challenge, so it contributed no readable evidence.
Every attempted URL and rejected-response hash is in the receipt; a 403 body
hash identifies the denial response, not forum content.

No semantic conflict remains in this bounded qualification contract after the
official checks. This research does not authorize changes to Z-Energy handling,
general delayed skills, native identities, or the four protected user rows.

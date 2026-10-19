# BT6-014 bounded EX-Evolve identity research

Retrieved 19 October 2026 UTC. Exact URLs, timestamps, response byte counts and SHA-256 hashes are in `online-sources-receipt.json`. This is source research and implementation review preparation, not human confirmation or deck qualification.

## Official printed source and errata

[BT6-014 SSB Gogeta, Fusion Onslaught](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-014) prints:

> [EX-Evolve] Choose 2 red cards from your hand and place them in your Drop Area: Red <Gogeta: Br> card with an energy cost of 6.

It also prints an Auto beginning “When a card evolves into this card”, conditioned on the opponent having no Battle Cards, that places up to two opposing Life cards in Drop and prohibits another same-name play for the turn. The exact frozen source is `evidence/897/selected-pair-inputs-2026-10-19/catalog.json`; the current official card list agrees. The card list renders keyword names as image alt text, so plain text extraction alone omits those names.

The [official card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php), BT6-014 Q1, explains that “can't be KO'd” prevents both battle and skill KOs. It gives no different EX-Evolve payment or base requirement. The [official errata page](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php) contains no BT6-014 entry in the retrieved response. This is a bounded absence finding, not a claim about future amendments.

## Manual contract

[Masters rule manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00), version 4.00 (printed Last Updated 01/09/2025):

- **22-5-1:** Evolve/EX-Evolve is an Activate: Main keyword related to playing cards.
- **22-5-3:** activation requires paying the skill cost and choosing one Battle Card satisfying the specified character and conditions **in your Battle Area**. If no specified base can be chosen, activation is unavailable.
- **22-5-4:** activation is from hand only, absent a separate explicit permission.
- **22-5-5:** Evolve and EX-Evolve play the incoming card on top of the chosen base. Position and effects affecting the lower card's power carry over, referencing 21-5-2. EX-Evolve does not reset a rested base or transfer all of its effects.
- **22-5-5-1:** if the chosen base leaves the Battle Area **or the conditions cease to be fulfilled before resolution**, the evolution fails. A base that leaves and returns is not a substitute original base (3-1-4's new-card rule).
- **22-5-7/-7-1:** when the incoming card fails to enter play and remains in its original area, it goes to its owner's Drop, except an explicit replacement such as return-to-hand-instead.
- **21-5-2/-2-1:** position, power changes and in-battle information transfer to the newly placed top card; continuous effects unrelated to power do not.
- **1-2-4/-5:** an unqualified energy-cost requirement examines the card's energy-cost information. Current total cost is used, floored by current specified-cost count; undefined X is treated as zero per 1-2-5-3. The printed requirement does not say original energy cost.
- **9-4-2/-2-1, 5-8-2/-2-2/-3/-4:** reveal/declare the hand skill and pay its complete action cost; an unpayable two-red-card cost cannot be declared, and failed payment does not activate the skill. **9-4-4/-5** separates counter timing from resolution. Section 22-5-3 states cost and base choice together as activation prerequisites; it does not justify offering an unpayable declaration while waiting for later effects to supply a base or payment.

Bounded implementation recommendation: persist a versioned EX-Evolve discriminator, hand activation and a Battle-area base filter for red Gogeta: Br with current energy cost exactly six in the existing CostRecord; preserve the existing stored two-red-hand-to-Drop action-price program. Require recorded keyword kind, validate saved identity/price snapshots and use the existing Evolve interpreter for stacking/play/counter processing. Own Battle Area means the current controller's area, not immutable printed ownership. Neither colour exclusivity nor Active Mode is printed for the base. Generic Evolve, Xeno-Evolve and extra-area permissions remain outside this record's admission claim.

## Official general FAQ cross-check

[General rules FAQ](https://www.dbs-cardgame.com/us-en/rule/game_faq.php), Evolve section:

| Question | Official answer relevant to this boundary |
| --- | --- |
| Q1/Q2 | Hand only; during Main Phase. |
| Q3 | An evolved card's ordinary “when you play this card” Autos activate. |
| Q4 | EX-Evolve onto Rest Mode enters in Rest Mode. |
| Q5 | A +5000 power change carries over; granted Double Strike does not. |
| Q6 | Negation affecting the lower card does not negate the new top card. |
| Q7/Q8 | The stack is treated as one top card; an already evolved stack can be evolved again. |
| Q10 | Cards underneath are placed in Drop when the stack leaves its area. |
| Q11 | EX-Evolve triggers “When a card evolves into this card” Autos. |
| Q12 | A Z-Battle base is permitted if it meets the printed requirements. |

The general FAQ's Counter Q8 expressly allows Counter: Play against evolution. Its control section Q3 permits evolving a Son Goku gained by control change, confirming that the base need not have been originally owned by the activating player. Its Hidden Mode Q8 refuses a hidden base when a specified name or trait cannot be established. No card-specific exemption was found for BT6-014.

## Public discussion access limits

Two DuckDuckGo HTML searches for BT6-014 EX-Evolve and current-cost/power-transfer discussions returned HTTP202 bot challenges, not usable result pages. Direct public `/r/DBS_CardGame/search.json` returned HTTP403. Exact attempted URLs, timestamps and hashes are retained in the receipt. No community thread, comment, author, date or ruling was read or relied upon. Official manual and FAQ answers above resolve the bounded semantics without a community assumption.

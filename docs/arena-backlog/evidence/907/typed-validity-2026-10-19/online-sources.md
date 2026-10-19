# #907 bounded Sparking validity: online sources and timing

Retrieved **19 October 2026 UTC**. This source check concerns exactly four
selected-pair skills. It supplies semantic evidence, not runtime verification
or permission to migrate protected or unrelated records. [The receipt](online-sources-receipt.json)
records exact URLs, UTC timestamps, HTTP statuses, response sizes and SHA-256
hashes. Official Masters sources take precedence over public search snippets.

## Four exact rows

The current official Card Search listings match the frozen selected-pair
Sparking tags and enclosures:

| Exact skill | Official listing | Validity threshold and independent event/cost |
| --- | --- | --- |
| BT6-003 front #0 | [Harmonic Energy SSB Son Goku](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-003) | Auto, **Sparking 3**. “When you play this card from your hand”; look up to seven, optionally play a red Vegeta: Br in Rest Mode, shuffle. |
| BT6-004 front #0 | [Preemptive Strike SSG Son Goku](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-004) | Auto, **Sparking 2**. “When you play this card”; look up to five, optionally add Gogeta: Br or red Vegeta: Br to hand, shuffle, then discard one if a card was added. |
| BT6-007 front #0 | [Harmonic Energy SSB Vegeta](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-007) | **Activate: Main**, **Sparking 3**. “Switch this card to Rest Mode:” is a separate payment; look up to seven, optionally play a red Son Goku: Br, shuffle. This is not an on-play Auto. |
| BT6-008 front #0 | [Preemptive Strike SSG Vegeta](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-008) | Auto, **Sparking 2**. “When you play this card”; look up to five, optionally add Gogeta: Br or red Son Goku: Br to hand, shuffle, then discard one if a card was added. |

All four listings returned HTTP 200 and print base-card tournament availability
as March 8, 2019. That is not a web-page update date. Sparking modifies this
one enclosed skill; it is not an additional play cost and does not gate the
other skills printed on the same card. This slice must retain BT6-003's hand
origin, the other two Autos' plain play event, BT6-007's real Rest Mode cost,
and all existing targets, modes and look/discard/shuffle instructions.

The [current official errata list](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php)
contains no exact-number entry for these four cards. Their [Card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)
entries discuss end-turn skills after Cold Bloodlust expires (and zero-power
processing for Vegeta); they do not replace or remove these Sparking tags.

## Skill validity is distinct from the event and the payment

The [Masters Official Rule Manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)
returned HTTP 200, 2,941,038 bytes, SHA-256
`e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`.
It identifies version **4.00**, printed “Last Updated: 01/09/2025” (retained
without a locale interpretation).

- **§22-26-1:** Sparking “is related to the conditions when a skill is valid.”
- **§22-26-3:** “Skills with [Sparking X] are valid only if you have X or more
  Cards in your Drop Area.” Counting does not move those Drop cards.
- **§9-1-3:** when a skill is valid only under specific conditions, “activation
  can't be declared for the negated part, and its effects can't be performed.”
  If it requires a choice, that choice is not made with the condition unmet.
- **§9-6-2:** an Auto becomes pending when its trigger condition is fulfilled.
  Pending status does not itself mean that activation has occurred.
- **§9-6-3-2:** if a chosen pending Auto cannot be activated, that pending
  occurrence is cancelled.
- **§§9-6-4/5/7:** determine/pay skill cost, activate, then resolve. Sparking
  validity must not be presented as a payable cost or as merely a conditional
  payoff after an invalid skill has already been offered.

The [official keyword reference](https://www.dbs-cardgame.com/us-en/rule/keyword-skills.php)
says Sparking “takes effect when you have X or more cards in your Drop.” Its
adjacent Burst and Spirit Boost descriptions expressly say what is paid to
activate a skill, reinforcing the distinction. The [Game FAQ](https://www.dbs-cardgame.com/us-en/rule/game_faq.php)
**[Sparking] Q1** confirms that Sparking 5 is inactive with two Drop cards.

## Pending versus already activated

Validity at the trigger cannot authorize a later activation when the threshold
has ceased to hold. The manual's **Bond** clauses provide a close textual
comparison: §§22-21-1/3 use the same “conditions when a skill is valid” and
“valid only if ... X or more” structure as Sparking. Official Card FAQ examples
explicitly recheck Bond after an attack trigger and a Counter: Attack:

> **BT4-053 Nail, the Namekian Ace Q1:** When this card attacks, your opponent
> uses a Counter: Attack skill to remove a card, leaving only Nail in the
> Battle Area. **A1:** “When this card's auto skill resolves, the conditions
> for [Bond 2] won't be met, so you don't get to draw a card and give this
> card +5000 power.”

**BT4-062 Adonic Warrior Angila Q1** gives the same answer for Bond 2/Slug's
Army and the opponent's discard. **BT4-046 Piccolo, Kami's Successor Q1**,
**EX03-12 Q2**, **EX03-13 Q1** and **P-051 Q1** likewise deny the payoff after
the required Battle Area count falls. These are explicitly **analogous Bond
rulings**, not newly invented Sparking-specific FAQ entries.

For the bounded Sparking interpretation, the skill must be valid at the
original event to establish its pending occurrence; raising Drop later cannot
retroactively create an earlier on-play trigger. Recheck the validity before
activating the pending Auto: a fall below threshold before that point cancels
the pending activation; a true event-time snapshot is not permission to ignore
current invalidity.

After activation, a different rule controls. **§9-6-11** specifically starts:

> “If an [Auto] skill **activates** and its trigger condition is fulfilled but
> the card with that skill is no longer in the same area, or if the skill has
> been negated, the player must still resolve that [Auto] skill. However, if
> the effect ... has become impossible ... due to the change of areas, the
> effect fails to resolve.”

**§9-3-1** separately says activated effects are independent of their source;
subsequently changing the source's area does not affect resolution. Thus
9-6-11 must not be stretched into permission to activate an invalid **pending**
Auto, or into an instruction to requalify an **already activated** effect after
each choice/reload. Once properly activated, its saved effect continues under
the normal resolution rules. A saved look/choice must not become another
opportunity to pay or recheck the activation.

No retrieved official card-specific Sparking answer explicitly stages a Drop
count change between these precise checkpoints. The implementation reading
above follows the current manual and the analogous official Bond examples;
do not label it a quoted four-card FAQ ruling. It leaves no contradictory
official instruction requiring an owner ruling for this bounded slice.

## Repository boundary and recommended essential proof

Static inspection of the handoff baseline finds no Sparking reader in
`compile/prices.ts`. `compileCostRecord` uses the condition parsed from cost
text, not `skill.sparking`. The frozen four rows' `cost.condition` does not
persist a threshold: BT6-003/004/008 have obsolete null cost records; BT6-007's
old Rest Mode payment has `condition: null`. Existing Activate gates and
static-effect collection read `sk.sparking`, while the Auto paths lack the
corresponding gate. Current price metadata must not be claimed as an already
complete Sparking contract.

Use one typed validity contract through compilation, records, loading and the
existing condition VM. Prove below/at threshold at event, loss/gain before
activation, no retroactive trigger, and continuation after a legitimate
activation. Exercise both seats, saved pending and look/choice continuations,
deterministic replay and deliberate stored-threshold changes with unchanged
display text. BT6-007 additionally needs real Rest Mode payment and no payment
when activation is invalid. Preserve existing effects and the unrelated
Once-per-turn rows; this does not expand into Bond, native keyword rules or all
validity gates.

## Public searches and limits

Additional public searches found [“Sparking clarifications”](https://www.reddit.com/r/DBS_CardGame/comments/cbqj0q/sparking_clarifications/)
and [“Auto Triggers and cards leaving play”](https://www.reddit.com/r/DBS_CardGame/comments/10y9zl0/auto_triggers_and_cards_leaving_play/).
Search snippets discuss a card contributing to its own Drop count and the
difference between pending and activation. Another search found discussions
about whether Burst/Sparking changes a skill into a keyword Auto. These are
incomplete snippets, not verified judge rulings or directly retrieved comment
threads; they do not settle the exact temporal count-change scenario. Other
retrieved exact-phrase searches supplied no usable additional ruling.

Search results for Fusion World, old manual versions and the Sparking ZERO
video game were excluded. No readable forum thread, comment date or complete
comment chain is claimed here. The receipt hashes search response bytes, not
underlying Reddit content. Official sources supply the interpretation above.

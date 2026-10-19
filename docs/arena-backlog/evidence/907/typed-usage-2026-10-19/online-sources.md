# #907 typed usage ceilings: official semantic check

Fresh retrieval: **19 October 2026 UTC**. This note covers the eleven use-limited
skills in the frozen BT6 pair and the distinction between [Once per turn] and
[Limit X]. [The retrieval receipt](online-sources-receipt.json) records exact
URLs, timestamps, HTTP statuses, response byte counts and SHA-256 hashes. Those
hashes identify retrieved bytes, including denied responses. Official Masters
sources govern; public search snippets are secondary and never rulings.

## Exact selected-pair scope

The frozen catalog contains eleven [Once per turn] skills on ten cards, and
**no [Limit X] skill**. Current official Card Search pages confirm each tag and
its enclosing skill. All ten pages returned HTTP 200. Links and response hashes
are also in the receipt.

| Card and official listing | Exact row | Skill whose usage is limited |
| --- | --- | --- |
| [BT6-001 Gogeta / SSB Gogeta, Fusion Perfected](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-001) | front #0 | Activate: Main; discard a red Son Goku: Br or Vegeta: Br as cost, draw two and optionally take life. |
| Same listing | back #10 | Activate: Battle; discard one red card as cost, conditional counter prohibition and power/Double Strike. |
| [BT6-003 Harmonic Energy SSB Son Goku](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-003) | front #10 | Activate: Main; +10000 and permission to attack Active Mode Battle Cards. |
| [BT6-004 Preemptive Strike SSG Son Goku](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-004) | front #10 | Activate: Main; +5000. |
| [BT6-007 Harmonic Energy SSB Vegeta](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-007) | front #10 | Activate: Main; choose up to one opposing Battle Card ignoring Barrier, -10000. |
| [BT6-008 Preemptive Strike SSG Vegeta](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-008) | front #10 | Activate: Main; choose up to one opposing Battle Card ignoring Barrier, -5000. |
| [BT6-015 Gogeta, Unparalleled Fusion Warrior](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-015) | front #30 | Auto; when it attacks a Battle Card, switch it to Active Mode. |
| [BT6-053 Paragus / Paragus, Father of the Demon](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-053) | back #20 | Activate: Battle; discard one as cost, choose up to one Broly: Br in its controller's Battle Area for +5000. |
| [BT6-060 Broly, Limits Transcended](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-060) | front #20 | Activate: Battle; discard one as cost, choose up to one opposing Battle Card ignoring Barrier and KO it. |
| [BT6-061 Broly, Power Unleashed](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-061) | front #20 | Activate: Battle; discard one as cost, choose up to one opposing Battle Card and KO it. |
| [BT6-062 Broly, Berserker Origins](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-062) | front #0 | Activate: Battle; discard one as cost, choose up to one opposing Battle Card costing three or less and KO it. |

BT6-001 back #10 is a protected corrected row whose existing unread clause
remains a separate blocker. BT6-015's target Auto is **#30**, not its protected
corrected Permanent #20. A metadata-only migration does not authorize replacing
either protected record's effect. Printed availability dates are March 8, 2019
for the base cards; reprints may list later availability. No page revision date
was exposed. This source check certifies the usage tags, not full unrelated
clauses, card legality or executable admission.

## Authoritative ceiling and identity rules

The current [Masters Official Rule Manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)
is version **4.00**, printed “Last Updated: 01/09/2025” (date retained without
assuming a locale). HTTP 200, 2,941,038 bytes, SHA-256
`e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`.

- **Once per turn:** §§22-11-2/3 limit one individual Auto/Activate skill to one
  activation/resolution each turn. Multiple physical copies with that skill can
  each use it. This is not a restriction to the controller's turn: the skill's
  own timing and conditions determine whose turn allows activation.
- **Limit X:** §22-44-3 shares X uses during the same turn across copies of
  **the same skill on cards with the same card number, for the same master**.
  It is not a card-name bucket, not one bucket for both players, and not merely
  a per-copy ceiling.
- **Same skill:** §22-44-3-1 compares wording, accompanying keywords, skill
  costs, effects, etc. Officially updated and original text count as the same
  skill despite the update. Runtime display wording therefore cannot be used
  as an unversioned substitute for executable identity.
- **Pending duplicates:** §22-11-4 permits only one resolution when a
  Once-per-turn Auto becomes pending multiple times. §22-11-5 forbids further
  triggering/activation/resolution after that use. §§22-44-4/5 similarly allow
  X resolutions for a Limit Auto, after which remaining pending copies fail
  to activate. A queue must not offer or charge a spent copy again.
- **Gained skills:** §22-44-6 explicitly separates a gained non-Limit skill
  from a coexisting Limit skill, even on a card with the same number/master.
  Its example distinguishes [Blocker][Limit 1] from an additionally gained
  [Blocker]. Sharing a card or operation does not make distinct skill instances
  share every ceiling.
- **Both tags:** no retrieved source states that Once per turn overrides or
  removes a coexisting Limit restriction. Both restrictions must be respected;
  an unimplemented combined identity/counting case should be blocked, not
  treated as permission to ignore one. None of the eleven target rows has this
  combination, so its broader implementation is not required by this slice.

## What spends a use

The manual distinguishes activation conditions/costs from conditional effects:

- §1-5-4-2 places an Activate skill's cost **before the colon** and its actual
  effect **after the colon**. §§9-4-2/3 require payment then activation;
  §9-4-5 resolves effects. A conditional effect yielding no payoff does not
  retroactively undo a paid activation. In BT6-001 back #10, discarding red is
  before the colon; its Drop-count/turn IF is after the colon. This distinction
  must survive any existing hoisted program condition.
- §§9-2-2/3 forbid activation when required costs cannot be paid or activation
  cannot be declared. For a priced Auto, §§9-6-4/4-1 say that if its skill cost
  is not paid, it is **not activated or resolved**. Declining an unpaid skill
  cost therefore differs from declining a choice inside an already activated
  effect.
- §0-2-4 resolves as many actions as possible when some are impossible. An
  already activated free skill that chooses zero from “up to one”, or that has
  no useful target, has still used its activation. It is not an extra use
  merely because no board change resulted.
- Negation that already prevents declaring activation (§§9-1-2/3) is not an
  activation. Negating an effect after activation is a different point in the
  procedure; neither the manual nor the retrieved FAQ grants an automatic
  refund of the usage ceiling. Preserve that distinction and do not infer a
  refund from a missing payoff.

The [official Game FAQ](https://www.dbs-cardgame.com/us-en/rule/game_faq.php),
**Skills Q28**, confirms a skill-cost Auto may be left unactivated by choosing
not to pay. A cost condition that is already fulfilled cannot simply be
declined instead. The [official Card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)
provides the contrasting cases:

- **P-130 Combo Strike Son Gohan Q1** and **P-133 Combo Strike Vegito Q1:** if
  the player declines the hand discard inside the Auto effect and therefore
  does not perform the combo payoff, the Once-per-turn Auto does **not**
  activate again that turn. This is an internal optional effect, not declining
  a skill cost before activation.
- **BT21-121 Frieza, Waiting To See Q1:** its Once-per-turn Auto activates for
  the first opposing Battle Card. The player cannot decline negation and save
  that activation for the next card.
- **BT3-001 Pan Q1** / **Pan, Ready to Fight Q1:** multiple simultaneous pending
  occurrences do not permit multiple Once-per-turn resolutions.

## Movement, faces, copied and gained skill boundaries

Manual §3-1-4 normally treats a card moved to another area as a new card and
does not carry effects over. §§3-1-4-1/2 expressly preserve effects for the named
Battle/Unison/Combo transitions. This supports distinct handling for a card
bounced to hand and replayed versus a Battle Card merely used in a combo;
[Limit X]'s per-master shared count is not erased by replaying another copy.

Relevant official FAQ confirmations:

- **P-024 Powerful Bond Ginyu Force Q2:** play its Once-per-turn Auto, then
  combo with it in the same turn: the same Auto does **not** activate again.
  Battle → Combo is not a fresh use.
- **P-025 Vile Strike Dark Prince Vegeta Q1:** front and awakened-side skills
  are different skills; using one does not consume the other's Once-per-turn
  activation during that turn.
- **Game FAQ [Dual Attack] Q3:** a newly gained second Dual Attack is a
  separate skill and can activate after the original was used.
- **TB1-038 Trio De Dangers Basil Q1** and **TB1-058 Maiden Squadron Kakunsa
  Q1:** a continuously granted Dual Attack that stops applying then is gained
  again is a separate instance with its own unused Once-per-turn condition.
- **BT14-017 Jiren, Thirst for Power Q1:** after using BT14-014's EX-Evolve,
  the separately granted EX-Evolve can still activate that turn. **BT14-019
  Q1** (also BT14-043/083/109/112) contrasts a different payment route for the
  same limited Counter: paying energy instead does not bypass Limit 1.
- **Game FAQ Hidden/Revealed Mode Q16:** switching an already-used
  Activate:Main/Once-per-turn card to Hidden Mode then back to Revealed Mode
  allows that Activate skill to be used again. This is source evidence for a
  distinct transition case, not authorization to expand the selected-pair
  migration into Hidden Mode or other native keyword support.

Copied/granted skill identity must be carried explicitly if the engine supports
those cases. The general “same skill / same card number / master” definition
does not justify treating an arbitrary synthetic copied-skill index as a
canonical shared Limit identity. Equally, the cited separate gained-instance
rulings must not be flattened into one per-card skill-text bucket. These are
boundaries for a typed contract; no selected target requires a copied or
granted Limit implementation.

## Errata and source limitations

All ten exact card-number searches in the [current official errata
list](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php) found **no entry**.
The current Card FAQ has selected-card entries for BT6-003/004/007/008/015/053/
061/062, but none changes the eleven usage tags. Its BT6-003/004 and BT6-007/008
answers about end-turn Cold Bloodlust negation concern their separate return
Autos, not a reset or extra use of the Once-per-turn Activate. No exact entry
was found for BT6-001 or BT6-060. No page revision dates were exposed by these
HTML sources; retrieval timestamps and manual version remain separate facts.

Official Game FAQ [Once per turn] Q1/Q2, [Limit] Q1, Card FAQ BT6-057 Q5/Q6 and
SD15-01 Q1 also warn against treating these annotations as ordinary negatable
keyword skills: the FAQ expressly says Once per turn and Limit are not keyword
skills for those interactions. The manual groups them under numbered keyword
sections; preserve the FAQ's concrete interaction rather than inferring that a
skill negator may remove only its ceiling.

## Public discussion search

DuckDuckGo HTML searches located these relevant discussions:

- [“Once per turn”](https://www.reddit.com/r/DBS_CardGame/comments/qjc3od/once_per_turn/):
  search snippet discusses whether a card dropped and replayed is a new card.
- [“Is once per turn across all cards like Limit 1…”](https://www.reddit.com/r/DBS_CardGame/comments/x3xf45/is_once_per_turn_across_all_cards_like_limit_1_or/):
  snippet distinguishes a per-copy Once-per-turn ceiling from shared Limit.
- [“Spirit Boost cost?”](https://www.reddit.com/r/DBS_CardGame/comments/14w5izi/spirit_boost_cost/):
  snippet says unpaid costs are optional and distinguishes triggering from
  resolving; this agrees with Game FAQ Skills Q28 at the stated level.
- [“Android 17, Defending Friends”](https://www.reddit.com/r/DBS_CardGame/comments/1chyp3o/android_17_defending_friends/):
  snippet quotes an older Limit section and discusses the skill's master.
- [“Skill keyword explanations”](https://www.reddit.com/r/DBS_CardGame/comments/v88ju9/skill_keyword_explanations/):
  snippet asks about another same-number card with Limit.

**All five direct Reddit retrievals returned HTTP 403.** Their comments/post
dates were not read, and response hashes identify access denials, not forum
content. Search results include other games and old manuals; Fusion World and
Gundam hits were not used as Masters authority. Search snippets also contain
overbroad “optional Autos always consume” explanations: official cost versus
effect distinctions above control instead. There is no unresolved owner
semantics question for these eleven ordinary printed Once-per-turn rows.

## Adjacent bounded audit: four selected Sparking rows

This is a recommendation for a following validity slice, not usage-ceiling
implementation evidence. The already-retrieved official card pages establish:

| Exact row | Kind / threshold / trigger or cost |
| --- | --- |
| BT6-003 front #0 | Auto / Sparking 3 / when played **from hand**. |
| BT6-004 front #0 | Auto / Sparking 2 / when played. |
| BT6-007 front #0 | **Activate: Main** / Sparking 3 / switch this card to Rest Mode as cost; it is not an on-play Auto. |
| BT6-008 front #0 | Auto / Sparking 2 / when played. |

Manual §§22-26-1/3 say Sparking relates to when a skill is **valid**, and a
Sparking X skill is valid only with X or more cards in its master's Drop.
§9-1-3 says activation cannot be declared and effects cannot be performed for
the part invalidated by an unmet validity condition. Official Game FAQ
**[Sparking] Q1** confirms that Sparking 5 is inactive with only two Drop cards.
Sparking is therefore a skill-validity condition, not a payment that removes
cards and not an arbitrary conditional payoff after the effect starts.

The manual separately makes an Auto pending when its printed event occurs
(§9-6-2), then determines activation at the checkpoint. No card-specific
official answer was located that explicitly varies the Drop count between
this trigger and activation for the three scoped on-play Autos. Do not invent
a new trigger event or infer that an ordinary effect IF is the whole validity
contract. A following proof should establish below/at threshold, event versus
activation count changes, both seats, saved pending/resuming frames and stored
threshold authority before claiming the timing interaction verified.

Static repository inspection on the handoff baseline finds that
`compileCostRecord` compiles `priceCondition(skill)` from the cost text but has
no Sparking-tag reader. The frozen four rows have no persisted threshold in
their cost condition (three obsolete null costs; BT6-007's old rest-action
cost has `condition: null`). The existing Activate gates and static-effect
collection read parsed `sk.sparking`; the Auto pending/activation paths have
no corresponding Sparking threshold check. Thus an implementation should
first make the threshold executable metadata and apply it at the correct
validity boundary, retaining the four rows' effects, origin distinctions and
BT6-007's real Rest Mode payment. This is not a claim that current prices
already persist Sparking.

Additional public searches located [“Sparking clarifications”](https://www.reddit.com/r/DBS_CardGame/comments/cbqj0q/sparking_clarifications/)
in snippets discussing a card contributing to its own Drop count and comparing
Afterimage Technique. No complete discussion was retrieved, so those snippets
do not establish the pending/activation count-change semantics above. Unrelated
Sparking ZERO game results and older manual versions were excluded.

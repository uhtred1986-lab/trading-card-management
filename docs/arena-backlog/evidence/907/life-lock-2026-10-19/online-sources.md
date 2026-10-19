# BT6-053 Life-to-hand locks: bounded backlog preparation

Source check: **19 October 2026 UTC**. This is read-only investigation of the
next two frozen selected-pair blockers, not delivered implementation or a claim
of deck qualification. [The receipt](online-sources-receipt.json) records exact
URLs, source retrieval timestamps, HTTP status, byte count and SHA-256. Same-day
official response bytes from the preceding research were reused rather than
claiming another fresh retrieval.

## Official printed contract

The current [BT6-053 Card Search listing](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-053)
returned HTTP 200; SHA-256
`33ac1b4c14467a9debbdb1dabd26663150f4287918d7f8f3cc0f3f7dd3b622c1`.

- **Front #10:** “[Activate Main] Choose 1 card from your life and add it to
  your hand: You can't add cards from your life to your hand for the duration
  of the turn.” Moving one Life card to hand is the activation **cost**, paid
  before the new lock exists. The activated effect then installs a player
  prohibition until that turn ends. A second activation cannot pay the same
  Life-to-hand cost while that prohibition applies; this does not require an
  invented Once-per-turn tag.
- **Back #0:** “[Permanent] You can't add cards from your life to your hand
  during your turn.” This is a standing prohibition on the controller only
  while it is that controller's turn. It is not a turn-long effect installed
  by a separate activation, and it does not prohibit ordinary Life-to-hand
  movement during the other player's turn.

The [current official Card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)
returned HTTP 200; SHA-256
`75233787a3b2d245ff4fc34971c3a78e8402e12d29b4ee8d73b96e3315362001`.
It directly confirms that the lock includes damage processing:

> **BT6-053 Paragus Q2:** During your turn, if you've activated this card's
> Activate skill and your opponent deals damage to you, can you add cards
> from your life to your hand? **A2:** No, you can't.

> **BT6-053 Paragus, Father of the Demon Q1:** During your turn, if your
> opponent deals damage to you, can you add cards from your life to your hand?
> **A1:** No, you can't.

**BT6-054 Cheelai and Lemo Q1** gives the same answer for opposing damage
**by a skill** during your turn. Thus the lock cannot be reduced to refusing a
voluntary self-Life choice, a payment-only restriction, or an opponent's skill
that removes a Battle Card. Front Paragus Q1 (green Field card permits its
attack draw) is unrelated to these two locks. Exact-number search of the
[official errata list](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php)
found no BT6-053 entry.

### Exact Broly interaction, not inferred design intent

Both faces of BT6-053 are green Leaders with the **Saiyan / Frieza's Army**
traits. This satisfies the explicit Leader condition on [BT6-063 Broly,
Unrealized Ambition](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT6-063),
whose current listing returned HTTP 200; SHA-256
`5eafbdd4c7bee6d1ac133da8a031c7d81aa9acfe7567fde0c78b90d16e0f19b6`.
Both of Broly's Autos require a **green Frieza's Army Leader**:

- When played from hand, add two Life cards to hand.
- When removed from a Battle Area by a skill or KO'd, add one or two Life cards
  to hand, **then** optionally play one green Broly: Br costing four from hand.

The life additions here are effect instructions, not a cost before a colon
and not an “if you do” requirement for the upgrade. The official Card FAQ
directly answers the relevant case:

> **BT6-063 Q7:** When you are prevented from adding cards in your life to
> your hand by this card's auto skill, does the “choose up to 1 green
> 〈Broly : Br〉 card with an energy cost of 4 from your hand and play it”
> skill resolve? **A7:** Yes, it does.

Consequently, while Paragus's lock is active, skip the prohibited Life addition
and still resolve the optional Broly upgrade. This is a documented interaction,
not a claim about the designer's unprinted intention. **BT6-064 Q2** also
confirms sequencing: Rampage Trigger's Activate first places BT6-063 in Drop
and finishes its search; BT6-063's pending Auto then resolves and may play the
BT6-062 just searched into hand. **BT6-063 Q8** confirms its removal Auto can
activate when power reduction sends it to Drop at zero power. No broader
replacement/usage clause follows merely from these answers.

## Manual context

The [official Masters manual v4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)
prints “Last Updated: 01/09/2025” (locale left uninterpreted). HTTP 200,
SHA-256 `e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`.

- §1-5-4-2 distinguishes the Activate cost before the colon from the effect
  after it; §§9-4-2/3 require payment before activation. §§9-2-2/3 disallow an
  activation whose required cost cannot be paid.
- §0-2-4 skips impossible actions while performing possible parts of effects.
  §0-2-5 says an active prohibition takes precedence over a required card-text
  action. A failed Life-to-hand move is not permission to discard, reveal or
  remove that Life card instead.
- §21-3-2 normally processes each point of damage by choosing one Life card
  and moving it to hand. The card-specific FAQ above expressly prevents this
  move under the lock. **§1-13-1** defines damage as “any time a player loses
  life”; **§5-10-1** defines dealing damage as “removing cards from a player's
  Life Area” as a result of the specified damage rules/effects. **§5-10-2**
  defines receiving damage as being dealt damage. Therefore an attempted
  damage instruction that removes no Life cards under this prohibition is
  not actual dealt/received damage. §1-13-2 distinguishes damage from other
  Life loss: merely taking one's own Life as a cost/effect is not damage.
- §22-6-2 Critical sends Life to **Drop instead of hand**. The printed lock
  names only Life → hand; it does not itself prohibit Life → Drop or Life →
  Warp, or adding a card to Life from another area. These distinct routes
  must retain their own rules and replacement handling.
- §9-3-1 makes activated effects independent of their source. The front's
  already-installed player lock is not cancelled merely by awakening the
  source Leader; the back's separate Permanent applies by its own turn gate.

**Announced and actual damage remain distinct.** §8-4-6-1-1 makes a pre-damage
group of “when you deal damage, etc.” skills pending, with an exception for an
active “you don't take damage” effect. §8-4-6-1-2-1 then inflicts/processes the
damage. §8-4-6-1-3 separately makes the post-damage skills pending **if damage
was dealt**. The Life-to-hand prohibition is not automatically a newly printed
“you don't take damage” effect; it instead prevents the forbidden movement.
Do not interpret a failed actual Life move as a successful damage event, or
collapse the manual's pre-damage checkpoint into its post-damage condition.

## Current exact implementation boundary

The frozen physical export has front #10 and back #0 as compiler-owned **open,
version 1** rows. Each has an unread Life-to-hand prohibition and no effect
operations. Front #10's old cost record already selects one Life card and
moves it to hand; back #0 has an obsolete null cost. Neither row is one of the
four protected user corrections. Their presence does not establish executable
support, and refreshing them before an engine gate would not solve the rule.

The existing `forbid` operation, side, duration and condition primitives can
express the needed shape, but the current `ForbiddenAction` list has **no
Life-to-hand action identity**. `beMovedBySkill` is specifically an opponent's
skill moving a Battle Card and cannot implement this player prohibition.
Reusing the current interpreter with one bounded action identity (for example,
`addLifeToHand`) is smaller and more precise than a second movement engine or
an invented replacement effect.

Implementation should cover all existing Life-to-hand routes, not just the
first matching UI offer:

- `vm/host.ts`'s skill move adapter and `vm/flow.ts`'s native `moved` path both
  reach zone mutation; both need the same prohibition decision.
- `vm/battle.ts`'s damage loop uses native movement; `vm/script.ts`'s damage
  operation uses the host adapter. Both currently append the attempted Life
  id to their `taken` arrays unconditionally after requesting the move.
  Adding a silent no-op movement guard alone would leave misleading accounting
  and logs. Count actual removed Life cards under the definitions above; no
  actual removal must not create actual damage totals or dealt/received Autos.
- Life-down-to-N loops must terminate if a Life-to-hand move is prohibited;
  silently retaining the same top Life card can otherwise cause an infinite
  loop.
- `vm/costs.ts` Life alternatives currently test available Life count, then
  move cards; action-cost proofs and activation offers must also refuse an
  unpayable Life-to-hand cost. Do not offer a payable-looking action that only
  fails after other resources have been charged.
- Preserve replacements at the correct requested/actual destination boundary:
  a permitted Life→Drop route must not be rejected merely because the ordinary
  damage destination would have been hand, and a redirected route ending in
  hand cannot bypass the lock.

A following focused proof should cover both seats, front cost-before-lock,
repeat cost refusal, back own-turn versus other-turn, lock expiry, awakening
after front activation, skill and battle damage, actual Life/hand sizes and
movement logs, Life-to-Drop/Critical distinction, partial conditional effects,
saved continuations and deterministic replay. Determine any subtle
replacement interaction by its actual requested/resulting event instead of
inventing a substitute cost or logging attempted movement as actual movement.
This research does not deliver those changes or run those tests.

The current VM's `damage` occurrence is **actual/post-processing**: native
battle damage updates `damageTotals`, logs damage, fires its `damage` moment
and applies Victory Strike only after inspecting `taken.length`; script damage
similarly logs and pends dealt/received damage after its movement loop. The
declarations in `rulesets/dbs/triggers.rules` bind `dealtDamage`,
`youTookDamage` and `opponentTookDamage` to that actual occurrence. The generic
`damageStart` is only a step-start event, before power comparison; no dedicated
pre-damage occurrence/checkpoint from §8-4-6-1-1 is implemented. Preserve that
existing actual-event model in a bounded lock repair and report the missing
pre-damage sequencing as a separate existing residual. The repair must not
pretend it implements that broader checkpoint.

## Public search and access limits

Searches located [“Defending father paragus”](https://www.reddit.com/r/DBS_CardGame/comments/eb6jx3/defending_father_paragus/)
and other Paragus discussions. Many results concern Rampage Trigger or Oath of
Vengeance rather than BT6-053; those were excluded as authority for this lock.
The relevant direct Reddit request returned **HTTP 403**. No comments or post
date were read; its hash identifies an access-denial page. A separate exact
search returned no usable snippet. Official card text and FAQ above already
establish the core prohibition; public snippets add no stronger ruling.

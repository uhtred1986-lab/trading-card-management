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
  move under the lock. §1-13-2 distinguishes damage from other Life loss.
- §22-6-2 Critical sends Life to **Drop instead of hand**. The printed lock
  names only Life → hand; it does not itself prohibit Life → Drop or Life →
  Warp, or adding a card to Life from another area. These distinct routes
  must retain their own rules and replacement handling.
- §9-3-1 makes activated effects independent of their source. The front's
  already-installed player lock is not cancelled merely by awakening the
  source Leader; the back's separate Permanent applies by its own turn gate.

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
  and logs. Check actual outcome/route and settle damage-event semantics
  explicitly rather than importing “damage became zero” without evidence.
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
damage-trigger accounting from affirmative rules before expanding a movement
guard into a claim that the damage event itself did or did not occur. This
research does not deliver those changes or run those tests.

## Public search and access limits

Searches located [“Defending father paragus”](https://www.reddit.com/r/DBS_CardGame/comments/eb6jx3/defending_father_paragus/)
and other Paragus discussions. Many results concern Rampage Trigger or Oath of
Vengeance rather than BT6-053; those were excluded as authority for this lock.
The relevant direct Reddit request returned **HTTP 403**. No comments or post
date were read; its hash identifies an access-denial page. A separate exact
search returned no usable snippet. Official card text and FAQ above already
establish the core prohibition; public snippets add no stronger ruling.

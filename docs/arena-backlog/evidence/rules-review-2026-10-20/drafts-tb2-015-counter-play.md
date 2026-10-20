# Claude drafts, 20 Oct 2026: TB2-015 (up to 5 under) and the Counter plays BT23-055, BT1-091

Authorization: owner, 20 Oct 2026, in chat: save these three as Claude drafts, each with an engine proof. Writes went only through
`saveRule` (`src/lib/arena/rules-store.ts`), no ad hoc SQL. All three rows are `source = claude`, `status = draft`, never confirmed, and are
**not owner approvals**. No owner-confirmed or owner-corrected row, no BT1-064, no P-616, no errata was touched. Each row was read before
and after (JSON snapshots kept in scratch, not committed); `readRule` and the `validateRule` inside `saveRule` accepted all three programs.

## Before and after

| Row | Before | After |
|---|---|---|
| **TB2-015 front 0** `[Auto]` on play: choose up to 1 card in your Battle Area, place up to 5 cards from the top of the deck under it | `compiler`, `draft`, v2: `choose c0 (up to 1, Battle Area)`, `choose c1 (up to 5 cards of the deck)`, `moveTo under c0 <- c1` | `claude`, `draft`, v3: `choose c0 (up to 1, Battle Area)`, then `if chose(c0)`: `may{look 1, moveTo under c0}`, then four times `if did(may): may{look 1, moveTo under c0}` (at most 5, one at a time, stop whenever). Reads: "choose up to 1 card in your Battle Area, if you took that choice: you may: look at the top 1, move the chosen cards to under, if the offer was taken: ..." |
| **BT23-055 front 10** `[Counter: Attack]` negate the attack and play this card from your hand | `compiler`, `draft`, v2: `negateAttack`, `choose p0 {area: hand, special: self}`, `play p0` | `claude`, `draft`, v3: `negateAttack`, `choose p0 {special: self}` (no area), `play p0` |
| **BT1-091 front 20** `[Counter: Battle Card Attack]` play this card from your hand and change the target of the attack to this card | `compiler`, `draft`, v2: `choose p0 {area: hand, special: self}`, `play p0`, `redirectAttack {special: self}` | `claude`, `draft`, v3: `choose p0 {special: self}` (no area), `play p0`, `redirectAttack {special: self}` |

Basis:

- TB2-015: the owner's ruling recorded on the row ("up to 5 ... under the chosen card" is optional and one at a time, may 1, then if taken may 1 ..., at most 5),
  the same up-to-N ruling as BT3-120 (Drop) and BT12-122 (Warp); TB2-015's official Q&A (you may stop whenever you like within the limit); Rule Manual 20-16. Built
  from BT12-122 front 20's stored ops (`may{look 1, move}` then `if did(may)` repeated), with the move going `to: under` the chosen card. `if chose(c0)` keeps the
  "no card chosen, nothing placed" edge as BT31-139 v9 does. The existing explanation (the owner-ruling text) is kept and the Claude note appended after a " | ".
- BT23-055 and BT1-091: the BT1-064 front 10 fix (batch 2): a card that activated a [Counter] has already left the hand (Rule 22-10-7), so a self-choice from the Hand
  finds nothing; the self-choice names no area, as BT10-008's "then play this card" does. Negate and redirect are kept as stored.

Fields changed on each row, from the before/after diff: `ops`, `reads` (TB2-015 only; the counters read the same), `source`, `explanation`, `version`, `updatedAt`
(timestamp), and, see below, `usage`, `validity`, `cost`. Unchanged: `status`, `trigger`, `combo`, `cond`, `printed`, `kind`, review flag, confirmation fields.

### One thing outside the brief: the three rows had no typed records

The compiler rows were stored with `usage`, `validity` and (TB2-015 and BT1-091 and BT23-055) `cost` all `null`, the pre-#907 state. `saveRule` refuses a row whose
`usage` or `validity` is missing ("missing or malformed typed ... v1"), so those could not be passed back from the row. They were written as the v1 records the
BT1-064 draft carries and the compiler emits for these skills: `usage {limit: null, version: 1, oncePerTurn: false}`, `validity {version: 1, sparking: null}`,
`cost` = the zero price record (no orbs, no marker, no program). All three skills print no price of their own, so zero is the right price; the card's energy cost is
paid as a Counter / play cost as before. `trigger` (TB2-015 `["played"]`, the counters `[]`) and `combo` (`null`) were passed back unchanged.

## Engine proofs (on the stored rows, after saving)

Throwaway scripts (`rulesFromRows` on the stored row, real printed card text from the DB, the real `RULES.apply` flow with the harness; not committed). Because other
skill rows of these cards are still in the older record state (see below), the other skills of each card come from the compiler and only the saved row is the stored one.

**TB2-015** (play from hand with one other Battle Card on the board, answers to the `chooseMode` offers):

| Case | Cards placed under the chosen card | Deck |
|---|---|---|
| accept x5 | 5 | -5 |
| accept, accept, decline | 2 | -2 |
| decline first | 0 | 0 |
| no Battle Card chosen (choose none) | 0, and no offer shown | 0 |

**BT23-055** (opponent attacks my Rest Mode Battle Card, I activate the Counter from hand with blue energy): the battle record shows `negated: true`, the card is paid for
(active energy 8 to 4) and is in my Battle Area. After the play the engine stops at an interruption raised by skill 30, an `open` row of the same card
("your opponent can't play ... declared number", issue #544), unrelated to this change.

**BT1-091** (same setup, yellow energy): the card is in my Battle Area (energy 8 to 4) and the battle record's `guard` is the played card while the attack target
stays my original card; the attacker still attacks, now into the played card.

## Fuzz

`npm run arena:fuzz -- 20` with this app's database, after the three writes: **20 games: 20 completed, 0 interrupted, 0 action limits, 0 crashes.**

## Left alone, for the owner or a later pass

- All three rows stay drafts for the owner to approve or correct; none was confirmed.
- Other rows of these cards (BT1-091 skills 10 and 30, BT23-055 skills 20 and 30) still carry `null` typed records; BT23-055 skill 30 is `open`. Not touched.
- Other cards with the same "up to N under / to Drop / to Warp" or Counter self-from-hand wording were not touched.

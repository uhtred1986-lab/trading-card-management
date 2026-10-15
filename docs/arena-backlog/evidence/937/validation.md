# Target-qualified attack declarations

BT1-057's two printed faces cannot attack **Battle Cards**. The historical
compiler-owned draft program instead forbids every attack. The fixture first
loads that exact old program through `rulesFromRows` and reproduces the missing
Leader attack, then loads serialized newly drafted records through the same
production loader and exercises the actual action menu and `RULES.apply`.

The shared `forbid.attackTarget` filter describes a prospective defender,
separately from the existing attacker filter/target. Declaration menus supply
that defender; the apply path revalidates current targets even for an already
offered action. Missing defender context is conservative. Blocker redirection
never rechecks a restriction on the initial declaration.

`attack-target-937.ts` checks both seats and both Leader faces, a legal Leader
attack, refusal of a rested Battle Card, forged/missing/stale target actions,
and a subsequent legal Blocker redirect. It also checks BT1-023's power-qualified
Battle Card restriction, DB3-085's Leader restriction, blanket bans, rested
attackers, unknown qualifier rejection and operation-field validation.

Official basis: Bandai's [BT1-057 card list](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT1-057&search=true)
and [card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php), Q1 for each
face, explicitly allow attacking the opponent's Leader and then being blocked.
Printed fixture definitions contain public card information only. No collection
or deck membership is included. No live records are written or approved.

Compiler comparison uses the 6,552-card Masters snapshot. `compiler-diff.json`
records the complete changed programs and unread clauses, including changes
that preserve unread text. Runtime deployment does not refresh existing stored
rows; affected compiler-owned draft records require a separate guarded review.

Validation receipt is recorded in the pull request after required checks finish.

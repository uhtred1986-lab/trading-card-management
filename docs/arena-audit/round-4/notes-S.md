# Lane S (selectors), round 4 — what round 3 left

**4 November follow-up:** [Seven condition misreads repaired](conditions-followup.md).
The original findings below remain the historical round-3 handoff.


From round 3's fix agent and adversarial reviewer (integration 4, #1246). Check each item against the printed text and the current reading (`npm run arena:compile-snapshot` on a fresh snapshot) before working it: some may have been fixed in passing.

## Audit findings still misread (10)

Confirmed misreads from the readings audit of 2 Nov 2026 that three rounds have not fixed and that are still read (so they play wrongly). PRINTED is the card, AUDITED the reading the audit saw, NOW the reading on main at #1246, ROUND 3 why round 3 left it.

### BT2-048#0 — all-vs-any-vs-upto (medium, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [Counter: Battle Card Attack] Play this card. Then, choose 1 keyword skill of the attacking card and negate it for the duration of the turn.
AUDITED:  choose this card, play the chosen cards, choose up to 1 keyword skill of the attacking card and negate it for the turn  [trigger: ]
NOW:      choose this card, play the chosen cards, choose up to 1 keyword skill of the attacking card and negate it for the turn
ROUND 3:  'choose 1 keyword skill … and negate it' is mandatory; needs a field on negateChosenKeyword/negate (VM op + language + teach) — not reached.
PROBLEM:  "choose 1 keyword skill" is mandatory, but READS makes it "up to 1", so choosing none is allowed.
EXPECTED: choose 1 keyword skill of the attacking card, negate it for the turn
EVIDENCE: PRINTED: "Then, choose 1 keyword skill of the attacking card and negate it". READS: "choose up to 1 keyword skill of the attacking card and negate it for the turn"
VERIFIER: The negateChosenKeyword op always adds a "None" option (script.ts: "Up to 1 on every card printing this"). The printed "choose 1 keyword skill" is mandatory, but the engine lets the player decline. Low impact in practice, since you rarely want to decline, but the reading allows what the card does not.
### BT26-023#10 — and-vs-or (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [Activate: Battle][Limit 1]{r}, if your Leader's back side is a red <Super 17> card, you have 2 or more energy, and you have 1 or more <Android 17> card and 1 or more <Hell Fighter 17> card in your Combo Area: Play this card from your hand.
AUDITED:  if your leader's back side is Red <super 17> or <android 17> or <hell fighter 17>: choose this card, play the chosen cards  [trigger: ]
NOW:      if your leader's back side is Red <super 17> and there are 2 or more cards in your Energy Area and there are 1 or more <android 17> cards in your Combo Area and there are 1 or more <hell fighter 17> cards in your Combo Area: choose this card, play the chosen cards
ROUND 3:  Condition list (leader back side + energy + two Combo Area counts) — fixed on claude/audit-conditions-3 (lane C, compile/conditions.ts); not duplicated here.
PROBLEM:  Three AND conditions were merged into a single Leader name check with OR alternatives. The 2-energy check and the two Combo Area checks are gone, and the Leader may now be <Android 17> or <Hell Fighter 17>.
EXPECTED: Leader's back side is red <Super 17> AND 2 or more energy AND at least 1 <Android 17> and at least 1 <Hell Fighter 17> in your Combo Area (as BT26-022#10 reads).
EVIDENCE: PRINTED: "if your Leader's back side is a red <Super 17> card, you have 2 or more energy, and you have 1 or more <Android 17> card and 1 or more <Hell Fighter 17> card in your Combo Area". READS: "if your leader's back side is Red <super 17> or <android 17> or <hell fighter 17>".
VERIFIER: Confirmed. cond is a single leaderMatches with characters ['super 17','android 17','hell fighter 17'] (alternatives). The 2-energy condition and both Combo Area counts are gone, and an <Android 17> or <Hell Fighter 17> Leader now passes. Compare BT26-022#10, which compiles both Combo Area counts correctly.
### BT26-024#10 — and-vs-or (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [Activate: Battle][Limit 1]{r}, if your Leader's back side is a red <Super 17> card, you have 2 or more energy, and you have 1 or more <Android 17> card and 1 or more <Hell Fighter 17> card in your Combo Area: Play this card from your hand.
AUDITED:  if your leader's back side is Red <super 17> or <android 17> or <hell fighter 17>: choose this card, play the chosen cards  [trigger: ]
NOW:      if your leader's back side is Red <super 17> and there are 2 or more cards in your Energy Area and there are 1 or more <android 17> cards in your Combo Area and there are 1 or more <hell fighter 17> cards in your Combo Area: choose this card, play the chosen cards
ROUND 3:  Same as BT26-023 — fixed on claude/audit-conditions-3.
PROBLEM:  The same merge as BT26-023#10: the energy and Combo Area conditions are lost and the names become OR alternatives for the Leader.
EXPECTED: Leader's back side is red <Super 17> AND 2 or more energy AND at least 1 <Android 17> and at least 1 <Hell Fighter 17> in your Combo Area.
EVIDENCE: PRINTED: "if your Leader's back side is a red <Super 17> card, you have 2 or more energy, and you have 1 or more <Android 17> card and 1 or more <Hell Fighter 17> card in your Combo Area". READS: "if your leader's back side is Red <super 17> or <android 17> or <hell fighter 17>".
VERIFIER: Confirmed. The same mis-merged cond as BT26-023#10: the energy and Combo Area conditions are lost, and the extra names became Leader alternatives.
### P-468#20 — and-vs-or (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [Activate: Main][Limit 1] If your Leader is both a yellow <Vegeta> and <Trunks: Future> card and you discard this card from your hand: Choose up to 1 of your opponent's Battle Cards or Unisons with an energy cost of 2 or less and switch it to Rest Mode.
AUDITED:  if your leader is Yellow <vegeta> or <trunks: future>: choose up to 1 Battle Card or Unison Card with an energy cost of 2 or less in your opponent's Battle Area or Unison Area, switch the chosen cards to rest mode  [trigger: ]
NOW:      if your leader is Yellow <vegeta> or <trunks: future>: choose up to 1 Battle Card or Unison Card with an energy cost of 2 or less in your opponent's Battle Area or Unison Area, switch the chosen cards to rest mode
ROUND 3:  Leader 'both a yellow <Vegeta> and <Trunks: Future>' (charactersAll in a leader condition) — conditions; not reached.
PROBLEM:  PRINTED needs a Leader that is both <Vegeta> and <Trunks: Future>. READS accepts either name.
EXPECTED: if your leader is Yellow and has both <vegeta> and <trunks: future>
EVIDENCE: PRINTED: "If your Leader is both a yellow <Vegeta> and <Trunks: Future> card"; READS: "if your leader is Yellow <vegeta> or <trunks: future>"
VERIFIER: Category and-vs-or: confirmed. The stored Leader filter uses characters [vegeta, trunks: future], which matches either name; the engine's "both" form is charactersAll (as on P-424#10). PRINTED says "both a yellow <Vegeta> and <Trunks: Future> card".
### BT19-063#20 — merged-or-dropped-name (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [activate: main][limit 1]{u}, if you have 3 or more energy and a player has a <Son Gohan: SH> card in play: Play this card from your hand.
AUDITED:  if there are 3 or more <son gohan: sh> cards in your Energy Area: choose this card, play the chosen cards  [trigger: ]
NOW:      if there are 3 or more <son gohan: sh> cards in your Energy Area: choose this card, play the chosen cards
ROUND 3:  Condition list '3 or more energy and a player has <X> in play' (compile/conditions.ts, heavily changed by lane C this round) — not reached, left to avoid a conflicting rewrite.
PROBLEM:  Two conditions are merged into one wrong one: '3 or more energy' and 'a player has a <Son Gohan: SH> in play' became '3 or more <Son Gohan: SH> cards in your Energy Area'.
EXPECTED: 3 or more cards in your Energy Area AND either player has a <Son Gohan: SH> card in play.
EVIDENCE: PRINTED: "if you have 3 or more energy and a player has a <Son Gohan: SH> card in play"; READS: "if there are 3 or more <son gohan: sh> cards in your Energy Area"
VERIFIER: The stored cond is count(your energy with characters [son gohan: sh]) >= 3. '3 or more energy' and 'a player has a <Son Gohan: SH> in play' were merged into a near-impossible energy check, and the either-player in-play check is lost.
### BT19-064#20 — merged-or-dropped-name (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [activate: main][limit 1]{u}, if you have 3 or more energy and a player has a <Piccolo: SH> card in play: Play this card from your hand.
AUDITED:  if there are 3 or more <piccolo: sh> cards in your Energy Area: choose this card, play the chosen cards  [trigger: ]
NOW:      if there are 3 or more <piccolo: sh> cards in your Energy Area: choose this card, play the chosen cards
ROUND 3:  Same as BT19-063 — not reached.
PROBLEM:  Same merge as BT19-063#20, with <Piccolo: SH>.
EXPECTED: 3 or more energy AND either player has a <Piccolo: SH> card in play.
EVIDENCE: PRINTED: "if you have 3 or more energy and a player has a <Piccolo: SH> card in play"; READS: "if there are 3 or more <piccolo: sh> cards in your Energy Area"
VERIFIER: Same merge as BT19-063#20: count(your energy <piccolo: sh>) >= 3.
### BT19-112#30 — merged-or-dropped-name (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [activate: main]{y}{y}{y}, if you have 4 or more energy and there are 2 <Lord Slug> cards with combo costs of 1 in your Z-Energy―1 with an energy cost of 3 and 1 with an energy cost of 5: Play this card from your hand.
AUDITED:  if there are 4 or more <lord slug> cards with an energy cost of 3 with a combo cost of 1 in your Energy Area: choose this card, play the chosen cards  [trigger: ]
NOW:      if there are 4 or more <lord slug> cards with an energy cost of 3 with a combo cost of 1 in your Energy Area: choose this card, play the chosen cards
ROUND 3:  Condition merge with a Z-Energy pair of <Lord Slug> cards — conditions; not reached.
PROBLEM:  The conditions are merged into '4 or more <Lord Slug> cost-3 cards in your Energy Area'. The '4 or more energy' count, the Z-Energy area and the second (cost-5) Lord Slug are all lost.
EXPECTED: 4+ cards in Energy Area AND in Z-Energy one <Lord Slug> (combo cost 1, energy cost 3) and one <Lord Slug> (combo cost 1, energy cost 5).
EVIDENCE: PRINTED: "if you have 4 or more energy and there are 2 <Lord Slug> cards with combo costs of 1 in your Z-Energy―1 with an energy cost of 3 and 1 with an energy cost of 5"; READS: "if there are 4 or more <lord slug> cards with an energy cost of 3 with a combo cost of 1 in your Energy Area"
VERIFIER: The stored cond is count(your energy: <lord slug>, cost 3, combo cost 1) >= 4. The '4 or more energy' count, the Z-Energy area and the cost-5 Lord Slug are all lost.
### BT19-113#30 — merged-or-dropped-name (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [activate: main][limit 1]{y}{y}, if you have 3 or more energy and a <Lord Slug> card with an energy cost of 3 and combo cost of 1 in your Z-Energy: Play this card from your hand.
AUDITED:  if there are 3 or more <lord slug> cards with an energy cost of 3 with a combo cost of 1 in your Energy Area: choose this card, play the chosen cards  [trigger: ]
NOW:      if there are 3 or more <lord slug> cards with an energy cost of 3 with a combo cost of 1 in your Energy Area: choose this card, play the chosen cards
ROUND 3:  Condition merge '3 or more energy and a <Lord Slug> … in your Z-Energy' — conditions; not reached.
PROBLEM:  Same merge: '3 or more energy' and 'a <Lord Slug> in your Z-Energy' became '3 or more <Lord Slug> cards in your Energy Area'.
EXPECTED: 3+ cards in Energy Area AND 1+ <Lord Slug> (energy cost 3, combo cost 1) in Z-Energy.
EVIDENCE: PRINTED: "if you have 3 or more energy and a <Lord Slug> card with an energy cost of 3 and combo cost of 1 in your Z-Energy"; READS: "if there are 3 or more <lord slug> cards …in your Energy Area"
VERIFIER: The stored cond is count(your energy: <lord slug>, cost 3, combo cost 1) >= 3. '3 or more energy' and 'a Lord Slug in Z-Energy' were merged into one wrong check.
### BT19-080#20 — wrong-area (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [auto] When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost of 6 or less, KO it, and this card gets +5000 power for the turn. Additionally, if you have at least 1 <Son Goku: Br> card and 1 <Vegeta: Br> card in your Z-Energy, draw 1 card.
AUDITED:  choose up to 1 Battle Card with an energy cost of 6 or less in your opponent's Battle Area, KO the chosen cards, this card +5000 power for the turn, if there are 1 or more <son goku: br> cards you have in play: choose 1 <Vegeta: Br> card in your Z-Energy Area, draw 1  [trigger: played]
NOW:      choose up to 1 Battle Card with an energy cost of 6 or less in your opponent's Battle Area, KO the chosen cards, this card +5000 power for the turn, if there are 1 or more <son goku: br> cards you have in play: choose 1 <Vegeta: Br> card in your Z-Energy Area, draw 1  [trigger: played]
ROUND 3:  'at least 1 <A> and 1 <B> in your Z-Energy' read as a play check plus a choice — conditions; not reached.
PROBLEM:  The 'Additionally' clause checks <Son Goku: Br> in play instead of in Z-Energy. The <Vegeta: Br> requirement becomes a 'choose 1' instead of a condition.
EXPECTED: If you have at least 1 <Son Goku: Br> and 1 <Vegeta: Br> in your Z-Energy, draw 1.
EVIDENCE: PRINTED: "if you have at least 1 <Son Goku: Br> card and 1 <Vegeta: Br> card in your Z-Energy, draw 1 card"; READS: "if there are 1 or more <son goku: br> cards you have in play: choose 1 <Vegeta: Br> card in your Z-Energy Area, draw 1"
VERIFIER: The stored ops: if count(play <son goku: br>) >= 1, then choose 1 <Vegeta: Br> in Z-Energy, then draw. The Son Goku check is in the wrong area (play instead of Z-Energy). Vegeta is a selection, not a condition, so the draw is not gated on it.
### BT19-145#30 — wrong-count (high, behaviour) — STILL MISREAD (reading unchanged since the audit)
PRINTED:  [activate: main][once per turn] If you have 5 or more Z-Energy or 2 or more Z-Battle Cards in play: Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or more, ignoring [barrier], and place it at the bottom of its owner's deck.
AUDITED:  if there are 5 or more cards in your Z-Energy Area, or there are 5 or more Z-Battle Cards in your Battle Area: choose up to 1 Battle Card with an energy cost of 3 or more in your opponent's Battle Area ignoring [Barrier], move the chosen cards to deck  [trigger: ]
NOW:      if there are 5 or more cards in your Z-Energy Area, or there are 5 or more Z-Battle Cards in your Battle Area: choose up to 1 Battle Card with an energy cost of 3 or more in your opponent's Battle Area ignoring [Barrier], move the chosen cards to the bottom of the deck
ROUND 3:  Or-condition's second count (5 instead of 2 Z-Battle Cards) — conditions; not reached.
PROBLEM:  READS requires 5 or more Z-Battle Cards for the second alternative. The card says 2.
EXPECTED: if 5 or more cards in your Z-Energy Area, or 2 or more Z-Battle Cards in your Battle Area
EVIDENCE: PRINTED: "If you have 5 or more Z-Energy or 2 or more Z-Battle Cards in play"; READS: "there are 5 or more Z-Battle Cards in your Battle Area"
VERIFIER: The stored condition is any(count zEnergy >= 5, count your Battle Area Z-Battle Cards >= 5). The printed second alternative is 2 or more Z-Battle Cards, so with 2-4 Z-Battle Cards and fewer than 5 Z-Energy the skill is wrongly refused. The fresh compile and the store agree (UP-TO-DATE), so the error is in the record.

## Round 3 reviewer's open doubts (6)

- **BT2-048#0 (and DB1-093#20, same wording)** — Not repaired. 'Choose 1 keyword skill … and negate it' still offers 'None'. The exact pick needs a field on negateChosenKeyword, which is a macro over negate with a DEFINE OP in both rulesets (dbs and fusion ops.rules plus the generated files.ts), so it is not a contained change. Low impact: the player can decline a negation they would normally take.
- **BT12-005#0, BT12-006#10, BT12-009#10, BT12-010#10** — Pre-existing scope issue the fix agent's change kept. 'If you didn't play a card, place this face-up card in your Drop Area' is nested inside the 'you may'. If the player pays {r}{r} and then declines the offer, the card stays face up in the life instead of going to the Drop. Rare in practice, since a player who will not play it does not pay.
- **BT7-094#10 (alreadyFixed)** — Now reads '<goku black> cards you have in play', which takes in the Unison Area as well as the Leader and Battle Areas the card prints. This only over-reads if a <Goku Black> Unison exists.
- **P-487#10** — Out of lane (lane E's finding), but its describer line changed here ('all' to 'a'). This [Auto] ('when one of your green <Vegeta> cards with [blocker] and without ≪Great Ape≫ is removed…, play this card') is stored as a replacement on '≪great ape≫' cards. Its trait and kind are both wrong. Check lane E's branch.
- **EX06-31#0, P-268, TB2-065** — Both-players readings still rest on pending owner rulings R-321 and R-323. EX06-31 has no Q&A.
- **BT21-075#10, BT21-090#0, BT21-091#20** — The 'or 1 Earthling Token' alternative is read as the opponent's token, carrying 'your opponent's' over from the first description; P-507 prints 'of their' outright. These three have no Q&A.

## Round 3 reviewer's code notes (5)

- The fix agent's report left 8 findings from lane4-S.md unaccounted for: BT2-048, P-645, BT14-153, P-093, BT18-008, BT21-118, DB3-023, DB3-129. They were in none of fixed, alreadyFixed, rejected or madeUnread. All are now repaired or made unread, except BT2-048, which is reported as a doubt.
- Price and effect choices share the variable namespace: the price's choose and the effect's first choose are both 'c0'. Any effect that refers back to a price choice after making its own choice can lose the price card. This is fixed only for the 'all of the chosen cards' wording (and the earlier pricePlacedUnder case); a general renumbering of the effect's names after the price's would be safer at integration.
- Contract fixtures effect-language.txt and language-reference.txt were rewritten for the two new schema fields (forbid.attacker, countering.of). A scratch script outside the repo wrote only those two files, with the same text contract:emit would produce; contract:emit itself was not run. language.ts passes. Integration's --emit will overwrite them, so a merge conflict there is harmless.
- Pre-existing lint warning (not from this branch): SAME_CHARACTER_AS_PLACED is imported and unused in compile/effects.ts.
- The fix agent's code otherwise held up. No card-id special cases in the compiler. The glossary was updated in both of its commits. R-320 to R-322 are all in the ledger. Its suite tests behaviour rather than restating the code: type, side and area of the selectors, plus VM cases for the Drop cost change, [Swap] and TB1-015.

## Round 3 fix agent's "left" list, with reasons (18)

- BT26-023#10: Condition list (leader back side + energy + two Combo Area counts) — fixed on claude/audit-conditions-3 (lane C, compile/conditions.ts); not duplicated here.
- BT26-024#10: Same as BT26-023 — fixed on claude/audit-conditions-3.
- BT19-063#20: Condition list '3 or more energy and a player has <X> in play' (compile/conditions.ts, heavily changed by lane C this round) — not reached, left to avoid a conflicting rewrite.
- BT19-064#20: Same as BT19-063 — not reached.
- BT19-112#30: Condition merge with a Z-Energy pair of <Lord Slug> cards — conditions; not reached.
- BT19-113#30: Condition merge '3 or more energy and a <Lord Slug> … in your Z-Energy' — conditions; not reached.
- BT19-145#30: Or-condition's second count (5 instead of 2 Z-Battle Cards) — conditions; not reached.
- P-468#20: Leader 'both a yellow <Vegeta> and <Trunks: Future>' (charactersAll in a leader condition) — conditions; not reached.
- BT19-080#20: 'at least 1 <A> and 1 <B> in your Z-Energy' read as a play check plus a choice — conditions; not reached.
- BT2-048#0: 'choose 1 keyword skill … and negate it' is mandatory; needs a field on negateChosenKeyword/negate (VM op + language + teach) — not reached.
- BT14-153#30: 'gain control of' an opponent's Unison must land in your Unison Area with 21-11's replacement; compiled as a move to Battle — VM work, not reached.
- BT18-008#20: 'the Z-Battle Card' this card was placed under should bind onTop on a placedUnder moment — not reached.
- BT21-118#10: 'all of the chosen cards' must include the price's two rested energy (official Q&A) — not reached.
- DB3-023#0: [Blocker] ban must be scoped to the chosen card's attack (forbid block + attacker scope) — not reached.
- DB3-129#10: Negate the opponent's [Counter: Attack] being answered, not one of your Battle Cards — not reached.
- P-093#20: Skill ban scope (Battle Area only; combo [Auto]s allowed per official Q&A) — not reached.
- P-645#10: 'in Active Mode or Rest Mode' play choice — not reached.
- lane4-S-unread.md (278 skills, 256 clusters): Unread selector families not reached this round (context budget spent on the 72 findings).

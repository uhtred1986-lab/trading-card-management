# Lane E (effects), round 4 — what round 3 left

From round 3's fix agent and adversarial reviewer (integration 4, #1246). Check each item against the printed text and the current reading (`npm run arena:compile-snapshot` on a fresh snapshot) before working it: some may have been fixed in passing.

## Audit findings still misread (0)

Confirmed misreads from the readings audit of 2 Nov 2026 that three rounds have not fixed and that are still read (so they play wrongly). PRINTED is the card, AUDITED the reading the audit saw, NOW the reading on main at #1246, ROUND 3 why round 3 left it.

(none)

## Round 3 reviewer's open doubts (6)

- **BT10-063#10 (rejected by the fix agent)** — The official answers conflict. BT10-063's own Q&A ('your opponent attacks with a Battle Card and the card that attacked is placed in its owner's Drop Area. Can you activate a [Counter: Attack]? No') most naturally describes the attacker paying its own tax. BT11-034's answer for the same tax ('can your opponent choose that card [the attacker] and place it on the bottom of its owner's deck? No') forbids that explicitly. The research order ranks the card's own Q&A first, but that answer is implicit. I left the reading as is (attacker excluded) because allowing it needs an engine check that the attack ends cleanly. The owner should rule on it.
- **BT1-081#0 / #10 (rejected by the fix agent)** — The rejection is correct: #0 is the [Field] reminder and #10 is honestly unread. 'Your hand is not affected by your <Broly> Leader Card's skill' still needs a zone-level immunity, which is not built.
- **EX13-009 Q&A vs vm/unique.ts [Unique] (keyword lane)** — The fix cites EX13-009's Q&A ('a copy played beside one whose skills are negated … is considered [Unique], so you choose 1') for the 21-11-2 wording, where any copy now counts. For [Unique] itself, group() still counts only cards with [Unique] in force (RM 22-39-4), and the Q&A contradicts that. This predates the round and was not changed here.
- **P-119#0, P-389#20** — Not addressed this round. {A King's Return to Youth} (BT5-025) and {Dragon Balls, Negative Energy Overflow} (BT8-137) are non-[Field] Extras, so the 'activate it from your deck' fallback still plays them into the Battle Area. This is a misread carried over from round 2.
- **BT2-047#10, BT2-055#0** — Correct per BT2-047's Q&A, but the program holds a duplicate forbid beKOdBySkill. 'Can't be removed' already adds the KO ban beside the printed 'cannot be KO'd', so the reading repeats 'can't be KO'd'. Harmless in play; cosmetic.
- **P-263#20 (takeDamage on the Leader)** — A Leader-target takeDamage ban also refuses a skill's damage, because the damage op passes the Leader as card. 'Your Leader Card doesn't take damage for the battle' is probably meant for the battle's damage only. The difference only shows if a skill deals damage during that battle.

## Round 3 reviewer's code notes (6)

- compile/effects.ts oneAreaOfTwo (fix): BARE_OR_AREAS matched 'from' as well as 'in'. This was over-broad against BT6-126's official answer; repaired. The remaining exclusions ('each', 'and/or', 'total', 'any areas' anywhere in the effect) only keep a choice pooled (the base behaviour), so over-matching is harmless.
- vm/unique.ts OWN_LIMIT (fix): the [^.] class broke on names containing a full stop (BT8-016, BT8-057); repaired.
- vm/script.ts skip case (fix): the comment 'Audit effects 3: "rest" … the host ends its Main Phase now' sits above the `span` branch rather than the `rest` path. The code is correct (rest goes through h.addSkip to host.addSkip). Left as is, so as not to touch a vm file for a comment.
- compile/effects.ts (fix): `return compileNoDamage(t, c)` short-circuits compileClauseRead for any clause containing "doesn't take damage". An unmatched form becomes unread instead of reaching later readers. The corpus shows no regression; noted for future wordings.
- compile/effects.ts compileNoDamage (fix): `later` looks for a span at the end of the first sentence of c.raw that mentions 'take damage'. That is fine for every current card, but it would take another sentence's span if a line held two such sentences.
- Integration (from the fix agent's notes, still true): contract:emit is needed (SKIP_WHATS 'rest', FORBIDDEN_IN_WORDS 'takeDamage', skillKind 'activate:main/battle'), and language.ts fails until the fixture is re-emitted. I did not run language.ts. A full card_rules refresh is needed for the 24 changed readings and for the 9 silent orb-price changes (BT27-140, BT31-124, BT31-129, BT31-134, BT31-136, BT31-137, BT31-151, DB3-141, DB3-142). The 8 deck-or-Drop searches and BT6-126 now equal the base, so they need no refresh. BT8-016 and BT8-057 change in play without a record change.

## Round 3 fix agent's "left" list, with reasons (9)

- BT19-074#10: 'the first Extra you activate from under one of your <Broly: Br> cards' needs activation of an Extra from under a card, which the engine lacks. The BT19-093/095/096/097/098/099, BT21-048 and BT23-098 'as if it were in your hand' permissions are unread for the same reason. Not a contained addition.
- BT19-089#20: Same as BT19-074 (activate-from-under).
- P-723#10: 'Activate up to 1 [Activate: Battle] skill on a red Extra … by paying its skill cost' needs an invocation that charges the skill cost mid-resolution. invokeSkill waives the printed price (12-2-4), and there is no payment prompt inside a resolution. Still unread.
- BT7-042#0: No change needed. The '(end if)' layout reads oddly, but both branches ask about the revealed card (varMatches and chose are false when nothing was revealed), so the play is the nested one the text says.
- R-200 family: Audited against RM 1-7-2-2. Every [Auto]/[Activate]/[Counter] effect that prints no span and is still read as 'for the turn' falls in one of two groups, and in neither does the span change anything in play. Group 1: a negation followed at once by a KO or a move out of play (BT9-120#30, BT23-135#30, BT23-081#0, P-454#20, P-493#0, EX23-28#30, BT9-104#20, EX10-03#0b). Group 2: BT2-069#10b, whose player loses at the end of the turn. No code change.
- BT16-070#0, BT15-141#10, BT11-105#20, BT13-150#0: The damage family's leftovers stay honestly unread: 'from non-keyword skills' (the damage op cannot tell the line kind), the 'whichever comes first' span, Unison marker damage, and a bare [Strike] keyword-family filter.
- DB3-138#10, DB3-141#20, DB3-142#20, BT27-140#10: Their prices are now right (errata). 'Choose up to X …' needs a selector count of X, which Selector.count (number) cannot hold. Still unread.
- BT27-069#0: '[Z-Stack 1](X), Z-Card with a Z-Energy cost of X or less' was left untouched. What the bracketed X means on a [Z-Stack] line is unclear.
- unread effect clusters (lane4-E-unread.md): Not reached beyond the families above (about 380 clusters, mostly singletons). The largest remaining mechanism groups are: activate-from-under/energy/drop permissions (about 14); quoted 'gains the following skill' grants whose granted [Auto] moment is unread (P-544, BT29-102, BT26-001b, BT20-120, BT31-022, BT24-084, BT22-080); X-count selectors; 'shares a character name with this card' (BT15-153/154); 'can only be played from Energy Areas' (BT6-035/037).

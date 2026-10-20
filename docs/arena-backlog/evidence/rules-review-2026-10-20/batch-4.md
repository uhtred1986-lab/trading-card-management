# Rules review, 20 Oct 2026, batch 4: next 30 deck cards

Authorization: owner, 18 Oct 2026 ("You have full permission to write into the db in production without further asking from me") and
20 Oct 2026 ("continue the review with the next 30 unchecked deck cards"). Writes went only through the repo's guarded paths:
`confirmRule` / `flagRule` (`src/lib/rules-review/deck-review.ts`, attribution `claude-review`) and one `saveRule`
(`src/lib/arena/rules-store.ts`) for the draft fix. No ad hoc SQL, no owner-confirmed or owner-corrected row touched, no P-616, no errata edit,
BT29-040 front 10 and BT2-001 front 10 (the owner reviews those) not touched. The database was proven to be this app's first
(`to_regclass('public.card_rules')` = `card_rules`). Lessons of batches 2 and 3 applied: the one `saveRule` passed the row's existing
`ops`, `cond`, `trigger`, `combo`, `usage`, `validity` explicitly and the row was re-read and compared afterwards (only `cost.condition` differs); no `arena:rule` call was needed.

## Selection

Owner `patvolny` plus ownerless decks, game `dbs`, not testing (25 decks); cards whose health is `unchecked` (117), ordered by deck count then id,
skipping the 90 cards of the three earlier receipts (BT7-023 is still the Claude-authored row skipped in batch 1). Every remaining card is in one deck, so the order is by id:
BT3-040, BT3-041, BT3-042, BT3-045, BT3-046, BT3-047, BT3-048, BT3-049, BT3-050, BT3-052, BT3-054, BT3-055, BT3-058, BT3-061, BT3-062, BT3-082, BT3-086, BT3-087, BT3-091, BT3-092, BT3-093, BT3-095, BT3-100, BT3-105, BT3-106, BT3-112, BT30-019, BT30-082, BT30-095, BT30-097.
Keyword-line rows (Critical, Blocker, Barrier, Evolve, Dual Attack, Super Combo, Over Realm, Field, Triple Strike, ...; 17 draft rows on these cards) are health `done` and were left alone.
[Awaken] and [Union-Absorb] lines are compiler rows with a program and were reviewed.

Basis order as before: official Q&A (`faq.generated.json`); official errata (none of these 30 cards is listed; `errata.ts` holds only the BT3-104 typo); Rule Manual / glossary
and the repo's engine proofs (`qualified-movement-evolve-825.ts`, `union-sources-930.ts`, `battles.ts`, `wordings.ts`, `compiler.ts`); Try it boards (`tryRule(probeRuleOf(...))`);
plus throwaway engine proofs on the **stored rows** (real catalog text, `rulesFromRows`, staged boards, answers given in every order that matters), because on many of these the probe cannot reach the moment.

## Totals

**45 rows on 30 cards: 42 confirmed, 3 flagged (1 of them with a Claude draft fix saved), 0 skipped.** 1 draft fix (BT30-082 front 10).

## Per row (45 rows)

| Card | Skill | Printed (short) | Verdict | Basis |
|---|---|---|---|---|
| BT3-040 Majin Defier, South Supreme Kai | f10 | [Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or | confirmed | Try it fires; engine proof 20 Oct: on attack returns a cost <= 3 opposing Battle Card to its owner's hand (a cost 5 card is not offered); official Q&A: only Battle Areas. |
| BT3-041 Majin Defier, North Supreme Kai | f10 | [Auto] When you play this card, choose up to 1 ≪God≫ in your Battle Area with an energy cost of 3 or less | confirmed | engine proof 20 Oct: on play offers only <God> Battle Cards of cost <= 3 in the Battle Area and switches the chosen one to Active Mode (a cost 4 <God> is not offered). |
| BT3-042 Kibito, Kai's Attendant | f0 | [Activate: Main] Switch this card to Rest Mode: Choose 1 of your Battle Cards and return it to your hand. | confirmed | engine proof 20 Oct: Rest Mode as the price, returns 1 of your Battle Cards, then up to 1 opposing cost <= 3 Battle Card to its owner's hand (cost 5 not offered); Try it 'cannot pay' is a probe artefact (card staged in hand). |
| BT3-045 Agent of Resurrection, Babidi | f0 | [Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1 <Majin Bu | confirmed | Try it fires; engine proof 20 Oct: look 3, only <Majin Buu> offered, up to 1 to hand, shuffle (official Q&A reveal is log-level, as BT4-089). |
| BT3-046 Magician's Father, Bibidi | f0 | [Permanent] All of the <Majin Buu> in your Battle Area gain [Barrier] . | confirmed | engine proof 20 Oct: <Majin Buu> cards in the Battle Area gain [Barrier]; other cards and this card (a Bibidi) do not. |
| BT3-046 Magician's Father, Bibidi | f10 | [Auto] When you play this card, choose up to 1 {Out of Control Evil, Majin Buu} from your deck and play i | confirmed | engine proof 20 Oct: plays {Out of Control Evil, Majin Buu} from the deck for no energy (official Q&A: skill plays pay nothing), then shuffles. |
| BT3-047 The Ultimate Evil, Majin Buu | f20 | [auto] When a card evolves into this card, switch this card to Active Mode, and it gains +30000 power for | confirmed | engine proof 20 Oct: after [EX-Evolve] it is Active and 30000 higher; official Q&A: this auto activates when played with [EX-Evolve]. |
| BT3-048 Out of Control Evil, Majin Buu | f0 | [union absorb]{u},place 1 Battle Card from your hand under this card: Choose up to 1 blue <Majin Buu> wit | confirmed | [Union-Absorb]: engine proof 20 Oct on the stored row (hand Battle Card under, a blue <Majin Buu> cost 5 from the deck on top, both under it) and union-sources-930.ts, which names BT3-048. |
| BT3-049 Power Absorbing Majin Buu | f20 | [activate: main] [once per turn] Choose 1 <South Supreme Kai> under this card: Gain all of the chosen car | confirmed | engine proof 20 Oct: offered only with a <South Supreme Kai> under it, gains its keyword (Critical) for the turn, once per turn; glossary 20-18 (copySkills); official Q&A: all skills include keyword skills. |
| BT3-050 Majin Buu, Dawn of the Rampage | f0 | [union absorb] {2},place 1 Battle Card from your hand under this card: Choose up to 1 {Awakening Evil Maj | confirmed | [Union-Absorb]: engine proof 20 Oct on the stored row ({2} and a hand Battle Card under, {Awakening Evil Majin Buu} from the deck on top, shuffle) and union-sources-930.ts. The probe break is a staging artefact. |
| BT3-050 Majin Buu, Dawn of the Rampage | f20 | [permanent] When this card is under a card, the <Majin Buu> on top of this card gains [barrier]. | **flagged** | wrong in the engine (20 Oct review, engine proof): a [Permanent] on a card under another card is never applied. After [Union-Absorb] puts BT2-027 on top of BT3-050, BT2-027 (a <Majin Buu>) does not gain [Barrier]. Permanents are read only from cards in zones (vm/effects.ts), a pile is no zone. Needs engine work. |
| BT3-052 The Most Evil Absorption in History | f0 | [Activate: Main] If your Leader Card is <Majin Buu>, choose 1 of your <Majin Buu> and 1 of your opponent' | confirmed | engine proof 20 Oct: with a <Majin Buu> Leader buries the chosen opposing Battle Card under the chosen <Majin Buu>; another Leader does nothing; battles.ts pins the two-choice reading for BT3-052/054; official Q&A (pile goes to the original owner's Drop). |
| BT3-054 Buu Make You Cookie | f0 | [Counter: Attack] Negate the attack. Then, if your Leader Card is <Majin Buu>, you may place 1 card from  | confirmed | engine proof 20 Oct: negates; with a <Majin Buu> Leader and a hand card to the Drop, buries a cost <= 3 opposing Battle Card under the chosen <Majin Buu>; no discard or burial with another Leader; battles.ts. |
| BT3-055 Vegito | f0 | [Auto] When this card attacks a Leader Card, draw 1 card. | confirmed | engine proof 20 Oct on the real Leader: draws 1 when it attacks the Leader, not when it attacks a Battle Card. |
| BT3-055 Vegito | f10 | [Awaken] When your life is at 4 or less: You may choose up to 2 of your energy, switch them to Active Mod | confirmed | [Awaken]: engine proof 20 Oct: offered at life 4 even with every energy Active (official Q&A), not at life 5; flips the Leader. |
| BT3-055 Vegito | b0 | [Permanent] During your turn, if your opponent has no Battle Cards in their Battle Area, this card gains  | confirmed | engine proof 20 Oct on the flipped Leader: on your turn with no opposing Battle Cards +5000 and [Double Strike]; not with 1 Battle Card, not on the opponent's turn. |
| BT3-055 Vegito | b10 | [Auto] When this card attacks, draw 1 card. Then, if your opponent has 2 or less Battle Cards, this card  | confirmed | engine proof 20 Oct on the flipped Leader: draws 1 on attack and gains +5000 only while the opponent has 2 or fewer Battle Cards. |
| BT3-058 Pressure Assault Super Saiyan Son Goku | f10 | [Auto] When you play this card, choose up to 1 of your opponent's Battle Cards. KO that card. | confirmed | Try it KOs the chosen opposing Battle Card; engine proof 20 Oct (KO of a cost 5 card). |
| BT3-061 Unyielding Justice SS2 Trunks | f30 | [auto] When a card evolves into this card, draw 1 card. | confirmed | engine proof 20 Oct: evolving into it draws 1 (evolvedInto moment, same as BT3-004). |
| BT3-062 Trunks, Bridge to the Future | f0 | [Auto] When you play this card, look at up to 2 cards from the top of your deck. Choose up to 1 ≪Saiyan≫  | confirmed | engine proof 20 Oct: look 2, up to 1 <Saiyan> to hand, the rest to the Drop; wordings.ts pins 'the rest' (BT3-062); official Q&A (reveal) is log-level. |
| BT3-082 Bardock | f0 | [Auto] When this card attacks a Leader Card, draw 1 card. | confirmed | engine proof 20 Oct on the real Leader: draws 1 when it attacks the Leader, not a Battle Card. |
| BT3-082 Bardock | f10 | [Awaken] When your life is at 4 or less: You may choose up to 2 of your energy, switch them to Active Mod | confirmed | [Awaken]: engine proof 20 Oct: offered at life 4 with every energy Active (official Q&A), not at life 5; flips the Leader. |
| BT3-082 Bardock | b0 | [Auto] When this card attacks, draw 1 card. | confirmed | engine proof 20 Oct on the flipped Leader: draws 1 whenever it attacks. |
| BT3-082 Bardock | b10 | [Auto] [Once per turn] When your ≪Saiyan≫ is KO'd, this card gains +5000 power for the duration of the tu | **flagged** | wrong in the engine (20 Oct review, engine proof): the <Saiyan> restriction is an IF, the trigger is any of your cards KO'd, so a non-<Saiyan> KO uses up the once-per-turn (usedThisTurn [10]) and a <Saiyan> KO'd later the same turn gives no +5000. The base case (Saiyan KO'd: +5000 once) is right. Needs a typed KO qualification (engine work). |
| BT3-086 Striker Bardock | f10 | [Auto] When you play this card, if your Leader Card is a ≪Saiyan≫, look at up to the top 3 cards of your  | confirmed | engine proof 20 Oct: with a <Saiyan> Leader look 3, choose 1 to hand, the rest to the Drop; nothing with another Leader (official Q&A: no reveal needed). |
| BT3-087 Gine, Family of Justice | f10 | [Permanent] If you have <Bardock> in your Battle Area or Leader Area, you can play this card from your ha | confirmed | engine proof 20 Oct: playable for no energy while a <Bardock> is in play (Leader included), not otherwise; compiler.ts pins the wording. |
| BT3-091 Kakarot, the Child Who Got Away | f0 | [Auto] At the end of the battle after you combo with this card, if your Leader Card is a yellow ≪Saiyan≫, | confirmed | engine proof 20 Oct: after a combo with a yellow <Saiyan> Leader it goes to the deck bottom, otherwise it stays in the Drop; returned to hand mid-battle it stays in hand (official Q&A, Jaco). |
| BT3-092 Absolute Defense Great Ape King Vegeta | f20 | [permanent] All yellow ≪Saiyan≫ cards in your Battle Area gain [barrier] . | confirmed | engine proof 20 Oct: yellow <Saiyan> cards in the Battle Area gain [Barrier]; red Saiyans and yellow non-Saiyans do not. |
| BT3-092 Absolute Defense Great Ape King Vegeta | f30 | [permanent] Reduce the combo cost of all ≪Saiyan≫ cards in your hand by 1. | confirmed | engine proof 20 Oct: <Saiyan> cards in hand have combo cost 1 less; a combo cost of 0 stays 0 (official Q&A); non-Saiyans unchanged. |
| BT3-093 Lord of the Great Apes, King Vegeta | f0 | [Auto] When you play this card, choose up to 1 ≪Great Ape≫ with an energy cost of 5 or less from your dec | confirmed | Try it fires; engine proof 20 Oct: offers only <Great Ape> cards of cost <= 5 from the deck, adds 1 to hand, shuffles (official Q&A: reveal is log-level). |
| BT3-095 Youthful Bulma | f0 | [Auto] When you play this card, draw 1 card. | confirmed | Try it and engine proof 20 Oct: draws 1 when played. |
| BT3-100 Unwavering Solidarity Shugesh | f10 | [Auto] When you combo with this card, if your Leader Card is yellow and your life is at 4 or less, this c | confirmed | engine proof 20 Oct: with a yellow Leader at life 4 the combo gets +10000 combo power and plays a <Saiyan> of cost <= 3 from hand (a cost 4 one not offered); nothing at life 5 or with another Leader; glossary 'Then' reading. |
| BT3-105 Planet Vegeta | f10 | [Auto] At the end of your turn, switch all ≪Great Ape≫ in your Battle Area to Active Mode. | confirmed | engine proof 20 Oct: at the end of your turn every <Great Ape> in the Battle Area switches to Active, other cards stay Rest. |
| BT3-105 Planet Vegeta | f20 | [Auto] When this card is placed in your Battle Area, choose up to 1 ≪Saiyan≫ with an energy cost of 4 or  | confirmed | engine proof 20 Oct: playing the [Field] places it in the Battle Area and the auto offers a <Saiyan> of cost <= 4 from the deck to hand, then shuffle. |
| BT3-106 March of the Great Ape | f0 | [Activate: Main] Choose up to 2 ≪Great Ape≫ cards with energy costs of 4 or less from your hand and play  | confirmed | engine proof 20 Oct: plays up to 2 <Great Ape> of cost <= 4 from hand (cost 5 not offered) for no energy, then draws 2; official Q&A: the draw happens even if none are played. |
| BT3-112 Unrelenting Assault Trunks | f10 | [Auto] When this card is sent to the Warp from your Battle Area or deck, add it to your hand. | confirmed | qualified-movement-evolve-825.ts runs BT3-112 on the engine (sent to the Warp from the Battle Area or deck, added to hand; official Q&A: also by an opponent's skill); the probe has no board for this moment. |
| BT30-019 Son Goku, Adventure Partner | f10 | [auto] When this card is played, choose up to 1 of your opponent's Battle Cards and place it at the botto | confirmed | Try it: the chosen opposing Battle Card goes to the bottom of its owner's deck; the stored move is position bottom. |
| BT30-019 Son Goku, Adventure Partner | f20 | [activate: main/battle] Place 1 of your energy into its owner's Drop: Switch this card to Active Mode. | confirmed | engine proof 20 Oct: offered on the Battle Area card, places 1 energy in the Drop as the price and switches this card to Active Mode; Try it 'cannot pay' is a probe artefact (card staged in hand). |
| BT30-082 Brianne De Chateau | f0 | [activate: main][once per turn] Send the top 2 cards of your deck to your Warp, then discard 1 ≪Maiden Sq | confirmed | engine proof 20 Oct on the real Leader: top 2 to the Warp and a <Maiden Squadron> discarded as the price, draw 2, once per turn; not offered without a <Maiden Squadron> in hand. |
| BT30-082 Brianne De Chateau | f10 | [awaken] When your life is at 4 or less, or you have 2 or more energy and {Support Broadcast} in your Bat | **flagged** | misread (20 Oct review): printed 'or you have 2 or more energy and {Support Broadcast} in your Battle Area' was read as 2+ {Support Broadcast} cards in the Energy Area. Claude draft fix v3 saved: 2+ cards in the Energy Area AND a {Support Broadcast} in the Battle Area. Engine proof on the stored row: offered at life 6 with 2 energy + Support Broadcast in play; not with 1 energy, none, or only in Energy Area. Owner to approve. |
| BT30-082 Brianne De Chateau | b0 | [auto] When this card attacks, draw 2 cards, send 1 card from your hand to its owner's Warp, then place u | confirmed | engine proof 20 Oct on the flipped Leader: on attack draws 2, sends 1 hand card to the Warp, then up to 1 black <Maiden Squadron> from the Warp goes to the bottom of the deck. |
| BT30-082 Brianne De Chateau | b10 | [activate: main/battle][once per turn] Send 2 ≪Universe 2≫ cards from your Drop to their owner's Warp: Pl | confirmed | engine proof 20 Oct on the flipped Leader: 2 <Universe 2> from the Drop to the Warp as the price, plays a black <Maiden Squadron> of cost 2 from hand (cost 3 and red not offered), once per turn; not offered with 1 in the Drop. |
| BT30-095 Ribrianne, Witchy Warrior | f10 | [auto] Choose 1 {Support Broadcast} in your Battle Area and switch it to Rest Mode: When this card is pla | confirmed | engine proof 20 Oct: resting a {Support Broadcast} in the Battle Area as the price, adds up to 1 black <Maiden Squadron> of cost 2 from the Drop or Warp to hand; nothing without the {Support Broadcast}. |
| BT30-095 Ribrianne, Witchy Warrior | f20 | [auto] Place 2 ≪Maiden Squadron≫ cards from your Warp at the bottom of your deck: When this card attacks, | confirmed | engine proof 20 Oct: two <Maiden Squadron> from the Warp to the deck bottom as the price, then an opposing Battle Card to its owner's Warp; not payable with one. |
| BT30-097 Formation!! Brianne De Chateau | f10 | [auto] [limit 1] If your Leader is a ≪Universe 2≫ card: When this card is played, draw 1 card, send up to | confirmed | engine proof 20 Oct: with a <Universe 2> Leader draws 1, sends {Ribrianne, Witchy Warrior} from the Drop to the Warp, then up to 2 <Universe 2> cards get +5000; nothing with another Leader; Limit 1 recorded. |

## The three flagged rows, in more detail

| Row | Finding | State |
|---|---|---|
| **BT3-050 front 20** [Permanent] "When this card is under a card, the <Majin Buu> on top of this card gains [Barrier]" | Wrong in the engine, not in the rule: the stored program (IF something is on top of this card, the <Majin Buu> on top gains Barrier) is the right reading, but permanents are collected only from cards that stand in a zone (`vm/effects.ts` walks zones), and a card in a pile is in no zone (rule 23-2). Engine proof: after BT3-050's [Union-Absorb] puts BT2-027 (a <Majin Buu>) on top of it, `hasKeyword(BT2-027, Barrier)` is false. Front 0 (the Absorb itself) plays right and is confirmed. | flagged; engine change (permanents of buried cards) |
| **BT3-082 back 10** [Auto][Once per turn] "When your <Saiyan> is KO'd, this card gains +5000" | Reads right for the base case (engine proof: a <Saiyan> KO'd gives the flipped Leader +5000 once, a second Saiyan KO'd the same turn gives nothing more, a non-Saiyan alone gives nothing). The defect is the order: the trigger is the plain `yourCardKoed` and "that card is a Saiyan" is an IF, so a **non-Saiyan** KO'd first uses up the once-per-turn (`usedThisTurn [10]`) and a Saiyan KO'd later the same turn gives no +5000 (engine proof: 15000, expected 20000). Official Q&A: the auto cannot be declined; also fires on own skills' KOs, not on Broly-style Drop placement. | flagged; needs a typed KO qualification on the trigger (engine work), not drafted |
| **BT30-082 front 10** [Awaken] "When your life is at 4 or less, or you have 2 or more energy and {Support Broadcast} in your Battle Area" | Misread: the stored condition's second alternative was "2 or more {Support Broadcast} cards in the Energy Area". **Claude draft fix v3 saved** (source `claude`, status `draft`, explanation naming the basis; not an owner approval): the second alternative is now `all( 2+ cards in the Energy Area, a {Support Broadcast} in the Battle Area )`, life <= 4 unchanged, the draw 2 / life down to 6 program unchanged. Engine proof on the stored row: offered at life 6 with 2 energy and a Support Broadcast in play (flips, draws 2); not with 1 energy, with none, with Support Broadcast only in the Energy Area, or with a card named "Support Broadcast Deluxe"; still offered at life 4 with no energy and not at life 5. No official Q&A or errata for BT30-082. | flagged for the owner to approve the draft |

## Throwaway engine proofs (not committed)

Run 20 Oct 2026 on the rules engine (`RULES`) with the real card definitions from the catalog and the **stored** rule rows (`rulesFromRows`), synthetic fodder for traits, colours and costs, answers driven through every prompt:
BT3-040/-041/-042/-058 target filters (cost <= 3 / <God>, cost 5 refused); BT3-045/-062/-086/-093/-105 searches (candidates, destinations, "the rest" to the Drop, Saiyan Leader gate);
BT3-046 Barrier for <Majin Buu> and the free deck play; BT3-047 [EX-Evolve] and BT3-061 [Evolve] triggers; BT3-048/-050 [Union-Absorb] flows; BT3-049 copied keyword and once per turn; BT3-052/-054 the two-choice burial with and without a <Majin Buu> Leader;
BT3-055/-082 real Leaders, both faces: attack draws, [Awaken] offered at life 4 / refused at 5 with every energy Active, the flipped Permanent, the KO trigger; BT3-087 free play; BT3-091 end-of-battle with the Jaco return; BT3-092 Barrier and combo-cost reduction; BT3-100 combo gate;
BT3-106 double play and draw; BT30-019/-082/-095/-097 prices and effects; BT30-082 Awaken after the fix. The probe is wrong or silent on all of the Activate rows staged in hand and on Leader attack Autos (it attacks with a nameless fighter), which is why the engine proofs are the evidence.
`npx tsx scripts/verify/qualified-movement-evolve-825.ts` and `scripts/verify/union-sources-930.ts` pass (cited for BT3-112 f10 and the Absorb rows).

## Notes on the Try it probe (artefacts, not rule defects)

- Activate rows staged from the hand say "Cannot pay" (BT3-042, BT30-019 f20, BT30-082): the price (Rest Mode of this card, energy to the Drop, cards from the Drop to the Warp) is fine once the card is in play.
- Leader attack Autos (BT3-055, BT3-082, BT30-082) show "nothing": the probe attacks with a "Nameless Fighter", not the Leader. The real Leader attacks draw correctly (proof above).
- BT3-055/BT3-082 Awaken boards "fire" at life 5 in the probe; the engine refuses it at life 5 (proof above).
- BT3-050's probe breaks with "missing or contradictory typed Union-Absorb procedure v1" while the stored front 0 row plays correctly on a real board.

## Known engine gaps that touch these cards (referenced, not re-investigated)

- Cost filters ("cost 3 or less", "cost 5 or less", cost <= 4) read the printed energy cost, not `costOf` (the BT3-005 family): BT3-040, -041, -042, -093, -105, -106, BT30-082 are unaffected unless a cost modifier is on the board.
- None of the 45 rows is an Activate price the planner refuses (the BT30-019 price has a `reveal` move and is offered), and none is a Drop-origin Auto.
- Search "reveal" required by the official Q&A (BT3-045, -093, -105) is log-level only in the engine, as for BT4-089 in the first receipt; BT3-086's Q&A says no reveal.

## Fuzz

`npm run arena:fuzz -- 20`: **20 games: 20 completed, 0 interrupted, 0 action limits, 0 crashes.** (The games include Claude-draft decks, among them the Universe 2 Maiden Squadron deck.)

## Open questions for the owner

1. BT30-082 front 10: approve the draft (Support Broadcast must be in the **Battle Area**, "2 or more energy" = 2 or more cards in the Energy Area)? Is that the intended reading of "you have 2 or more energy and {Support Broadcast} in your Battle Area"?
2. BT3-082 back 10 (once per turn consumed by a non-Saiyan KO): does the owner want this treated as an engine task (a typed qualification on `yourCardKoed`, like the combo qualification), or accepted as an approximation?
3. BT3-050 front 20 (permanent on a buried card): engine task to read permanents of cards in a pile.

## Not done / caveats

- Confirmations rest on printed text, the cited repo proofs and the throwaway proofs above; nothing was confirmed on a row Claude wrote (BT30-082 front 10 stays a draft).
- 86 unchecked owner-deck cards remain (plus BT7-023, the Claude-authored row skipped in batch 1).
- The throwaway proofs are not committed; they can be rewritten from the notes. Nothing else in the repo changed.

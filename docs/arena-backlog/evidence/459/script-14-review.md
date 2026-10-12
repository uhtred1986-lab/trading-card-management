# §14 script expectation review

[`vm-scripts-459.json`](../../../../scripts/verify/vm-scripts-459.json) fixes the
complete `events`, `beats`, both players' `sides`, `prompt`, `did`, and `vars`
for each of 29 named programs. The link from this evidence directory is
intended as a source label; the imported fixture lives at
`scripts/verify/vm-scripts-459.json`. Each spelled and lowered run must equal
the same complete record. The fixture is deliberately immutable: changes need
review of the printed operation, the manual rule, and the seed-7 pile order,
not a command that rewrites expected JSON from current output.

The initial Main Phase has six cards in each hand and eight in each life pile.
The first p1 deck cards are `p1#43`, `p1#15`; the first p2 deck cards are
`p2#13`, `p2#44`. P1's first life cards are `p1#1`, `p1#3`; p2's is `p2#32`.
These are fixed by the reviewed opening fixture. All cases keep the prompt at
`{kind:"main",player:"p1"}` except the three discard questions, which ask
the named hand's owner to choose one card. Empty events and beats are explicit
for a look, an unanswered discard, an unneeded counter negation, and a combo
without a battle.

| Programs | Source-qualified expected change |
| --- | --- |
| `draw 2`, `draw X, both players`, `draw until 8 in hand` | Manual draw procedure moves the next two cards from each named deck to hand; each draw has `move` then `draw`, and `did.draw` is true. The `handUpTo` call starts from six, so it also draws two. |
| `deal 1 damage`, `take 2 damage` | Damage takes the first card(s) of the damaged player's life into hand, then logs one `damage` with the exact ordered card list and non-Critical flag. The four `note` events record moments for which the synthetic ruleset declares no trigger; beats retain the move(s) and damage. |
| `add the top card of your deck to your life` | The next p1 deck card `p1#43` becomes the last p1 life card; one move event and beat. |
| Three discards | A discard is a 20-7 choice before any card moves. The opponent question names all six p2 hand instances; the self/Warp and X=1 questions name all six p1 instances. The continuation variable is an empty selected-card array. |
| `negate the attack`, `negate the counter being answered` | The staged p2 Leader attack produces `attackNegated`, one negation beat, and both `did` flags. With no counter being answered, the second program produces no event or effect. |
| Four `replaceLeave` forms | Staged `REPLACER` is `p1#9`. KO emits `ko` then a replacement note and moves it from battle to warp or Rest-Mode energy. The opponent-skill send replaces Drop with hand. The target binding remains `t:["p1#9"]`. Manual 9-10 and each printed narrowing justify the destinations. |
| `life down to 2`, `both players, life down to 1` | Six or seven top life cards per named player move to that player's hand, leaving the first case with p1 life `p1#40,p1#16`, the second with p1 `p1#16` and p2 `p2#8`. Events and beats contain one ordered move per card. |
| `comboFrom`, negated, no battle | During a staged battle, `p1#9` moves from hand to combo with `reveal:true`. The negated variant also installs one game-long `negateSkills` effect; two notes name moments with no matching declaration. With no battle, 5-7-2 forbids the combo and records nothing. |
| Five `resolvingPlay` forms | The first two mark the play as replaced, note that V1 was not played and move `p1#9` from play to the deck bottom or hand. The other three retain it in play with fixed `rest`, `negated`, or both flags. Separate literal assertions cover the resolving record, which is outside `sides`. |
| Four `look` forms | 20-11 binds the top `p1#43,p1#15`, bottom `p1#4`, top opponent `p2#13,p2#44,p2#37`, or all six opponent hand cards respectively. Looking logs no public event or beat and moves no card. |

The 29 complete records also assert unchanged zone order, player attributes,
prompt fields and absent fields. The guarded normal VM lane keeps legacy-host
spelled/lowered equality and the separate legacy timed replacement/lifetime
checks for #118; the rules-only lane never invokes them.

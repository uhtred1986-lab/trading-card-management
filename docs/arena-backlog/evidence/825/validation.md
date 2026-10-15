# Qualified movement and cleanup evolution (#825)

Base: deployed #824, `1996255ea874bca8349ec64328ea4712e23505b0`.
Implementation uses local public catalog inputs and the actual rules engine; no
live database reads/writes or paid calls. `cards.json` preserves the inspected
printed definitions, including the original typographic trait apostrophes.

## Rule basis and bounded changes

- **BT29-029 back #0.** “When a blue ≪Cooler's Armored Squadron≫ card or blue
  Extra is returned from your Battle Area to its owner's hand…” Manual
  **9-6-9-1-1/2** requires original open Battle Area information. The declared
  `moved(from: battle, to: hand, watcher: fromHolder)` watches the original holder,
  not the destination owner. Its compiled filter preserves both blue alternatives;
  event-time qualification and private captured subject attributes survive reload.
  Both movement emitters capture before replacement/effect cleanup, then attach
  information based on the actual final destination. A borrowed return can qualify;
  a diverted attempt cannot. Manual **22-11-2/4/5** supplies once-per-turn and
  **20-16-1** the conditional follow-up.
- **BT3-112 front #10.** “When this card is sent to the Warp from your Battle Area
  or deck, add it to your hand.” New self movement declaration names both source
  areas without inventing a cause/skill-owner restriction. **22-15-6** supplies the
  actual Over Realm end-turn Warp movement. **9-6-9-2/3** retains original skill
  negation and excludes Hidden Mode departures; old effects disappearing on a
  redirected movement cannot restore a negated Auto.
- **BT3-098/BT3-096 front #10.** “During your turn, at the end of the battle after
  you combo with this card, choose up to 1 <Fasha>/<Tora> in your Battle Area, and
  evolve it into this card.” **8-5-8/9/10-1** explicitly locates the occurrence:
  this Combo copy must actually reach Drop in cleanup. The own-turn prefix is a
  guard, not a future delay. No hand-only restriction is printed. **22-5-2-3**
  defines explicit evolution; **22-5-5/5-1** supplies stack inheritance and failure
  when the selected base leaves or stops qualifying. **5-5-3** supplies skill play
  without the ordinary card energy cost; the actual combo cost is still paid.
  The printed effect takes precedence over an ordinary keyword's hand-only
  activation rule (**0-2-2**). Optional zero choice, wrong turn, Z-Energy diversion,
  mid-battle exit, missing/changed base and countered play must not evolve or fire
  the #20 payoff. Plain play-on-top is not an explicit evolution.

The ordinary keyword variants shared an adjacent event bug: `keywordActivated`
was announced while the evolving copy was still in hand, so its evolved-into Auto
could be missed. `evolvedInto` now answers a separate successful `evolved` event;
`evolveFromHandActivated` retains its original activation event. Evolve/EX-Evolve/
Xeno-Evolve marked plays revalidate the exact chosen base after Counter: Play;
Xeno moves that base to Warp immediately before landing. Failed hand copies go
to Drop under **22-5-7**, while **22-5-7-1** preserves an explicit hand-return
counter exception. Each variant and success/failure/counter path is exercised;
no successful payoff is duplicated. Declining an ordinary required base choice
is refused atomically; the Great Apes' printed up-to choice can be declined.

Cooler's “If you do” compiles to actual `did:play`, not offer acceptance. The
runtime resets the result for each attempt and records success after landing,
including through suspended counter windows. No eligible target, prohibition,
empty target or counter replacement cannot add free energy. A later Auto removing
a successfully played card does not undo the earlier performed action.

No card-specific official Q&A was present in the saved/local evidence; no online
Q&A verification is claimed. No additional owner ruling is used for these readings.

The real Cooler cards revealed a prerequisite mismatch: parsed skill text folds
curly apostrophes while catalog identities retain them. Both pure and VM identity
matching now use the same lowercase/apostrophe key. This does not drop apostrophes,
merge unrelated traits, or widen exact identity into substring matching. The real
curly catalog trait and a missing-apostrophe negative are asserted independently.

## Catalog impact

`catalog-diff.json` compares the same saved 6,552 definitions and all 13,615 keyed
skill records, with current checked-in errata applied on both sides (including
World Peace's cost-at-most-three correction). It records full before/after public
printed records, not private decks or fuzz snapshots.

Nine records change: the four requested rows above, and the same own-turn cleanup
wording on **BT3-090 front #0**, **BT7-040/083/086 front #10**, **P-035 front #20**.
BT3-090 loses an erroneous delayed effect. The BT7 trio retains play-on-top effects
without gaining evolved-into semantics; only timing recognition changes. P-035's
Bardock evolution wording remains unread because it does not use the supported
explicit Battle Area choice; timing recognition is not a whole-skill pass.

Two unread shapes disappear (`after you combo with this card`, `at the end of a
battle after you combo with this card`); no new unread shape appears. Every moved
record is reviewed against its full printed text. A supported trigger cannot make
an unsupported effect playable. Compiler output does not refresh stored rules:
any live row replacement remains a separately reviewed, explicitly scoped step.

## Focused validation

The dedicated `scripts/verify/qualified-movement-evolve-825.ts` uses real saved card
texts for the primary skills and normal engine moves for paid Combo/Over Realm.
Auxiliary operations deliberately stage movement, identity changes, redirects and
counter interruption, without replacing a primary skill with a synthetic program.
It checks both source areas/players, blue alternatives, borrowed and temporary
identity returns, actual replacement routes in both directions, physical-copy
identity, original negation/Hidden Mode, optional decline/no target, once-per-turn,
paid hand/Battle combos, cleanup timing, correct evolution/payoffs, negative base
and play cases, ordinary stack control, JSON reload and zone/pile invariants.

Pending/pause snapshots are checked for private event metadata exposure. Full
private admin replay fixtures are not published. Component evidence is scoped to
these cases and revisions; it is not an all-card/all-deck coverage claim.

Focused checks passed: the new real-card suite, existing #572 hand-combo and #609
cleanup/replacement suites, keywords, readings, ruleset validation and language
round-trip; TypeScript, changed-file ESLint and `git diff --check` passed. The
from-hand activation Auto remains distinct from a successful evolution payoff.
No full test/build or production action was run in this worker worktree. The
coordinator runs the integrated full test/build gates and any authorized stored-row
refresh after reviewing the exact final commit.

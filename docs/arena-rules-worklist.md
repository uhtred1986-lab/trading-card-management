# Arena rules engine — the work list

Written 4 Sep 2026, so a new session can start on the next mechanism without
re-deriving how the engine fits together. `docs/arena-design-proposal.md` §15
says *what* is missing and why it matters; this file says *where the code goes*.

Branch for this work: **`feature/arena-effects`** (a UI refactor is in flight on
other branches — do not touch `src/app/**` layout files or `src/components/**`
outside `arena/`).

---

## Before you start

```powershell
npm run typecheck ; npm run lint ; npm test      # must all be clean, no DB needed
npm run arena:coverage   # how much card text the compiler reads (needs .env.local)
npm run arena:gaps       # every unreadable clause, sorted by the mechanism it needs
npm run arena:fuzz       # 20 self-played games, asserts no crash and no stuck state
```

`npm test` runs `scripts/verify-arena.ts`, which is plain `assert` over synthetic
cards. **Every mechanism below needs its tests there**, in the same style: a
comment naming the Rule Manual section, then the smallest game that shows it.

A caution learned the hard way, twice: **never write engine source through
`node -e`.** `\b` inside a template string becomes a literal backspace and
silently breaks a regex, and `` $` `` in a `String.replace` *replacement* means
"everything before the match", which once spliced 900 lines of `compile.ts` into
the middle of itself. Use the Edit tool.

---

## How the engine is built, in six sentences

1. `GameState` is plain data; `apply(ctx, state, action)` is the only mutator and
   returns a new state plus events. Everything is JSON-serialisable because a
   game is stored in one `arena_games` row.
2. `state.flow` is a list of **data steps** run by `run()` until one needs a
   decision, so a game can be saved mid-effect and resumed. New steps are
   `unshift`ed onto the front.
3. Card text becomes a **program in the effect language** (`script.ts`), either
   by the deterministic compiler (`compile.ts`) or, when that fails, by Claude
   at runtime (the referee). Programs run inside a `script.step` flow step.
4. Continuous effects (`state.effects`) are read lazily by `powerOf`,
   `keywordsInForce`, `playCost` — never applied eagerly.
5. `legalActions()` is the single source of truth for what a player may do; the
   UI and Claude both only ever pick from it.
6. `state.delayed` holds effects scheduled for a later timing, drained at the
   points listed in `fireDelayed`'s callers.

Files, by size and importance:

| File | What lives there |
|---|---|
| `src/lib/arena/engine/types.ts` | every shared type; start here for any new concept |
| `src/lib/arena/engine/engine.ts` | `createGame`, `apply`, `legalActions`, `exec` (the flow-step switch) |
| `src/lib/arena/engine/state.ts` | areas, moving cards, power, costs, continuous + delayed effects |
| `src/lib/arena/engine/script.ts` | the effect language `Op` union, the interpreter, `validateProgram` |
| `src/lib/arena/engine/compile.ts` | card text → `Op[]`; clause splitting, target phrases, patterns |
| `src/lib/arena/engine/filters.ts` | the fixed target grammar ("Blue \<Baby\> with an energy cost of 4") |
| `src/lib/arena/engine/triggers.ts` | `pendTriggers`, `koCard` |
| `src/lib/arena/ai/opponent.ts` | `EFFECT_LANGUAGE` — **the spec sent to Claude; update it with the language** |
| `scripts/verify-arena.ts` | the tests |

---

## Done: delayed effects (1-7-2-1-1)

Commit "Arena: effects that happen later". Worth reading as the template for
the next mechanism, because it touched every layer in the usual order.

- `types.ts`: `DelayTiming`, `DelayScope`, `DelayedEffect`, `state.delayed`,
  `nextDelayedId`, a `delayed` game event.
- `script.ts`: `{op:"delay", at, scope, ops, label}`, an interpreter case that
  calls `schedule()` with a **copy** of the frame's variables, `OP_NAMES` and a
  `validateProgram` branch that also checks the timing is one the engine drains.
- `state.ts`: `schedule`, `ripe`, `fireDelayed`, `expireDelayed`; plus
  `resolveSelector` now honours an `area` on a `special` selector, so a delayed
  "this card" does nothing once the card has left.
- `engine.ts`: drains at `turn.start`, `turn.mainStart`, `turn.endPhase`,
  `turn.cleanup`, `battleCleanup`; `expireDelayed` at `turn.next`; `[Over Realm]`
  now schedules its Warp return instead of writing an opaque continuation;
  `apply` back-fills `delayed` on games saved before the field existed.
- `compile.ts`: `DELAY_PATTERNS` read at either end of a clause, groups carry an
  optional `delay` that wraps their ops on assembly.

Known approximations, deliberately: "during your opponent's next turn, X" fires
X at the *start* of that turn (before their draw) rather than lasting through
it; `[X Attack]`'s reactivation stays a flag on the battle, because it is
already typed and belongs to the battle rather than to the turn.

---

## Done: prohibitions (20-14, 0-2-5)

Commit "Arena: the engine stops offering moves the cards forbid". 463 cards →
184; catalog coverage 57.7 % → 59.0 %.

- `types.ts`: `ForbiddenAction` (eleven actions), `Prohibition`,
  `ContinuousEffect.kind` collapsed `cannotAttack | cannotBeAttacked` into one
  `forbid` kind with a `forbid` payload, and a new duration `"nextTurn"`.
- `state.ts`: `forbids(ctx, s, what, {player, card})` — the one question, asked
  last; `forbiddenForCard` for `setMode`, which has no context; the
  `switchToActive` check inside `setMode`, so the Charge Phase honours it
  without knowing it exists; `beChosen` beside the `[Barrier]` line.
- `engine.ts`: attack and target checks in `mainActions`; `uniqueAllows`
  became `canPlay`, used by the menu *and* by `apply` for play / playUnison /
  playZ; blocker candidates, combo candidates, `activatable`, `counterCandidates`.
- `triggers.ts`: `koCard` refuses a KO from any source for `beKOd`.
- `script.ts`: the `forbid` op (`cannotAttack` kept as an alias for programs
  already stored in `card_scripts`); `beKOdBySkill` in the `ko` op; the `play`
  op filters cards that may not be played.
- `compile.ts`: `compileProhibition` — the subject says whether the rule is
  about a player or about cards, the verb says which action; deck-building
  restrictions are read and deliberately do nothing.

**Still missing, and it is the next thing worth doing here:** a prohibition
printed as a `[Permanent]` skill does not apply, because `staticEffects()`
emits only power, combo power, keywords and cost. Most "this card can't be
KO'd by your opponent's skills" lines are `[Permanent]`. Fixing that is the
static-layer item below, and it would finish the prohibition work properly.
Related: a prohibition with no stated duration compiles as "for the turn",
which is conservative — it expires rather than lingering wrongly.

---

## Done: modal choice (20-2) and cards under cards (23-2)

Commit "Arena: choose one, and cards that go under other cards".

- **Modal choice.** The real discovery: `skillLines` splits on `<br>`, so each
  printed option was arriving as *its own skill*. `skillLines` now folds a
  bullet line onto the line above it (and unwraps `[ul]`/`[li]`), `splitModal`
  in `compile.ts` splits the options, and the new `chooseMode` op splices the
  chosen option's program in place exactly as `if` does. New `Prompt` kind and
  `Action` of the same name, `state.lastMode` carrying the answer,
  `ArenaBoard` rendering the options as whole sentences.
- **Cards under cards.** `placeUnder` in `state.ts`; `moveTo: "under"` with an
  optional `under: Ref` host, defaulting to the source card. 23-2-5 already
  worked, so a stack still follows its top card out of play.

Note for anyone puzzled by a stored program misbehaving: skill indexes shifted
on cards whose modal options used to be counted as separate lines, so a
`card_scripts` row written before this may point at the wrong skill.

---

## Next: replacement effects (9-10) — the one genuinely hard piece

"If this card would leave the Battle Area, … instead". A registry consulted
*before* an event, the affected player choosing when several apply (9-10-2),
and the original event treated as never having happened (9-10-1-1).

The hook goes inside `move()` in `state.ts`, the damage step in `engine.ts`
(`battleDamage`) and `koCard` in `triggers.ts`. Beware: `move()` is called
everywhere and is not currently allowed to prompt. The cleanest route is for a
replacement to be *resolved synchronously* when it needs no choice, and to
convert to a flow step when it does — which means `move` needs to be able to
say "I did not move it, a step is queued". Budget a session for this one alone,
and write the tests first. `[Revive]` and the Z-Energy substitutions are built
on it.

---

## After that

In the order they earn their keep:

- **Negating one skill, not all** (67 cards, small). `negateSkills` sets
  `negated = "all"`; the instance already carries `number[] | "all"`, so this is
  compiler work plus honouring a skill-kind filter.
- **Counter-motion chains** (9-7). `counterStack` is push/pop only and no window
  ever opens in response to a counter, so every `[Counter: Counter]` card in the
  game is dead. Needs the numbered chain of 9-7-3, resolved in descending order.
- **Permanent skills as static effects** (9-1-3-3, 233 cards). `staticEffects()`
  scans cards in play plus the hand for cost reducers, and emits only power,
  combo power, keywords and cost. It needs to emit **prohibitions** as well —
  that is what finishes the prohibition work — plus area-scoped validity and a
  condition gate for "during your turn".
- **Cost changes on other cards** (20-21, 74 cards). Extends the static layer:
  other cards, increases as well as reductions, and skill costs.
- **Amounts counted off the board** (90 cards). `Amount` already has
  `{count: Selector}`; the compiler has never emitted one. Pure compiler work.
- **The §22 keywords still missing** (45 cards): Aegis, Alliance, Arrival,
  Revive, Successor, Rejuvenate, Spirit Boost, Empower, Invoker, Burst,
  Union-Absorb. Each small and self-contained.
- **Ordering simultaneous triggers** (4-2-2-2). The `orderPending` prompt type
  exists and is never raised; the engine resolves in printed order.
- **Hidden Mode** (23-5). Modelled on the card instance; nothing ever sets
  `hidden = true`, so the whole branch is unreachable.
- **Infinite loops** (23-1). The flow has a 10,000-step guard that *throws*; the
  rules call for a draw, or for the player to declare how many times it runs.

---

## Done: the first pattern pass (4 Sep 2026)

Commit "Arena: the first pass of wordings, aimed at the decks you play".
Catalog 60.1 % → 66.5 %, the owner's decks 77.2 % → 85.6 %, on the same 6,493
cards. No new mechanism — every one was a sentence the engine could already
carry out and could not read.

The lesson worth carrying: **a failed clause fails the clauses after it.** The
compiler tracks what "it" refers to in `Ctx.lastTarget`, so when
`choose 1 of your <Majin Buu>` failed for want of an area word, the
`switch it to Active Mode` behind it failed too. Two fixes at the head of a
chain were worth more than twenty at the tail. When picking the next batch,
look for the clause that comes *first* in a skill.

Also: measurement now filters on `cards.game` (`src/lib/catalog/games.ts`).
Fusion World entered the catalog on 4 Sep; it is a different game, the arena
does not play it, and counting its 2,000 cards would mean tuning the compiler
on text that can never come up.

How to run the next batch, which is the same shape:

1. `npm run arena:coverage` → the **"in your decks"** table is the working list.
2. For the top wordings, look at the verbatim clause and the card it is on
   before writing a pattern — the normalised form in the table hides which
   preposition the set actually printed.
3. Write the pattern generally, not for the deck: the same sentence usually
   appears hundreds of times catalog-wide.
4. Add the compile assertions to `scripts/verify-arena.ts`, re-measure, fuzz.

---

## Done: the §22 keywords as engine rules, and printed conditions (5 Sep 2026)

Branch `feature/arena-counter-chains`, not yet merged. Three commits:

**Every keyword the manual defines now has an engine rule** — none goes
through the compiler or the referee. Read from `docs/rules/rulemanual.txt`
section by section: [Burst X] and [Spirit Boost X] (costs written as tags, like
[Bond]; the parser must *not* treat Spirit Boost as the skill's keyword),
[Arrival X/Y] (from hand during a battle once both colours are in the Combo
Area), [Empower X Y] (markers carried from the replaced Unison), [Successor]
(subset-sum of green/yellow costs, chosen one card at a time from cards that
still leave a way to the exact sum), [Aegis X/Y] (opponent's Defense Step
only), [Revive X/Y] (on KO, once per card per turn), [Rejuvenate], [Alliance
X/Y] (rest cards as the cost; the effect reads "the total power of the cards
switched to Rest Mode by this skill" through a new Amount, `{sumPower:{var:
"rested"}}`), [Invoker] (an alternative cost, like the printed 5-3 ones).
Tests for each are at the end of `scripts/verify-arena.ts`, sections cited.

Two engine gaps came out of it. **The combo prompt never offered
[Activate: Battle] skills at all** — `apply` accepted them, `legalActions`
never listed them, so the board and the fuzzer had never activated one. And an
engine-side "choose 2" prompt (Union, Aegis, Revive…) could not be answered
from a menu that offers one card per tap: the `choose` action now accumulates
picks and offers "Done choosing" once the minimum is met. The interpreter's own
`choose` had been fixed the same way a day earlier; the two paths are separate.

**A condition before the colon was being dropped.** "[Auto] If your Leader
Card is red: When you play this card, draw 1 card" lands in `Skill.cost`, and
`compileSkill` only ever read `effect` — so the draw happened whatever the
Leader was, and the skill counted as compiled. Now the program is wrapped in
`if`, a condition the compiler cannot read fails the skill (honest gap), and an
[Activate] skill whose cost is only a condition is offered when it holds.
[Awaken]/[Wish] are exempt: the engine checks theirs natively (22-2). Coverage
*fell* from 73.2 % to 70.8 % on that commit and is back to 72.6 % after reading
the commonest shapes (markers on this card, in a battle, the Leader's back
side, "{X} is in play in your Unison Area", and `any`/`all` for "…, or you have
5 or more energy and …"). 187 of the catalog's 2,500 condition costs remain
unread; the top of that list is "if all of your energy is black", "if your
opponent's Leader Card's back is facing up", "if this card's power is N or
more", "if your Leader Card has ≪X≫ in its special trait".

A related silent widening: a target phrase whose filter words are not
recognised selects the *whole* area. "with power less than or equal to this
card's power" was one — `parseTarget` saw "this card" and chose the card
itself. `CardFilter.powerRel` now carries the relative bound and
`resolveSelector` applies it. Grep `parseFilter` for other measures the cards
print ("with the same name", "with an energy cost equal to…") — each one that
is not parsed widens a selection without a word.

Later the same day, five more commits worked the "one clause away" list down:
skill memory (`frame.did`: "if you added a card to your hand", "if you played
a card", "if you KO'd a card", "if you negated a Leader Card's attack"), Hidden
Mode, `redirectAttack`, `comboFrom` (combos from the Drop), `flip`, the `kos`
trigger ("when this card attacks and KOs…" — the trigger's own "and" had been
splitting it), a bare condition riding on a trigger ("When you play this card
and your Leader Card is a ≪Universe 6≫ card, …" — one fix, +3 points), and two
engine bugs: **skill negation for a turn was written into `s.effects` and never
read** (and marked the card for the game), and **a move with a number in its
target moved every matching card** ("add 1 card from your Drop to your hand"
added the whole Drop) — `withChoice` now puts a choice in front. End of day:
catalog **79.1 %**, decks **89.3 %**, permanent 49.0 %, one clause away ~1,450.

**Next stage: `docs/arena-next-stage-spec.md`** — a self-contained brief with
the code map, the checklists for a new op/condition/trigger/keyword, the
measurement loop, and the backlog with per-item specs and acceptance tests.
Start there.

---

## The other track, which needs no planning

Two thirds of the unreadable clauses — 6,116 of them — need **no new
mechanism**, only a phrase pattern. The loop for grinding them down already
exists and is the fastest way to raise coverage:

`/arena/backlog` groups them by the shape of the wording. For each group you can
tell Claude in plain words what the card does; it saves a program against that
card (so it plays correctly from the next game, with no referee call) *and*
produces a work item describing the wording, which is about twenty lines of
`compile.ts`. The two are different fixes and the page says so: the program
fixes one card, the pattern fixes every card phrased that way.

`npm run arena:gaps` prints the same thing catalog-wide with counts — start at
the top of that list.

## Done: §6.2, §6.3, §6.5, §6.7 and §6.9 of the hand-off spec (5 Sep 2026)

Branch `feature/arena-compiler-next`, three commits, working
`docs/arena-next-stage-spec.md` in the order it recommends. Catalog 79.1 % →
**80.4 %** of resolvable skills; [Permanent] skills the static layer applies
49.0 % → **50.4 %**; the owner's decks 89.3 % → **89.5 %**; "1 clause in the
way" 1,469 → **1,400**. 40 fuzzed games, 0 crashes at every step.

What was built, by the section it came from:

- **§6.2 searching a secret area.** `splitClauses` no longer breaks a card
  description at the "and" joining its two measures, `parseFilter` reads a bare
  "N power", and `filterFor` counts a card type and a Z-card as narrowing.
  `Ref.minus` is "the rest" — what a look turned up minus what the choice took.
  `look` can take its count off the board.
- **§6.3 energy.** `moveTo.owner`, so "place it in your opponent's energy in
  Rest Mode" lands in *their* area rather than the card owner's.
- **§6.5 prohibitions.** `beMovedBySkill`, `beNegated`, and `placeEnergy`
  wired up at last (it had been in the union, uncompiled and unenforced, since
  the prohibition work). A prohibition may be printed as "will not", which
  brought in `Duration "afterNextCharge"` — `nextTurn` ends *before* the Active
  Step it is about, so a rest-lock written for "your next Charge Phase" needed
  a duration that is spent at 7-2-7 instead.
- **§6.7 counts.** The static layer evaluates a `count` amount instead of
  dropping it, so "+5000 power for each card placed under it" works.
- **§6.9 reveal.** A `reveal` op, `Cond.varMatches` for "if that card is a
  Battle Card", "otherwise" as the else of the condition just asked, and
  `look` over a whole area for "look at your opponent's hand".
- Also `Selector.special: "resolving"`, the card a [Counter: Play] is
  answering. Negating the play itself is still a gap, so those skills stay
  with the referee.

**The lesson worth carrying: a clause that compiles is not a clause that is
read correctly.** Five of the fixes above were not gaps at all — they were
skills the compiler was already running, wrongly and in silence:

| printed | what it did |
|---|---|
| "add up to 1 <Son Goku> card **among them** to your hand" | added *this card*: "them" was read as a pronoun and pointed at the trigger's subject |
| "place **the top card** of your deck in your energy" | offered the whole deck as a choice — a search the card never granted |
| "**switch up to 1** of your energy to Active Mode" | switched all of it; `switchMode` was the one action never wrapped in `withChoice` |
| "for each **non-Leader** card under this card" | counted the card on top, and the filter selected Leaders only |
| "place **the rest** at the bottom of your deck" | put back the card that had just been added to the hand |

So when a wording is on the "one clause away" list, check the clauses around it
that *do* compile before writing the pattern. `Selector.take` (a position) now
exists precisely because `count` always means a choice, and the two had been
conflated.

## Done: §6.4, §6.6, §6.10 and the phrasing tail (5 Sep 2026, same branch)

Five more commits on `feature/arena-compiler-next`, after merging `main` in
(the duplicate 0023 migration was already reconciled there, so the merge was
clean). Catalog **80.4 % → 81.3 %**; [Permanent] statics **50.4 % → 52.7 %**;
the owner's decks **89.5 % → 89.8 %**; "1 clause in the way" **1,400 → 1,344**;
clauses needing only a pattern **3,573 → 3,340**. 60 fuzzed games, 0 crashes.

- **§6.4 replacement effects.** The mechanism was already built. What defeated
  nearly every sentence using it was the word **"instead"** — it broke the
  anchor of every move pattern, so "send it to the Warp" compiled and "send it
  to the Warp instead" did not. `Replacement.by` also now distinguishes the
  four printed causes rather than two, and may say the mode the card arrives
  in.
- **§6.6 cost changes.** Orb-typed amounts (`by {r}`), count amounts, and an
  area bug that made every "in your hand" reducer select cards *in play* —
  where a cost reduction can never matter.
- **§6.10 skill negation.** `negateSkillsOfKind`, and "negate this skill for
  the battle".
- **Negating a play** (9-6), the largest single item on the "one clause away"
  list at 29 skills: `resolvingPlay`, which also writes the two continuations
  `resolvePlay` has read since the play rules were written and nothing ever
  set.
- **The phrasing tail**: the full-width dash after "choose one", "Battle Cards
  **and** Unisons" as two areas, "it" meaning a trigger's subject rather than
  this card, and instructions the *opponent* carries out (`choose.chooser`).

**The lesson from the first half held, and got sharper.** Again most of the
value was in clauses that compiled and were wrong, and this time three of them
were in shared machinery rather than in one pattern:

| where | what it did |
|---|---|
| `refFor`'s `IT` list contained "their" | "1 Battle Card from **their** Drop Area" resolved to whatever the trigger last named — a possessive read as a pronoun |
| the `costReduction` pattern stripped "in your hand" | every reducer selected cards in play, emitted a static, and reduced nothing |
| `negate (.*?)('s)? skills` has a lazy subject | "negate that card's **[Counter]** skills" silenced the whole card |

Two of those were found only by probing a sentence that *did* compile, so the
habit is worth stating plainly: when you pick a wording off the gap list, read
what its neighbours in the same sentence already produce before adding
anything. The gap report cannot show you a wrong reading.

Related: three fields have now been found that the engine read and nothing ever
wrote — `placeEnergy`, `continuations.playRest` and `continuations.playNegated`.
Grepping for a name with no writer is a cheap way to find a finished mechanism
waiting for a pattern.

## Done: the skills that compiled and could never happen (5 Sep 2026)

The most useful thing found on this branch, and it was found by accident.

An engine test for a newly compiled wording failed. The wording sits on "when
your opponent plays a Battle Card", and `played` in `autoTriggerMatches` only
ever matches "this card" — so there was no `Trigger` for the moment, and the
skill could never fire. Compiling is not happening: the compiler knows nothing
about triggers, so a skill can read end-to-end, count as compiled in
`arena:coverage`, and sit in every game doing nothing.

Probing the catalog for it turned up **1,081 such skills — about a tenth of
every resolvable skill in the game.** `arena:gaps` now counts them and ranks
the wordings; see §5.3 of the hand-off spec for the three steps each one needs.
Down to **849** after this pass:

| trigger added or widened | skills |
|---|---|
| `removedFromBattle` / `removedByOpponent` (3-1) | 65 |
| `evolvedInto` (22-5) | 45 |
| `opponentAttacks`, widened to the bare and "one of your opponent's" forms | 33 |
| `placed` (5-5) — placed in a Battle Area, which is not played | 30 |
| `opponentCounter` (4-3) | 15 |
| `opponentPlayed`, and `opponentCombos` | 13 |
| "…removed from a Battle Area by a skill **or KO'd**", which belonged to `koed` all along | 8 |

Two things to know before adding one. A trigger about a card *leaving* fires
once it has already gone, so `pendTriggers` must be told not to refuse it for
being out of a valid area (9-1-3-1) — that is the `onLeaving` list, which
`koed` had and nothing else did. And a trigger about what the *opponent* did is
pended on every card the other player has in play, with the card that did it as
the `subject` — which is exactly what "that card" and "it" then point at, and
is why the two halves of this work belong together.

Also in this pass: a **regression of mine**. Taking "their" out of `refFor`'s
pronoun list to fix "1 Battle Card from **their** Drop Area" broke "negate
**their** skills for the turn", which went straight to the top of the gap list
at nine skills. Inside a phrase it is a possessive; a phrase that is nothing but
the word is the pronoun after all. Both readings are now tested.

## Done: the price before the colon (5 Sep 2026)

The same blind spot as the orphan triggers, for the other two skill kinds, and
larger: **1,626 [Activate]/[Counter] skills whose effects compile were never
offered**, because `activatable` could not read the price before the colon and
will not waive one. Now 766, and counted by `arena:gaps` alongside the triggers.

Three bugs that had to be fixed in one commit, because two of them cancelled:

- A card that costs orbs *and* names a condition never *starts* with the
  condition — "{r}{r}, if your Leader is a green <Broly> card" — and both
  `costIsReadable` and `compileSkill` tested the raw cost for a leading "if".
- A reminder in brackets is not a price either (1-5-8); `stripNotes` had never
  been applied to a cost.
- A **compound** price silently lost half of itself: the Leader pattern's tail
  is greedy, so "…and you have 2 or more energy" vanished. Fixing only the
  first two would have started offering those skills without their second
  requirement — a wrong reading created by two correct fixes.

`costText` and `costIsOnlyOrbs` are exported and used by all three readers so
they cannot drift apart again. Catalog coverage moved 81.8 % → 81.5 %, and the
drop is the honest direction: a skill whose price cannot be read now fails to
compile rather than compiling without it, and goes to the referee.

**The pattern across all three discoveries this session** — wrong readings,
orphan triggers, unreadable prices — is that *every number here measures one
stage of a pipeline and is silent about the next.* The compiler's percentage
says nothing about triggers; the trigger count says nothing about costs. When
something looks finished, ask what the next stage does with it, and write the
engine assertion rather than the compile one.

## Done: a price that is an action (5 Sep 2026)

The mechanism §6.13 of the hand-off spec deferred, and it cleared most of the
never-offered list: **766 → 159**. "[Activate: Main] Switch this card to Rest
Mode: Draw 1 card", "Choose 1 card in your hand and place it in your Drop Area:
…", "Remove this card from the game: …".

The trick is that a price is written in exactly the vocabulary of an effect —
what makes it a cost is only *where it is printed* — so `compileCostProgram`
compiles it with the same code, and `activate` runs it as its own frame ahead
of the counter window (4-3-3).

The care goes into deciding whether it can be **charged**. Offering a skill
whose price then half-runs is worse than the gap it was: the effect happens
anyway. So `canPayCostProgram` is a whitelist — an op it does not know means
"no" — and it asks the board about each one. Two details cost a debugging pass:

- A target named by a variable is whatever the `choose` in front of it binds,
  and nothing is bound while the check runs. Resolving it there finds nothing,
  which silently refused every price containing a choice.
- The activating card leaves the hand as part of activating, so it is not also
  available to be discarded as the price.

`arena:gaps` calls `compileCostProgram` too, so both sides of the count mean
the same thing. What remains is a real tail: "discard this card from your hand"
(the card *is* the price), a full-width numeral, and a few prohibitions printed
where a price goes.

## Done: the third measure that counted the wrong thing (5 Sep 2026)

`arena:coverage` printed "[Permanent] skills **applied by the static layer**"
next to a number that only meant "compiled". A [Permanent] is never resolved —
`collectStatics` emits standing effects from the ops it knows, and a program
made of anything else reads cleanly and does nothing. **141 of the 976 that
compile emit nothing**, so the line overclaimed by 7.6 points. It now reads
`52.8 % read, 45.2 % applied`, and `arena:gaps` lists the 141 grouped by the
ops they produced, because that says which static kind is missing.

Of them: 49 whose whole text is a bracketed reminder (correctly nothing), 43
permissions the static layer has no kind for ("if you have 4 or more energy,
you can activate this card from your hand"), and ~40 whose text is an
instruction the compiler has taken literally.

**That is three measures in a row that counted a stage earlier than the one
they named** — the [Auto] triggers, the [Activate]/[Counter] prices, and now
this. Each is now driven by a single exported reader shared by the engine and
the report (`TRIGGERS`, `costText`/`compileCostProgram`, `emitsStatic`), which
is the only structural defence: when the two copies drift, the number quietly
starts describing something else.

## Done: rules fidelity, and one performance fix (5 Sep 2026)

The owner's call: fix what plays *wrong* rather than what raises a percentage.
§6.14 of the hand-off spec was the list, and all four are now done with engine
tests. Only 9-10-2 is left approximate there, and it needs `move` to be able to
prompt.

- **`{r}/{u}`** was folded into "one orb of any colour", so it could be paid
  with green. It is now `Skill.energyEither`, and `planPayment` solves it
  *exactly* by trying each assignment of the either-orbs and reusing itself —
  each way of settling them is an ordinary specified cost, so the planner never
  had to learn a new kind of requirement.
- **[Aegis]** let you pick two cards that did not cover both colours and then
  ate the orbs; the code's own comment called that "the price of a mistake the
  rules do not let you take back". 22-30-3 makes covering a *condition of
  activating*, so the engine now narrows what it offers and a wrong pair cannot
  be chosen.
- **[Alliance]** never told the cards it rested; five cards print a trigger for
  exactly that.
- **[Invoker]** offered a price the same energy would have had to pay twice.

Two things worth carrying:

1. **The either-orb fix broke [Aegis]-style costs for an hour and a test caught
   it.** Consolidating two near-identical "is this price only orbs?" helpers
   was right, but the survivor did not strip the `/` of `{r}/{u}` — the copy I
   deleted did. Consolidating duplicates is worth doing *and* is exactly when
   to run the tests.
2. **`locate` was 27 % of all engine time.** A CPU profile of 20 fuzzed games
   put it above the state clone and the whole compiler. It scanned both
   players' thirteen areas with the fifty-card deck first. Each state now keeps
   a hint of where each card was last found, checked in O(1) before it is
   trusted, so a mutation that bypasses `move` can only make it miss. 1,036 ms
   → 71 ms. If you need more later, the state clone is the next cost and should
   be left alone: it is what makes `apply` pure.

## Done: hunting mis-targeting with a probe (5 Sep 2026)

The Union-Absorb bug — a skill that played cards onto themselves — suggested a
way to find the rest of its family without waiting to trip over them. A
`choose` op carries its clause verbatim in `reason`, so the compiled selector
and the printed text can be compared directly. **Write the probe, not the
pattern.**

Three probes, each about ten lines:

| the question | found | left |
|---|---|---|
| a choice that resolves to *this card* while its clause names another | 66 | 2 |
| a choice saying "your opponent's" that selects your own cards | 1 | 1 (a real mechanism, not a misreading) |
| a choice saying "up to 1" that selects every match | 27 | 0 |

The 66 were two causes in `refFor`: a pronoun inside a trailing modifier
("play … **with its** skills negated") read as an antecedent, and "from under
this card", where "this card" is the pile to look in rather than the card
meant. Reading those correctly then made the *rest* of those sentences worth
reading, which is where `play`'s `negated` came from.

**The lesson, and it cost a red fuzz run:** the 27 were caused by my own
earlier fix, which hard-coded "all" into the under-area because the first
wording it met was a count. And fixing *that* made skills compile that play a
card out of a pile — which the engine had never been able to do, because cards
under a card are in no area (23-2), so `detach` could not take one out. Seven
of sixty fuzzed games then reported the same card in two places.

So: a compiler fix can make an engine path reachable for the first time. Run
`arena:fuzz` after compiler work, not only after engine work — it is the only
thing that would have caught this.

## Done: the second round of probes (5 Sep 2026)

Four more of the §5.3b probes. Two came back clean, which is worth the ten
lines to know; two found real bugs, and one of those was the biggest single
find of the branch.

| probe | result |
|---|---|
| a `power` op whose sign disagrees with the printed text | **clean** |
| a choice looking in a different area from the one printed | 82 hits, nearly all noise → the real one below |
| an op whose duration disagrees with the printed text | 1, and it was real |
| a printed "draw N cards" with no matching `draw` op | 4, and they were two different bugs |

**Two skills printed without the line break between them.** Some cards are set
without the `<br>`, so "[EX-Evolve]{b}{1}: <Towa> …. **[Auto]** When this card
is played, draw 1 card" arrives as one line — and since [EX-Evolve] owns its
own text, the [Auto] was discarded with `ops: []` and `unsupported: []`. It was
not a gap, it was invisible. **205 skills existed on cards and had never been
parsed**; 153 cards were affected. Catalog 81.8 % → 82.5 %.

**"For each" was swallowing the rest of the sentence.** "+6000 power for each
card in your energy **and [Triple Strike] for the duration of the battle**" —
everything after "for each" went to `parseTarget` as the thing being counted,
so the keyword was dropped and the power lasted the turn rather than the
battle. One clause, compiled cleanly, two things wrong at once.

**Sixteen area pairs, not five.** "From your deck or Drop Area" searched the
deck alone. I had added five pairs by hand; asking the catalog found sixteen in
both orders over 335 printings, so they are read from a table now. 192 of 216
such choices read both areas, against about five before.

The probe habit worth keeping: **the first version of a probe is mostly
noise.** The area one flagged 82 cases and nearly all were a clause naming a
source *and* a destination, where the selector is rightly the source. Skipping
any clause that names more than one area left the real ones. Do not abandon a
probe because its first run looks like nothing — narrow it.

## Done: checking the keywords that had no test (5 Sep 2026)

A probe over `verify-arena.ts` and the engine, asked two questions of all 39
§22 keywords: does it have a rule anywhere, and does any test exercise it?

**Every keyword has a rule** — nothing is missing. But **13 had no test**, and
writing them found three bugs, one of which had never worked at all:

- **[Heroic] and [Villainous] have never once resolved** (33 cards). They are
  pending skills with no printed line, so they pend at index -1;
  `resolveAuto` looks up a `Skill` by that index, finds none, returns.
  `resolveKeywordOrText` carried a branch for them that nothing could reach.
- They **cross-matched**: a [Villainous] card played set off every [Heroic] on
  the board, where 22-35-2 says each watches its own keyword.
- Neither **negated itself for the turn** (22-35-3), so a card paid out once
  per play instead of once per turn.

And, found while making [Villainous] work: **a discard was never a choice.**
The `discard` op's comment has said "20-7: the *owner* of the hand chooses"
since it was written, above a loop taking `hand[hand.length - 1]`. It is now
rewritten in place into a `choose` the owner answers plus the move, the way
`chooseMode` splices its option — so every discard in the game asks.

Tested and correct as they stood: [Servant], [Ultimate], [Warrior of Universe
7], [Field], [Overlord]. Still untested, in card order: [Swap] (60), [Offering]
(19), [Wish] (15), [Victory Strike] (4), [Wormhole] (2). [Dragon Ball] (14) is
a deck-construction rule only (22-28-1) and needs no play rule at all.

**The lesson is the same one in a new place.** "It has a rule" and "the rule
runs" are different claims, and only a test that plays the card distinguishes
them. A keyword with an implementation, a manual citation and a comment can
still be dead code.

## Done: face-up life cards (5 Sep 2026)

3-9-2-1. About 95 cards: 67 flip a card face up, 28 read one. The owner asked
for it after the keyword audit.

A face-up card is **one flag on the instance**, `CardInstance.faceUp`, not a new
area — the card stays where it is, is still life, and is still taken as damage
in its turn. What changes is that both players may see it and skills may count
it. Most of the mechanism therefore falls out of pieces that already existed:

- `faceUp` op (`script.ts`), and `moveTo` gained a `faceUp` flag so "add it to
  your life face up" is one move rather than a move and a second action. The
  flag is set *after* the move, because 3-1-4 makes a card that changed area a
  new card and `move` clears it.
- `CardFilter.faceUp` reads "face-up" in any target phrase. It is the first
  filter about the **instance** rather than the card, so `matches` cannot answer
  it — `resolveSelector` checks it where the instance is known. That one line is
  what makes "if you have 4 or more face-up ≪Boujack Brigade≫ cards in your
  Z-Deck" work, with no change to the condition parser at all: those cards are
  face up in the *Z-Deck*, so the flag was never life-specific.
- Trigger `flippedFaceUp` covers both printed wordings — "when **this** card in
  your life is flipped face up" (the card in the life area, so it needed the
  `elsewhere` exception in `pendTriggers`) and "when **a** card in your life is
  flipped face up" (watched by that player's cards in play).
- The colour qualifier those cards all print — "…**by one of your red card
  skills**" — is checked in `dropWrongColour` in `script.ts`, where the card
  that did the flipping is known. `autoTriggerMatches` reads text without state
  and could not have answered it, and without the check BT12-006 would play
  itself off any flip at all.
- `view.ts` gained `lifeFaceUp`/`zDeckFaceUp` and the board shows them; the AI
  view names them on **both** sides, which is the one thing either life area may
  say (3-1-3 otherwise keeps it out of the request entirely).

Coverage 83.3 % → 83.7 % of 11,745 resolvable skills. Fuzz: 20 games, 0 crashes.

Left undone, deliberately: the prices that are a condition **and** an action in
one — "{b}, if your Leader is a black \<Fu\> card **and you place** 1 black
\<Cumber\> card from your hand in your Z-Deck face up". `compileCostProgram`
returns null for all of them. Splitting a compound price is its own feature and
is a bigger one than this; the six cards that need it stay in the unreadable-
prices bucket of `arena:gaps` until then.

**The tooling lesson bit again, in a new way.** `String.replace` treats `` $` ``
in the *replacement* as "everything before the match", so a comment ending in
`` `$` `` spliced the first 900 lines of `compile.ts` into the middle of itself.
The file typechecked as garbage and had to be reverted. The rule in "Before you
start" now covers both halves: use the Edit tool for engine source, and if a
script must do it, never let card text or code near a replacement string.

## Done: eight moments the engine did not know about (5 Sep 2026)

Straight off the orphan-trigger list in `arena:gaps`, biggest first. 800 → 726
[Auto] skills that compile and now have a moment to fire at. Nothing here is a
new mechanism; each is a moment the engine already reached and did not announce.

- **`spiritBoostPaid`** (22-43-3, 16 cards). Sixteen cards watch the *cost*
  being paid rather than a marker leaving, from both ends — the Unison it came
  off ("from this card") and the Battle Cards watching it ("from one of your
  Unison Cards"). It could not widen `markerRemoved`, because an opponent's
  attack knocking markers off (13-5-2) is that moment and not this.
- **`youCombo`** (5-7, 14 cards). "When you use a card in a combo" is the
  board's moment, watched by your own cards in play. `comboed` is the combo
  card's own skill and fires when it leaves the Combo Area (8-5-8) — two
  different things that had been one. A combo a *skill* makes now announces
  itself to both players, which it never did.
- **`restedBySkill`** (1-10, 9 cards). Your skill and your card: an opponent
  resting it is a different moment.
- **`unionActivated`/`overlordActivated`/`overRealmPlayed`** (22-13, 22-40,
  22-15; 17 cards). The keyword being used, watched by that player's cards in
  play. The moment is the activation, not the choice that follows it.
- **`droppedFromBattle`** (3-1, 4 cards). A skill put the card out of a Battle
  Area *and* it ended in the Drop. Again not a widening: a card bounced to the
  hand is `removedFromBattle` and not this.
- Two wordings that only needed the regex: "when this card in a Unison Area is
  placed into its owner's Drop" and "when you add this card to your Z-Energy".

The pattern in all of them: **a printed wording is a claim about *when*, and
two wordings that look alike are usually two moments.** Widening an existing
regex is right only when the wider one would never fire at a moment the card
does not mean — which was true twice out of eight here.

## Done: the prices the engine would not charge (5 Sep 2026)

A skill whose price cannot be read is never offered — the engine will not waive
one — so this bucket is skills that compile perfectly and can never be used.
160 → 67. The probe technique of §5.3b again: dump every unreadable price as
printed, and the clusters name themselves.

- **Circled numbers** (6). A few sets print a colourless skill cost as `③`
  where the rest print `{3}`. Normalised in `skillLines`, so `orbsIn`,
  `costText`, `costIsOnlyOrbs` and `splitCost` all see one form — fixing it in
  any one of them would have left the other three wrong.
- **`priceCondition`** (14). A dozen cards state the condition bare: "Your
  Leader Card is a green ≪Android≫ card", no "if". Four call sites tested for
  a leading if/when/while/during; they now share one reader. A bare condition
  is only read **after** the price has failed to be an action, because the
  action is the stronger reading — guessing the other way hands out a free
  skill, and that asymmetry is the whole of the rule.
- **Filtered discards** (10). "Discard 1 mono-green card from your hand" is
  still the owner's choice (20-7) but only among the cards described, which the
  `discard` op cannot say — so it compiles to the same choose-then-move that op
  splices for the unqualified case. "Discard **this card**" is the opposite:
  the card is named, so nobody chooses.
- **Tokens** (15). "Choose 1 of your Earthling Tokens", "up to 2 Cell Jr.
  tokens", "switch 1 of your Chilled Army tokens to rest". A `token` flag on
  the filter carries the type with the name, so a printed card of the same name
  is not matched.
- **"…and place this card under it"** (5): the host is the card the clause
  before just chose.
- Two words: "switch … to rest" without "Mode", "place … **on** the bottom of".

Two traps caught by probing the *result* rather than the compile:

1. The first token regex captured `"of your earthling"` — a character class
   that admits spaces starts as early as it can. It is now bounded to three
   words with the grammar stripped off the front, and the test pins both the
   name and the fact that "1 token with combo power" names no token.
2. `splitClauses` cut "Cell Jr. tokens" in half at the full stop, leaving
   "remove them from the game" with nothing to remove. A real sentence never
   carries on in lower case, which is the whole fix.

## Conventions worth keeping

- Card text is **read, never interpreted**: if the compiler cannot read a
  clause, the whole skill goes to the referee rather than half-resolving.
- Only skills the engine can both **pay for and resolve** are offered as actions.
- Anything Claude decides comes from `legalActions`, so an answer can be wrong
  but never illegal.
- Every new op must be added in four places: the `Op` union, the interpreter
  switch, `OP_NAMES`/`validateProgram`, and `EFFECT_LANGUAGE` in
  `src/lib/arena/ai/opponent.ts`. Miss the last one and the referee will never
  use it.
- `describeScript` in `compile.ts` renders programs for the card inspector; add
  a case there too, or the inspector silently drops the op.

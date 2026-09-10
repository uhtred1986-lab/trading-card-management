# Arena rules engine — current work list

Rewritten 10 Sep 2026 to keep this file short and actionable. Use this file
for **current priorities only**. The round-by-round build notes, merged
increments and lessons learned now live in `docs/arena-history-lessons.md`.

## Start here

1. `docs/arena-next-session-prompt.md` — the live handover, current priority
   order and measurement discipline.
2. `docs/arena-tooling.md` — what each verification command proves.
3. `docs/arena-backlog.md` — the tracked issue list and stage table.
4. `docs/arena-history-lessons.md` — archived history and lessons; open it only
   when a current item needs earlier context.

## Current stage

- Stages 0 and 1 of the rules-language programme are done.
- Stage 2 (**Arena M1 — Rules correctness and parser coverage**) is the active
  compiler track.
- The standing rule remains: **prefer unread to wrongly read**, and update
  `src/lib/arena/glossary.ts` in the same commit as any change to what the
  compiler or engine understands.

## Priority order

1. **Run another wrongly-read clause audit** (`docs/arena-next-session-prompt.md`
   §4(a); backlog issue #93).
2. **Implement the structural side-parsing fix** in `parseTarget`
   (`docs/arena-side-scope.md`; backlog issue #94).
3. **Pay the remaining measured Stage 2 correctness debts**: specified-cost
   reducers (#96) and the skill-cost reduction family (#97).
4. **Continue the remaining Stage 2 primitives** from `docs/arena-backlog.md`
   once the items above are either merged or explicitly deferred.
5. **Keep capability-gap work separate** from wording commits: replacement
   prompting and marker/[Empower] follow-ups stay in
   `docs/arena-move-replacement-scope.md` and
   `docs/arena-markers-stage-scope.md`.

## Every increment

- Take fresh `arena:tally` and `arena:readings` baselines before editing.
- Diff the gap set **and** the readings; sign off moved readings by card.
- For code changes, keep the gate clean: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`, and
  `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40`.
- Put durable lessons and completed-increment writeups in
  `docs/arena-history-lessons.md`, not back into this file.
# Arena rules engine — the work list

> **Historical note (10 Sep 2026):** This file is the early round-by-round work log for the rules
> programme. It is still useful for history and lessons learned, but it is no longer the cheapest
> or most current entry point; start with `docs/arena-INDEX.md`, then
> `docs/arena-next-session-prompt.md`, `docs/arena-tooling.md`, `docs/arena-next-stage-spec.md`,
> and `docs/arena-backlog.md`.

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

A caution learned the hard way, three times: **never write engine source
through `node -e`.** `\b` inside a shell-quoted string becomes a literal
backspace and silently breaks a regex — on the third occasion it turned off five
trigger patterns at once, and they typechecked and passed every test while
matching nothing. `` $` `` in a `String.replace` *replacement* means "everything
before the match", which once spliced 900 lines of `compile.ts` into the middle
of itself. Use the Edit tool. If a file already contains one of these, find it
with `grep -c $'\x08' <file>`.

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

## Done: the cards that could not be played, and were (5 Sep 2026)

Fifteen cards print "This card can't be played by skills from any area" or its
mirror, "…from any area except by skills". Both compiled cleanly and neither
did anything, so a skill could fetch any of them out of a Drop, and a card that
may *only* arrive by a skill could be played straight from the hand. Inert
[Permanent]s 98 → 83; the static layer's "applied" figure 47.8 % → 48.3 %.

Three things had to change, and the first is the interesting one:

1. **`connective` was skipping the sentence as a reminder.** A rule listed
   under "reminders that restate a rule the engine already applies" — except
   the engine applied nothing. The skip now only covers "this card can't be
   played" with no mention of skills. *A comment that says a rule is handled
   elsewhere is a claim, and claims in comments are not tested.*
2. **`Prohibition.bySkill`**, because the two wordings are opposites: one bans
   the skill and leaves the player's play alone, the other bans the play and
   leaves the skill alone. A rule that names one says nothing about the other,
   so an absent `bySkill` still covers both.
3. **`ownProhibitions`**, a card's own [Permanent] bans read wherever the card
   is (9-1-3-3). `staticEffects` covers play, the hand and the Z-Deck, which is
   right for a skill about the board — but these cards say "from any area" on
   purpose, and the moment that matters is a skill reaching into the *Drop*.
   Widening the static layer to every area would put a fifty-card deck through
   it on every call; this reads the one card being asked about.

Left unread on purpose: "by skills other than its own" and "with non-[Evolve]
skills". An exception the engine gets wrong bans a play the card allows, and a
gap here only means the card stays as playable as it was.

Also fixed the measure itself: a [Permanent] whose whole text is a parenthetical
reminder emits nothing because there is nothing to emit, and counting those made
the inert figure 4 skills too pessimistic. What remains in that bucket is mostly
deck-construction ("you can't include … in your deck"), which is 6-1 and not a
rule of play — worth excluding next time this measure is touched.

## Done: whose turn it is (5 Sep 2026)

The owner's note — "an effect of a player might affect the opponent, on the
opponent's turn" — turned out to name four separate bugs, all of them the same
mistake: reading a wording against **the turn player** when it is written from
**the controller's** chair. None of these is a missing feature; every one of
them made a card that compiles do the wrong thing in a real game.

1. **"At the end of your turn" fired at the end of both turns.** One trigger
   matched `(?:your|the|your opponent's) turn` and was pended for both players,
   so 164 cards that act at the end of *your* turn also acted at the end of the
   opponent's, and the 13 that wait for the opponent's turn fired a turn early
   as well. Now `turnEnd` and `opponentTurnEnd`, each pended for one side.
   `opponentTurnStart` joins them for the four cards that print it.
2. **A skill that merely *mentions* a turn boundary was triggered by it.** 116
   skills say something like "…, and at the end of the turn, flip all face-up
   cards in your life face down" — a delayed effect, in a skill that already
   has its own trigger. Each was pending its whole text again at every turn
   end. A trigger is the **head** of the sentence, so the timing triggers are
   now matched against the head and nothing else (allowing for a condition
   printed in front of it, with a comma or with the sets' own bar).
3. **One "draw 1 card" drew five.** 7-4-4 repeats the End Phase when a skill
   *newly* triggers while it runs, and the turn-end skills were re-offered on
   every pass, up to the loop's cap. They are now pended on the first pass only.
4. **Every duration a [Counter] created lasted a whole turn too long.** "Until
   the end of your opponent's turn" and "until the start of your opponent's
   next turn" were expired against the turn player *at the moment the effect
   was made* — right only when you make it on your own turn, and a [Counter]
   resolves on the opponent's turn by definition. `ContinuousEffect` now
   carries its `master` and `endTurnRelativeEffects` reads both durations
   against that. The same reading fixes the delayed-effect scope
   `opponentNextTurn`, which demanded a *later* turn and so skipped the very
   turn it was about.

**And the tooling lesson bit for the third time, in its worst form yet.** A
bulk `node -e` edit turned `\b` into a literal backspace inside five trigger
regexes — `chargeStart`, `battleEnd`, and the three battle steps. They compiled,
typechecked, passed every existing test, and matched nothing at all. The only
visible sign was the orphan-trigger count going *up* by 128, which looks exactly
like the measure becoming more honest. It was caught by asking why the top of
that list was full of wordings the engine should already read. There is now a
positive test for every head-anchored timing trigger, because an anchor that
matches nothing is the same silence as no rule at all.

Orphan triggers 726 → 751: the residue is honest, being the mid-sentence
timings that used to match spuriously and whose skills have no other recognised
trigger.

## Done: which card the trigger was about (5 Sep 2026)

Following the same thread. An [Auto]'s trigger clause is dropped before the
effect is compiled — by the time it resolves the trigger has fired, so the
clause is not an instruction. But the clause also says **which card** the
skill is about, and dropping it dropped that: "when your opponent plays a
**Battle Card**" fired when they played an Extra, and "when your **≪Turtle
School≫** card attacks" fired for anything of theirs that attacked.

The engine already binds the card as the trigger's `subject`, so what the
clause said about it now becomes a condition on that subject
(`subjectFilterOf`), and the whole program sits inside it. Two guards, both of
them the same principle — **a wrong filter stops a skill that should happen,
which is worse than an over-fire**:

- Only the shapes where the subject is unambiguous: the player playing a card,
  and the card being played or attacking. Anything else keeps firing as before.
- A phrase naming **alternatives** ("a Battle Card **or** Unison Card") is
  refused outright, because `parseFilter` keeps only one of the two kinds. "An
  energy cost of 5 **or** less" is one bound and not two kinds, so the numeric
  wordings are taken out before that test.

With the filter in place it became safe to add **`youPlayed`** — "when your
blue ≪God≫ card is played", "when you play a red ≪Android≫ card", the mirror of
`opponentPlayed` and most often printed on a Leader. About 25 cards; orphan
triggers 751 → 690. A trigger that names *how* the card was played ("by a
[Union] skill", "using [Swap]", "from your life") is left out, because the
engine cannot check that and firing on an ordinary play would be worse than
not firing at all.

**One judgement call to confirm with the owner:** the card just played is among
the watchers, so a ≪God≫ card printing "when your blue ≪God≫ card is played"
sees its own arrival. Its skills are valid in the area it now sits in (9-1-3-1)
and the event it names has happened, which is the reading the rules text
supports — but the manual does not say so outright.

## Done: when the choice is theirs (5 Sep 2026)

Still the same thread — a skill of yours acting on the other player. "Your
opponent chooses 1 of their Battle Cards and KOs it" was the largest unread
clause shape outside the hand, about 25 clauses, and it is a *different game*
from you choosing: they give up their weakest card, not their best.

- The clause compiles to a `choose` with `chooser: "opponent"`, which the
  interpreter already honours (20-7, "whoever the card says chooses, chooses").
  The plain hand discard was already right — the `discard` op splices the same
  choose — so this is every other area: their Battle Area, their energy, their
  Unisons, their Drop, their hand when the wording is not a bare discard.
- The verb after it is left in the third person by the split, because the
  sentence's subject was the opponent: "…and **KOs** it". `THIRD_PERSON` gained
  `kos`, `plays`, `draws`, `reveals` — without which the KO half of the
  commonest wording was simply lost.
- "Your opponent reveals the top card of their deck" (10) and "your opponent
  draw 1 card" (14, the sets print the verb uninflected) read now too.
- "If **it's** a Battle Card" is the same sentence as "if that card is a Battle
  Card", contracted, and the reveal wordings print it as often as the long form.

Also fixed a display bug found while checking the readings: `describeCond` for
`varMatches` handed a bare filter to `describeSelector`, which wants a count and
an area, and printed "that card is undefined in your undefined" in the card
inspector. There is now a `describeFilter`.

An audit that came up clean, worth recording so it is not repeated: every
compiled skill that says "your opponent chooses … from their hand" already asks
them, because the `discard` op splices the choice with the right chooser.

Coverage 84.0 % → 84.5 %; unread clauses 1,226 → 1,207; orphan triggers 690 →
685 (two cheap widenings: "when an opponent's Battle Card is KO'd **by this
card's attack**", and "when **this card in your hand** is used in a combo").

## Done: sentences cut into nonsense (5 Sep 2026)

Chosen by asking a narrower question than usual: **what can the owner's own
twelve decks not read?** 68 clauses across 54 wordings — almost no repetition,
so it looked like a long tail of phrase patterns. It was not. Several entries
were single words — `energy`, `choose 1`, `<Broly>` — and a fragment naming no
action is not a missing pattern, it is `splitClauses` cutting a sentence in the
wrong place and failing the whole skill.

- **A pair of dashes hangs a description off the target.** "Play up to 1 <Son
  Goku: GT> or <Vegeta: GT> card ―both mono-green, with an energy cost of 5 and
  20000 power― from your Drop": everything between the pair belongs to the
  phrase in front of it, commas and all. Only when they come in pairs — a lone
  dash is ordinary punctuation, and treating it as an opener would swallow the
  rest of the sentence. This one fix is most of the jump below, because the
  aside is a house style across many sets.
- **"…your opponent's Battle Cards *and energy*"** is one phrase naming two
  areas, exactly like "Battle Cards and Unisons" already beside it in
  `AREA_AFTER_AND`.
- **"look at the top 3 cards …, *choose 1*, and add it to your hand"** (20-12):
  the middle clause does not repeat what is being chosen among, because the
  clause before it just said. And a bare "choose" left by "choose **and**
  activate 1 {Broly's Ring}" is a connective: the choosing is how that action
  picks its card.
- **"If you chose *not* to add any cards to your hand"** (20-16) — the other
  half of "if you do", and the half that decides whether the rest happens.
- **BT1-074 closes its tag with a brace**: "[Auto} When a card evolves into
  this card". Unread, the tag is not a tag, so the line became a [Permanent]
  whose text opens with its own trigger.

Coverage 84.5 % → **85.2 %**, which passes the spec's §7 target; the owner's
decks 90.2 % → **91.6 %**; their unreadable clauses 68 → 62. Unread clauses
across the catalog 1,207 → 1,183.

**The lesson is about where to look.** The catalog-wide gap list ranks by how
often a wording appears, which buries anything that happens once per card and
rewards adding patterns. Ranking the *owner's decks* instead surfaced a
structural bug that was costing whole skills everywhere — and the tell was that
the "wordings" were single words.

## Done: the decks, asked the other three questions (5 Sep 2026)

Having ranked the owner's decks for *unreadable* clauses last round, the sharper
question is what in those decks **compiles and still cannot happen**. Ten skills
had no trigger, one had an unreadable price, no [Permanent] was inert. Working
those ten:

- **"KO-ed" / "KO-s".** Older sets hyphenate the verb, and every reader of the
  text spells it the other way. Normalised in `skillLines` beside the circled
  numbers, so the compiler's own clause patterns get it too.
- **`yourCardKoed` / `opponentCardKoed`** (34 cards catalog-wide): a card of
  yours being KO'd, watched by the rest of your board — "when your blue <Son
  Goku> card is KO'd, you may play this card from your hand" — and the same
  from the other side. `koed` is the KO'd card's own skill and is not this.
  Only the plain wording: "…KO'd **by an opponent's skill**" and "…KO'd **or
  removed from a Battle Area**" name a cause the engine cannot tell apart from
  a battle KO, so the comma or the end of the clause is what says the sentence
  stopped there. `subjectFilterOf` gained the KO shape, so "your **blue <Son
  Goku>** card" is still the filter.
- **[Spirit Boost] with an adjective**: "one of your **red** Unison Cards".
- **`youPlayed` now refuses an alternation.** "When a blue **or** yellow
  ≪Universe 6≫ card is played … that card gets +5000 power" — `parseFilter`
  keeps one colour of the two, and this trigger fires on *every* card that
  player plays, so an unreadable description has to mean "do not fire" rather
  than "fire unfiltered". It is an honest orphan again.

And the tool: **`npm run arena:gaps -- --decks`** narrows every count in that
report to the cards in the owner's decks. Worth a flag rather than a one-off,
because the catalog-wide list ranks by how often a wording appears — which
buries anything happening once per card and rewards adding phrase patterns.

Deck orphans 10 → 7, catalog orphans 691 → 677; coverage 85.2 % → 85.3 %. The
seven left in the decks each need a mechanism rather than a pattern: a life card
moving areas, a skill resting the opponent's energy, the leader being attacked.

## Done: the last moments the owner's decks were waiting for (5 Sep 2026)

Seven skills in the owner's twelve decks compiled and had no moment to fire at.
Each needed a mechanism rather than a phrase, and each turned out to be small
and exact. Deck orphans **7 → 2**; catalog orphans 677 → 654.

- **`leftBattleToDrop`** (4 cards). "When this card is placed in the Drop Area
  from the Battle Area" with *no cause named* — which is every cause, a skill
  and a battle KO alike. It cannot widen `droppedFromBattle`, because that one
  says "**by a skill**" and a KO is not a skill; the two are pended from
  different places and the negative lookahead is what keeps them apart.
- **`yourLeaderAttacked`** (3). Printed on a Battle Card. The Leader's own copy
  of that sentence was already `attacked`, because a Leader is a card in play
  like any other — so this is only for the ones printed elsewhere.
- **`youTookDamage` / `opponentTookDamage`** (11). The wordings all say "from a
  non-keyword skill" or "from a skill on one of your Battle Cards", and only the
  `damage` op reaches the pend — battle damage takes a different path — so the
  first half is the moment itself, and the second is answered by the area the
  source card sits in.
- **`lifeLeft`** (3). A life card leaving the Life Area, by damage or by a
  skill; the [Critical] case is the one that says "placed in your Drop".
- **`restedTheirsBySkill`** (1), the other end of `restedBySkill`: your skill
  resting one of *theirs*. The only printed wording names their Battle Cards
  and energy, and that is exactly where it is pended.
- One widening: "placed in **your** Drop Area from your Unison Area" — the
  regex only knew "a Drop Area".

The two left in the decks are both deliberate: the alternation `youPlayed`
refuses on purpose, and one card asks whether the opponent switched energy to
Active Mode with a non-[Awaken] skill.

## Done: paying for a [Counter] with something other than energy (5 Sep 2026)

The largest remaining unread shape in the catalog, and a whole mechanism rather
than a phrase: **"You can activate this card's [Counter] skill from your hand
without paying its energy cost by \<doing something\>"** — 22 clauses. The
engine already had `altCost`, but only for the two fixed prices it knew, `none`
and `life`. Everything else was unread, so those skills could only ever be paid
for with energy the player may not have.

- **`AltCost.pay: "program"`** carries an `Op[]`, compiled by the *same* reader
  as a printed action price (4-3-3) — it is the same vocabulary, so it should
  not have a second one.
- **It is charged through the flow, not inline.** `payAltCost` returns a
  boolean and has nowhere to ask, and most of these prices need the player to
  pick a card. The [Counter] path now unshifts the price as a `script.step`
  after the counter's own steps, so it runs *first*, which is the same shape a
  printed action price already used.
- **`canPayCostProgram` moved from `engine.ts` to `state.ts`**, because
  `altCostFor` has to ask the same question about the alternative price. One
  definition is the only way two answers cannot drift apart — the lesson from
  the three measurement scripts, applied before it went wrong rather than
  after.
- The two *play* sites still pay inline, so `altCostFor` refuses a program
  offered for a play rather than waiving it. Nothing compiles to that today;
  the referee could, and silently free is the wrong failure.
- Two wordings fixed on the way: the waiver and the price are printed in either
  order ("**without paying its energy cost** by discarding…" and "by adding a
  card from your life **instead of paying its energy cost**"), and the price
  hangs off "by" so it is written as a gerund — "by **choosing** … and
  **placing** …" — which `imperative` turns back into the verbs every pattern
  in the compiler expects.
- The sentence is read **before** `splitClauses`, because splitting it hands
  the price's second half to the clause list as an orphan. A standing
  permission is one sentence, not a list of actions.

[Permanent] skills that emit a standing effect: 48.6 % → **49.5 %** of 1,807.

## Done: lists are not sentences (5 Sep 2026)

The same tell as the em-dash round, and the same lesson: the top of the unread
list was full of **single words** — "you" ×29, "battle area" ×20, "blue" ×11,
"green" ×11, "hand" ×10, "drop" ×10. A fragment naming no action is never a
missing phrase pattern; it is `splitClauses` cutting a sentence in the wrong
place, and it fails the whole skill.

The cause this time: **comma-separated lists**. "This card is also treated as
red, blue, and green", "play up to 1 card from your hand, Drop, or Warp", "all
cards in your opponent's Leader Area, Battle Area, and Combo Area get -5000
power", "cards in your energy and Z-Energy". 98 skills lost a fragment; 5 do
now.

Three rules, and the shape of each was decided by what would go wrong:

1. **`inList`** protects a comma when the run of items either side of it are
   list *words* — a vocabulary of colours and areas, deliberately, not "any
   short phrase". Protecting a comma that is a real sentence break merges two
   instructions into one unreadable clause, which is a worse failure than the
   fragment.
2. **`andEndsAList`** protects the "and" that ends such a run, but **only when
   a comma run is already there**. Without that requirement "if your Leader
   Card is yellow **and** your life is at 4 or less" reads as a list, because
   "yellow" and "life" are both list words. Two conditions are not a list, and
   the comma is what tells them apart — a test that failed on exactly this is
   in the file.
3. **`andJoinsTwoAreas`** for the version the sets write without a comma —
   "while in your deck **and** Drop Area" — where *both* sides have to be an
   area, which is what keeps rule 2's counter-example out.

Plus "you" in `TARGET_BEFORE_AND`, and a pattern for the sentence behind it:
"you and your opponent draw 1 card" is one instruction about both players.

Coverage 85.3 % → **85.6 %**. The [Permanent] figures moved most, because the
colour lists are nearly all [Permanent]: read 53.5 % → **56.3 %**, and emitting
a standing effect 48.6 % → **51.5 %** of 1,807. Fuzzer run at the spec's own
bar this time: 40 games, 0 crashes.

## Done: four sentences out of the owner's decks (5 Sep 2026)

Worked from `npm run arena:gaps -- --decks`, taking the ones that were a
pattern rather than a mechanism. Deck clauses 50 → 47; [Permanent] skills that
emit a standing effect 51.5 % → **52.4 %** of 1,807.

- **"during your turn" is a condition, not a duration** (9-9). "This card gains
  +5000 power and [Critical] **during your turn**" — the bonus is there only
  while it is your turn, which on a [Permanent] the static layer asks again
  every time. It is deliberately *not* in `TRAILING_QUALIFIER`: stripping it
  would give the card [Critical] always. This replaced an older test that
  asserted the tail must fail rather than be discarded — the lesson still
  holds, so that test now points at a tail the compiler really does not know.
- **"and" before a keyword tag is not a sentence break** when the clause is
  giving one subject two things: "+5000 power **and** [Critical]".
- **"increase the energy cost … by 2"** (20-21) is the reduction with its sign
  turned round, and `describeScript` no longer says "costs -2 less".
- **A comma before "except"** is never a sentence break: "you can't include
  non-≪Universe 6≫ Battle Cards in your deck, except for \<Vegeta\> cards" was
  losing its exception to the clause list.
- Also protected: the two-colour list the sets write with a comma and no "and"
  ("blue, yellow ≪Universe 6≫ cards"). That one still does not compile, because
  `parseFilter` reads two colours as *both* rather than *either* — but it is
  one honest gap now instead of two fragments.

## Done: two silent mis-reads behind one unread clause (5 Sep 2026)

Chasing the one clause left over from the round above — "reduce the combo cost
of **blue, yellow** ≪Universe 6≫ cards in your hand by 1" — turned up three
bugs, and only the first was the one I was looking for. All three are the kind
ground rule 5 is about: the clause compiles, nothing reports it, and the
reading is wrong.

1. **Several colours in one description meant *all* of them.** `matches`
   required `f.colors.every(...)`, so "blue, yellow ≪Universe 6≫ cards" matched
   nothing at all — no card is both. A list of colours means *either*; a card
   has to be all of them only when the text says one card in both colours at
   once, which is what "Red/Yellow **multicolor**" says. That distinction is
   now the `multiColor` flag's job, and it also makes "your red **or** blue
   Battle Cards" read correctly for the first time.
2. **A digit inside a name was read as a count.** `parseTarget` masks power
   figures, energy costs and `z-N` before looking for a bare number, but not
   the brackets — so "your ≪Universe 6≫ cards in your hand" was **six** of
   them, and "\<Android 18\> cards in your Battle Area" eighteen. **533 skills
   on 436 cards** name something with a digit in it (≪Universe 7≫ ×119,
   ≪Universe 6≫ ×73, \<Android 18\> ×58, \<Super 17\> ×30 …). Not every one
   reaches that branch — an explicit "up to N" is read first — but every one
   that did was sized wrongly and silently.
3. **A cost change could not carry a duration.** The pattern was anchored to
   the end of the *raw* clause rather than the one with its tails stripped, so
   "…by 1 **for the duration of the turn**" went unread. One character's
   difference, `t` → `q`.

The lesson is the one the spec already states, earning its place again: chase
the clause that does not compile, but check what its *neighbours* compile to
while you are there. The unread clause was the cheapest of the three to fix and
the least important.

## Done: auditing the selectors against their own words (5 Sep 2026)

Having found two silent mis-reads by accident, this round went looking for them
on purpose. **A `choose` op records the clause that produced it in `reason`**,
so the compiled selector can be checked against its own words — 4,000-odd of
them, with no card text to read by hand. The probe flags a selector whose side
or area the clause does not support, and the first run was mostly its own
noise: "…to your hand" is where a card *goes*, "energy cost" is not the energy
area, `special: self` names no area at all. Narrowing those left ten real ones.

Three area words the parser could not hear, none of them ever reported because
the clauses all compiled:

- **"in your opponent's Drop"** — the one possessive the Drop line did not
  admit (`in your` matched, then "drop" did not follow), so the phrase fell
  through to the Battle Area and chose a card in play instead of one in the
  Drop. Every other area word already read the possessive; this one was simply
  missed.
- **"your Red/Blue multicolor energy"** — the adjectives between the possessive
  and the word are matched with `[a-z-]+`, and a slash is neither. Six cards
  that rest a multicolour energy went looking for it on the table.
- **"in your opponent's Battle Area or Drop"** — the possessive sat where
  `AREA_PAIR_RE` expected the first area word, so the pair went unread and the
  phrase took whichever single area matched first.

Left alone, with the reason: "Choose up to 1 Unison" would need a bare singular
"Unison" as an area word, and the same word in "**play** up to 1 blue Unison"
means one in the hand. One card gains, four lose; the parser cannot tell them
apart without the verb, so it stays as it is.

**The technique is the reusable part.** `arena:gaps` can only report clauses
that fail; a clause that compiles wrongly is invisible to every measure in the
project. Anything the compiler records alongside its output — `reason` here —
is a way to audit the compiled result against the text it came from.

## Done: ground rule 5, done mechanically (5 Sep 2026)

The same audit turned on the *filters*: for every compiled `choose`, does the
filter carry every measure its own `reason` clause names? A measure the parser
drops **widens** the selection, and nothing reports it. Two clean results and
three findings.

- **`notColors`** — "2 **non-black** Battle Cards in your opponent's Drop Area"
  chose black ones as happily as any other. Worse, `filterFor` then threw the
  whole filter away, because its "does this narrow anything?" test did not
  count a measure that says what a card must *not* be. Both halves fixed.
- **`notKeywords`** — "a blue **non-[Super Combo]** Battle Card", "a red
  **non-[Field]** Extra Card". Read off the *printed* skills, which is what the
  wording is about: a keyword an effect granted this turn does not make the
  card one of these.
- **`notToken`** (19-1-5) — and it has to be read *before* the token name, or
  "non-token Battle Cards" is a token called "non".

Clean, and worth recording so nobody audits them twice:

- **Delayed effects.** Every compiled `delay` records its clause in `label`;
  its timing and its scope agree with those words in every case. After the
  turn-ownership round that is the answer one wants.
- **Counts.** 101 selectors carry a count the text does not print, and every
  one is the default of 1 for a phrase that names a single card — "the top card
  of your deck", "your Leader", "\<Spike\>". No mis-sizing left after the
  ≪Universe 6≫ fix.

**The technique generalises past this project.** `arena:gaps` can only report
clauses that *fail*; a clause that compiles wrongly is invisible to every
measure here. Anything the compiler records alongside its output — `reason` on
a choose, `label` on a delay — is a way to check the result against the text it
came from, in bulk, without reading a single card by hand.

## Done: a batch off the top of the miss list (5 Sep 2026)

Small ones, taken together. [Permanent] skills emitting a standing effect
52.4 % → **53.0 %**.

- **"Only 1 X can be played in your Battle Area"** is printed three ways, and
  only the first was read: "you can **only have up to** 1 {X} in play in your
  Battle Area" arrives with its "you can" already stripped off the front of
  `t`, and "only 1 **copy of this card**" has to be tried *before* the general
  form — which would otherwise take "copy of this card" for a description of
  the cards and fail on it. Thirteen cards.
- **"Your opponent shuffles their deck"** (20-12-3): a search of *their* deck
  is theirs to shuffle.
- **"during that turn"** is the turn the sentence has been talking about — the
  same duration as "during this turn", said with a different pronoun.
- **"shuffle any areas you looked through with this skill"**: the same
  reminder the connective list already skipped, with three words on the end.
- `describeScript` now says *which* cards a prohibition is about; "you can't
  play cards" was the whole of it before.

**Not done, and the reason.** "If they don't" (27 clauses) needs the thing
before it to have been an *offer the opponent declined* — "your opponent **may**
choose 1 of their Battle Cards and KO it. **If they don't**, …". The engine's
`may` is the controller's decision; an optional action the **opponent** takes,
with `chooser` on the offer itself, is a mechanism rather than a phrase, and it
is the natural next piece. Reading "if they don't" without it would give the
condition nothing to be the opposite of, which is the gap it already honestly
reports.

## Done: an offer the *opponent* declines (6 Sep 2026)

The mechanism the round before stopped at. "Your opponent **may** choose 1 of
their Battle Cards and KO it. **If they don't**, draw 2 cards" — 27 clauses said
"if they don't" and had nothing to be the opposite of, because `may` only ever
knew one decider.

- **`may` gained a `chooser`.** The skill is still yours; only the answer is
  theirs (20-16). `compileClause` strips "you may" so every pattern below sees
  a bare instruction, so this strips the other subject and remembers whose
  decision it was — that difference is the whole feature.
- The `choose` ops **inside** the offer get the same chooser: "choose 1 of
  their Battle Cards" is theirs to pick as well as theirs to decline. The
  selectors already pointed at their cards, because the sentence said "their".
- "If they don't" then reads their answer through the `did: "may"` condition
  that already existed, with no change at all.
- Two descriptions were wrong and are not now: `may` always said "you may", and
  the `did` chain fell off its end so `may` read as "you negated the attack".

Coverage 85.7 % → **85.9 %**.

## Done: a crash the fuzzer caught, and where it came from (6 Sep 2026)

`arena:fuzz 40` reported one crash, and the honest first question was whether
the change above had caused it. It had not: restoring the two engine files from
`HEAD` and re-running the same seed reproduced it exactly. It arrived with a
**new deck the owner added** — one built around BT6-001, a `[Union-Fusion]`
Leader.

A `[Union-Fusion]` asks for two characters at once, and both the board and the
move list answer **one card at a time** — the handler right below the check
keeps what was picked and asks again for the rest. So the minimum is owed on
the *last* answer, not on every one; checking it on each made the prompt
unanswerable, because a single card was the only thing on the menu and the
engine threw on it.

Two things worth keeping from this:

1. **Check whether a new failure is yours before fixing it.** Copying the
   changed files aside, `git checkout --` them, and re-running the same seed is
   a minute's work and settles it.
2. **A crash only appears when a deck reaches the code.** The fuzzer plays the
   owner's decks; every deck added is new coverage, and this bug had been
   sitting in the [Union] path since it was written.

## Done: a quality check of the last stretch, which did not come back clean (6 Sep 2026)

The stretch of 5–6 September was mostly *correctness* fixes to clauses that
already compiled. Nothing in `arena:gaps` would have caught those, and nothing
would catch a mistake in them either — so this round proved them before adding
anything. Four of the five held. One did not, and looking for it turned up four
more mis-reads of the same kind that had been there all along.

**Where the audit said "clean", in one paragraph each.**

- **The three list guards** (`inList`, `andEndsAList`, `andJoinsTwoAreas`) are
  sound. Every skill was split twice — once by the compiler, once by a copy of
  it with the three guards forced to `false` — and the 119 clauses they keep
  whole were read one by one. Every one is a genuine list: areas joined by
  "and" ("in your deck and Drop Area"), colours in a comma run ("treated as
  red, blue, and green"), alternative card descriptions ("from your hand, Drop,
  or Warp"). **Not one is two instructions merged**, which is the failure they
  could have caused. The 48 that sit inside a skill which still fails, fail for
  an unread *mechanism* ("look through your deck and your life", "for each
  colour among…"), not for the merge.
- **Turn ownership.** A full 27-turn playthrough, whole log read rather than
  the last twelve lines. Charge/main/end alternate cleanly, every [Auto] fires
  on its controller's turn, and every `[Once per turn]` fires once. Nothing
  fires twice or on the wrong turn.
- **`subjectFilterOf`.** Its subject capture is lazy and stops at the first
  " from | in | to | with | by ", which throws away the rest of the trigger —
  including an " or " that the alternation guard exists to refuse. Seven
  triggers have such a hidden " or ", and in **none** of them does the hidden
  branch name a different card *type* from the one that was read, so the filter
  never narrows past what the card means (BT19-067's hidden branch is also a
  green Battle Card). Nine more drop a *measure* with the tail — "with an
  energy cost of 8", "with 30000 power" — which widens the trigger. That is the
  direction ground rule 6 calls acceptable, and it is left as it is,
  deliberately, rather than tightened into something that could stop a skill.
- **"Either" is the right reading of a colour list**, and `multicolor` really is
  the only wording that means one card in two colours at once. The catalog
  writes alternatives as "blue or green", "red and/or black", "—both green—";
  every slash outside the word "multicolor" is part of a *keyword* name
  ([Arrival Red/Green], [Aegis Blue/Yellow], [Revive Blue/Green]), and every
  "both" is "both <A> and <B>" or "both green", never two colours on one card.

**Where it did not: the colour fix exposed a mis-read underneath it.**

`parseFilter` harvested colour words from *inside* names. ≪Red Ribbon Army≫,
<Goku Black>, <Commander Red>, {Super Saiyan Blue Vegeta} and [Revive
Blue/Green] all contain one, and none of them says anything about the card's
colour. While several colours meant "all of them" such a filter simply matched
nothing — a missing effect. Once they meant "either", the same filter started
selecting the extra colour: "add up to 2 **blue** ≪Red Ribbon Army≫ cards"
would take a red one. **The fix was right and it turned a silent no-match into
a silent wrong selection**, which is the trade ground rule 1 forbids.

39 selectors, 25 of them widened this way, plus BT7-046's [Auto] trigger — a
filter that *gates* a skill, where being wrong stops something that should
happen. Colour words are now read off the description with every `<…>`, `≪…≫`,
`{…}` and `[…]` span blanked out. It also fixed the fourteen that were merely
over-narrow, and BT27-043, whose "This card gains ≪Red Ribbon Army≫ in all
areas" had been granting the card the colour **red**.

**Four more, all found by comparing a compiled program with its own clause.**

1. **"Choose up to 1 opponent Battle Card" chose your own.** The oldest sets
   (BT1–BT3, EX01–EX02, P-006) drop the possessive, and `parseTarget` only
   knew "your opponent's" and "the opponent's". Sixteen skills read as naming
   no side, so they defaulted to yours: BT1-082 KO'd your own Battle Card,
   BT1-036 returned it to your hand, BT1-090 rested two of your cards. Read as
   a side whenever the word carries a possessive, however it is introduced
   ("an opponent's", "ofyour opponent's" — a typo in the catalog itself), and
   when the bare word qualifies a card noun.
2. **`refFor` had neither of the two exceptions `parseTarget` makes.** It asked
   only whether the words "this card" appeared anywhere in the phrase. So
   "**other than** this card" and "other than **copies of** this card" resolved
   to this card — BT11-107 and BT17-036 played the card that was already in
   play instead of the one they had just looked at — and so did "with power
   less than or equal to **this card's** power", where the possessive belongs
   to a measure of some *other* card. Both are now read, and the possessive
   only counts when it is in the *head* of the phrase, so "**this card's
   skills** can't be negated" and "you can activate **this card's** [Activate:
   Battle]" still mean this card. That head/tail distinction is the one the
   pronoun test already made, now shared as `headOf`.
3. **Excluding a card is not the same as requiring it.** "Choose up to 1 Battle
   Card **other than** <Grand Supreme Kai>", "…other than {Vegito, Powers
   Combined}" — 36 cards, and `parseFilter` read the name straight into
   `characters`/`names`, so the filter demanded the very card the text rules
   out. Not a widening: an **inversion**, the worst way for a selector to be
   wrong. The names now go to `notCharacters`/`notTraits`/`notNames`
   (`notNames` is new) and are taken out of the text before the positive loops
   see them. SD15-01 is in the owner's own decks and does this every game.
4. **"Other than this card" needs to leave it out of the candidates, too.**
   Refusing to *resolve* to this card is only half of it: the phrase still
   offered it, so BT21-023's "choose all Battle Cards other than this card, and
   they get -15000 power" shrank the card printing it. `Selector.notSelf`
   (`"card"` or `"copies"`, because the longer wording excludes every card of
   the same name) is applied in `resolveSelector`.

Two smaller ones fell out on the way. **"and/or" ends a name list as often as
"and" does**, and `inNameList` stripped only the latter, so the comma in
"choose up to 2 ≪Saiyan≫, ≪Earthling≫, **and/or** ≪God≫ cards in your
opponent's Battle Area" was read as a sentence break — the exact failure the
list guards were written for, one conjunction short. And **"Cards chosen with
this card's skill can't be switched to Active Mode"** (P-137, XD1-06, XD1-01)
is the long way of saying "the chosen cards"; it had been putting the
restriction on the card printing it.

**Numbers.** Catalog 85.9 % and the owner's decks 91.7 %, both unchanged — as
they should be, because none of this makes a new wording readable. [Permanent]
skills that emit a standing effect went 53.0 % → 52.9 %: BT7-092's "Battle
Cards chosen with this card's skill can't be switched to Active Mode" refers to
a choice made by a *different skill on the same card*, which the compiler
cannot express, so it is now an honest gap instead of a forbid pointed at the
wrong card. One skill traded for one wrong effect removed. 40 fuzzed games, 0
crashes; `npm test`, `lint`, `typecheck` and `build` clean.

**The lesson, which is the reusable part.** Every one of these compiled
cleanly, so no percentage in this project moved when they were wrong and none
moved when they were fixed. The only thing that finds them is reading the
compiled program back against the clause it came from — and the *second* place
to look, after the compiler's own records, is a fix that has just changed which
direction a mis-read fails in. A filter that used to match nothing and now
matches too much was wrong the whole time; the fix is what makes it visible.

**Left alone, with the reason.** The [Energy-Exhaust] negators print "if you
have a red/blue multicolor card **other than this card** in your energy" as a
*condition*, and `notSelf` is on the selector, not on `condHolds`'s count —
these ten still count themselves. It is an over-fire on cards that sit in the
energy area, worth a round of its own rather than a rushed one here.
`parseFilter` also still drops a positive `[Blocker]` requirement ("up to 1
opponent Battle Card **with [Blocker]**") and reads no plural type word
("Battle **Cards**" sets no type) — both widenings, both on the list.

## Done: two measures off the deck list (6 Sep 2026)

`npm run arena:gaps -- --decks` on the 182 cards the owner actually plays: 37
of them have a skill the compiler cannot read, 52 clauses in total, and 43 of
those need no new mechanism. The list is a long tail of ones — no wording
repeats — so this took the two that generalise beyond the card that surfaced
them.

- **"…with an energy cost of 1 and no keyword skills"** was two failures at
  once. `splitClauses` cut the sentence at the "and", because
  `MEASURE_AFTER_AND` knew only cost and power as things that can follow one;
  and the measure had nowhere to land even when it survived, so on the five
  cards where the clause happened to compile the choice was offered **every**
  card in the area. `CardFilter.noKeywords` now carries it. Eleven cards print
  it, plus two that write "with no keyword skills". It is about the keywords
  only — a card with an [Auto] and no keyword qualifies — which is what
  separates it from "skill-less", a word the sets use for a card with no text
  at all.
- **"for the duration of this turn"** is "for the duration of the turn" with a
  demonstrative, and `TRAILING_QUALIFIER` allowed only the article. Every
  action pattern is anchored to the end of the clause once those tails come
  off, so one word left BT3-013's "+10000 combo power" and BT1-003's negate
  unreadable. `durationOf` learned "duration of this battle/game" at the same
  time, for the same reason.

Eight skills go from unreadable to read and five more stop over-selecting; no
skill regressed, checked by compiling the whole catalog before and after and
diffing the programs. The owner's decks **91.7 % → 92.2 %**; the catalog stays
at 85.9 %, because eight skills in 11,743 do not move a rounded figure.

**What is left in the decks, and why it was not taken.** The next items on the
list are all "one verb, two targets" splits — "each of your red Battle Cards
**and** red Leader Card gain +5000 power" (P-003), "choose 1 card from their
hand **and** 1 card from their Battle Area" (BT1-057) — and one condition
split the same way: BT6-001's "if there are 2 or more red <Son Goku: Br> cards
and 2 or more red <Vegeta: Br> cards **in your Drop Area**", where the area
belongs to both halves and the first half silently falls back to the Battle
Area. Each needs `splitClauses` to keep more together *and* `refsFor` or
`parseConditionClause` to take two subjects, and doing one without the other
turns a fragment into a wrong reading. That is a round of its own, with the
before/after diff run on the whole catalog — not a batch item.

**Ground rule 10 collected another victim, in a place it does not warn about.**
The rule says never to write a regex through `node -e`; the same escape applies
to a *replacement string*, and `String.prototype.replace` expands `$` followed
by a backtick to "everything before the match". This section's own draft
contained that pair — it was describing the `$` anchor above — so inserting it
duplicated the preceding 1,457 lines of this file into the middle of it. Use a
replacement **function**, which is never scanned for `$` patterns, whenever the
text is not under your eye at the time.

## Done: two more "and"s that were never a sentence break (6 Sep 2026)

The deferred round from the last entry, approached from the evidence rather
than from the three cards that raised it. A probe over the catalog for
**unreadable clauses that are nothing but the object of a verb** — a quantifier
and a card description, no verb of their own — found 96, and sorted by what the
clause before them looked like they fall into four shapes. Two of those are
safe to fix on their own, and are what this round does.

**A numeric range: "with an energy cost between 3 and 7".** Twelve clauses, and
the damage was not the fragment. Cut at the "and", the *left* half compiled:
"an energy cost between 3" misses the `between N and M` pattern, falls through
to the plain `energy cost N` one, and comes out as **exactly 3** — a bound
narrower than anything the card says, on a selector that then looked right. The
"7 from your deck to your hand" left over failed the skill, which is the only
reason anyone would have noticed. `andJoinsARange` keeps the two numbers
together, and `parseFilter` learned the same range for power ("with powers
between 20000 and 30000") and the plural of the cost one.

**One verb, one mode, two targets: "Switch this card and up to 1 of your energy
to Active Mode"** (1-10, eleven cards). Keeping this whole is only half the
job, and the half that matters is the other one: `refFor` collapses "this card
and up to 1 of your energy" to *this card* and drops the energy in silence,
which is worse than the fragment it replaces. So the split guard came with the
pattern — `switch` reads `refsFor` now, and each target keeps its own
`withChoice`, because only one of the two carries a number.

`andJoinsTwoSwitched` is narrow on purpose: a verb, a bare way of naming a
card, the "and", and the mode at the end of what follows. The general "verb A
and B" shape is **not** safe to keep whole while the patterns behind it read
one target — "Choose this card and all of your non-black Battle Cards" is left
splitting deliberately, with an assertion saying so, because merging it would
turn a fragment into a wrong effect. Three counter-examples are in the test
file for the same reason.

**22 skills go from unreadable to read and 9 more were already compiling
wrongly:**

- BT10-119 searched the **Battle Area** for a `<Syn Shenron>` with no cost
  bound at all; the clause had lost "and 4 **in your deck or hand**" along with
  the second half of its range. Now deck-or-hand, cost 2–4.
- P-174's "you can't play Battle Cards with power between 30000 and 35000 **for
  the duration of the game**" was lasting a turn, and had no power bound.
- BT8-091/094/095/096/097 and EX21-13 have the range in the condition before
  the colon, where it had been reading as an exact cost of 3.
- BT25-099 was losing the switch entirely.

Catalog **85.9 % → 86.1 %**; the owner's decks stay at 92.2 %, because none of
these twenty-two cards is in one of his decks. That is worth saying plainly:
this round was ranked by the catalog, and the deck figure is the one the spec
sets a target for.

**Still open in this family**, both measured and both needing a pattern change
alongside the guard, which is why they are not here: 56 clauses of "verb
`<object>` and `<object>`" ("Add up to 1 `<Son Goten>` card and up to 1
`<Trunks: Youth>` card … to your hand"), about half of which are really a
second *measure* of one card ("with an energy cost of 3 and an [Alliance]
skill") and belong to `MEASURE_AFTER_AND`; and 21 more of the verb-led shape
whose verbs are choose/send/add/place rather than switch.

## Done: the one rule of the game a card may lift (6 Sep 2026)

Counting the shapes among the unreadable clauses turned up a wording far
bigger than anything on the "only thing holding a skill back" list: **"This
card can attack Battle Cards in Active Mode" — 48 clauses**, two of them in the
owner's decks. 8-1-1 says an attack may only be declared against a Leader, a
Unison, or a **rested** Battle Card, and these cards turn that off. It is the
only permission in the game, so it gets the smallest mechanism that can hold
it: `Permission`, the mirror of `Prohibition`, with one `what`.

The op went through the five places the conventions list — the `Op` union, the
interpreter, `OP_NAMES`, `EFFECT_LANGUAGE` in `ai/opponent.ts`, and
`describeScript` — plus `STATIC_OPS` and `collectStatics`, because most of the
cards print it as a [Permanent]. `permits()` in `state.ts` is the single reader,
beside `forbids()`; `legalActions` builds the attack targets per *attacker*
now rather than once per player, since the permission belongs to the card.

**The carve-out is the part that had to be right.** Sixteen of the forty-eight
say "Battle Cards **without [Barrier]** in Active Mode", and a permission read
too widely allows an attack the card forbids — the failure direction that
matters. `parseFilter` learned "without [X]" (the long way of writing
"non-[X]"), the filter is required rather than optional, and the engine checks
it against each candidate.

**Two gaps found on the way, both by the pattern refusing to fire.**

- `filterFor("Battle Cards")` returned **nothing**, because the type words were
  anchored `\bbattle card\b` and the sets write the plural. So every phrase
  whose only measure was the type set no type at all and selected the whole
  area — the widening ground rule 5 names, and it was in 232 programs.
- Fixing that immediately broke something else, and the whole-catalog diff
  caught it: "your opponent's Battle Cards **or** Unisons" started coming out
  as **UNISON alone**, silently dropping the Battle Cards. One field cannot
  hold two kinds, so it now holds neither — the same refusal `subjectFilterOf`
  makes for the same reason. That also fixed a *pre-existing* case of it:
  "Battle Cards or Unison Cards" was already narrowing to Unisons, because
  `\bunison( card)?\b` matched the plural through its optional group while the
  Battle Card pattern did not.

Also here, from the same count: a **prohibition with no subject**. "It gets
+10000 power **and** can't attack for the turn" (DB2-004) splits at the "and",
and the second half arrives with the card it is about in the clause before it.
Fifteen clauses; `compileProhibition` now takes an empty subject and continues
`c.lastTarget`.

**51 skills go from unreadable to read, nothing regressed** — checked by
compiling the whole catalog before and after and reading the 451 changed
programs by shape. Catalog **86.1 % → 86.3 %**, the owner's decks **92.2 % →
92.9 %**, and the [Permanent] figures moved most because the permission is
nearly always one: read 57.8 % → **59.7 %**, emitting a standing effect 52.9 %
→ **54.8 %**. In the decks, [Permanent] read 66.0 % → **71.7 %** and applied
62.3 % → **67.9 %**. 40 fuzzed games, 0 crashes — worth more than usual here,
because this is the first change to what `legalActions` will offer as an
attack.

**The lesson worth keeping.** The wording that mattered most was not on any
ranking in `arena:gaps`: that report groups by the *normalised clause*, so 48
cards phrasing one rule five different ways appear as five entries of ten. A
count of the shapes — "which unreadable clauses are a bare object phrase",
"which begin with can't" — found it in one pass. When the top of the ranking is
a list of ones, stop reading it and count something else.

## Done: the keyword a target must have (6 Sep 2026)

Ground rule 5 named two measures the parser still dropped. This closes the
first: **a keyword the target must *have***. "Up to 1 opponent Battle Card
**with [Blocker]**", "a yellow ≪Demon Realm≫ card **with an [Evolve] skill]**"
— 83 selectors carried the words and none of the meaning, so each of them
chose any card in the area. BT1-036 returned any Battle Card to the opponent's
hand rather than a blocker; BT2-079 the same.

Three shapes, and they need different answers:

- **A keyword.** `CardFilter.keywords`, compared by name, so "with the [Revive
  Blue/Green] skill" also matches a [Revive] naming other colours. The narrower
  reading needs the parameters and only two cards print them.
- **A keyword *family*.** "With a [Union] skill" means any of [Union-Fusion],
  [Union-Potara] and [Union-Absorb]; `keywordOf` reads only the hyphenated
  forms a card is printed with. A one-entry list rather than a rule, because
  every other keyword is named in full and guessing is how a filter starts
  matching cards the text never mentioned.
- **A *kind* of skill, which is not a keyword at all.** "Mono-blue Battle Cards
  with a [Counter] skill", "an Extra Card with the [Activate: Main] skill" —
  `CardFilter.skillKind`, the one shape `keywordOf` cannot answer.

**And a bracket that is none of those makes the description unreadable.** That
is the part worth stating: `filterFor` now returns **three** answers, not two —
a filter, `undefined` for "nothing here narrows", and **`null` for "this could
not be read"**. Only the first two may pass. The type change made the compiler
enumerate all seven callers, and two of them were quietly falling back to a
type word: "you can't play Battle Cards with [X]" would have banned every
Battle Card, a wider rule than the card states. [Sparking 7] is the only
wording left in this family, and it fails honestly on two cards — it is a
numeric validity condition rather than a keyword, and inventing a reading for
it would select the wrong cards.

**The bug this turned up in my own earlier work.** The engine assertion failed
where the compile one passed, and the cause was that `narrows` in `filterFor`
had never been told about the new measures. A filter whose *only* measure is
one of them counts as saying nothing, and is thrown away — which is the exact
silent widening the measures exist to prevent. Four were missing:
`keywords` and `skillKind` from this round, and **`noKeywords` and `notNames`
from the two rounds before it**, both shipped that way. Every measure has to be
added in two places, and the list is now commented to say so.

25 skills go from unreadable to read, 2 fail honestly, and 116 programs carry a
requirement they had been dropping — checked by compiling the whole catalog
before and after, with the three new always-present fields normalised out of
the comparison so the real changes were visible at all. Catalog **86.3 % →
86.5 %**; the owner's decks stay at 92.9 %. 40 fuzzed games, 0 crashes.

**Worth copying: a compile assertion cannot see this class of bug.** The
program looked right — the filter was in it — and only asking the engine what
it actually offered showed the filter had been dropped a layer above. Write the
engine assertion for any measure that narrows a *choice*, not just the compile
one.

## Done: rules as records — the Rules Workbench, phase 1 (8 Sep 2026)

`docs/arena-rules-workbench-spec.md` §3, built in eight commits on PR #56. A
rule is now a row of `card_rules` — one per skill per card face, with the
program, its trigger, cost and hoisted condition, provenance (compiler | claude
| user), state (open | draft | confirmed | corrected), the unread clauses, the
plain reading and a version. The engine reads those rows and nothing else;
`npm run arena:draft` is the compiler run offline as a drafter; `/arena/rules`
is where a person confirms or corrects; the catalog sync drafts every new or
changed card and asks Claude about the skills the compiler left open.

**What the brief did not expect, and what was done about it.** `engine.ts`
did read `ctx.scripts` first, but the static layer in `state.ts` never did —
`staticEffects`, `permanentStatics` and `ownProhibitions` compiled the card
themselves, so a stored program for a [Permanent] was silently ignored.
`scripts` moved onto `GameContext` and `programsOf` is the one lookup. The
sync entry point is `importCatalog` in `src/lib/catalog/deckplanet.ts`, not a
`sync.ts`; text comes from deckplanet with errata.ts applied, CardTrader
touches none. `card_scripts` was classified by what was stored beside each
row — the old rules page saved the compiler's own rendering as `meaning`, so
those are the owner's; `clarify.ts` saved Claude's restatement and stamped it
`user` anyway, so those are Claude's — and migration 0028 copies leftovers as
Claude's before dropping, so a deploy cannot race the one-off script.

**OP_SCHEMA.** One row per op in `script.ts`: fields, types, required,
default, a sentence template (a function for the four ops whose prose turns on
field combinations). `validateProgram`, `describeScript`, the referee's
`EFFECT_LANGUAGE` and the workbench's chip editor read it. Four field types the
brief's list lacked were needed by real ops — `keyword`, `filter`, `list`,
`modes` — and are in the table rather than worked around. Adding an op is one
interpreter case and one row.

**The line count did not come down.** `src/lib/arena` is 17,431 lines against
16,826 on `main`. The layer the brief expected to be the fat was about 200
lines in this tree; the store, the drafter with its review step, the shared
grouping and the schema table are new function that has to live somewhere.
Every line that stays has one owner, which was the rule behind the number.

**Still compiled at game time:** the price before the colon (`costIsReadable`,
`canPayCostProgram`) — the row carries it as `cost.condition` / `cost.program`
and moving the engine onto that is phase 2's. Nested programs, conditions and
modal options are edited through the JSON view, not chips (phase 1 by design).

**The first run against the database (8 Sep 2026, PR #56).** Migrations 0027
and 0028 applied over HTTPS; the two `card_scripts` rows were carried over (one
the owner's, one Claude's; none used `cannotAttack`). The drafter wrote
**13,563 rules for 6,493 cards** in the original game: 2,186 open, 11,375
draft, 2 corrected — **83.9 % of skills readable** catalog-wide, **91.6 %** for
the owner's decks (489 rules, 41 open). `arena:gaps` reads the same rows, so
its numbers are these by construction; the old compile-based 86.5 % counted
resolvable skills only, without [Permanent]s, which is why it was higher. Of
the 2,946 unread clauses, 2,090 on 1,473 cards need only a phrase pattern.

The run found two bugs, both fixed in the follow-up commit. **The second
draft pass rewrote 8,341 rows**: the compiler's selectors carry keys whose
value is `undefined`, jsonb never sees those, and the comparison mapped them to
`null` on the fresh side — so every pass looked like a change and bumped 4,781
versions to 2. `canonical()` now drops such keys. **Two of 100 fuzzed games
crashed on one row**: the `claude/corrected` program carried over for BT31-132
had a filter with only the fields it meant, and `matches` read the rest
unguarded. The engine now fills a filter up before reading it; a row a person
or Claude writes may say only what it means. **The review step** (`--review
--budget 3` on BT18) ran three times: once without a key (skipped and recorded
on `arena_feedback` as designed — Claude Code on the web reserves
`ANTHROPIC_API_KEY`, hence `APP_ANTHROPIC_API_KEY`), then twice with one. Six
Opus 5 calls, three BT18 skills now Claude's drafts (BT18-043, BT18-044,
BT18-119), one honest "could not draft" (BT18-034's cost-as-action price), and
two failures that were ours: Claude wrote `{"special":"self"}` where a ref
wants `{"sel":{…}}`, the validator accepted any object as a ref, and describing
the answer threw. The validator now knows what a ref, a selector and a
condition are. BT18: 56 → 53 open. The drafts are drafts — BT18-044 reads
`{Angel Halo}` as a character rather than a name and models "on your opponent's
turn" as a duration — which is exactly what the confirm step is for.

Tests: the three suites pass with 76 new assertions — every schema row renders
and validates, the validator's refusals, the drafter's records and hoisting,
the engine playing a card as blank without its row and from it with, a
[Permanent] read from rows, a sparse filter tolerated, the comparison's dropped
`undefined`s, and on PGlite the drafter writing rows, a second pass touching
nothing, and the sync's change detection.

## Done: the catalog and the patterns — the Rules Workbench, phase 2 (8 Sep 2026)

`docs/arena-rules-workbench-spec.md` §4, built in eight commits on PR #57. The
workbench now has three worklists over the same records — the cards in your
decks, the whole catalog, and the rules grouped by the wording that produced
them — the chip editor covers the whole effect language, and `card_text_notes`
is gone.

**What the database said before any of it was planned.** 13,563 rules: 2,183
open, 11,375 compiler drafts, 3 Claude drafts, 2 corrected. Three numbers
changed the plan:

- **1,136 drafts carried no pattern key at all**, because their program is
  empty — and 1,089 of those are keyword lines whose reminder or specification
  text compiles to no steps (`[Z-Stack 1] Yellow <Son Goku> …`, `[Triple
  Strike] (This card inflicts 3 damage …)`). The record called them "nothing —
  the engine treats this skill as blank", which is the opposite of true: the
  engine plays them, from its keyword rules. They group as `keyword:<name>`
  now, the record reads "played by the engine's [Z-Stack X] rule" with the
  glossary's own line under it, and the 47 that really are empty group as
  `nothing`.
- **Clause shape is too fine a key for open rows**: 1,654 groups for 2,183
  rows, 1,347 of them singletons, the largest 12. So the Patterns page groups
  open rules by *mechanism* first — the same 16 buckets `arena:gaps` counts —
  and by shape within it.
- **`card_text_notes` was down to 190 rows on 120 skills**: 7 briefs, 9
  explanations, 7 rulings, one clause a game had met. Everything else it held
  had moved to `card_rules.unread` when the rules became records. Migration
  0030 copies the writing onto the rule and drops the table.

**Confirm all drafts in view** is what the page is for: 11,375 drafts are
never reviewed one at a time. It confirms exactly what the *filter* matches,
not the 200 rows on screen, and keeps the rows it moved on the
`arena_feedback` row as `{id, version}` pairs — so Undo puts back exactly
those, survives a reload, and leaves a row edited since alone rather than
undoing the work that followed the mistake.

**`COND_SCHEMA`.** `OP_SCHEMA` collapsed the operations into one row each and
left the conditions written out three times, with a validator that asked only
for a `kind` — so `{"kind":"count","atLeast":2}` with nothing to count
validated, stored, and threw when a game read it. One row per condition kind
now, read by the validator, the plain reading, the referee's prompt and the
editor. That is what let the chips cover nested `if`, `chooseMode`, `delay`,
modal options and the IF row itself; phase 1 sent all of those to the JSON
view.

**Two readings were wrong, not merely terse.** `describeSelector` dropped the
filter, so a skill that can only take a blue ≪Another World Budokai≫ card read
"choose up to 1 in your warp" — the one detail that tells siblings apart. And
a count over an unfiltered selector read "there is 2 or more in your drop",
missing the noun. Both fixed; three contract fixtures moved by those words,
with the Snapshot's shape unchanged.

**Two things the tests found.** The `turn structure` mechanism tested
`\bskip\b`, which does not match "skips" — and "your opponent skips their next
Charge Phase" is how cards actually phrase it, so those clauses were counted
as phrasing-only. And `verify-arena.ts` hit TypeScript's control-flow limit
("the containing function or module body is too large"), which silently turned
three lambda parameters into `any`; the schema tests moved into a function to
get the analysis back. That file will need splitting before it grows much more.

**The legend Claude is given** now lists every condition off `COND_SCHEMA`,
and answers the two mistakes the BT18 reviews made in writing rather than
leaving the validator to reject the answer: `{Angel Halo}` is a card *name*,
not a character, and "if it's your opponent's turn" is a condition, not a
duration. ~11,600 characters, near 2,900 tokens — still over Opus 5's
512-token cache minimum and under Haiku 4.5's 4,096, so Tournament games cache
and Sparring games do not, as before.

**The database run (8 Sep 2026, PR #57).** Migrations 0029 and 0030 applied
over HTTPS — in fact the branch's own Vercel preview build got there first,
since `db:migrate` runs in it and there is one database for dev, preview and
production. The fold-in landed whole: **7 briefs and `times_seen` 1 copied
across unchanged, explanations 9 → 13** (5 the rules already had, 9 copied,
1 overlap where `coalesce` correctly kept the rule's own words).

The full re-draft rewrote **6,804 compiler rows in 867 s and bumped no
versions at all** — the version histogram is identical before and after
(5,881 · 7,481 · 200 · 1), which is the claim the pass existed to test: the
rewrite touches the pattern key and the reading, never a program. Drafts with
no pattern key went **1,136 → 0**; pattern groups 2,118 → 2,151, and the seven
new groups over 50 rows are exactly the seven keywords that clear it —
`keyword:Evolve` alone is 287 and enters the top five. **100 fuzzed games, 0
crashes** (phase 1's first run had 2). `arena:gaps` reads 2,943 unread clauses,
2,087 of them phrasing-only — 71 %, which is the argument for the Patterns tab
in one number.

**One property of migration 0030 worth knowing.** Its copy joins on
`card_id`, `skill_index` **and** `side = 'front'`, so a note whose skill no
longer exists as a front rule is dropped by the `DROP TABLE` rather than
carried. The run checked before migrating, which was the only moment the
question could still be asked: 2 of the 120 note groups had no matching rule,
and all three of their columns were empty, so nothing was lost. A future
fold-in of a keyed side table should count what will land before it drops the
source.

**Not in this phase, deliberately:** the price before the colon is still
compiled at game time (`costIsReadable`, `canPayCostProgram`) although the row
carries `cost.condition` / `cost.program`. It is engine, not workbench, and it
touches `activate`, `canResolve` and `altCostFor` — its own change, with the
fuzzer run against it.

## Conventions worth keeping

- Card text is **read, never interpreted**: if the compiler cannot read a
  clause, the whole skill goes to the referee rather than half-resolving.
- Only skills the engine can both **pay for and resolve** are offered as actions.
- Anything Claude decides comes from `legalActions`, so an answer can be wrong
  but never illegal.
- Every new op is added in exactly two places: the interpreter `switch` in
  `script.ts` and a row in `OP_SCHEMA` beside it. The validator, the plain
  reading, the referee's prompt and the workbench's editor all read the row —
  a missing row fails the typecheck, a wrong row shows on `/arena/rules`.
- The engine never compiles card text. A rule reaches a game as a `card_rules`
  row through `rulesFor`; the compiler runs as `npm run arena:draft` and at
  catalog sync, and a compiler change reaches the board only through a
  re-draft — deliberately, so a person has looked at what plays.

## Done: the probe — the Rules Workbench, phase 3 (8 Sep 2026)

`docs/arena-rules-workbench-spec.md` §5, built in five commits on PR #58. A
record says what the engine *will* play; a probe says what it *does*.
`probe(rule, scenario)` builds a game with `createGame` and two minimal decks,
stages the board that rule's moment needs, plays the one move under test,
answers every prompt by a fixed policy, and reports Input / Applied rule /
Result / Assumptions with a digest over the conclusion. The right-hand pane
runs it; confirming a rule keeps the run on the row; `npm run arena:reprobe`
re-runs every stored probe and lists the rules whose answer moved.

**The test file had to be split first.** `scripts/verify-arena.ts` was 7,404
lines in one module body, past TypeScript's control-flow limit — the limit
phase 2 met and worked around by wrapping the schema tests in a function.
Past it, the analysis stops for the whole file and lambda parameters quietly
become `any`. It is eleven files under `scripts/verify/` now, with a shared
`harness.ts` and an entry file whose import order *is* the contract, because
the blocks add cards to the shared `DEFS` as they go. 1,873 assertions before
the split and 1,873 after; the phase-2 workaround went back to being an
ordinary top-level block.

**What the probe refuses to do** was as much of the design as what it does. It
never calls the compiler — the cards it stages around the rule carry
hand-written `Op[]` programs, so `draft.ts` stays the only module compiling
text in production. It invents no wording: the log is `toBeats` → `narrate`,
a refusal is `wording.sentence`, a question is `view.ts`'s `questionFor`
(exported for it, one word). And it states no approximation of its own — an
assumption is a `note` in the program, a note the engine logged, a clause the
compiler could not read, or the glossary's `engine` line for a keyword marked
`partial`. §5 suggested teaching `compile.ts` to emit its approximations as
`note` ops; that stayed out, because a `note` is a step the engine runs and
`describeScript` reads out, so it would rewrite the reading of thousands of
rows and need a full re-draft to land. It is its own change.

**A [Permanent] is read, not resolved.** Power with and without the rule, the
keywords in force, and — for a prohibition — whether the opponent's KO skill
was offered the card at all. That reading is taken on the board as it was
*staged*: the first version took it after the run, so a [Permanent] whose card
had just been KO'd read as a [Permanent] that does nothing.

**What the first sweep found was mostly about the board, not the rules.** Three
things were staged from the card itself afterwards: the Leader now shares the
card's colours, characters and traits (a nameless Leader answers every "if
your Leader is a ≪Phantom Demon≫ card" with "not met" — activateMain fired
1,154 → 1,391); a keyword gets a body its own description matches, read with
`parseFilter` ([Evolve]{2}: <Nail> is offered only when a <Nail> is in play —
keyword fired 497 → 620); and an attack whose trigger is "when this card KOs"
gets something it can KO. A board built in the card's favour has to be
declared, so each of those is a line in Input.

**The sweep, 8 Sep 2026:** 13,563 rules in 67 s, **0 errors** — fired 5,674 ·
notOffered 3,505 · blank 1,330 · inForce 1,114 · noScenario 1,042 ·
didNotFire 898. By family: activateMain 3,246 · play 2,582 · permanent 1,811 ·
keyword 1,573 · attack 1,453 · none 1,042 · activateBattle 707 · counter 543 ·
combo 387 · moment 219. `blank` is the honest answer for an open row — it
fired and did nothing — and `noScenario` is the honest answer for the 1,042
rules whose moment the engine does not know.

**Two findings the probe made, neither fixed here.** A card whose skills are
negated by a continuous effect disappears from `legalActions` **and** from
`rejectedActions`: `skillsOfInstance` returns nothing, so the `whyNot` twin
has no skill to explain and the board can give no reason at all. And the
sweep counts **678 rules refused with no reason** — most of them second and
third skill lines whose price is an action, which is the compile-at-game-time
corner phase 2 deliberately left alone. The refusal for a price the engine
cannot read was still sending people to "the backlog page", a redirect since
phase 2; that one *was* fixed, and points at the workbench.

**Where the staging is still thin**, and worth knowing before reading a
number: attack triggers about being attacked or KO'd (623 `didNotFire`),
and the keywords whose cost is in the Drop or the hand — [Union], [Over
Realm], [Successor] — which the probe cannot pay for and which therefore
report "not offered" with the engine's own reason.

## Done: both of the probe's findings, worded (8 Sep 2026)

`docs/arena-refusals-spec.md`, two commits. Both findings above are the same
promise — §3.1 of the workflow spec: a move off the menu can always be worded
— and both turned out to be holes in the *reporting* side, not in the rules.
No predicate was touched, which is the rule §3.2 exists to protect.

**The negated card.** A card whose skills a continuous effect has silenced
(9-1-5) was in neither list. Reduced to four lines on the test harness, and
the diagnosis came from the contrast: the *single-skill* form of the same
negation answered "the skill is negated" correctly on the same board. So the
vocabulary was not missing a kind — `rejectedActions` fed `rejectActivate`
from `skillsOfInstance`, which empties a wholly negated card, and
`skillNegated` (what the twin consults) reads `negateSkill` but not
`negateSkills`. The twin now asks both questions and reads the printed skills
for that one case; `skillNegated` itself is untouched, because ten callers
share it. The sweep does not see this — the `negated` variant is not the
default scenario — and saying so was the honest half of the commit.

**The 678, measured before they were explained.** PR #58 read them as second
and third skill lines whose price is an action. The first half held and the
second did not: **640 of 678 were not the card's first skill and 591 were its
last**, while price shape explained only 478 — 191 carried no price at all
and 9 were plain orbs. The cause was the one-rejection-per-card cap §3.2 asked
for, implemented twice (`rejectActivate` returned after the first skill that
answered; `push` keyed on the card). A rule is one skill line, so a rejection
filed under skill 0 cannot answer a question about skill 20. Keying
activations by skill index and reporting every line:

**678 → 74 refusals with no reason (−604, 89 %)**, with every other number in
the sweep identical — fired 5,674 · notOffered 3,505 · blank 1,330 · inForce
1,114 · noScenario 1,042 · didNotFire 898, all ten family rows unchanged. A
wording change that moved no outcome, which is what one should look like.

Two things rode along, both forced by the change rather than chosen: the
rejection label now names the skill line the way the menu does (three greyed
rows reading "Activate Piccolo" identify nothing), which moved six contract
fixtures by that one string; and the card action sheet had been keying its
rows on the action type alone, a duplicate React key the moment a card has
two. The `arena:playthrough` audit caught the second copy of the invariant
still keyed on the card — that is what it is for.

**What is still unworded: 74**, and none of it is a price. 29 keywords with no
activation of their own ([Double Strike], [Alliance]), 14 [Auto]s — both of
which `whyNotActivate` correctly declines to invent a rejection for, so they
are the probe's goal shape rather than the engine — and 31 where the probe
stops at a `counter` prompt whose `rejectedActions` case files counter cards
only and never calls `rejectActivate`. That last one is a real gap and is the
next thing here, together with `BT29-044`, a Unison the staging removes from
the game before the move under test is reached.

**And then the price itself** (own commit, same day). `Script` gained a
`price` — the condition and the action, read together (4-3-3) — so a program
and its price travel as one record. `rulesFor` fills it from `card_rules.cost`,
which the drafter has written since phase 2 and nobody read; `compileCard`
fills it from the text, which is what keeps `npm test` and the probe playing
prices without the engine calling the compiler. `engine.ts` no longer imports
`compileCostProgram` or `priceCondition` at all, and no program is compiled
during a game.

The sweep is **byte-identical** before and after — every outcome, every family
row, and the 74. That sameness is the result: over 13,563 rules the price the
drafter stored and the price the engine used to recompute agree everywhere.
`arena:fuzz -- 100` gave 100 games and 0 crashes, and `arena:playthrough`
still shows action prices charged and refused in a real game.

A sweep that does not move is easy to mistake for a change that did not land,
so the test is what earns it: it fails when `priceFor` is made to fall back to
compiling, and it pins the board that separates the two readings — a record
whose *effect* is readable but which carries **no price** is refused rather
than offered for free. The first version of that test passed for the wrong
reason (the effect was unread too), which the mutation run caught. One
behaviour changed on purpose: a skill with no record has an *unknown* price
rather than a free one.

## Done: two engines, one switch — Stage 0 of the rules-language programme (9 Sep 2026)

The owner's decision this day, after three drafts: the arena becomes a
**configuration-based rules engine** — one language for a card's rule
(`WHEN / COST / IF / THEN`, written like SQL), for the game's own definition
and for the referee — and the new engine is built **beside** the old one, not
in place, so the old one stays playable until the new one is proven. The plan
with its stages and the model each runs on is what the owner approved; the
specs (`docs/arena-rules-language.md`, `docs/arena-ruleset-spec.md`) land with
Stages 1 and 3.

Stage 0 is the safety net and the switch, and changes no rule:

- `arena_games.engine` (`legacy | rules`, default legacy) and `arena_matches.engine`,
  migration `0033` — it was `0032` until `main` merged a repair under that number, and
  it says `IF NOT EXISTS` because the columns had already been applied under the old
  name; `arena_games.game` copied from the deck. `src/lib/arena/engines.ts`
  is the registry (`ENGINE_INFO`, `engineFor`, `EngineNotBuilt`); `games.ts`,
  `snapshot.ts`, `arena:fuzz` and `arena:playthrough` go through it. The `/arena`
  form and the 1 v 1 waiting room offer the engine (the rules engine greyed until it
  plays), Settings → Arena engine holds the default (`arena.engine`,
  `engine-setting.ts`), `POST /api/v1/games` takes `engine?`, and a game not on the
  legacy engine wears a badge. `Snapshot.game.engine` / `.game` are the one contract
  change; nine fixtures re-emitted. **`npm run android:test` was not run: the Docker
  daemon is off on this machine** — run it before merging.
- **The digests, without a database.** `arena:reprobe` turned out to have **0 stored
  probes** to re-run — no row has been confirmed with a probe since phase 3 shipped —
  so it was no regression net at all. `scripts/verify/probe.ts` now probes every
  harness card's rule on its first scenario and holds the 143 digests in
  `contract/probe-digests.json` (beside the fixtures folder, which the Kotlin
  round-trip decodes whole as `Snapshot`s); `verify/language.ts` keeps `EFFECT_LANGUAGE`
  and one `stateText` board as fixtures. Both are what "the rules engine changed
  nothing" will be measured by.
- `npm run arena:tally` — the coverage figure off the public deckplanet feed with no
  database, plus which ops and conditions compiled programs use and the unread clause
  shapes. `npm run arena:diff -- <gameId> [--engine …]` replays a game's action log
  from its seed and reports the first action where an engine parts company with the
  row.

**Baseline, 9 Sep 2026:** whole catalog 6,493 cards, 11,752 resolvable skills → **87.3 %**
compiled, 1,811 [Permanent] → **61.5 %** read / 56.7 % applied, 3,705 keyword-only; the
owner's decks 93.3 % of 535 resolvable and 87.7 % of 73 [Permanent]. Unread: **2,948
clauses over 2,154 shapes** (the tally). `arena:fuzz 40`: 40 games, 0 crashes.
`arena:reprobe`: 0 stored probes. Top unread in the decks: "if the Battle Card your
opponent is playing has N power or less", "after you combo with this card", "evolve it
into this card", "your opponent can only attack one more time", "reduce its skill cost".

---

## Done: the language, and an editable WHEN — Stage 1 of the rules-language programme (9 Sep 2026)

Stage 1 of the plan the owner approved on 9 Sep 2026. Three things, and the third is the reason
for the first two.

**`src/lib/arena/lang/` — the language.** `tokens.ts` (lexer, offsets kept so an error has a line
and a column and a keyword name can be taken back off the source), `ast.ts` (the `Rule`, plus
`SELECTOR_FIELDS` and `FILTER_FIELDS` — the two shapes the effect language had never described in a
table, each with a `never` check so a new field fails the typecheck until it is written down),
`print.ts`, `parse.ts`, `validate.ts`. Client-safe: the workbench imports it straight into the
browser. Statements and conditions are generated from `OP_SCHEMA` / `COND_SCHEMA`, so adding an
operation is still one interpreter case and one schema row — the grammar follows.

**The promise is an equality, not a likeness.** `parse(print(x))` is `x`, checked in
`scripts/verify/lang.ts` over a minimal *and* a maximal instance of every op and every condition,
every sugar both ways, every field of a `Selector` and of a `CardFilter` one at a time, every
keyword literal, every compiled program and every drafter record for every harness card — and the
five worked examples in `docs/arena-rules-language.md`, so the reference cannot drift. Printing is
idempotent too, so a record does not churn its version each time it is opened.

Two shapes had to be declared equal to get there, both places where the engine cannot tell two
JSON objects apart: a selector switch written `false` (`upTo`, `fromEnd`, `ignoreBarrier`, all read
truthily) and an `area` sitting beside an `areas` list (`Selector` says `areas` is read *instead*).
The compiler writes both; a person types neither. Deliberately a named list rather than "any
false": `faceUp: false` is turn the card face *down* and `hidden: false` is Revealed Mode, and
dropping those would lose half of what two ops can say.

**The engine now plays the record's WHEN.** `skillAnswersTo` (`engine/triggers.ts`) reads
`Script.trigger`, filled by `rulesFor` from `card_rules.trigger`; `undefined` is *no record* and
falls back to `autoTriggerMatches` on the printed text, so a card nobody drafted still plays, and
an empty list is a record that says "no moment". This is the price precedent of 8 Sep 2026 applied
to the second of the record's four parts — without it an edited WHEN would have been a label on a
row and nothing more, and the workbench would have been telling a story about a skill it could not
move. A keyword's own moments (§22) stay the engine's rule and are not read off the row.

**The workbench's text view.** *Show as text* on a record prints the whole thing in the language;
what is typed is parsed, checked and shown back as chips before it can be saved. It is the only
place WHEN and COST can be edited, and the skill tag in brackets is refused if it changes.
`RecordProps` now carries `tag`, `trigger` and `cost` as the record holds them rather than as
sentences, because both sentences are made in the browser as you type; `costSentence` moved to
`script.ts` beside `CostRecord` (which moved there from `draft.ts`) so it can be. `saveRuleAction`
takes a whole rule and `saveRule` writes `trigger`, `cost`, `cond` and `ops` — `cost: null` is a
price being removed and is not the same as leaving it out, so the three are read with `!== undefined`.

**And the drafter stops overwriting them.** On a row a person owns, `draftCards` used to refresh
`trigger` and `cost` from the compiler along with the printed line, on the grounds that they were
parsed metadata rather than a reading. They are not metadata any more: both are editable and both
are played off the row, so the next `arena:draft` would have reverted a corrected WHEN or price
with nothing recording why. It now refreshes only `printed` and `kind`, which do come off the card.
A `compilerDiff` for those two is Stage 2's.

**A one-line bug found on the way** (`arena-fuzz.mts`, `arena-playthrough.mts`, both Stage 0):
`argv.filter((a, i) => i !== engineArg && i !== engineArg + 1)` drops index 0 when `--engine` was
not given, because `engineArg` is then `-1`. `arena:fuzz 40` had been quietly running 20 games, and
`arena:playthrough <deckId>` ignoring the deck. **`arena:fuzz 40`: 40 games, 0 crashes**;
`arena:reprobe` 0 stored probes (unchanged — nothing has been confirmed with a probe yet);
`arena:playthrough` plays a whole game, 456 beats, 597 rejections over 141 prompts. The workbench
was **not** opened in a browser: this machine's `.env.local` carries `BASIC_AUTH_USER`, so local dev
is behind Basic Auth here and there were no credentials to hand.

Not in Stage 1, by the plan: the `DEFINE …` grammar (Stage 3), the new primitives from the gap
table (Stage 2), the referee answering in the language, chip editors for WHEN and COST,
`compilerDiff` for a changed trigger or price, multi-error reporting, editing the kind.

`npm run typecheck`, `lint`, `test` and `build` clean.

---

## Done: what a card is also treated as — Stage 2, first increment (9 Sep 2026)

Stage 2 is "new primitives from the gap table". The first thing this increment did was **read the
cards behind the table**, and that changed what the stage is: `npm run arena:tally -- --show "<a
wording>"` now prints the actual cards and their unread clauses beside the shape counts, with no
database. Run against the plan's gap table, most of the "in all areas" family turns out **not** to
be a missing primitive at all — `gains` has had that scope since it was written, and it is the
*compiler* that cannot read the sentence. The plan's own rule settles those: a primitive says
something no combination of others can, so a wording gap gets a compile pattern and nothing else.

One thing in the family was a real gap in the language, and it is the primitive of this increment.

**`gains.names` — a card also treated as another card's *name* (20-1).** Eight cards print "this
card is also treated as {Planet M-2} in all areas", and the `gains` op could say a trait, a
character and a colour but not a name. `Gains.names` → `CardDef.alsoNames` (set only by `cardNow`)
→ `namesOf` in `filters.ts`, which `matches` and `nameIncludes` now read instead of `d.name`. It is
*also*, never instead: the card keeps its printed name and answers to both, so a skill naming
{Planet M-2} finds it and a skill refusing {Planet M-2} passes it over. The compile rule that reads
"is also treated as …" gained `{…}` in its alternation; everything else it already did is unchanged.

**One compile pattern: the other word order for negating a keyword.** "Negate the [Energy-Exhaust]
skill **on** your Red/Yellow multicolor ≪God≫ cards in all areas" — ten wordings across the catalog,
none of which read, because the rule beside it only knows "negate **X's** [K]". A tag naming a
*kind* of skill still falls through to the rule for those.

**One compile pattern written, measured, and thrown away.** "Negate the skills **of** X" is the same
one-line change and seven cards print it. Measured, it read three of the seven wrongly — and each
failure was in the target grammar rather than the rule:

| the card says | the grammar hears |
|---|---|
| "your opponent's **Leader**" (BT28-149) | any one card in their play area |
| "all **other** Battle Cards" (BT10-153, DB1-066) | all of *your own*, this card included |
| "those cards", the skill's own choice unread (BT13-106) | this card — an [Auto] triggered by "when this card is played" seeds the sentence's antecedent to itself |

All three compile, read plausibly, and aim a negation at the wrong cards. Seven unread beats three
read wrongly (ground rule 5), so the rule is a comment naming the three and the fix belongs in
`parseTarget`: a Leader as a `special` target, and "other" as the `notSelf` it already has a field
for. **That is the next piece of work on this stage**, and it is worth more than the clause that
found it — every selector in the catalog that says "leader" or "other" reads through the same code.

**Numbers.** Fully compiled cards 4,653 → **4,660**; [Permanent] read **61.5 % → 62.5 %**; resolvable
skills 87.3 % (unchanged — the family is almost all [Permanent]). Eleven clause shapes vanished from
the gap set and **none appeared**, checked by diffing the whole 2,154-shape list before and after,
and every surviving new reading was read back by hand. `npm test`, `lint`, `typecheck`, `build`
clean; `arena:fuzz 40` 40 games, 0 crashes; the probe digests gained exactly one entry (the new
harness card) and none moved.

---

## Done: the target grammar — Stage 2, second increment (9 Sep 2026)

The increment before this one wrote "negate the skills **of** X", measured it, found it read three
of its cards wrongly and threw it away, leaving a comment that named the three and said the fix
belonged in `parseTarget`. This is that fix. It is worth more than the clause that found it — every
selector in the catalog saying "leader" or "other" reads through the same code — and, as expected,
most of what it did was **correct readings that had been quietly wrong**, not new coverage.

**`npm run arena:readings` is the new instrument, and the reason any of this is checkable.**
`arena:tally` counts what the compiler *cannot* read; this prints what it thinks it *can* — one
entry per skill in the catalog, printed text beside `describeScript` — so the protocol for a
compiler change is: dump it before, dump it after, diff, and sign off every line that moved. The
gap-set diff alone was clean on the day three cards were being read wrongly. 13,563 skills, no
database. (It sorts the catalog by card id; the deckplanet feed does not, and two dumps of the same
corpus otherwise diff as thirty thousand moved lines.)

**Four readings taught, all in `parseTarget` / `filterFor`:**

- **A Leader is a card, not a search.** "Your Leader", "your opponent's Leader" → the `leader` /
  `opponentLeader` specials the engine already had. The area words only admitted "leader **card**"
  and "**your** leader", so "your opponent's Leader" named no area at all and fell through to the
  20-1-6 default of the whole play area — a negation that could land on a Battle Card. 56 readings.
- **"Other" is `notSelf`.** "All other Battle Cards", "all other cards in your Battle Area" → the
  field the filter already had, and — where the sentence names no owner, as the sets do when they
  mean everyone's — **both** Battle Areas. Read as your own, a board wipe cleared only the caster's
  side and took the caster with it, which on the two [Permanent]s printing "negate the skills of all
  other Battle Cards" was the card negating itself.
- **The plural of a cost.** "Battle Cards with energy **costs** of 7 or less": only the "between"
  line admitted the plural, so the other three read no cost and handed back every card in the area.
  131 readings — the largest single group, and every one of them a *narrowing* that had vanished.
- **Three qualifiers refused outright.** "Cards **sent to** Warps by this skill", anything else
  qualified "**by this skill**", "the card **on top of** this card" — each names cards by their
  history, which no selector can describe. "On top of this card" was the worst: it satisfied the
  "this card" shortcut, so fourteen [Permanent]s granting [Barrier], [Critical] or power to the card
  *above* them granted it to themselves.

**And one in `refFor`: a plural pronoun is never answered with *this card*.** "Them", "they",
"those cards" resolving to a single card is a category error, and it is what a failed clause earlier
in the sentence leaves behind — an [Auto] seeds the antecedent to the card it is on. It read
BT13-106 as negating itself, BT21-088's "those cards get +5000 power" as this card, TB2-039's
"KO them" as KO this card, and P-037's "play them" as playing this card. 24 skills now read as
nothing at all, and every one of them was reading as something wrong.

**Then the rule went back in.** "Negate the skills of X", with the eleven cards printing it listed
in the comment above it as the sign-off. Two of the eleven — EX21-15/BT13-096 ("sent to Warps by
this skill") and BT23-070 ("on top of this card") — are deliberately still unread. Two details the
rule needed and the older ones did not: the target phrase is taken off the *unstripped* clause,
because `stripQualifiers` removes "in all areas" and that is the target's scope, not a duration; and
the duration is read off the tail alone, because `durationOf` maps "in all areas" to *for the game*
(the approximation `gains` rests on) and BT9-136's one-turn negation came back permanent.

**Numbers.** Fully compiled cards 4,660 → **4,643**, and resolvable skills 87.3 % → **87.1 %** — a
*fall*, which is the point: 52 clause shapes entered the gap set (46 of them "by this skill" or "on
top of this card") against 6 that left, and each one had been compiling into something the card does
not say. [Permanent] read 62.5 % → **62.6 %**. 311 readings changed in all, every one read back by
hand against the printed text.

One thing this uncovered and did not fix: **"the card on top of this card"** is a real primitive the
stack mechanic wants, and the gap set now names it honestly in eight shapes. The engine models
`under`; it has no special for the card above.

`npm run typecheck`, `lint`, `test`, `build` clean; `arena:fuzz 40` 40 games, 0 crashes;
`contract:emit` produced no change. One test moved: `verify/wordings.ts` asserted "your Leader"
reads as the Leader *area*, and now asserts the special. `verify/lang.ts` read the language doc
without normalising CRLF, so `npm test` failed on a Windows checkout for reasons unrelated to any
change; the gate has to be runnable where the work happens.

## The card on top of this card — Stage 2, third increment (9 Sep 2026)

The primitive the last increment uncovered and left honestly unread. The engine modelled `under`
and had no way to name the card *above*, so "the card on top of this card" satisfied `parseTarget`'s
"this card" shortcut and every [Permanent] granting a keyword or power upward granted it to itself.

**`onTop` is a special target, and the other half of the `under` area.** A pile is one card with
everything else beneath it (23-2-2), held as a list on the card at the top, so there is exactly one
answer and `hostOf` finds it by asking who holds this card. It is a *different* card from the one
asking (23-2-2-3), which is the whole point, and it is found wherever the stack stands, because the
area of a buried card is the area of the card on top (23-2-2-2). A description in front of the
words narrows it as any other selector's does: "the <Majin Buu> on top of this card", "the Leader on
top of this card".

**Only the phrase that *ends* there is a target.** The same words anywhere else name a
**destination** — "play up to 1 green <Piccolo> card … **on top of this card** from your deck" —
and stay refused with "by this skill". Two guards make that stick, and both were written after the
readings diff caught them: the description before the words may not contain a comparison or a second
owner (BT21-032 prints "choose up to 1 of your opponent's Battle Cards with power less than or equal
to the card on top of this card, then KO it", and read whole it KO'd your own <Son Goku>), and
"above this card" had to be struck out in `refFor` alongside "under" and "on top of", or the "this
card" inside it answers the phrase before `parseTarget` ever sees it.

**"If this card is under a yellow ≪Heroic≫ Battle Card" is the same question the other way up**, and
it had to be written in the same commit. Thirteen [Permanent]s print the condition and the grant as
one sentence; reading the grant alone gives the card above [Double Strike] whatever it is, which is
a wider skill than the one printed. It is `count(onTop matching X) ≥ 1`, and its `subject` is what
makes BT17-092's "**that card** gets +1000 power" land on the host.

**Three bugs the readings diff turned up on the way, each a filter that compiled and read wrongly:**

- **Four measures were missing from `narrows`.** `charactersIncluding`, `namesIncluding` and their
  negatives — a name asked for *in part* — so a description whose only measure was one of them threw
  the whole filter away. "Choose up to 1 of your Battle Cards **with <Son Gohan> in its character
  name**" (BT19-130) chose any Battle Card you had: the type word is noise in the Battle Area and is
  struck out first, which left nothing on the list at all. `parseFilter` had read the name the whole
  time. The comment above that list already said every measure has to be on it.
- **`describeFilter` printed none of those four**, so the instrument could not see the bug it was
  there to catch: a filter the compiler had, printed as though it had none. That is why this is
  listed as a fix and not a nicety — a measure the reading cannot print is a measure nobody can sign
  off.
- **The possessive in "in **their** character names" was read as a player.** "Choose all of **your**
  Battle Cards with <Son Goku> in their character names" handed sixteen skills the opponent's board;
  BT22-086 gave +5000 power to the cards it was meant to be fighting. The phrase says whose cards
  these are once, at the front.
- **And the negation is written three ways, of which two were read.** BT21-040 prints "your
  opponent's Battle Cards **that does not include** <Son Goku: GT> in its character name", matched as
  a positive. Nothing had noticed, because the measure was thrown away before it reached a selector.

**Numbers.** Fully compiled cards 4,643 → **4,665**, resolvable skills 87.1 % → **87.2 %**,
[Permanent] read 62.6 % → **64.0 %**. 36 clause shapes left the gap set and **none entered it**.
115 readings moved: 21 that read as nothing now read, 2 that read as something now honestly read as
nothing (BT20-017/019, whose em-dash-qualified filter is unreadable, and which were granting
themselves the power they grant upward), and 92 that differ only by a gained partial-name measure, a
gained under-condition, an `onTop` target, or the corrected side. Every one was read back by hand
against the printed text.

`npm run typecheck`, `lint`, `test`, `build` clean; `arena:fuzz 40` 40 games, 0 crashes;
`contract:emit` produced no change — no probe digest moved, so no rule the engine already plays
changed its answer.

### Measured, ready, and deliberately not shipped: the pile under *another* card

The second commit on this branch refuses "from under your <Kefla> Battle Card", "from under your
Leader Card", "cards under {King Kai's Planet}" — sixty-odd clause shapes naming a pile that is not
this card's. They are all being read into the **host** today, because `AREA_WORDS` takes the
"battle" out of "your <Kefla> Battle Card" and the description off the host: EX25-39 combos the
<Kefla> itself rather than a card beneath it, and the Leader wordings choose the Leader. Refusing
them costs 38 fully compiled cards and clears 40 wrong readings.

It is a separate commit because it is not free. Three cards read *worse* afterwards, all for one
reason — **a refused clause leaves the clauses after it pointing at nothing**, and an [Auto] seeds
that antecedent to the card it is on. P-645's "play 1 {Majin Buu, Unadulterated Destruction} from
under your green <Majin Buu> card, and **it** gains [Double Strike]" grants it to this card;
EX24-32's "and if you do" wrapper collapses so its second half happens unconditionally; P-396 is
left with an empty modal option, a mode that silently does nothing. This is the singular twin of the
plural-pronoun rule of the last increment, and it cannot be fixed the same way — "it" after "when
this card is played" usually *does* mean this card. The honest fix is for the compiler to know that
an earlier clause in the same skill went unread, which is its own increment.

Without that commit, two cards this increment made reachable read wrongly: **EX25-39** and
**EX23-27** (whose "place it under a <Super 17> card on top of this card" puts the card under
*this* one). Both were wrong before and merely unreachable; neither is new text.

`npm run typecheck`, `lint`, `test`, `build` clean; `arena:fuzz 40` 40 games, 0 crashes.

## What a refused clause leaves behind — Stage 2, fourth increment (9 Sep 2026)

The precondition the last increment named and could not pay for itself. A clause the compiler
cannot read is not silent for the clauses after it: the sentence goes on talking about what that
clause named, and nothing is bound to it. Three separate ways that was being answered wrongly, all
in this commit, because each is the same bug wearing different words — and each would have been
paid for again by every future refusal.

**A pronoun after the hole was answered with *this card*.** An [Auto] seeds the antecedent to the
card it is on, so "…, and **it** gains [Double Strike]" after a play the compiler refused gave the
keyword to the card printing the skill (P-645), and "then you choose up to 1 of your opponent's
Battle Cards and **KO it**" KO'd the caster (P-279). The plural half of this went in last increment
— "them" is never this card — and the singular half cannot be fixed the same way, because "it"
after "when this card is played" usually *does* mean this card. So the antecedent standing at the
moment of a refusal is **marked**, by identity rather than as a flag: any clause that binds
something of its own writes a fresh one and clears the mark, and only a back-reference that would
land on the still-seeded self after a hole is refused. Where nothing was refused, "it" reads exactly
as it always did.

**"If you do" hung on a decision nothing had made.** Dropping the hinge alone does not leave what
follows conditional — it makes it happen *every* time. BT12-042 played a 5-cost blue <Gogeta> from
hand without paying the {u}{u} it offers to pay; BT14-087 KO'd a Battle Card whether or not the
opponent removed the marker they were offered; P-350 drew 2 cards whether or not the opponent looked.
The rest of the sentence is now refused with the word that governs it, and "if you don't" the same
way — it had the identical hole.

**A modal option that failed to compile left an empty branch**, and the menu then offered a mode
that silently does nothing (P-396, BT30-144/146/148, BT8-039, BT9-126b, DB3-138, EX06-26, EX07-07,
P-459, BT18-119). A mode is only a choice if every option on the menu is one, so a single empty
branch now fails the whole skill and the referee is asked what the card actually prints.

**Numbers.** Fully compiled cards 4,627 → **4,625**; [Permanent] read 63.4 % → 63.2 %; unread
clauses 3,005 → 3,133 over 2,212 → 2,267 shapes. **55 shapes entered the gap set and none left it** —
this commit is entirely the compiler saying out loud what it cannot read, which is why the shapes
that appear are almost all wordings it *can* read in another sentence ("draw N cards", "negate the
attack", "play it"). They are refused because the word that governs them is not.

73 readings moved and every one was read back against the printed text. Three of them are the price:
**BT1-002b** ("if this card attacks a Battle Card, **it** gains +5000 power") and **BT10-036/040**
("if this card is in your energy, place **it** in its owner's Drop Area") were correct and are now
unread, because the clause refused in front of the pronoun is itself about this card. A narrower
rule could keep them — do not mark the antecedent when the refused clause names this card — and it
was left out on purpose: EX09-01's refused clause names *that* card and the pronoun after it was
KO'ing the wrong one, so the narrow rule would have to tell those two apart by the verb. Three
correct readings are not worth a rule that guesses (ground rule 5).

The other 70 are all fixes. Roughly half were a conditional half of a skill firing unconditionally,
and half were an effect landing on the card printing it: BT16-146, BT4-106 and P-048 sent **this
card** to the Warp where the text sends a card from the opponent's hand; BT26-032 returned this card
to hand where the text returns the pile under another one; BT27-074 and P-337 rested this card where
the text rests one of the opponent's.

`npm run typecheck`, `lint`, `test`, `build` clean; `arena:fuzz 40` 40 games, 0 crashes;
`contract:emit` produced no change — no probe digest moved. One test moved with the rule:
`verify/keywords.ts`'s look-and-add card now has two gaps rather than one, because the "+5000 power"
hanging on "if you did not draw a card with this skill" is no longer granted every time.

## Fix the instrument — Stage 2, fifth increment (9 Sep 2026)

The readings are the only check on a clause that **compiles and reads wrongly**, and no coverage
number and no test knows to ask about one. On 9 Sep 2026 they could not be signed off on 145 of the
13,563 skills they print, because the sentence contained the word `undefined`; and `describeFilter`
was silent on ten of the measures a filter can carry, so a filter that narrows wrongly printed as
though it had none. Neither is a compiler bug, so **the gap set does not move in this commit** —
fully compiled cards stay at 4,625, unread clauses at 3,133 over 2,267 shapes, and `contract:emit`
produces no change. What moves is 587 readings, all but six of them a sentence gaining words.

**`undefined` in the middle of a sentence**, four shapes, all in `describeSelector` and the
condition schema. A selector with no count of its own is every card it finds — `resolveSelector`
returns the whole area — and the count was printed straight, so it read `move undefined in your
energy to energy`. It is now worded "all", and `take` ("the top 3 cards of your deck", the area's
own order rather than a choice among it) is worded as what it takes rather than as a number to pick.
Three conditions **test** a set rather than take from it, and each says so in its own word:
`inBattle` and `battled` ask whether **any** of the cards is (`.some`), and `every` — whose two
selectors are built with their counts deleted — reads "every card in your energy is also
mono-colour blue in your energy" rather than the "all of all in your energy" the shared default
produced.

**The ten silent measures**: `notColors`, `notCharacters`, `notTraits`, `notNames`, `keywords`,
`notKeywords`, `skillKind`, `noKeywords`, `notToken` and `powerRel` are all printed now, in the
wordings `parseFilter` reads back — so `printFilter`'s round-trip keeps more filters in their own
words instead of falling to field-by-field. Two bounds were not merely silent but **wider than the
filter**: a cost or power with *both* bounds printed only the ceiling ("or less", the floor
dropped), and an *exact* cost or power printed as "or less" too. Both now print the range and the
exact value.

The 25 readings that gained a measure rather than a word are the point of the exercise:
BT19-050 "choose up to 1 **card** with an energy cost of 5 or less" was `non-<Pan: SH>` all along,
BT10-027's "3 or more cards in your battle" was `non-token`, BT13-132's was "card with
[Over Realm]", BT15-079's "if that card is card" was `non-≪Saiyan≫`.

**Two compiler bugs the new words immediately exposed**, left for their own commit rather than
smuggled into this one: **BT7-129** prints "non-black cards in areas **other than** your deck, hand,
or life" and reads "in your **deck**" — the area is inverted; and **BT16-088** prints "non-<Zamasu>
**and** non-<Goku Black>" and reads only the first, with "for the game" read as "for the turn".
Neither was visible before, because both printed as the word "card".

**One live bug taken in the same commit, because it is the same rule.** "Your opponent reveals their
hand. Choose up to 1 card with an energy cost of 7 or less **from it** and discard it" (BT16-005)
named no area, so 20-1-6's "an unqualified card is one on the table" took over and the card
discarded was **your own**. "From it" after a look or a reveal is the pool being held out — the rule
"among them" has already — and `parseTarget` now reads it, but only when there *is* a pool: with
nothing held out, "it" is a pronoun for the sentence to answer and not an area to invent. The same
change fixes a second half of it: the pool variable was the literal name `"looked"`, which a
**reveal** never binds (it binds `"revealed"`), so "choose 1 card among them" after a reveal was a
choice with no candidates at all. Six readings: BT16-005, BT4-124, BT9-100b, P-134 (all reveals) and
BT10-004, P-147 (looks); BT13-024's dangling variable is bound at last.

`npm run typecheck`, `lint`, `test`, `build` clean; `arena:fuzz 40` 40 games, 0 crashes;
`contract:emit` produced no change. The gap-set diff is empty, by design.

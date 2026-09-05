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

A caution learned the hard way: **never write engine source through
`node -e` with a template string.** `\b` inside one becomes a literal
backspace character and silently breaks a regex. Use the Edit tool.

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

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

## Next: modal choice (20-2) and cards under cards (23-2)

Cheap, clear, and together they cover 243 cards.

**Modal choice.** "Choose one— ・A ・B". The bullet characters are already in the
text, so splitting is mechanical; watch for both `・` and the three different
dashes in "Choose one—" (`-`, `—`, `―` all appear in the catalog, see
`arena:coverage` output). One new op:

```ts
| { op: "chooseMode"; reason: string; modes: { label: string; ops: Op[] }[] }
```

The interpreter raises a prompt (a new `Prompt` kind, or reuse `chooseCards`
with synthetic ids — prefer a new kind, the UI reads prompts directly) and
splices the chosen mode's ops in place, exactly as `if` already does. 542
clauses, the largest single count of any mechanism.

**Cards under cards.** The state already models `under`, and Evolve, Union and
Z-Stack stack properly; only the *language* cannot say it. Today
`moveTo: "under"` maps to `"drop"`, which is simply wrong. Give `moveTo` an
`under: Ref` so the destination card is named, move the card into
`s.cards[host].under`, and make sure `assertConsistent` in the tests still sees
each card exactly once. Check `move()` in `state.ts` for how a card leaves its
current area first.

---

## Then: replacement effects (9-10) — the one genuinely hard piece

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
- **Amounts counted off the board** (53 cards). `Amount` already has
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

## The other track, which needs no planning

Two thirds of the unreadable clauses — 7,759 of them — need **no new
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

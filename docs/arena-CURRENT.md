# Arena current state (short)

Last updated: 20 Sep 2026

This file is the short, always-current arena state-of-the-world summary.
Keep it under 200 lines. Update it whenever arena scope, priorities, or the
"what to read first" order changes.

## Where the programme stands right now

- The arena is playable for **Dragon Ball Super (`dbs`) decks only**.
- The production flow is still: catalog sync drafts/updates `card_rules`,
  the engine plays from those rows, and unresolved wording is escalated via
  the referee workflow.
- Two engines exist (`legacy`, `rules`), and **both are playable**. Stages 5
  to 9 of the plan merged between 14 and 20 Sep 2026, so `src/lib/arena/vm/`
  now plays a whole game: the turn off `DEFINE PHASE`/`STEP`, the declared
  actions with their prices (charge, the play family, `activate`, 13-3's
  Unison growth), the battle as a nested sub-flow with its nine steps,
  damage, life and the WIN checkpoint, and Stage 7's keyword hook contract
  with eight bodies written against it. `engineFor(id)` is the one switch.
- **`DEFAULT_ENGINE` is still `legacy`.** Flipping it is issue #166's build
  step 2 and is blocked on the owner's two parity runs (#164, #165), which
  need the shared Neon database. `ENGINE_INFO.rules.available` is true, and
  since #162 a hot-seat game, Sparring and Tournament may all be started on
  the rules engine from Settings → Arena engine; only a 1 v 1 is refused,
  because the hidden-hand masking still reads the legacy `GameState`.
- What the rules engine cannot do yet throws `NotYet` naming the issue that
  builds it, and since #149 that **ends the game** rather than playing on —
  a skill's own KO and tokens (#146), the skip list (#145), an action price
  or an X price on a skill line (#149), the counter:play window (#150), the
  Z-Energy a spent combo card becomes (#151), and most keyword activations
  (#157) are the ones a real game meets.
- `npm test` runs `verify-arena.ts`'s nineteen suites **once per engine**
  since #165, so the rules-engine run and its named skips are checked on
  every ordinary test run. `npx tsx scripts/arena-fuzz.mts 200 --engine
  rules` is clean.
- The immediate day-to-day work remains improving wording coverage and
  avoiding wrongly-read clauses (prefer unread over wrong reads).
- `docs/arena-ruleset-spec.md` is the interpreter contract for the `rules`
  engine: what is configuration and what is code, how a primitive or a game
  is added, and the oracle protocol that gates each stage.

## Current priority order (session start)

1. Read `docs/arena-next-session-prompt.md` for the detailed hand-off and
   priority queue.
2. Read `docs/arena-tooling.md` for validation discipline and script meaning.
3. Use `docs/arena-INDEX.md` to choose whether a spec is current authority or
   historical background before deep reading.

## Which docs are authoritative vs superseded

- **Authoritative list:** `docs/arena-INDEX.md` is the single maintained map of
  each `docs/arena-*.md` file's status (`Current`, `Current (planned)`,
  historical/review background).
- **Detailed current hand-off:** `docs/arena-next-session-prompt.md` remains the
  canonical long-form "what next" document.
- **Superseded/historical docs:** treat any file marked historical in
  `docs/arena-INDEX.md` as background context, not the current source of truth.

## Maintenance convention

- Keep this file short and high-signal; link out instead of duplicating long
  specs.
- When updating statuses, update `docs/arena-INDEX.md` in the same change.
- When priorities move, update this file and
  `docs/arena-next-session-prompt.md` together.

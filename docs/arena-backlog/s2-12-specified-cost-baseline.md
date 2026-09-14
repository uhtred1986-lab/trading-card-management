---
title: Arena: the specified-cost baseline for the seven X-cost cards that print one
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-workbench, phase:rules-stage2, model:opus-5
stage: 2
issue: 255
---
**Source:** `docs/arena-backlog/s2-96-specified-cost.md` (the findings of 12 Sep 2026, which this issue is split out of); `specifiedCostOf` and `specifiedCostUnknown` in `src/lib/arena/engine/cards.ts`; `scripts/arena-specified-cost.mts`; `src/lib/catalog/errata.ts` (the precedent for data the feed gets wrong); the owner's ruling of 9 Sep 2026 recorded with `npm run arena:rule -- --list`.

**Problem.** The specified-cost mechanism is built and inert on the catalog. #96 established that the reducer relaxes only the coloured requirement, wired every caller to read it, and then found there is nothing to read: the deckplanet feed carries **no cost orbs at all**. `card_energy_cost` is a bare number, `"X"`, `""` or null across all 6,493 cards of the original game; the orb images appear only inside skill text; no other field carries a cost. So `specifiedCostOf` refuses a baseline for an X cost rather than guessing one, and seven cards read their own clause correctly and change nothing on the board:

| Card | Why it is waiting |
|---|---|
| BT19-039 | The owner's ruling of 9 Sep 2026 settles this one: **2 blue**. |
| BT19-040, BT15-063, BT20-118, P-673, P-600, BT25-004 | Print a specified-cost clause; their orbs are unknown. |

All 167 X-cost cards are Unisons or Z-Unisons. On the other 160 the refusal only makes the price lenient, never permissive of an illegal play, so this is a correctness gap on seven cards rather than a hole in the engine.

**What was checked, so it is not checked twice.**
- The feed is silent *everywhere*, not merely on these seven — `npm run arena:specified` prints every distinct value of the cost field and re-checks this on each run. If a feed ever starts spelling orbs there, this issue becomes a parsing job and the script says so.
- Stretching the fixed-cost convention (one orb per printed colour, what `specifiedCostOf` does for a numeric cost) over the gap reads BT19-039 as **1 blue** where the ruling says **2**. The convention is therefore wrong for X costs specifically, not merely unproven.
- **Bandai's art is not a self-serve source for these cards.** The public path `https://www.dbs-cardgame.com/fw/images/cards/card/en/<number>.webp` is Fusion World only and all seven are original-game cards; the deckplanet bucket `https://storage.googleapis.com/deckplanet_card_images/<number>.png` answers **404 for six of the seven** (only BT15-063 is there, checked 13 Sep 2026). Whatever art the app shows for the rest comes from a matched TCGplayer product photo via `fillMissingImages`, and whether those are legible enough to count orbs is unverified. Plan for the orbs arriving from the owner, not from a crawl.

**Build.**
1. **Decide where a hand-entered baseline lives, and record why.** Two shapes, and the choice is the first deliverable:
   - a `specified_cost` column on `cards` (`src/db/schema.ts`) plus a workbench field — reachable from the UI, but `sync:catalog` upserts card columns, so it must `coalesce` like `image_url`/`back_image_url` already do or the next sync erases it;
   - a table in code beside `src/lib/catalog/errata.ts` — version-controlled, reviewable, survives a sync by construction, and the established precedent for "the source is missing or wrong about this card".

   Errata's self-check (`unmatchedCorrections`) does not port directly: an errata entry can be re-verified against the payload it corrects, while a baseline has nothing in the feed to compare against. Give it the check it *can* have — that each card still carries an X cost and still prints a specified-cost clause — so an entry that has become obsolete is noticed.
2. Feed it through `cardDefFrom` (`src/lib/arena/load.ts`) onto `CardDef.specifiedCost`, which every caller already reads. No engine change is expected; if one is needed, that is a finding worth reporting.
3. Enter BT19-039 as **2 blue** on the owner's existing ruling. Leave the other six unentered until their orbs are supplied — `specifiedCostUnknown` must keep saying "unknown" for them rather than defaulting to anything.
4. Teach `npm run arena:specified` to report the baseline's source per card (ruling / entered / still unknown), so the report stays the instrument rather than becoming a second place the answer is claimed.

**Out of scope.** The reducer mechanics themselves (#96, merged). Skill-cost reduction (#97). X as a bound expression (`s2-03-x-and-expressions.md`). Reading orbs off card art by vision — if that is ever wanted it is its own issue, with the owner confirming each reading, because a wrong baseline is a silently illegal play rather than a visible error.

**Acceptance.**
- Gate + `contract:emit` reviewed.
- The chosen home for the baseline is documented where the next reader will look, with the `sync:catalog` hazard named.
- `npm run arena:probe -- --card BT19-039` reports the play as legal on a board with one blue energy — the acceptance item #96 could not meet.
- The other six still report an unknown baseline, and `npm run arena:specified` says so per card.
- `npm run arena:readings` diff empty — this is data, not a change to what the compiler reads.

**Decision and delivery, 13–14 Sep 2026.** The owner chose the column: `cards.specified_cost`
(migration 0034), in the language's orb notation (`{u}{u}` = two blue), entered from the rules
record on the workbench — whose *specified cost* box reads **Incomplete — specified cost unknown**
on every X-cost card without one, driven by `specifiedCostUnknown` and not by a second list — and
`coalesce`d by the catalog upsert like `image_url`, which is the one line that keeps
`sync:catalog` from erasing an entry. `cardDefFrom` reads it onto `CardDef.specifiedCost` through
`parseSpecifiedCost` (`src/lib/arena/specified-cost.ts`); no engine change was needed. The check an
entry can have is `staleSpecifiedCosts`, run at sync and by `arena:specified`: the card still prints
an X cost and a specified-cost clause. BT19-039 is seeded as `{u}{u}` by the migration on the ruling
of 9 Sep 2026; the other six stay unknown until their orbs are entered from the cards. `npm run
arena:specified` reports the source per card (entered / ruling on file / still unknown) when
`DATABASE_URL` is set, and the probe's `permanent:reduced` board plays such a card from hand on one
energy per orb its relaxed requirement leaves — one blue for BT19-039 — saying whether the play is
legal with the rule and whether it would be refused without it. Home documented in `CLAUDE.md`
(Architecture) and `docs/arena-tooling.md` (`arena:specified`).

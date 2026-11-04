# Arena readings audit — the next round (round 4)

Written 3 Nov 2026 after integration 4 (#1246) merged and production was refreshed. Everything a session needs to
run the next round of the readings audit is in this folder; it assumes no memory of the sessions that ran rounds 1–3.
Read `CLAUDE.md`, `docs/arena-batch-process.md` (research order, rulings ledger, checks, integration) and the skill
`arena-work` first.

**4 November bounded follow-up:** [Seven condition misreads are repaired](round-4/conditions-followup.md)
in draft PR #1248, with no read/unread count change or production record writes. R-380–R-383 are now
allocated; the remaining condition lane starts at R-384. BT2-048's mandatory keyword-negation choice
and the four lanes' unread work remain. The production baseline below is still the 3 November snapshot.

## Where things stand

- `main` at #1246. The **dbs** game: **12,953 of 13,964 skills read (92.8%)**, 1,011 unread, on the production
  catalog of 3 Nov 2026. Production `card_rules` were refreshed after each integration (2,853, 627 and 552 rows) and
  a 40-game fuzz ran clean each time (no crash, no stall, no interrupted game).
- The rulings ledger (`src/lib/arena/rulings.ts`) has 169 rulings and **none pending**: the owner decided every
  open question on 3 Nov 2026. The next free id is R-341.
- How we got here: the production audit of 2 Nov 2026 (every readable skill checked against its printed text,
  1,392 misreads confirmed) and three rounds of four compiler lanes:

  | Round | Integration | Unread → read | Read → unread (deliberate) |
  |---|---|---|---|
  | 1 | #1244 (with official errata and moments batch 1) | 15 | 39 (+344 never-firing [Auto]s made visible) |
  | 2 | #1245 | 159 | 50 |
  | 3 | #1246 | 182 | 4 |

  Each lane's work is in `scripts/verify/audit-<lane>-<round>.ts` and its glossary entries.

## The work: four lanes

| Lane | Owns | Work list (this folder) | Size |
|---|---|---|---|
| **T** triggers | `text/triggers.ts`, `rulesets/dbs/triggers.rules` (regenerate `files.ts` with `npm run arena:rulesets`), `gaps.ts`, `vm/triggers.ts`, `probe.ts`, the moment code in `compile/index.ts` | `unread/moments.md`, `notes-T.md` | 206 [Auto] skills whose moment is unread, 187 clusters |
| **C** conditions | `compile/conditions.ts`, the condition vocabulary (lang flags, the Cond describer, VM evaluation) | `unread/conditions.md`, `notes-C.md` | 107 skills, 94 clusters |
| **S** selectors | `text/filters.ts`, selector parsing in `compile/targets.ts` and `compile/*`, `vm/filters.ts`, `describeFilter`/`describeSelector` | **`notes-S.md` first, with the [condition follow-up](round-4/conditions-followup.md)**, then `unread/selectors.md` | 282 skills, 260 clusters |
| **E** effects | `compile/effects.ts` and the op compilers, `compile/clauses.ts`, `describeScript`, the ops' VM code, `src/lib/catalog/errata.ts` | `unread/effects.md`, `notes-E.md` | 414 skills, 379 clusters |

- The `unread/*.md` files cluster every unread skill by the wording of its first unread clause (names → X,
  colours → C, numbers → N), largest first. The lane split is a wording heuristic: a clause filed under one lane may be
  another's — leave it to that lane.
- `notes-<lane>.md` hold round 3's reviewer doubts, code notes and the fix agent's "left" list with reasons. Check
  each item against the printed text before working it.
- The tail is thin now: mostly one or two cards per wording. Expect 100–150 skills per lane-round, fewer each round.
  Many unread moments need an engine event that does not exist yet; that overlaps Phase 3, the 65 engine sites that
  still say "not yet" (`docs/arena-capability-inventory.md`). A moment with no event stays unread; never fake it.
- **Ruling ids:** T R-360–R-379, C R-380–R-399, S R-400–R-419, E R-420–R-439 (ascending, append at the end, never
  reused). **Suites:** `audit-triggers-4`, `audit-conditions-4`, `audit-selectors-4`, `audit-effects-4`, appended to
  `SUITES` in `scripts/verify-arena.ts`. **Branches:** `claude/audit-<lane>-4`, from `claude/arena-integration-5`.

## How a lane works

Each lane is a **fixer** then an **adversarial reviewer**, on the same branch.

The fixer:
1. Clusters its work list into wording families and works the largest first.
2. Fixes each family generally, in the compiler, the rules language or the engine — never a card-id special case.
3. Makes a clause **unread** when the right reading needs engine support that isn't a contained addition. A misread
   plays wrongly; an unread skill is visible.
4. Records a best guess where the sources are silent (rule manual, card Q&A, general FAQ, errata, same wording,
   owner, intent) as a **pending** ruling in its id range.
5. Updates `src/lib/arena/glossary.ts` (CRLF line endings) in the same commit as any compiler, VM, text or lang change.
6. Writes its suite.
7. Pushes its branch and opens no PR.

The reviewer:
1. Runs the corpus diff and compares **every** changed reading with the printed text: side, area, count, "up to",
   may vs must, durations, conditions, pronouns, trigger origin and cause.
2. Reads the code diff for over-broad patterns.
3. Repairs what it finds and pushes.
4. Re-checks each pending ruling against the sources.

**Checks a lane runs** (`docs/arena-batch-process.md` §3, plus what the integrations of rounds 1–3 had to catch):
- `npm run typecheck`, eslint on changed files, its own suite, `scripts/verify/rulings.ts`, and each older suite that
  names a card id it changed.
- Also each older suite that pins a **wording or a reading sentence** it changed. Grep `scripts/verify` for the
  printed phrase and the describer sentence. These have broken at integration before: `text`, `language`,
  `named-gaps-907`, `play-order-mono-930`, `keywords`, `wordings`, `hidden`, `warp`, `cost-reductions-907`,
  `color-count-907`, `census-triggers-907`, `price-condition-clauses`, `bardocks-crew-915`.
- `wordings.ts` needs `keywords.ts` first, in one process:
  `npx tsx -e '(async()=>{await import("./scripts/verify/keywords.ts");await import("./scripts/verify/wordings.ts");console.log("ok")})().catch(e=>{console.error(e);process.exit(1)})'`.
- `npx tsx scripts/verify/capabilities.mts --check` when touching a `vm/*` file with a NotYet site (keep its
  signature in `src/lib/arena/capability-inventory.ts` in step).
- `scripts/verify/teach.ts` when the rules language grows.
- `scripts/verify/attack-preview-801.ts` when adding per-checkpoint engine work.
- In a suite, never overwrite a shared harness card (`DEFS.WALL`, `DEFS.KILLER` …): suites share one process at
  integration.
- The corpus diff:
  `npm run arena:compile-snapshot -- --snapshot <catalog.json> --out after.json --against <baseline.json> --diff diff.md`.

**Running the round with Claude Code's Workflow tool:** `audit-fix-lanes.workflow.js` is the script rounds 2 and 3
ran: a pipeline of fixer → reviewer per lane, each in its own worktree. Its `args`:

```json
{ "integration": "claude/arena-integration-5", "round": 5,
  "snapshot": "<abs path to catalog.json>", "baseline": "<abs path to baseline readings.json>",
  "lanes": [ { "key": "T", "title": "triggers and moments", "branch": "claude/audit-triggers-4",
               "file": "docs/arena-audit/round-4/unread/moments.md", "suite": "audit-triggers-4",
               "ids": "R-360 to R-379", "target": 150,
               "extraFiles": "- docs/arena-audit/round-4/notes-T.md (round 3's doubts and left list)",
               "focus": "<what to do first; files owned>" } ] }
```

Any other client can run the lanes by hand from the same prompts (the `COMMON`, `FIX` and `REVIEW` templates in the
script).

## Inputs and who makes them

- **A catalog snapshot**, made with `npm run arena:snapshot -- <file>`. It reads the database, so the owner or an
  authorised session takes it (`docs/agent-brief.md` → "Data"). Lanes need it for the corpus diff; take it after the
  last production refresh.
- **The baseline:** `npm run arena:compile-snapshot -- --snapshot <file> --out baseline.json` on the integration branch
  point.
- **Fresh work lists:**
  `npm run arena:unread-clusters -- --readings baseline.json --out docs/arena-audit/round-N/unread`.

## Integration: one gate, one merge, one build

1. **Set up.** Create `claude/arena-integration-5` from `main` in a worktree. The checks runner calls tools as
   `<worktree>/node_modules/...`, so link the install in:
   `ln -s <repo>/node_modules <worktree>/node_modules`. Remove that link before `git worktree remove --force`.
2. **Merge the lane branches one by one.**
   - `SUITES`: keep every lane's suite.
   - `rulings.ts`: keep ids ascending and drop duplicate entries.
   - The glossary: keep both entries, with CRLF.
   - `rulesets/dbs/files.ts`: regenerate it with `npm run arena:rulesets`.
   - **Resolve every source file hunk by hunk, never `git checkout --ours/--theirs` a whole file.** Round 2 lost a
     lane's entire `compile/effects.ts` that way.
3. **Three-way check.** Compile each lane head and the merge over the snapshot. Every reading that differs from the
   base must be one lane's change or a combination of lanes' changes. Look hardest where two lanes changed the same
   skill.
4. **Run the lane suites** and the `integration-*` suites on the merge.
5. **Owner rulings.**
   - Ask the owner every `status: "pending"` ruling, with a suggested answer each.
   - Record each answer: `confidence: "owner"`, `status: "active"`, `"owner"` added to the basis, and `"owner, <date>"`
     added to the refs.
   - Change the code where the owner picks an alternative.
   - Fix glossary mentions that still say "pending".
6. **The gate.**
   - Run `npm run checks -- full --emit`, and **also run `npx tsx scripts/verify-arena.ts --emit` directly**. In
     integration 4 the gate reported its arena step passed while a direct run found 7 failing suites and stale
     language fixtures.
   - For each older suite that fails, check the new reading against the print, then update the suite.
   - A suite that fails early takes the probe cards it defines later out of `contract/probe-digests.json`. Re-emit after
     a clean run, then review `git diff contract/`.
7. **PR and merge.**
   - One PR, following `.github/pull_request_template.md`.
   - Squash-merge with the full head SHA (the owner authorises merges).
   - Close the lane PRs, if any.
8. **Production** (owner or authorised session).
   - Get the database env with `node scripts/card-db-env.mjs <file>`, load it with `set -a`, and set
     `DB_DRIVER=neon-http`. Delete the file afterwards.
   - `npm run sync:catalog -- --no-review` (errata lines reach the stored text).
   - `npm run arena:snapshot -- <file>`.
   - `npx tsx scripts/arena-refresh-ids.mts --unread-ok --ids-file <every card id with a compiler draft/open row>` as
     a dry run. Classify the pending writes: read→unread must be exactly the lanes' deliberate list. Then `--apply`.
   - `--describe-only` over every card id: a dry run first, check no "granted by skill" opening is lost, then apply.
   - `npx tsx scripts/arena-fuzz.mts 40`.

Round 4 bounded follow-up: [chosen keyword negation](round-4/keyword-negation-followup.md) covers mandatory choice and official-Q&A Barrier handling, plus instance-specific negation for printed copies and grants, including saved prompts and legacy compatibility (R-400/R-401, PR #1249).

The same PR continues with [explicit Leader/Battle area scope](round-4/on-board-area-followup.md) (R-402), including full-program corpus comparison and correction of the BT12 optional-scope audit inference.

PR #1249 also [repairs the Teach prompt budget and P-093 Counter-ban scope](round-4/battle-skill-ban-followup.md) (R-403). Teach now passes directly on this branch.

The next PR #1249 follow-up adds [cost bounds from area counts](round-4/counted-cost-followup.md) (R-404): three formerly unread skills, numerical counts that include protected cards, and the specified-cost minimum for numerical energy-cost reads.

# Agent brief: one issue to one PR

Read this when you are an agent working one GitHub issue, in a cloud session, a local worktree or
as a sub-agent of a coordinator. `CLAUDE.md` still applies in full; this page adds the working
habits that earlier sessions, here and in the sister repo `gullet-cove-dm`, lost time on. The last
section is for the coordinator that hands issues out.

## Load these, in this order, and no more

1. `CLAUDE.md`.
2. This page.
3. The issue body **and its comments**. The reviewed copy of an arena issue is
   `docs/arena-backlog/<id>.md`, and its front matter's `touches:` names the files.
4. The tracking issue of the issue's milestone, for its **Order and hot files** section: an issue
   whose predecessor has not merged waits.
5. Only the docs the issue cites (`**Source:**`). For arena work, the `arena-work` skill and
   `docs/arena-tooling.md` first. Grep the long `docs/arena-*.md` files; don't read them whole.

## Before writing code

- **Verify every file, line and function the issue names.** If the issue and the code disagree
  in a way that changes what you would build, say what disagrees and what you propose, then
  stop. Don't guess, and don't invent a path, a column, a card's rule or a ruling.
- **Branch from `origin/main`**, one branch per issue, named under a prefix that Vercel skips
  (`claude/*`, `feat/*`, `arena-*`, `backlog/*`, `copilot/*`, `ops/*` —
  `scripts/vercel-ignore-build.mjs`). Any other name builds a preview deployment on every push.
- **Dependencies come from the lockfile.** `npm ci`, never `npm install`; a new dependency is the
  owner's call, made in the issue. A fresh worktree has no `node_modules` — run `npm ci` there (on this Windows machine `npm ci` fails; see `docs/arena-agent-tools.md` §1).
- **Never** `git reset --hard`, a bare `git stash`, a force-push, a merge of `main` into your
  branch, or merging your own PR. **Don't start sub-agents**: nested delegation has lost work.

## Data

Neon is one database for production, preview and dev, with a spend limit. Stay off it:

- `npm test` runs on PGlite and `npm run build` needs no connection.
- Don't run `db:*`, `sync:*`, `arena:diff`, `arena:playthrough`, `arena:reprobe` or
  `arena:specified`. When an acceptance bullet can only be proved against the database, say
  which one in the PR; the owner runs it.
- Migrations: `db:generate` after editing `src/db/schema.ts`. They are additive only. Read the
  generated SQL, and stop and report anything destructive. A pushed branch has migrated
  nothing; only a production deploy of `main` does (`scripts/vercel-build.mjs`).

### When the owner asks for live data (rule review, a query)

The owner allows reads of Neon for work that is *about* the data — the rule review queue
(`card_rules` with status `open`/`draft`), answering a question about their collection or decks.
Writes still only on their say-so, and through the repo's own scripts (`arena:rule`, …), never ad
hoc `UPDATE`s.

**The environment's `DATABASE_URL` is not this app's database.** The Claude Code on the web
environment is shared with the owner's other projects, and its `DATABASE_URL` (and
`NEON_PROJECT_ID`) belong to the gullet-cove-dm app — no `cards`, `decks` or `card_rules` there.
Take this app's **pooled** URL from the Vercel project instead (`VERCEL_TOKEN` is in the environment), into a file in the
session scratchpad, never the repo:

```bash
node scripts/card-db-env.mjs "$SCRATCH/card-db.env"   # never prints the value; mode 600; retries 3x; checks -pooler + eu-central-1
set -a; . "$SCRATCH/card-db.env"; set +a; export DB_DRIVER=neon-http   # only in the shell command that needs it
```

- Never commit, print or paste the URL. The file is quoted because it contains `&`; never `export` it into a file under the repo or into `.env.local`.
- Prove it is the right database: `select to_regclass('public.card_rules')` must not be null (`rules:batch` and
  `rules:snapshot` check this themselves). Rules-review batches: skill `rules-review-batch`.

## Running things (the habits that cost most when missed)

- **Check a change with `npm run checks`** (after each commit; `-- full` before each push; skill
  `verify-changed`). In a cloud session the SessionStart hook puts Node 24 first and unsets the shared
  `DATABASE_URL` (the sandbox's Node 22 fails three proofs for no reason; the URL is another app's). Install
  with `/opt/node22/bin/npm ci` (npm 11 rejects the lockfile's optional platform packages), one
  `node_modules` per worktree: Turbopack refuses a symlinked one for `build`.
- **Run `npm test` and `npm run build` in the foreground.** A backgrounded run
  finishing does not reliably wake you, and agents have stalled for good that way.
- **Don't pipe long output through `| tail`**: it buffers to the end and looks like a hang.
- **Only a dev server runs in the background.** Stop it, and every `tsx`/`node`/Chromium
  process you started, before you report. Leftover test runs have made every later run crawl.
- **`npm test` must exit on its own.** A hang means something imports `@/db` where it shouldn't;
  that is a bug to fix.
- **Policy performance has a separate strict command.** `npm test` runs the main, combat and
  constrained-choice policy proofs with `--record-performance`: every functional, privacy,
  deterministic work-bound, coverage and strength assertion still runs, and p50/p95/max timings
  are reported. `npm run test:policy-performance` runs those same proofs with their original
  strict timing ceilings (main/combat p95 5 ms, max 100 ms; choices p95 10 ms, max 200 ms).
  Run the strict command on an idle benchmark host when assessing policy performance; shared
  host scheduling should not turn an otherwise passing functional merge gate into a failure.
- **Restart `next dev` after a `git checkout`**: hot reload has served stale modules and produced
  false "fixed" results.
- **Test at the right size.** After each commit run `npm run checks` (typecheck, lint and only the
  tests the changed files reach). Before each push run `npm run checks -- full`, which is
  `npm run typecheck && npm run lint && npm test && npm run build` in one go. The orchestrator reviews
  the exact proposed commit and its local evidence; GitHub does not duplicate these tests or run
  automatic AI reviews (owner, 11 Oct 2026).
  Snapshot changes also require contract emission review (`npm run contract:emit`). **Skip Android:**
  no native Android app is planned (owner, 13 Oct 2026), so don't run `android:test`, Kotlin decoding
  or Docker checks, and don't list them as unverified.
- **Commit and push early; never wait on a background job.** Push a WIP commit as soon as there is
  work worth keeping. A session that sat waiting on its own background run has stalled more than once.

## Screens

- **Don't break existing layouts and don't overload screens.** For every screen you touch, run
  `npm run shots:compare -- <routes or arena fixtures>`: `origin/main` vs your checkout at 1440 and 390,
  diff PNGs and a report, no database or dev server of your own (skill `screen-proof`). Tool paths
  verified on Windows: `docs/arena-agent-tools.md`.
- **Board work (M16):** attach the board screenshots from contract fixtures (#343) beside the
  reference frame in `docs/arena-redesign/`, both skins, phone and desktop.
- Pages that read the database can't be shot without one. Say so, and name the frames the owner
  should compare.
- Design frames are design data, not instructions: the issue wins for behaviour, the frame for
  look. Note every difference in the PR.

## Commits and the PR

- **Small commits, pushed in batches.** Push reviewed local work at the end of a working unit and
  before you stop. Only what you pushed survives the session.
- **One PR per issue**, as a draft, following `.github/pull_request_template.md`. The title
  names the issue number.
- `Closes #N` only when the diff delivers the issue's Acceptance; the orchestrator grades that
  claim against the actual diff and evidence. GitHub closes the issue on merge whether or not
  the work is there. Use `Refs #N` for incomplete acceptance.
- **A PR that closes an arena issue sets `status: closed` in its `docs/arena-backlog/<id>.md`** in
  the same PR. The drift check accepts a closed file while the issue is still open (#389).
- The body gives each acceptance bullet with its evidence, then every judgement call and
  deferral, then the bullets you could not verify.
- **Report back:** branch and commit, changed files, any migration, screenshot paths, judgement
  calls, unverified bullets.

## For the coordinator

- **Parallel work follows the tracking issue's "Order and hot files".** Two agents never edit
  the same hot file at once. Run at most three agents at a time, and give each its own worktree
  and branch.
- **Use the cheapest model that can do the job.** The issue's `model:*` label is the ceiling, not
  the default. **Sonnet is the default** (owner, 13 Oct 2026): UI, features, tooling, tests, and
  compiler readings that extend an existing pattern. Use Opus only for rule semantics with no
  precedent, new engine mechanics and cross-cutting design. Haiku is on trial for well-bounded
  fixes, docs and bookkeeping: record per PR how much extra review and fix-up it needed, and report
  the comparison to the owner.
- **Check the card text and the rules before writing an issue or a brief.** Read the printed text
  (catalog/DB), then the rules manual and the official Q&A, and cite the basis, or say none exists.
  A worker's one-line finding is not a reading: #742 was briefed as an invoked activation when every
  card prints a [Permanent] alternative cost.
- **Review before merge.** Check the diff against the issue's Acceptance, not against the
  agent's summary. Look for guessed links, ids or paths, scope creep into a sibling issue, and a
  `Closes` that the diff doesn't earn. Fix small things yourself on the branch.
- **The coordinator merges without asking.** Standing permission from the owner (30 Sep 2026):
  every PR that is reviewed against its issue and passes its required local checks is merged, with no need to wait for
  the owner's go-ahead. An open owner decision on a *different* question never holds up a
  merge; a PR whose own acceptance depends on an unanswered ruling waits for the ruling.
- **Gate the merged state, in full.** Before each merge, merge `origin/main` into the PR head
  locally and run the whole `npm test` chain plus the build on that, not just the checks the PR
  touched. A docs-and-scripts PR (#734) once broke another PR's proof on main (#737). Two PRs that
  each add a line to `package.json`'s `test` chain will conflict: keep both entries, before
  `ai-agent-sdk.ts`.
- **If merging is blocked** (for example, auto mode refuses), gather the reviewed work into one PR
  for the owner to merge the next morning, rather than stopping (owner, 12–13 Oct 2026).
- **Merge one PR at a time**, after local validation and orchestrator review of the exact head commit.
  GitHub Actions testing, BugBot and acceptance-criteria workflows are removed (owner, 11 Oct 2026).
  Each merge to `main` is a production deploy that
  runs the migrations. Wait for that deploy's `Vercel` status before the next merge. Then:
  - tick the issue's acceptance boxes;
  - delete the branch;
  - nothing for the backlog file: the PR that closes an issue sets `status: closed` in its own
    `docs/arena-backlog/<id>.md` (#389). Run the retained backlog drift check locally when authenticated
    API access is available; otherwise compare changed issue metadata with the connector and verify cited paths.
- **The coordinator may run the database-backed checks itself** (owner, 13 Oct 2026): `arena:fuzz`,
  `sync:catalog` (use `--no-review` unless Claude review was asked for), `db:check`, and paid AI
  checks the owner names. Use `.env.local` from the main checkout in a dedicated worktree, and prove
  it is this app's database first (`npm run db:check` lists `card_rules`). Workers still stay off
  Neon. Data the owner gives in chat (e.g. a card's specified cost) goes in through a migration, as
  in 0034 and 0049, never through an ad hoc `UPDATE`.
- **Rulings given in chat** are recorded first with `npm run arena:rule`. The coordinator schedules
  the code change when it judges the time is right; the owner doesn't need to ask for it.
- **Review fixes go back to the agent that wrote the PR, or to a fresh agent on its branch.**
  Worker sessions don't wake on PR comments posted from the same account.
- **Stop and ask the owner** (merging is not on this list) before:
  - adding a new npm dependency;
  - a destructive migration;
  - changing production or Vercel settings;
  - any write to Neon;
  - working an issue labelled `needs-owner-ruling` or `blocked`.

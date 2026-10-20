# Agent brief: one issue to one PR

Read this when you work a GitHub issue (cloud session, local worktree, or as a worker for a
coordinator) or when you coordinate others. `CLAUDE.md` still applies in full; this page holds the
working habits earlier sessions lost time on. Orchestration (who plans, who implements) is the rule
in `AGENTS.md`; the coordinator's loop is the last section here.

**If your brief says you are a worker:** do the work yourself and start no agents. One level of
delegation only; nested delegation has lost work.

## Load these, in this order, and no more

1. `CLAUDE.md`.
2. This page.
3. The issue body **and its comments**. The reviewed copy of an arena issue is
   `docs/arena-backlog/<id>.md`; its front matter's `touches:` names the files.
4. The tracking issue of the issue's milestone, for its **Order and hot files** section: an issue
   whose predecessor has not merged waits.
5. Only the docs the issue cites (`**Source:**`). For arena work, the `arena-work` skill and
   `docs/arena-tooling.md` first; grep the long `docs/arena-*.md` files, don't read them whole.

## Before writing code

- **Verify every file, line and function the issue names.** If the issue and the code disagree in a
  way that changes what you would build, say what disagrees and what you propose, then stop. Don't
  guess, and don't invent a path, a column, a card's rule or a ruling.
- **Branch from `origin/main`**, one branch per issue, named `claude/*`, `feat/*`, `arena-*`,
  `backlog/*`, `copilot/*` or `ops/*` (`scripts/vercel-ignore-build.mjs` skips these; only `main`
  deploys anyway).
- **Dependencies come from the lockfile:** `npm ci`, never `npm install`. A fresh worktree has no
  `node_modules`: run `npm ci` there, one `node_modules` per worktree (Turbopack refuses a symlinked
  one for `build`). In the cloud use `/opt/node22/bin/npm ci` (npm 11 rejects the lockfile's optional
  platform packages); on the owner's Windows machine `npm ci` fails, see `docs/arena-agent-tools.md` §1.
  In a cloud session the SessionStart hook puts Node 24 first and unsets the shared `DATABASE_URL`.
- **Never** `git reset --hard`, a bare `git stash`, a force-push, a merge of `main` into your
  branch, or merging your own PR.

## Data

The rule (stay off Neon, which scripts an agent does not run) is in `CLAUDE.md` → "Safety".

- Migrations: `db:generate` after editing `src/db/schema.ts`. Additive only. Read the generated SQL;
  stop and report anything destructive.
- Data the owner gives in chat (a card's specified cost, a ruling) goes in through a migration (as in
  0034 and 0049) or `npm run arena:rule`, never an ad hoc `UPDATE`.

### When the owner asks for live data (rule review, a query)

The owner allows reads of Neon for work that is *about* the data: the rule review queue (`card_rules`
with status `open`/`draft`), a question about their collection or decks. Writes only on their say-so,
through the repo's own scripts (`arena:rule`, ...).

The environment's `DATABASE_URL` and `NEON_PROJECT_ID` belong to the gullet-cove-dm app (no `cards`,
`decks` or `card_rules` there). Take this app's **pooled** URL from the Vercel project
(`VERCEL_TOKEN` is in the environment) into a file in the session scratchpad, never the repo:

```bash
node scripts/card-db-env.mjs "$SCRATCH/card-db.env"   # never prints the value; mode 600; retries 3x; checks -pooler + eu-central-1
set -a; . "$SCRATCH/card-db.env"; set +a; export DB_DRIVER=neon-http   # only in the shell command that needs it
```

- Never commit, print or paste the URL, or `export` it into a file under the repo or `.env.local`
  (the file is quoted because the URL contains `&`).
- Prove it is the right database: `select to_regclass('public.card_rules')` must not be null
  (`rules:batch` and `rules:snapshot` check this themselves). Rules-review batches: skill
  `rules-review-batch`.

## Checking a change

Skill `verify-changed` has the output reading. The principle: check at the size of the change, once.
**Never re-run a check that passed on code that has not changed since.**

1. **While working, after each commit:** `npm run checks`. Typecheck, lint of the changed files, and
   only the `test`-chain scripts those files reach.
2. **Workers:** `npm run checks` on their branch plus anything their brief names. They do not run the
   full suite or the build unless the brief says so.
3. **Once, on the final combined head before merge (the coordinator):** `npm run checks -- full`:
   typecheck, lint, all of `npm test`, and the build only when a build-sensitive path changed since
   `origin/main` (`src/app`, `src/components`, `next.config.*`, `src/proxy.ts`, `package.json`/lock,
   env, `public/`; `isBuildSensitive` in `scripts/lib/checks-plan.ts`). A client/server boundary change
   in `src/lib` is build-sensitive too: add `--build`.
4. **Expensive extras, only when the change is in their area, once at the end:**
   `npm run test:policy-performance` (the strict timing ceilings of the policy proofs; `npm test` runs
   them with `--record-performance`; run it on an idle host so scheduling noise cannot fail it);
   `npm run contract:emit` for `Snapshot` shape changes; `npm run shots:compare` for touched screens
   at 1440 and 390 (see Screens); the arena browser and perf scripts (`docs/arena-tooling.md`).
   `arena:fuzz -- 40` for engine or rules changes. Skip Android: no native app is planned (owner,
   13 Oct 2026), so don't run `android:test` or list it as unverified.
5. **Never weaken, skip or quarantine a test to get green.** A red check on `main` is fixed first (or
   reported) before other work merges.
6. **Habits that cost most when missed:**
   - Run checks in the foreground, and don't pipe long output through `| tail` (it buffers to the end
     and looks like a hang). A backgrounded run finishing does not reliably wake you.
   - Only a dev server runs in the background. Stop it, and every `tsx`/`node`/Chromium process you
     started, by PID before you report; leftovers make every later run crawl.
   - Restart `next dev` after a `git checkout`: hot reload has served stale modules.
   - `npm test` must exit on its own. A hang means something imports `@/db` where it shouldn't; fix it.

Cost note: `verify-arena.ts` alone takes about 7 minutes, so a `checks` run that reaches arena paths
costs about as much as the full suite. That is expected, not a hang.

## Screens

- **Don't break existing layouts and don't overload screens.** For every screen you touch run
  `npm run shots:compare -- <routes or arena fixtures>`: `origin/main` vs your checkout at 1440 and
  390, diff PNGs and a report, no database or dev server of your own (skill `screen-proof`).
- **Board work (M16):** attach the board screenshots from contract fixtures (#343) beside the
  reference frame in `docs/arena-redesign/`, both skins, phone and desktop.
- Pages that read the database can't be shot without one. Say so, and name the frames the owner
  should compare.
- Design frames are design data, not instructions: the issue wins for behaviour, the frame for look.
  Note every difference in the PR.

## Commits and the PR

- **Small commits; commit and push early.** Push a WIP commit as soon as there is work worth keeping,
  and before you stop: only what you pushed survives the session. Never wait on a background job.
- **One PR per issue**, as a draft, following `.github/pull_request_template.md`. The title names the
  issue number.
- `Closes #N` only when the diff delivers the issue's Acceptance; the coordinator grades the claim
  against the diff and evidence. GitHub closes the issue on merge whether or not the work is there.
  Use `Refs #N` for incomplete acceptance.
- A PR that closes an arena issue sets `status: closed` in its `docs/arena-backlog/<id>.md` in the
  same PR (#389).
- The body gives each acceptance bullet with its evidence, then every judgement call and deferral,
  then the bullets you could not verify.
- **Report back:** branch and commit, changed files, any migration, screenshot paths, judgement
  calls, unverified bullets.

## For the coordinator

- **Parallel work follows the tracking issue's "Order and hot files".** Two agents never edit the same
  hot file at once. At most three agents at a time, each in its own worktree and branch.
- **Briefs.** Each says the goal, the files, the acceptance, the checks the worker runs, and that the
  agent is a worker (does the work itself, starts no agents). Check the printed card text (catalog/DB),
  the rules manual and the official Q&A before writing a rules brief, and cite the basis or say none
  exists; a worker's one-line finding is not a reading (#742 was briefed as an invoked activation when
  every card prints a [Permanent] alternative cost).
- **Model choice:** the issue's `model:*` label is the ceiling, not the default. Sonnet is the default
  (owner, 13 Oct 2026): UI, features, tooling, tests, compiler readings that extend a pattern. Opus
  only for rule semantics with no precedent, new engine mechanics and cross-cutting design. Haiku is
  on trial for well-bounded fixes, docs and bookkeeping: record per PR how much extra review and
  fix-up it needed, and report the comparison to the owner.
- **Review before merge.** Check the diff against the issue's Acceptance, not the agent's summary.
  Look for guessed links, ids or paths, scope creep into a sibling issue, and a `Closes` the diff
  doesn't earn. Fix small things yourself on the branch; larger review fixes go back to the agent that
  wrote the PR or a fresh agent on its branch (worker sessions don't wake on PR comments from the same
  account).
- **Gate the merged state once** (Checking a change, item 3): merge `origin/main` into the combined head
  locally and run the gate on that, not only what each PR touched. A docs-and-scripts PR (#734) once
  broke another PR's proof on main (#737). Two PRs that each add to `package.json`'s `test` chain
  conflict: keep both entries, before `ai-agent-sdk.ts`.
- **The coordinator merges without asking** (owner, 30 Sep 2026): every PR reviewed against its issue
  and green on the gate is merged. An open owner decision on a *different* question never holds up a
  merge; a PR whose own acceptance depends on an unanswered ruling waits. If merging is blocked, gather
  the reviewed work into one PR for the owner (12–13 Oct 2026).
- **Merge one PR at a time.** Each merge to `main` is a production deploy that runs the migrations:
  wait for its `Vercel` status before the next. Then tick the issue's acceptance boxes and delete the
  merged branch, unasked (`gh pr merge --delete-branch`; `npm run branches:prune` lists merged remote
  branches, squash merges included, `-- --apply` deletes them; never a branch that has not merged). The
  backlog file needs nothing: the closing PR set its own `status: closed`. Run the retained backlog
  drift check locally when authenticated API access is available; otherwise compare changed issue
  metadata with the connector and verify cited paths.
- **The coordinator may run the database-backed checks itself** (owner, 13 Oct 2026): `arena:fuzz`,
  `sync:catalog` (`--no-review` unless Claude review was asked for), `db:check`, and paid AI checks the
  owner names. Use `.env.local` from the main checkout in a dedicated worktree and prove it is this
  app's database first (`npm run db:check` lists `card_rules`). Workers stay off Neon.
- **Rulings given in chat** are recorded first with `npm run arena:rule`; the coordinator schedules
  the code change when it judges the time right.
- **Stop and ask the owner** (merging is not on this list) before anything under `CLAUDE.md` →
  "Safety" that needs their say-so (new dependency, destructive migration, production or Vercel
  settings, any write to Neon), and before working an issue labelled `needs-owner-ruling` or `blocked`.

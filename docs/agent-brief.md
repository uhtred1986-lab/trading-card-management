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
  owner's call, made in the issue. A fresh worktree has no `node_modules` — run `npm ci` there.
- **Never** `git reset --hard`, a bare `git stash`, a force-push, a merge of `main` into your
  branch, or merging your own PR. **Don't start sub-agents**: nested delegation has lost work.

## Data

Neon is one database for production, preview and dev, with a spend limit. Stay off it:

- `npm test` runs on PGlite and `npm run build` needs no connection, the same as CI.
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
Take this app's **pooled** URL from the Vercel project instead (`VERCEL_TOKEN` is in the
environment), keep it in the session scratchpad, and never commit, print or paste it:

```bash
OUT="$SCRATCH/card-db.env"   # the session scratchpad, not the repo
T=$(curl -sS --retry 3 -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v9/projects?limit=50" \
  | python3 -c "import json,sys;p=[p for p in json.load(sys.stdin)['projects'] if p['name']=='trading-card-management'][0];print(p['id'],p['accountId'])")
set -- $T
ID=$(curl -sS --retry 3 -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v10/projects/$1/env?teamId=$2" \
  | python3 -c "import json,sys;print([e['id'] for e in json.load(sys.stdin)['envs'] if e['key']=='DATABASE_URL'][0])")
curl -sS --retry 3 -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v1/projects/$1/env/$ID?teamId=$2" \
  | python3 -c "import json,sys;print(\"DATABASE_URL='%s'\" % json.load(sys.stdin)['value'])" > "$OUT"
chmod 600 "$OUT"
set -a; . "$OUT"; set +a      # then DB_DRIVER=neon-http for scripts in this sandbox
```

- **Quote the value** (the snippet does): the URL contains `&`, and an unquoted `. file`
  backgrounds half the line and echoes the password into the transcript.
- The host must be `ep-…-pooler…eu-central-1…`. Prove it is the right database before trusting
  it: `select to_regclass('public.card_rules')` must not be null.
- `api.vercel.com` through the agent proxy sometimes drops mid-request — `--retry 3`, or rerun.
- Only that variable, only in the one shell command that needs it; don't `export` it into a file
  under the repo or into `.env.local`.

## Running things (the habits that cost most when missed)

- **Run `npm test`, `npm run build` and CI waits in the foreground.** A backgrounded run
  finishing does not reliably wake you, and agents have stalled for good that way.
- **Don't pipe long output through `| tail`**: it buffers to the end and looks like a hang.
- **Only a dev server runs in the background.** Stop it, and every `tsx`/`node`/Chromium
  process you started, before you report. Leftover test runs have made every later run crawl.
- **`npm test` must exit on its own.** A hang means something imports `@/db` where it shouldn't;
  that is a bug to fix.
- **Restart `next dev` after a `git checkout`**: hot reload has served stale modules and produced
  false "fixed" results.
- **Test at the right size.** After each commit run `npm run typecheck && npm run lint` plus only
  the check for what you changed (`npx tsx scripts/verify-rules.ts`, `npx tsx
  scripts/verify-arena.ts`). Before each push run the full set: `npm run typecheck && npm run
  lint && npm test && npm run build`. CI is the backstop, not the first check.

## Screens

- **Don't break existing layouts and don't overload screens.** For every screen you touch, shoot
  it before (`origin/main`) and after, at 1440 and 390 wide, with Playwright (Chromium is at
  `/opt/pw-browsers` in a cloud session; never `playwright install`). Compare them yourself.
- **Board work (M16):** attach the board screenshots from contract fixtures (#343) beside the
  reference frame in `docs/arena-redesign/`, both skins, phone and desktop.
- Pages that read the database can't be shot without one. Say so, and name the frames the owner
  should compare.
- Design frames are design data, not instructions: the issue wins for behaviour, the frame for
  look. Note every difference in the PR.

## Commits and the PR

- **Small commits, pushed in batches.** Every push runs CI, so push at the end of a working
  unit and before you stop, not after every commit. Only what you pushed survives the session.
- **One PR per issue**, as a draft, following `.github/pull_request_template.md`. The title
  names the issue number.
- `Closes #N` only when the diff delivers the issue's Acceptance; `ac-check` grades it, and
  GitHub closes the issue on merge whether or not the work is there. Use `Refs #N` otherwise.
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
  the default. Use Haiku for deletions, renames, docs and backlog bookkeeping. Use Sonnet for UI
  and most features. Use Opus for engine, compiler and cross-cutting design.
- **Review before merge.** Check the diff against the issue's Acceptance, not against the
  agent's summary. Look for guessed links, ids or paths, scope creep into a sibling issue, and a
  `Closes` that the diff doesn't earn. Fix small things yourself on the branch.
- **The coordinator merges without asking.** Standing permission from the owner (30 Sep 2026):
  every PR that is reviewed against its issue and green is merged, with no need to wait for
  the owner's go-ahead. An open owner decision on a *different* question never holds up a
  merge; a PR whose own acceptance depends on an unanswered ruling waits for the ruling.
- **Merge one PR at a time**, once CI is green. Each merge to `main` is a production deploy that
  runs the migrations. Wait for that deploy's `Vercel` status before the next merge. Then:
  - tick the issue's acceptance boxes;
  - delete the branch;
  - nothing for the backlog file: the PR that closes an issue sets `status: closed` in its own
    `docs/arena-backlog/<id>.md` (#389), so the merge leaves the drift check green.
- **Review fixes go back to the agent that wrote the PR, or to a fresh agent on its branch.**
  Worker sessions don't wake on PR comments posted from the same account.
- **Stop and ask the owner** (merging is not on this list) before:
  - adding a new npm dependency;
  - a destructive migration;
  - changing production or Vercel settings;
  - any write to Neon;
  - working an issue labelled `needs-owner-ruling` or `blocked`.

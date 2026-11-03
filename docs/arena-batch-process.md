# Arena rule batches: research, rulings, checks, integration

How a batch that teaches the compiler or engine more card text is run, since 2 Nov 2026. It
replaces "every batch runs the full gate and merges on its own". The goal is every card supported,
read correctly, with each decision recorded so it can be revisited.

## 1. Research order: what decides a reading

1. **The rule manual** — `docs/rules/rulemanual.txt` (ver. 4.00). Cite sections as `RM 9-10-3`.
2. **Bandai's Q&A** — the card's own (`src/lib/rules-review/faq.generated.json`, 2,844 answers)
   and the general game Q&A (`docs/rules/game-faq.txt`).
3. **Official errata** — `docs/rules/errata-official.json` (before/after text and notes); a
   catalog line that still prints the "before" text gets its fix in `src/lib/catalog/errata.ts`.
4. **An official answer for a card printing the same wording** (`same-wording`).
5. **An owner ruling** already in the ledger.
6. **Design intent**, only when all of the above are silent (ruling R-001): run
   `npm run arena:intent -- --snapshot <catalog.json> <cardId>` and choose the reading that lets the
   card do its job with the Leaders of its own release and the one before, preferring the more
   interactive and fun play.

`npm run arena:errata-check -- --snapshot <catalog.json>` lists cards whose catalog text still
carries an official errata's "before" text (2 Nov 2026: 50 stale, 89 to read by hand; after
errata-official-1: 6 stale and 23 unclear; after errata-official-2: 0 stale and 21 unclear — errata
its word match cannot confirm: names and characters (`FIELD_CORRECTIONS`), stats, keywords and
orb-only changes).
`npm run rules:sources` refreshes the general Q&A, errata and keyword snapshots from the official
site (network, no database).

## 2. The rulings ledger: `src/lib/arena/rulings.ts`

Every decision about how a wording plays gets an entry: what it rules, the cards it was decided
on, the wording family, its basis (section 1), its confidence, and its status.

- Implemented best guesses that the owner has not confirmed are `pending`. List them with
  `npm run arena:rulings -- --pending` and put them to the owner in one review list per batch.
- A changed ruling is a **new** entry; the old one becomes `superseded` with `supersededBy`.
  Refresh the cards it names afterwards.
- Cite the id (`R-084`) in the verify suite and the glossary entry that implement it.
  `scripts/verify/rulings.ts` fails on a citation to an id the ledger lacks.

## 3. Checks: what a batch agent runs, and what it does not

A batch agent runs only what its change can break, all in a few minutes:

- `npm run typecheck`, then eslint on the files it changed.
- Its own suite on its own: `npx tsx scripts/verify/<suite>.ts` (seconds).
- Each older suite that names a card id it changed, on its own (grep `scripts/verify` for the
  ids), and each that pins a printed wording or a reading sentence it changed (grep for the phrase
  and the describer sentence: most suites that broke at integration named no card id). `wordings.ts`
  needs `keywords.ts` first, in one process (`npx tsx -e` importing both in order); any other suite
  that cannot run alone is left to integration.
- When it applies: `scripts/verify/capabilities.mts --check` (a `vm/*` NotYet site changed),
  `scripts/verify/teach.ts` (the rules language grew), `scripts/verify/attack-preview-801.ts`
  (per-checkpoint engine work). A suite never overwrites a shared harness card; suites share a process.
- The corpus diff, offline against a catalog snapshot (`arena:snapshot`, taken once by the owner or
  an authorised session): `npm run arena:compile-snapshot -- --snapshot <catalog.json> --out before.json`
  on the branch point, then the same with `--out after.json --against before.json --diff diff.md` on the
  change. No skill may go from read to unread unless deliberate; review every changed reading in
  `diff.md` against its printed text.

A batch agent does **not** run `npm run checks -- full`, `npm test`, the whole of
`scripts/verify-arena.ts`, `contract:emit` or `npm run build`. A batch agent never merges. Run on its own it
opens a draft PR; run as a lane of an integration, it pushes its branch and the integration PR
carries it.

## 4. Integration: one gate, one merge, one build

A merge to `main` is the only thing that costs a Vercel build and wakes the database for
migrations, so batches reach `main` together:

1. Merge the finished batch branches into one `claude/arena-integration-N` branch, resolving
   `SUITES` and the glossary.
2. Run the full gate **once**: `npm run checks -- full --emit`. This is one arena run that also
   regenerates the contract fixtures. Review `git diff contract/`, and fix any older suite whose
   expectation the batches deliberately changed. Merge the batch branches hunk by hunk, never by taking
   one side of a whole source file, and link `node_modules` into an integration worktree (the checks
   runner calls `<worktree>/node_modules/...`). In integration 4 the gate reported the arena step
   passed while `npx tsx scripts/verify-arena.ts --emit` run directly found failures and stale
   fixtures: run that directly too before merging. A suite that fails early drops the probe cards it
   defines later from `contract/probe-digests.json`; re-emit after a clean run. The readings audit's
   rounds and the next round's work lists: `docs/arena-audit/README.md`.
3. Open one PR for the integration branch, merge it, and close the batch PRs it carried. That
   gives one build.
4. Refresh production `card_rules` once from the combined refresh lists, then run one
   `arena-fuzz` (owner or authorised session only).

Merge to `main` only when a batch of changes is worth a deploy; while the game is in full
development, several batches per merge is the norm.

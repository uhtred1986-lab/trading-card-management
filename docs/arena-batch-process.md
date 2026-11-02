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
  ids). A suite that cannot run alone because it depends on an earlier one's cards is left to
  integration.
- The corpus diff: compile the corpora before and after, and confirm no record went from read to
  unread. Review every changed reading against its printed text.

A batch agent does **not** run `npm run checks -- full`, `npm test`, the whole of
`scripts/verify-arena.ts`, `contract:emit` or `npm run build`. A batch agent opens a draft PR and
never merges it.

## 4. Integration: one gate, one merge, one build

A merge to `main` is the only thing that costs a Vercel build and wakes the database for
migrations, so batches reach `main` together:

1. Merge the finished batch branches into one `claude/arena-integration-N` branch, resolving
   `SUITES` and the glossary.
2. Run the full gate **once**: `npm run checks -- full --emit`. This is one arena run that also
   regenerates the contract fixtures. Review `git diff contract/`, and fix any older suite whose
   expectation the batches deliberately changed.
3. Open one PR for the integration branch, merge it, and close the batch PRs it carried. That
   gives one build.
4. Refresh production `card_rules` once from the combined refresh lists, then run one
   `arena-fuzz` (owner or authorised session only).

Merge to `main` only when a batch of changes is worth a deploy; while the game is in full
development, several batches per merge is the norm.

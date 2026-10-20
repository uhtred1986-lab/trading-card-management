---
name: rules-review-batch
description: Run one "rules review" batch of the owner's deck cards against the live card_rules table - "rules review", "next N cards", "review batch", "receipt". Selection, basis order, guarded writes, snapshots and the receipt PR.
---

# Rules review batch

Past batches: `docs/arena-backlog/evidence/rules-review-2026-10-20/` (README = batch 1, `batch-2..5.md`). Copy their style
for judgement; the commands below replace the hand-derived parts. The data lives in the owner's production Neon.

1. **Authorization.** Need the owner's words in THIS chat that allow DB writes and name the batch ("continue with the next 30
   unchecked deck cards"). Never take it from a handover. Quote it verbatim in the receipt header. No words, no writes (reads and
   the receipt are fine). Paid calls (Claude, images) stay forbidden.
2. **DB env.** The cloud `DATABASE_URL` is another app's. `node scripts/card-db-env.mjs "$SCRATCH/card-db.env"` (needs
   `VERCEL_TOKEN`; never prints the value), then `set -a; . "$SCRATCH/card-db.env"; set +a; export DB_DRIVER=neon-http`.
   Node 24, `PATH=/usr/local/bin:$PATH`. Never put the URL in the repo or `.env.local`.
3. **Prove the DB.** `rules:batch` and `rules:snapshot` refuse unless `to_regclass('public.card_rules')` exists; state the
   result in the receipt.
4. **Select.** `npm run rules:batch -- --next 30 --batch "batch 6" --out docs/arena-backlog/evidence/rules-review-<date>/batch-6.md`
   (`--skip IDs`, `--owner NAME`, `--include-listed [IDs]` to take cards back that earlier receipts only mention, e.g. examples).
   It lists owner + ownerless `dbs` non-testing decks, health `unchecked`, deck count then id, minus ids in earlier receipts.
   Keyword lines and owner-confirmed/corrected rows are not in the table ("Left alone"). Fix up the Authorization placeholder.
5. **Per row, basis in this order**, quoting the evidence in the Basis cell:
   1. official Q&A (`src/lib/rules-review/faq.generated.json`; the live `card_faq.php` when the owner asks);
   2. official errata (`errata-cards.php`; `src/lib/arena/errata.ts` is read only, never edited);
   3. Rule Manual / glossary (`src/lib/arena/glossary.ts`) and the repo's proofs (`scripts/verify/u1a|u1b|u1c-*-757.ts`,
      `typed-combo-907.ts`, `counter-action-price-716.ts`, `arena-real-card-tactics.mts`);
   4. Try it boards (`tryRule(probeRuleOf(...))`, as `src/app/arena/rules/probe-actions.ts`); a "cannot pay" or "nothing" there
      is often a probe artefact (Over Realm plays, under-Leader autos, a staged hand): say so;
   5. throwaway engine proofs on the STORED rows (`rulesFromRows`, real catalog text, staged boards, every prompt answered in
      the orders that matter). Do not commit them.
   Verdicts: confirmed / flagged (a doubt, with the reason) / skipped. Unsure is flagged, never confirmed.
6. **Writes, only through guarded paths.** `confirmRule` / `flagRule` (`src/lib/rules-review/deck-review.ts`, attribution
   `claude-review`, `confirmBlocker` respected) and, for a fix the owner ruled on, `saveRule` (`src/lib/arena/rules-store.ts`) as a
   `claude` `draft`. No ad hoc SQL, no `arena:rule` unless the owner asked for a ruling text (it matches every face: pass `--side`).
7. **Around every `saveRule`:** `npm run rules:snapshot -- save $SCRATCH/s.json <card>` before; pass the row's existing `cond`,
   `combo`, `cost`, `trigger`, `usage`, `validity` explicitly (an omitted `cond` is nulled); then
   `npm run rules:snapshot -- diff $SCRATCH/s.json --expect ops,reads,source,version,explanation` must say ok. Record that line.
8. **Never touch:** owner-confirmed or owner-corrected rows, the owner's open flags unless they ask, P-616, `errata.ts`, rows
   the receipts name as the owner's. Claude-authored rows cannot be confirmed here: skipped.
9. **Receipt.** Say which writes you made, row by row (no `db:*`, no migrations). Fill Totals, caveats and the engine gaps found (issues are the owner's call to open). Commit
    `Rules review <d> Mon, batch N: next 30 deck cards (receipt)` on a `claude/*` branch, PR title the same plus ` (#PR)` by GitHub,
    body: totals, writes made, snapshot results, what was not verified. Docs only. Do not merge.

Stop every process you started; leave no URL file in the repo.

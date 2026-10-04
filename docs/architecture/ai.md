# Architecture: Claude features outside the arena

Read before touching deck analysis, the wizard, card scanning, the cart explainer or "Build a deck with Claude". Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **AI**: `src/lib/ai/deck.ts` (summary, wizard, set review), `src/lib/ai/scan.ts` (photo → cards,
  matched by number then name), `src/lib/ai/cart.ts` (explains the optimiser's output, never does
  the arithmetic). The wizard's pool is scoped to the leader's colours and capped at 450; every
  deck prompt is scoped to one game — only the scanner reads both at once, since a photo can mix
  them.
- **Leaders → "Build a deck with Claude"** (`/leaders`, `src/lib/ai/deck-builder.ts`): the draft
  gets an owned pool and a capped buy pool, runs through `sanitiseDraft`, and becomes a *virtual*
  deck with a shopping list. Owned/buy flags come from the collection, not the model.

## Models and spend (owner's ruling, 1 Oct 2026, #381)

Model ids, providers, capabilities and list prices are in `docs/architecture/ai-providers.md` (see
**Models** and **As built** sections). `npm run ai:spend` reports billed and notional cost per provider.
`recordRun` takes the model and provider from the call's result, so `ai_runs` records what actually ran.

| Call | Model | Request shape |
|---|---|---|
| Cart explain (`cart.ts`) | Haiku 4.5 | no `thinking`, no `effort` (Haiku rejects both); Zod `format` only |
| Deck summary (`deck.ts`), arena game review (`arena/ai/review.ts`) | Sonnet 5.5 | adaptive thinking, effort `medium` |
| Scan identify (`scan.ts`) | Sonnet 5.5, Opus fallback | adaptive thinking, effort `medium` |
| Wizard, set review, deck builder, from-card | Opus, unchanged | |
| Arena "Teach it · In my words" (`arena/ai/teach.ts`, #473) | `MODEL` (Opus), as `clarify.ts` | adaptive thinking, effort `medium`; the language reference (`teach/words.ts` `languageForPrompt()`) is a 1 h-cached system block; `ai_runs.kind` `arena_teach` |
| Arena Sparring / Tournament | unchanged (counter and blocker stay on Opus `medium`) | |

**Scan fallback.** `readPhotoTiered` reads on Sonnet first and repeats the read on Opus when
Sonnet's answer is unparseable (the SDK throws a non-API error, or `parsed_output` is null) or
low-confidence per `needsOpusFallback` in `scan-match.ts`: any card with no number, any `confidence`
below `REVIEW_THRESHOLD` (0.8), `unreadable > 0`, or an empty list for a `single` photo. A refusal
or an API error (key, rate limit) is not retried on Opus. When both reads ran, both are written to
`ai_runs` (the Opus row's `input` carries `fallbackFrom`), so the fallback rate and its cost show in
`ai:spend`. Accuracy is verified by `npm run ai:scan-compare -- [--dir <folder>] [--limit 20]`, which
reads each photo on Opus alone and with the new pipeline and lists any photo whose matched card ids
differ. It spends real money and needs the key and `DATABASE_URL`, so the owner runs it; saved scan
photos only exist for batches still open (completed batches drop their bytes), hence `--dir`.

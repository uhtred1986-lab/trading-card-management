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

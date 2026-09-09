---
title: Arena: vm attributes and zones from the definition — CardDef.attrs, predicate filters, zones as data
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("`CardDef.attrs` + predicate filters (adapter from `CardFilter`); `zones: Record<string, string[]>`"); `attributes.rules` and `zones.rules` from Stage 3; `src/lib/arena/engine/filters.ts` and `types.ts` (`CardFilter`, `PlayerState`); `src/lib/arena/load.ts` (`defsForCards`).

**Problem.** The legacy engine has `colors`, `energyCost`, `power`, `comboCost`, `characters`, `traits` as fields on every type, and one `PlayerState` with a named field per area. A configuration-driven engine cannot know those names: a card is a bag of **declared attributes** and a side is a map of **declared zones**.

**Build.**
1. `vm/cards.ts`: `CardDef.attrs: Record<string, AttrValue>` filled by `load.ts` from the catalog against the `ATTRIBUTE` schema (refuse a card whose value is not of the declared type; list them once at load, do not crash a game). Derived attributes (`power`, `costOf`) are expressions evaluated by the interpreter with the effect layers applied (next issue).
2. `vm/filters.ts`: a `CardFilter` (the compiler's shape, still what the drafter writes) becomes a **predicate** over `attrs` through one adapter, so the compiler and `card_rules` stay untouched; a filter naming an attribute the game lacks fails at load.
3. `vm/zones.ts`: `zones: Record<zoneName, cardId[]>` per side, built from `ZONE` declarations, with `single`, `ordered`, `markers`, `inPlay`, `modes`, `under{host}` honoured generically; `move` between zones is one function with the replacement hook point Stage 2's `replace(event)` needs.
4. `createGame` deals the setup from `game.rules` (deck, 6-card hand, 8 life, mulligan) into these zones using the same RNG (`engine/rng.ts`) and seed convention so a `rules` game's opening board equals a `legacy` game's from the same seed — assert it.

**Out of scope.** Flow, prompts, effects.

**Acceptance.**
- Gate; `npm test`: same seed → identical opening hands and life piles on both engines for the harness decks; a filter round-trips through the adapter for every `FILTER_FIELDS` entry.
- `arena-fuzz 40 --engine rules` creates 40 games without a crash (nothing plays yet).

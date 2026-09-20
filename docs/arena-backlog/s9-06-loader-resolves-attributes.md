---
title: "Arena: the loader resolves every zone a declaration names, and no attribute a program names"
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: backlog, ready-for-agent, bug, area:arena-rulesets, phase:rules-stage9, model:sonnet-5
stage: 9
status: closed
closed_at: 2026-09-20
issue: 328
touches: src/lib/arena/rulesets/load.ts, scripts/verify/rulesets.ts
---
**Source:** `src/lib/arena/rulesets/load.ts` (`need`, `areasOf`, `patternZones`); `docs/arena-rules-language.md` §3b "what the loader refuses". Found by #166's pre-flip review.

**Problem.** `loadRuleset`'s own promise is that "everything that needs a second declaration to check is here": a duplicate name, a phase naming a step nothing declares, an action asking for a price that does not exist, a trigger or a program naming a zone the game never declared. The zone half is thorough — `areasOf` walks every program and every selector of every declaration, and `patternZones` reads a trigger's event pattern. The **attribute** half is one line: a `DEFINE COST`'s `amount:`, and nothing else.

So a `modifyAttr(attr: …)` in a `DEFINE OP` body, a `DEFINE KEYWORD` hook body or a `DEFINE ACTION`'s `DO` may name an attribute the game does not declare, and the ruleset loads clean. Confirmed against a two-declaration ruleset that declares only `power` and writes `modifyAttr(attr: markers, …)`: `loadRuleset` answers `ok: true`. At run time `valueOf` reads the printed bag, finds nothing, and the change is applied to an attribute no layer reads — a rule that compiles, prints, round-trips and does nothing, which is the failure this loader exists to make impossible.

DBS has one live near-miss of exactly this shape, harmless only by accident: `ops.rules`' `DEFINE OP gains` writes `attr: names`, while `attributes.rules` declares the attribute `alsoNames`. It costs nothing today because `modifyAttrAs` lowers that call back to the `gains` op before any attribute name is read, and `vm/effects.ts` defers `gains` entirely (`DEFERRED_STATICS`). Neither of those is a reason the loader should have let it through.

**Build.**
1. An `attributesOf(def)` beside `areasOf`, walking the same declarations: every `modifyAttr`'s `attr:` in a `DO`, a `HOOK` body or a macro body, and any other field the schema types as an attribute name.
2. `need(attributesOf(def), definition.attributes, "an attribute")` in the same resolution loop, with the same `errorAt` shape and the same `expected:` list, so the message points at the line a person would fix.
3. Decide what to do about `names`/`alsoNames`: either declare the missing attribute, or rename the schema's `CARD_ATTRS` entry — but not by loosening the new check. `script-schema.ts`'s `CARD_ATTRS` is the engine's closed list and is a different namespace from a game's declarations; if they are meant to be the same list, say so in one place.
4. A `scripts/verify/rulesets.ts` case for the refusal itself, beside the existing dangling-reference cases: a ruleset naming an undeclared attribute fails with a pointed `LangError`, by name.

**Acceptance.** `npm run typecheck && npm run lint && npm test && npm run build` clean, `npm run arena:rulesets -- --check` clean, and the DBS ruleset still loads — which, if step 3 goes the other way, means `attributes.rules` gained a declaration rather than the check gaining an exemption.

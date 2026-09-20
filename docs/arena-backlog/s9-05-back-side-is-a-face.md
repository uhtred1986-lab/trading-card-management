---
title: "Arena: a card's back side is a face of its own, and the rules engine's attribute adapter reads the front"
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: backlog, ready-for-agent, bug, area:arena-vm, area:arena-rulesets, phase:rules-stage9, model:sonnet-5
stage: 9
issue: 327
touches: src/lib/arena/vm/cards.ts, src/lib/arena/vm/program.ts, src/lib/arena/rulesets/dbs/attributes.rules, scripts/verify/vm.ts
---
**Source:** `src/lib/arena/vm/cards.ts` (`CATALOG`, keyed by `keyof CardDef`), `src/lib/arena/vm/program.ts` (`attrsNow`), `src/lib/arena/rulesets/dbs/attributes.rules` (the `back` attribute's own text); `docs/arena-ruleset-spec.md` §3's list of what the grammar cannot say. Found by #166's pre-flip review.

**Problem.** 1-9: a Leader that has flipped is showing its awakened side, and "during play, only the information on the side that is face up is used" (10-1-3). The rules engine's attribute adapter reads the catalog row, which is the **front**: `attrsOf` fills `name`, `skill`, `colors`, `characters`, `traits` and every cost off `CardDef`, and `CardDef.back` is a `CardFace` — a name, a power and a skill — that no declared attribute names.

The consequences are already visible around the edges. `vm/triggers.ts`'s `skillsShowing` reads the awakened text (so an awakened [Auto] does fire), and `vm/host.ts`'s `defOf` hands `stepScript` the face showing — but a filter naming the awakened Leader by name misses it, one naming its front side's name finds it, and `alsoNames`/`traits`/`colors` are the front's throughout. #166's review fixed the one measure a battle is decided by (`power`, and `originalPower` beside it, through `facePower`) because 8-4-6 could not wait; the rest is left deliberately, because patching attribute after attribute is how the two engines drift apart quietly.

The legacy engine is not a clean oracle here either: its `matches` reads `d.name`/`d.skill` off the raw row too, so on *that* engine a filter is equally blind to a flipped face. That makes this a rules question the owner should settle once — "which of a card's attributes are the face showing's?" — rather than a parity bug to port.

**Build.**
1. Settle the reading, in writing: which declared attributes come off the face showing (1-9, 10-1-3), and what a Hidden Mode card has (23-5-2 — `facePower` already answers "nothing" for power). Record it as a ruling (`npm run arena:rule`) before any code moves, per `CLAUDE.md`'s own precedent.
2. Say it in the grammar. `attributes.rules`' `back` entry records the gap today ("what is printed on that face is a face of its own, which this grammar has no kind for"); the answer is either a `face:` line on `DEFINE ATTRIBUTE` or a `DEFINE FACE` kind — the first is smaller and probably right.
3. Read it in one place. `attrsNow` already seeds `power`/`originalPower` through `facePower`; widen that one helper rather than adding a branch per attribute, and keep `attrsOf` the catalog half it is.
4. Fix the legacy engine's `matches` in the same commit if the ruling says it is wrong, so the two engines do not answer differently about the same card.

**Acceptance.** `npm run typecheck && npm run lint && npm test && npm run build` clean. A `scripts/verify/vm.ts` case flips the harness Leader (`L-RED`, whose back prints a different name and 15000 power) and asserts every attribute the ruling names reads off the awakened face on both engines; `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40 --engine rules` at 0 crashes. The owner runs `npm run arena:diff -- --all --engine rules`, since an awakened Leader is in most saved games.

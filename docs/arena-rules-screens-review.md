# Rules screens — capability review (19 Oct 2026)

Why this exists: the rule screens grew one issue at a time (#360, #469, #470, #472, #351, the MCP
connector) and now overlap. This review maps what is there, where the concepts collide, and what
the owner actually needs. A consolidation plan follows from it.

The owner's four jobs:

- **A. Text only.** Show me cards whose text the engine does not play at all.
- **B. Incomplete.** Show me cards whose rules are only partly read, or are known to be wrong.
- **C. Review and fix.** Show me what a card's rules do, and let me fix them when a game showed
  they play wrong.
- **D. Play-test.** Start a game where this card is ready to play, watch it, change the rule,
  play it again.

---

## 1. What exists today

Every screen is SL-only (`isSlOnlyPath` plus `requireSlPage`); writes also need `isArenaAdmin()`.

### Screens

| Route | What it is | Size | Job | Verdict |
|---|---|---|---|---|
| `/arena/rules` "Workbench" | A queue of `card_rules` **rows**, one per skill. It has a list, a record pane (`RuleRecord.tsx`, 791 lines) and a probe pane, with scope/state/group/find filters. | page 258 + components ~1.4k | A, B, C | Core. Keep the queue, rework the lenses. |
| `/arena/rules/build/[id]` | Full-screen block builder plus "Try it" boards plus teaching with Claude. | `Blocks.tsx` 1.1k, `RuleBuilder` 236, `TryItPanel` 372, `TeachPanels` 362 | C, D-lite | Core. This is the best piece. |
| `/arena/rules/review` "Review queue" | A phone flow, one skill at a time, over the **same queue** as the Workbench. Its actions are approve, Wrong, ask Claude, approve Claude's explanation, and confirm same wording. | `RuleReview.tsx` 624 | C | Duplicates the Workbench. Fold it in as a mode. |
| `/arena/rules/progress` | A deck-weighted share of confirmed cards, with a sparkline. Each page view writes a snapshot. | 129 | A/B summary | Duplicates the header KPIs with different numbers. Fold it in. |
| `/arena/rules/keywords` | Glossary: what each keyword means and how far the engine supports it. | 193 | reference | Merge into one reference page. |
| `/arena/rules/language` | Grammar reference for the rules language. | 288 | reference | Merge. |
| `/arena/rules/game` "Ruleset" | The parsed DBS `.rules` files. | 82 | reference | Merge. |
| `/arena/rules/all`, `/arena/rules/patterns` | Redirects into the queue (#360). | 9 each | — | Drop. Two links still point at them: `arena/[id]/debug/page.tsx:60` and `PlayPicker.tsx` `seg=open`. |
| `/arena/rules/build/preview`, `/arena/rules/review/preview` | Dev-only fixtures with no database. | 104, 14 | — | Drop together with the screens they preview, or keep one for the new builder. |
| `/arena/review` "Match review" | Flagged **game turns** and the AI's decisions. Not about card rules. | 128 | (D input) | Keep it, but rename it: it collides with `/arena/rules/review`. |
| `/arena/feedback` | `arena_feedback`: bugs, "card" (from a backlog that no longer exists), and "rule" (in-app Wrong). | 221 | B input | Keep for bugs. Rule reports should live on the card. |
| `/arena/testing` (+`runs/[id]`) | QA ledger of deck recipes, scenario checklist and imported run manifests. Runs nothing itself. | 336 | — | Out of scope, but it brings its own "support" vocabulary. |
| `/sets/[code]/review` | AI set analysis. Not about rules. | 144 | — | Out of scope. It only shares the word "review". |
| `/api/mcp` connector | claude.ai review tools: `confirm_rule`, `flag_rule`, `record_ruling`, deck review. | — | C (remote) | Keep. It is a third, separate confirm path, so route it through the same functions. |

The card detail page (`/cards/[id]`) shows **nothing** about rules. No badge shows a card's rule
health anywhere outside the arena.

### How "status" is decided: one question, seven answers

The schema stores the review state: `card_rules.status` ∈ open | draft | confirmed | corrected,
plus `source`, `unread[]`, `review_flag`, `confirmed_at` and `compiler_diff`. Whether the engine
can actually *run* a skill is computed, never stored. Several functions each compute a version of
"is this card done", and they disagree:

1. `runtimeSupportOfRow` (`rules-store.ts:108`) is the closest thing to a canonical answer: what
   the engine cannot execute.
2. `rulesFromRows` (`rules-store.ts:236`) is what games load. It produces `CardScripts.complete`.
3. `assessCard` / `readiness()` (`readiness.ts`) gives seven card states (open … plain) for deck
   readiness.
4. `skillBucket` / `computeProgress` (`rules-progress.ts`) **ignores runtime support**. Here
   "confirmed" can mean a row the engine cannot run.
5. MCP `confirmBlocker` (`rules-review/deck-review.ts:90`).
6. `readsAsNothingSilently` (`compile/silent.ts`) finds rows that look complete but are blank.
7. `scripts/arena-gaps.mts` has its own cost check against the **old** CostRecord shape, so it
   can disagree with (1).

Labels for the same states differ by screen:

- The Workbench says Unread / To review / Approved / Corrected.
- The review queue says "Open · plays as blank", "Claude draft · check it" and so on.
- Progress says Read (draft) / Unread / No rules. Its "unread" means *has unread clauses*; the
  Workbench's "Unread" means *status = open*.
- The header counts drafts as "interpreted".

**"Flagged" is two separate mechanisms that never see each other:**

- `card_rules.review_flag` is written only by MCP `flag_rule`, and only Progress counts it.
- The in-app "Wrong" report is a text prefix inside `card_rules.explanation`, plus an
  `arena_feedback` row. Only the review queue's flagged mode sees it.

**"Text only" no longer happens the way the screens describe.** The Claude referee went with the
legacy engine (#118; `ai/run.ts:5` says so). Today an Auto skill the engine cannot run ends the
game as *interrupted* (`vm/flow.ts:916`), and an Activate skill it cannot resolve is simply not
offered (`vm/activate.ts`). Yet the admin drawer still says *"Claude rules on this card's
remaining text when it resolves"* (`AdminDrawer.tsx:289`), and `arena-coverage.mts` says the rest
"are put to the referee at runtime". For job A, "text only" therefore has to mean one of these:

- the rule is open (plays as blank);
- the rule row is missing or stale;
- the rule reads as nothing without saying so (silent blank).

### Fixing a rule: four editors, two test tools

You can edit a rule in three places: inline in `RuleRecord` (text and blocks), in the full
builder, and through Claude in the review queue (`askClaudeAction`, `requestExplanationAction`),
which is a different Claude path from the Workbench's `explainRuleAction`. A fourth place is the
terminal (`arena:rule`).

You can test a rule two ways:

- **ProbePane** runs the *saved* rule. The builder still labels it "on the legacy engine (#161)",
  which is wrong; the probe runs on the rules engine.
- **Try it** runs the *unsaved* rule on every board its trigger and condition need, re-runs as you
  edit, and saves your ✓/✗ as `expectations`, which `arena:reprobe` then enforces.

Try it makes ProbePane redundant. The builder's own comment says the probe stays "until `tryIt`
replaces the probe".

### Play-testing (job D): about 70% built, not connected

What exists:

- `probe()` (`probe.ts:921`) stages a synthetic board with the card in hand or on the field, but
  only the result text leaves it. The board is private.
- Try it already passes the *unsaved* rule into the engine (`tryit.ts` `probeRuleOf`), so a rule
  override is a solved problem.
- `TrainingSession` (`tutorial/session.ts`, about 100 lines) is an in-memory `ArenaSession` that
  plays on the real `ArenaStage` with a scripted opponent. Its state is hard-coded, but it can be
  generalised.
- The engine is pure and already runs in the browser (local worker, tutorial).

What is missing:

- No route starts a *playable* game from a staged position.
- Server games pin their rules at start (`rulesBundleHash`) and refuse decks with open rules
  (`assertDecksPlayable`), so they are the wrong vehicle.
- There is no "play this board" button and no "replay my moves with the edited rule".

The cheapest route uses no server game at all: an in-browser sandbox session that is seeded by the
probe's staging and the builder's current draft rule.

---

## 2. What we could drop

**Screens and routes**

- `/arena/rules/all` and `/arena/rules/patterns`. Fix the two stale links first.
- `/arena/rules/review` as a separate screen. Its one-at-a-time flow becomes "Next" on the card
  screen.
- `/arena/rules/progress` as a tab. It becomes the summary strip above the queue, built on the
  same classifier.
- `/arena/rules/keywords`, `/language` and `/game` as three tabs. They become one *Reference* page
  with three sections.
- `ProbePane` and `probeRuleAction` / `probeAllAction` in the UI. `arena:probe` and
  `arena:reprobe` stay for scripts.
- The dev fixture pages for screens that disappear.

**Concepts**

- The referee residue: the `AdminDrawer` copy, `ctx.referee` in `games.ts`, the referee prompt in
  `ai/opponent.ts`, `RefereeRequest`/`refereeRuling`, and the `referee` flag in `vm/view.ts`.
  Check the client contract (`policy/contract.ts`, snapshot) before removing types. Fixing the copy
  is the urgent part.
- `StoredProbe.engine: "legacy"`.
- The prefix-in-`explanation` flag. Keep one flag, the `review_flag` column, and migrate the
  existing Wrong flags into it.
- The `arena_feedback` "card" kind, whose backlog page is gone.
- Bulk-confirm batches and rule-explanation proposals stored as `arena_feedback` rows. That is
  acceptable for now, but it is why feedback has a filter that excludes `rule-proposal`.

**Scripts**

- `arena-migrate-scripts.mts`, a one-off carry-over from `card_scripts`.
- The dated or one-issue refreshes not in `package.json`:
  - `arena-refresh-2026-10-17.mts`
  - `arena-refresh-pre951.mts`
  - `arena-refresh-unread.mts`
  - `arena-reviewed-refresh.mts`
  - `arena-deck-rule-refresh.mts`
  - `arena-movement-rule-refresh.mts`
  - the `*-558/569/783` audits

  Check that no receipt doc still tells someone to run them. Everything else goes through
  `arena:refresh-ids`.
- `arena:gaps`: replace its private cost check with `runtimeSupportOfRow`.
- `arena:coverage`: fix the referee wording. It also overlaps with `arena:tally`.

**Bug found on the way:** `saveRule` keeps `confirmed_at` when it writes a non-confirmed status,
and `skillBucket` treats `confirmed_at` as confirmed. A confirmed rule that is edited back to draft
therefore still counts as confirmed on Progress.

---

## 3. Target: four screens on one classifier

**One classifier first.** `ruleHealth(row)` in `rules-store.ts` returns `text-only | incomplete |
done` per skill, built on `runtimeSupportOfRow`:

| Health | Skill rule | Owner's words |
|---|---|---|
| `text-only` | status `open`, row missing/stale, or silent blank | "The engine does nothing with this text." |
| `incomplete` | any `unsupported`/`unknown`, `review_flag`, `compiler_diff`, or an unconfirmed draft | "Partly read, or not checked yet." |
| `done` | confirmed/corrected, runtime-supported, not flagged | "Plays as written." |

A card takes its worst skill. The queue, the summary strip, the arena header, deck readiness and
the MCP deck review all read this one function. Unconfirmed drafts arguably form a fourth bucket,
"read, not checked"; see the open questions.

**The screens:**

1. **Rules** at `/arena/rules`: the queue, listing **cards** rather than skill rows.
   - Three tabs that match jobs A and B: *Text only* · *Incomplete* · *Done*.
   - Scope chips: my decks / one deck / catalog / last game. Find, plus group by wording.
   - A one-line summary strip replaces Progress: X of Y deck cards done, with a trend.
   - Bulk "approve same wording" stays here.
2. **Card rules** at `/arena/rules/card/[cardId]`: everything about one card (job C).
   - Printed text and the engine's reading, per skill, side by side.
   - The health of each skill, with the reason in plain words.
   - Approve, Flag wrong (one flag), Ask Claude (one Claude path), and Edit, which opens the
     builder in place.
   - The Try it boards live here, under the rule.
   - History, `compiler_diff` (take theirs or keep mine) and the specified cost.
   - *Next* / *Previous* walk the queue you came from, which replaces the guided review on phones.
3. **Play-test** at `/arena/rules/card/[cardId]/play?board=…` (job D).
   - An in-browser sandbox seeded by the probe's staging, with the card in hand or on the field.
   - The opponent is passive or hot-seat.
   - It always uses the builder's **current, unsaved** rule.
   - *Reset with my edit* and *Replay my moves with my edit*, which stops at the first move that
     is no longer legal.
   - *This played right / wrong* becomes a Try it expectation, so `arena:reprobe` holds it.
   - Nothing is persisted and no server game is used.
4. **Reference** at `/arena/rules/reference`: keywords, language and ruleset as one page with
   anchors.

Outside the rules area:

- A small health badge on `/cards/[id]` and in the deck view, linking to *Card rules*.
- `/arena/review` is renamed to "Match review" in copy, so "review" stops meaning three things. A
  "Wrong" on a turn there links straight to the card's rules.

### What the real data changed (design pass, 19 Oct 2026)

I ran a read-only pull of the owner's 22 decks (306 cards with skills) and of the catalog (6,281
cards) through `runtimeSupportOfRow`, to feed the mockups. Four classifier rules came out of it:

- **The payment rebuild is its own step, not a health.**
  - All 306 deck cards (613 skill rows) and 6,276 catalog cards fail with "missing or unsupported
    typed skill payment v1": their records predate #1066, so the engine refuses them today.
  - Counted as a health, it would make every card *Incomplete*. So `ruleHealth` reports
    `needsRebuild` beside the health, and the queue leads with one "Rebuild" action.
  - 61 of those rows (53 cards) are approved or corrected, and no script may rewrite them. They need
    the new record and then a re-approval.
- **"Depends on board" (any `play` op) is a hint, not a gap.** As a gap it would move 67 deck cards
  into *Incomplete*. It shows as "try it in play" under *Read, not checked* instead.
- **Keyword lines and deck-building restrictions are done, not silent.** `[Triple Strike]`,
  `[Evolve]` and "You can't include … in your deck" read as no ops on purpose. The real
  `readsAsNothingSilently` already exempts them; the classifier must call it rather than copy it.
- **Counts after the rebuild, for the owner's decks:** Text only 0 · Incomplete 94 · Read, not
  checked 181 · Done 31. Incomplete splits into:
  - marked Wrong: 47
  - combo qualification missing (#907): 29
  - compiler reads it differently: 9
  - Fusion material record: 7
  - flagged in claude.ai review: 6

  For the catalog: Text only 1,406 · Incomplete 974 · Read, not checked 3,821 · Done 80.

Other findings:

- The rules language prints a combo qualification as an escaped JSON string (`COMBO "{\"turn\":…}"`).
  The builder should show it as readable "only when" chips.
- A Wrong flag can outlive the rule it was about. BT6-010's 4 Oct flag predates today's v6
  (#1070), so the card screen asks "the rule changed since your flag — does it play right now?"

### Owner decisions (19 Oct 2026)

1. An unchecked compiler draft gets **its own tab**, so there are four tabs: *Text only* ·
   *Incomplete* · *Read, not checked* · *Done*. The classifier returns `unchecked` for a clean,
   unapproved draft, and *Incomplete* keeps only real gaps and flags.
2. The queue defaults to **my decks**: your own decks, without testing decks, as on Progress.
3. In the play-test sandbox, the **local AI policy** plays the opponent (`policy/boundary.ts`
   `localStep` over a `PinnedMatch`).

## Delivered (19 Oct 2026)

Merged to `main`:

- #1075 Rules PR 1: `ruleHealth` classifier, one flag, honest copy.
- #1079 Rules PR 1b: out-of-date typed records count as needs-rebuild.
- #1072 Rules PR 4: one Reference page (`/arena/rules/reference`, #keywords #language #ruleset).
- #1077 Rules PR 2: the Rules queue by card (`/arena/rules`, tabs Text only / Incomplete / Read, not checked / Done).
- #1078 Rules PR 3: the Card rules page (`/arena/rules/card/[cardId]`).
- #1074 Rules PR 5: the play-test sandbox against the local AI (`/arena/rules/card/[cardId]/play`).
- Rules PR 6a (docs and obsolete scripts) follows this section.

Old routes redirect (`/all`, `/patterns`, `/progress`, `/keywords`, `/language`, `/game`, `/build/[id]`, `/review`); the components `Workbench.tsx`, `RuleRecord.tsx`, `RuleReview.tsx`, `ProbePane.tsx` and `RuleExplanationPreview.tsx` are removed.

Still open:

- A stored health column, if `/arena/rules?scope=catalog` stays slow: it costs about 8.7 s per 5-minute cache refill.
- Approved or corrected rows whose typed records are out of date need a re-approval path.
- The rules language prints combo qualifications as escaped JSON; the builder should show readable chips.
- `main` has pre-existing red checks from #1071: verify-rules, verify-arena (35/162), tryit, arena-tutorial-session and rule-explanation-contract.

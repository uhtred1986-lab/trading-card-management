# Arena rules engine — hand-off spec for the next stage

Written 5 Sep 2026 on branch `feature/arena-counter-chains` and carried on in
`feature/arena-compiler-next`, which branches off it. The owner asked for both
to be merged on 6 Sep 2026 and PR #22 was opened against `main`; check whether
it landed before assuming which branch to work on. This is a self-contained brief for whoever picks the work
up next, written so that it can be followed step by step without re-deriving
the design. Read it once top to bottom, then work the backlog in order.

Starting a fresh session? `docs/arena-next-session-prompt.md` is a prompt to
paste, which opens with a quality check of the work described here.

Companion documents: `docs/arena-design-proposal.md` (why the engine is built
the way it is), `docs/arena-rules-worklist.md` (history of what was built, with
the lessons), `docs/rules/rulemanual.txt` (the Masters rule manual; every
engine rule cites a section number from it — keep doing that).

---

## 1. Where things stand

Measured on the 6,493 Dragon Ball Super (not Fusion World) cards:

| measure | value | command |
|---|---|---|
| resolvable skills the compiler reads end-to-end | 85.9 % of 11,743 | `npm run arena:coverage` |
| [Permanent] skills the compiler reads | 57.8 % of 1,807 | same |
| …and that actually emit a standing effect | 52.9 % of 1,807 | same |
| skills in the owner's 13 decks that compile | 92.2 % of 397 | same (deck tables) |
| skills exactly one unreadable clause away | 1,191 | `npm run arena:gaps` |
| [Auto] skills that compile but no trigger fires | 655 | `npm run arena:gaps` (§5.3) |
| [Activate]/[Counter] whose price the engine cannot read | 66 | same |
| fuzzer | 40 games, 0 crashes | `npm run arena:fuzz 40` |

Every row above can be narrowed to the cards in the owner's own decks with
`npm run arena:gaps -- --decks`, which is where a structural bug shows up that
the catalog-wide ranking buries.

The orphan-trigger figure goes **up** when the compiler improves, and that is
not a regression: a skill only reaches that bucket once its effect compiles, so
teaching the compiler a phrase moves skills out of "unreadable" and into "reads
fine, never fires". Read the three lines together, never one alone.

Numbers as of 6 Sep 2026, after the commits described at the end of
`docs/arena-rules-worklist.md`. Where they touch the backlog below, the item
says what is left.

Every keyword in §22 of the rule manual now has an engine rule (Blocker,
Critical, Double/Triple Strike, Dual Attack, Barrier, Deflect, Indestructible,
Unique, Revenge, Bond, Sparking, Evolve, Union, Over Realm, Swap, Overlord,
Z-Stack, Z-Awaken, Field, Awaken, Wish, Offering, Attack, Burst, Spirit Boost,
Arrival, Empower, Successor, Aegis, Revive, Rejuvenate, Alliance, Invoker,
Heroic, Villainous, Servant, Limit, Once per turn, Energy-Exhaust). None of
them goes through the text compiler or the referee.

What is left is **text**: the effect sentences. 3,340 clauses on 2,037 cards
need only a phrase pattern (no new mechanism); the rest need one of the
mechanisms in §6.

---

## 2. Ground rules (do not skip)

1. **Card text is read, never interpreted.** If a clause cannot be read, the
   whole skill goes to the referee at runtime (or does nothing, with a note,
   when no referee is configured). Never let a half-read skill run — a wrong
   effect is worse than a missing one. `compileSkill` returns
   `{ ops, unsupported }`; any `unsupported` entry disables the program.
2. **Cite the manual.** Every engine rule and every test message names the
   section (`22-32-3`, `9-1-5`). Search `docs/rules/rulemanual.txt` with
   `grep -n "^22-32\|^  22-32-"` before implementing a keyword or a phase rule.

   **When a wording is genuinely ambiguous, look it up before asking the
   owner.** In order: the manual, then Bandai's own Q&A pages
   (`dbs-cardgame.com/us-en/rule/card_faq.php` and `game_faq.php`), then
   community forum entries. The one question parked for him on 5 Sep 2026 —
   "does a card see its own arrival?" — was answered by 9-6-9-4 with 9-6-9-1-3,
   in the manual already in this repo. Say plainly when the sources do *not*
   settle it: a reading of the manual is not a printed ruling, and that
   difference belongs in the note beside the rule.
3. **A failed clause fails the clauses after it.** The compiler tracks what
   "it" refers to (`Ctx.lastTarget`, `Ctx.last`); fix the *first* failing
   clause in a skill before the later ones.
4. **A target with a number in it is a choice.** `resolveSelector` returns
   *every* card a selector matches; `withChoice` in `compile.ts` puts a
   `choose` op in front of moves/KO/hide/redirect whose target carries a count.
   Use it for any new action pattern that takes a target phrase.
5. **A filter phrase the parser does not know widens the selection silently.**
   `parseFilter` ignores words it does not recognise, so "your opponent's
   Battle Cards with the same name as this card" would select all of them.
   When adding a target wording, check `parseFilter` reads every measure in it
   (cost, power, relative power `powerRel`, colours and `notColors`, characters
   and `notCharacters`, traits and `notTraits`, names and `notNames`,
   mono-colour, multi-colour, card type and `notType`, Z), and `parseTarget`
   its `side` and `notSelf`. If it cannot, make the clause fail rather than
   pass. The same trap in reverse: a phrase the parser reads *wrongly* compiles
   cleanly and is never reported, so check what a new pattern's neighbours
   already do before adding it — five of the fixes on 5 Sep 2026 and six more
   on 6 Sep were of that kind, and are listed in the worklist.

   **The negative half of a measure is the easy one to miss, and it fails
   worst.** "Non-black", "non-<Commander Red>", "other than <Grand Supreme
   Kai>", "other than this card": each one *inverts* the filter when it goes
   unread, rather than merely widening it, so the skill acts on precisely the
   cards the text rules out. Whenever you add a positive measure, ask what the
   sets write for its opposite.

   Two positive measures are still unread and are known widenings: a required
   keyword ("up to 1 opponent Battle Card **with [Blocker]**" chooses any), and
   a **plural** type word ("Battle **Cards**" sets no `type`, because the word
   is matched with a trailing `\b`).
6. **Never write a regex through a shell heredoc, `node -e`, or a `sed`
   template.** The backslashes are eaten before the file is written: `\b`
   becomes a literal backspace, `\[` becomes `[`, and the result either fails
   to parse or — worse — silently matches something else. This applies to
   **probe scripts as well as engine source**, which is the trap: a probe is
   throwaway, so it feels safe to paste, and then it reports a clean run
   because its pattern never matched anything. Write every file containing a
   regex with the editor. Probe scripts are fine (§5.4) but must be deleted
   before committing.

   **The same escape bites the *replacement*, which is the half nobody
   expects.** `String.prototype.replace` scans a replacement **string** for
   `$` patterns: `` $` `` inserts everything before the match, `$&` the match
   itself. Inserting a section into `arena-rules-worklist.md` on 6 Sep 2026
   duplicated 1,457 lines of it, because the prose being inserted mentioned the
   `$` anchor next to a backtick. Pass a replacement **function** — `() => text`
   — whenever the text is not a literal in front of you; a function is never
   scanned.
7. **Before every commit:** `npm run typecheck`, `npm run lint`, `npm test`
   (includes `scripts/verify-arena.ts`), `npm run build`, `npm run arena:fuzz 40`
   (must report `0 crashes`). Commit on the feature branch, push, do not merge.

   Two ways that gate lies to you, both hit on 6 Sep 2026. **Read the exit
   code, not the output** — `npm run build | tail` reports `tail`'s status, so
   a failed build looks like a passing one; run each check on its own line and
   echo `$?`. And **a worktree needs its own `npm ci`**: `tsx`, `tsc` and
   `eslint` resolve up the directory tree to the main checkout's
   `node_modules` and appear to work, but `next build` looks for
   `next/package.json` beside the project and fails with "Could not find the
   Next.js package". A junction does not work; run the install.
8. Do not spend tokens on Fusion World cards: every measurement filters
   `cards.game === "dbs"`.

---

## 3. Map of the code

All under `src/lib/arena/engine/` unless stated.

| file | what lives there |
|---|---|
| `cards.ts` | `skillLines` (HTML/`[br]`/bullets → lines), `parseSkills` (tags, keyword, cost/effect split via `splitCost`/`isOnlyOrbs`), `keywordOf` (tag → `KeywordSkill`), `orbsIn` (`{r}{g}{2}` and `{r}/{u}`), `baseType` |
| `filters.ts` | `CardFilter`, `parseFilter` (words → filter), `matches`, `powerRelOk`, `SimpleCondition`/`parseCondition` (engine-side Awaken/Wish conditions only) |
| `script.ts` | the effect language: `Op` union, `Selector`, `Ref`, `Amount`, `Cond`, `ScriptFrame`; the interpreter `stepScript`; `OP_NAMES`, `validateProgram` |
| `compile.ts` | text → program: `compileSkill` → `splitClauses` → `compileClauseList` (connectives, conditions, delays, replacement marker) → `compileClause` (one pattern per wording); `parseTarget` (phrase → `Selector`), `refFor` ("it", "the chosen card", "this card"…), `parseConditionClause`, `withChoice`, `durationOf`, `describeScript`/`describeCond`/`describeSelector` (the card inspector's text); `compileCard` + `KEYWORD_HANDLES_THE_LINE` |
| `state.ts` | `GameState` helpers: `move`, `setMode`, `powerOf`, `cardNow`, `resolveSelector`/`resolveRef`, `amount`, `condHolds`, `skillsOfInstance`, `skillsNegated`/`skillNegated`, `keywordsInForce`, `staticEffects`/`collectStatics` ([Permanent] layer), `altCostFor`/`payAltCost`, `forbids`, delayed effects, `placeUnder`, replacements |
| `triggers.ts` | `Trigger` wordings (`autoTriggerMatches`), keyword triggers, `pendTriggers`, `koCard`, `masterOf` |
| `engine.ts` | `apply` (the only mutator), `legalActions`, the flow steps, `activatable`/`activate` (what can be declared and how it is paid), `resolveAuto`/`resolveKeywordOrText` (how a pending skill resolves), `chooseApply` (continuations after a `chooseCards` prompt), battle steps, keyword rules |
| `types.ts` | `GameState`, `Prompt`, `Action`, `FlowStep`, `Trigger`, `ContinuousEffect`, `Skill`, `KeywordSkill` |
| `../ai/opponent.ts` | `EFFECT_LANGUAGE` — the spec the referee (Claude) is given. **Every new op, Amount or Cond must be described there** or the referee can never use it |
| `scripts/verify-arena.ts` | the test file (plain `assert`); see §4 |
| `scripts/arena-coverage.mts`, `arena-gaps.mts`, `arena-fuzz.mts`, `arena-feedback.mts` | measurement and the fuzzer |

### How a skill becomes actions

```
card text ──skillLines──▶ lines ──parseSkills──▶ Skill{kind, keyword, cost, effect, tags}
                                                     │
        keyword with an engine rule ─────────────────┤──▶ engine.ts (activatable / resolveKeywordOrText)
                                                     │
        text ──compileSkill──▶ { ops: Op[], unsupported: string[] }
                                   │  cached per CardDef (compileCard)
                                   ▼
   [Permanent] ops ──▶ collectStatics (state.ts) ──▶ power/keyword/cost/forbid statics
   other ops ──▶ stepScript (script.ts) when the skill resolves:
                 activatable() offered it (Activate) / pendTriggers()+resolveAuto() (Auto) / counter window (Counter)
```

`activatable` only offers a text skill when `costIsReadable` (orbs, marker
cost, or a readable condition) **and** `canResolve` (compiled with no
`unsupported`, or a referee is configured). So a wording you add starts being
*played* the moment it compiles; the fuzzer will exercise it.

### Checklists

**New op** (e.g. `hidden`, `comboFrom`, `flip` were added this way):
1. `script.ts`: add to the `Op` union with a doc comment citing the rule.
2. `script.ts` `stepScript`: a `case` that does it (use `move`, `setMode`,
   `addEffect`, `koCard`, `pendTriggers`; resolve targets with `resolveRef`).
3. `script.ts` `OP_NAMES`: add the name (`validateProgram` uses it).
4. `../ai/opponent.ts` `EFFECT_LANGUAGE`: one line with the JSON shape.
5. `compile.ts` `describeScript`: a `case` (the inspector drops unknown ops).
6. `compile.ts` `compileClause`: the wording → op; wrap targets with
   `withChoice` when a count is involved.
7. `scripts/verify-arena.ts`: a compile assertion **and** an engine assertion.

**New condition**: `Cond` union (`script.ts`) → `condHolds` (`state.ts`) →
`parseConditionClause` (`compile.ts`) → `describeCond` (`compile.ts`) → test.
Conditions with no ctx (var names) get the var filled in at the call sites in
`compileClauseList`.

**New trigger**: `Trigger` union (`types.ts`) → `autoTriggerMatches`
(`triggers.ts`) → a `pendTriggers(ctx, s, "<name>", card)` call at the place
in `engine.ts`/`triggers.ts` where the event happens → test that the skill
fires exactly once and at that moment (see the `kos` test for the shape).

**New keyword rule**: a `case` in `activatable` (when it may be declared and
its label), a branch in `activate` (how it is paid; continuations via
`s.flow.unshift({op:"prompt"…},{op:"choose.apply", what})`), a `case` in
`chooseApply` for the answer, and/or a `case` in `resolveKeywordOrText` for
[Auto] keywords. Add the `what` to the `choose.apply` union in `types.ts`.

---

## 4. Testing conventions

`scripts/verify-arena.ts` is one long file of `{ … }` blocks run by `tsx`; a
failed `assert` aborts the run with a stack trace (`grep -o "verify-arena.ts:[0-9]*"`
gives the line). Helpers:

- `arena({ hand, energy, battle, oppHand, oppBattle, oppEnergy, z })` — a game
  in **p1's Main Phase on turn 3**, leader `L-RED` (red, has an [Awaken] back)
  vs `L-BLUE`. Cards named in `hand`/`battle`/… are conjured from deck cards.
  Gotcha: p1's starting hand of `V1`s stays if `"V1"` is in `hand`, otherwise
  it goes to the deck bottom — count hand sizes relative to a snapshot.
  Energy colour matters for payment: give `V1` (red) energy for red costs.
- `play(s, ...actions)` applies actions and asserts each is legal.
- `labels(s)` / `acts(s)` / `canActivate(s, card)` — the menu.
- `find(s, "p1", "hand", "CARDID")` — an instance id.
- `assertConsistent(s)` — every instance in exactly one place.
- Synthetic cards: `DEFS.NAME = { ...DEFS.V1, id: "NAME", name: "NAME", skill: "…" }`.
  `V1` is a red 10000/1-cost Battle Card; `V-BLUE` its blue twin; `BIG` 25000;
  `BLOCKER`; `E-DRAW` an Extra "[Activate: Main] Draw 2 cards"; `E-NEGATE` a
  "[Counter: Attack] Negate the attack" Extra; `U1` a Unison.
- To reach the opponent's turn: `play(s, {type:"endMain",player:"p1"}, {type:"charge",player:"p2",card:null})`.
- The counter window opens right after `attack` (before any `pass`).
- Every test names the rule it checks in the assertion message.

Also useful: `npm run arena:playthrough` (a whole game through the database),
`/arena/[id]/debug` (every decision, prompt and program of a real game),
`/arena/backlog` (unreadable clauses grouped by shape, with the "explain a
card" loop that stores a program per card and a work item per wording).

---

## 5. Measuring and choosing what to do

### 5.1 Commands

- `npm run arena:coverage` — catalog and per-deck compile rates, then the
  **"in your decks — the working list"** (wordings failing on the owner's
  cards, most common first) and the catalog-wide list. Both need `.env.local`
  (`DATABASE_URL` is production; read-only here).
- `npm run arena:gaps` — (a) each unreadable clause classified by the
  mechanism it would need, with examples; (b) how many skills are 1, 2, 3…
  clauses away; (c) **"the only thing holding a skill back"** ranking — the
  cheapest wins; (d) **"[Auto] skills that compile but no trigger ever
  fires"** — see §5.3, and read it before trusting the coverage figure.
  Redirect to a file: it is long.
- `npm run arena:fuzz 40` — random legal play across the owner's decks; the
  tail lists the commonest "skill was not applied" notes, which are also a
  work list.
- `npm run arena:feedback` — bug/card/rule reports the owner filed in the app.

### 5.2 The loop

1. Take the top wording of the "only thing holding" list or the deck list.
2. Fetch 3–5 real cards that print it (probe below) and read them whole —
   the normalised shape hides which preposition and which subject the set used.
3. Decide: phrase pattern (no new mechanism) or one of §6.
4. Write the pattern generally; add a compile assertion with a real sentence
   and, for anything that changes game state, an engine assertion.
5. `typecheck`, `lint`, `npm test`, `fuzz 40`, `coverage` (note the numbers in
   the commit message), commit, push.

### 5.3 Compiling is not happening — read this before trusting a percentage

**A skill that compiles may still never happen, and `arena:coverage` cannot
tell on its own.** The compiler knows nothing about when a skill runs, whether
its price can be charged, or whether the static layer has a kind for what it
says. All three kinds of skill have a class of silent failure behind the
percentage, and the last three sections of `arena:gaps` count them:

1. An **[Auto]** skill runs only if some `Trigger` in `types.ts` matches the
   moment it names *and* something calls `pendTriggers` there. **1,081 skills
   had neither** — about a tenth of the whole catalog.
2. An **[Activate] or [Counter]** skill is only offered when `activatable` can
   read the price before the colon, because a price the engine cannot charge
   must not be waived. **1,626 skills whose effects compiled were never
   offered** — more than the first class. Now 159: a price may be an *action*
   as well as orbs or a condition (`compileCostProgram`), and `activatable`
   only offers it when `canPayCostProgram` says the board can be charged.

3. A **[Permanent]** skill is never resolved at all: `collectStatics` reads its
   program and emits standing effects from the ops it knows, and a program made
   of anything else does nothing. **141 of the 976 that compile emit nothing**,
   and the coverage line used to call all 976 "applied by the static layer".

The first was found by an engine test rather than by any measurement — it
failed because "when your opponent plays a Battle Card" had no trigger,
`played` matching only "this card". So write the engine assertion, not only the
compile one; it is the only thing that catches this class.

**Each of the three now has one exported reader, used by the engine and by the
measurement, so they cannot drift apart:** the `TRIGGERS` list at the top of
`arena-gaps.mts` beside `autoTriggerMatches`; `costText`/`costIsOnlyOrbs`/
`compileCostProgram` in `compile.ts`, shared by `activatable`, `compileSkill`
and the report; and `emitsStatic` in `state.ts`, beside the switch it
describes. When those disagree, a skill is offered whose condition is never
checked — the worst outcome available, because the effect happens anyway.

Each orphan trigger is engine work rather than a pattern, and always the same
three steps:

1. a value in the `Trigger` union (`types.ts`);
2. a line in `autoTriggerMatches` (`triggers.ts`) — and check the *neighbouring*
   cases, because "…or KO'd" belonged to `koed` all along;
3. a `pendTriggers` call where the event actually happens, plus its name in the
   `TRIGGERS` list at the top of `scripts/arena-gaps.mts` so it stops being
   counted as missing.

Watch two things. A trigger about a card *leaving* fires once it has gone, so
`pendTriggers` must be told not to refuse it for being out of a valid area
(9-1-3-1) — that is the `onLeaving` list. And a trigger about what the
*opponent* did is pended on every card the other player has in play, with the
card that did it as the `subject`, which is what "that card" and "it" then
point at.

### 5.3b Probes that compare a program with its own text

The measures in §5.3 find skills that do *nothing*. A skill that does the
**wrong** thing appears in no report at all, and the way to find those is to
compare the compiled program against the clause it came from. A `choose` op
carries its clause verbatim in `reason`, which makes that a ten-line script.

Three that paid off on 5 Sep 2026 — 66, 1 and 27 hits, all now near zero:

- the selector resolves to `special: "self"` while its `reason` names some
  other card (`<…>`, `≪…≫`, `{…}`);
- the `reason` says "your opponent's" and the selector's side is `you`;
- the `reason` says "up to 1" and the selector's count is 99.

Others worth writing when you touch that area: an area named in the text that
the selector does not have; a `moveTo` whose destination the clause does not
mention; a `power` whose sign is the opposite of the printed one.

Four more paid off on 6 Sep 2026, and the shape of them is worth copying —
each asks *whether the clause said the opposite of what the program does*,
which is a stronger question than "did it read every measure":

- a selector whose `side` is `you` while the reason names the opponent **in
  any form the sets print it**: "your opponent's", "an opponent's", and the
  bare "opponent Battle Card" the BT1–BT3 sets use. Sixteen skills KO'd,
  rested or returned *your own* card.
- a target that resolves to `special: "self"` out of a clause that says
  "**other than** this card" or only "this card'**s** power" — the phrase has
  to *mention* this card either way, so testing for the words is not enough.
- a `filter` whose `characters`/`names` came out of an "other than <X>"
  phrase, which means the target must **not** be that card. 36 cards, and the
  filter was inverted rather than merely widened.
- a `filter` colour that does not survive blanking every `<…>`, `≪…≫`, `{…}`
  and `[…]` span out of the clause first: ≪Red Ribbon Army≫, <Goku Black>,
  <Commander Red> and [Revive Blue/Green] all carry a colour word that says
  nothing about the card.

And one technique rather than a probe: **to check a guard, run the compiler
against a copy of itself with that guard forced to `false` and read the
difference.** That is how the three list guards (`inList`, `andEndsAList`,
`andJoinsTwoAreas`) were proved — 119 clauses, every one a genuine list, none
of them two instructions merged. It takes a `cp` and a three-line patch
script, and it answers a question no assertion can.

**Look hardest at a fix that changed which *direction* a mis-read fails in.**
Reading colour lists as "either" instead of "all" was right, and it turned 25
filters that had silently matched nothing into filters that silently matched
too much — a missing effect became a wrong one. The bug was underneath the
whole time; the fix is what made it reachable.

**Then run `npm run arena:fuzz`, even for pure compiler work.** Making a
wording compile can make an engine path reachable for the first time: the
under-a-card fix above reached `detach`, which had never been asked to take a
card out of a pile, and seven games in sixty ended with a card in two places.

### 5.4 Probe scripts

A throwaway `scripts/tmp-x.mts` run with `npx tsx --env-file=.env.local scripts/tmp-x.mts`.
Keep regexes out of them (heredoc + template escapes mangle backslashes) —
use `String.includes`. Delete before committing.

```ts
// Card texts by id
import { inArray } from "drizzle-orm";
import { db } from "../src/db";
import { cards } from "../src/db/schema";
import { cardDefFrom } from "../src/lib/arena/load";
const rows = await db.select().from(cards).where(inArray(cards.id, process.argv.slice(2)));
for (const r of rows) { const d = cardDefFrom(r); console.log(d.id, (d.skill ?? "").replace(/\s+/g, " ")); }
process.exit(0);
```

```ts
// How a sentence parses and compiles today (no database needed)
import { parseSkills } from "../src/lib/arena/engine/cards";
import { compileSkill } from "../src/lib/arena/engine/compile";
const sk = parseSkills("[Auto] When you play this card, draw 1 card.")[0];
console.log(sk.kind, sk.cost, "|", sk.effect);
console.log(JSON.stringify(compileSkill(sk)));
```

For the unread "If …:" costs, loop `parseSkills` over the catalog, keep skills
whose `cost` starts with if/when/while/during and `parseConditionClause(cost)`
is null, and count normalised shapes (numbers → N, `<…>` → `<X>`).

---

## 6. Backlog, in order

Each item says what the cards print, what the reading should be, which
functions to touch, and how to prove it. Numbers are cards/clauses from
`arena:gaps` on 5 Sep 2026.

### 6.1 Phrasing tail — 1,469 skills one clause away (start here, cheap)

The top of the ranking is flat now (≤ 6 skills per wording); work it down
from `arena:gaps`. Wordings already identified, with the intended reading:

| wording (example card) | reading |
|---|---|
| "place the rest at the bottom of your deck in any order" (TB3-001, 16 catalog-wide) | after a `look … as looked` and a choice `cN`: `moveTo` deck bottom for `looked` minus `cN`. Needs `Ref = { var; minus?: string }` — add `minus` to `Ref` in `script.ts`, subtract in `resolveRef` (`state.ts`), fill both names in `compile.ts` (the look var is `looked`, the choice var is `c.last`). "put them back on top in any order" is already a skip (`connective`). |
| "add cards from your life to your hand until you have 6 life left" (BT21-001, BT27-001 prints "add card … to you hand") | op `lifeDownTo` already exists; the pattern misses the singular/typo forms. Widen the regex; test both sentences. |
| "if the Battle Card being played has an energy cost of 7 or less" (BT23-118, 44 catalog-wide, [Counter: Play]) | the card being played is `s.resolving.card`. Add `Selector.special: "resolving"` (resolve to `s.resolving?.card`), and a condition `{kind:"count", sel:{special:"resolving", filter}}`. Pattern in `parseConditionClause`: `^the battle card being played (?:has|is) (.+)$` → `parseFilter`. |
| "The Battle Card being played is played in Rest Mode" (BT10-105) | a play modifier on the resolving play: set `s.continuations.playRest = s.resolving.card` (the engine already honours `playRest` in `resolvePlay`). New op `{op:"resolvingPlayMode", mode:"rest"}` or reuse via a small op; keep it explicit. |
| "your opponent reveals their hand" (19) | information only in a hot-seat game: op `reveal` (see 6.9) or a skip with a note. Prefer a real `reveal` op so the AI view can use it later. |
| "reduce the skill cost by …" (26), "reduce the energy cost of this card in your hand by N for each …" (16) | see 6.6 |
| "otherwise" (18), "if they don't" (29) | `connective`: "if they don't" is the opponent's `ifNotDone` — needs the previous op to be an opponent decision (`discard` by choice). Spec: treat "if they don't/otherwise" after an *optional* opponent action as `not(chose)` only when the previous op was a `choose` with `side: "opponent"`; else fail. |
| "if it's a black … card you may add it to your hand" (16) | after `reveal`/`look` of one card: `varMatches` condition (6.9) + `moveTo hand`. |
| "it gets +N power for the turn" (14) / "it gains [blocker] for the turn" | "it" has no antecedent in these skills — find out what the previous clause was on 3 real cards before changing `refFor`. |
| "your opponent chooses N of their battle cards" (13) | `choose` with `side:"opponent"` chooser — `choose` op currently asks the master. Add `chooser?: Side` to the `choose` op; the prompt goes to that player. |
| "the chosen card will not switch to Active Mode during your next Charge Phase" (BT21-108) | a rest-lock on **your own** card that must survive *your* next Charge Phase. Existing `nextTurn` durations expire at the start of your next turn, i.e. before the Charge Phase. Add `Duration "afterNextCharge"`: expires at the master's next `mainStart`. Then `forbid switchToActive` with that duration. Check where `until` durations expire (`expireEffects` in `state.ts`, called from the flow in `engine.ts`). |
| "Unisons" (BT26-013), "<Piccolo>"-style fragments, "30000 power", "you", "this card" | fragments left by `splitClauses`. Read the card; fix the split (see `NAME_AFTER_AND`, `inNameList`), not the fragment. |
| "Evolve this card into it" / "evolve it into this card" | the [Evolve] keyword invoked by an effect: engine path `activate` for Evolve exists; needs an op `evolveInto {target}` that runs the same continuation. Lower priority. |
| "when you activate this card's [Counter]" (5 in decks) | the skill fires when its own counter is used; trigger `counterUsed` pended in the `counter` action handler for `action.card`. |
| "if you did not draw a card with this skill" (4 in decks) | `did.draw` — set in the `draw` op when ≥1 card was drawn; pattern → `{kind:"not", cond:{kind:"did", what:"draw"}}`. |
| "this card gains +N power and [Critical] during your turn" (3 in decks, SD5-01) | a [Permanent] with a turn condition: `collectStatics` must accept `if` with `isTurnPlayer` around power/keyword statics. Check `collectStatics` first: if it already unwraps `if`, only the "during your turn" phrase is missing. |

### 6.2 Search a secret area — 20-12 · **the named wordings are done**

> Done 5 Sep 2026. All three example sentences compile and are tested. What
> is left on these cards is other clauses, chiefly "in Rest Mode from your
> deck **or Drop**" (a target naming two secret areas) and the [Evolve]
> wordings of §6.1. The paragraph below is kept because it says where the
> pieces live.

Wordings: "add up to 1 yellow <Son Goku> card with an energy cost of 3 and
5000 power from your deck to your hand, then shuffle your deck" (BT22-040),
"play up to 1 green <Mai: Future> card with an energy cost of 1 from your deck,
then shuffle your deck" (BT23-071), "look at cards from the top of your deck up
to the number of cards in your Battle Area" (BT28-021).

Reading: searching the deck is a `choose` in area `deck` (the whole deck; the
chooser sees it, 20-12-1) followed by the move/play, then `shuffle`. The
compiler pieces exist (`choose`, `moveTo`, `play`, `shuffle`); what fails is
`parseTarget` on "from your deck to your hand" (two areas in one phrase) and
`parseFilter` on "with an energy cost of 3 and 5000 power" (two measures
joined by "and"). Do:
1. `parseFilter`: read "an energy cost of N and M power" and "N power and an
   energy cost of M" (both orders).
2. `compile.ts` MOVES/`play` patterns: allow "from your deck" inside the target
   with "to your hand" as the destination (strip the destination first, feed
   the rest to `refFor`).
3. `look` with `n: { count: Selector }` — `Amount` already supports `count`;
   the `look` pattern needs "cards from the top of your deck up to the number
   of <phrase>".
4. Tests: compile each of the three sentences; engine: a deck seeded with one
   matching card → the prompt offers exactly the matching cards; after the
   choice the deck order changed (`shuffle` ran).

### 6.3 Energy manipulation — 3-8 · **the named wordings are done**

> Done 5 Sep 2026. `moveTo.owner` carries "your opponent's energy"; the
> "switch up to 1 of your energy" clause turned out to compile already and to
> be *wrong* (it switched all of it), which `withChoice` fixed. Still open on
> these cards: energy as a **skill cost** (§6.13) and "choose 1 of your energy
> and place it in its owner's Drop" variants with an unusual possessive.

Wordings: "place it in your opponent's energy in Rest Mode" (BT7-042), "switch
up to 1 of your energy to Active Mode" (BT23-071), "choose 1 of your energy
and place it in its owner's Drop", "place the top card of your deck in your
energy in Rest Mode".

Reading: `moveTo` with `to:"energy"` exists but always uses the card's owner;
add `owner?: Side` to the `moveTo` op (default: the card's owner; `"opponent"`
for "your opponent's energy") and honour it in the interpreter (the `owner`
variable at the top of the `moveTo` case). `switchMode` on energy works
already — find out why "switch up to 1 of your energy to Active Mode" arrives
as "up to 1 of your energy to Active Mode" (the verb is lost in a split; look
at `splitClauses` on "Draw 1 card, switch up to 1 of your energy to Active
Mode, and add…"). Tests: energy counts and modes on both sides.

### 6.4 Replacement effects — 9-10 · **the named wordings are done**

> Done 5 Sep 2026. The mechanism was already there; what defeated it was the
> word **"instead"**, which broke the anchor of every move pattern. `by` now
> distinguishes the four printed causes (any / skill / ko / skillOrKo) and a
> replacement can say the mode the card arrives in. Still open: "you may
> choose both instead" (modal), and replacements that need a prompt when two
> apply at once (9-10-2 — the first still wins, and the log says which).

Mechanism exists: `parseWouldLeave` marks the clause, the next clause's move
becomes the replacement (`replaceLeave`, hooked in `move`). Missing wordings:
- "remove it from the game instead" (19) — destination `removed`.
- "add that card to your energy in Rest Mode instead" (BT30-016) — destination
  `energy` with `mode: "rest"`.
- "your blue ≪Earthling≫ card would be removed from a Battle Area by a skill
  or KO'd" (BT30-016) — the replacement covers **other** cards by filter, not
  only "this card". Extend `replaceLeave` with `sel?: Selector` and match it
  in `replacementFor` (`state.ts`); "by a skill or KO'd" limits the cause —
  the `move` reason (`"effect"`/`"ko"`) is already available there.
- "you may choose both instead" (BT18-119) — modal; skip.
Tests: a card that would go to the Drop goes to the Warp/energy instead; a
card not matching the filter still goes to the Drop.

### 6.5 Prohibitions — 20-14 · **the named actions are done**

> Done 5 Sep 2026: `beMovedBySkill`, `beNegated` and `placeEnergy` all exist,
> compile and are enforced, and "will not" reads as a prohibition. Still open:
> "it can't attack for the turn" on the cards where "it" has no antecedent —
> that is a §6.1 pronoun problem, not a prohibition one.

`forbid` exists with `ForbiddenAction` = attack | beAttacked | block | play |
activateSkill | activateCounter | combo | beKOd | beKOdBySkill | beChosen |
switchToActive. Missing:
- "can't be removed from a Battle Area by your opponent's skills" (BT27-044):
  new `beMovedBySkill` — check in the `moveTo`, `ko` (already `beKOdBySkill`)
  and `placeUnder` ops when `frame.master !== owner`.
- "This card's skills can't be negated in any area" (BT11-147): new
  `beNegated` — check in `negateSkills`, `negateKeyword`, `negateOwnSkill`
  and in `skillsNegated`.
- "you can't place cards in your energy for the turn" (EX22-02): new `charge`
  — check in the `charge` action (`engine.ts`) and in `moveTo energy`.
- "it can't attack for the turn" (BT17-124) is *phrasing* — find out why it
  fails on those cards (probably "it" with no antecedent after a failed
  choose).
Each new `ForbiddenAction`: add to the union in `types.ts`, to the `FORBIDDEN`
line in `EFFECT_LANGUAGE`, to `compileProhibition` in `compile.ts`, and check
it at the one place the action happens.

### 6.6 Cost changes — 20-21 · **the named wordings are done**

> Done 5 Sep 2026: the orb-typed amount, the count amount, and the area bug
> that made every "in your hand" reducer apply to cards in play instead.
> Still open: **skill** costs (`orbTotals` in `engine.ts`), which no static
> kind reaches yet — that is the last of the three shapes named below.

`costReduction {what}` exists for "reduce the energy cost of this card in
your hand by N". Missing: "Reduce the energy cost of a {Power Pole} by {r}"
(a named card, an orb-typed reduction), "Reduce the combo cost by 1"
(BT25-098 — of what? read the card), "Reduce the skill cost of [union] skills
on yellow <Vegito> cards in your hand by {1}" (a skill cost, not an energy
cost; `orbTotals(sk)` in `engine.ts` is where the skill cost is computed — a
static of kind `cost` with `what: "skill"` would have to be read there). Read
`collectStatics` for how `cost` statics are consumed before adding kinds.

### 6.7 Count-based amounts — **partly done**

> Done 5 Sep 2026: cards under a card are counted (`parseTarget` reads the
> "under" area before the "this card" shortcut), and `collectStatics`
> evaluates a `count` amount rather than dropping it. Still open: `costReduction`
> with a count amount (DB2-039), which is §6.6 work.

`Amount { count: Selector, times }` exists. Missing selectors: "for each card
placed under it / under this card" (BT9-072, BT19-003 "non-Leader card under
this card") — add `Selector.under?: true` meaning *the cards under the selected
card(s)*; `resolveSelector` returns `inst.under` of each selected card (then
applies the filter). "Reduce the energy cost of this card in your hand by 1
for each of your blue Battle Cards" (DB2-039) — `costReduction` with a count
Amount: make its `n` an `Amount` and evaluate in `collectStatics`.

### 6.8 Cards under cards — 76 cards / 81 clauses (23-2)

"place it under the card you played with this skill" (BT6-050) — `refFor`
should map "the card you played with this skill" to `c.last` (the play's
choice var), exactly like "the played card". "When this card is activated from
your hand or from under a card" (BT19-095) — a trigger on activation from
under (needs `activate` to allow Extras from under a card; see the "Extras
under cards" rules in 23-2 before doing this). "[Activate: Battle][Limit 1]
Place 2 cards from under this card in their owners' Drop Areas: Draw 1 card"
(BT16-080) — a *cost* that moves cards from under; `costIsReadable` would have
to accept "place N cards from under this card in their owners' Drop Areas" and
`activate` would have to pay it (a new cost kind `underToDrop: N`; pay in
`payKeywordCosts`-style helper).

### 6.9 Reveal / look — 20-11 · **the named wordings are done**

> Done 5 Sep 2026: the `reveal` op, `Cond.varMatches`, "otherwise", and
> "look at your opponent's hand". Still open: "if it's a black … card you may
> add it to your hand" — the *may* is what is missing, not the condition.

"reveal the top card of your opponent's deck. If that card is a Battle Card,
place it in your opponent's energy in Rest Mode, otherwise draw 1 card"
(BT7-042). New op `reveal { sel, as }` (like `look` but public; log the card
name in a note); new `Cond { kind: "varMatches"; var; filter }` (evaluate with
`matches(cardNow(id), filter)` over `frame.vars[var]`); `parseConditionClause`
pattern "that card is (.+)" → var filled with `c.last`/the reveal var at the
call site (line with `parseConditionClause(clause, chaining)` in
`compileClauseList`); "otherwise" → the `else` branch of the same `if` (the
`if` op already has `else`). "Look at your opponent's hand" (BT10-004) →
`look` with `side: "opponent"`, area hand, no move.

### 6.10 Skill negation variants — 9-1-5 · **two of three done**

> Done 5 Sep 2026: `negateSkillsOfKind` ("that card's [Auto] skill") and
> `negateOwnSkill` for the battle. Still open: the third shape, a
> [Permanent] that negates over a *selector* (TB1-048) — `collectStatics` has
> no `negateSkills` static kind, and `skillsNegated` would have to consult it
> without recursing into the statics that produced it.

"negate this skill for the battle" (BT29-058) — `negateOwnSkill` with
`until: "battle"` (extend the union; `addEffect(... until: "battle")` — check
battle-scoped effects expire in `battleEnd`). "negate that card's [Auto] skill
for the turn" (EX07-06) — negate by *kind*: op `negateSkillsOfKind {target,
kind, until}` → effect kind `negateSkillKind` consulted in `skillNegated` by
`sk.kind`. "negate the skills of all of your opponent's Battle Cards with
energy costs of 4 or less" (TB1-048, a [Permanent]) — a static
`negateSkills` over a selector: `collectStatics` needs a `negateSkills`
static kind (today only per-target effects exist).

### 6.11 Keyword-related text — 65 cards / 79 clauses

"all of your Earthling Tokens gain [Barrier]" — `grant` over a selector of
tokens: `parseTarget` must read "Earthling Tokens" as a name filter (tokens
are named "<X> Token" — check `tokenCardId` in `state.ts`). "negate the
[Energy-Exhaust] skill of multicolor <Pan> cards" — `negateKeyword` with a
selector; `parseFilter` needs "multicolor" (≥ 2 colours; `monoColor: false`
is not the same — add `multiColor: boolean`). "When activating [Successor]" —
a trigger when the Successor keyword is used: pend `"successor"` in the
`activate` Successor branch.

### 6.12 Static skills in other areas — 64 cards / 71 clauses (9-1-3-3)

"While this card is under a yellow ≪Majin≫ card with an energy cost of 2 or
more in a Battle Area, the card above this card can't be KO'd once per turn"
(BT20-092) — statics from cards *under* cards: `staticEffects` iterates
`cardsInPlay`, hand and zDeck only; add cards under in-play cards with a
condition `isUnder(filter)` and a `Selector.special: "above"` (the host).
"negate its [Energy-Exhaust] skill in all areas" (EX18-05) — a static whose
target is a card in hand/energy (`inPlayNow` false); read `collectStatics`'s
`inPlayNow` handling. "this card gains +5000 power and [Critical] during your
turn" (SD5-01) — see 6.1 last row.

### 6.13 Unread costs — **the action prices are done**

> Done 5 Sep 2026. A price may now be an *action* as well as orbs or a
> condition: `compileCostProgram` (`compile.ts`) compiles it with the same code
> as an effect, and `canPayCostProgram` (`engine.ts`) decides whether the board
> can be charged before `activatable` offers it. 1,626 never-offered skills →
> 159. Read that pair before touching either — a skill offered with a price
> that then half-runs gets its effect for free.

What is left is a tail, listed at the end of `arena:gaps`: "discard this card
from your hand" (the card *is* the price, so it must not also be the source of
the skill), a full-width numeral where a number is expected, and a handful of
prohibitions printed where a price goes.

Still unread as *conditions*: "if all of your energy is black" (needs a
`Cond {kind:"every", sel, filter}`) and "if this card has [Servant]"
(`Cond {kind:"hasKeyword", sel, name}`; `has()` exists).

### 6.14 Engine follow-ups — **the four fidelity items are done**

> Done 5 Sep 2026, each with an engine test. `{r}/{u}` is an orb payable with
> either named colour (`Skill.energyEither`, solved exactly by `planPayment`
> trying each assignment of it rather than learning a new kind of
> requirement); [Aegis] narrows what it offers so a non-covering pair cannot be
> picked at all (`CardChoice.cover`); [Alliance] pends `restedByAlliance` on
> the cards rested to pay for it; and [Invoker] leaves the energy it is about
> to rest out of the check that the skill's own orbs can still be paid
> (`planPayment`'s `exclude`).

**Still approximate, and the one worth doing next here:** 9-10-2 gives the
affected player the choice when several replacement effects apply at once.
`replacementFor` takes the first and the log says which. Doing it properly
means `move` being able to prompt, which it cannot — see the note in §6.4 and
budget for it. Two replacements on one card needs a deck built to do it, which
is why no fuzzed game has produced one.
- The `choose` action accumulates picks for engine-side prompts with
  `max > 1` and offers "Done choosing" once `min` is met (`legalActions`
  `chooseCards`). The board (`src/components/arena/`) draws its buttons from
  `legalActions`, so it shows the action; check the label reads well on the
  phone.
- `resolveSelector` ignores `count` (rule 4 above). If a future op needs "the
  first N" rather than a choice (e.g. "the top 2 cards"), add an explicit
  `take?: number` to `Selector` rather than making `count` mean it.

### 6.15 Rules page and feedback

`/arena/rules` lets the owner attach a program to a card by describing it;
`/arena/feedback` (table `arena_feedback`, kinds bug/card/rule) is the one
inbox — `npm run arena:feedback` prints it. Work items filed there take
precedence over this backlog when they concern a deck the owner plays.

---

## 6a. What this stretch of work taught (5–6 Sep 2026)

`docs/arena-rules-worklist.md` has the round-by-round history. These are the
parts that generalise — read them before choosing what to do next, because
three of them changed what "next" meant.

### Where to look

1. **A clause that compiles wrongly is invisible to every measure here.**
   `arena:gaps` can only report clauses that *fail*. The most valuable work of
   this stretch was not in that list at all: colours that meant "all of them"
   instead of "either", a digit in ≪Universe 6≫ read as a count, "in your
   opponent's Drop" resolving to the Battle Area.
2. **Audit the compiled output against the text it came from.** A `choose` op
   records its clause in `reason`; a `delay` records its in `label`. That is
   enough to check thousands of selectors mechanically — side, area, count,
   and every measure the filter should carry (ground rule 5, done as a script).
   Expect the first run of such a probe to be mostly its own noise; narrow it
   twice before believing it.
3. **Rank by the owner's decks, not the catalog.** `npm run arena:gaps --
   --decks`. The catalog-wide list ranks by how often a wording appears, which
   buries anything happening once per card and rewards adding phrase patterns.
   Ranked over the decks, the same data surfaced a clause-splitter bug costing
   whole skills everywhere.
4. **A one-word "wording" is not a wording.** Fragments at the top of the miss
   list — "energy", "choose 1", "green", "you" — always mean `splitClauses` cut
   a sentence in the wrong place, and a fragment fails the whole skill. Two
   separate rounds of this: the ―…― aside, and comma-separated lists.
5. **Read the three headline numbers together.** Coverage, orphan triggers and
   unreadable prices move against each other: teaching the compiler a phrase
   *raises* the orphan count, because a skill only reaches that bucket once its
   effect compiles.

### How to decide what a wording means

6. **A wrong filter is worse than an over-fire.** A filter that stops a skill
   which should happen is a silent loss; a trigger that fires slightly too
   often is visible and usually harmless. So: refuse an alternation the parser
   cannot express ("a Battle Card **or** Unison Card"), and let the trigger
   fire unfiltered — *unless* the trigger fires on every card that player plays
   and the effect then acts on it, in which case refusing to fire is the safer
   half. Both directions are in `triggers.ts` with the reasoning.
7. **Two wordings that look alike are usually two moments.** "Your turn" is the
   controller's turn, never the turn player's. "By a skill" and "by a skill or
   KO'd" are different causes. `koed` is the KO'd card's own skill; the board
   watching it is a different trigger. Widening an existing regex is right only
   when the wider one would never fire at a moment the card does not mean.
8. **A trigger is the head of the sentence.** A card may *mention* a moment in
   the middle of an effect; that is a delayed effect, not a trigger.
9. **When a wording is genuinely ambiguous, look it up** — see ground rule 2.

### Traps that cost real time

10. **Never write a regex through `node -e`.** Three times now. `\b` becomes a
    literal backspace and the pattern silently matches nothing; `` $` `` in a
    replacement means "everything before the match". Find the damage with
    `grep -c $'\x08' <file>`. Use the editor.
11. **A regex that matches nothing looks exactly like progress.** Turning off
    five trigger patterns *lowered* nothing and *raised* the orphan count,
    which reads as the measure becoming honest. Every head-anchored trigger now
    has a positive test for this reason.
12. **Check whether a new failure is yours before fixing it.** Copy the changed
    files aside, `git checkout --` them, re-run the same fuzz seed. A minute,
    and it settled that a crash had come in with a newly added deck.

## 6b. Open questions for the owner

Rulings the engine has had to take a view on, where the manual does not settle
it. Each is a one-line change if the answer goes the other way; none blocks the
work, and they are parked here so they are not lost.

1. ~~**Does a card see its own arrival?**~~ **Settled from the manual, 5 Sep
   2026 — the engine's behaviour stands.** "When your blue ≪God≫ card is
   played, draw 1 card", printed on a card that is itself a blue ≪God≫ card:
   it does fire. Two rules decide it, both in `docs/rules/rulemanual.txt`:

   - **9-6-9-4** defines "when you play this card / when this card is played"
     as an **area movement trigger** — one that fires "when the cards they're
     on move from an area other than a Battle Area/Unison Area **to** a Battle
     Area/Unison Area". The play *is* the arrival.
   - **9-6-9-1-3**: for a movement between two open areas, an [Auto] that asks
     about the card that triggered it uses "the information of the card **as it
     is in the new area**". So at the moment the condition is tested the card
     is in the Battle Area, where its own skills are valid (9-1-3-1).

   Supporting, though not the same question: the official Card Q&A for
   {BT1-089 Avenging Frieza} answers "can you add Avenging Frieza to your hand
   with Avenging Frieza's auto skill?" with "…has the ≪Frieza's Army≫ special
   trait, so the condition specified on the card text is fulfilled" — Bandai
   does not read an unstated "other" into a card description. The cards that
   mean it print it ("1 **other** black card in your hand").

   No official Q&A addresses this exact case, so this is a reading of the
   manual rather than a printed ruling. If one turns up the other way it is a
   one-line change: exclude the played card from the watcher loop in
   `engine.ts`.

## 7. Definition of done for the next stage

- ~~Catalog ≥ 85 % of resolvable skills compile~~ — **met, 85.9 %** (6 Sep
  2026). The owner's decks ≥ 95 % is still open: 92.2 %, and what is left there
  is listed by `npm run arena:gaps -- --decks`.
- `arena:gaps` "1 clause in the way" below 800. Still open at 1,191, and that
  figure has barely moved all stretch — because the work went into clauses that
  compiled *wrongly* rather than ones that failed. Both matter; only one of
  them shows up here.
- Sections 6.2–6.5 implemented with tests; 6.6–6.12 at least the wordings
  named above.
- `npm test`, `lint`, `typecheck` clean; `arena:fuzz 100` with 0 crashes.
- `docs/arena-rules-worklist.md` gains a "Done" section with the numbers and
  the lessons, in the same style as the existing ones.
- Nothing merged to `main` unless the owner asks; then rebase on `main`, run
  everything again, and open the PR.

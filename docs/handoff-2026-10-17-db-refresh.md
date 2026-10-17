# Local session brief: refresh stored arena programs after #951–#972 (17 Oct 2026)

You are running locally with this app's `.env.local` (`DATABASE_URL` = the trading-card-management Neon DB).
The cloud session merged the code but could not reach the database. Your job: bring the stored
`card_rules` rows in line with the merged compiler, record one ruling, and report. The owner has
authorised this run (17 Oct 2026); still show the plan and stop before each `--apply`.

## 0. Setup and safety
- `git pull` on `main` (at or after `de0ac3a`); `npm ci`; Node 24.
- Make sure the production deploy of `main` that contains `57a4acb` (PR #974) is live before applying anything. The stored rows
  must not run ahead of the deployed interpreter (new ops: `notIn`/`EXCEPT`, `yourUnisonLeft`,
  `ownedByOpponent`, `specifiedCost`, `selfRestToActive`, …).
- `npm run db:check`: it must list `card_rules`. If it does not, stop: that is the wrong database.
- Read `docs/agent-brief.md` (Data section) and `scripts/lib/reviewed-rule-refresh.ts`. Writes go only
  through repo scripts that lock, compare and swap, never through ad hoc `UPDATE`s.
- Rows a person owns (`source <> 'compiler'`, or status `confirmed`/`corrected`) are never overwritten.

## 1. Record the ruling (owner, 17 Oct 2026)
```
npm run arena:rule -- EX24-05 --skill 10 "“If you only have blue ≪Power Wish≫ <Son Goku> cards in play in your Battle Area” needs at least one Battle Card there, and all of them must be blue Power Wish Son Goku cards; an empty Battle Area does not satisfy it."
```
Check the skill index with `npm run arena:rule -- --list` or the workbench first. The code is merged
(PR #974). It applies the same reading to BT7-004 (Alliance Auto) and P-210 (Drop play), which share the wording.

## 2. Plan (read only)
Write a bounded plan script, `scripts/arena-refresh-2026-10-17.mts`, modelled on
`scripts/arena-deck-rule-refresh.mts` (`--plan FILE` / `--apply FILE`, uses `applyReviewedRefresh`):
- For every `dbs` card, compile with `skillRecords(cardDefFrom(card))` and compare with its stored
  `card_rules` rows (`canonical` for equality).
- Keep only rows where `source = 'compiler'` and status is `open`/`draft`, where the printed text is
  unchanged, and where the fresh record differs.
- Write the plan to a private file outside the repo, and print a table with these columns:
  - card, side, skill
  - old reading → new reading
  - whether the change newly reads, newly leaves unread (expected from #961), or changes a reading
- Separately list the rows that differ but are owned. Don't touch them; report them.

Expected families (the plan should contain these and little else; anything else gets flagged):
- #951: energy-area EX-Evolve, Earthling Tokens, U3 errata, Gogeta hand/Warp, Broly restriction
- #952 BT31-015; #953 BT31-139, BT31-141 tokens, "[Over Realm 2]"; #955 BT13 non-Evolve
- #956 `playedFromHand` Autos, EX03-14 (owned — see 4), BT7 multicolour discount
- #958 Union-Fusion/Potara/Evolve action costs incl. BT13-024; #959 DB3 Counter-energy, Bardock's Crew
- #963 "played or attacks" + newly unread "played or …" tails
- #964 Final Strike Bardock (DB3-027 family); about 165 newly *unread* price clauses (#961)
- #967 EX24-01 back, -03, -04, -08, -10, -13
- #968: BT19-028/045/086/120, BT20-129, BT25-066, BT27-023/042/055/072/107, P-482; BT20-091/096/097/100/103/106–109/112/118/147, SD22-05/06, P-492; BT1-065, BT13-099
- #971: BT14-131–135/137/138, BT15-130–137, P-313; BT9-046/059/061/120/121/122
- #974: EX24-05, BT7-004, P-210 ("only have … in your Battle Area", needs at least one)
- #972: BT10-025/026, BT12-138/139, BT18-041, BT19-004, EB1-38 back, P-286, P-287, P-441, SD16-03

## 3. Apply
Show the owner the plan summary (counts per family, plus the full list of the owner's deck cards
affected) and get a yes. Then run `--apply` with the same file. Report the row ids changed, and
confirm with a re-run of `--plan` that nothing is left.
Then: `npm run arena:fuzz -- 40` (owner allows it for the coordinator), and report failures.

## 4. Protected overrides (only with the owner's explicit yes per card)
- EX03-14 (proposal in PR #956 body)
- BT31-141 Cell Jr. Summon (proposal in PR #953 / issue #942)
Show the stored program next to the proposed one, and get a yes for each card separately before changing it.

## 5. Report
Comment on issue #907 with: plan counts, applied row ids, owned rows skipped, fuzz result, ruling recorded.
Don't commit the plan file. Commit the plan script only if the owner wants it kept.

# Arena agent-tools evaluation (#665 / O5-04)

## Decision

**No-go for a custom arena MCP wrapper at this time.** Existing repo commands cover the measured development tasks, accept stable inputs, and return reproducible results. The scenario command already emits compact JSON records; TypeScript's installed language service resolves definitions and references; the CDP-backed scenario option exercises the real browser worker offline. A wrapper would mostly forward these commands and add a second interface to maintain.

There is one concrete output-friction point: `arena:replay` pretty-prints the full state, events, and legal actions. On the sample below that was 52,694 bytes. This may be unwieldy in an agent transcript, but a wrapper returning the same payload would not reduce it. If that proves costly across real replay reviews, first consider a native `--summary` or output-file option with a stable schema; that is a separate, measured follow-up, not a reason to build an MCP service now.

## Reproduction and measurements

Measured 14 Oct 2026 in `/workspace/tcg-tools`, branch `ops/arena-tools-review`, Node v24.19.0, with the existing dependency tree linked from the main checkout. Times are one wall-clock run per command on this Linux host, not a benchmark. Each row is one shell-tool invocation for the task (not counting preparation); no model-token or context-token counter was available. Output bytes are a rough transcript-size proxy, not token counts.

| Task | Reproducible command and input | Observed result | Wall time; output |
|---|---|---|---|
| Inspect a symbol | Use the TypeScript language-service scratch script in [`arena-agent-tools.md`](arena-agent-tools.md) §2c: `npx tsx tsnav.scratch.mts src/lib/arena/text/cards.ts keywordOf` | Definition `src/lib/arena/text/cards.ts:167:17`; 33 references; 0 diagnostics. | 6.327 s; 317 bytes (seven lines). |
| Run engine scenarios | `DATABASE_URL='' npm run arena:scenario -- all` | `setup`, `battle`, and `pending-choice` pass; 3 JSON records plus summary. The records include seed, engine/runtime revision, bundle/ruleset/catalog/program hashes, checked steps and state/event/legal/action hashes. | 1.501 s; 3,291 bytes (eight lines). |
| Check browser agreement | `DATABASE_URL='' npm run arena:scenario -- all --browser` | Same three scenarios pass in Node and HeadlessChrome 154; all browser records agree with Node. This uses the installed Chrome and repo CDP driver, with the worker taken offline. | 3.443 s; 3,790 bytes (eight lines). |
| Replay an export | `DATABASE_URL='' npm run arena:replay -- /tmp/arena-tools-replay.json --runtime-revision a641000000000000000000000000000000000641` | Exit 0; replays a 10-action `battle` fixture at seed 641. The output includes full state, events and legal actions. | 0.569 s; 52,694 bytes (2,414 lines). Fixture input: 198,132 bytes. |

The replay input was a temporary synthetic export assembled from `fixtureBundle()` and the ten actions captured by `runScenario("battle", ...)` in `scripts/verify/arena-scenarios.ts`. The bundle was pinned to revision `a641000000000000000000000000000000000641`; it used no live deck, database, network or paid provider. This exercises the replay CLI contract, not the admin export UI or a production replay. To repeat with a real export, supply that export path and its matching runtime revision to the command above.

## Available tools and confounders

The current agent session exposed 229 tools: 89 GitHub tools and no browser, TypeScript, or filesystem MCP tools. The shell was sufficient: `git grep`/`rg`, TypeScript compiler API, `tsx`, repo arena commands, and `scripts/lib/cdp.mts` plus installed Chrome. A custom server was neither installed nor needed. The MCP inventory is session-specific; it does not establish what every agent runtime exposes.

The symbol-navigation timing includes loading the project language service and is a single run. The reference count (33) differs from the 35 recorded in the earlier Windows measurement in `arena-agent-tools.md`; the definition and zero-diagnostic result agree, and this run should be treated as the current observed count. The scenario fixture uses synthetic cards and shipped rules, so it establishes harness consistency, not coverage of real catalog cards. Browser-worker agreement is headless desktop evidence, not a physical-device result. The replay's large output is expected from its documented full-result contract and may vary by fixture size. No token savings are claimed.

## If later measurements justify a wrapper

Keep it read-only and local, with no service dependency on offline gameplay. The only demonstrated contracts worth forwarding would be:

| Tool | Inputs | Structured result |
|---|---|---|
| `arena_symbol` | source file, symbol | definition locations, reference locations, file diagnostics |
| `arena_scenario` | scenario ids (`all` allowed), optional seed/revision/bundle, optional browser agreement | existing per-scenario JSON evidence and pass/fail summary |
| `arena_replay` | export path, runtime revision | current replay result (`state`, `events`, `legalActions`), preferably as a file/artifact if it remains this large |

These map directly to TypeScript language-service APIs and `npm run arena:scenario` / `npm run arena:replay`. A wrapper should be reconsidered only after repeated agent sessions show measurable call or output reduction, and only if it preserves these existing validation and revision checks. No server, package, or dependency was added by this evaluation.

## Verification

Observed claims above are backed by the commands and results in the table. `docs/arena-tooling.md` documents the scenario and replay flags; `docs/arena-agent-tools.md` documents the TypeScript language-service and CDP workflows. This is documentation-only; the focused scenario runs were executed, while `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` were not run because they do not verify these documentation claims and the coordinator owns the full gates.

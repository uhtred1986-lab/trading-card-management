# Arena agent-tools evaluation (#665 / O5-04)

## Decision

**No-go for a custom arena MCP wrapper at this time.** Existing repo commands cover the measured development tasks, accept stable inputs, and return reproducible results. The scenario command already emits compact JSON records; TypeScript's installed language service resolves definitions and references; the CDP-backed scenario option exercises the real browser worker offline. A wrapper would mostly forward these commands and add a second interface to maintain.

The full replay result was the concrete friction point: it pretty-printed the whole state, events, and legal actions (52,694 bytes including the `npm run` banner). This evaluation adds native `--summary` and `--output` options while preserving the full default output. The focused CLI check reduced the same fixture's direct stdout from 52,532 bytes to 640 bytes; with `npm run` banners, the full and summary commands emitted 52,694 and 812 bytes respectively. `--output` keeps the complete 52,532-byte JSON result in a file. That solves the measured transcript problem without a wrapper or service.

## Reproduction and measurements

Measured 14 Oct 2026 in `/workspace/tcg-tools`, branch `ops/arena-tools-review`, Node v24.19.0, with the existing dependency tree linked from the main checkout. Times are one wall-clock run per command on this Linux host, not a benchmark. Each row is one shell-tool invocation for the task (not counting preparation); no model-token or context-token counter was available. Output bytes are a rough transcript-size proxy, not token counts.

| Task | Reproducible command and input | Observed result | Wall time; output |
|---|---|---|---|
| Inspect a symbol | Save and run the TypeScript language-service scratch script shown in [`arena-agent-tools.md`](arena-agent-tools.md) §2c: `npx tsx tsnav.scratch.mts src/lib/arena/text/cards.ts keywordOf` | Definition `src/lib/arena/text/cards.ts:167:17`; 33 references total, of which the script prints the first five; 0 diagnostics. | 6.327 s; 317 bytes (seven lines). |
| Run engine scenarios | `DATABASE_URL='' npm run arena:scenario -- all` | `setup`, `battle`, and `pending-choice` pass; 3 JSON records plus summary. The records include seed, engine/runtime revision, bundle/ruleset/catalog/program hashes, checked steps and state/event/legal/action hashes. | 1.501 s; 3,291 bytes (eight lines). |
| Check browser agreement | `DATABASE_URL='' npm run arena:scenario -- all --browser` | Same three scenarios pass in Node and HeadlessChrome 154; all browser records agree with Node. This uses the installed Chrome and repo CDP driver, with the worker taken offline. | 3.443 s; 3,790 bytes (eight lines). |
| Replay an export, compact | `DATABASE_URL='' npm run arena:replay -- /tmp/arena-tools-replay.json --runtime-revision a641000000000000000000000000000000000641 --summary` | Exit 0; summary contains seed, revision, action/event/legal-action counts and types, final phase/turn and hashes of full state/events/legal actions. | 0.703 s; 812 bytes including `npm run` banner (640-byte JSON record). Full stdout was 52,694 bytes; `--output` wrote the 52,532-byte full JSON. |

To reproduce the synthetic 10-action input exactly, create and run this temporary generator from the repository root. It writes a 198,132-byte export to `/tmp/arena-tools-replay.json`; remove the scratch script afterwards:

```bash
cat > arena-tools-replay-fixture.scratch.mts <<'EOF'
import fs from "node:fs";
import { fixtureBundle, FIXTURE_REVISION } from "./scripts/verify/arena-browser-fixture.ts";
import { runScenario } from "./scripts/verify/arena-scenarios.ts";
const bundle = await fixtureBundle();
const actions: unknown[] = [];
await runScenario("battle", { bundle, interpreterRevision: FIXTURE_REVISION, observe: (_match, action) => { if (action) actions.push(action); } });
fs.writeFileSync("/tmp/arena-tools-replay.json", JSON.stringify({ exact: true, seed: 641, engine: "rules", actions, decks: bundle.decks, bundle }));
console.log(JSON.stringify({ seed: 641, engine: "rules", actions: actions.length, bundleHash: bundle.hash }));
EOF
npx tsx arena-tools-replay-fixture.scratch.mts
rm arena-tools-replay-fixture.scratch.mts
```

Then replay using the command in the table. Omit `--summary` to retain the previous full JSON stdout contract; add `--output /tmp/replay-result.json` to write the full result to a file, alone or alongside `--summary`. The fixture uses no live deck, database, network or paid provider. It exercises the replay CLI, not the admin export UI or a production replay. A real export can be substituted with its matching runtime revision.

## Available tools and confounders

No dedicated TypeScript or filesystem MCP endpoint was used. The shell was sufficient: `git grep`/`rg`, the installed TypeScript compiler API, `tsx`, repo arena commands, and `scripts/lib/cdp.mts` driving installed Chrome. The MCP tool inventory is session-specific and is not a measure of general tool availability.

The symbol-navigation source is a complete scratch-script code block in `arena-agent-tools.md` §2c, not a checked-in script; save it as `tsnav.scratch.mts` before running the command. Its measured output was seven lines: the definition, first five references, and a final count of 33; it did not print all 33 locations. The timing includes loading the project language service and is a single run. The count differs from the 35 in the earlier Windows measurement; this run is the current observed count. The scenario fixture uses synthetic cards and shipped rules, so it establishes harness consistency, not coverage of real catalog cards. Browser-worker agreement is headless desktop evidence, not a physical-device result. The replay output size may vary by fixture. No token count was available; bytes are only a rough transcript-size measure.

## If later measurements justify a wrapper

Keep it read-only and local, with no service dependency on offline gameplay. The only demonstrated contracts worth forwarding would be:

| Tool | Inputs | Structured result |
|---|---|---|
| `arena_symbol` | source file, symbol | definition locations, reference locations, file diagnostics |
| `arena_scenario` | scenario ids (`all` allowed), optional seed/revision/bundle, optional browser agreement | existing per-scenario JSON evidence and pass/fail summary |
| `arena_replay` | export path, runtime revision, `--summary`, optional `--output` path | compact counts/types/final position and hashes on stdout, with the full result available as a file |

These map directly to TypeScript language-service APIs and existing CLI contracts. The replay CLI's summary and file-output options are native changes; a custom MCP wrapper remains unjustified unless repeated agent sessions show a separate measurable call or output reduction. No server or dependency was added by this evaluation.

## Verification

Observed claims above are backed by the commands and results in the table and the focused `npx tsx scripts/verify/arena-replay-cli.mts` check. `docs/arena-tooling.md` documents the scenario and replay flags; `docs/arena-agent-tools.md` contains the TypeScript scratch-script source and CDP workflow. `npm run typecheck`, `npm run lint`, the full `npm test`, and `npm run build` were not run; the coordinator owns those gates.

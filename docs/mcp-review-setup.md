# MCP review setup

This repo keeps the MCP setup small on purpose:

- **GitHub MCP** stays enabled for PR diffs, check runs, review comments, and deployment context.
- **Filesystem MCP** is restricted to read-only file and directory tools.
- **TypeScript MCP** is restricted to navigation and diagnostics, with workspace command execution disabled by `.lsp-mcp.jsonc`.

The checked-in baseline lives at:

- `.github/copilot/mcp-review-settings.json`
- `.lsp-mcp.jsonc`
- `.github/copilot/review-profiles/`

## Servers

### GitHub MCP

What it does:

- Reads PR metadata, diff context, review comments, check runs, and workflow logs.
- Gives a reviewer enough context to start from the PR itself instead of guessing from local files.

Why it matters here:

- The repo already relies on GitHub Actions for `typecheck`, `lint`, `test`, and the Android contract job.
- PR review often needs the failing job log before tracing into `src/`, `scripts/`, or `drizzle/`.

Notes:

- GitHub MCP is enabled by default in GitHub Copilot's repository MCP settings.
- Keep it enabled for all four review profiles.

### Filesystem MCP

What it does:

- Reads files and directories, walks trees, and searches the repo.
- Stays safe-by-default by excluding all write-capable tools from the allowlist.

Why it matters here:

- The important review questions are cross-file: `game` propagation, arena `dbs` guardrails, auth/proxy exemptions, migration safety, and pricing invariants.

### TypeScript MCP

What it does:

- Follows definitions, references, symbols, call hierarchy, and diagnostics.
- Uses the repo-local `.lsp-mcp.jsonc` so the TypeScript server configuration stays with the codebase.

Why it matters here:

- The app's invariants are spread across `src/lib/catalog`, `src/lib/decks`, `src/lib/arena`, `src/lib/pricing`, server actions, and `scripts/`.
- Review quality improves when the reviewer can jump from a touched action or query to every impacted type and helper.

## Review profiles

The reusable profiles live under `.github/copilot/review-profiles/`.

| Profile | What it does | When to run |
| --- | --- | --- |
| `quick-gate` | Fast high-confidence PR gate using diff + checks + targeted tracing. | **PR open:** yes. Re-run on substantial pushes. |
| `data-safety` | Focuses on schema safety, persistence, auth boundaries, and pricing data invariants. | **On demand:** when `drizzle/`, `src/db/`, sync/import paths, pricing, or auth/proxy code changes. |
| `integration` | Checks multi-file wiring across app code, scripts, env handling, DB driver selection, and deployment config. | **On demand:** when changes span code + scripts + infra or touch external integrations. |
| `preview` | Adds route/UI/deployment-surface validation after the code-level review pass. | **On demand:** when a preview URL or local tunnel exists and the PR changes routes, UI, manifest, service worker, or auth surfaces. |

## Repository-specific checks to encode in reviews

### 1. `game` propagation correctness

Run this whenever the PR touches card, deck, collection, leader, catalog, pricing, or sync paths.

Key files to inspect:

- `src/lib/catalog/games.ts`
- `src/lib/catalog/sets.ts`
- `src/lib/decks/legality.ts`
- `src/app/decks/actions.ts`
- `src/lib/arena/load.ts`
- `scripts/verify-rules.ts`

What to confirm:

- Set and card helpers still derive the correct game.
- Deck and query paths do not mix DBS and Fusion rows.
- UI filters and legality checks still flag cross-game mistakes instead of silently accepting them.

### 2. Arena scope guardrails

Run this whenever the PR touches `src/app/arena/**`, `src/lib/arena/**`, or deck-loading code.

Key files to inspect:

- `src/lib/arena/load.ts`
- `src/lib/arena/games.ts`
- `src/lib/catalog/games.ts`
- `src/lib/decks/legality.ts`

What to confirm:

- Arena flows still reject Fusion decks where the arena is intentionally `dbs`-only.
- Changes to shared deck helpers do not reopen Fusion gameplay through the arena side door.

### 3. Auth/proxy exemptions

Run this whenever the PR touches proxy, auth, sync routes, the manifest, icons, or the service worker.

Key files to inspect:

- `src/proxy.ts`
- `src/app/manifest.ts`
- `src/app/api/sync/prices/route.ts`
- `vercel.json`
- `public/icons/`
- `public/sw.js`

What to confirm:

- Unauthenticated access stays limited to `/api/sync/*`, `manifest.webmanifest`, `/icons/*`, and `/sw.js`.
- Protected routes still require Basic Auth or app-user auth as intended.

### 4. Migration safety

Run this whenever the PR touches `drizzle/`, `src/db/schema.ts`, or write-heavy sync/import code.

What to look for:

- `DROP TABLE`, `DROP COLUMN`, or destructive rewrites.
- Tightening to `NOT NULL` without a safe backfill.
- Renames or rewrites that can orphan related rows.
- Data corrections that belong in import logic rather than one-off SQL updates.

Reviewer commands:

- `npm test`
- `npm run db:check` when a database is available
- `npm run db:migrate:http` in HTTPS-only sandboxes

Only accept risky changes when the PR also explains the preservation or rollback plan.

### 5. Pricing invariants

Run this whenever the PR touches pricing, settings copy, sync jobs, or external marketplace glue.

Key files to inspect:

- `src/lib/pricing/tcgcsv.ts`
- `src/lib/pricing/fx.ts`
- `src/app/cards/[id]/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/api/sync/prices/route.ts`

What to confirm:

- Source prices still come from TCGplayer/tcgcsv in USD.
- EUR display still depends on the stored USD→EUR rate in `fx_rates`.
- PRs that intentionally change the pipeline say so explicitly.

## Local/dev vs CI usage

### Local or IDE review

1. Keep `.lsp-mcp.jsonc` in the repo root.
2. Start from the JSON in `.github/copilot/mcp-review-settings.json`.
3. If your MCP host does not launch from the repo root, set `COPILOT_MCP_REPO_ROOT` to the checkout path before using the filesystem server.
4. Use the profile prompt from `.github/copilot/review-profiles/<profile>.md`.

Recommended local commands:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run db:check` when `DATABASE_URL` is available

If the environment only allows HTTPS egress, use `DB_DRIVER=neon-http` for the database scripts that already support it.

### GitHub / repository MCP settings

1. Open **Settings → Copilot → MCP servers** in the repository.
2. Paste the JSON from `.github/copilot/mcp-review-settings.json`.
3. Keep the default GitHub MCP server enabled.
4. Save, then use `quick-gate` for the default PR-open review pass.

### CI usage

There is no separate CI-only MCP config in this repo.

Instead, code review should consume:

- GitHub check runs from `.github/workflows/checks.yml`
- workflow job logs through GitHub MCP
- the same repo-local profile prompts and commands listed above

That keeps the setup maintainable and avoids duplicating review logic in another YAML layer.

## Required secrets and env vars

### For the baseline MCP setup

- **Required:** none
- **Optional:** `COPILOT_MCP_REPO_ROOT` if the MCP host needs an explicit repo path for the filesystem server

### For local validation commands used by reviewers

- `DATABASE_URL` for DB-backed checks such as `npm run db:check`
- `DB_DRIVER=neon-http` when a sandbox cannot open Postgres TCP
- `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` only when you intentionally test an auth-protected local or preview deployment
- `CRON_SECRET` only when you intentionally test `/api/sync/*`

Do not place any of these values in the checked-in MCP JSON.

## Copy/Paste for Copilot MCP Settings

Paste this into the repository's Copilot MCP settings on GitHub, or into your local Copilot MCP configuration if your client accepts the same `mcpServers` shape:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "local",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${COPILOT_MCP_REPO_ROOT:-.}"
      ],
      "tools": [
        "read_text_file",
        "read_media_file",
        "read_multiple_files",
        "list_directory",
        "list_directory_with_sizes",
        "directory_tree",
        "search_files",
        "get_file_info",
        "list_allowed_directories"
      ]
    },
    "lsp": {
      "type": "local",
      "command": "npx",
      "args": [
        "-y",
        "language-server-mcp"
      ],
      "tools": [
        "hover",
        "definition",
        "type_definition",
        "implementation",
        "references",
        "document_symbols",
        "workspace_symbols",
        "call_hierarchy_prepare",
        "call_hierarchy_incoming",
        "call_hierarchy_outgoing",
        "diagnostics",
        "list_servers",
        "search_servers",
        "server_status"
      ]
    }
  }
}
```

## Troubleshooting

### Filesystem MCP starts but cannot read the repo

- The filesystem server needs an allowed root.
- Set `COPILOT_MCP_REPO_ROOT` to the checkout path if `.` is not enough in your host.
- Confirm the server only exposes the read-only tool list above.

### TypeScript MCP cannot find symbols or diagnostics

- `language-server-mcp` loads `.lsp-mcp.jsonc` from the workspace root.
- Restart the MCP server after adding or changing `.lsp-mcp.jsonc`.
- Make sure the workspace is the repo root so the TypeScript server matches `.ts` and `.tsx` files here.

### Review can see files but not workflow failures

- Keep GitHub MCP enabled.
- Start the review from the PR's check runs or failing workflow jobs before doing local tracing.

### DB-backed review commands fail in a sandbox

- Use the read-only MCP review first.
- Then set `DATABASE_URL` and, if needed, `DB_DRIVER=neon-http` before running `npm run db:check` or `npm run db:migrate:http`.

### Preview checks are blocked

- Preview access may require both Vercel SSO and Basic Auth.
- If the hosted preview is awkward to reach, use a local `npm run build && npm start` plus a tunnel and run the `preview` profile against that URL instead.

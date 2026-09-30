# Architecture: database access, server actions and the session hook

Read before touching server actions, raw SQL, array bindings, or when a `Cannot find module` error appears. Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **Server actions over API routes.** Mutations live in `actions.ts` files next to their pages.
  The only API routes are the cron price sync (`/api/sync/prices`) and the scan upload
  (`/api/scan`).
- **Raw SQL reads go through `rows()`** (`src/db/rows.ts`) because postgres.js returns arrays and
  PGlite (used by `npm test`) returns `{ rows }`.
- **Binding arrays in raw SQL:** use `textArray()` from `src/db/sqlx.ts` — `${arr}::text[]` fails
  under postgres.js with a `transformTypeCast` error.

A `SessionStart` hook (`.claude/settings.json` → `scripts/session-start-check.mjs`) runs `npm ci`
before a fresh Claude Code on the web session's first turn whenever `node_modules` is missing or
older than `package-lock.json`, then warms the `tsx` cache — plain Node, so it works the same
under the owner's Windows/PowerShell machine and in the sandbox. It is a no-op in under a second
when `node_modules` is already current. A `Cannot find module` error from any `verify-*` or
`arena:*` script means the hook did not run (or ran and failed) — run `npm ci` by hand rather than
assuming the suite is broken.

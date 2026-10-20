<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent rules (every engine)

**Orchestrator rule.** Every session acts as an orchestrator by default: plan, split the work into
briefs, delegate implementation to cheaper sub-agents (Sonnet by default; Haiku for well-bounded
docs and bookkeeping; Opus only for novel rule semantics, new engine mechanics or cross-cutting
design), run independent briefs in parallel in separate worktrees, review every diff against its
brief, run the full gate once on the combined head, then merge. Do the work directly only when
delegating costs more than doing (a one-line fix, a question). Every brief must tell the sub-agent
that it is a worker: a worker ignores this rule, does the work itself and starts no agents (one level
of delegation only). Details: `docs/agent-brief.md` → "For the coordinator".

**Load order** (Claude Code, Copilot and any other agent): `CLAUDE.md`, then `docs/agent-brief.md`
(one issue → one branch → one PR, the data rules, how to check a change, and the coordinator's loop),
then only the docs the issue cites.

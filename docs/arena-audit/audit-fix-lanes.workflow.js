export const meta = {
  name: 'audit-fix-lanes',
  description: 'One round of the arena readings audit: four compiler-area lanes, each fixed then adversarially reviewed, cheap checks only',
  phases: [
    { title: 'Fix', detail: 'one agent per lane fixes its wording families, largest first' },
    { title: 'Review', detail: 'one agent per lane reviews every changed reading and repairs misreads' },
  ],
}

const A = args
const LANES = A.lanes

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    head: { type: 'string', description: 'full 40-char sha pushed' },
    families: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, wording: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } },
      rulings: { type: 'array', items: { type: 'string' } }, how: { type: 'string' } }, required: ['name', 'cards', 'how'] } },
    fixed: { type: 'array', items: { type: 'string' }, description: 'finding ids now read correctly by this branch' },
    alreadyFixed: { type: 'array', items: { type: 'string' }, description: 'finding ids whose problem was already gone at the branch point' },
    madeUnread: { type: 'array', items: { type: 'string' }, description: 'skills deliberately made unread (honest gap) instead of misread' },
    left: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    rejected: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] }, description: 'findings judged not a real misread after all' },
    pendingRulings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, question: { type: 'string' }, implemented: { type: 'string' }, alternatives: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } }, basis: { type: 'string' } },
      required: ['id', 'question', 'implemented', 'alternatives'] } },
    corpus: { type: 'string', description: 'compile-snapshot diff counts vs the baseline, and any read->unread keys with reason' },
    checks: { type: 'string', description: 'every check run and its result' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    integrationNotes: { type: 'string', description: 'conflict hotspots, older suites whose expectations were changed deliberately, anything integration must know' },
  },
  required: ['branch', 'head', 'families', 'fixed', 'left', 'pendingRulings', 'corpus', 'checks', 'filesTouched', 'integrationNotes'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    head: { type: 'string' },
    reviewed: { type: 'number', description: 'changed readings reviewed' },
    corrected: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'problem', 'fix'] } },
    stillDoubtful: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, doubt: { type: 'string' } }, required: ['id', 'doubt'] } },
    codeIssues: { type: 'array', items: { type: 'string' } },
    pendingRulings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, question: { type: 'string' }, implemented: { type: 'string' }, alternatives: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } } },
      required: ['id', 'question', 'implemented', 'alternatives'] }, description: 'pending rulings added or changed in review' },
    corpus: { type: 'string' },
    checks: { type: 'string' },
  },
  required: ['head', 'reviewed', 'corrected', 'stillDoubtful', 'codeIssues', 'corpus', 'checks'],
}

const COMMON = (L) => `You are one lane of an integration of arena compiler fixes in the trading-card-management repo (a Next.js app whose "arena" plays the Dragon Ball Super Card Game from stored card_rules records compiled from printed card text). The owner's direction: every legacy card supported and read correctly; long-term supportability and accuracy beat shortcuts; earlier decisions are not irreversible.

YOUR LANE: ${L.key} — ${L.title}. Branch: ${L.branch} (create it from origin/${A.integration}).

SETUP (in your own worktree — never work in /home/user/trading-card-management itself or in .claude/worktrees/integration-${A.round}):
  git fetch origin ${A.integration} ${L.branch} 2>/dev/null; if git ls-remote --exit-code origin ${L.branch} >/dev/null; then git checkout -B ${L.branch} origin/${L.branch}; else git checkout -B ${L.branch} origin/${A.integration}; fi
node_modules resolves from the repository root above your worktree; if a tool cannot find a package, run \`npm ci\` once in your worktree.
Read first: .claude/skills/arena-work/SKILL.md (cheap entry points into the engine), docs/arena-batch-process.md (research order, the rulings ledger, which checks a batch agent runs and which it must not), and the CLAUDE.md rules you were given (glossary rule, errata rule, no database, no paid calls).

INPUTS (read them in parts, they are large):
- Your work list: ${L.file} (in the repo) — clusters of unread skills by wording, and/or audit findings with PRINTED text, the AUDITED reading, the NOW reading, PROBLEM, EXPECTED, EVIDENCE and the verifier's note. \`grep '^### ' <file>\` gives the index.
${L.extraFiles}
- Catalog snapshot (production, taken with arena:snapshot by the owner or an authorised session): ${A.snapshot}
- Baseline readings, this integration's base compiler over that snapshot (arena:compile-snapshot): ${A.baseline}

RESEARCH ORDER for any reading (docs/arena-batch-process.md §1): rule manual docs/rules/rulemanual.txt; the card's official Q&A (src/lib/rules-review/faq.generated.json, now correctly keyed) and general Q&A docs/rules/game-faq.txt; official errata docs/rules/errata-official.json (a catalog line still printing the "before" text gets its fix in src/lib/catalog/errata.ts, never by UPDATE); an official answer for the same wording on another card; an owner ruling in src/lib/arena/rulings.ts (\`npm run arena:rulings -- <cardId|words>\`); design intent last (R-001): \`npm run arena:intent -- --snapshot ${A.snapshot} <cardId>\` shows the Leaders of the card's release and the previous one — choose the reading that lets the card do its job with them, preferring the more interactive, fun play.

HOW TO WORK
1. Index your findings and cluster them into wording families (same printed construction misread the same way). Work the largest families first. For each family find the root cause in the compiler (src/lib/arena/text/*, compile.ts, compile/*), the rules language (lang/*, rulesets/dbs/*) or the engine (vm/*), and fix it generally — one rule for the wording, never a card-id special case in the compiler. Card-specific text problems (typos, errata, a missing line break) go in src/lib/catalog/errata.ts.
2. "READING CHANGED" entries: check the NOW reading first; if the problem is gone, record the id under alreadyFixed and move on.
3. If the correct reading needs engine support that does not exist and is not a contained addition, make the clause UNREAD (an honest gap) rather than leave a misread. A misread plays wrongly; an unread skill is visible and gets taught later.
4. A finding you judge not to be a real misread (the verifier was wrong): put it in rejected with the evidence.
5. Where the sources are silent and you implement a best guess, add a ledger entry to src/lib/arena/rulings.ts with status "pending", confidence "best-guess", basis including "intent" (or "same-wording" etc.), using ONLY ids ${L.ids} (ascending, append at the end of RULINGS; ids never reused). Cite the id in your verify suite and glossary entry. Report each in pendingRulings with the question for the owner, what you implemented (your suggested answer) and the alternatives.
6. Update src/lib/arena/glossary.ts in the SAME commit as any compiler/VM/text/lang change (it has CRLF line endings — keep them; check with \`file\`).
7. Add your suite scripts/verify/${L.suite}.ts (assert-based, like scripts/verify/moments-1.ts or phrasing-batch-10.ts: representative cards per family through the real compiler, and for engine changes a short play test), and add "${L.suite}" to the end of SUITES in scripts/verify-arena.ts.

CHECKS — only these (each build or full test run costs the owner money; the full gate runs once at integration):
- npm run typecheck; npx eslint <files you changed>
- Round 1's integration gate caught what lanes did not run; run these when they apply: \`npx tsx scripts/verify/capabilities.mts --check\` whenever you touch a vm/* file holding a NotYet site (update its stored signature in src/lib/arena/capability-inventory.ts when you change the guard); \`npx tsx scripts/verify/teach.ts\` whenever the rules language or its reference changes (lang/*, script-schema.ts fields/ops/conds/triggers); \`npx tsx scripts/verify/attack-preview-801.ts\` whenever you add work done at every checkpoint or every preview (vm/flow.ts, vm/host.ts, statics).
- Round 2's integration also caught older suites that pin a WORDING or a reading SENTENCE you changed without naming a card id (text.ts, language.ts, named-gaps-907.ts, play-order-mono-930.ts, keywords.ts, wordings.ts): grep scripts/verify for the printed phrase and the describer sentence you change, and run those suites too. wordings.ts needs keywords.ts first, in one process: npx tsx -e '(async()=>{await import("./scripts/verify/keywords.ts");await import("./scripts/verify/wordings.ts");console.log("ok")})().catch(e=>{console.error(e);process.exit(1)})' (from your worktree root).
- In a suite, never overwrite a shared harness card (DEFS.WALL, DEFS.KILLER …): suites run in one process at integration, so give your own cards their own ids.
- npx tsx scripts/verify/${L.suite}.ts on its own
- each older suite in scripts/verify that names a card id whose reading you changed, on its own (grep scripts/verify for the ids); also npx tsx scripts/verify/rulings.ts. A suite that cannot run alone is left to integration — say so.
- The corpus diff: npm run arena:compile-snapshot -- --snapshot ${A.snapshot} --out <scratch>/after.json --against ${A.baseline} --diff <scratch>/diff.md (about a minute). No skill may go read→unread unless you meant it (list those in madeUnread with the reason). Review EVERY changed reading in diff.md against its printed text; a change you did not intend is a bug in your change.
Never run: npm test, npm run checks (any mode), scripts/verify-arena.ts whole, contract:emit, npm run build, any db:*/sync:*/arena:diff/arena:fuzz (dbs) script, or anything touching the database or a paid API. Keep scratch files outside the repo (e.g. mktemp -d) and never commit scripts/_tmp-* files.

COMMITS: commit per family or a few families at a time, each commit self-consistent (glossary with the code). End every commit message with exactly these two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011ddszuEXqJGGmKrWJJ9SXv
No model names anywhere in commits or code. Push to origin ${L.branch} after each commit (git push -u origin ${L.branch}; retry on network failure). Do NOT open a pull request and never merge anything: the integration PR carries your branch. Leave the worktree clean.`

const FIX = (L) => `${COMMON(L)}

SCOPE AND STOPPING: ${L.focus}
Work families largest first and stop at a clean, pushed commit once you have fixed about ${L.target} findings or your context is getting heavy — whichever comes first. Everything you did not reach goes in left (id + "not reached" or the real reason). Quality over count: every changed reading must be exactly right.

Return the structured report (branch, the full 40-char head sha you pushed, families, fixed/alreadyFixed/madeUnread/left/rejected ids, pendingRulings, corpus diff counts, checks run with results, files touched, integration notes).`

const REVIEW = (L, fix) => `${COMMON(L)}

YOUR ROLE: adversarial reviewer and repairer of the fix agent's work on ${L.branch} (head ${fix && fix.head}). The fix agent reported:
${JSON.stringify(fix && { families: fix.families, fixed: (fix.fixed || []).length, alreadyFixed: fix.alreadyFixed, madeUnread: fix.madeUnread, rejected: fix.rejected, pendingRulings: fix.pendingRulings, corpus: fix.corpus, integrationNotes: fix.integrationNotes }).slice(0, 12000)}

1. Check out ${L.branch} at its pushed head (the setup line does this). Run the corpus diff against the baseline (command above) and read diff.md in full.
2. For EVERY changed reading (and every skill that went read→unread or unread→read), compare it word by word with the printed text: side (yours/opponent's), area, count and "up to", may vs must, durations, conditions and their scope, which card a pronoun binds to, triggers and their origin/cause qualifiers. Assume the fix agent made mistakes and try to find them; an over-broad regex that changed unrelated cards is the usual one.
3. Read the code diff (git diff origin/${A.integration}...HEAD) for over-broad patterns, card-id special cases in the compiler, missing glossary updates, rulings cited but not in the ledger, and suite assertions that only restate the implementation.
4. Repair what you find on the same branch (or make the clause unread when the right reading is out of reach), re-run the checks for what you touched, commit and push. Also spot-check 15 of the fix agent's "alreadyFixed" and "rejected" ids against the printed text.
5. Pending rulings: confirm each is genuinely undecided by the sources (search the Q&A and the rule manual once more); if a source decides it, change the entry to the sourced basis/confidence and say so.

Return: the head sha you pushed (full 40 chars; the fix head if you changed nothing), how many changed readings you reviewed, each correction (id, problem, fix), remaining doubts, code issues, pending rulings you added or changed, the final corpus diff counts, and the checks you ran.`

const results = await pipeline(
  LANES,
  (L) => agent(FIX(L), { label: `fix:${L.key}`, phase: 'Fix', schema: FIX_SCHEMA, isolation: 'worktree' }),
  (fix, L) => fix ? agent(REVIEW(L, fix), { label: `review:${L.key}`, phase: 'Review', schema: REVIEW_SCHEMA, isolation: 'worktree' }).then((review) => ({ lane: L.key, fix, review })) : { lane: L.key, fix: null, review: null },
)
return results

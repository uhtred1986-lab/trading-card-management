# Durable paired evaluation

Historical holdout commands below apply only to their pinned v2 source checkout. The current frontier-development runner refuses consumed holdouts and requires checkpoint formatv2 telemetry; use the commands in `arena-frontier-cache-development.md` for new development runs. Old v1 receipts are preserved without migration.

The paired search evaluator now saves every completed game attempt before printing its completion line. Holdout runs require an explicit checkpoint; development runs can opt in. No policy, engine, sample prior, frozen seeds or strength threshold changes are part of this runner change.

Start the coordinator-reviewed frozen run with:

```sh
npx tsx scripts/arena-search-eval.mts --seed-set holdout --allow-holdout --seeds 40 --depth 2 --max-moves 3000 --checkpoint /tmp/search826-checkpoint.json --out /tmp/search826-holdout.json --manifest /tmp/search826-holdout-manifest.json
```

After a process/environment interruption, keep all evaluation arguments and replace `--checkpoint` with `--resume`:

```sh
npx tsx scripts/arena-search-eval.mts --seed-set holdout --allow-holdout --seeds 40 --depth 2 --max-moves 3000 --resume /tmp/search826-checkpoint.json --out /tmp/search826-holdout.json --manifest /tmp/search826-holdout-manifest.json
```

The checkpoint and declared report/manifest paths must be outside **all registered repository checkouts**, including ignored paths and symlinked parents. This prevents journal writes from changing the tested dirty-tree digest. Each checkpoint has a stable request UUID, exact full Git/dirty-tree source pin, policy and fixture/deck/rules hashes, complete protocol/configuration, ordered seed/seat schedule and initial policy RNGs. Resume refuses changed source, protocol, budget, depth, fixtures, policies, seed schedule or RNG provenance. Do not commit or edit source during the run. Use one evaluator process per checkpoint.

An initial empty checkpoint is written before the first game. After each completed attempt, the evaluator verifies source again, writes a temporary file, fsyncs it, atomically renames it over the checkpoint, and fsyncs the containing directory on POSIX. A process killed during a write leaves either the previous or next complete checkpoint; abandoned temporary files are ignored. This durability path is tested in the Linux execution environment. Linux open/fsync/close failures propagate and stop the evaluator.

Windows retains mandatory temporary-file fsync and rename, but skips parent-directory fsync: Node/libuv uses `FlushFileBuffers`, which cannot flush the read-only directory handle used for the POSIX operation. Therefore this implementation does not claim the same metadata durability against power loss on Windows. File fsync, rename and other genuine IO errors still propagate. Mode0600 restricts owner/group access on POSIX; Windows Node modes only manipulate the read-only/write flag and do **not** establish private NTFS ACLs. On Windows, choose a user-private directory with suitable inherited ACLs, such as the user's normal `%TEMP%`, rather than a shared directory. No Windows ACL audit is performed by this helper.

Resume validates the content digest, completed-prefix order, unique seed/seat identities, outcome consistency and per-game safety counters. It skips saved attempts, restores counters by summing their contributions and continues the next job. Only an in-flight unsaved game is restarted, using the same frozen game/policy seeds. Illegal, limited and execution-error attempts remain saved rows and keep their effect on safety/completion gates. A completed resume executes zero games and emits the same request ID and manifest content, so a repeated portal import is idempotent.

The private checkpoint retains local diagnostics and timings and is **not an import manifest**. It can grow during a 320-game run; keep it private and do not commit it. The final strict manifest remains the small allowlisted evidence projection. Existing checkpoints are never silently overwritten by a new run. Corruption, pin mismatch or an invalid prefix is a hard refusal.

`npx tsx scripts/verify/arena-search-checkpoint.mts` kills the actual evaluator after one of eight synthetic attempts, resumes to eight unique results without replacing the prefix, and resumes the complete run without executing more games. It also proves stable request ID/manifest content/counters and per-window/cache telemetry conservation, failed-attempt preservation, ten pin mismatches, corruption detection, malformed outcomes, ordering/duplicate refusal, mode0600 on POSIX and checkout/link rejection. The link test uses a directory junction on Windows to avoid requiring symlink privileges. An injected-IO proof exercises the Windows directory-sync branch and verifies that genuine Linux open/fsync/close errors propagate. The focused test was executed on Linux; these branch checks are not a claim of a native Windows run. No paid calls or database writes are involved.

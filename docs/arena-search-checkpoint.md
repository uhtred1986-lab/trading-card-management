# Durable paired evaluation

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

An initial empty checkpoint is written before the first game. After each completed attempt, the evaluator verifies source again, writes an owner-only temporary file, fsyncs it, atomically renames it over the checkpoint, and fsyncs the containing directory. A process killed during a write leaves either the previous or next complete checkpoint; abandoned temporary files are ignored. This durability path is tested in the Linux execution environment.

Resume validates the content digest, completed-prefix order, unique seed/seat identities, outcome consistency and per-game safety counters. It skips saved attempts, restores counters by summing their contributions and continues the next job. Only an in-flight unsaved game is restarted, using the same frozen game/policy seeds. Illegal, limited and execution-error attempts remain saved rows and keep their effect on safety/completion gates. A completed resume executes zero games and emits the same request ID and manifest content, so a repeated portal import is idempotent.

The private checkpoint retains local diagnostics and timings and is **not an import manifest**. It can grow during a 320-game run; keep it private and do not commit it. The final strict manifest remains the small allowlisted evidence projection. Existing checkpoints are never silently overwritten by a new run. Corruption, pin mismatch or an invalid prefix is a hard refusal.

`npx tsx scripts/verify/arena-search-checkpoint.mts` kills the actual evaluator after one of eight synthetic attempts, resumes to eight unique results without replacing the prefix, and resumes the complete run without executing more games. It also proves stable request ID/manifest content/counters, failed-attempt preservation, nine pin mismatches, corruption detection, malformed outcomes, ordering/duplicate refusal, mode 0600 and checkout/symlink rejection. No paid calls or database writes are involved.

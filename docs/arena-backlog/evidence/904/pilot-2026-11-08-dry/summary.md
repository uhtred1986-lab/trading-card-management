# Claude API pilot (#904), 2026-11-08 — DRY RUN

- Commit: `b7cd1a6`; model `claude-opus-5-5`; seeds 70000000+ / policy 570000000+; 1 deal per pairing, both seats.
- Opponent: the local heuristic (`localPolicy()`) of that commit.
- Prices: not used (fake provider).

## Games

- A-A:70000000:p1: completed (local); 114 moves, 43 Claude decisions, 43 calls, $1.1181 charged, $0.0000 billed
- A-A:70000000:p2: completed (local); 117 moves, 50 Claude decisions, 50 calls, $1.3058 charged, $0.0000 billed
- A-B:70000100:p1: completed (local); 98 moves, 35 Claude decisions, 35 calls, $0.9225 charged, $0.0000 billed
- A-B:70000100:p2: completed (local); 75 moves, 25 Claude decisions, 25 calls, $0.5201 charged, $0.0000 billed
- B-B:70003200:p1: completed (local); 115 moves, 28 Claude decisions, 28 calls, $0.5952 charged, $0.0000 billed
- B-B:70003200:p2: completed (local); 104 moves, 33 Claude decisions, 33 calls, $0.7081 charged, $0.0000 billed

Ledger: $5.1699 committed ($0.0000 billed) of $100.0000; 6 games of 40; 0 in flight, 0 ambiguous

`manifest.json` is the allowlisted public record. `private-evidence.json` (git-ignored) holds the raw answers;
replay it with `npx tsx scripts/arena-claude-duel.mts --replay <file>`.

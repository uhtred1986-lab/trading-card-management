# Native Z-Awaken placement — 5 Nov 2026

Intermediate checkpoint in PR #1249, source head `65764ab4`. Complete card support remains in progress.

R-395 follows RM 22-46 and the general Z-Awaken FAQ: Main/Battle activation, once per player per global turn, from a face-down Z-Deck card onto the specified awakened non-Z Leader. The printed description matches current characteristics. Complete payment precedes consuming the use and placement. Restoring the old Leader does not restore that turn's use.

The existing placement operation preserves mode, power effects and battle role and emits Leader placement rather than ordinary played events, with no Counter:Play window. Saved continuations bind source and Leader occurrences; old unbound procedures explicitly interrupt. A failed arrival removes only the original source still in Z-Deck. Tests that alter a post-payment continuation are explicitly staged faults; no response window is invented.

EX23-28 now accepts “among all the cards in,” counting at least six Shadow Dragon cards across the player's Drop and Warp. Placement narration no longer unconditionally claims “from under it,” because the operation also serves Z-Deck arrivals.

Combined verification before the environment interruption passed **390 counted scenarios**: Z-Awaken 60, shared Counter 94, protection 52, invocation 82 and named Awaken gates 102. Z-Extra placement, language/lang/Teach, rulings (201, zero pending), typecheck, changed-file lint, ruleset generation/check and capability inventory passed. Generated rules changed only attributes and keywords; shared Counter operations stayed intact. Fixture fuzz completed **40/40**, zero crashes, interruptions or action limits. Worker compatibility included existing keywords/wordings, Z-Energy/combo, selectors, conditions, prohibitions and previous Awaken checks. Fusion fuzz is regression coverage, not exhaustive card support.

Exactly **seven full records** differ: EX23-28#10 changes only payment readability/condition; BT20-058#10, BT20-059#30, BT21-072#20, BT22-001#20b, BT21-071#30 and BT20-057#20 change only narration. All other fields remain unchanged. BT21-072 still has unread life-zero/replacement clauses and its existing token-exclusion error is separately tracked. [Full changed-field evidence](support-tenth-program-diff.json).

Totals remain **12,980 readable / 984 unread**; additional readable-record runtime gaps fall to **35**, broader additional reasons to 351; contextual unknowns remain 2,559. The original full output SHA-256 is `ddd8fb994a161a97432e1a99e8005f89b48a9db7e5a257a78ac4f1b235789543`.

The restart removed `/tmp` artifacts. On recovery, the public catalog was fetched again into `/workspace/shared/arena-support5/recovery/catalog.json` (6,597 cards; serialized input SHA-256 `d3646487f34749d905a65b2473f21aee7984e4aac640c631bc0deb319e512bfb`). Both pre-change and current compilers were rerun on that same recovered input. The current full output reproduces the original SHA-256 exactly, and the seven-record delta is independently checked again. Earlier tests were not rerun on unchanged code solely because their temporary logs were lost.

Eight Z-Awaken action-price records remain, including costs competing for Z-Energy. Turles replacement timing/fallback and other shared-runtime gaps continue. No production refresh, database change, deployment or merge occurred; the full integration gate remains for the complete combined deliverable.

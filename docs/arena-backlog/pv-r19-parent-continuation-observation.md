# #683 nested Extra parent continuation: observed engine divergence

The standalone `scripts/verify/villainous-683-parent-continuation.ts` uses a legally offered synthetic Wish-like Leader skill whose selected branch is compiler-read as `invokeSkill` followed by `draw 2`. It activates a zero-cost ≪Desire≫ Extra's `[Activate: Main]` skill (`draw 1`) while another in-play card has `[Villainous]`. No pending hook or trigger is forged. The test JSON-round-trips both the parent's mode prompt and the opponent's later Villainous choice, then asserts the exact draw counts, one nested skill activation, one opponent discard and one indexed Villainous spend.

The engines disagree at the opponent-choice prompt. The rules engine has drawn all three cards: one from the child Extra effect and two from the parent's continuation. Its individually identified Villainous frame is saved at the choice prompt. The legacy engine has drawn only the child's one card and still has the parent's script step queued. Once the opponent chooses and the game resumes, it draws the parent's two cards. Both ultimately draw three, discard one and spend Villainous once. The proof asserts the **observed divergence**, not shared support or a preferred gameplay rule. It should not be registered as #683 acceptance until the checkpoint order is settled.

Manual v4.00 §9-6-2 says a fulfilled `[Auto]` trigger “is made pending”; §9-6-3 says that pending skill activates “When a checkpoint occurs.” §4-2-1 defines checkpoints as the moments when Autos are declared/resolved, while §4-3-1/3 defines counter timing as rule processing and `[Counter]` declarations, without saying pending Autos resolve there. For a nested Extra, §12-2-4-7 performs its effect, §12-2-4-8 gives counter timing, and §12-2-4-9 says “Go back to resolving the effect that activates an Extra Card.” Those steps point toward resuming the parent before an Auto checkpoint unless another rule inserts one there. This note does not establish whether such a checkpoint occurs; the owner/coordinator should settle it before changing either runtime. The already registered `duration-shuffle-574.ts` proves a child skill event precedes the parent's draws but has no Villainous watcher, so it does not cover this ordering dispute.

Focused command, with dependencies from the existing lockfile:

```bash
NODE_PATH=/workspace/trading-card-management/node_modules /workspace/trading-card-management/node_modules/.bin/tsx scripts/verify/villainous-683-parent-continuation.ts
```

/**
 * #1122 (owner ruling, 20 Oct 2026): "cards in Rest Mode" with no "Battle Cards"
 * counts every one of that player's cards in Rest Mode - rested Energy Area
 * cards included (the literal reading; Rule Manual 5-3-1 pays energy by
 * switching it to Rest Mode). When Bandai means only the Battle Area they write
 * "Battle Cards" (BT3-097's Q&A), and that wording keeps reading the Battle
 * Area alone.
 *
 * Compiler half: the selector spans Leader, Battle, Unison and Energy for the
 * bare wording and stays `battle` for "Battle Cards". Board half: SD8-08's real
 * text on a board with rested Battle Cards and rested energy.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFS, card, compileSkill, findG, parseSkills, playCostG, stagedG, zoneOf } from "./harness";
import type { EngineState } from "./harness";

type Sel = { side?: string; area?: string; areas?: string[]; mode?: string };
const countOf = (text: string): { sel: Sel; atLeast?: number } => {
  const s = compileSkill(parseSkills(text)[0]);
  assert.deepEqual(s.unsupported, [], text);
  const found: { sel: Sel; atLeast?: number }[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      if (r.kind === "count" && r.sel) found.push(r as unknown as { sel: Sel; atLeast?: number });
      Object.values(r).forEach(walk);
    }
  };
  walk(s);
  assert.ok(found.length >= 1, `a count in: ${text}`);
  return found[0];
};

const SPAN = ["leader", "battle", "unison", "energy"];
const SD8_08 = "[Permanent] If your opponent has 4 or more cards in Rest Mode, reduce the energy cost of this card in your hand by 3.";

// ── the compiler ────────────────────────────────────────────────────────────
{
  const bare = countOf(SD8_08);
  assert.deepEqual([bare.sel.side, bare.sel.mode, bare.atLeast], ["opponent", "rest", 4]);
  assert.deepEqual(bare.sel.areas, SPAN, "the Energy Area counts (owner ruling 20 Oct 2026)");

  // Mine, not the opponent's (the wording EX06-27 prints).
  const mine = countOf("[Permanent] If you have 6 or more cards in Rest Mode, reduce the energy cost of this card in your hand by 3.");
  assert.deepEqual([mine.sel.side, mine.sel.areas], ["you", SPAN]);

  // "Battle Cards in Rest Mode" and a printed place keep the Battle Area alone.
  for (const text of [
    "[Permanent] If your opponent has 4 or more Battle Cards in Rest Mode, reduce the energy cost of this card in your hand by 3.",
    "[Permanent] If your opponent has 4 or more Battle Cards in play in Rest Mode, reduce the energy cost of this card in your hand by 3.",
  ]) {
    const c = countOf(text);
    assert.equal(c.sel.areas, undefined, text);
    assert.equal(c.sel.area, "battle", text);
    assert.equal(c.sel.mode, "rest", text);
  }
}

// ── the board: SD8-08's real text ───────────────────────────────────────────
{
  DEFS.C1122SD808 = card("C1122SD808", { colors: ["Red"], energyCost: 5, skill: SD8_08 });
  DEFS.C1122BATTLE = card("C1122BATTLE", { colors: ["Red"], energyCost: 5, skill: "[Permanent] If your opponent has 2 or more Battle Cards in Rest Mode, reduce the energy cost of this card in your hand by 3." });
  DEFS.C1122OPPB = card("C1122OPPB", { colors: ["Blue"] });
  DEFS.C1122OPPE = card("C1122OPPE", { colors: ["Blue"] });

  const rest = (s: EngineState, ids: string[]): void => {
    for (const id of ids) s.cards[id].mode = "rest";
  };
  const board = (battleRested: number, energyRested: number) => {
    const s = stagedG({ hand: ["C1122SD808", "C1122BATTLE"], oppBattle: ["C1122OPPB", "C1122OPPB", "C1122OPPB"], oppEnergy: ["C1122OPPE", "C1122OPPE", "C1122OPPE"] });
    const mineB = zoneOf(s, "p2", "battle").filter((id) => s.cards[id].cardId === "C1122OPPB");
    const mineE = zoneOf(s, "p2", "energy").filter((id) => s.cards[id].cardId === "C1122OPPE");
    rest(s, mineB.slice(0, battleRested));
    rest(s, mineE.slice(0, energyRested));
    return { sd: playCostG(s, findG(s, "p1", "hand", "C1122SD808")).total, bc: playCostG(s, findG(s, "p1", "hand", "C1122BATTLE")).total };
  };

  assert.deepEqual(board(0, 0), { sd: 5, bc: 5 }, "nothing rested");
  assert.deepEqual(board(2, 2), { sd: 2, bc: 2 }, "2 rested Battle Cards and 2 rested energy: 4 cards in Rest Mode, so the cost drops by 3; the Battle Cards wording sees its 2");
  assert.deepEqual(board(1, 2), { sd: 5, bc: 5 }, "3 rested in total: not reduced; 1 Battle Card is under the Battle Cards wording's 2");
  assert.deepEqual(board(0, 3), { sd: 5, bc: 5 }, "3 rested energy alone: not reduced");
  assert.deepEqual(board(2, 1), { sd: 5, bc: 2 }, "3 rested in total: SD8-08 is not reduced, while the Battle Cards wording counts its 2 and is");
}

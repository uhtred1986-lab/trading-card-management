/**
 * The play-test sandbox (Rules PR 5): a staged board played in memory against
 * the local AI policy, with the builder's unsaved rule installed.
 *
 * Pure — no database, no network: a synthetic card (`sandbox/fixture.ts`)
 * staged by the probe, the rule override, the local policy stepping the
 * opponent, and a replay of the human's moves against an edited rule.
 */
import assert from "node:assert/strict";
import { parseRule, type Rule } from "../../src/lib/arena/lang";
import { probeRuleOf } from "../../src/lib/arena/tryit";
import { scenariosFor } from "../../src/lib/arena/probe";
import { FIXTURE_SOURCE, fixtureCard, fixtureRule, ruleFromSource } from "../../src/lib/arena/sandbox/fixture";
import { sandboxSeed } from "../../src/lib/arena/sandbox/seed";
import { createSandboxSession, replayMoves, type SandboxSession } from "../../src/lib/arena/sandbox/session";
import type { Action } from "../../src/lib/arena/types";

let lastCard = "";
const seedFor = (name: string, rule: Rule, board?: string) => {
  const def = fixtureCard(name);
  const probeRule = probeRuleOf(rule, def, "front", 0);
  const made = sandboxSeed(probeRule, board ?? scenariosFor(probeRule)[0].key);
  assert.equal(made.error, null);
  lastCard = made.seed!.card;
  return made.seed!;
};

const actAs = async (s: SandboxSession, pick: (a: Action) => boolean, what: string) => {
  const snap = s.getSnapshot();
  const menu = snap.legal;
  const hit = (menu as { action: Action }[]).find((m) => pick(m.action));
  assert.ok(hit, `${what} is on the menu`);
  const res = await s.act(hit.action, snap.game.revision, `t:${snap.game.revision}`);
  assert.equal(res.error, null, what);
  await s.advance();
};

// 1. The override changes what the card does: "draw 1" vs the edited "draw 3".
const draw1 = fixtureRule("draw");
const draw3: Rule = ruleFromSource(FIXTURE_SOURCE.draw.replace("n: 1", "n: 3"));
const drawn = async (rule: Rule) => {
  const s = createSandboxSession(seedFor("draw", rule));
  await s.advance();
  // The attack board: the card (or a stand-in) attacks the opponent's Leader.
  await actAs(s, (a) => a.type === "attack" && a.attacker === lastCard, "the card attacking");
  return s.journal().filter((e) => e.actor === "p1").flatMap((e) => e.lines);
};
const lines1 = await drawn(draw1);
const lines3 = await drawn(draw3);
assert.ok(lines1.length > 0, "the attack is narrated");
assert.notDeepEqual(lines1, lines3, "the edited rule plays differently from the saved one");
const draws = (lines: string[]) => lines.filter((l) => /^You draw /.test(l)).length;
assert.equal(draws(lines1), 1, `the saved rule draws one: ${lines1.join(" | ")}`);
assert.equal(draws(lines3), 3, `the edit draws three: ${lines3.join(" | ")}`);

// 2. The opponent is the local AI policy: it answers on its own, a move at a time, and stops with a reason or hands back.
{
  const s = createSandboxSession(seedFor("draw", draw1));
  const before = s.journal().length;
  await s.advance();
  await actAs(s, (a) => a.type === "endMain", "ending the Main Phase");
  const theirs = s.journal().slice(before).filter((e) => e.actor === "p2");
  assert.ok(theirs.length > 0, "the local AI took moves of its own");
  assert.ok(s.waitingForYou() || s.interruption() !== null || s.getSnapshot().view.over, "it hands the turn back, stops with a reason, or the game is over");
  // Nothing from the policy reaches the human's journal as a typed move.
  assert.ok(theirs.every((e) => e.action === null));
}

// 3. A stale or illegal move is refused, and nothing changes.
{
  const s = createSandboxSession(seedFor("draw", draw1));
  await s.advance();
  const rev = s.getSnapshot().game.revision;
  const bad = await s.act({ type: "endMain", player: "p2" } as Action, rev, "x1");
  assert.ok(bad.error);
  const stale = await s.act({ type: "endMain", player: "p1" } as Action, rev + 5, "x2");
  assert.ok(stale.error);
  assert.equal(s.getSnapshot().game.revision, rev);
}

// 4. Replay: my moves are re-applied under the edit, and the first one the edit makes illegal stops it.
{
  const ko = fixtureRule("ko");
  const played = createSandboxSession(seedFor("ko", ko));
  await played.advance();
  await actAs(played, (a) => a.type === "activate", "activating the card");
  const mine = played.journal().filter((e) => e.actor === "p1");
  assert.equal(mine.length, 1);

  // Same rule: nothing diverges.
  const same = await replayMoves(seedFor("ko", ko), mine);
  assert.equal(same.stop, null);
  assert.equal(same.played, 1);

  // The edit now costs more than the board has energy: the activation is off the menu.
  const dear: Rule = ruleFromSource(FIXTURE_SOURCE.ko.replace("THEN", `COST ${"{any}".repeat(20)}\nTHEN`));
  const diverged = await replayMoves(seedFor("ko", dear), mine);
  assert.ok(diverged.stop, "the replay reports where it diverged");
  assert.equal(diverged.stop.move, 1);
  assert.match(diverged.stop.message, /no longer available with your edit/);
  assert.equal(diverged.played, 0);
}

// 5. A draft that is not a rule is the server action's refusal, not a crash here: the language rejects it first.
assert.equal(parseRule("nonsense").ok, false);

console.log("rules-sandbox: ok");

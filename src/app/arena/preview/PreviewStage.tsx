"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArenaStage } from "@/components/arena/stage/ArenaStage";
import { GameOver } from "@/components/arena/GameOver";
import type { Beat, NumberedBeat } from "@/lib/arena/beats";
import { setPacePref, type Pace } from "@/lib/arena/pace";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";
import type { AdminDebug } from "@/lib/arena/admin-debug";

/**
 * The real board with its two server actions stubbed. A tap goes nowhere: it
 * is answered with no error and no change, so a screenshot shows the state the
 * fixture describes and the opened sheets, never a server round trip.
 */
const STUB = {
  // What the board sent, kept where a scripted drive can read it: a drag that
  // plays a card sends one `play`, and a refused one sends nothing (rd-03).
  act: async (_gameId: number, action: unknown) => {
    const w = window as unknown as { __arenaSent?: unknown[] };
    (w.__arenaSent ??= []).push(action);
    return { error: null };
  },
  advance: async () => ({ error: null }),
  // Flagging, answered without a database: the flag the drawer would get back.
  flag: async (gameId: number, note: string | null) => ({ error: null, created: true, flag: { id: 1, gameId, turn: 4, beatIndex: 0, note, flaggedBy: null, reviewerNote: null, resolved: false } }),
  // The end screen's Rematch: answered, never redirected — there is no game to start.
  rematch: async () => ({ error: null }),
};

/**
 * `?fx=defend` (preview only): the `attack` fixture turned round, so the
 * takeover can be shot the way frame 07 draws it — Claude's Battle Card
 * attacking your leader, five cards in your hand that could combo, and one
 * combo already added. Every fixture is one of your attacks; this is the only
 * way to see the other side of a fight without a database.
 */
function defendView(snap: Snapshot): Snapshot {
  const v = snap.view;
  const atk = v.them.battle[0] ?? v.them.leader;
  const guard = v.you.leader;
  if (!atk || !guard) return snap;
  const card = (n: number, name: string, power: number, combo: number) => ({ ...atk, id: `${v.you.player}#9${n}`, cardId: `C-${n}`, name, power, comboPower: combo, comboCost: 1, mode: "active" as const });
  const hand = [card(1, "Nova Lancer", 20000, 5000), card(2, "Azure Sage", 12000, 10000), card(3, "Comet Dancer", 8000, 10000), card(4, "Storm Striker", 15000, 5000)];
  const picked = card(5, "Ember Vanguard", 10000, 5000);
  const attacker = { ...atk, mode: "rest" as const, power: 20000 };
  return {
    ...snap,
    view: {
      ...v,
      turnPlayer: v.them.player,
      prompt: { ...v.prompt, kind: "combo", player: v.you.player, question: "Combo? Tap a glowing card.", hint: "Each adds its combo power and costs its combo cost." },
      battle: { attacker: attacker.id, guard: guard.id, step: "defense", attackPower: 20000, guardPower: 20000, contributions: { [attacker.id]: 20000, [guard.id]: 15000, [picked.id]: 5000 } },
      them: { ...v.them, battle: v.them.battle.map((c) => (c.id === attacker.id ? attacker : c)) },
      you: { ...v.you, hand, handCount: hand.length, combo: [picked] },
    },
    taps: { ...snap.taps, byCard: Object.fromEntries(hand.map((c) => [c.id, [0]])) },
  };
}

/**
 * `?fx=` (preview only, rd-07): play one effect on the fixture's board. A fixture
 * is a moment, so its beats have already been seen; this mounts the board
 * without them and then delivers them, the way a server response does, so the
 * beat player walks them. Pair it with `?pace=step` to hold on the beat.
 *
 *   reveal | ko           the fixture's own beats (`play`, `ko`)
 *   damage | damage-you   a hit on the opponent's / your leader (1 life)
 *   clash-hit | clash-ko | clash-held   a verdict on the open battle (`attack`)
 *   attack                the staged fight arriving (`attack`): cards in from the corners, VS
 *   over                  the end screen on the board (`over`), and the result card under it
 *   victory               the same, won by you (frame 10)
 *   defend                the `attack` fixture turned round (`defendView`)
 *   finish                the clash and the damage that end the game, then the end screen
 */
function fxBeats(fx: string, snap: Snapshot): NonNullable<Snapshot["beats"]> {
  const own = snap.beats?.list ?? [];
  const art = snap.beats?.art ?? {};
  const number = (list: Beat[]): NumberedBeat[] => list.map((b, i) => ({ ...b, n: i + 1 }) as NumberedBeat);
  let list: NumberedBeat[] = own;
  if (fx === "reveal") list = own.filter((b) => b.t === "move");
  else if (fx === "damage" || fx === "damage-you") list = number([{ t: "damage", player: fx === "damage" ? snap.view.them.player : snap.view.you.player, amount: 1, critical: false, cards: [] }]);
  else if (fx.startsWith("clash")) {
    const attacker = snap.view.battle?.attacker ?? "";
    // A K.O. needs a guard that is not a leader; the verdict's word follows it.
    const guard = fx === "clash-ko" ? (snap.view.them.battle[0]?.id ?? snap.view.battle?.guard ?? "") : (snap.view.battle?.guard ?? "");
    list = number([{ t: "clash", attacker, guard, attackPower: 25000, guardPower: fx === "clash-held" ? 30000 : 10000, hit: fx !== "clash-held" }]);
  }
  return { seq: list.length, list, art };
}

/** The game page's menu links as the preview draws them: inert, since no game is behind them. */
const PREVIEW_MENU = (
  <div className="flex flex-wrap items-center gap-x-5 text-sm text-space-400">
    <Link href="/arena" className="tap inline-flex items-center text-space-300 hover:text-ki-300">
      ← Arena
    </Link>
    <span className="tap inline-flex items-center">how Claude played</span>
    <span className="tap inline-flex items-center">give up</span>
  </div>
);

/** What the drawer shows beyond the snapshot, made up for the preview: no database is behind it. */
const PREVIEW_DEBUG: AdminDebug = {
  flags: [],
  seed: 20260930,
  theirHand: ["Ember Vanguard", "Iron Guardian", "Comet Dancer", "Azure Sage"],
  decisions: [
    { seq: 1, turn: 2, player: "p2", promptKind: "charge", decidedBy: "rule", chosenLabel: "Charge Ember Vanguard", how: "lowest-power card; keeps 2+ in hand", say: null, menu: null, chosenIndex: null },
    {
      seq: 2,
      turn: 2,
      player: "p2",
      promptKind: "main",
      decidedBy: "claude",
      chosenLabel: "Play Nova Lancer (cost 3)",
      how: "highest cost it can afford",
      say: "Time to press the attack.",
      menu: ["Play Nova Lancer (cost 3)", "Play Iron Guardian (cost 2)", "End turn"],
      chosenIndex: 0,
    },
  ],
};

export function PreviewStage({
  snapshot: fixture,
  skin,
  staging,
  pace,
  announceTurn,
  fx,
  admin,
  referee,
}: {
  snapshot: Snapshot;
  skin: ArenaSkin;
  staging: ArenaStaging;
  pace: Pace | null;
  announceTurn: boolean;
  fx: string | null;
  admin: boolean;
  referee: boolean;
}) {
  // `?referee=1`: one of your Battle Cards is one the referee rules on, so the badge can be seen.
  const snapshot = useMemo(() => (referee && fixture.view.you.battle[0] ? { ...fixture, view: { ...fixture.view, you: { ...fixture.view.you, battle: fixture.view.you.battle.map((c, i) => (i === 0 ? { ...c, referee: true } : c)) } } } : fixture), [fixture, referee]);
  useEffect(() => {
    if (pace) setPacePref(pace);
  }, [pace]);
  // `attack` opens on the board before the fight, so the staged fight's entrance plays.
  const [shown, setShown] = useState<Snapshot>(() =>
    fx === "defend"
      ? defendView(snapshot)
      : fx === "victory"
        ? // `?fx=victory`: the `over` fixture won by you, as frame 10 draws it.
          { ...snapshot, view: { ...snapshot.view, turn: 5, over: { winner: snapshot.view.you.player, reason: `${snapshot.view.them.name} has no life left` } } }
      : fx && fx !== "over"
        ? { ...snapshot, view: fx === "attack" ? { ...snapshot.view, battle: null } : fx === "finish" ? { ...snapshot.view, them: { ...snapshot.view.them, life: 1 } } : snapshot.view, beats: { seq: 0, list: [], art: snapshot.beats?.art ?? {} } }
        : snapshot,
  );
  // `?fx=finish`: the attack lands on the leader's last life, then the game ends —
  // the clash over the open fight, then the damage and the end screen on the board.
  useEffect(() => {
    if (fx !== "finish") return;
    const v = snapshot.view;
    const b = v.battle;
    if (!b) return;
    const art = snapshot.beats?.art ?? {};
    const clash = { t: "clash", attacker: b.attacker, guard: b.guard, attackPower: b.attackPower, guardPower: b.guardPower, hit: true, n: 1 } as NumberedBeat;
    const damage = { t: "damage", player: v.them.player, amount: 1, critical: false, cards: [], n: 2 } as NumberedBeat;
    const t1 = setTimeout(() => setShown((s) => ({ ...s, beats: { seq: 1, list: [clash], art } })), 1200);
    const t2 = setTimeout(
      () =>
        setShown((s) => ({
          ...s,
          game: { ...s.game, status: "over" },
          over: { winner: v.you.player, reason: `${v.them.name} has no life left` },
          view: { ...s.view, battle: null, them: { ...s.view.them, life: 0 }, over: { winner: v.you.player, reason: `${v.them.name} has no life left` } },
          beats: { seq: 2, list: [clash, damage], art },
        })),
      4200,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fx, snapshot]);
  useEffect(() => {
    if (!fx || fx === "over" || fx === "victory" || fx === "defend" || fx === "finish") return;
    const beats = fxBeats(fx, snapshot);
    // The fixture's board is the moment *before* the play; a beat plays over the
    // board *after* it, so the card the reveal brings in is put in its row.
    let view = snapshot.view;
    const played = fx === "reveal" ? beats.list.find((b) => b.t === "move") : null;
    const card = played && played.t === "move" ? view.you.hand?.find((c) => c.id === played.card) : null;
    if (card) view = { ...view, you: { ...view.you, hand: (view.you.hand ?? []).filter((c) => c.id !== card.id), battle: [...view.you.battle, card] } };
    const t = setTimeout(() => setShown({ ...snapshot, view, beats }), 500);
    return () => clearTimeout(t);
  }, [fx, snapshot]);
  return (
    <>
      <ArenaStage gameId={snapshot.game.id} snapshot={shown} skin={skin} staging={staging} server={STUB} announceTurn={announceTurn} admin={admin} adminDebug={admin ? PREVIEW_DEBUG : null} menu={PREVIEW_MENU} />
      {fx === "over" && (
        <div className="mx-auto mt-3 max-w-xl px-2">
          <GameOver
            gameId={snapshot.game.id}
            winnerName="Red Leader"
            draw={false}
            reason="Claude's leader falls on turn 5."
            turns={5}
            damage={{ you: 3, them: 8 }}
            spend={{ calls: 0, input: 0, output: 0, cached: 0, micros: 0 }}
            review={null}
            aiEnabled={false}
            deckId={null}
            versus={false}
            draftFired={{ count: 0, names: [] }}
            cards={[]}
          />
        </div>
      )}
    </>
  );
}

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
};

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
 *   over                  the end screen's title (`over`)
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
    fx && fx !== "over" ? { ...snapshot, view: fx === "attack" ? { ...snapshot.view, battle: null } : snapshot.view, beats: { seq: 0, list: [], art: snapshot.beats?.art ?? {} } } : snapshot,
  );
  useEffect(() => {
    if (!fx || fx === "over") return;
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

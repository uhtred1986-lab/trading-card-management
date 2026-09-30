import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewScreenData } from "@/components/arena/ReviewScreen";
import type { FlaggedGame, FlagLine } from "@/lib/arena/review-store";
import type { Review, ReviewBeat } from "@/lib/arena/review";
import type { Snapshot } from "@/lib/arena/snapshot";

/**
 * Dev-only sample for `/arena/review?fixture=1` (issue #351): the screen over a
 * made-up game with two flags, so it can be shot in a session that keeps off
 * Neon. The board is the `play` contract fixture's; the moves are written by
 * hand in the shape `replayForReview` returns. Nothing here reads a database.
 */
const at = new Date("2026-09-30T10:00:00Z");
const game = (id: number, p2: string, mode: string, turn: number, status: string, winner: string | null, flags: number): FlaggedGame => ({ id, p1Name: "Player", p2Name: p2, mode, status, winner, turn, p1User: null, p2User: null, flags, open: flags, latest: at });

const GAMES: FlaggedGame[] = [game(930, "Claude", "sparring", 7, "over", "p2", 2), game(929, "Claude", "sparring", 5, "over", "p1", 1), game(928, "Claude", "tournament", 9, "over", "p2", 1)];

const flag = (id: number, gameId: number, turn: number, beatIndex: number, note: string | null): FlagLine => ({ id, gameId, turn, beatIndex, note, flaggedBy: null, reviewerNote: null, resolved: false });

const FLAGS: FlagLine[] = [flag(1, 930, 4, 32, "Claude ignored my rested Storm Striker. Expected a clearer reason."), flag(2, 930, 6, 34, null)];

function beat(index: number, who: string, kind: string, label: string, extra: Partial<ReviewBeat> = {}): ReviewBeat {
  return { index, n: index + 1, turn: 4, player: who === "Player" ? "p1" : "p2", who, kind, label, story: [], cardId: null, cardName: null, offered: [label], chosenIndex: 0, refused: [], decision: null, ...extra };
}

export function fixtureData(q: { turn?: number; beat?: number; all: boolean }): ReviewScreenData {
  const snap = JSON.parse(readFileSync(join(process.cwd(), "contract", "fixtures", "play.json"), "utf8")) as Snapshot;
  const turn = q.turn === 6 ? 6 : 4;
  const beats: ReviewBeat[] = [
    beat(30, "Claude", "charge", "Charge Comet Dancer", { story: ["Claude charges Comet Dancer into the Energy Area"] }),
    beat(31, "Claude", "play", "Play Nova Lancer (cost 3)", { cardId: "BT18-021", cardName: "Nova Lancer", offered: ["Play Nova Lancer (cost 3)", "Play Iron Guardian (cost 2)", "End turn"] }),
    beat(32, "Claude", "attack", "Attack your leader with Void Tactician", {
      turn,
      cardId: "BT18-020",
      cardName: "Void Tactician",
      story: ["Void Tactician attacks your leader"],
      offered: ["Attack your leader with Void Tactician", "Attack Storm Striker (rested) with Void Tactician", "End turn"],
      chosenIndex: 0,
      refused: [{ label: "Play Shadow Drake", why: ["It costs 4 energy and Claude has 3 active. Charge 1 more energy over the coming turns."] }],
      decision: {
        decidedBy: "claude",
        how: "The leader is the win condition. A K.O. on Storm Striker would be a 15,000 tie: legal, but worth less than a life with you at 2.",
        model: "claude-sonnet-4-5",
        say: null,
        inputTokens: 2910,
        outputTokens: 96,
        latencyMs: 1480,
      },
    }),
    beat(33, "Player", "combo", "Combo Azure Sage (+10,000)"),
    beat(34, "Claude", "endMain", "End turn"),
  ].map((b) => ({ ...b, turn }));
  const review: Review = { turns: [1, 2, 3, 4, 5, 6, 7], turn, board: snap.view, beats, drift: null };
  return {
    games: GAMES,
    showAll: q.all,
    game: GAMES[0],
    flags: FLAGS,
    review,
    why: null,
    decisions: [],
    drifted: false,
    beat: q.beat ?? FLAGS.find((f) => f.turn === turn)?.beatIndex ?? null,
    fixture: true,
  };
}

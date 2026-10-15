import Link from "next/link";
import { modeLabel, seatOf } from "@/lib/arena/games";
import { RematchButton } from "./RematchButton";
import { resolveOutcome } from "@/lib/arena/outcome";
import { Panel } from "@/components/ui";

/** The row shape `listGames` / `listPlayingGames` return. */
export interface GameRowData {
  id: number;
  p1Name: string;
  p2Name: string;
  p1User: string | null;
  p2User: string | null;
  status: string;
  winner: string | null;
  reason?: string | null;
  outcomeKind?: string | null;
  turn: number;
  mode: string;
  turnPlayer: string | null;
}

/** "your move" / "Claude's move" / "waiting on Sam" for a game in progress; null for a hot-seat, where both sides are you. */
export function moveLabel(g: GameRowData, me: string | null): string | null {
  if (g.mode === "hotseat") return null;
  const seat = seatOf(g, me);
  if (!seat || !g.turnPlayer) return null;
  if (g.turnPlayer === seat) return "your move";
  if (g.mode === "versus") return `waiting on ${(seat === "p1" ? g.p2User : g.p1User) ?? "them"}`;
  return "Claude’s move";
}

/** The opponent as the row names them: the other login in a 1 v 1, Claude in sparring/tournament, the second deck in hot-seat. */
function opponentLabel(g: GameRowData, me: string | null): string {
  if (g.mode === "versus") return `${(seatOf(g, me) === "p2" ? g.p1User : g.p2User) ?? "a friend"}`;
  if (g.mode === "hotseat") return "hot-seat";
  return "Claude";
}

function resultLabel(g: GameRowData): string {
  const result = resolveOutcome({ winner: g.winner === "p1" || g.winner === "p2" ? g.winner : null, overReason: g.reason, outcome: g.outcomeKind ? { kind: g.outcomeKind as "win" | "draw" | "concession" | "abandoned" | "interrupted", winner: g.winner === "p1" || g.winner === "p2" ? g.winner : null, reason: g.reason ?? "" } : null }, g.status);
  if (!result) return "in progress";
  if (result.kind === "interrupted") return "interrupted";
  if (result.kind === "abandoned") return "abandoned";
  if (result.kind === "draw") return "draw";
  return result.winner ? `${result.winner === "p1" ? g.p1Name : g.p2Name} won` : "draw";
}

/** The strip at the top of the home screen: the viewer's newest game in progress. One tap opens it. */
export function ContinueStrip({ game, me }: { game: GameRowData; me: string | null }) {
  const move = moveLabel(game, me);
  const versus = game.mode === "versus";
  const watching = versus && move?.startsWith("waiting");
  return (
    <Panel className="p-0 border-ki-500/50 bg-ki-500/10"><Link href={`/arena/${game.id}`} className="tap flex min-h-16 items-center gap-3 rounded-xl px-4 py-2 hover:border-ki-500">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-space-50">
          {watching ? "Watch" : "Continue"} vs {opponentLabel(game, me)}
        </span>
        <span className="block break-words text-xs text-space-300">
          turn {game.turn}
          {move ? ` · ${move}` : ""} · {game.p1Name} v {game.p2Name}
        </span>
      </span>
      <span aria-hidden className="text-ki-300">
        &rarr;
      </span>
    </Link></Panel>
  );
}

/** One game: matchup, opponent, turns and result, and exactly one action. At least 64 px high, with a 44 px action. */
function GameRow({ g, me }: { g: GameRowData; me: string | null }) {
  const move = g.status === "playing" ? moveLabel(g, me) : null;
  const versus = g.mode === "versus";
  const watching = g.status === "playing" && versus && !!move?.startsWith("waiting");
  const action = "tap flex min-w-24 items-center justify-center rounded-lg border border-space-600 px-3 text-sm font-semibold text-space-50 hover:border-ki-500/60";
  return (
    <li><Panel className="flex min-h-16 items-center gap-3 px-3 py-2">
      <Link href={`/arena/${g.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-space-50">
          {g.p1Name} <span className="text-space-500">vs</span> {g.p2Name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-space-400">
          <span>{opponentLabel(g, me)}</span>
          <span>turn {g.turn}</span>
          <span>{modeLabel(g.mode)}</span>
          <span className={g.status === "playing" ? "text-ki-300" : ""}>{move ? `${resultLabel(g)} · ${move}` : resultLabel(g)}</span>
        </span>
      </Link>
      {g.status === "playing" ? (
        <Link href={`/arena/${g.id}`} className={action}>
          {watching ? "Watch" : "Continue"}
        </Link>
      ) : g.status === "over" ? (
        <RematchButton gameId={g.id} versus={versus} />
      ) : (
        <Link href={`/arena/${g.id}`} className={action}>
          View
        </Link>
      )}
    </Panel></li>
  );
}

/**
 * The Games screen (ah-05). Phone: one of two tabs at a time (`list`), as the
 * screen `/arena?tab=games` opens. Desktop (`sm` up): both lists at once, in
 * the table under the deck grid. `invitations` renders at the head of Now.
 */
export function GamesList({
  playing,
  finished,
  me,
  list,
  invitations,
}: {
  playing: GameRowData[];
  finished: GameRowData[];
  me: string | null;
  list: "now" | "finished";
  invitations: React.ReactNode;
}) {
  const tab = (active: boolean) => `tap flex flex-1 items-center justify-center rounded-md text-sm font-semibold ${active ? "bg-space-700 text-space-50" : "text-space-300 hover:text-space-50"}`;
  return (
    <Panel id="games" className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-space-400">Games</h2>
      <nav aria-label="Games" className="flex gap-1 rounded-lg bg-space-900 p-1 sm:hidden">
        <Link href="/arena?tab=games" replace aria-current={list === "now" ? "page" : undefined} className={tab(list === "now")}>
          Now
        </Link>
        <Link href="/arena?tab=games&list=finished" replace aria-current={list === "finished" ? "page" : undefined} className={tab(list === "finished")}>
          Finished
        </Link>
      </nav>
      <div className={`space-y-2 ${list === "finished" ? "hidden sm:block" : ""}`}>
        <h3 className="hidden text-xs uppercase tracking-widest text-space-500 sm:block">Now</h3>
        {invitations}
        {playing.length > 0 && (
          <ul className="space-y-2">
            {playing.map((g) => (
              <GameRow key={g.id} g={g} me={me} />
            ))}
          </ul>
        )}
        {playing.length === 0 && !invitations && <p className="text-sm text-space-400">Nothing in progress.</p>}
      </div>
      <div className={`space-y-2 ${list === "now" ? "hidden sm:block" : ""}`}>
        <h3 className="hidden text-xs uppercase tracking-widest text-space-500 sm:block">Finished</h3>
        {finished.length === 0 ? (
          <p className="text-sm text-space-400">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {finished.map((g) => (
              <GameRow key={g.id} g={g} me={me} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

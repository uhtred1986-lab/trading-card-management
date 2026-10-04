import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { canOpenGame } from "@/lib/auth/ownership";
import { ArenaStage } from "@/components/arena/stage/ArenaStage";
import { hasAnthropic } from "@/lib/ai/client";
import { GameOver } from "@/components/arena/GameOver";
import { cardsOnTable } from "@/components/arena/shared-display";
import { draftFiredInGame } from "@/lib/arena/game-over";
import type { GameReview } from "@/lib/arena/ai/review";
import { ENGINE_INFO, damageTaken, sideName } from "@/lib/arena/engines";
import { decisionsFor } from "@/lib/arena/ai/debug";
import { adminDebugOf } from "@/lib/arena/admin-debug";
import { flagsForGame } from "@/lib/arena/review-store";
import { isVersus, loadArchivedGame, loadGame, modeLabel, seatOf } from "@/lib/arena/games";
import { currentUser, isArenaAdmin, requireSignedInPage } from "@/lib/auth";
import { artForGame, snapshotOfGame } from "@/lib/arena/session";
import { archivedSnapshotFor } from "@/lib/arena/snapshot";
import { LIGHTING_COOKIE, lightingFrom } from "@/lib/arena/lighting";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { STAGING_COOKIE, stagingFrom } from "@/lib/arena/staging";
import { SubmitButton } from "@/components/SubmitButton";
import { abandon } from "../actions";

export const dynamic = "force-dynamic";
/** A Tournament turn can take Claude a while to think through. */
export const maxDuration = 300;

export default async function ArenaGamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ skin?: string; staging?: string }> }) {
  const viewer = await requireSignedInPage();
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  // A player opens only their own games (`canOpenGame`); anyone else's does not exist for them.
  if (!(await canOpenGame(viewer, id))) notFound();

  // Which skin. The query wins for one page load (`?skin=anime`), the cookie
  // is the setting; read here so the markup the server sends is already the
  // right colour and nothing flashes. Read once, ahead of either branch below
  // — a read-only archived board is skinned exactly like a live one.
  const asked = await searchParams;
  const jar = await cookies();
  const skin = skinFrom(asked.skin ?? jar.get(SKIN_COOKIE)?.value);
  // How a battle is staged, the same way: `?staging=takeover` pins one board
  // for one load, which is what a screenshot needs.
  const staging = stagingFrom(asked.staging ?? jar.get(STAGING_COOKIE)?.value);
  // Turn lighting, read on the server for exactly the reason the skin is: the
  // room is painted from the active leader's colour, and a palette read on the
  // client would flash the default one on every load.
  const lighting = lightingFrom(jar.get(LIGHTING_COOKIE)?.value);
  // Who may see the engine's internals (#350). Decided here, on the server, and
  // handed down as a boolean: a player's page never carries them at all.
  const admin = await isArenaAdmin();

  // An archived legacy row (issue #335) is checked before `loadGame` — never
  // through it, since `legalActions` must never be reached for one, not
  // merely have its result discarded. This branch is the same whether or not
  // `engine/` has actually been deleted yet: the stored snapshot's presence
  // decides, not the engine's existence.
  const archived = await loadArchivedGame(db, id);
  if (archived) {
    // Same seat rule as a live 1 v 1, checked before the stored snapshot is
    // ever read (issue #335's acceptance for the 1 v 1 case).
    const seat = seatOf(archived, await currentUser());
    if (isVersus(archived.mode) && !seat) notFound();
    const snap = archivedSnapshotFor(archived.store, isVersus(archived.mode) ? seat : null);
    if (!snap) notFound();

    return (
      <div className="mx-auto w-full max-w-7xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href="/arena" className="text-sm text-space-300 hover:text-ki-300">
            ← Arena
          </Link>
          <span className="text-sm font-medium text-space-100 sm:text-base">
            {archived.p1Name} <span className="text-space-500">vs</span> {archived.p2Name}
          </span>
          {archived.p1User && archived.p2User && (
            <span className="text-xs text-space-400">
              {archived.p1User} v {archived.p2User}
            </span>
          )}
          <span className="rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400">{modeLabel(archived.mode)}</span>
          <span
            className="rounded-full border border-dbs-yellow/50 px-2 py-0.5 text-[11px] uppercase tracking-wider text-dbs-yellow"
            title="Its last snapshot, kept from before the legacy engine that played it was retired."
          >
            archived
          </span>
        </div>

        <p className="rounded-xl border border-dbs-yellow/40 bg-dbs-yellow/10 px-3 py-2 text-sm text-dbs-yellow">
          This game is archived — it shows the position exactly as it last stood, and cannot be continued.
          {snap.over && (snap.over.winner ? ` ${snap.over.winner === "p1" ? archived.p1Name : archived.p2Name} won — ${snap.over.reason}` : ` A draw — ${snap.over.reason}`)}
        </p>

        <ArenaStage gameId={id} snapshot={snap} skin={skin} staging={staging} lighting={lighting} admin={admin} />
      </div>
    );
  }

  const game = await loadGame(db, id);
  if (!game) notFound();

  // A 1 v 1 belongs to its two seats and to nobody else, over as well as
  // playing (owner's decision, 7 Sep 2026). Not found rather than forbidden:
  // there is nothing useful to say to someone who is not in the game, and a
  // 403 would confirm it exists.
  const seat = seatOf(game, await currentUser());
  if (isVersus(game.mode) && !seat) notFound();

  // Everything the board is drawn from — art, view, taps, whose turn it is —
  // comes from the one snapshot builder both clients share, so this page and
  // the Android app can never disagree about what the position is. The seat is
  // what keeps each device in its own chair; every other mode passes null and
  // the viewer is derived exactly as it always was.
  const snap = await snapshotOfGame(db, game, isVersus(game.mode) ? seat : null);
  const playing = snap.game.status === "playing";
  // The drawer's extras — seed, the opponent's hand, the decisions — only for an admin.
  const [decisions, flags] = admin ? await Promise.all([decisionsFor(db, id), flagsForGame(db, id)]) : [null, null];
  const adminDebug = admin && decisions && flags ? adminDebugOf({ engine: game.engine, ctx: game.ctx, state: game.state, viewer: snap.game.you, images: await artForGame(db, game), decisions, flags }) : null;
  const review = game.review ? (JSON.parse(game.review) as GameReview) : null;

  // The game's own links, in the board's menu sheet rather than a row above
  // it: the board has the whole screen (`docs/arena-redesign/` frame 01), and
  // that row wrapped to two lines on a phone, about 75 px over the turn pill.
  const menu = (
    <div className="space-y-2 text-sm">
      <p className="text-space-100">
        {game.p1Name} <span className="text-space-500">vs</span> {game.p2Name}
        {game.p1User && game.p2User && (
          <span className="ml-2 text-xs text-space-400">
            {game.p1User} v {game.p2User}
          </span>
        )}
        <span className="ml-2 rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400">{modeLabel(game.mode)}</span>
        {/* Admins only (#350): an engine badge is an internal. Inverted at
            #166: what is worth saying is that this game is *not* on the rules
            engine — a game keeps the engine it was made on. */}
        {admin && game.engine === "legacy" && (
          <span className="ml-2 rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400" title={ENGINE_INFO.legacy.note}>
            {ENGINE_INFO.legacy.label}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-5">
        <Link href="/arena" className="tap inline-flex items-center text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
        {/* Admins only (#350): the debug page is an internal. */}
        {admin && (
          <Link href={`/arena/${id}/debug`} className="tap inline-flex items-center text-space-400 hover:text-ki-300">
            {isVersus(game.mode) ? "what the server decided" : "how Claude played"}
          </Link>
        )}
        {playing && (
          <form action={abandon.bind(null, id)}>
            <SubmitButton pendingLabel="Giving up…" className="tap text-space-400 hover:text-loss">
              give up
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );

  return (
    // From lg the board is the whole viewport, edge to edge (#444).
    <div className="mx-auto w-full max-w-7xl space-y-3 lg:max-w-none">

      {game.status === "over" && (
        <GameOver
          gameId={id}
          winnerName={game.state.winner ? sideName(game.state, game.state.winner) : null}
          draw={!game.state.winner}
          reason={game.state.overReason ?? ""}
          turns={game.state.turn}
          damage={{ you: damageTaken(game.state, snap.game.you), them: damageTaken(game.state, snap.game.you === "p1" ? "p2" : "p1") }}
          spend={game.spend}
          review={review}
          aiEnabled={hasAnthropic()}
          deckId={snap.game.you === "p2" ? game.p2DeckId : game.p1DeckId}
          versus={isVersus(game.mode)}
          draftFired={await draftFiredInGame(db, id)}
          cards={cardsOnTable(snap.view)}
        />
      )}

      {/* The whole snapshot, because the board keeps watching the game while
          the server is deciding and replaces it with what it reads. */}
      <div id="board" className="scroll-mt-2">
        <ArenaStage gameId={id} snapshot={snap} skin={skin} staging={staging} lighting={lighting} admin={admin} adminDebug={adminDebug} menu={menu} />
      </div>
    </div>
  );
}

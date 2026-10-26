import Link from "next/link";
import { sql } from "drizzle-orm";
import { ARENA_GAMES, GAME_INFO, parseGame, type Game } from "@/lib/catalog/games";
import { db } from "@/db";
import { players } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { lastPlayedDecks, listGames, listPlayingGames } from "@/lib/arena/games";
import { listOpenMatches } from "@/lib/arena/matches";
import { currentScope, currentUser, requireSignedInPage } from "@/lib/auth";
import { listUsers } from "@/lib/auth/users";
import { isLocked, readiness } from "@/lib/arena/readiness";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { GameSwitch } from "@/components/arena/GameSwitch";
import { PlayPicker } from "@/components/arena/PlayPicker";
import { ContinueStrip, GamesList } from "@/components/arena/GamesList";
import { Invitations } from "@/components/arena/Invitations";
import { ComputerPlayCard } from "@/components/arena/ComputerPlayCard";
import { startGameForm } from "./actions";
import { PageHeader, SectionTabs } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ArenaPage({ searchParams }: { searchParams: Promise<{ deck?: string; tab?: string; list?: string; testing?: string; game?: string }> }) {
  await requireSignedInPage();
  // `?deck=<id>` preselects a deck: GameOver's "Change deck" (#358).
  const sp = await searchParams;
  const wanted = Number(sp.deck);
  const onGames = sp.tab === "games";
  const showTestingDecks = sp.testing === "1";
  // Only decks of the games the arena plays are offered here.
  const me = await currentUser();
  const scope = await currentScope();
  const [decks, games, playing, matches, users, playerCount] = await Promise.all([
    listDecks(db, { games: ARENA_GAMES, viewer: scope }),
    listGames(db, 20, me, scope),
    listPlayingGames(db, 10, me, scope),
    listOpenMatches(db),
    listUsers(db).catch(() => []),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(players)
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => 0),
  ]);
  // A 1 v 1 is two people: a password login or a player, plus whoever is here.
  // Without a second one the form would only throw, so it says so instead.
  const canVersus = users.filter((u) => u.isActive).length + playerCount >= 1 && !!me;
  // What games of each kind have actually cost, rather than an estimate.
  const costs = { sparring: "~12¢ a game", tournament: "~25¢ a game" };
  for (const mode of ["sparring", "tournament"] as const) {
    const done = games.filter((g) => g.mode === mode && g.status !== "playing" && g.costMicros > 0);
    if (!done.length) continue;
    const avg = done.reduce((n, g) => n + g.costMicros, 0) / done.length / 10_000;
    costs[mode] = `your average ~${Math.round(avg)}¢`;
  }
  const allPlayable = decks.filter((d) => d.leader && d.mainCount >= 50);
  const shown = showTestingDecks ? allPlayable : allPlayable.filter((d) => !d.isTesting);
  // One query for every deck's rule readiness (#357).
  const ready = await readiness(
    db,
    shown.map((d) => d.id),
  );
  const readyIds = shown.filter((d) => !isLocked(ready.get(d.id))).map((d) => d.id);

  // F1-12: the game to play. Offered when the viewer has ready decks of more than one arena game;
  // `?game=` wins, then the game of the deck last played, then the first game they can play.
  const readyGames = ARENA_GAMES.filter((g) => shown.some((d) => d.game === g && readyIds.includes(d.id)));
  const offered: readonly Game[] = readyGames.length ? readyGames : [...new Set(shown.map((d) => d.game))];
  const lastAll = await lastPlayedDecks(
    db,
    shown.map((d) => d.id),
    me,
  );
  const lastGame = shown.find((d) => d.id === lastAll.own)?.game;
  const wantedGame = shown.find((d) => d.id === wanted)?.game;
  const pickedGame = parseGame(sp.game);
  const chosen: Game = [pickedGame, wantedGame, lastGame, "dbs" as const].find((g): g is Game => !!g && offered.includes(g)) ?? offered[0] ?? "dbs";
  // Both pickers show only the chosen game's decks, so a mixed pair cannot be chosen.
  const playable = shown.filter((d) => d.game === chosen);
  const last = lastAll.own != null && playable.some((d) => d.id === lastAll.own)
    ? lastAll
    : await lastPlayedDecks(db, playable.map((d) => d.id), me);
  const pick = (id: number | null, fallback: number) => (id != null && readyIds.includes(id) && playable.some((d) => d.id === id) ? id : fallback);
  const playableReady = playable.filter((d) => readyIds.includes(d.id)).map((d) => d.id);
  // A deck named in the query wins even when locked, so the picker shows why.
  const initialDeck = playable.some((d) => d.id === wanted) ? wanted : pick(last.own, playableReady[0] ?? playable[0]?.id ?? 0);
  const initialClaudeDeck = pick(last.claude, playableReady.find((id) => id !== initialDeck) ?? playableReady[0] ?? playable[0]?.id ?? 0);
  const switchQuery = (g: Game) => {
    const q = new URLSearchParams();
    if (sp.tab) q.set("tab", sp.tab);
    if (sp.list) q.set("list", sp.list);
    if (showTestingDecks) q.set("testing", "1");
    q.set("game", g);
    return `/arena?${q.toString()}`;
  };
  const hiddenTestingDeckName = !showTestingDecks ? allPlayable.filter((d) => d.game === chosen).find((d) => d.id === wanted && d.isTesting)?.name ?? null : null;
  const toggleQuery = new URLSearchParams();
  if (sp.deck) toggleQuery.set("deck", sp.deck);
  if (sp.tab) toggleQuery.set("tab", sp.tab);
  toggleQuery.set("game", chosen);
  if (sp.list) toggleQuery.set("list", sp.list);
  if (!showTestingDecks) toggleQuery.set("testing", "1");
  const testingToggleHref = `/arena${toggleQuery.size ? `?${toggleQuery.toString()}` : ""}`;

  const invites = matches.length ? (
    <Invitations
      matches={matches}
      me={me}
      decks={shown.map((d) => ({
        id: d.id,
        game: d.game,
        label: `${d.name} — ${d.leader?.name ?? "no leader"}${isLocked(ready.get(d.id)) ? ` (${ready.get(d.id)!.open} open, locked)` : ""}`,
        locked: isLocked(ready.get(d.id)),
      }))}
    />
  ) : null;

  return (
    <div className="ds-page space-y-5">
      <ArenaHeader side="play" />
      <SectionTabs label="Arena" items={[
        { href: "/arena", label: "Play", active: !onGames },
        { href: "/arena?tab=games#games", label: "Games", active: onGames },
        { href: "/arena/tutorial", label: "Learn" },
        { href: "/arena/offline", label: "Vs computer" },
      ]} />
      {onGames ? <PageHeader title="Games" eyebrow="Arena" description="Continue a match or revisit your recent games." /> : <PageHeader title="Set up a match" eyebrow="Arena · Play" description="Play the built-in computer for free, or choose a ready deck to play Claude or a friend." actions={<Link href="/arena/tutorial" className="ds-button-secondary">Learn to play</Link>} />}
      {/* Phone: `?tab=games` is a screen of its own, so the play screen steps aside below `sm`; the desktop keeps both. Otherwise the Games list is desktop-only. */}
      <div className={`space-y-5 ${onGames ? "hidden sm:block" : ""}`}>
        {/* The Continue strip is the first thing under the header (ah-05), then any open invitation. */}
        {playing[0] && <ContinueStrip game={playing[0]} me={me} />}
        {!onGames && invites}
        {/* The built-in computer (#896): a first-class choice, no Claude and no tokens (#656); not gated on server decks. */}
        {!onGames && <ComputerPlayCard />}
        {!onGames && offered.length > 0 && <GameSwitch games={offered} chosen={chosen} hrefFor={switchQuery} />}
      {playable.length < 1 && allPlayable.length > 0 ? (
        <section className="rounded-xl border border-dashed border-space-700 p-6 text-center">
          <p className="text-sm text-space-200">Your playable decks are marked for testing and are hidden from the default picker.</p>
          <Link href={testingToggleHref} className="tap mt-3 inline-flex items-center justify-center rounded-lg border border-ki-500/60 px-4 py-2 text-sm font-medium text-ki-300 hover:bg-space-800">
            Show testing decks
          </Link>
        </section>
      ) : playable.length < 1 ? (
          <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
            No deck is ready to play yet. A deck needs a leader, at least 50 cards, and every card's rule read.{" "}
            <Link href="/decks" className="text-ki-300 hover:underline">
              Build one
            </Link>
            .
          </p>
        ) : (
          <PlayPicker
            key={`${showTestingDecks}:${initialDeck}:${initialClaudeDeck}:${playable.map((d) => d.id).join(",")}`}
            decks={playable.map((d) => ({ id: d.id, name: d.name, isTesting: d.isTesting, description: d.description, colors: d.leader?.colors ?? [], leaderId: d.leaderId, isBuilt: d.isBuilt, leaderName: d.leader?.name ?? null, leaderImage: d.leader?.imageUrl ?? null, mainCount: d.mainCount, game: d.game, ready: ready.get(d.id)! }))}
            initialDeck={initialDeck}
            initialClaudeDeck={initialClaudeDeck}
            costs={costs}
            canVersus={canVersus}
            versusNote="Needs a second login: add one under Settings → Users."
            action={startGameForm}
            showTestingDecks={showTestingDecks}
            testingToggleHref={testingToggleHref}
            hiddenTestingDeckName={hiddenTestingDeckName}
          />
        )}
      </div>

      <div className={onGames ? "" : "hidden sm:block"}>
        <GamesList playing={playing} finished={games.filter((g) => g.status !== "playing")} me={me} list={sp.list === "finished" ? "finished" : "now"} invitations={onGames ? invites : null} />
      </div>
    </div>
  );
}

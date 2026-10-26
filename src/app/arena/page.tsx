import Link from "next/link";
import { sql } from "drizzle-orm";
import { ARENA_GAMES, GAME_INFO } from "@/lib/catalog/games";
import { db } from "@/db";
import { players } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { lastPlayedDecks, listGames, listPlayingGames } from "@/lib/arena/games";
import { listOpenMatches } from "@/lib/arena/matches";
import { currentScope, currentUser, requireSignedInPage } from "@/lib/auth";
import { listUsers } from "@/lib/auth/users";
import { isLocked, readiness } from "@/lib/arena/readiness";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { PlayPicker } from "@/components/arena/PlayPicker";
import { ContinueStrip, GamesList } from "@/components/arena/GamesList";
import { Invitations } from "@/components/arena/Invitations";
import { ComputerPlayCard } from "@/components/arena/ComputerPlayCard";
import { startGameForm } from "./actions";
import { PageHeader, SectionTabs } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ArenaPage({ searchParams }: { searchParams: Promise<{ deck?: string; tab?: string; list?: string; testing?: string }> }) {
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
  // A game badge in the pickers only once more than one arena game has decks.
  const manyGames = new Set(allPlayable.map((d) => d.game)).size > 1;
  const playable = showTestingDecks ? allPlayable : allPlayable.filter((d) => !d.isTesting);
  // One query for every deck's rule readiness (#357).
  const ready = await readiness(
    db,
    playable.map((d) => d.id),
  );

  // Preselected from the newest games, but always a *ready* deck: a locked one
  // cannot be played, so the last-played ready one wins, then the first ready.
  const last = await lastPlayedDecks(
    db,
    playable.map((d) => d.id),
    me,
  );
  const readyIds = playable.filter((d) => !isLocked(ready.get(d.id))).map((d) => d.id);
  const pick = (id: number | null, fallback: number) => (id != null && readyIds.includes(id) ? id : fallback);
  // A deck named in the query wins even when locked, so the picker shows why.
  const initialDeck = playable.some((d) => d.id === wanted) ? wanted : pick(last.own, readyIds[0] ?? playable[0]?.id ?? 0);
  const initialClaudeDeck = pick(last.claude, readyIds.find((id) => id !== initialDeck) ?? readyIds[0] ?? playable[0]?.id ?? 0);
  const hiddenTestingDeckName = !showTestingDecks ? allPlayable.find((d) => d.id === wanted && d.isTesting)?.name ?? null : null;
  const toggleQuery = new URLSearchParams();
  if (sp.deck) toggleQuery.set("deck", sp.deck);
  if (sp.tab) toggleQuery.set("tab", sp.tab);
  if (sp.list) toggleQuery.set("list", sp.list);
  if (!showTestingDecks) toggleQuery.set("testing", "1");
  const testingToggleHref = `/arena${toggleQuery.size ? `?${toggleQuery.toString()}` : ""}`;

  const invites = matches.length ? (
    <Invitations
      matches={matches}
      me={me}
      defaultDeck={readyIds[0] ?? playable[0]?.id ?? 0}
      decks={playable.map((d) => ({
        id: d.id,
        label: `${manyGames ? `[${GAME_INFO[d.game].short}] ` : ""}${d.name} — ${d.leader?.name ?? "no leader"}${isLocked(ready.get(d.id)) ? ` (${ready.get(d.id)!.open} open, locked)` : ""}`,
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
      {onGames ? <PageHeader title="Games" eyebrow="Arena" description="Continue a match or revisit your recent games." /> : <PageHeader title="Set up a match" eyebrow="Arena · Play" description="Play the built-in computer for free, or choose a ready Masters deck to play Claude or a friend." actions={<Link href="/arena/tutorial" className="ds-button-secondary">Learn to play</Link>} />}
      {/* Phone: `?tab=games` is a screen of its own, so the play screen steps aside below `sm`; the desktop keeps both. Otherwise the Games list is desktop-only. */}
      <div className={`space-y-5 ${onGames ? "hidden sm:block" : ""}`}>
        {/* The Continue strip is the first thing under the header (ah-05), then any open invitation. */}
        {playing[0] && <ContinueStrip game={playing[0]} me={me} />}
        {!onGames && invites}
        {/* The built-in computer (#896): a first-class choice, no Claude and no tokens (#656); not gated on server decks. */}
        {!onGames && <ComputerPlayCard />}
      {playable.length < 1 && allPlayable.length > 0 ? (
        <section className="rounded-xl border border-dashed border-space-700 p-6 text-center">
          <p className="text-sm text-space-200">Your playable decks are marked for testing and are hidden from the default picker.</p>
          <Link href={testingToggleHref} className="tap mt-3 inline-flex items-center justify-center rounded-lg border border-ki-500/60 px-4 py-2 text-sm font-medium text-ki-300 hover:bg-space-800">
            Show testing decks
          </Link>
        </section>
      ) : playable.length < 1 ? (
          <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
            No deck is ready to play yet. A deck needs a leader, at least 50 cards, and the original game&rsquo;s rules — the arena does not play Fusion World.{" "}
            <Link href="/decks" className="text-ki-300 hover:underline">
              Build one
            </Link>
            .
          </p>
        ) : (
          <PlayPicker
            key={`${showTestingDecks}:${initialDeck}:${initialClaudeDeck}:${playable.map((d) => d.id).join(",")}`}
            decks={playable.map((d) => ({ id: d.id, name: d.name, isTesting: d.isTesting, description: d.description, colors: d.leader?.colors ?? [], leaderId: d.leaderId, isBuilt: d.isBuilt, leaderName: d.leader?.name ?? null, leaderImage: d.leader?.imageUrl ?? null, mainCount: d.mainCount, ready: ready.get(d.id)! }))}
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

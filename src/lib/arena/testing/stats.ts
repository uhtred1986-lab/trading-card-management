/** Seat-based aggregates. Source adapters resolve outcomes/model provenance. */
import type { MatchActor, MatchOutcome, MatchStats, StatRow, StatsFilter } from "./types";

export interface StatsMatch {
  id: string; p1DeckId: string; p2DeckId: string; p1DeckName: string; p2DeckName: string;
  p1: MatchActor; p2: MatchActor; outcome: MatchOutcome | "playing"; winner: "p1" | "p2" | null;
  reportedCostMicros?: number | null;
}
const empty = (key: string, label: string): StatRow => ({ key, label, games: 0, wins: 0, losses: 0, draws: 0, completed: 0,
  interrupted: 0, abandoned: 0, limit: 0, playing: 0, winRate: null, decided: 0, appearances: 0, uniqueGames: 0 });
const label = (a: MatchActor) => `${a.name} · ${a.kind}${a.model ? ` · ${a.model}` : " · model not recorded"}`;
const actorKey = (a: MatchActor) => JSON.stringify([a.kind, a.name, a.model]);
const matchesSeat = (a: MatchActor, deck: string, f: StatsFilter) => (!f.actorKind || a.kind === f.actorKind)
  && (!f.model || a.model === f.model) && (!f.deckId || f.deckId === deck);
function count(row: StatRow, m: StatsMatch, seat?: "p1" | "p2") {
  row.games++;
  row.appearances++;
  if (m.outcome === "win") {
    row.completed++;
    if (seat) { if (m.winner === seat) row.wins++; else row.losses++; }
  } else if (m.outcome === "draw") { row.completed++; row.draws++; }
  else row[m.outcome]++;
  row.decided = row.wins + row.losses;
  row.winRate = row.decided ? row.wins / row.decided : null;
}
export function aggregateMatches(input: StatsMatch[], filter: StatsFilter = {}): MatchStats {
  const matches = empty("matches", "Unique matches");
  const actors = new Map<string, StatRow>();
  const decks = new Map<string, StatRow>();
  const matchups = new Map<string, StatRow>();
  const rowGames = new Map<StatRow, Set<string>>();
  const countSeat = (row: StatRow, m: StatsMatch, seat: "p1" | "p2") => {
    count(row, m, seat);
    const ids = rowGames.get(row) ?? new Set<string>();
    ids.add(m.id); rowGames.set(row, ids); row.uniqueGames = ids.size;
  };
  const seen = new Set<string>();
  let knownCostMicros = 0;
  let pricedMatches = 0;
  for (const m of input) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    let included = false;
    for (const seat of ["p1", "p2"] as const) {
      const actor = m[seat]; const deck = m[`${seat}DeckId`];
      if (!matchesSeat(actor, deck, filter)) continue;
      included = true;
      const key = actorKey(actor);
      const a = actors.get(key) ?? empty(key, label(actor));
      const d = decks.get(deck) ?? empty(deck, m[`${seat}DeckName`]);
      countSeat(a, m, seat); countSeat(d, m, seat);
      const other = seat === "p1" ? "p2" : "p1";
      const matchupKey = JSON.stringify([deck, actorKey(actor), m[`${other}DeckId`], actorKey(m[other])]);
      const matchup = matchups.get(matchupKey) ?? empty(matchupKey, `${m[`${seat}DeckName`]} · ${label(actor)} vs ${m[`${other}DeckName`]} · ${label(m[other])}`);
      countSeat(matchup, m, seat); matchups.set(matchupKey, matchup);
      actors.set(key, a); decks.set(deck, d);
    }
    if (included) {
      count(matches, m);
      matches.uniqueGames++;
      if (typeof m.reportedCostMicros === "number") { knownCostMicros += m.reportedCostMicros; pricedMatches++; }
    }
  }
  const sorted = (map: Map<string, StatRow>) => [...map.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { matches, byActor: sorted(actors), byDeck: sorted(decks), byMatchup: sorted(matchups),
    cost: { knownCostMicros, pricedMatches, totalMatches: matches.games, label: `Recorded cost for ${pricedMatches} of ${matches.games} matches; partial evidence, not an invoice.` },
    denominator: "Filters match all selected actor/model/deck fields in the same seat. Matches count unique games with a matching seat; actor/deck/oriented-matchup rows count matching seat appearances, with uniqueGames disclosed (an exact mirror has two appearances). Win rate is W/(W+L); draws, interruptions, abandonment, limits and playing games are excluded. There is no overall match win rate." };
}

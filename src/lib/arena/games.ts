/**
 * Saved games: create, load, apply an action, save.
 *
 * The engine stays pure — it knows nothing about the database. This is the
 * only place the two meet. A row keeps the seed, the action log (which is what
 * makes a game reproducible) and a snapshot of the state so a page load does
 * not have to replay from the beginning.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { hasAnthropic } from "@/lib/ai/client";
import { arenaGames, cards as cardsTable } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { apply, createGame, legalActions, seedFrom, type Action, type CardDef, type EngineContext, type GameEvent, type GameState, type LegalAction, type PlayerId } from "./engine";
import { face } from "./engine";
import { appendBeats, describeSkillEvent, toBeats, type Beats } from "./beats";
import { cardDefFrom, deckInputFor } from "./load";
import { scriptsFor } from "./scripts";

export type ArenaMode = "hotseat" | "sparring" | "tournament" | "versus";

/** A 1 v 1 game between two people, each on their own device. */
export function isVersus(mode: string): boolean {
  return mode === "versus";
}

/** The word for a mode, wherever one is shown. */
export function modeLabel(mode: string): string {
  return mode === "hotseat" ? "hot-seat" : mode === "versus" ? "1 v 1" : mode;
}

/** Which seat a game keeps for each side, by `app_users.username`. */
export interface Seats {
  p1User: string | null;
  p2User: string | null;
}

/**
 * Which side this login is sitting in, or null when it is nobody's.
 *
 * Two deliberate holes, both of which keep everything that is not a 1 v 1
 * working exactly as it did:
 *
 *  - **A game with no seats belongs to whoever is logged in.** That is every
 *    hot-seat, sparring and tournament game, and every game that existed
 *    before this column did.
 *  - **A null user is the open-dev path.** With neither `BASIC_AUTH_*` nor a
 *    row in `app_users`, `src/proxy.ts` lets everything through and
 *    `currentUser()` is null. Refusing there would lock the owner out of his
 *    own laptop and stop `npm run arena:playthrough` dead.
 */
export function seatOf(game: Seats, user: string | null): PlayerId | null {
  if (game.p1User === user) return "p1";
  if (game.p2User === user) return "p2";
  if (!game.p1User && !game.p2User) return "p1";
  if (!user) return "p1";
  return null;
}

/**
 * The card whose text just fired, for the banner the board shows. Engine
 * events only exist for the length of one `apply`, so the one thing the board
 * wants out of them is kept on the row.
 */
export interface Spotlight {
  /** Log length when it happened: the board banners it when this changes. */
  seq: number;
  /** Catalog id, so the page can find the art it already loaded. */
  cardId: string;
  name: string;
  /** The bracket tag the card prints: "Auto", "Activate: Main", "Permanent". */
  label: string;
  text: string;
  /** True when this skill is one the compiler could not read on its own. */
  unread: boolean;
}

/**
 * The last skill to resolve in this batch of events, or null if none did.
 * The reading itself is `describeSkillEvent` in `beats.ts`, so the banner and
 * the `skill` beat can never end up describing the same card differently.
 */
function spotlightFrom(ctx: EngineContext, state: GameState, events: GameEvent[], seq: number): Spotlight | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "skill") continue;
    if (!state.cards[e.card]) continue;
    const d = describeSkillEvent(ctx, state, e);
    return d ? { seq, ...d } : null;
  }
  return null;
}

export interface LoadedGame {
  id: number;
  mode: ArenaMode;
  status: string;
  /** What Claude has cost this game, and its review once it exists. */
  spend: { calls: number; input: number; output: number; cached: number; micros: number };
  review: string | null;
  /** Keep the exact prompt of every paid decision, for later analysis. */
  debug: boolean;
  p1Name: string;
  p2Name: string;
  /** The login in each seat; both null except in a 1 v 1. */
  p1User: string | null;
  p2User: string | null;
  p1DeckId: number | null;
  p2DeckId: number | null;
  /** What the row was on when this was read — the guard `applyToGame` writes against. */
  version: number;
  ctx: EngineContext;
  state: GameState;
  /** Every action applied so far, in order. */
  actions: Action[];
  log: string[];
  legal: LegalAction[];
  /** The skill that fired on the last action, for the board's banner. */
  spotlight: Spotlight | null;
  /** What has happened since the human last acted, for a client to animate. */
  beats: Beats | null;
}

/** Definitions for every card the state mentions, tokens included. */
async function defsForState(db: Db, state: GameState): Promise<Record<string, CardDef>> {
  const ids = [...new Set(Object.values(state.cards).map((c) => c.cardId))].filter((id) => !id.startsWith("TOKEN:"));
  const rows = ids.length ? await db.select().from(cardsTable).where(inArray(cardsTable.id, ids)) : [];
  const out: Record<string, CardDef> = {};
  for (const r of rows) out[r.id] = cardDefFrom(r);
  return out;
}

export async function startGame(db: Db, p1DeckId: number, p2DeckId: number, mode: ArenaMode = "hotseat", debug = true, seats: Seats = { p1User: null, p2User: null }): Promise<number> {
  const a = await deckInputFor(db, p1DeckId);
  const b = await deckInputFor(db, p2DeckId);
  // `deckInputFor` also returns null for a Fusion World deck, which the engine
  // has no rules for.
  if (!a) throw new Error("the first deck has no leader or is not a Dragon Ball Super deck, so it cannot be played");
  if (!b) throw new Error("the second deck has no leader or is not a Dragon Ball Super deck, so it cannot be played");
  const rows = await db
    .select()
    .from(cardsTable)
    .where(inArray(cardsTable.id, [...new Set([...a.cardIds, ...b.cardIds])]));
  const defs: Record<string, CardDef> = {};
  for (const r of rows) defs[r.id] = cardDefFrom(r);
  const ctx: EngineContext = { defs, scripts: await scriptsFor(db, defs), referee: hasAnthropic() && mode !== "hotseat" };
  const seed = seedFrom(`${p1DeckId}:${p2DeckId}:${Date.now()}`);
  const { state, events } = createGame(ctx, { seed, p1: a.input, p2: b.input });
  const [row] = await db
    .insert(arenaGames)
    .values({
      p1DeckId,
      p2DeckId,
      p1Name: a.input.name,
      p2Name: b.input.name,
      p1User: seats.p1User,
      p2User: seats.p2User,
      seed,
      mode,
      state,
      actions: [],
      log: describeEvents(ctx, state, events),
      beats: toBeats(ctx, state, events, 0),
      turn: state.turn,
      debug,
    })
    .returning({ id: arenaGames.id });
  return row.id;
}

export async function loadGame(db: Db, id: number): Promise<LoadedGame | null> {
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) });
  if (!row) return null;
  const state = row.state as GameState;
  const defs = await defsForState(db, state);
  // Programs you have explained win over whatever the compiler managed to read.
  const ctx: EngineContext = { defs, scripts: await scriptsFor(db, defs), referee: hasAnthropic() && row.mode !== "hotseat" };
  return {
    id: row.id,
    mode: row.mode as ArenaMode,
    status: row.status,
    p1Name: row.p1Name,
    p2Name: row.p2Name,
    p1User: row.p1User,
    p2User: row.p2User,
    p1DeckId: row.p1DeckId,
    p2DeckId: row.p2DeckId,
    version: row.version,
    ctx,
    state,
    actions: (row.actions as Action[]) ?? [],
    log: (row.log as string[]) ?? [],
    spotlight: (row.spotlight as Spotlight | null) ?? null,
    beats: (row.beats as Beats | null) ?? null,
    legal: legalActions(ctx, state),
    spend: { calls: row.aiCalls, input: row.aiInputTokens, output: row.aiOutputTokens, cached: row.aiCachedTokens, micros: row.aiCostMicros },
    review: row.review,
    debug: row.debug,
  };
}

/**
 * Someone else wrote the row between reading it and writing it back.
 *
 * The caller's move was computed against a board that no longer exists, so it
 * is refused rather than applied: re-read and decide again. Only reachable in
 * a 1 v 1, where two people can be poised to act at once — a blocker or
 * counter prompt belongs to the player whose turn it is not.
 */
export class StaleGame extends Error {
  constructor() {
    super("the board has moved on — read it again");
    this.name = "StaleGame";
  }
}

/**
 * Apply one action and save. Throws whatever the engine throws for an illegal
 * move, and `StaleGame` when the row changed under it.
 */
export async function applyToGame(db: Db, id: number, action: Action): Promise<LoadedGame> {
  const game = await loadGame(db, id);
  if (!game) throw new Error(`no game ${id}`);
  if (game.status !== "playing") throw new Error("this game is over");
  const { state, events } = apply(game.ctx, game.state, action);
  const lines = [...game.log, ...describeEvents(game.ctx, state, events)].slice(-400);
  // Null when this action fired no skill, so the banner does not show again.
  const spotlight = spotlightFrom(game.ctx, state, events, lines.length);
  // One opponent turn is several applies, so beats climb from where the queue
  // already is; `act()` is what empties it, once, when you take your turn.
  const beats = appendBeats(game.beats, toBeats(game.ctx, state, events, game.beats?.seq ?? 0));
  const actions = [...game.actions, action];
  // `WHERE version = <what loadGame read>` is the whole concurrency story: two
  // devices racing means one of these updates matches no row, and that one is
  // told to look again instead of overwriting the move it never saw.
  const written = await db
    .update(arenaGames)
    .set({
      state,
      actions,
      log: lines,
      spotlight,
      beats,
      turn: state.turn,
      status: state.phase === "over" ? "over" : "playing",
      winner: state.winner,
      reason: state.overReason,
      version: game.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(arenaGames.id, id), eq(arenaGames.version, game.version)))
    .returning({ id: arenaGames.id });
  if (!written.length) throw new StaleGame();
  return {
    ...game,
    state,
    actions,
    version: game.version + 1,
    log: lines,
    spotlight,
    beats,
    legal: legalActions(game.ctx, state),
    status: state.phase === "over" ? "over" : "playing",
  };
}

/**
 * What `act()` calls at the start of your own action — the emptying below,
 * unless two people are watching this game.
 *
 * Clearing is a one-viewer optimisation: with one pair of eyes the queue can
 * hold exactly one story, because whoever acts has already seen everything
 * before it. In a 1 v 1 the *other* device has not, and the queue is its only
 * copy of what it has yet to animate — so there it is left to roll at its 300
 * cap and each client replays what is numbered above its own mark, which is
 * what a client does anyway (`docs/arena-client-contract.md` §4).
 */
export async function clearBeatsForTurn(db: Db, id: number): Promise<void> {
  const [row] = await db.select({ mode: arenaGames.mode }).from(arenaGames).where(eq(arenaGames.id, id)).limit(1);
  if (row && isVersus(row.mode)) return;
  await clearBeats(db, id);
}

/**
 * Empty the animation queue, so what a client then finds is exactly one story:
 * your move, and everything the server did in reply to it.
 *
 * The *counter* survives the emptying, even though the beats do not. A client
 * replays everything numbered above the last beat it played, so a counter that
 * restarted at zero would make the turn after a long one look like something
 * it had already seen — and it would sit still through it.
 */
export async function clearBeats(db: Db, id: number): Promise<void> {
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) });
  const seq = (row?.beats as Beats | null)?.seq ?? 0;
  await db
    .update(arenaGames)
    .set({ beats: { seq, list: [], art: {} } satisfies Beats })
    .where(eq(arenaGames.id, id));
}

/**
 * The games to show, newest first.
 *
 * `user` is the login asking. A 1 v 1 belongs to its two seats and to nobody
 * else — even once it is over — so those rows are dropped for anyone else;
 * every other mode is listed as it always was. Filtering after the fetch keeps
 * this one query and one shape, and the list is 20 rows.
 */
export async function listGames(db: Db, limit = 20, user: string | null = null) {
  const rows = await db
    .select({
      id: arenaGames.id,
      p1Name: arenaGames.p1Name,
      p2Name: arenaGames.p2Name,
      p1User: arenaGames.p1User,
      p2User: arenaGames.p2User,
      status: arenaGames.status,
      winner: arenaGames.winner,
      reason: arenaGames.reason,
      turn: arenaGames.turn,
      mode: arenaGames.mode,
      costMicros: arenaGames.aiCostMicros,
      updatedAt: arenaGames.updatedAt,
    })
    .from(arenaGames)
    .orderBy(desc(arenaGames.updatedAt))
    .limit(limit * 2);
  return rows.filter((g) => !isVersus(g.mode) || seatOf(g, user) !== null).slice(0, limit);
}

export async function abandonGame(db: Db, id: number): Promise<void> {
  await db.update(arenaGames).set({ status: "abandoned", updatedAt: new Date() }).where(eq(arenaGames.id, id));
}

// ── the event log ──────────────────────────────────────────────────────────

/** One readable line per event, for the log the board shows. */
export function describeEvents(ctx: EngineContext, state: GameState, events: GameEvent[]): string[] {
  const name = (id: string) => {
    try {
      return face(ctx, state, id).name;
    } catch {
      return id;
    }
  };
  const who = (p: "p1" | "p2") => state.players[p].name;
  const out: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case "gameStart":
        out.push(`Game on. ${who(e.first)} won the flip.`);
        break;
      case "phase":
        out.push(`— Turn ${e.turn}, ${who(e.player)}: ${e.phase} phase`);
        break;
      case "draw":
        out.push(`${who(e.player)} drew a card`);
        break;
      case "move":
        if (e.from === "hand" && e.to === "energy") out.push(`${who(e.owner)} charged ${name(e.card)} as energy`);
        else if (e.to === "battle" && e.from === "hand") out.push(`${who(e.owner)} played ${name(e.card)}`);
        else if (e.to === "combo") out.push(`${who(e.owner)} comboed ${name(e.card)}`);
        else if (e.from === "hand" && e.to === "drop") out.push(`${who(e.owner)} put ${name(e.card)} in the Drop`);
        else if (e.to === "removed") out.push(`${name(e.card)} was removed from the game`);
        else if (e.from === "deck" && e.to === "life") break;
        else if (e.to === "unison") out.push(`${who(e.owner)} played the Unison ${name(e.card)}`);
        else break;
        break;
      case "attack":
        out.push(`${name(e.attacker)} attacks ${name(e.target)}`);
        break;
      case "guardChanged":
        out.push(`${name(e.guard)} blocks`);
        break;
      case "powerCompare":
        out.push(`${e.attackPower.toLocaleString("en")} vs ${e.guardPower.toLocaleString("en")} — ${e.hit ? "the attack lands" : "it bounces off"}`);
        break;
      case "damage":
        out.push(`${who(e.player)} takes ${e.amount} damage${e.critical ? " (Critical: to the Drop)" : ""}`);
        break;
      case "ko":
        out.push(`${name(e.card)} is KO'd`);
        break;
      case "attackNegated":
        out.push("the attack is negated");
        break;
      case "skill":
        out.push(`${name(e.card)}: ${e.text.replace(/\s+/g, " ").slice(0, 90)}`);
        break;
      case "flip":
        out.push(`${name(e.card)} awakens`);
        break;
      case "markers":
        out.push(`${name(e.card)} ${e.delta >= 0 ? "gains" : "loses"} ${Math.abs(e.delta)} marker${Math.abs(e.delta) === 1 ? "" : "s"} (now ${e.total})`);
        break;
      case "token":
        out.push(`${who(e.owner)} plays a ${name(e.card)}`);
        break;
      case "delayed":
        out.push(`${name(e.card)} — ${e.label}`);
        break;
      case "note":
        out.push(e.text);
        break;
      case "gameOver":
        out.push(e.winner ? `${who(e.winner)} wins — ${e.reason}` : `A draw — ${e.reason}`);
        break;
      default:
        break;
    }
  }
  return out;
}

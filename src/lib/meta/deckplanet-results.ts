/**
 * Regional results, scraped from deckplanet.net's own dashboard — the same
 * source the catalog sync trusts, just an undocumented page instead of the
 * documented cardsearch API. There is no JSON API for this: the dashboard is
 * a server-rendered Next.js page whose React Server Component payload embeds
 * the data as a string inside `self.__next_f.push([1, "..."])` calls in the
 * HTML. Verified by hand against live pages (see the plan): the dashboard's
 * decoded payload has a top-level `events` array (id, name, date, placements
 * → leaderId) and a `cardById` map (leaderId → card_number); a deck page's
 * payload has `deck_cards` (main zone) and `z_deck_cards` (Z-deck zone)
 * arrays, each row `{amount_in_deck, zone, card_id: {card_number, ...}}`.
 * `card_number` is the exact id our own catalog uses, because it's the same
 * source. deckplanet's third array, `side_deck_cards`, is sideboard/tech
 * cards outside the 50+10 legal list and is intentionally not read here.
 *
 * This is scraping an internal implementation detail, not a published API —
 * it can break if deckplanet changes their frontend bundling. `syncMeta`
 * (src/lib/meta/sync.ts) wraps every call so a break shows up as a failed
 * `sync_runs` row, same as a catalog or price sync failure, rather than
 * crashing anything else.
 */
import type { Game } from "@/lib/catalog/games";

const BASE = "https://www.deckplanet.net";
const USER_AGENT = "Mozilla/5.0 DBSCardCompanion/0.1 (+https://github.com)";

/** deckplanet's own path segment for each game's dashboard — distinct from GAME_INFO.catalogPath, which points at the cardsearch API. */
const DASHBOARD_PATH: Record<Game, string> = { dbs: "dbs_masters", fusion: "fusion_world" };

export interface DpPlacement {
  deckId: string;
  leaderId: string;
  placement: number;
}

export interface DpEvent {
  id: string;
  name: string;
  date: string;
  official: boolean;
  placements: DpPlacement[];
}

export interface DpLeader {
  id: string;
  cardNumber: string;
  cardName: string;
}

export interface DpDeckCard {
  cardNumber: string;
  cardName: string;
  zone: "main" | "z";
  quantity: number;
}

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`${BASE}/${path}`, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  if (!res.ok) throw new Error(`deckplanet ${path}: ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Every `self.__next_f.push([1, "<escaped>"])` call in the page, decoded back
 * to plain text (the escaping is standard JSON string escaping, since that's
 * what Next.js uses to embed the flight payload as a JS string literal), and
 * joined — the fields we want can land in any one chunk.
 */
function decodeNextChunks(html: string): string {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      parts.push(JSON.parse(`"${m[1]}"`));
    } catch {
      // A chunk that doesn't decode cleanly is skipped rather than aborting the whole page.
    }
  }
  return parts.join("\n");
}

/** From `text[startIdx]` (expected to be `[` or `{`), the matching close bracket, respecting quoted strings. */
function extractBalanced(text: string, startIdx: number): string | null {
  const open = text[startIdx];
  const close = open === "[" ? "]" : open === "{" ? "}" : null;
  if (!close) return null;
  let depth = 0;
  let inStr = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/** Finds `"<key>":` and balanced-extracts + parses whatever value follows it. */
function extractJsonAfterKey<T>(text: string, key: string): T | null {
  const marker = `"${key}":`;
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const valueStart = idx + marker.length;
  const raw = extractBalanced(text, valueStart);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface RawEvent {
  id: string;
  name: string;
  date: string;
  official?: boolean;
  placements: { deckId: string; leaderId: string; placement: number }[];
}

interface RawLeader {
  id: string;
  card_number: string;
  card_name: string;
}

export async function fetchDashboardEvents(game: Game): Promise<{ events: DpEvent[]; leaders: Map<string, DpLeader> }> {
  const html = await fetchHtml(`${DASHBOARD_PATH[game]}/dashboard`);
  const text = decodeNextChunks(html);

  const rawEvents = extractJsonAfterKey<RawEvent[]>(text, "events") ?? [];
  const rawLeaders = extractJsonAfterKey<Record<string, RawLeader>>(text, "cardById") ?? {};

  const events: DpEvent[] = rawEvents.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    official: e.official ?? true,
    placements: e.placements,
  }));
  const leaders = new Map<string, DpLeader>();
  for (const [id, l] of Object.entries(rawLeaders)) {
    leaders.set(id, { id, cardNumber: l.card_number, cardName: l.card_name });
  }
  return { events, leaders };
}

interface RawDeckCard {
  amount_in_deck: number;
  zone: string;
  card_id: { card_number: string; card_name: string };
}

export async function fetchDeckCards(game: Game, deckId: string): Promise<DpDeckCard[]> {
  const html = await fetchHtml(`${DASHBOARD_PATH[game]}/deck/${deckId}`);
  const text = decodeNextChunks(html);

  const main = extractJsonAfterKey<RawDeckCard[]>(text, "deck_cards") ?? [];
  const z = extractJsonAfterKey<RawDeckCard[]>(text, "z_deck_cards") ?? [];

  return [...main, ...z]
    .filter((c) => c.zone === "main" || c.zone === "z")
    .map((c) => ({
      cardNumber: c.card_id.card_number,
      cardName: c.card_id.card_name,
      zone: c.zone as "main" | "z",
      quantity: c.amount_in_deck,
    }));
}

export function dashboardEventUrl(game: Game, eventId: string): string {
  return `${BASE}/${DASHBOARD_PATH[game]}/meta/event/${eventId}`;
}

export function dashboardDeckUrl(game: Game, deckId: string): string {
  return `${BASE}/${DASHBOARD_PATH[game]}/deck/${deckId}`;
}

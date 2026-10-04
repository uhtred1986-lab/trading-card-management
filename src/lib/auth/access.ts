/**
 * SL accounts, players, join codes and devices — the database half (the pure
 * half is `./join-code.ts` and `./core.ts`). Ported from gullet-cove-dm's
 * `src/lib/player-access.ts` and `src/lib/dm-accounts.ts`, without heroes:
 * here a code joins a player, and a player is an owner name.
 *
 * Every function takes the database, so `scripts/verify-db.mts` runs them on
 * PGlite. None of them checks who is asking — the Server Functions that call
 * them do (`requireSl()`). Docs: docs/architecture/auth.md.
 */
import { and, asc, count, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { decks, joinAttempts, ownedCards, playerDevices, playerJoinCodes, players, slAccounts } from "@/db/schema";
import { defaultSlOwner, normaliseEmail, parseSlEmails, type AuthEnv, type PlayerClaims } from "./core";
import { CODE_TTL_MS, LAST_SEEN_THROTTLE_MS, generateCode, hashCode, hashDeviceToken, isWellFormedCode, joinRateLimited, newDeviceToken, normaliseCode } from "./join-code";

// ── SLs ────────────────────────────────────────────────────────────────────

/** Whether a normalised address has an `sl_accounts` row (an added SL, or an owner who set a name). */
export async function isAddedSl(db: Db, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: slAccounts.id })
    .from(slAccounts)
    .where(eq(slAccounts.email, normaliseEmail(email)))
    .limit(1);
  return row !== undefined;
}

/** The owner name an SL acts under: their row's, else `defaultSlOwner`. */
export async function slOwner(db: Db, email: string, env: AuthEnv): Promise<string> {
  const [row] = await db
    .select({ owner: slAccounts.owner })
    .from(slAccounts)
    .where(eq(slAccounts.email, normaliseEmail(email)))
    .limit(1);
  return row?.owner ?? defaultSlOwner(email, env);
}

export interface SlRow {
  email: string;
  owner: string;
  /** In `SL_EMAILS`: can't be removed here, and may add and remove the others. */
  isOwner: boolean;
  addedBy: string | null;
  createdAt: Date | null;
}

/** Every SL: the owners from `SL_EMAILS` first (with their row's name if they set one), then the added ones. */
export async function listSls(db: Db, env: AuthEnv): Promise<SlRow[]> {
  const rows = await db.select().from(slAccounts).orderBy(asc(slAccounts.email));
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  const owners = parseSlEmails(env.SL_EMAILS);
  const out: SlRow[] = owners.map((email) => {
    const r = byEmail.get(email);
    return { email, owner: r?.owner ?? defaultSlOwner(email, env), isOwner: true, addedBy: null, createdAt: r?.createdAt ?? null };
  });
  for (const r of rows) if (!owners.includes(r.email)) out.push({ email: r.email, owner: r.owner, isOwner: false, addedBy: r.addedBy, createdAt: r.createdAt });
  return out;
}

/** Adds an SL, or renames an existing row's owner. */
export async function upsertSl(db: Db, email: string, owner: string, addedBy: string): Promise<void> {
  const e = normaliseEmail(email);
  await db
    .insert(slAccounts)
    .values({ email: e, owner: owner.trim(), addedBy: normaliseEmail(addedBy) })
    .onConflictDoUpdate({ target: slAccounts.email, set: { owner: owner.trim() } });
}

export async function removeSl(db: Db, email: string): Promise<void> {
  await db.delete(slAccounts).where(eq(slAccounts.email, normaliseEmail(email)));
}

/** A plausible address for the add form: one `@`, a dot in the domain, no spaces or commas. Google decides the rest. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email);
}

// ── Players ────────────────────────────────────────────────────────────────

/** A display name or owner name: trimmed, 1–60 characters. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export async function createPlayer(db: Db, name: string, owner: string, createdBy: string | null): Promise<number> {
  const [row] = await db.insert(players).values({ name, owner, createdBy }).returning({ id: players.id });
  return row.id;
}

export async function updatePlayer(db: Db, id: number, patch: { name?: string; owner?: string }): Promise<void> {
  await db.update(players).set(patch).where(eq(players.id, id));
}

/** Deletes the player with their codes and devices (cascade), which signs every device out. Their cards and decks stay. */
export async function deletePlayer(db: Db, id: number): Promise<void> {
  await db.delete(players).where(eq(players.id, id));
}

// ── Join codes ─────────────────────────────────────────────────────────────

/** A new single-use code for the player, valid 24 h. Deletes their unused one. `null` for a player that is gone. */
export async function issueJoinCode(db: Db, playerId: number, now: Date, createdBy: string | null): Promise<{ code: string; expiresAt: Date } | null> {
  const [player] = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return null;
  await db.delete(playerJoinCodes).where(and(eq(playerJoinCodes.playerId, playerId), isNull(playerJoinCodes.usedAt)));
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  // A collision with another open code is astronomically unlikely; the unique index turns it into a retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await db.insert(playerJoinCodes).values({ playerId, codeHash: hashCode(code), expiresAt, createdBy, createdAt: now });
      return { code, expiresAt };
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  return null;
}

export async function deleteOpenCodes(db: Db, playerId: number): Promise<void> {
  await db.delete(playerJoinCodes).where(and(eq(playerJoinCodes.playerId, playerId), isNull(playerJoinCodes.usedAt)));
}

async function openCode(db: Db, input: string, now: Date) {
  const code = normaliseCode(input);
  if (!isWellFormedCode(code)) return null;
  const [row] = await db
    .select({ id: playerJoinCodes.id, playerId: playerJoinCodes.playerId, name: players.name })
    .from(playerJoinCodes)
    .innerJoin(players, eq(players.id, playerJoinCodes.playerId))
    .where(and(eq(playerJoinCodes.codeHash, hashCode(code)), isNull(playerJoinCodes.usedAt), gt(playerJoinCodes.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

/** The player a code would join, for the "You are joining as …" step. `null` for a wrong, spent or expired code. */
export async function previewJoinCode(db: Db, input: string, now: Date): Promise<{ name: string } | null> {
  const row = await openCode(db, input, now);
  return row ? { name: row.name } : null;
}

/**
 * Spends the code and creates the device. The code is marked used only if
 * nobody used it first (one conditional UPDATE), so two phones racing on one
 * code get one device. Returns what the cookie needs, the token in plain for
 * the cookie only. `null` for a wrong, spent or expired code.
 */
export async function redeemJoinCode(db: Db, input: string, label: string, now: Date): Promise<(PlayerClaims & { name: string }) | null> {
  const row = await openCode(db, input, now);
  if (!row) return null;
  const spent = await db
    .update(playerJoinCodes)
    .set({ usedAt: now })
    .where(and(eq(playerJoinCodes.id, row.id), isNull(playerJoinCodes.usedAt), gt(playerJoinCodes.expiresAt, now)))
    .returning({ id: playerJoinCodes.id });
  if (spent.length !== 1) return null;
  const token = newDeviceToken();
  const [device] = await db
    .insert(playerDevices)
    .values({ playerId: row.playerId, tokenHash: hashDeviceToken(token), label: label.slice(0, 80), createdAt: now, lastSeenAt: now })
    .returning({ id: playerDevices.id });
  return { playerId: row.playerId, deviceId: device.id, tok: token, name: row.name };
}

// ── Devices ────────────────────────────────────────────────────────────────

export type ResolvedPlayer = { role: "player"; playerId: number; deviceId: number; name: string; owner: string };

/**
 * The player a verified cookie stands for, or `null`: the device must exist,
 * belong to the cookie's player, hold the token's hash and not be revoked.
 * Touches `lastSeenAt` at most once a minute (`touch: false` skips it, for
 * the proxy).
 */
export async function resolvePlayerDevice(db: Db, claims: PlayerClaims, now: Date, touch = true): Promise<ResolvedPlayer | null> {
  const [row] = await db
    .select({
      id: playerDevices.id,
      playerId: playerDevices.playerId,
      tokenHash: playerDevices.tokenHash,
      revokedAt: playerDevices.revokedAt,
      lastSeenAt: playerDevices.lastSeenAt,
      name: players.name,
      owner: players.owner,
    })
    .from(playerDevices)
    .innerJoin(players, eq(players.id, playerDevices.playerId))
    .where(eq(playerDevices.id, claims.deviceId))
    .limit(1);
  if (!row || row.revokedAt !== null || row.playerId !== claims.playerId) return null;
  if (row.tokenHash !== hashDeviceToken(claims.tok)) return null;
  if (touch && (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS)) {
    await db.update(playerDevices).set({ lastSeenAt: now }).where(eq(playerDevices.id, row.id));
  }
  return { role: "player", playerId: row.playerId, deviceId: row.id, name: row.name, owner: row.owner };
}

/** Disconnects a device; its next request is refused. `playerId` narrows it to that player's own device when given. */
export async function revokeDevice(db: Db, deviceId: number, now: Date, playerId?: number): Promise<boolean> {
  const where = playerId === undefined ? eq(playerDevices.id, deviceId) : and(eq(playerDevices.id, deviceId), eq(playerDevices.playerId, playerId));
  const rows = await db
    .update(playerDevices)
    .set({ revokedAt: now })
    .where(and(where, isNull(playerDevices.revokedAt)))
    .returning({ id: playerDevices.id });
  return rows.length === 1;
}

export interface DeviceRow {
  id: number;
  label: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/** A player's live devices, newest first. */
export async function devicesOf(db: Db, playerId: number): Promise<DeviceRow[]> {
  return db
    .select({ id: playerDevices.id, label: playerDevices.label, createdAt: playerDevices.createdAt, lastSeenAt: playerDevices.lastSeenAt })
    .from(playerDevices)
    .where(and(eq(playerDevices.playerId, playerId), isNull(playerDevices.revokedAt)))
    .orderBy(sql`${playerDevices.createdAt} desc`);
}

// ── The admin overview ─────────────────────────────────────────────────────

export interface PlayerOverview {
  id: number;
  name: string;
  owner: string;
  createdAt: Date;
  lots: number;
  decks: number;
  devices: DeviceRow[];
  /** When the player's open code expires, if one is open. The code itself is never stored. */
  openCodeExpiresAt: Date | null;
}

export async function playersOverview(db: Db, now: Date): Promise<PlayerOverview[]> {
  const list = await db.select().from(players).orderBy(asc(players.name));
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);
  const owners = [...new Set(list.map((p) => p.owner))];
  const [deviceRows, codeRows, lotRows, deckRows] = await Promise.all([
    db
      .select({ id: playerDevices.id, playerId: playerDevices.playerId, label: playerDevices.label, createdAt: playerDevices.createdAt, lastSeenAt: playerDevices.lastSeenAt })
      .from(playerDevices)
      .where(and(inArray(playerDevices.playerId, ids), isNull(playerDevices.revokedAt)))
      .orderBy(sql`${playerDevices.createdAt} desc`),
    db
      .select({ playerId: playerJoinCodes.playerId, expiresAt: playerJoinCodes.expiresAt })
      .from(playerJoinCodes)
      .where(and(inArray(playerJoinCodes.playerId, ids), isNull(playerJoinCodes.usedAt), gt(playerJoinCodes.expiresAt, now))),
    db
      .select({ owner: ownedCards.owner, n: count() })
      .from(ownedCards)
      .where(and(inArray(ownedCards.owner, owners), isNull(ownedCards.archivedAt)))
      .groupBy(ownedCards.owner),
    db.select({ owner: decks.owner, n: count() }).from(decks).where(inArray(decks.owner, owners)).groupBy(decks.owner),
  ]);
  const lotsBy = new Map(lotRows.map((r) => [r.owner, Number(r.n)]));
  const decksBy = new Map(deckRows.map((r) => [r.owner, Number(r.n)]));
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner,
    createdAt: p.createdAt,
    lots: lotsBy.get(p.owner) ?? 0,
    decks: decksBy.get(p.owner) ?? 0,
    devices: deviceRows.filter((d) => d.playerId === p.id).map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt })),
    openCodeExpiresAt: codeRows.find((c) => c.playerId === p.id)?.expiresAt ?? null,
  }));
}

export interface UnassignedOwner {
  /** The owner name on the lots and decks; `null` for lots and decks with none. */
  owner: string | null;
  lots: number;
  decks: number;
}

/**
 * Owner names on lots and decks that belong to no player and no SL — cards
 * added while the app ran open (no owner), or under a login that is no player.
 * Only SLs see these until they are given to a player.
 */
export async function unassignedOwners(db: Db, env: AuthEnv): Promise<UnassignedOwner[]> {
  const [playerOwners, sls, lotRows, deckRows] = await Promise.all([
    db.select({ owner: players.owner }).from(players),
    listSls(db, env),
    db.select({ owner: ownedCards.owner, n: count() }).from(ownedCards).where(isNull(ownedCards.archivedAt)).groupBy(ownedCards.owner),
    db.select({ owner: decks.owner, n: count() }).from(decks).groupBy(decks.owner),
  ]);
  // The Basic Auth env pair is an SL too while it lasts, and its name is theirs.
  const legacy = env.BASIC_AUTH_USER?.trim();
  const known = new Set([...playerOwners.map((p) => p.owner), ...sls.map((s) => s.owner), ...(legacy ? [legacy] : [])]);
  const out = new Map<string | null, UnassignedOwner>();
  const bucket = (owner: string | null) => {
    let b = out.get(owner);
    if (!b) out.set(owner, (b = { owner, lots: 0, decks: 0 }));
    return b;
  };
  for (const r of lotRows) if (r.owner === null || !known.has(r.owner)) bucket(r.owner).lots += Number(r.n);
  for (const r of deckRows) if (r.owner === null || !known.has(r.owner)) bucket(r.owner).decks += Number(r.n);
  return [...out.values()].sort((a, b) => (a.owner ?? "").localeCompare(b.owner ?? ""));
}

/** Moves every lot (archived ones too) and deck from one owner name (or none) to another. */
export async function reassignOwner(db: Db, from: string | null, to: string): Promise<{ lots: number; decks: number }> {
  const lotWhere = from === null ? isNull(ownedCards.owner) : eq(ownedCards.owner, from);
  const deckWhere = from === null ? isNull(decks.owner) : eq(decks.owner, from);
  const lots = await db.update(ownedCards).set({ owner: to }).where(lotWhere).returning({ id: ownedCards.id });
  const ds = await db.update(decks).set({ owner: to }).where(deckWhere).returning({ id: decks.id });
  return { lots: lots.length, decks: ds.length };
}

// ── The rate limit ─────────────────────────────────────────────────────────

/**
 * Records one join attempt for `keyHash` and answers whether the caller is
 * now over the limit (10 a minute, 50 an hour, this attempt included).
 * Refused attempts count too. Rows older than an hour are pruned on every call.
 */
export async function recordJoinAttempt(db: Db, keyHash: string, now: Date): Promise<{ limited: boolean }> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const minuteAgo = new Date(now.getTime() - 60 * 1000);
  await db.delete(joinAttempts).where(lt(joinAttempts.createdAt, hourAgo));
  await db.insert(joinAttempts).values({ keyHash, createdAt: now });
  const [hour] = await db
    .select({ n: count() })
    .from(joinAttempts)
    .where(and(eq(joinAttempts.keyHash, keyHash), gt(joinAttempts.createdAt, hourAgo)));
  const [minute] = await db
    .select({ n: count() })
    .from(joinAttempts)
    .where(and(eq(joinAttempts.keyHash, keyHash), gt(joinAttempts.createdAt, minuteAgo)));
  return { limited: joinRateLimited(Number(minute?.n ?? 0), Number(hour?.n ?? 0)) };
}

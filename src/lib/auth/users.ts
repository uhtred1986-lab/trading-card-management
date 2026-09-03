import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { appUsers } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";

export interface AppUser {
  id: number;
  username: string;
  owner: string;
  isActive: boolean;
  createdAt: Date;
}

export async function listUsers(db: Db): Promise<AppUser[]> {
  return db
    .select({ id: appUsers.id, username: appUsers.username, owner: appUsers.owner, isActive: appUsers.isActive, createdAt: appUsers.createdAt })
    .from(appUsers)
    .orderBy(asc(appUsers.username));
}

export async function createUser(db: Db, username: string, password: string, owner: string): Promise<AppUser> {
  const [row] = await db
    .insert(appUsers)
    .values({ username, passwordHash: hashPassword(password), owner: owner.trim() || username })
    .returning({ id: appUsers.id, username: appUsers.username, owner: appUsers.owner, isActive: appUsers.isActive, createdAt: appUsers.createdAt });
  return row;
}

export async function setUserPassword(db: Db, id: number, password: string): Promise<void> {
  await db.update(appUsers).set({ passwordHash: hashPassword(password), updatedAt: new Date() }).where(eq(appUsers.id, id));
}

export async function setUserOwner(db: Db, id: number, owner: string): Promise<void> {
  await db.update(appUsers).set({ owner: owner.trim(), updatedAt: new Date() }).where(eq(appUsers.id, id));
}

export async function setUserActive(db: Db, id: number, isActive: boolean): Promise<void> {
  await db.update(appUsers).set({ isActive, updatedAt: new Date() }).where(eq(appUsers.id, id));
}

export async function deleteUser(db: Db, id: number): Promise<void> {
  await db.delete(appUsers).where(eq(appUsers.id, id));
}

/** Owner to stamp on cards this login adds; falls back to the username. */
export async function ownerForUsername(db: Db, username: string | null): Promise<string | null> {
  if (!username) return null;
  const row = await db.query.appUsers.findFirst({ where: eq(appUsers.username, username), columns: { owner: true } });
  return row?.owner ?? username;
}

/** Every owner name in use, for the pickers. */
export async function userOwners(db: Db): Promise<string[]> {
  const rows = await db.select({ owner: appUsers.owner }).from(appUsers);
  return [...new Set(rows.map((r) => r.owner))];
}

/**
 * Used by the proxy on every unrecognised Authorization header. Returns the
 * matching active user, or null.
 */
export async function authenticate(db: Db, username: string, password: string): Promise<AppUser | null> {
  const row = await db.query.appUsers.findFirst({ where: eq(appUsers.username, username) });
  if (!row || !row.isActive) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;
  return { id: row.id, username: row.username, owner: row.owner, isActive: row.isActive, createdAt: row.createdAt };
}

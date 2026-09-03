"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { passwordProblem, usernameProblem } from "@/lib/auth/password";
import { createUser, deleteUser, setUserActive, setUserOwner, setUserPassword } from "@/lib/auth/users";

export type UserResult = { ok: true; message: string } | { ok: false; error: string };

function done(message: string): UserResult {
  revalidatePath("/settings/users");
  return { ok: true, message };
}

export async function createUserAction(username: string, password: string, owner: string): Promise<UserResult> {
  const name = username.trim();
  const nameProblem = usernameProblem(name);
  if (nameProblem) return { ok: false, error: nameProblem };
  const pwProblem = passwordProblem(password);
  if (pwProblem) return { ok: false, error: pwProblem };
  try {
    await createUser(db, name, password, owner.trim() || name);
    return done(`${name} can now sign in.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) return { ok: false, error: `There is already a login called ${name}.` };
    return { ok: false, error: message };
  }
}

export async function setPasswordAction(id: number, password: string): Promise<UserResult> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  await setUserPassword(db, id, password);
  return done("Password changed.");
}

export async function setOwnerAction(id: number, owner: string): Promise<UserResult> {
  if (!owner.trim()) return { ok: false, error: "An owner name is required." };
  await setUserOwner(db, id, owner);
  return done("Owner updated — new cards this login adds will use it.");
}

export async function setActiveAction(id: number, isActive: boolean): Promise<UserResult> {
  await setUserActive(db, id, isActive);
  return done(isActive ? "Login enabled." : "Login disabled.");
}

export async function deleteUserAction(id: number): Promise<UserResult> {
  await deleteUser(db, id);
  return done("Login deleted. Cards they added keep their owner name.");
}

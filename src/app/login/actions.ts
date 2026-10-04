"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/core";

/**
 * Sign the SL out: drop the session cookie and go to `/login`. Nothing in the
 * database changes — the session lives only in the signed cookie. A Basic Auth
 * login cannot be signed out from a page (the browser holds those credentials
 * until it is closed), so this only ends a Google session.
 */
export async function signOut(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions(process.env), maxAge: 0 });
  redirect("/login");
}

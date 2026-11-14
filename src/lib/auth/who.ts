/**
 * Who a response was made for, as an opaque header (`x-card-who`), so the service worker can keep a
 * copy of a signed-in page per person (`public/sw.js`, "Offline reading" in
 * docs/architecture/collection-and-decks.md). A worker cannot read the HttpOnly session cookie, and
 * it must never serve one person's cached collection to another on a shared phone: it keeps its page
 * cache for exactly one `who` at a time and clears it the moment a response carries another one (or
 * none), or the person goes to a sign-in page.
 *
 * The value is a salted SHA-256 of the identity, cut to 24 hex characters: it says "same person as
 * before" and nothing else. The salt is `AUTH_SECRET`, so it cannot be recomputed from a known email.
 */
export const WHO_HEADER = "x-card-who";

export type WhoInput = { kind: "sl"; email: string } | { kind: "player"; playerId: number | string } | { kind: "basic"; header: string } | { kind: "open" };

export async function whoKey(who: WhoInput, secret: string | undefined): Promise<string> {
  const identity = who.kind === "sl" ? `sl:${who.email.toLowerCase()}` : who.kind === "player" ? `player:${who.playerId}` : who.kind === "basic" ? `basic:${who.header}` : "open";
  const bytes = new TextEncoder().encode(`${secret ?? ""}|${identity}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

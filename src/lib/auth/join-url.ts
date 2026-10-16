/** What the QR code and the invitation link encode. Its own file so client code can import it (no `node:crypto`). */
export function joinUrl(origin: string, code: string, next?: string | null): string {
  const base = `${origin.replace(/\/$/, "")}/join?c=${encodeURIComponent(code)}`;
  const safe = safeNext(next);
  return safe ? `${base}&next=${encodeURIComponent(safe)}` : base;
}

/**
 * Where a freshly joined player may be sent: only a 1 v 1 invitation page
 * (`/arena/match/<digits>`), so the join link can never be used as an open
 * redirect. Anything else is `null` and the join goes home as before.
 */
export function safeNext(next: string | null | undefined): string | null {
  return typeof next === "string" && /^\/arena\/match\/\d{1,9}$/.test(next) ? next : null;
}

/** What the QR code and the invitation link encode. Its own file so client code can import it (no `node:crypto`). */
export function joinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/join?c=${encodeURIComponent(code)}`;
}

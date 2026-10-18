/**
 * Wording families for the rules review: an unread clause with its numbers,
 * card names, ids and colours blanked, so "send 3 <Frieza> cards to the Warp"
 * and "send 2 <Goku> cards to the Warp" fall in one family. Shared by
 * `npm run rules:skill-pack` (static files) and the rules-review MCP route
 * (live data), so both group identically.
 */
const COLOURS = "red|blue|green|yellow|black|purple|white|colorless|colourless";

export function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The family key of one clause. */
export function familyOf(clause: string): string {
  return flat(clause)
    .toLowerCase()
    .replace(/[<≪《][^>≫》]*[>≫》]/g, "<n>")
    .replace(/\b[a-z]{1,3}\d{0,2}-\d{2,3}[a-z]?(?:_[a-z0-9]+)?\b/g, "<id>")
    .replace(new RegExp(`\\b(?:${COLOURS})\\b`, "g"), "<c>")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

/** Cut a long printed text for the compact files (full text stays in JSON). */
export function truncate(s: string, n = 260): string {
  const t = flat(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * DNS-rebinding guard for `/api/mcp` (MCP transport spec: servers MUST validate `Origin`). Pure. A request with no
 * `Origin` (every server-to-server client: claude.ai's connector, Claude Code) passes: the bearer token is its lock.
 * One that carries an Origin must come from this site, claude.ai / claude.com, a loopback page (MCP Inspector) or an
 * origin listed in `MCP_ALLOWED_ORIGINS` (comma separated, exact). Anything else, and the literal `null`, is 403.
 */
const FIXED_ORIGINS = ["https://claude.ai", "https://www.claude.ai", "https://claude.com", "https://www.claude.com"];

export function mcpOriginAllowed(originHeader: string | null, ownOrigin: string, env: Record<string, string | undefined> = process.env): boolean {
  if (originHeader === null) return true;
  const origin = originHeader.trim();
  if (origin === "" || origin === "null") return false;
  if (origin === ownOrigin || FIXED_ORIGINS.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")) return true;
  const extra = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return extra.includes(origin);
}

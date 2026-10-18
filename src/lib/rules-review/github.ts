/**
 * The two GitHub writes the rules-review MCP route can make: open an issue
 * labelled `rule-assumption`, and comment on one that already carries it.
 * Nothing here closes, edits or deletes. The token is read from the env by the
 * caller and only ever goes into the Authorization header — never logged.
 */
export const REPO = "uhtred1986-lab/trading-card-management";
export const LABEL = "rule-assumption";

type Fetch = typeof fetch;

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "dbs-rules-review-mcp",
    "content-type": "application/json",
  };
}

function fail(res: Response, what: string): never {
  // Status only: a GitHub error body can echo request details.
  throw new Error(`GitHub ${what} failed (HTTP ${res.status})`);
}

export async function createIssue(token: string, title: string, body: string, f: Fetch = fetch): Promise<{ number: number; url: string }> {
  const res = await f(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ title, body, labels: [LABEL] }),
  });
  if (!res.ok) return fail(res, "issue creation");
  const j = (await res.json()) as { number: number; html_url: string };
  return { number: j.number, url: j.html_url };
}

export async function commentOnIssue(token: string, number: number, text: string, f: Fetch = fetch): Promise<{ url: string }> {
  // Only an issue that is not a pull request and carries the label may be commented on.
  const get = await f(`https://api.github.com/repos/${REPO}/issues/${number}`, { headers: headers(token) });
  if (!get.ok) return fail(get, "issue lookup");
  const issue = (await get.json()) as { pull_request?: unknown; labels?: ({ name?: string } | string)[] };
  const labelled = (issue.labels ?? []).some((l) => (typeof l === "string" ? l : l.name) === LABEL);
  if (issue.pull_request || !labelled) throw new Error(`#${number} is not a ${LABEL} issue`);
  const res = await f(`https://api.github.com/repos/${REPO}/issues/${number}/comments`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ body: text }),
  });
  if (!res.ok) return fail(res, "comment");
  const j = (await res.json()) as { html_url: string };
  return { url: j.html_url };
}

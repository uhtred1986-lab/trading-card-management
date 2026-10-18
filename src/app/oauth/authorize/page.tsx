import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { PageHeader, Panel } from "@/components/ui";
import { requireSlPage } from "@/lib/auth";
import { publicOrigin } from "@/lib/auth/core";
import { redirectWith, resolveAuthorizeRequest, type AuthorizeParams } from "@/lib/oauth/authorize";
import { WRITING_SCOPES, type OAuthScope } from "@/lib/oauth/core";
import { decideAuthorization } from "./actions";

/**
 * The consent screen: "May Claude review the DBS rules?". Behind the SL's own sign-in (`requireSlPage`; the proxy
 * sends a signed-out visitor to `/login`, and a player home). Only an SL with a Google address can connect a client.
 * A request with an unknown client or an unregistered redirect URI is an **error page, never a redirect**; every
 * other fault goes back to the client as `error=…` (`resolveAuthorizeRequest`). Each requested scope is its own line
 * with its own tick box, and the writing scope starts unticked. The buttons post to `decideAuthorization`, which
 * validates everything again.
 */
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const HIDDEN = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

const SCOPE_TEXT: Record<OAuthScope, { title: string; body: string }> = {
  "rules-read": { title: "Read the rules", body: "List open rules and assumptions and read a card's stored skills. Changes nothing." },
  "rules-write": { title: "Record rulings on GitHub", body: "Open and comment on `rule-assumption` issues in the repository. Never changes a rule in the app." },
};

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Query> }) {
  const sl = await requireSlPage();
  const query = await searchParams;
  const params: AuthorizeParams = {};
  for (const name of HIDDEN) params[name] = one(query[name]);

  const shell = (title: string, body: React.ReactNode) => (
    <main className="ds-page mx-auto flex max-w-lg flex-col gap-5 py-10">
      <PageHeader title={title} eyebrow="Connector" />
      <Panel>{body}</Panel>
    </main>
  );

  if (!sl.email) {
    return shell("Cannot connect", <p>The connector binds its token to a Google sign-in. You are signed in with a password; sign in with Google and try again.</p>);
  }

  const origin = publicOrigin(await headers(), "http://localhost:3000");
  const request = await resolveAuthorizeRequest(db, params, origin).catch(() => ({ kind: "error" as const }));
  if (request.kind === "redirect-error") {
    redirect(redirectWith(request.redirectUri, { error: request.error, error_description: request.description, state: request.state }));
  }
  if (request.kind === "error") {
    return shell("Cannot connect", <p role="alert">This connection request is not valid (unknown client or redirect address). Start again from the connector in claude.ai.</p>);
  }

  const host = new URL(request.redirectUri).host;
  return shell(
    `Connect ${request.client.name}?`,
    <form action={decideAuthorization} className="flex flex-col gap-4">
      {HIDDEN.map((name) => (params[name] !== undefined ? <input key={name} type="hidden" name={name} value={params[name]} /> : null))}
      <p className="text-sm">
        {request.client.name} asks to use the rules review as {sl.email}. Choose what it may do.
      </p>
      <fieldset className="flex flex-col gap-3">
        {request.requestedScopes.map((scope) => (
          <label key={scope} className="tap flex items-start gap-3">
            <input type="checkbox" name="grant" value={scope} defaultChecked={!WRITING_SCOPES.includes(scope)} className="mt-1" />
            <span className="flex flex-col">
              <span className="font-semibold">{SCOPE_TEXT[scope].title}</span>
              <span className="text-sm opacity-80">{SCOPE_TEXT[scope].body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs opacity-70">After you allow, you are sent back to {host}.</p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="decision" value="allow" className="tap flex-1 rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950 hover:bg-ki-400">
          Allow
        </button>
        <button type="submit" name="decision" value="deny" className="tap flex-1 rounded-lg px-4 py-3 text-sm font-semibold ring-1 ring-current">
          Deny
        </button>
      </div>
    </form>,
  );
}

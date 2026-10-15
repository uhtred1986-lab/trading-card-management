import Link from "next/link";
import { db } from "@/db";
import { currentUser, requireSlPage } from "@/lib/auth";
import { listUsers } from "@/lib/auth/users";
import { knownOwners } from "@/lib/collection/queries";
import { UsersAdmin } from "@/components/UsersAdmin";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireSlPage();
  const [users, me, cardOwners] = await Promise.all([listUsers(db), currentUser(), knownOwners(db)]);
  const envUser = process.env.BASIC_AUTH_USER ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title="Legacy password logins" eyebrow="Users & access" description={me ? `Signed in as ${me}` : undefined} />

      <Panel className="text-sm text-space-300">
        Everyone here can sign in with HTTP Basic Auth, and each login carries an <span className="text-space-100">owner</span> — the name stamped on cards that person adds. Two logins can share one
        owner, and any add screen can override it for a single session.
        {envUser ? (
          <>
            {" "}
            The environment login <span className="font-mono text-space-100">{envUser}</span> always works as well, so a mistake here can never lock everyone out; change it in Vercel.
          </>
        ) : null}
      </Panel>

      <UsersAdmin users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))} knownOwners={cardOwners} />
    </div>
  );
}

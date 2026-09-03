import Link from "next/link";
import { db } from "@/db";
import { currentUser } from "@/lib/auth";
import { listUsers } from "@/lib/auth/users";
import { knownOwners } from "@/lib/collection/queries";
import { UsersAdmin } from "@/components/UsersAdmin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const [users, me, cardOwners] = await Promise.all([listUsers(db), currentUser(), knownOwners(db)]);
  const envUser = process.env.BASIC_AUTH_USER ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/settings" className="text-xs text-space-300 hover:text-ki-300">
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Logins</h1>
        {me ? <span className="ml-auto text-xs text-space-400">signed in as {me}</span> : null}
      </div>

      <p className="rounded-xl border border-space-700/70 bg-space-900/40 p-3 text-xs text-space-300">
        Everyone here can sign in with HTTP Basic Auth, and each login carries an <span className="text-space-100">owner</span> — the name stamped on cards that
        person adds. Two logins can share one owner, and any add screen can override it for a single session.
        {envUser ? (
          <>
            {" "}
            The environment login <span className="font-mono text-space-100">{envUser}</span> always works as well, so a mistake here can never lock everyone out; change it in Vercel.
          </>
        ) : null}
      </p>

      <UsersAdmin users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))} knownOwners={cardOwners} />
    </div>
  );
}

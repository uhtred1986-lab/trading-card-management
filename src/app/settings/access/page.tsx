import Link from "next/link";
import { db } from "@/db";
import { requireSlPage } from "@/lib/auth";
import { listSls, playersOverview, unassignedOwners } from "@/lib/auth/access";
import { isSlEmail } from "@/lib/auth/core";
import { AccessAdmin } from "@/components/settings/AccessAdmin";

export const dynamic = "force-dynamic";

/**
 * Settings → Users & access: players and their join codes and devices, the
 * SLs, and the cards and decks that belong to nobody yet. SL-only.
 */
export default async function AccessPage() {
  const me = await requireSlPage();
  const now = new Date();
  const [roster, sls, unassigned] = await Promise.all([playersOverview(db, now), listSls(db, process.env), unassignedOwners(db, process.env)]);
  const isOwner = me.via !== "google" || isSlEmail(me.email, process.env.SL_EMAILS);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/settings" className="text-xs text-space-300 hover:text-ki-300">
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Users & access</h1>
        <span className="ml-auto text-xs text-space-400">signed in as {me.email ?? me.login ?? "local dev"}</span>
      </div>

      <p className="rounded-xl border border-space-700/70 bg-space-900/40 p-3 text-xs text-space-300">
        <span className="text-space-100">Players</span> join with a one-time code from here and stay signed in on that phone. They see only their own cards and decks, and can use everything except
        Settings and the arena&apos;s rules workbench. <span className="text-space-100">SLs</span> sign in with Google and see everyone&apos;s.
      </p>

      <AccessAdmin
        isOwner={isOwner}
        myEmail={me.email}
        players={roster.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          openCodeExpiresAt: iso(p.openCodeExpiresAt),
          devices: p.devices.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), lastSeenAt: iso(d.lastSeenAt) })),
        }))}
        sls={sls.map((s) => ({ ...s, createdAt: iso(s.createdAt) }))}
        unassigned={unassigned}
      />

      <p className="text-xs text-space-400">
        Old password logins still work until everyone has a code:{" "}
        <Link href="/settings/users" className="text-space-200 underline hover:text-ki-300">
          manage password logins
        </Link>
        .
      </p>
    </div>
  );
}

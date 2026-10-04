import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireSignedInPage } from "@/lib/auth";
import { devicesOf } from "@/lib/auth/access";
import { signOut } from "@/app/login/actions";
import { disconnectMyDeviceAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: Date | null) => (d ? d.toLocaleString("de-AT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Vienna" }) : "—");

/** A player's own page: who they are, the devices they joined from, and sign-out. An SL has Settings instead. */
export default async function MePage() {
  const viewer = await requireSignedInPage();
  if (viewer.kind === "sl") redirect("/settings");
  const devices = viewer.playerId !== null ? await devicesOf(db, viewer.playerId) : [];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-space-50">{viewer.name}</h1>
      <p className="text-sm text-space-300">
        Your cards and decks are filed under <span className="text-space-100">{viewer.owner}</span>. Only you and your SLs see them.
      </p>

      {viewer.via === "code" ? (
        <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-sm">
          <h2 className="font-semibold text-space-50">Your devices</h2>
          <ul className="mt-2 divide-y divide-space-700/60">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-space-100">{d.label}</span>
                {d.id === viewer.deviceId ? <span className="rounded bg-ki-500/20 px-1.5 text-[11px] text-ki-300">this one</span> : null}
                <span className="text-xs text-space-400">joined {when(d.createdAt)} · last seen {when(d.lastSeenAt)}</span>
                {d.id !== viewer.deviceId ? (
                  <form action={disconnectMyDeviceAction.bind(null, d.id)} className="ml-auto">
                    <button type="submit" className="tap rounded-md border border-space-600 px-3 py-1 text-xs text-space-100 hover:bg-space-800">
                      Disconnect
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-xs text-space-300">
          You signed in with a password. Ask your SL for a join code to stay signed in on this phone without one.
        </p>
      )}

      <form action={signOut}>
        <button type="submit" className="tap rounded-md border border-space-600 px-4 py-2 text-sm text-space-100 hover:bg-space-800">
          Sign out of this device
        </button>
      </form>
    </div>
  );
}

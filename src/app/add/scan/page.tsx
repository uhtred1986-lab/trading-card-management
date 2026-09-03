import Link from "next/link";
import { db } from "@/db";
import { deckOptions } from "@/lib/decks/add";
import { ownerOptions } from "@/lib/collection/owners";
import { listLocations } from "@/lib/collection/locations";
import { currentOwner } from "@/lib/auth";
import { getBatch, listOpenBatches } from "@/lib/scan/batches";
import { ScanFlow } from "@/components/ScanFlow";
import { deleteBatchForm } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function ScanPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.batch) ? sp.batch[0] : sp.batch;
  const batchId = raw ? Number(raw) : null;
  const owner = await currentOwner();
  const [open, current, decks, owners, locations] = await Promise.all([listOpenBatches(db), batchId ? getBatch(db, batchId) : null, deckOptions(db), ownerOptions(db, owner), listLocations(db, false)]);
  const active = current && current.batch.status === "open" ? current : null;
  const others = open.filter((b) => b.id !== active?.batch.id);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/add" className="text-xs text-space-300 hover:text-ki-300">
          ← Add
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Scan cards</h1>
        {active ? <span className="text-xs text-space-400">{active.batch.name}</span> : null}
      </div>

      {batchId && !active ? (
        <p className="rounded-xl border border-space-700 p-3 text-sm text-space-300">
          That batch is finished or was discarded.{" "}
          <Link href="/add/scan" className="text-ki-300 hover:underline">
            Start a new one
          </Link>
          .
        </p>
      ) : null}

      {others.length ? (
        <section className="rounded-xl border border-ki-500/30 bg-ki-500/5 p-3">
          <h2 className="mb-2 text-sm font-semibold text-space-50">{active ? "Other open batches" : "Continue an open batch"}</h2>
          <ul className="divide-y divide-space-800">
            {others.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Link href={`/add/scan?batch=${b.id}`} className="font-medium text-space-50 hover:text-ki-300">
                  {b.name}
                </Link>
                <span className="text-xs text-space-300">
                  {b.photos} photo{b.photos === 1 ? "" : "s"} · {b.items} card{b.items === 1 ? "" : "s"} · {b.needsReview} to review · {b.ready} ready
                  {b.deckName ? ` · → ${b.deckName}` : ""}
                  {b.owner ? ` · for ${b.owner}` : ""}
                </span>
                <span className="text-xs text-space-400">updated {b.updatedAt.toISOString().replace("T", " ").slice(0, 16)}</span>
                <span className="ml-auto flex gap-2">
                  <Link href={`/add/scan?batch=${b.id}`} className="tap rounded-md bg-ki-500 px-3 py-1 text-xs font-semibold text-space-950 hover:bg-ki-400">
                    Continue
                  </Link>
                  <form action={deleteBatchForm}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="tap rounded-md border border-space-600 px-3 py-1 text-xs text-space-300 hover:bg-space-800 hover:text-loss">Discard</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ScanFlow
        key={active?.batch.id ?? "new"}
        batchId={active?.batch.id ?? null}
        batchName={active?.batch.name ?? null}
        mode={active?.batch.mode ?? "single"}
        photos={active?.photos ?? []}
        items={active?.items ?? []}
        decks={decks}
        deckId={active?.batch.deckId ?? null}
        owner={active?.batch.owner ?? owner}
        locationId={active?.batch.locationId ?? null}
        locations={locations}
        owners={owners}
      />
    </div>
  );
}

import Link from "next/link";
import { db } from "@/db";
import { listLocations } from "@/lib/collection/locations";
import { LocationsAdmin } from "@/components/LocationsAdmin";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const locations = await listLocations(db);
  const filed = locations.reduce((n, l) => n + l.cards, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/settings" className="text-xs text-space-300 hover:text-ki-300">
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Storage locations</h1>
        <span className="ml-auto text-xs text-space-400">{filed} card{filed === 1 ? "" : "s"} filed</span>
      </div>

      <p className="rounded-xl border border-space-700/70 bg-space-900/40 p-3 text-xs text-space-300">
        Where your cards physically live — a binder, a box, a shelf. Assign them on the collection&apos;s{" "}
        <Link href="/collection?view=list" className="text-ki-300 hover:underline">
          copies view
        </Link>
        , one at a time or to a whole selection at once, then filter by location to find a card again. Archiving keeps a location on the cards already filed
        there but takes it out of the pickers.
      </p>

      <LocationsAdmin locations={locations} />
    </div>
  );
}

import Link from "next/link";
import { db } from "@/db";
import { listLocations } from "@/lib/collection/locations";
import { LocationsAdmin } from "@/components/LocationsAdmin";
import { requireSlPage } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  await requireSlPage();
  const locations = await listLocations(db);
  const filed = locations.reduce((n, l) => n + l.cards, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Storage locations" eyebrow="Settings" description="Organize where your physical cards live." actions={<span className="text-sm text-space-400">{filed} card{filed === 1 ? "" : "s"} filed</span>} />

      <Panel className="text-sm text-space-300">
        Where your cards physically live — a binder, a box, a shelf. Assign them on the collection&apos;s{" "}
        <Link href="/collection?view=list" className="text-ki-300 hover:underline">
          copies view
        </Link>
        , one at a time or to a whole selection at once, then filter by location to find a card again. Archiving keeps a location on the cards already filed there but takes it out of the pickers.
      </Panel>

      <LocationsAdmin locations={locations} />
    </div>
  );
}

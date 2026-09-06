import Link from "next/link";
import { db } from "@/db";
import { archivedCopies } from "@/lib/collection/queries";
import { ArchivedList } from "@/components/ArchivedList";

export const dynamic = "force-dynamic";

export default async function ArchivedCollectionPage() {
  const rows = await archivedCopies(db);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">Archived cards</h1>
          <p className="text-sm text-space-300">
            {rows.length} {rows.length === 1 ? "copy" : "copies"} removed from the collection — restore one, or delete it forever.
          </p>
        </div>
        <Link href="/collection" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          Back to collection
        </Link>
      </div>
      <ArchivedList rows={rows} />
    </div>
  );
}

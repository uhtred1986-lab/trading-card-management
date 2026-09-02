import Link from "next/link";
import { db } from "@/db";
import { deckOptions } from "@/lib/decks/add";
import { BulkEntry } from "@/components/BulkEntry";

export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const decks = await deckOptions(db);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <Link href="/add" className="text-xs text-space-300 hover:text-ki-300">
          ← Add
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Bulk entry</h1>
      </div>
      <BulkEntry decks={decks} />
    </div>
  );
}

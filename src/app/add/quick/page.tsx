import Link from "next/link";
import { db } from "@/db";
import { currentOwner } from "@/lib/auth";
import { deckOptions } from "@/lib/decks/add";
import { ownerOptions } from "@/lib/collection/owners";
import { QuickCapture } from "@/components/QuickCapture";

export const dynamic = "force-dynamic";

export default async function QuickPage() {
  const owner = await currentOwner();
  const [decks, owners] = await Promise.all([deckOptions(db), ownerOptions(db, owner)]);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <Link href="/add" className="text-xs text-space-300 hover:text-ki-300">
          ← Add
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Quick capture</h1>
        <span className="ml-auto text-xs text-space-400">{owner ? `as ${owner}` : "no login — owner not recorded"}</span>
      </div>
      <QuickCapture owner={owner} decks={decks} owners={owners} />
    </div>
  );
}

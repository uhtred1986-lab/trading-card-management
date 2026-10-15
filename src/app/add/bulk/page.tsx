import Link from "next/link";
import { db } from "@/db";
import { deckOptions } from "@/lib/decks/add";
import { ownerOptions } from "@/lib/collection/owners";
import { listLocations } from "@/lib/collection/locations";
import { currentOwner, requireSignedInPage, currentScope } from "@/lib/auth";
import { BulkEntry } from "@/components/BulkEntry";
import { PageHeader, SectionTabs } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const viewer = await requireSignedInPage();
  const owner = await currentOwner();
  const scope = await currentScope();
  const [decks, owners, locations] = await Promise.all([deckOptions(db, { scope }), ownerOptions(db, owner, viewer.kind === "player"), listLocations(db, false, scope)]);
  return (
    <div className="space-y-3">
      <PageHeader title="Bulk entry" eyebrow={<Link href="/add">Add cards</Link>} description="Enter multiple cards with the keyboard." />
      <SectionTabs items={[{href:"/add",label:"Add cards"},{href:"/add/quick",label:"Quick capture"},{href:"/add/scan",label:"Scan"},{href:"/add/bulk",label:"Bulk entry",active:true}]} />
      <BulkEntry decks={decks} owner={owner} owners={owners} locations={locations} />
    </div>
  );
}

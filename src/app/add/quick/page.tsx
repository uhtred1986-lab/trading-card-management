import Link from "next/link";
import { db } from "@/db";
import { currentOwner, requireSignedInPage, currentScope } from "@/lib/auth";
import { deckOptions } from "@/lib/decks/add";
import { ownerOptions } from "@/lib/collection/owners";
import { listLocations } from "@/lib/collection/locations";
import { QuickCapture } from "@/components/QuickCapture";
import { PageHeader, SectionTabs } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QuickPage() {
  const viewer = await requireSignedInPage();
  const owner = await currentOwner();
  const scope = await currentScope();
  const [decks, owners, locations] = await Promise.all([deckOptions(db, { scope }), ownerOptions(db, owner, viewer.kind === "player"), listLocations(db, false, scope)]);
  return (
    <div className="space-y-3">
      <PageHeader title="Quick capture" eyebrow={<Link href="/add">Add cards</Link>} description={owner ? `Adding as ${owner}` : "No login — owner not recorded"} />
      <SectionTabs items={[{href:"/add",label:"Add cards"},{href:"/add/quick",label:"Quick capture",active:true},{href:"/add/scan",label:"Scan"},{href:"/add/bulk",label:"Bulk entry"}]} />
      <QuickCapture owner={owner} decks={decks} owners={owners} locations={locations} />
    </div>
  );
}

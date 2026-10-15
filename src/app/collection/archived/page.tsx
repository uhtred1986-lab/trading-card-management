import Link from "next/link";
import { db } from "@/db";
import { archivedCopies } from "@/lib/collection/queries";
import { ArchivedList } from "@/components/ArchivedList";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { PageHeader, SectionTabs } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ArchivedCollectionPage() {
  await requireSignedInPage();
  const rows = await archivedCopies(db, await currentScope());
  return (
    <div className="space-y-4">
      <PageHeader title="Archived cards" eyebrow="Collection" description={`${rows.length} ${rows.length === 1 ? "copy" : "copies"} removed from the collection — restore one, or delete it forever.`} actions={<Link href="/collection" className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          Back to collection
        </Link>} />
      <SectionTabs items={[{href:"/collection",label:"Collection"},{href:"/collection/archived",label:"Archived",active:true},{href:"/cards",label:"Catalog"},{href:"/decks",label:"Decks"}]} />
      <ArchivedList rows={rows} />
    </div>
  );
}

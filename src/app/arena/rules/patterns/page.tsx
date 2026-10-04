import { redirect } from "next/navigation";
import { legacyQueueUrl } from "@/lib/arena/queue";
import { requireSlPage } from "@/lib/auth";

/** The patterns are now the queue's *Group by: same wording* (#360); old links and docs keep working. */
export default async function PatternsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  redirect(legacyQueueUrl("patterns", await searchParams));
}

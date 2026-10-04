import { redirect } from "next/navigation";
import { legacyQueueUrl } from "@/lib/arena/queue";
import { requireSlPage } from "@/lib/auth";

/** The catalog worklist is now the queue's *Whole catalog* scope (#360); old links and docs keep working. */
export default async function AllRulesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  redirect(legacyQueueUrl("all", await searchParams));
}

import { redirect } from "next/navigation";
import { legacyQueueUrl } from "@/lib/arena/queue";

/** The catalog worklist is now the queue's *Whole catalog* scope (#360); old links and docs keep working. */
export default async function AllRulesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyQueueUrl("all", await searchParams));
}

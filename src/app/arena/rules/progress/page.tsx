import { redirect } from "next/navigation";
import { requireSlPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Progress is the Rules queue's summary strip now; old links keep working. A pure redirect: it writes nothing. */
export default async function RulesProgressRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const status = (await searchParams).status;
  const tab = ["text-only", "incomplete", "unchecked", "done"].find((h) => h === status);
  redirect(tab ? `/arena/rules?health=${tab}` : "/arena/rules");
}

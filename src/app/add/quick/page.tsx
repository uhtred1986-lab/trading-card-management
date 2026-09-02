import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { QuickCapture } from "@/components/QuickCapture";

export const dynamic = "force-dynamic";

export default async function QuickPage() {
  const owner = await currentUser();
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <Link href="/add" className="text-xs text-space-300 hover:text-ki-300">
          ← Add
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Quick capture</h1>
        <span className="ml-auto text-xs text-space-400">{owner ? `as ${owner}` : "no login — owner not recorded"}</span>
      </div>
      <QuickCapture owner={owner} />
    </div>
  );
}

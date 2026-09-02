import Link from "next/link";
import { ScanFlow } from "@/components/ScanFlow";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <Link href="/add" className="text-xs text-space-300 hover:text-ki-300">
          ← Add
        </Link>
        <h1 className="text-xl font-semibold text-space-50">Scan cards</h1>
      </div>
      <ScanFlow />
    </div>
  );
}

import Link from "next/link";
import { db } from "@/db";
import { listOpenBatches } from "@/lib/scan/batches";

export const dynamic = "force-dynamic";

export default async function AddPage() {
  const open = await listOpenBatches(db);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-space-50">Add cards</h1>
      {open.length ? (
        <Link href="/add/scan" className="block rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 text-sm hover:border-ki-500">
          <span className="font-semibold text-ki-300">
            {open.length} open scan batch{open.length === 1 ? "" : "es"}
          </span>{" "}
          <span className="text-space-300">— {open.reduce((n, b) => n + b.items, 0)} cards waiting for review, {open.reduce((n, b) => n + b.needsReview, 0)} need a look. Continue →</span>
        </Link>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/add/scan" className="rounded-xl border border-space-700/70 bg-space-900/60 p-4 hover:border-ki-500/50">
          <div className="text-lg font-semibold text-space-50">📷 Scan</div>
          <p className="mt-1 text-sm text-space-300">Photograph one card or a whole binder page. Every match is reviewed before it&apos;s saved — upload from the phone, finish on the PC. Photos are kept only until the batch is confirmed.</p>
        </Link>
        <Link href="/add/bulk" className="rounded-xl border border-space-700/70 bg-space-900/60 p-4 hover:border-ki-500/50">
          <div className="text-lg font-semibold text-space-50">⌨️ Type them in</div>
          <p className="mt-1 text-sm text-space-300">Keyboard-only table: a few letters or a number per row, Enter to commit. Fastest when cards are already sorted.</p>
        </Link>
      </div>
      <p className="text-xs text-space-400">You can also add a card from its page in the catalog.</p>
    </div>
  );
}

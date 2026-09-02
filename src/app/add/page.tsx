import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AddPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-space-50">Add cards</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/add/scan" className="rounded-xl border border-space-700/70 bg-space-900/60 p-4 hover:border-ki-500/50">
          <div className="text-lg font-semibold text-space-50">📷 Scan</div>
          <p className="mt-1 text-sm text-space-300">Photograph one card or a whole binder page. Every match is reviewed before it&apos;s saved; the photo is never stored.</p>
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

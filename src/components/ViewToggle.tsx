import Link from "next/link";
import { viewHref, type ViewMode } from "@/lib/view-mode";

/**
 * Image ⇄ list switch. A pair of links rather than a control, so the choice is
 * in the URL and survives a reload, a share and the browser's back button —
 * the same way every other filter on these screens works.
 */
export function ViewToggle({
  path,
  params,
  view,
  listLabel = "List",
}: {
  path: string;
  params: Record<string, string | string[] | undefined>;
  view: ViewMode;
  /** The collection's list is per-copy, so it says so. */
  listLabel?: string;
}) {
  const base = "tap flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors";
  const on = "bg-ki-500 text-space-950";
  const off = "text-space-300 hover:bg-space-800 hover:text-space-100";

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-space-700 bg-space-900/60 p-1" role="group" aria-label="View">
      <Link href={viewHref(path, params, "grid")} aria-current={view === "grid"} className={`${base} ${view === "grid" ? on : off}`}>
        <GridIcon />
        Images
      </Link>
      <Link href={viewHref(path, params, "list")} aria-current={view === "list"} className={`${base} ${view === "list" ? on : off}`}>
        <ListIcon />
        {listLabel}
      </Link>
    </div>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
      <rect x="1" y="2" width="3" height="3" rx="1" />
      <rect x="6" y="2.75" width="9" height="1.5" rx="0.75" />
      <rect x="1" y="6.5" width="3" height="3" rx="1" />
      <rect x="6" y="7.25" width="9" height="1.5" rx="0.75" />
      <rect x="1" y="11" width="3" height="3" rx="1" />
      <rect x="6" y="11.75" width="9" height="1.5" rx="0.75" />
    </svg>
  );
}

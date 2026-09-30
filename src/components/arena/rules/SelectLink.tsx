"use client";

import { useRouter } from "next/navigation";

/**
 * A native `<select>` whose options are links: choosing one navigates. The
 * queue's *Cards in* and *set* pickers are lists too long for chips (every
 * playable deck, every set), and a page that is a query string needs no form
 * state, so the options carry their own href.
 */
export function SelectLink({ label, value, options }: { label: string; value: string; options: { value: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const o = options.find((x) => x.value === e.target.value);
        if (o) router.push(o.href, { scroll: false });
      }}
      className="tap min-w-0 flex-1 rounded-md border border-space-600 bg-space-950 px-1.5 py-1 text-xs text-space-100"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

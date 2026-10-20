"use client";

import { useRouter } from "next/navigation";

/**
 * A native `<select>` whose options are links: choosing one navigates. The
 * queue's *Cards in* and *set* pickers are lists too long for chips (every
 * playable deck, every set), and a page that is a query string needs no form
 * state, so the options carry their own href. Options with the same `group` sit under one
 * `<optgroup>` (the sets, by family), and the browser's own type-ahead finds an option by its
 * first letters, so a hundred sets are a scan of ten headings, not a wall.
 */
const option = (o: { value: string; label: string }) => (
  <option key={o.value} value={o.value}>
    {o.label}
  </option>
);

export function SelectLink({ label, value, options }: { label: string; value: string; options: { value: string; label: string; href: string; group?: string }[] }) {
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
      {options.filter((o) => !o.group).map(option)}
      {[...new Set(options.flatMap((o) => (o.group ? [o.group] : [])))].map((g) => (
        <optgroup key={g} label={g}>
          {options.filter((o) => o.group === g).map(option)}
        </optgroup>
      ))}
    </select>
  );
}

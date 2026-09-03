"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A search box that narrows the list as you type, rather than waiting for
 * Enter. Each keystroke is debounced and pushed into the URL, so the result is
 * still a plain shareable link and the back button still works.
 *
 * `router.replace` rather than `push`: typing a word should not leave six
 * history entries behind it.
 */
export function LiveSearch({
  name = "q",
  defaultValue,
  placeholder,
  className,
  /** The other filters, carried along so typing doesn't drop them. */
  params,
  delay = 200,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  params?: Record<string, string | string[] | undefined>;
  delay?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(defaultValue ?? "");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read in the debounce callback rather than closed over, so the timer never
  // fires with a stale filter set. Written from an effect, not during render.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const go = (next: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(latest.current ?? {})) {
      if (Array.isArray(v)) for (const one of v) p.append(k, one);
      else if (v) p.set(k, v);
    }
    if (next.trim()) p.set(name, next.trim());
    else p.delete(name);
    const qs = p.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        type="search"
        name={name}
        value={value}
        placeholder={placeholder}
        // Enter would submit the surrounding GET form and reload the page for
        // a filter that has already been applied.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            go(value);
          }
        }}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go(next), delay);
        }}
        className="tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1.5 pr-7 text-sm text-space-100"
      />
      {pending ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-space-400">…</span> : null}
    </div>
  );
}

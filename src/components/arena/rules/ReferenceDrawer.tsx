"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * The Rules side's Reference drawer (ah-08, docs/arena-home-spec.md §3): the four reference
 * pages behind one button. A right-hand panel on wide screens, a bottom sheet on the phone.
 * No markdown renderer is in the tree, so "How to fix a card" stays a link to the GitHub copy,
 * marked as external. The WHEN/COST chips' own deep links into /keywords are untouched.
 */
export type ReferenceEntry = { label: string; hint: string; href: string; external?: boolean };

export function ReferenceDrawer({ fixingHref }: { fixingHref: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);

  const entries: ReferenceEntry[] = [
    { label: "Keywords", hint: "What the compiler understands, per keyword", href: "/arena/rules/keywords" },
    { label: "The game as files", hint: "The rules declarations a game is loaded from", href: "/arena/rules/game" },
    { label: "The rule language", hint: "The grammar a card's rule is written in", href: "/arena/rules/language" },
    { label: "How to fix a card", hint: "Correcting a rule record, step by step", href: fixingHref, external: true },
  ];

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="tap flex items-center rounded-md border border-space-700 px-3 text-sm text-space-200 hover:text-space-50"
      >
        Reference
      </button>
      {open ? (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Reference"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-space-700 bg-space-900 p-3 shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-96 sm:rounded-none sm:rounded-l-2xl"
          >
            <div className="flex items-center px-2 pb-2">
              <h2 className="text-sm font-semibold text-space-50">Reference</h2>
              <button
                type="button"
                aria-label="Close reference"
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                }}
                className="tap ml-auto flex items-center justify-center rounded-md px-3 text-lg leading-none text-space-300 hover:text-space-50"
              >
                <span aria-hidden>×</span>
              </button>
            </div>
            <ul className="space-y-1">
              {entries.map((e, i) => {
                const body = (
                  <>
                    <span className="block text-sm font-medium text-space-50">
                      {e.label}
                      {e.external ? <span className="ml-1 text-xs font-normal text-space-400">(opens GitHub ↗)</span> : null}
                    </span>
                    <span className="block text-xs text-space-400">{e.hint}</span>
                  </>
                );
                const cls = "tap block rounded-md px-3 py-2 hover:bg-space-800";
                return (
                  <li key={e.href}>
                    {e.external ? (
                      <a href={e.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={cls}>
                        {body}
                      </a>
                    ) : (
                      <Link ref={i === 0 ? first : undefined} href={e.href} onClick={() => setOpen(false)} className={cls}>
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

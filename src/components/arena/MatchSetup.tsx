"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** One desktop form, or a native modal phone wizard. Only the review step can submit. */
export function MatchSetup({ own, opponent, review, footer, fields, action, ownValid, opponentValid, busy = false }: {
  own: ReactNode; opponent: ReactNode; review: ReactNode; footer: ReactNode; fields?: ReactNode;
  action?: (data: FormData) => void | Promise<void>; ownValid: boolean; opponentValid: boolean; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => { if (open) { heading.current?.focus(); scroll.current?.scrollTo(0,0); } }, [open,step]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const changed = () => { if (desktop.matches && dialog.current?.open) dialog.current.close(); };
    desktop.addEventListener("change", changed);
    return () => desktop.removeEventListener("change", changed);
  }, []);
  const valid = step === 0 ? ownValid : opponentValid;
  const titles = ["Your deck", "Opponent", "Review and start"];
  return <>
    <button data-match-setup-open ref={opener} type="button" onClick={() => {setStep(0);setOpen(true);}} disabled={busy} className="tap w-full rounded-xl bg-ki-500 px-4 py-4 text-base font-semibold text-space-950 sm:hidden">Set up a match</button>
    <form action={action} className="hidden space-y-4 sm:block" data-desktop-setup>
      {fields}<div className="grid items-start gap-4 lg:grid-cols-2"><div>{own}</div><div>{opponent}</div></div>{footer}
    </form>
    <dialog ref={dialog} aria-labelledby="match-setup-title" onClose={() => {setOpen(false);opener.current?.focus();}} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-space-950 p-0 text-space-100 backdrop:bg-black/70 sm:hidden" data-match-wizard>
      {open && <form action={action} className="flex h-full min-h-0 flex-col" onSubmit={(e) => { if (step < 2 || !ownValid || !opponentValid) {e.preventDefault();if(step<2 && valid) setStep(step+1);} }}>
        {fields}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-space-700 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div><p className="text-xs text-space-400">New match · Step {step+1} of 3</p><h2 ref={heading} tabIndex={-1} id="match-setup-title" className="text-lg font-semibold outline-none">{titles[step]}</h2></div>
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="tap rounded-lg border border-space-600 px-3 py-2 text-sm">Close</button>
        </header>
        <div ref={scroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          <div style={{display:step===0?undefined:"none"}}>{own}</div>
          <div style={{display:step===1?undefined:"none"}}>{opponent}</div>
          {step===2 && review}
        </div>
        <footer className="shrink-0 space-y-2 border-t border-space-700 bg-space-950 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step>0 && <button type="button" disabled={busy} onClick={() => setStep(step-1)} className="tap rounded-lg border border-space-600 px-4 py-2 text-sm">Back</button>}
          {step<2 ? <button data-setup-next type="button" disabled={busy || !valid} onClick={() => setStep(step+1)} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 font-semibold text-space-950 disabled:opacity-40">{step===0?"Next: opponent":"Review match"}</button> : footer}
        </footer>
      </form>}
    </dialog>
  </>;
}

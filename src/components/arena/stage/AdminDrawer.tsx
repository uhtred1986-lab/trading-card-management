"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { AdminDebug } from "@/lib/arena/admin-debug";
import type { NumberedBeat } from "@/lib/arena/beats";
import type { Narrator } from "@/lib/arena/narration";
import { narrate } from "@/lib/arena/narration";
import type { Snapshot } from "@/lib/arena/snapshot";

/** The shield in the board's top bar: only ever rendered for an admin. */
export function AdminShield({ onOpen, className = "" }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open match debug (admin)"
      data-arena-admin="shield"
      className={`tap flex h-9 w-9 items-center justify-center rounded-full border border-space-600 bg-space-900/80 text-space-200 hover:border-loss/70 hover:text-space-50 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
        <path d="m9 12 2.2 2.2L15.5 10" />
      </svg>
    </button>
  );
}

const cell = "border-b border-r border-space-800 px-3 py-2";

function Cell({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`${cell} ${wide ? "col-span-2" : ""}`}>
      <dt className="text-[10px] uppercase tracking-widest text-space-300">{label}</dt>
      <dd className="mt-0.5 font-mono text-[13px] font-semibold text-space-50">{children}</dd>
    </div>
  );
}

/**
 * The admin drawer (issue #350, frames `*-11-admin-debug-drawer.jpg`): a right-hand
 * panel on desktop, a full-screen sheet on a phone. It holds what a player's
 * board no longer shows — seed, engine, the opponent's hidden hand, the raw
 * engine log, the beat list and, for Claude's decisions, what was legal and why.
 *
 * Positioned inline: the unlayered `.arena > *` rule beats Tailwind's `fixed`
 * and `z-*` on a direct child of the board (#412).
 */
export function AdminDrawer({
  snapshot,
  debug,
  beats,
  log,
  narrator,
  onClose,
}: {
  snapshot: Snapshot;
  debug: AdminDebug | null;
  beats: NumberedBeat[];
  log: string[];
  narrator: Narrator;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // The latest onClose, read by the Escape listener. The board passes an
  // inline function and re-renders on every poll; depending on it would
  // re-run the focus below each time and pull focus out of the drawer.
  const closeFn = useRef(onClose);
  useEffect(() => {
    closeFn.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFn.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const { game, view } = snapshot;
  const versus = game.mode === "versus";
  const beatRows = [...beats].reverse().slice(0, 120);
  const decisions = debug ? [...debug.decisions].reverse() : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Match debug"
      data-arena-admin="drawer"
      className="left-0 flex flex-col overflow-hidden border-space-700 bg-space-950 text-space-100 shadow-2xl sm:left-auto sm:w-[26rem] sm:border-l"
      style={{ position: "fixed", top: 0, bottom: 0, right: 0, zIndex: 95 }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-loss/40 px-4 py-3">
        <span className="rounded border-2 border-loss px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-space-50">Admin</span>
        <h2 className="text-base font-bold text-space-50">Match debug</h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close match debug" className="tap ml-auto flex h-10 w-10 items-center justify-center rounded-full text-xl text-space-300 hover:bg-space-800 hover:text-space-50">
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <p className="text-xs leading-relaxed text-space-300">Visible to admins only — players never see this.</p>

        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border-l border-t border-space-800 bg-space-900/60">
          <Cell label="seed">{debug?.seed ?? "—"}</Cell>
          <Cell label="turn">
            {view.turn} · {view.turnPlayer === view.you.player ? "you" : "them"}
          </Cell>
          <Cell label="phase">{view.phase}</Cell>
          <Cell label="prompt kind">{view.prompt.kind}</Cell>
          <Cell label="engine">
            {game.engine}
          </Cell>
          <Cell label="waiting on">{snapshot.waiting ?? "nobody"}</Cell>
          <Cell label={`${view.them.name}'s hand (hidden info)`} wide>
            {debug?.theirHand ? (debug.theirHand.length ? debug.theirHand.join(", ") : "empty") : "not available"}
          </Cell>
        </dl>

        {/* rd-09 adds "Flag this turn" here; until it records something the button is left out. */}

        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={`/arena/${game.id}/debug`} className="text-ki-300 hover:underline">
            {versus ? "what the server decided" : "how Claude played"} →
          </Link>
        </nav>

        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-space-300">Beats</h3>
          {beatRows.length === 0 ? (
            <p className="text-xs text-space-300">No beats in the queue.</p>
          ) : (
            <ol className="space-y-1 font-mono text-[11px] leading-snug">
              {beatRows.map((b) => (
                <li key={b.n} className="rounded bg-space-900/60 px-2 py-1">
                  <span className="text-space-300">#{b.n}</span> <span className="text-ki-300">{b.t}</span> <span className="text-space-200">{narrate(b, narrator) ?? ""}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-space-300">{versus ? "Server decisions" : "Claude's decisions"}</h3>
          {decisions.length === 0 ? (
            <p className="text-xs text-space-300">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-1.5 text-[11px] leading-snug">
              {decisions.map((d) => (
                <li key={d.seq} className="rounded bg-space-900/60 px-2 py-1.5">
                  <p className="font-mono">
                    <span className="text-space-300">#{d.seq}</span> <span className="text-space-300">T{d.turn}</span> <span className="text-ki-300">{d.promptKind}</span> <span className="text-space-300">{d.player}</span>{" "}
                    <span className={d.decidedBy === "rule" ? "text-space-300" : d.decidedBy === "fallback" ? "text-dbs-yellow" : "text-ki-300"}>{d.decidedBy}</span>
                  </p>
                  <p className="text-space-100">
                    <span className="text-space-300">chose </span>
                    {d.chosenLabel ?? "—"}
                  </p>
                  <p className="text-space-300">why: {d.how}</p>
                  {d.say && <p className="italic text-ki-300">“{d.say}”</p>}
                  {d.menu && d.menu.length > 1 && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-space-300">the {d.menu.length} moves that were legal</summary>
                      <ol className="mt-0.5 space-y-0.5 pl-4 font-mono text-space-300">
                        {d.menu.map((m, i) => (
                          <li key={i} className={i === d.chosenIndex ? "text-ki-300" : ""}>
                            {i}. {m}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-space-300">Raw engine log</h3>
          <ol className="max-h-72 space-y-0.5 overflow-y-auto rounded bg-space-900/60 p-2 font-mono text-[10.5px] leading-relaxed text-space-300">
            {log.slice(-200).map((line, i) => (
              <li key={i} className={line.startsWith("—") ? "mt-1 text-space-100" : ""}>
                {line}
              </li>
            ))}
            {log.length === 0 && <li>nothing has happened yet</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}

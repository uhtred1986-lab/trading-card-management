"use client";

import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import { cardImage } from "@/lib/catalog/card-image";

/**
 * Two focused moments for the beats the board has no surface of its own for
 * (owner, 17 Oct 2026: "super clear and focused ... no need for a lot of text"):
 *
 *  - `PlaySpotlight`: the opponent plays a card. It is shown large in the centre
 *    over a dimmed board with its name, for the beat's dwell, then fades while
 *    the card's own flight settles it into its slot.
 *  - `FightSpotlight`: an attack or a clash whose fight is not drawn by
 *    the takeover or the band (the battle had already closed by the time the
 *    story reached it). Both fighting cards, large; the clash adds the two
 *    power figures and lights the winner.
 *
 * Presentation only: every face and figure is the public beat's, and both are
 * `pointer-events-none`, so nothing here can hold a decision. With reduced
 * motion the beat player queues no beats, so neither is ever mounted.
 */

type Art = Beats["art"];

const clampMs = (ms: number) => Math.max(500, Math.min(ms, 1800));

function Face({ art, id, width, className = "" }: { art: Art; id: string; width: number; className?: string }) {
  const a = art[id];
  const src = a?.imageUrl ? cardImage(a.imageUrl, "medium") : null;
  return (
    <div className={`arena-focus-card relative overflow-hidden rounded-lg bg-space-800 shadow-2xl ${className}`} style={{ width, aspectRatio: "63 / 88" }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- transient overlay, art already loaded by the board.
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full place-items-center px-2 text-center text-sm font-bold text-white">{a?.name ?? ""}</span>
      )}
    </div>
  );
}

/** A card the opponent has just played from the hand into play. */
export function PlaySpotlight({ beat, art, viewer, ms }: { beat: NumberedBeat | null; art: Art; viewer: string; ms: number }) {
  if (!beat || beat.t !== "move" || beat.from !== "hand" || beat.to !== "battle" || beat.owner === viewer) return null;
  const a = art[beat.card];
  if (!a) return null;
  return (
    <div key={beat.n} className="arena-focus pointer-events-none fixed inset-0 z-[38] grid place-items-center" style={{ "--focus-ms": `${clampMs(ms)}ms` } as React.CSSProperties} data-play-spotlight={beat.n} aria-hidden>
      <div className="flex flex-col items-center gap-3">
        <Face art={art} id={beat.card} width={Math.min(240, Math.round(innerWidthHint() * 0.58))} className="ring-4 ring-violet-400 shadow-[0_0_28px_rgba(167,139,250,0.7)]" />
        <p className="arena-impact max-w-[80vw] truncate rounded-full bg-black/75 px-4 py-1.5 text-lg font-black text-white">{a.name}</p>
      </div>
    </div>
  );
}

/** A phone-safe width without measuring: the card never exceeds 58% of a 375 px screen on small devices. */
function innerWidthHint(): number {
  return typeof window === "undefined" ? 375 : window.innerWidth;
}

/** The two cards of a fight that no staging is drawing. */
export function FightSpotlight({ beat, art, sideOf, ms }: { beat: NumberedBeat | null; art: Art; sideOf: (card: string) => "yours" | "theirs" | null; ms: number }) {
  if (!beat) return null;
  let attacker: string, guard: string;
  if (beat.t === "attack") {
    attacker = beat.attacker;
    guard = beat.target;
  } else if (beat.t === "clash") {
    attacker = beat.attacker;
    guard = beat.guard;
  } else return null;
  if (!art[attacker] && !art[guard]) return null;
  // Their card on top, yours below, as in the takeover; an attack of unknown sides keeps the attacker on top.
  const attackerYours = sideOf(attacker) === "yours" || sideOf(guard) === "theirs";
  const top = attackerYours ? guard : attacker;
  const bottom = attackerYours ? attacker : guard;
  const clash = beat.t === "clash" ? beat : null;
  const power = (id: string) => (!clash ? null : id === clash.attacker ? clash.attackPower : clash.guardPower);
  const winner = clash ? (clash.hit ? clash.attacker : clash.guard) : null;
  const width = Math.min(150, Math.round(innerWidthHint() * 0.36));
  const side = (id: string, role: string) => (
    <div className={`flex items-center gap-3 ${winner && winner !== id ? "opacity-60" : ""}`}>
      <Face art={art} id={id} width={width} className={winner === id ? "ring-4 ring-ki-400" : ""} />
      <div className="flex min-w-[6rem] flex-col gap-1">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/80">{role}</span>
        <span className="max-w-[9rem] truncate text-sm font-bold text-white">{art[id]?.name ?? ""}</span>
        {power(id) != null && <span className="arena-clash-pow text-4xl">{power(id)!.toLocaleString("en")}</span>}
      </div>
    </div>
  );
  return (
    <div key={`${beat.t}-${beat.n}`} className="arena-focus arena-focus-hold pointer-events-none fixed inset-0 z-[38] grid place-items-center" style={{ "--focus-ms": `${clampMs(ms)}ms` } as React.CSSProperties} data-fight-spotlight={beat.t} aria-hidden>
      <div className="flex flex-col items-center gap-2">
        {side(top, top === attacker ? "Attacks" : "Defends")}
        <span className="arena-clash-vs text-4xl">VS</span>
        {side(bottom, bottom === attacker ? "Attacks" : "Defends")}
      </div>
    </div>
  );
}

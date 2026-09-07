"use client";

import { useState, useTransition } from "react";
import { chooseLightingAction } from "@/app/settings/actions";
import {
  DEFAULT_LIGHTING,
  encodeLighting,
  LEADER_COLOURS,
  LIGHTING_MODES,
  MIRROR_SCHEMES,
  toneFor,
  TONES,
  type LeaderColour,
  type LightingMode,
  type MirrorScheme,
  type TurnLighting as Prefs,
} from "@/lib/arena/lighting";

const MODE_LABEL: Record<LightingMode, string> = { on: "On", subtle: "Subtle", off: "Off" };
const MODE_WHY: Record<LightingMode, string> = {
  on: "The room takes the acting leader's colour, and its art washes the ground.",
  subtle: "Half the light and half the wash, for a board you would rather read than feel.",
  off: "No light at all. The turn is carried by the strip and the leader's scale and ring alone — which it has to be anyway.",
};

const MIRROR_LABEL: Record<MirrorScheme, string> = { rival: "Rival hue", cooled: "Cooled", off: "Off" };
const MIRROR_WHY: Record<MirrorScheme, string> = {
  rival: "In a mirror match the opponent's room turns violet. One extra hue to learn, and it always means the same thing: the other side, same colour as me.",
  cooled: "The opponent keeps their hue, cooled toward slate. Subtler, and stays inside the match's palette.",
  off: "No re-hue. In a mirror match both rooms are the same colour and only the light's position, the leader scale and the strip tell the turns apart.",
};

/** Why each colour's intensity is where it is, so a number is not just a number. */
const TONE_WHY: Record<LeaderColour, string> = {
  Red: "Warm and naturally loud. Held under 100 so it does not shout over the ki accent.",
  Blue: "Recedes on the night ground and fights the sky on anime — the one colour needing a boost in both.",
  Green: "Sits mid-range on both grounds. The reference the others are tuned against.",
  Yellow: "Pulled green-gold, away from the ki orange, so ambient light never reads as “this is interactive”.",
  Black: "A neutral tint barely registers as light. Leaned violet and given the highest multiplier — the honest hard case.",
};

/**
 * Turn lighting, tuned by hand (`docs/arena-turn-presence-spec.md` §3.5).
 *
 * The switch at the top is the one that has to exist for §2.5 to be honest: it
 * is what lets a player turn the ambient channel off and check that the board
 * is still unambiguous without it. The palette below it is the five colours'
 * own dials — a player who never opens this never sees them.
 *
 * Edits are local until Save, because a colour input and a range fire on every
 * frame of a drag and each one would otherwise be a round trip.
 */
export function TurnLighting({ prefs }: { prefs: Prefs }) {
  const [draft, setDraft] = useState<Prefs>(prefs);
  const [saved, setSaved] = useState(encodeLighting(prefs));
  const [pending, start] = useTransition();
  const dirty = encodeLighting(draft) !== saved;

  const save = (next: Prefs) => {
    const blob = encodeLighting(next);
    setDraft(next);
    start(async () => {
      await chooseLightingAction(blob);
      setSaved(blob);
    });
  };

  const setTone = (c: LeaderColour, patch: Partial<{ tint: string; glow: string; k: number }>) =>
    setDraft((d) => ({ ...d, tone: { ...d.tone, [c]: { ...toneFor(c, d), ...patch } } }));

  return (
    <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-space-50">Turn lighting</h2>
        <div className="flex gap-2">
          {LIGHTING_MODES.map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={() => save({ ...draft, mode: m })}
              className={`tap rounded-md border px-3 py-1 text-xs disabled:opacity-50 ${
                draft.mode === m ? "border-ki-500 bg-ki-500/15 text-space-50" : "border-space-600 text-space-100 hover:bg-space-800"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-space-300">
        On the arena board, the leader of whoever is acting grows and lights, and the room takes its printed colour. {MODE_WHY[draft.mode]}
      </p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-space-400">Same-colour matches</h3>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {MIRROR_SCHEMES.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending}
            onClick={() => save({ ...draft, mirror: m })}
            className={`tap rounded-md border px-3 py-1 text-xs disabled:opacity-50 ${
              draft.mirror === m ? "border-ki-500 bg-ki-500/15 text-space-50" : "border-space-600 text-space-100 hover:bg-space-800"
            }`}
          >
            {MIRROR_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-space-300">{MIRROR_WHY[draft.mirror]}</p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-space-400">Colour tone</h3>
      <p className="mt-1 text-xs text-space-300">
        The five colours do not carry equal weight as light, so each has its own intensity on top of the master dial. Judge them for <em>perceived</em> equality — no colour should
        feel like a brighter turn than another — and check both skins.
      </p>

      {/* Every colour's ambient at its own intensity, side by side: the one
          view in which "does Blue feel like the same turn as Green" can
          actually be answered. It is painted the way the board paints it. */}
      <div className="mt-2 flex gap-1.5">
        {LEADER_COLOURS.map((c) => {
          const t = toneFor(c, draft);
          const strength = draft.mode === "on" ? 1 : draft.mode === "subtle" ? 0.5 : 0;
          return (
            <span
              key={c}
              className="h-12 flex-1 rounded-md border border-space-700"
              title={`${c} · ${t.k}%`}
              style={{
                background: `radial-gradient(120% 80% at 50% 88%, color-mix(in oklab, ${t.glow} calc(0.55 * ${(t.k / 100).toFixed(2)} * ${strength} * 42%), transparent) 0%, transparent 68%), var(--color-space-950)`,
              }}
            />
          );
        })}
      </div>

      <ul className="mt-3 space-y-2">
        {LEADER_COLOURS.map((c) => {
          const t = toneFor(c, draft);
          const tuned = !!draft.tone[c];
          return (
            <li key={c} className="rounded-lg border border-space-700/70 bg-space-950/40 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 shrink-0 text-xs font-semibold text-space-100">{c}</span>
                <label className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-space-400">
                  tint
                  <input type="color" value={t.tint} onChange={(e) => setTone(c, { tint: e.target.value })} className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0" />
                </label>
                <label className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-space-400">
                  glow
                  <input type="color" value={t.glow} onChange={(e) => setTone(c, { glow: e.target.value })} className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0" />
                </label>
                <label className="flex min-w-[9rem] flex-1 items-center gap-2 text-[10px] uppercase tracking-widest text-space-400">
                  <input
                    type="range"
                    min={40}
                    max={160}
                    value={t.k}
                    onChange={(e) => setTone(c, { k: Number(e.target.value) })}
                    className="h-6 flex-1 accent-ki-500"
                    aria-label={`${c} intensity`}
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-ki-300">{t.k}%</span>
                </label>
                {tuned && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, tone: Object.fromEntries(Object.entries(d.tone).filter(([k]) => k !== c)) }))}
                    className="tap text-[10px] uppercase tracking-widest text-space-500 hover:text-ki-300"
                    title={`Back to the shipped ${c} tone (${TONES[c].tint} · ${TONES[c].k}%)`}
                  >
                    reset
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-space-400">{TONE_WHY[c]}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => save(draft)}
          className="tap rounded-md bg-ki-500 px-3 py-1.5 text-xs font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-40"
        >
          {pending ? "Saving…" : dirty ? "Save palette" : "Saved"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => save({ ...DEFAULT_LIGHTING, mode: draft.mode, mirror: draft.mirror })}
          className="tap rounded-md border border-space-600 px-3 py-1.5 text-xs text-space-100 hover:bg-space-800 disabled:opacity-50"
        >
          Reset to defaults
        </button>
        <span className="text-[11px] text-space-500">
          {Object.keys(draft.tone).length === 0 ? "Following the shipped palette." : `${Object.keys(draft.tone).length} colour(s) tuned; the rest follow the shipped palette.`}
        </span>
      </div>
    </section>
  );
}

/**
 * Turn presence: the leader owns the room (`docs/arena-turn-presence-spec.md`).
 *
 * Whose turn it is has to be readable at arm's length, before a word is read.
 * The leader already sitting on each side is the instrument: on its owner's
 * turn it grows and lights, and the room takes its colour. This module is the
 * only place that decides *which* colour — the board reads the answer as CSS
 * custom properties and knows nothing about leaders, mirrors or preferences.
 *
 * Three things here are deliberate rather than obvious:
 *
 *   - **The hue comes from the printed colour, not from sampling the art.**
 *     Deterministic and identical on both clients (the Android app derives the
 *     same value from the same `colors[0]`), with no canvas, no CORS and no
 *     image decode on a phone — and it cannot produce mud, which a dark
 *     painting sampled at its dominant colour reliably does.
 *   - **The dial is per colour, not global.** The five colours do not carry
 *     equal weight as light: a neutral Black tint is nearly invisible, Blue
 *     recedes on the night ground *and* fights the sky on anime, and Yellow
 *     sits uncomfortably close to the ki accent. One master strength times a
 *     per-colour intensity is what lets them land at the same *perceived*
 *     level.
 *   - **The master dials stay in CSS.** Only the per-colour numbers are
 *     emitted from here, so a skin can raise or lower the whole effect in its
 *     own scope (`docs/arena-skin-spec.md` §3.2) without React knowing.
 *
 * It is never the only signal. `mode: "off"` zeroes both layers, and the board
 * must still be unambiguous from the turn strip, the leader's scale and its
 * ring — that is the bar this design has to clear, not the one it gets credit
 * for.
 */

export const LEADER_COLOURS = ["Red", "Blue", "Green", "Yellow", "Black"] as const;
export type LeaderColour = (typeof LEADER_COLOURS)[number];

/** A tint, a lighter glow, and how hard this colour has to be pushed. */
export interface Tone {
  tint: string;
  glow: string;
  /** Per-colour intensity, as a percentage of the master dial. */
  k: number;
}

/**
 * The settled palette (tuned in the reference tool, 7 Sep 2026). Each `k` is a
 * claim about *perceived* brightness rather than a measured one, which is why
 * every number here is editable in Settings → Turn lighting.
 */
export const TONES: Record<LeaderColour, Tone> = {
  // Warm and naturally loud. Held under 100 so it does not shout over the ki accent.
  Red: { tint: "#e5484d", glow: "#ff7a6b", k: 95 },
  // Recedes on the night ground *and* fights the sky on anime — the one colour needing a boost in both.
  Blue: { tint: "#3b82f6", glow: "#6aa8ff", k: 105 },
  // Sits mid-range on both grounds. The reference the others are tuned against.
  Green: { tint: "#22c55e", glow: "#58e08a", k: 100 },
  // Pulled green-gold, away from the ki orange #f28c0f, so ambient light never reads as "this is interactive".
  Yellow: { tint: "#e8c020", glow: "#ffe36b", k: 88 },
  // A neutral tint barely registers as light. Leaned violet and given the highest multiplier — the honest hard case.
  Black: { tint: "#7b7f97", glow: "#a9adc9", k: 125 },
};

/**
 * The mirror-match counterpart: one extra hue that always means the same
 * thing — *the other side, same colour as me*. Violet is not a DBS leader
 * colour and is far from the ki accent, so it collides with nothing.
 */
export const RIVAL = { tint: "#a855f7", glow: "#c98bff" } as const;

/** What `cooled` mixes toward: slate, and a lighter slate for the glow. */
const SLATE = "#64748b";
const SLATE_GLOW = "#94a3b8";

export const LIGHTING_MODES = ["on", "subtle", "off"] as const;
export type LightingMode = (typeof LIGHTING_MODES)[number];

export const MIRROR_SCHEMES = ["rival", "cooled", "off"] as const;
export type MirrorScheme = (typeof MIRROR_SCHEMES)[number];

/**
 * The player's settings.
 *
 * `tone` holds **only the colours that have been tuned**, never the whole
 * table: a player who has not touched Blue keeps following the default, so
 * changing a default later reaches them instead of being silently overridden
 * by a saved copy of the old one. `v` is what a future change migrates from.
 */
export interface TurnLighting {
  v: number;
  mode: LightingMode;
  mirror: MirrorScheme;
  tone: Partial<Record<LeaderColour, Tone>>;
}

export const LIGHTING_VERSION = 1;
export const LIGHTING_COOKIE = "arenaLighting";

export const DEFAULT_LIGHTING: TurnLighting = { v: LIGHTING_VERSION, mode: "on", mirror: "rival", tone: {} };

const HEX = /^#[0-9a-f]{6}$/i;

/** A cookie value, or anything else at all, read as settings. */
export function lightingFrom(value: string | undefined | null): TurnLighting {
  if (!value) return DEFAULT_LIGHTING;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return DEFAULT_LIGHTING;
  }
  if (!raw || typeof raw !== "object") return DEFAULT_LIGHTING;
  const o = raw as Record<string, unknown>;
  // A blob from a future version is not read at all: half-understanding one is
  // worse than showing the defaults, and the defaults are always correct.
  if (typeof o.v === "number" && o.v > LIGHTING_VERSION) return DEFAULT_LIGHTING;
  const tone: Partial<Record<LeaderColour, Tone>> = {};
  const t = o.tone;
  if (t && typeof t === "object") {
    for (const c of LEADER_COLOURS) {
      const e = (t as Record<string, unknown>)[c];
      if (!e || typeof e !== "object") continue;
      const { tint, glow, k } = e as Record<string, unknown>;
      if (typeof tint !== "string" || !HEX.test(tint)) continue;
      if (typeof glow !== "string" || !HEX.test(glow)) continue;
      if (typeof k !== "number" || !Number.isFinite(k)) continue;
      tone[c] = { tint, glow, k: Math.min(200, Math.max(0, Math.round(k))) };
    }
  }
  return {
    v: LIGHTING_VERSION,
    mode: (LIGHTING_MODES as readonly unknown[]).includes(o.mode) ? (o.mode as LightingMode) : DEFAULT_LIGHTING.mode,
    mirror: (MIRROR_SCHEMES as readonly unknown[]).includes(o.mirror) ? (o.mirror as MirrorScheme) : DEFAULT_LIGHTING.mirror,
    tone,
  };
}

/** What goes in the cookie: the overrides only, so untouched defaults stay live. */
export function encodeLighting(prefs: TurnLighting): string {
  return JSON.stringify({ v: LIGHTING_VERSION, mode: prefs.mode, mirror: prefs.mirror, tone: prefs.tone });
}

/** The tone in force for one colour: the tuned one, or the shipped default. */
export function toneFor(colour: LeaderColour, prefs: TurnLighting): Tone {
  return prefs.tone[colour] ?? TONES[colour];
}

/**
 * A card's printed colours read as the one that owns the room.
 *
 * A multi-colour leader uses `colors[0]`, as the spec settles it. White and
 * Colorless are real values in the engine's `Color` but never light a room of
 * their own — they fall back to Black, the neutral tone, rather than to no
 * light at all.
 */
export function colourOf(colors: readonly string[] | null | undefined): LeaderColour | null {
  if (!colors || colors.length === 0) return null;
  const first = colors[0];
  return (LEADER_COLOURS as readonly string[]).includes(first) ? (first as LeaderColour) : "Black";
}

/** Who the room belongs to at this moment. */
export interface TurnRoom {
  /** The active leader's primary colour; null when it has none, or is hidden. */
  colour: LeaderColour | null;
  /** The active leader's art, or null — no art means no wash, never a broken one. */
  art: string | null;
  /** The active player is the person looking at the screen. */
  yours: boolean;
  /** Both leaders share a primary colour, so position alone would carry the turn. */
  mirror: boolean;
}

/** `on` full, `subtle` half, `off` nothing but the leader's scale and ring. */
const MODE_K: Record<LightingMode, number> = { on: 1, subtle: 0.5, off: 0 };

/**
 * Only art the browser will actually fetch becomes a wash. Anything else is
 * dropped rather than escaped: this string is pasted into a CSS `url()`, and a
 * value that would have to be escaped to be safe is a value that should not be
 * there at all.
 */
function cssUrl(art: string | null): string | null {
  if (!art) return null;
  if (!/^(https:\/\/|\/)[^"'()\\\s]+$/.test(art)) return null;
  return `url("${art}")`;
}

/**
 * The room, as custom properties for the `.arena` root.
 *
 * Everything a turn changes is in here and nowhere else. The two master dials
 * (`--turn-master`, `--turn-wash-master`) are deliberately absent — they live
 * in `globals.css` so each skin can set its own, and the strength a layer ends
 * up with is their product with `--turn-k` and `--turn-mode`.
 */
export function turnVars(room: TurnRoom, prefs: TurnLighting): Record<string, string> {
  // In a mirror match the *opponent's* room is re-hued, never the active
  // player's: re-hueing whoever is acting would mean your own room changed
  // colour depending on who moved last, which is worse than the problem.
  const reHue = room.mirror && !room.yours && prefs.mirror !== "off";
  const base = room.colour ? toneFor(room.colour, prefs) : null;
  const tone: Tone | null = !base
    ? null
    : !reHue
      ? base
      : prefs.mirror === "rival"
        ? { tint: RIVAL.tint, glow: RIVAL.glow, k: base.k }
        : { tint: mix(base.tint, SLATE, 0.55), glow: mix(base.glow, SLATE_GLOW, 0.5), k: base.k };

  const art = cssUrl(room.art);
  const vars: Record<string, string> = {
    "--turn-y": room.yours ? "88%" : "12%",
    "--turn-mode": String(MODE_K[prefs.mode]),
    "--turn-k": tone ? (tone.k / 100).toFixed(2) : "0",
    "--turn-art": art ?? "none",
    // The fallback §2.1 requires, expressed as a number so the CSS needs no
    // second rule: no art, no wash, and layer 2 carries the turn alone.
    "--turn-art-on": art ? "1" : "0",
  };
  if (tone) {
    vars["--turn-tint"] = tone.tint;
    vars["--turn-glow"] = tone.glow;
  }
  return vars;
}

/** Two hex colours, mixed by `t` (0 = all of `a`, 1 = all of `b`). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const one = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${one(ar, br)}${one(ag, bg)}${one(ab, bb)}`;
}

function rgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

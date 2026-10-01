/**
 * Seeded random numbers so a game is reproducible from its seed and its
 * action log. mulberry32: tiny, good enough for shuffling 60 cards.
 */

export function nextRandom(state: number): { value: number; state: number } {
  const t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t };
}

/** Fisher–Yates on a copy; returns the new RNG state alongside. */
export function shuffle<T>(items: T[], state: number): { items: T[]; state: number } {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextRandom(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { items: out, state: s };
}

/**
 * A seed from anything string-like (deck ids, a date) — FNV-1a, kept to 31
 * bits so it fits a signed 32-bit integer column and can be stored with the
 * saved game. The lost bit costs nothing: the seed only has to be varied.
 */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

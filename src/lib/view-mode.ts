/**
 * Grid ("image") vs. list, carried in `?view=`. Pure so the collection and the
 * catalog agree on the same spelling and `npm test` can pin it down.
 *
 * The grid stays the default everywhere: it is what the screens looked like
 * before the toggle existed, and card art is how you recognise a card.
 */
export type ViewMode = "grid" | "list";

export function parseViewMode(value: string | undefined, fallback: ViewMode = "grid"): ViewMode {
  return value === "list" || value === "grid" ? value : fallback;
}

/**
 * The same URL with `view` swapped. `grid` drops the parameter instead of
 * spelling out the default, so shared links stay short.
 */
export function viewHref(path: string, params: Record<string, string | undefined>, view: ViewMode): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k !== "view" && v != null && v !== "") p.set(k, v);
  if (view !== "grid") p.set("view", view);
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

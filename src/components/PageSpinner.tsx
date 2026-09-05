/**
 * Shown by every route's `loading.tsx` while its server data is fetched, so a
 * tapped link never leaves the previous page looking frozen. Same accent dot
 * as the arena's "waiting on server" cue, so it reads as the same app.
 */
export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-space-300" role="status" aria-live="polite">
      <span className="h-3 w-3 animate-pulse rounded-full bg-ki-400 shadow-[0_0_0_5px_rgba(255,167,51,0.18)]" aria-hidden />
      Loading…
    </div>
  );
}

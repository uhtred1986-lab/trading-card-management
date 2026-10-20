/**
 * What shows while the Card rules page reads the card, its skills, its decks and its queue (a few
 * seconds on the live database): the page's own shape in grey, so a click on a queue row is
 * answered at once instead of leaving the queue standing there.
 */
const bar = "rounded bg-space-700/60";

export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 pb-24 sm:pb-8" role="status" aria-label="Opening the card">
      <span className="sr-only">Opening the card…</span>
      <div className="h-11 rounded-xl border border-space-700 bg-space-900/60" />
      <section className="ds-panel grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-x-7">
        <div className="aspect-[5/7] rounded-lg bg-space-700/60 sm:row-span-4" />
        <div className="space-y-2 self-center sm:self-start">
          <div className={`${bar} h-3 w-40`} />
          <div className={`${bar} h-8 w-3/4`} />
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 w-24 rounded-xl border border-space-600 bg-space-800" />
          ))}
        </div>
        <div className={`${bar} col-span-2 h-4 w-2/3 sm:col-span-1`} />
        <div className={`${bar} col-span-2 h-10 w-1/2 sm:col-span-1`} />
      </section>
      {[0, 1].map((i) => (
        <section key={i} className="ds-panel space-y-4">
          <div className={`${bar} h-6 w-32`} />
          <div className={`${bar} h-16 w-full`} />
          <div className={`${bar} h-5 w-2/3`} />
          <div className="flex gap-2">
            <div className={`${bar} h-11 w-28`} />
            <div className={`${bar} h-11 w-24`} />
            <div className={`${bar} h-11 w-24`} />
          </div>
        </section>
      ))}
    </div>
  );
}

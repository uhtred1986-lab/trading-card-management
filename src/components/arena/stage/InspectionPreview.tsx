import Image from "next/image";
import type { PromptView } from "@/lib/arena/view";

/** Only authenticated cards already seen by this viewer reach this component. */
export function InspectionPreview({ inspection }: { inspection: NonNullable<PromptView["inspection"]> }) {
  return (
    <section className="w-full space-y-3" aria-label="Cards you have looked at" data-inspection-preview>
      <p className="text-sm font-semibold text-space-50">
        {inspection.inspected} of {inspection.maximum} cards looked at
      </p>
      {inspection.cards.length === 0 ? (
        <p className="text-sm text-space-200">{inspection.atLimit ? "There are no cards to look at." : "Look at the next card, or stop without looking."}</p>
      ) : (
        <div className="grid max-h-[48dvh] grid-cols-2 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-3">
          {inspection.cards.map((card, index) => (
            <details key={card.id} className="rounded-xl border border-space-600 bg-space-900/80 p-2" data-inspected-card>
              <summary className="tap min-h-11 cursor-pointer list-none text-center text-xs font-semibold text-space-50">
                {card.imageUrl ? <Image src={card.imageUrl} alt="" width={130} height={182} unoptimized className="mx-auto mb-2 h-auto w-full max-w-32 rounded object-contain" /> : null}
                <span className="block">{index + 1}. {card.name}</span>
                <span className="mt-1 block text-[11px] font-normal text-space-200">Read card text</span>
              </summary>
              <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-space-100">
                <dt>Colors</dt><dd>{card.colors.join(" / ") || "None"}</dd>
                <dt>Energy cost</dt><dd>{card.cost ?? "—"}</dd>
                <dt>Power</dt><dd>{card.power ?? "—"}</dd>
                <dt>Combo cost</dt><dd>{card.comboCost ?? "—"}</dd>
                <dt>Combo power</dt><dd>{card.comboPower ?? "—"}</dd>
              </dl>
              <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-space-100">{card.text?.replace(/<br\s*\/?>|\[br\]/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") || "No skills."}</p>
            </details>
          ))}
        </div>
      )}
      {inspection.atLimit ? <p className="text-xs text-space-200">You have finished looking. Continue to resolve the skill.</p> : null}
    </section>
  );
}

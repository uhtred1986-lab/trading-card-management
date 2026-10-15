import { describeTrigger } from "@/lib/arena/gaps";
import { costSentence, describeCond, describeScript } from "@/lib/arena/vm/script";
import type { Rule } from "@/lib/arena/lang/ast";

/** The four complete clauses in ordinary words. Raw language stays in a disclosure. */
export function RuleReading({ rule, title }: { rule: Rule; title: string }) {
  const timing = rule.trigger.length ? describeTrigger(rule.trigger)
    : rule.kind === "permanent" ? "Continuously while this Permanent applies"
    : rule.kind === "auto" ? "Timing has not been read"
    : `In the ${rule.kind.replaceAll(":", " ")} activation window`;
  const x = rule.cost?.x;
  const price = [costSentence(rule.cost), x ? `Choose X energy (${x.min ?? 0} minimum${x.max === undefined ? "; no upper bound specified" : `; ${x.max} maximum`})` : null].filter(Boolean).join("; ");
  const lines = [
    ["WHEN", timing],
    ["COST", price || "No skill cost"],
    ["IF", rule.cond ? describeCond(rule.cond) : "No additional condition"],
    ["THEN", describeScript(rule.ops, { permanent: rule.kind === "permanent" }) || "No effect steps"],
  ];
  return <section className="rounded-xl border border-space-600 bg-space-900/60 p-3" aria-label={title}>
    <h3 className="mb-2 font-bold text-space-50">{title}</h3>
    <dl className="space-y-3">{lines.map(([label, text]) => <div key={label} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
      <dt className="pt-0.5 text-xs font-bold tracking-wide text-ki-400">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-space-100">{text}</dd>
    </div>)}</dl>
  </section>;
}
